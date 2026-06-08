from datetime import date, datetime, timedelta
from scraper import BerthEntry
from shift_manager import format_date_tr, get_shift_hours


def _t(dt_iso: str | None) -> str:
    """Tam tarih-saat: 'GG/AA SS:DD' (detay görünümü için)."""
    if not dt_iso:
        return "?"
    try:
        dt = datetime.fromisoformat(dt_iso)
        return dt.strftime("%d/%m %H:%M")
    except Exception:
        return dt_iso


def _date_short(d: date) -> str:
    """'8 Haziran Pazartesi' — yıl olmadan (kompakt başlık)."""
    return format_date_tr(d).replace(f" {d.year}", "")


def _hm(dt_iso: str | None, ref: date | None) -> str:
    """Aynı günse 'SS:DD'; farklı günse 'GG/AA SS:DD'."""
    if not dt_iso:
        return "?"
    try:
        dt = datetime.fromisoformat(dt_iso)
    except Exception:
        return dt_iso
    if ref is not None and dt.date() != ref:
        return dt.strftime("%d/%m %H:%M")
    return dt.strftime("%H:%M")


def _status_emoji(e: BerthEntry) -> str:
    st = (e.status or "").upper()
    if st.startswith("ARRIV"):
        return "🟢"   # gelmiş / yanaşmış
    if st.startswith("PLAN"):
        return "🟡"   # planlı
    if st.startswith("DEPAT") or st.startswith("DEPART"):
        return "⚪"   # gitmiş
    return "•"


def _cargo_short(e: BerthEntry) -> str:
    """'📦L/T' (yük/tahliye). İkisi de boşsa boş döner."""
    if not (e.load_van or e.dis_van):
        return ""
    return f"📦{e.load_van or '0'}/{e.dis_van or '0'}"


def _int(s) -> int:
    try:
        return int(str(s).strip())
    except (ValueError, AttributeError):
        return 0


def _summary(*groups: list[BerthEntry]) -> str:
    """Özet: benzersiz gemi sayısı, toplam yük/tahliye, en yoğun rıhtım."""
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
        parts.append(f"🏗 {berths.most_common(1)[0][0]}")
    return " · ".join(parts)


def _row(e: BerthEntry, ref: date | None, mode: str = "range") -> str:
    """Tek satır gemi: '🟢 *AD* · RIH · saat · 📦L/T'.

    mode: 'range' (geliş→çıkış), 'arr' (sadece geliş), 'dep' (sadece çıkış).
    """
    seg = [f"{_status_emoji(e)} *{e.ship_name}*"]
    if e.berth:
        seg.append(e.berth)
    if mode == "arr":
        seg.append(_hm(e.arrival, ref))
    elif mode == "dep":
        seg.append(_hm(e.departure, ref))
    else:
        seg.append(f"{_hm(e.arrival, ref)}→{_hm(e.departure, ref)}")
    cargo = _cargo_short(e)
    if cargo:
        seg.append(cargo)
    return " · ".join(seg)


def build_shift_message(report: dict) -> str:
    d: date                    = report["date"]
    source: str                = report["source"]
    start_h: int               = report.get("start_h", 8)
    end_h: int                 = report.get("end_h", 16)
    at_port: list[BerthEntry]  = report.get("at_port",   [])
    departing: list[BerthEntry]= report.get("departing", [])
    arriving: list[BerthEntry] = report.get("arriving",  [])

    lines = [
        "🚢 *Asya Port Vardiya Raporu*",
        f"📅 {_date_short(d)} · {start_h:02d}:00–{end_h:02d}:00",
    ]

    if source == "no_data":
        lines += [
            "",
            "⚠️ Veri çekilemedi.",
            "",
            "• /prefetch — veriyi çek",
            "• /gemi\\_ekle — manuel gir",
        ]
        return "\n".join(lines)

    if source == "cache":
        lines.append("_(kayıtlı veri)_")

    if not at_port and not departing and not arriving:
        lines.append("")
        lines.append("✅ Bu vardiyada limanda gemi yok.")
        return "\n".join(lines)

    summary = _summary(at_port, departing, arriving)
    if summary:
        lines.append(summary)

    if at_port:
        lines.append("")
        lines.append(f"⚓ *LİMANDA ({len(at_port)})*")
        lines += [_row(e, d, "range") for e in at_port]

    lines.append("")
    if departing:
        lines.append(f"🔴 *AYRILACAK ({len(departing)})*")
        lines += [_row(e, d, "dep") for e in departing]
    else:
        lines.append("🔴 *AYRILACAK* — yok")

    if arriving:
        lines.append("")
        lines.append(f"🟢 *GELECEK ({len(arriving)})*")
        lines += [_row(e, d, "arr") for e in arriving]

    return "\n".join(lines)


