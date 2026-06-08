"""
Asya Port rıhtım verisini çeker ve cache'e kaydeder.

Flash sitesi liman ağından erişilebilir. Bu script Termux'ta çalışırken
telefon liman WiFi'sindeyken veriyi çeker, cache klasörüne kaydeder.
Sabah bildirimi cache'ten okunur - o an internete gerek yoktur.
"""

import json
import logging
import os
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, time, timedelta
from dataclasses import dataclass, asdict
from typing import Optional

import requests
from bs4 import BeautifulSoup

from config import PORT_BASE_URL, BERTH_CHART_PATH, DATA_URL, CACHE_DIR

log = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
    "Accept": "text/xml,application/xml,text/html,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9",
})


# ── Veri modeli ───────────────────────────────────────────────────────────────

@dataclass
class BerthEntry:
    berth:      str
    ship_name:  str
    arrival:    Optional[str]   # ISO datetime string ya da None
    departure:  Optional[str]
    agent:      str = ""
    load_info:  str = ""
    load_van:   str = ""   # yüklenecek konteyner (loadvan)
    dis_van:    str = ""   # tahliye edilecek konteyner (disvan)
    status:     str = ""   # ARRIVED / PLANNED / DEPATURED (statusDesc)
    service:    str = ""   # servis hattı (outservice/inservice)
    length:     str = ""   # gemi boyu (vslLength)
    voyage:     str = ""   # sefer no (voyage)

    def arrival_dt(self) -> Optional[datetime]:
        return datetime.fromisoformat(self.arrival) if self.arrival else None

    def departure_dt(self) -> Optional[datetime]:
        return datetime.fromisoformat(self.departure) if self.departure else None

    def is_active_during(self, start: datetime, end: datetime) -> bool:
        a, d = self.arrival_dt(), self.departure_dt()
        if not a or not d:
            return False
        return a < end and d > start

    def is_active_at(self, when: datetime) -> bool:
        a, d = self.arrival_dt(), self.departure_dt()
        return bool(a and d and a <= when < d)

    def departs_during(self, start: datetime, end: datetime) -> bool:
        d = self.departure_dt()
        return bool(d and start <= d <= end)

    def arrives_during(self, start: datetime, end: datetime) -> bool:
        a = self.arrival_dt()
        return bool(a and start <= a <= end)


# ── Cache ─────────────────────────────────────────────────────────────────────

def _cache_path(d: date) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, f"{d.isoformat()}.json")


def _save_cache(d: date, entries: list[BerthEntry]):
    with open(_cache_path(d), "w", encoding="utf-8") as f:
        json.dump([asdict(e) for e in entries], f, ensure_ascii=False, indent=2)
    log.info(f"Cache kaydedildi: {_cache_path(d)} ({len(entries)} gemi)")


def _load_cache(d: date) -> Optional[list[BerthEntry]]:
    path = _cache_path(d)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return [BerthEntry(**row) for row in data]
    except Exception as e:
        log.warning(f"Cache okunamadı: {e}")
        return None


def cache_exists(d: date) -> bool:
    return os.path.exists(_cache_path(d))


# ── HTTP çekme ────────────────────────────────────────────────────────────────

def _get(url: str, params: dict = None, timeout: int = 10) -> Optional[requests.Response]:
    try:
        r = SESSION.get(url, params=params, timeout=timeout)
        if r.status_code == 200:
            return r
    except Exception as e:
        log.debug(f"GET hatası {url}: {e}")
    return None


# ── Tarih-saat parse ──────────────────────────────────────────────────────────

_DT_FORMATS = [
    "%Y%m%d%H%M%S", "%Y%m%d%H%M", "%Y/%m/%d %H:%M",
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y %H:%M", "%m/%d/%Y %H:%M",
    "%Y%m%d %H:%M", "%Y%m%d",
]

def _parse_dt(s: str, ref: date) -> Optional[datetime]:
    if not s:
        return None
    for fmt in _DT_FORMATS:
        try:
            dt = datetime.strptime(s.strip(), fmt)
            if dt.year == 1900:
                dt = dt.replace(year=ref.year, month=ref.month, day=ref.day)
            return dt
        except ValueError:
            pass
    # Unix timestamp
    try:
        return datetime.fromtimestamp(int(s))
    except (ValueError, OSError, OverflowError):
        pass
    return None


# ── XML parse ────────────────────────────────────────────────────────────────

def _attr(node, *keys) -> str:
    for k in keys:
        v = node.get(k) or node.findtext(k)
        if v:
            return str(v).strip()
    return ""


