from datetime import date, datetime
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


def build_shifts_list(shifts: list[date]) -> str:
    if not shifts:
        return "📋 Kayıtlı vardiya yok.\n/vardiya\\_ekle YYYY-MM-DD ile ekleyin."
    lines = ["📋 *Yaklaşan vardiyalar:*", ""]
    for d in shifts:
        lines.append(f"• {format_date_tr(d)}")
    return "\n".join(lines)
