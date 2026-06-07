"""
Asya Port rıhtım takviminden gemi verisi çeker.

Site Adobe Flash (Flex) kullanıyor. Flash uygulaması arka planda
HTTP istekleri yaparak veri alıyor. Bu modül o veri endpoint'lerini
deneyerek gemi bilgilerini elde etmeye çalışır.
"""

import re
import logging
import requests
from bs4 import BeautifulSoup
from datetime import date, datetime, time
from dataclasses import dataclass
from typing import Optional
import xml.etree.ElementTree as ET

from config import PORT_BASE_URL, BERTH_CHART_PATH

logger = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
})


@dataclass
class BerthEntry:
    berth: str
    ship_name: str
    arrival: Optional[datetime]
    departure: Optional[datetime]
    agent: str = ""
    load_info: str = ""   # DIS/YUK/AKTARMA gibi

    def is_active_during(self, start: datetime, end: datetime) -> bool:
        """Gemi bu zaman aralığında limanda mı?"""
        if self.arrival is None or self.departure is None:
            return False
        return self.arrival < end and self.departure > start

    def departs_during(self, start: datetime, end: datetime) -> bool:
        """Gemi bu zaman aralığında ayrılıyor mu?"""
        if self.departure is None:
            return False
        return start <= self.departure <= end

    def arrives_during(self, start: datetime, end: datetime) -> bool:
        """Gemi bu zaman aralığında geliyor mu?"""
        if self.arrival is None:
            return False
        return start <= self.arrival <= end


def _try_xml_endpoint(target_date: date) -> Optional[list[BerthEntry]]:
    """
    Flash uygulamasının kullandığı XML endpoint'lerini dener.
    Asya Port sistemi genellikle /report/berth/*.do şeklinde XML döner.
    """
    date_str = target_date.strftime("%Y%m%d")
    year = target_date.strftime("%Y")
    month = target_date.strftime("%m")
    day = target_date.strftime("%d")

    candidates = [
        f"{PORT_BASE_URL}/report/berth/BerthAllocationChart.do?date={date_str}",
        f"{PORT_BASE_URL}/report/berth/getBerthData.do?date={date_str}",
        f"{PORT_BASE_URL}/report/berth/berthChart.do?year={year}&month={month}&day={day}",
        f"{PORT_BASE_URL}/eServicePage.do?menuName=report/berth/BerthAllocationChart&date={date_str}&format=xml",
        f"{PORT_BASE_URL}/servlet/BerthAllocationChartServlet?date={date_str}",
        f"{PORT_BASE_URL}/BerthData.do?date={date_str}",
        f"{PORT_BASE_URL}/report/berth/data.do?date={date_str}",
    ]

    for url in candidates:
        try:
            resp = SESSION.get(url, timeout=10)
            if resp.status_code == 200 and len(resp.text) > 100:
                content = resp.text.strip()
                # XML kontrolü
                if content.startswith("<") and ("berth" in content.lower() or "vessel" in content.lower() or "ship" in content.lower()):
                    logger.info(f"XML veri bulundu: {url}")
                    return _parse_xml(content, target_date)
                # JSON kontrolü
                if content.startswith("{") or content.startswith("["):
                    logger.info(f"JSON veri bulundu: {url}")
                    return _parse_json(content, target_date)
        except Exception as e:
            logger.debug(f"URL denemesi başarısız {url}: {e}")

    return None


def _try_main_page(target_date: date) -> Optional[list[BerthEntry]]:
    """Ana sayfayı çekerek Flash parametrelerini ve veri URL'lerini arar."""
    try:
        url = f"{PORT_BASE_URL}{BERTH_CHART_PATH}"
        params = {
            "menuName": "report/berth/BerthAllocationChart",
            "webuserid": "",
        }
        resp = SESSION.get(url, params=params, timeout=10)

        if resp.status_code != 200:
            return None

        soup = BeautifulSoup(resp.text, "html.parser")

        # Flash embed parametrelerini ara
        for obj in soup.find_all(["object", "embed"]):
            flashvars = obj.get("flashvars") or obj.get("value", "")
            if "berth" in str(flashvars).lower() or "chart" in str(flashvars).lower():
                logger.info(f"Flash parametreleri bulundu: {flashvars}")
                data_url = _extract_data_url(str(flashvars))
                if data_url:
                    return _fetch_data_url(data_url, target_date)

        # Sayfada doğrudan XML/JSON veri var mı?
        for script in soup.find_all("script"):
            if script.string and ("berth" in script.string.lower() or "vessel" in script.string.lower()):
                entries = _parse_inline_script(script.string, target_date)
                if entries:
                    return entries

        # iframe içinde veri olabilir
        for iframe in soup.find_all("iframe"):
            src = iframe.get("src", "")
            if "berth" in src.lower() or "chart" in src.lower():
                full_url = src if src.startswith("http") else f"{PORT_BASE_URL}{src}"
                try:
                    iframe_resp = SESSION.get(full_url, timeout=10)
                    if iframe_resp.status_code == 200:
                        entries = _parse_html_table(iframe_resp.text, target_date)
                        if entries:
                            return entries
                except Exception:
                    pass

        # HTML'de tablo var mı?
        return _parse_html_table(resp.text, target_date)

    except Exception as e:
        logger.error(f"Ana sayfa çekme hatası: {e}")
        return None