def build_ship_detail(e: BerthEntry) -> str:
    """Tek gemi için tüm detay (/gemi)."""
    lines = [f"{_status_emoji(e)} *{e.ship_name}*"]
    if e.berth:   lines.append(f"⚓ Rıhtım: {e.berth}")
    if e.status:  lines.append(f"📍 Durum: {e.status}")
    lines.append(f"🟢 Yanaşma: {_t(e.arrival)}")
    lines.append(f"🔴 Kalkış: {_t(e.departure)}")
    if e.load_van or e.dis_van:
        lines.append(f"📦 {e.load_van or '0'} yük / {e.dis_van or '0'} tahliye")
    if e.service: lines.append(f"🛳 Servis: {e.service}")
    if e.agent:   lines.append(f"🏢 Operatör: {e.agent}")
    if e.length:  lines.append(f"📏 Boy: {e.length} m")
    if e.voyage:  lines.append(f"🧭 Sefer: {e.voyage}")
    return "\n".join(lines)


def build_ship_list(title: str, d: date, entries: list[BerthEntry]) -> str:
    """Başlıklı düz gemi listesi (/simdi, arama sonuçları)."""
    if not entries:
        return f"{title}\n_(gemi yok)_"
    lines = [f"{title} · {len(entries)} gemi", ""]
    lines += [_row(e, d, "range") for e in entries]
    return "\n".join(lines)


def build_berth_view(d: date, berth: str, entries: list[BerthEntry]) -> str:
    """Belirli rıhtımdaki gemiler, yanaşma saatine göre sıralı (/rihtim)."""
    sel = [e for e in entries if e.berth.upper() == berth.upper()]
    sel.sort(key=lambda e: e.arrival or "")
    if not sel:
        return f"⚓ *{berth.upper()}* — bu rıhtımda gemi yok ({_date_short(d)})."
    lines = [f"⚓ *Rıhtım {berth.upper()}* · {_date_short(d)} · {len(sel)} gemi", ""]
    lines += [_row(e, d, "range") for e in sel]
    return "\n".join(lines)


def build_day_overview(d: date, entries: list[BerthEntry]) -> str:
    """Bir günün tüm gün-boyu gemileri (vardiya filtresi yok), yanaşma sırasına göre."""
    start = datetime.combine(d, datetime.min.time())
    end = start + timedelta(days=1)
    seen = {}
    for e in entries:
        if e.is_active_during(start, end):
            seen.setdefault(e.ship_name, e)
    day = sorted(seen.values(), key=lambda e: e.arrival or "")
    head = f"📅 *{_date_short(d)} — gün boyu* ({len(day)} gemi)"
    if not day:
        return head + "\n_(gemi yok)_"
    lines = [head]
    summary = _summary(day, [], [])
    if summary:
        lines.append(summary)
    lines.append("")
    lines += [_row(e, d, "range") for e in day]
    return "\n".join(lines)


def build_diff_message(d: date, diff: dict) -> str:
    """Cache ile canlı veri arasındaki fark (/degisiklik, prefetch uyarısı)."""
    added   = diff.get("added", [])
    removed = diff.get("removed", [])
    changed = diff.get("changed", [])
    if not (added or removed or changed):
        return f"✅ {_date_short(d)} — değişiklik yok."

    lines = [f"🔔 *{_date_short(d)} — değişiklikler*", ""]
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
        lines += [_row(e, d, "range") for e in added]
        lines.append("")
    if removed:
        lines.append("⚪ *Listeden çıkan:*")
        lines += [f"• *{e.ship_name}* ({e.berth})" for e in removed]
        lines.append("")
    return "\n".join(lines).rstrip()


def build_shifts_list(shifts: list[date]) -> str:
    if not shifts:
        return "📋 Kayıtlı vardiya yok.\n/vardiya\\_ekle YYYY-MM-DD ile ekleyin."
    lines = ["📋 *Yaklaşan vardiyalar:*", ""]
    for d in shifts:
        h = get_shift_hours(d)
        suffix = f" · {h[0]:02d}:00–{h[1]:02d}:00" if h else ""
        lines.append(f"• {format_date_tr(d)}{suffix}")
    return "\n".join(lines)
