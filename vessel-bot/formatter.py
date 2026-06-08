from datetime import date, datetime, timedelta
from scraper import BerthEntry
from shift_manager import format_date_tr


def _t(dt_iso: str | None) -> str:
    if not dt_iso:
        return "?"
    try:
        dt = datetime.fromisoformat(dt_iso)
        return dt.strftime("%d/%m %H:%M")
    except Exception:
        return dt_iso


def _cargo(e: BerthEntry) -> str:
    """'📦 yük X / tahliye Y' (sıfır/boş olanlar atlanır)."""
    bits = []
    if e.load_van:
        bits.append(f"yük {e.load_van}")
    if e.dis_van:
        bits.append(f"tahliye {e.dis_van}")
    return "📦 " + " / ".join(bits) if bits else ""


def _int(s) -> int:
    try:
        return int(str(s).strip())
    except (ValueError, AttributeError):
        return 0


def _summary(*groups: list[BerthEntry]) -> str:
    """Vardiya özeti: benzersiz gemi sayısı, toplam yük/tahliye, en yoğun rıhtım."""
    from collections import Counter
    seen = {}
    for g in groups:
        for e in g:
            seen[e.ship_name] = e
    ships = list(seen.values())
    if not ships:
        return ""
    load = sum(_int(e.load_van) for e in ships)
    dis  = sum(_int(e.dis_van) for e in ships)
    berths = Counter(e.berth for e in ships if e.berth)
    parts = [f"📊 {len(ships)} gemi"]
    if load or dis:
        parts.append(f"📦 {load} yük / {dis} tahliye")
    if berths:
        busiest, n = berths.most_common(1)[0]
        parts.append(f"🏗 en yoğun: {busiest} ({n})")
    return " · ".join(parts)


def _line(e: BerthEntry) -> str:
    parts = [f"• *{e.ship_name}*"]
    if e.berth:
        parts.append(f"({e.berth})")
    if e.departure:
        parts.append(f"→ çıkış: {_t(e.departure)}")
    if e.agent:
        parts.append(f"[{e.agent}]")
    cargo = _cargo(e)
    if cargo:
        parts.append(cargo)
    return " ".join(parts)


def build_shift_message(report: dict) -> str:
    d: date                  = report["date"]
    source: str              = report["source"]
    start_h: int             = report.get("start_h", 8)
    end_h: int               = report.get("end_h", 16)
    at_port: list[BerthEntry]  = report.get("at_port",   [])
    departing: list[BerthEntry]= report.get("departing", [])
    arriving: list[BerthEntry] = report.get("arriving",  [])

    lines = [
        "🚢 *Asya Port Vardiya Raporu*",
        f"📅 {format_date_tr(d)} — {start_h:02d}:00–{end_h:02d}:00",
        "",
    ]

    if source == "no_data":
        lines += [
            "⚠️ Veri çekilemedi.",
            "",
            "Ne yapabilirsiniz:",
            "• /prefetch — Liman WiFi'sinde iken veriyi çek",
            "• /gemi\\_ekle — Gemileri manuel gir",
            "• Siteyi açın: `http://195.142.119.165:9120/eServicePage.do?menuName=report/berth/BerthAllocationChart`",
        ]
        return "\n".join(lines)

    if source == "cache":
        lines.append("_(Önceden kaydedilmiş veri)_\n")

    if not at_port and not departing and not arriving:
        lines.append("✅ Bu vardiyada limanda gemi yok.")
        return "\n".join(lines)

    summary = _summary(at_port, departing, arriving)
    if summary:
        lines += [summary, ""]

    if at_port:
        lines.append(f"⚓ *Limanda olacak ({len(at_port)} gemi):*")
        lines += [_line(e) for e in at_port]
        lines.append("")

    if departing:
        lines.append(f"🟡 *Vardiyanda ayrılacak ({len(departing)} gemi):*")
        lines += [_line(e) for e in departing]
        lines.append("")
    else:
        lines.append("✅ Vardiyanda *ayrılacak gemi yok*.")
        lines.append("")

    if arriving:
        lines.append(f"🟢 *Vardiyanda gelecek ({len(arriving)} gemi):*")
        for e in arriving:
            parts = [f"• *{e.ship_name}*"]
            if e.berth:  parts.append(f"({e.berth})")
            if e.arrival: parts.append(f"→ geliş: {_t(e.arrival)}")
            if e.agent:  parts.append(f"[{e.agent}]")
            cargo = _cargo(e)
            if cargo: parts.append(cargo)
            lines.append(" ".join(parts))

    return "\n".join(lines)