def _extract_data_url(flashvars: str) -> Optional[str]:
    """flashvars string'inden data URL'i çıkarır."""
    patterns = [
        r"dataURL=([^&\"']+)",
        r"xmlURL=([^&\"']+)",
        r"serviceURL=([^&\"']+)",
        r"dataUrl=([^&\"']+)",
    ]
    for pat in patterns:
        m = re.search(pat, flashvars)
        if m:
            return m.group(1)
    return None


def _fetch_data_url(data_url: str, target_date: date) -> Optional[list[BerthEntry]]:
    """Bulunan data URL'ini çeker ve parse eder."""
    if not data_url.startswith("http"):
        data_url = f"{PORT_BASE_URL}{data_url}"
    try:
        resp = SESSION.get(data_url, timeout=10)
        if resp.status_code == 200:
            return _parse_xml(resp.text, target_date) or _parse_json(resp.text, target_date)
    except Exception as e:
        logger.error(f"Data URL çekme hatası: {e}")
    return None


def _parse_xml(content: str, target_date: date) -> Optional[list[BerthEntry]]:
    """XML response'u BerthEntry listesine dönüştürür."""
    try:
        root = ET.fromstring(content)
        entries = []

        # Farklı XML yapılarını dene
        for node in root.iter():
            tag = node.tag.lower()
            if any(k in tag for k in ["berth", "vessel", "ship", "allocation"]):
                entry = _xml_node_to_entry(node, target_date)
                if entry:
                    entries.append(entry)

        return entries if entries else None
    except ET.ParseError as e:
        logger.debug(f"XML parse hatası: {e}")
        return None


def _xml_node_to_entry(node, target_date: date) -> Optional[BerthEntry]:
    """XML node'u BerthEntry'ye çevirir."""
    def get(keys):
        for k in keys:
            v = node.get(k) or node.findtext(k)
            if v:
                return v.strip()
        return ""

    berth = get(["berth", "berthName", "berthNo", "pier"])
    ship = get(["vesselName", "shipName", "vessel", "ship", "name"])
    arrival_str = get(["arrivalTime", "arrival", "eta", "berthedTime"])
    departure_str = get(["departureTime", "departure", "etd", "unBerthedTime"])
    agent = get(["agent", "agentName", "lineAgent"])
    load_info = get(["loadInfo", "container", "containers"])

    if not ship:
        return None

    arrival = _parse_datetime(arrival_str, target_date)
    departure = _parse_datetime(departure_str, target_date)

    return BerthEntry(berth=berth, ship_name=ship, arrival=arrival,
                      departure=departure, agent=agent, load_info=load_info)


def _parse_json(content: str, target_date: date) -> Optional[list[BerthEntry]]:
    """JSON response'u parse eder."""
    import json
    try:
        data = json.loads(content)
        entries = []
        items = data if isinstance(data, list) else data.get("data", data.get("list", data.get("rows", [])))
        for item in items:
            entry = _dict_to_entry(item, target_date)
            if entry:
                entries.append(entry)
        return entries if entries else None
    except Exception as e:
        logger.debug(f"JSON parse hatası: {e}")
        return None


def _dict_to_entry(d: dict, target_date: date) -> Optional[BerthEntry]:
    def get(keys):
        for k in keys:
            if k in d:
                return str(d[k]).strip()
        return ""

    ship = get(["vesselName", "shipName", "vessel", "ship", "name", "VESSEL_NAME"])
    if not ship:
        return None

    berth = get(["berth", "berthName", "berthNo", "BERTH_NAME"])
    arrival_str = get(["arrivalTime", "arrival", "eta", "ETA", "ARRIVAL"])
    departure_str = get(["departureTime", "departure", "etd", "ETD", "DEPARTURE"])
    agent = get(["agent", "agentName", "AGENT"])
    load_info = get(["loadInfo", "containers", "LOAD_INFO"])

    return BerthEntry(
        berth=berth,
        ship_name=ship,
        arrival=_parse_datetime(arrival_str, target_date),
        departure=_parse_datetime(departure_str, target_date),
        agent=agent,
        load_info=load_info,
    )