def _xml_to_entries(content: str, ref: date) -> list[BerthEntry]:
    entries = []
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return entries

    for node in root.iter():
        tag = node.tag.lower().split("}")[-1]
        if not any(k in tag for k in ("berth", "vessel", "ship", "alloc", "plan")):
            continue
        ship = _attr(node, "vesselName", "shipName", "vessel", "ship", "name", "VESSEL_NAME", "VesselName")
        if not ship:
            continue
        arr_s = _attr(node, "arrivalTime", "arrival", "eta", "ETA", "berthedTime", "ARRIVAL")
        dep_s = _attr(node, "departureTime", "departure", "etd", "ETD", "unBerthedTime", "DEPARTURE")
        entries.append(BerthEntry(
            berth=_attr(node, "berth", "berthName", "berthNo", "pier", "BERTH"),
            ship_name=ship,
            arrival=_parse_dt(arr_s, ref).isoformat() if _parse_dt(arr_s, ref) else None,
            departure=_parse_dt(dep_s, ref).isoformat() if _parse_dt(dep_s, ref) else None,
            agent=_attr(node, "agent", "agentName", "AGENT"),
            load_info=_attr(node, "loadInfo", "containers", "LOAD"),
        ))
    return entries


# ── JSON parse ───────────────────────────────────────────────────────────────

def _dict_to_entry(d: dict, ref: date) -> Optional[BerthEntry]:
    def g(*keys):
        for k in keys:
            if k in d:
                return str(d[k]).strip()
        return ""
    ship = g("vesselName", "shipName", "vessel", "ship", "name", "VESSEL_NAME")
    if not ship:
        return None
    arr_s = g("arrivalTime", "arrival", "eta", "ETA", "ARRIVAL")
    dep_s = g("departureTime", "departure", "etd", "ETD", "DEPARTURE")
    arr_dt = _parse_dt(arr_s, ref)
    dep_dt = _parse_dt(dep_s, ref)
    return BerthEntry(
        berth=g("berth", "berthName", "berthNo", "BERTH"),
        ship_name=ship,
        arrival=arr_dt.isoformat() if arr_dt else None,
        departure=dep_dt.isoformat() if dep_dt else None,
        agent=g("agent", "agentName", "AGENT"),
        load_info=g("loadInfo", "containers"),
    )


def _json_to_entries(content: str, ref: date) -> list[BerthEntry]:
    try:
        data = json.loads(content)
        items = data if isinstance(data, list) else \
                data.get("data", data.get("list", data.get("rows", data.get("result", []))))
        return [e for e in (_dict_to_entry(i, ref) for i in items) if e]
    except Exception:
        return []


# ── HTML tablo parse ──────────────────────────────────────────────────────────

def _html_to_entries(html: str, ref: date) -> list[BerthEntry]:
    soup = BeautifulSoup(html, "html.parser")
    entries = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        hdrs = [th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])]
        if not any(k in " ".join(hdrs) for k in ("vessel", "ship", "gemi", "berth", "rıhtım")):
            continue
        for row in rows[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) < 2:
                continue
            def gc(*keys):
                for k in keys:
                    for i, h in enumerate(hdrs):
                        if k in h and i < len(cells):
                            return cells[i]
                return ""
            ship = gc("vessel", "ship", "gemi", "name")
            if not ship:
                continue
            arr_s = gc("arrival", "eta", "geliş", "gelir")
            dep_s = gc("departure", "etd", "gidiş", "çıkış", "ayrılır")
            arr_dt = _parse_dt(arr_s, ref)
            dep_dt = _parse_dt(dep_s, ref)
            entries.append(BerthEntry(
                berth=gc("berth", "pier", "iskele", "rıhtım"),
                ship_name=ship,
                arrival=arr_dt.isoformat() if arr_dt else None,
                departure=dep_dt.isoformat() if dep_dt else None,
                agent=gc("agent", "acente"),
                load_info=gc("load", "container", "konteyner"),
            ))
    return entries


# ── Endpoint deneme ───────────────────────────────────────────────────────────

