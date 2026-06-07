"""Gemi verilerini Türkçe Telegram mesajına dönüştürür."""

from datetime import date, datetime
from scraper import BerthEntry
from shift_manager import format_date_tr, TURKISH_DAYS, TURKISH_MONTHS


def _fmt_time(dt: datetime | None) -> str:
    if dt is None:
        return "?"
    return dt.strftime("%d/%m %H:%M")


def _ship_line(entry: BerthEntry, note: str = "") -> str:
    parts = [f"• *{entry.ship_name}*"]
    if entry.berth:
        parts.append(f"({entry.berth})")
    if entry.departure:
        parts.append(f"→ çıkış: {_fmt_time(entry.departure)}")
    if entry.agent:
        parts.append(f"[{entry.agent}]")
    if note:
        parts.append(note)
    return " ".join(parts)


def build_shift_message(report: dict) -> str:
    target_date: date = report["date"]
    at_port: list[BerthEntry] = report["at_port"]
    departing: list[BerthEntry] = report["departing"]
    arriving: list[BerthEntry] = report["arriving"]
    error: str | None = report["error"]

    lines = []
    lines.append(f"🚢 *Asya Port Vardiya Raporu*")
    lines.append(f"📅 {format_date_tr(target_date)} — 08:00–16:00")
    lines.append("")

    if error:
        lines.append(f"⚠️ Veri çekilemedi: `{error}`")
        lines.append("")
        lines.append("Limanın web sitesi Flash kullandığı için otomatik veri alınamıyor.")
        lines.append("Lütfen siteyi manuel olarak kontrol edin:")
        lines.append(f"`http://195.142.119.165:9120/eServicePage.do?menuName=report/berth/BerthAllocationChart`")
        return "\n".join(lines)

    if not at_port and not departing and not arriving:
        lines.append("ℹ️ Vardiya saatlerinde limanda gemi bilgisi bulunamadı.")
        lines.append("")
        lines.append("Veri sistemi erişilebilir değil ya da bugün gemi yok.")
        return "\n".join(lines)

    # Vardiyada limanda olan gemiler
    if at_port:
        lines.append(f"⚓ *Vardiyada limanda olan gemiler ({len(at_port)} adet):*")
        for entry in at_port:
            lines.append(_ship_line(entry))
        lines.append("")
    else:
        lines.append("⚓ Vardiyada limanda gemi yok.")
        lines.append("")

    # Vardiyada ayrılacak gemiler
    if departing:
        lines.append(f"🟡 *Vardiyanda ayrılacak gemiler ({len(departing)} adet):*")
        for entry in departing:
            lines.append(_ship_line(entry))
        lines.append("")
    else:
        lines.append("✅ Vardiyanda ayrılacak gemi *yok*.")
        lines.append("")

    # Vardiyada gelecek gemiler
    if arriving:
        lines.append(f"🟢 *Vardiyanda gelecek gemiler ({len(arriving)} adet):*")
        for entry in arriving:
            arrival_str = _fmt_time(entry.arrival)
            lines.append(f"• *{entry.ship_name}* ({entry.berth}) → geliş: {arrival_str} [{entry.agent}]")
        lines.append("")

    return "\n".join(lines)


def build_no_shift_message(target_date: date) -> str:
    return f"📅 {format_date_tr(target_date)} — Bugün vardiya günü değil."


def build_shifts_list(shifts: list[date]) -> str:
    if not shifts:
        return "📋 Kayıtlı vardiya günü yok.\n/vardiya\\_ekle YYYY-MM-DD komutuyla ekleyin."
    lines = ["📋 *Yaklaşan vardiya günleri:*", ""]
    for d in shifts:
        lines.append(f"• {format_date_tr(d)}")
    return "\n".join(lines)