def _parse_html_table(html: str, target_date: date) -> Optional[list[BerthEntry]]:
    """HTML tablo varsa parse eder."""
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    entries = []
    for table in tables:
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])]
        if not any(k in " ".join(headers) for k in ["vessel", "ship", "gemi", "berth"]):
            continue
        for row in rows[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) < 2:
                continue
            entry = _cells_to_entry(headers, cells, target_date)
            if entry:
                entries.append(entry)
    return entries if entries else None


def _cells_to_entry(headers, cells, target_date: date) -> Optional[BerthEntry]:
    def get(keys):
        for k in keys:
            for i, h in enumerate(headers):
                if k in h and i < len(cells):
                    return cells[i]
        return ""

    ship = get(["vessel", "ship", "gemi", "name"])
    if not ship:
        return None

    return BerthEntry(
        berth=get(["berth", "pier", "iskele", "rıhtım"]),
        ship_name=ship,
        arrival=_parse_datetime(get(["arrival", "eta", "geliş"]), target_date),
        departure=_parse_datetime(get(["departure", "etd", "gidiş", "çıkış"]), target_date),
        agent=get(["agent", "acente"]),
        load_info=get(["load", "container", "konteyner"]),
    )


def _parse_inline_script(script: str, target_date: date) -> Optional[list[BerthEntry]]:
    """Script içindeki inline JSON/veriyi parse eder."""
    import json
    patterns = [
        r"var\s+berthData\s*=\s*(\[.*?\]);",
        r"var\s+vessels\s*=\s*(\[.*?\]);",
        r"chartData\s*=\s*(\[.*?\]);",
    ]
    for pat in patterns:
        m = re.search(pat, script, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(1))
                entries = [_dict_to_entry(item, target_date) for item in data]
                return [e for e in entries if e]
            except Exception:
                pass
    return None


def _parse_datetime(s: str, reference_date: date) -> Optional[datetime]:
    """Çeşitli formatlardaki tarih-saat string'ini datetime'a çevirir."""
    if not s:
        return None

    formats = [
        "%Y%m%d%H%M",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%m/%d/%Y %H:%M",
        "%Y%m%d %H:%M",
        "%H:%M",   # sadece saat - bugünün tarihi ile birleştirilir
        "%H%M",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(s.strip(), fmt)
            # Sadece saat verildiyse referans tarihe ekle
            if dt.year == 1900:
                dt = dt.replace(year=reference_date.year,
                                month=reference_date.month,
                                day=reference_date.day)
            return dt
        except ValueError:
            pass

    # Unix timestamp dene
    try:
        ts = int(s)
        return datetime.fromtimestamp(ts)
    except (ValueError, OSError):
        pass

    return None


def get_berth_entries(target_date: date = None) -> tuple[list[BerthEntry], str]:
    """
    Gemi verilerini çeker.

    Returns:
        (entries, source) - entries: gemi listesi, source: veri kaynağı açıklaması
    """
    if target_date is None:
        target_date = date.today()

    # 1. XML endpoint dene
    entries = _try_xml_endpoint(target_date)
    if entries:
        return entries, "xml_endpoint"

    # 2. Ana sayfadan parse et
    entries = _try_main_page(target_date)
    if entries:
        return entries, "main_page"

    return [], "no_data"


def get_shift_report(target_date: date, shift_start_hour: int = 8, shift_end_hour: int = 16) -> dict:
    """
    Vardiya raporu hazırlar.

    Returns dict:
      - at_port: shift başında limanda olan gemiler
      - departing: shift süresince ayrılacak gemiler
      - arriving: shift süresince gelecek gemiler
      - source: veri kaynağı
      - error: hata varsa mesajı
    """
    try:
        entries, source = get_berth_entries(target_date)

        shift_dt_start = datetime.combine(target_date, time(shift_start_hour, 0))
        shift_dt_end = datetime.combine(target_date, time(shift_end_hour, 0))

        at_port = [e for e in entries if e.is_active_during(shift_dt_start, shift_dt_end)]
        departing = [e for e in entries if e.departs_during(shift_dt_start, shift_dt_end)]
        arriving = [e for e in entries if e.arrives_during(shift_dt_start, shift_dt_end)]

        return {
            "at_port": at_port,
            "departing": departing,
            "arriving": arriving,
            "source": source,
            "error": None,
            "date": target_date,
        }
    except Exception as e:
        logger.error(f"Rapor hazırlama hatası: {e}", exc_info=True)
        return {
            "at_port": [],
            "departing": [],
            "arriving": [],
            "source": "error",
            "error": str(e),
            "date": target_date,
        }