def _probe_candidates(target: date) -> list[BerthEntry]:
    ds = target.strftime("%Y%m%d")
    y, m, d = target.year, f"{target.month:02d}", f"{target.day:02d}"

    # Önce config'deki DATA_URL'i dene
    urls = []
    if DATA_URL:
        urls.append((DATA_URL, {"date": ds}))

    urls += [
        (f"{PORT_BASE_URL}/report/berth/BerthAllocationChartData.do", {"date": ds}),
        (f"{PORT_BASE_URL}/report/berth/getBerthData.do",             {"date": ds}),
        (f"{PORT_BASE_URL}/report/berth/BerthAllocationChart.do",     {"date": ds}),
        (f"{PORT_BASE_URL}/BerthAllocationChartData.do",              {"date": ds}),
        (f"{PORT_BASE_URL}/report/berth/vesselList.do",               {"date": ds}),
        (f"{PORT_BASE_URL}/eServicePage.do", {
            "menuName": "report/berth/BerthAllocationChart",
            "date": ds, "webuserid": "", "format": "xml"}),
        (f"{PORT_BASE_URL}/report/berth/BerthAllocationChart.do",     {"year": y, "month": m, "day": d}),
        (f"{PORT_BASE_URL}/xml/BerthAllocationChart.xml",             {"date": ds}),
        (f"{PORT_BASE_URL}/api/berth/chart",                          {"date": ds}),
    ]

    for url, params in urls:
        r = _get(url, params)
        if not r:
            continue
        ct = r.headers.get("Content-Type", "")
        body = r.text.strip()

        if not body or len(body) < 30:
            continue

        # XML
        if body.startswith("<") or "xml" in ct:
            entries = _xml_to_entries(body, target)
            if entries:
                log.info(f"XML veri alındı: {url} ({len(entries)} gemi)")
                return entries

        # JSON
        if body[0] in "{[" or "json" in ct:
            entries = _json_to_entries(body, target)
            if entries:
                log.info(f"JSON veri alındı: {url} ({len(entries)} gemi)")
                return entries

        # HTML tablo
        entries = _html_to_entries(body, target)
        if entries:
            log.info(f"HTML tablo alındı: {url} ({len(entries)} gemi)")
            return entries

    return []


def _probe_main_page(target: date) -> list[BerthEntry]:
    """Ana sayfadan Flash parametrelerini okur, veri URL'i bulursa çeker."""
    r = _get(f"{PORT_BASE_URL}{BERTH_CHART_PATH}", {
        "menuName": "report/berth/BerthAllocationChart",
        "webuserid": "",
    })
    if not r:
        return []

    soup = BeautifulSoup(r.text, "html.parser")

    # flashvars / data-url'i ara
    for tag in soup.find_all(["object", "embed", "param"]):
        for attr in ["flashvars", "value", "src", "data"]:
            val = tag.get(attr, "")
            if not val:
                continue
            m = re.search(r"(?:dataURL|xmlURL|serviceURL|dataUrl)=([^&\"'\s]+)", val)
            if m:
                data_url = m.group(1)
                if not data_url.startswith("http"):
                    data_url = PORT_BASE_URL + data_url
                sub = _get(data_url, {"date": target.strftime("%Y%m%d")})
                if sub:
                    entries = _xml_to_entries(sub.text, target) or \
                              _json_to_entries(sub.text, target)
                    if entries:
                        log.info(f"flashvars data URL'den veri: {data_url}")
                        return entries

    # Sayfanın kendisi HTML tablo içeriyor olabilir
    return _html_to_entries(r.text, target)


# ── AMF3 kaynak ───────────────────────────────────────────────────────────────

def _amf_time(val, ref: date) -> Optional[datetime]:
    """Convert AMF3 Date (ms float) or string to datetime."""
    if val is None:
        return None
    if isinstance(val, (int, float)) and val > 0:
        try:
            return datetime.fromtimestamp(val / 1000)
        except (OSError, OverflowError, ValueError):
            pass
    return _parse_dt(str(val), ref)


def _amf_to_entries(vessels: list[dict], ref: date) -> list[BerthEntry]:
    """Convert BerthChartVO dicts from AMF3 decoder into BerthEntry list."""
    entries = []
    for v in vessels:
        def g(*keys):
            for k in keys:
                val = v.get(k)
                if val is not None and str(val).strip() not in ('', 'null', 'None', '0', '0.0'):
                    return str(val).strip()
            return ''

        # Field names from com.clt.domain.ondock.BerthChartDomain:
        #   vslName  -> full vessel name (vessel = 4-letter code only)
        #   berthno  -> berth id (B3/BLK/FB1); berthNo/berthName are empty
        #   atb/atd  -> actual berth/departure "%Y-%m-%d %H:%M"
        #   berthTime/depatureTime -> compact "%Y%m%d%H%M%S" fallback
        #   vslOperator -> line operator (MSC/SOC); outservice -> service code
        ship = g('vslName', 'vesselName', 'vessel', 'vslNm', 'shipNm', 'shipName', 'name')
        if not ship:
            continue

        arr_dt = _amf_time(
            g('atb', 'berthTime', 'berthTimeS', 'etb', 'arrivalTime', 'eta'), ref)
        dep_dt = _amf_time(
            g('atd', 'depatureTime', 'depatureTimeS', 'etd', 'departureTime'), ref)

        entries.append(BerthEntry(
            berth=g('berthno', 'berthNo', 'berthName', 'brthNo', 'berth', 'pier'),
            ship_name=ship,
            arrival=arr_dt.isoformat() if arr_dt else None,
            departure=dep_dt.isoformat() if dep_dt else None,
            agent=g('vslOperator', 'agent', 'agentName'),
            load_info=g('outservice', 'inservice', 'berthside', 'loadInfo'),
            load_van=g('loadvan', 'loadVan'),
            dis_van=g('disvan', 'disVan'),
            status=g('statusDesc', 'status'),
            service=g('outservice', 'inservice'),
            length=g('vslLength'),
            voyage=g('voyage', 'evoyage'),
        ))
    return entries