def build_ship_detail(e: BerthEntry) -> str:
    """Tek gemi için tüm detay (/gemi)."""
    lines = [f"🚢 *{e.ship_name}*"]
    if e.berth:   lines.append(f"⚓ Rıhtım: {e.berth}")
    if e.status:  lines.append(f"📍 Durum: {e.status}")
    lines.append(f"🟢 Yanaşma: {_t(e.arrival)}")
    lines.append(f"🔴 Kalkış: {_t(e.departure)}")
    cargo = _cargo(e)
    if cargo:     lines.append(cargo)
    if e.service: lines.append(f"🛳 Servis: {e.service}")
    if e.agent:   lines.append(f"🏢 Operatör: {e.agent}")
    if e.length:  lines.append(f"📏 Boy: {e.length} m")
    if e.voyage:  lines.append(f"🧭 Sefer: {e.voyage}")
    return "\n".join(lines)


def build_ship_list(title: str, d: date, entries: list[BerthEntry]) -> str:
    """Başlıklı düz gemi listesi (/simdi, arama sonuçları)."""
    if not entries:
        return f"{title}\n_(gemi yok)_"
    lines = [f"{title} — {format_date_tr(d)} ({len(entries)} gemi)", ""]
    lines += [_line(e) for e in entries]
    return "\n".join(lines)


def build_berth_view(d: date, berth: str, entries: list[BerthEntry]) -> str:
    """Belirli rıhtımdaki gemiler, yanaşma saatine göre sıralı (/rihtim)."""
    sel = [e for e in entries if e.berth.upper() == berth.upper()]
    sel.sort(key=lambda e: e.arrival or "")
    if not sel:
        return f"⚓ *{berth.upper()}* — bu rıhtımda gemi yok ({format_date_tr(d)})."
    lines = [f"⚓ *Rıhtım {berth.upper()}* — {format_date_tr(d)} ({len(sel)} gemi)", ""]
    for e in sel:
        cargo = _cargo(e)
        line = f"• *{e.ship_name}* {_t(e.arrival)} → {_t(e.departure)}"
        if cargo:
            line += f"  {cargo}"
        lines.append(line)
    return "\n".join(lines)


def build_diff_message(d: date, diff: dict) -> str:
    """Cache ile canlı veri arasındaki fark (/degisiklik, prefetch uyarısı)."""
    added   = diff.get("added", [])
    removed = diff.get("removed", [])
    changed = diff.get("changed", [])
    if not (added or removed or changed):
        return f"✅ {format_date_tr(d)} — değişiklik yok."

    lines = [f"🔔 *{format_date_tr(d)} — değişiklikler*", ""]
    if changed:
        lines.append("✏️ *Saati değişen:*")
        for e, old_arr, old_dep in changed:
            if e.departure != old_dep:
                lines.append(f"• *{e.ship_name}* ({e.berth}) çıkış: {_t(old_dep)} → {_t(e.departure)}")
            else:
                lines.append(f"• *{e.ship_name}* ({e.berth}) geliş: {_t(old_arr)} → {_t(e.arrival)}")
        lines.append("")
    if added:
        lines.append("🟢 *Yeni eklenen:*")
        lines += [_line(e) for e in added]
        lines.append("")
    if removed:
        lines.append("⚪ *Listeden çıkan:*")
        lines += [f"• *{e.ship_name}* ({e.berth})" for e in removed]
        lines.append("")
    return "\n".join(lines).rstrip()


def build_day_overview(d: date, entries: list[BerthEntry]) -> str:
    """Bir günün tüm gün-boyu gemileri (vardiya filtresi yok), yanaşma sırasına göre."""
    start = datetime.combine(d, datetime.min.time())
    end = start + timedelta(days=1)
    seen = {}
    for e in entries:
        if e.is_active_during(start, end):
            seen.setdefault(e.ship_name, e)
    day = sorted(seen.values(), key=lambda e: e.arrival or "")
    head = f"📅 *{format_date_tr(d)} — gün boyu* ({len(day)} gemi)"
    if not day:
        return head + "\n_(gemi yok)_"
    lines = [head]
    summary = _summary(day, [], [])
    if summary:
        lines.append(summary)
    lines.append("")
    for e in day:
        cargo = _cargo(e)
        line = f"• *{e.ship_name}* ({e.berth}) {_t(e.arrival)} → {_t(e.departure)}"
        if cargo:
            line += f"  {cargo}"
        lines.append(line)
    return "\n".join(lines)


def build_shifts_list(shifts: list[date]) -> str:
    if not shifts:
        return "📋 Kayıtlı vardiya yok.\n/vardiya\\_ekle YYYY-MM-DD ile ekleyin."
    lines = ["📋 *Yaklaşan vardiyalar:*", ""]
    for d in shifts:
        lines.append(f"• {format_date_tr(d)}")
    return "\n".join(lines)
