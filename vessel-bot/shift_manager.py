import json
import os
from datetime import date, datetime, timedelta
from config import SHIFTS_FILE


def _load():
    if not os.path.exists(SHIFTS_FILE):
        return []
    with open(SHIFTS_FILE, "r") as f:
        return json.load(f)


def _save(shifts):
    with open(SHIFTS_FILE, "w") as f:
        json.dump(shifts, f, indent=2)


def add_shift(shift_date: date) -> bool:
    """Vardiya ekle. True: yeni eklendi, False: zaten vardı."""
    shifts = _load()
    date_str = shift_date.isoformat()
    if date_str in shifts:
        return False
    shifts.append(date_str)
    shifts.sort()
    _save(shifts)
    return True


def remove_shift(shift_date: date) -> bool:
    """Vardiyayı sil. True: silindi, False: bulunamadı."""
    shifts = _load()
    date_str = shift_date.isoformat()
    if date_str not in shifts:
        return False
    shifts.remove(date_str)
    _save(shifts)
    return True


def is_shift_day(check_date: date = None) -> bool:
    """Belirtilen gün (varsayılan: bugün) vardiya günü mü?"""
    if check_date is None:
        check_date = date.today()
    shifts = _load()
    return check_date.isoformat() in shifts


def get_upcoming_shifts(days: int = 30) -> list[date]:
    """Önümüzdeki N gün içindeki vardiyaları döner."""
    shifts = _load()
    today = date.today()
    limit = today + timedelta(days=days)
    result = []
    for s in shifts:
        d = date.fromisoformat(s)
        if today <= d <= limit:
            result.append(d)
    return sorted(result)


def get_all_shifts() -> list[date]:
    """Tüm vardiya günlerini döner."""
    shifts = _load()
    return [date.fromisoformat(s) for s in sorted(shifts)]


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