# ── Dışa açık API ─────────────────────────────────────────────────────────────

def fetch_entries(target: date) -> tuple[list[BerthEntry], str]:
    """
    Önce cache'e bakar, yoksa canlıdan çeker.
    Returns (entries, source).
    """
    cached = _load_cache(target)
    if cached is not None:
        log.info(f"{target} cache'ten okundu ({len(cached)} gemi).")
        return cached, "cache"

    return fetch_live(target)


def fetch_live(target: date) -> tuple[list[BerthEntry], str]:
    """Cache'e bakmadan canlıdan çeker, başarılı olursa cache'e kaydeder."""
    # Primary: BlazeDS AMF0 remoting (selectBerthVessel(fromDate, toDate))
    try:
        from amf_client import get_vessels
        # The chart is queried as a range; a single-day range returns nothing,
        # and a window around the target also catches vessels that berthed
        # earlier but are still in port (or depart) during the target shift.
        frm = target - timedelta(days=2)
        to  = target + timedelta(days=2)
        vessels = get_vessels(frm, to)
        if vessels:
            entries = _amf_to_entries(vessels, target)
            if entries:
                _save_cache(target, entries)
                log.info(f"AMF verisi alındı: {len(entries)} gemi")
                return entries, "amf"
    except Exception as e:
        log.warning(f"AMF çekme hatası: {e}")

    # Fallback: HTTP endpoint probing
    entries = _probe_candidates(target) or _probe_main_page(target)
    if entries:
        _save_cache(target, entries)
        return entries, "live"
    return [], "no_data"


def get_shift_report(target: date, start_h: int = 8, end_h: int = 16) -> dict:
    entries, source = fetch_entries(target)

    # combine + timedelta so end_h == 24 (gece vardiyası bitişi) da çalışır
    midnight    = datetime.combine(target, time(0, 0))
    shift_start = midnight + timedelta(hours=start_h)
    shift_end   = midnight + timedelta(hours=end_h)

    return {
        "date":      target,
        "source":    source,
        "start_h":   start_h,
        "end_h":     end_h,
        "error":     None if entries or source == "no_data" else "fetch_failed",
        "at_port":   [e for e in entries if e.is_active_during(shift_start, shift_end)],
        "departing": [e for e in entries if e.departs_during(shift_start, shift_end)],
        "arriving":  [e for e in entries if e.arrives_during(shift_start, shift_end)],
    }


def diff_entries(old: list[BerthEntry], new: list[BerthEntry]) -> dict:
    """İki gemi listesini karşılaştır. Gemi adına göre eşler.

    Returns {"added": [...], "removed": [...], "changed": [(entry, old_dep, old_arr), ...]}
    changed = yanaşma ya da kalkış saati değişen gemiler (yeni entry + eski değerler).
    """
    old_by = {e.ship_name: e for e in old}
    new_by = {e.ship_name: e for e in new}
    added   = [e for n, e in new_by.items() if n not in old_by]
    removed = [e for n, e in old_by.items() if n not in new_by]
    changed = []
    for n, ne in new_by.items():
        oe = old_by.get(n)
        if not oe:
            continue
        if ne.arrival != oe.arrival or ne.departure != oe.departure:
            changed.append((ne, oe.arrival, oe.departure))
    return {"added": added, "removed": removed, "changed": changed}


def fetch_live_diff(target: date) -> tuple[dict, str]:
    """Eski cache'i sakla, canlıyı çek (cache'i tazeler), farkı döndür.

    Returns (diff_dict_or_empty, source). İlk çekişte (eski cache yoksa) diff boş.
    """
    old = _load_cache(target)
    new, source = fetch_live(target)
    if old is None or not new:
        return {}, source
    return diff_entries(old, new), source


def prefetch_tomorrow(target: date = None) -> tuple[int, str]:
    """
    Ertesi günün verisini önceden çeker ve cache'e kaydeder.
    Vardiya biterken (18:00) çalışır - o an liman WiFi'sinde olmak gerekir.
    Returns (gemi_sayısı, kaynak).
    """
    tomorrow = (target or date.today()) + timedelta(days=1)
    entries, source = fetch_live(tomorrow)
    return len(entries), source
