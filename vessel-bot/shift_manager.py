import json
import os
from datetime import date, datetime, timedelta
from config import SHIFTS_FILE


DEFAULT_SHIFT = (8, 16)


def _load_map() -> dict:
    """date_str -> (start_h, end_h). Eski liste formatıyla geriye uyumlu."""
    if not os.path.exists(SHIFTS_FILE):
        return {}
    with open(SHIFTS_FILE, "r") as f:
        raw = json.load(f)
    if isinstance(raw, dict):
        return {k: tuple(v) for k, v in raw.items()}
    # eski format: sadece tarih listesi -> varsayılan vardiya
    return {s: DEFAULT_SHIFT for s in raw}


def _save_map(m: dict):
    with open(SHIFTS_FILE, "w") as f:
        json.dump({k: list(v) for k, v in sorted(m.items())}, f, indent=2)


def add_shift(shift_date: date, start_h: int = 8, end_h: int = 16) -> bool:
    """Vardiya ekle/güncelle. True: yeni eklendi, False: zaten vardı (saat güncellendi)."""
    m = _load_map()
    date_str = shift_date.isoformat()
    is_new = date_str not in m
    m[date_str] = (start_h, end_h)
    _save_map(m)
    return is_new


def remove_shift(shift_date: date) -> bool:
    """Vardiyayı sil. True: silindi, False: bulunamadı."""
    m = _load_map()
    date_str = shift_date.isoformat()
    if date_str not in m:
        return False
    del m[date_str]
    _save_map(m)
    return True


def is_shift_day(check_date: date = None) -> bool:
    """Belirtilen gün (varsayılan: bugün) vardiya günü mü?"""
    if check_date is None:
        check_date = date.today()
    return check_date.isoformat() in _load_map()


def get_shift_hours(check_date: date) -> tuple | None:
    """O günün vardiya saatleri (start_h, end_h) ya da None."""
    return _load_map().get(check_date.isoformat())


def get_upcoming_shifts(days: int = 30) -> list[date]:
    """Önümüzdeki N gün içindeki vardiyaları döner."""
    today = date.today()
    limit = today + timedelta(days=days)
    result = [date.fromisoformat(s) for s in _load_map()]
    return sorted(d for d in result if today <= d <= limit)


def get_all_shifts() -> list[date]:
    """Tüm vardiya günlerini döner."""
    return [date.fromisoformat(s) for s in sorted(_load_map())]


TURKISH_DAYS = {
    0: "Pazartesi", 1: "Salı", 2: "Çarşamba", 3: "Perşembe",
    4: "Cuma", 5: "Cumartesi", 6: "Pazar"
}

TURKISH_MONTHS = {
    1: "Ocak", 2: "Şubat", 3: "Mart", 4: "Nisan", 5: "Mayıs",
    6: "Haziran", 7: "Temmuz", 8: "Ağustos", 9: "Eylül",
    10: "Ekim", 11: "Kasım", 12: "Aralık"
}


def format_date_tr(d: date) -> str:
    return f"{d.day} {TURKISH_MONTHS[d.month]} {d.year} {TURKISH_DAYS[d.weekday()]}"
