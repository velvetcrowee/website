"""
config.py — Merkezi yapılandırma (BİRLEŞİK).

Hem yeni modüler botun (medya, oyun, hava...) ayarları hem de mevcut
Asya Port liman botunun ayarları burada toplanır. Tüm modüller (hem yeni
moduller/ hem de eski scraper/shift_manager) buradan okur.

Eski liman dosyaları `from config import SHIFTS_FILE` gibi çağrılar yapar;
o isimler aşağıda korunmuştur.
"""

import os

# .env dosyasını otomatik yükle (Windows/Mac/Linux/Termux).
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# =============================================================================
# Telegram
# =============================================================================
# Eski bot TELEGRAM_BOT_TOKEN kullanıyordu; yeni isim TELEGRAM_TOKEN.
# İkisini de kabul ediyoruz (hangisi doluysa).
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("TELEGRAM_TOKEN", "")
BOT_TOKEN = TELEGRAM_TOKEN  # eski koddaki config.BOT_TOKEN referansları için takma ad

# Zamanlanmış bildirimlerin (07:30 sabah raporu) gideceği sohbet.
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# Botu sadece izinli kişiler kullansın. Boşsa herkese açık.
# CHAT_ID doluysa onu otomatik izinli sayarız (tek kullanıcılık pratik kurulum).
_raw_ids = os.getenv("ALLOWED_USER_IDS", "").strip()
ALLOWED_USER_IDS = {
    int(uid) for uid in _raw_ids.split(",") if uid.strip().isdigit()
} if _raw_ids else set()
if not ALLOWED_USER_IDS and CHAT_ID.strip().isdigit():
    ALLOWED_USER_IDS = {int(CHAT_ID)}

# =============================================================================
# Yapay Zeka / API anahtarları (yeni modüller)
# =============================================================================
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-1.5-flash"
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "")
RAWG_API_KEY = os.getenv("RAWG_API_KEY", "")
# Hava durumu Open-Meteo ile çalışır; ANAHTAR GEREKTİRMEZ.

# =============================================================================
# Obsidian klasörleri (yeni modüller)
# =============================================================================
OBSIDIAN_MEDYA_PATH = os.getenv("OBSIDIAN_MEDYA_PATH", "./vault/Medya")
OBSIDIAN_OYUN_PATH = os.getenv("OBSIDIAN_OYUN_PATH", "./vault/Oyunlar")
OBSIDIAN_FINANS_PATH = os.getenv("OBSIDIAN_FINANS_PATH", "./vault/Finans")

# =============================================================================
# Asya Port liman botu ayarları (mevcut/eski sistem)
# =============================================================================
# Asya Port URL'leri
PORT_BASE_URL = "http://195.142.119.165:9120"
BERTH_CHART_PATH = "/eServicePage.do"
DATA_URL = os.getenv("PORT_DATA_URL", "")

# Vardiya saatleri: 08:00 - 16:00
SHIFT_START_HOUR = 8
SHIFT_END_HOUR = 16

# Sabah bildirim saati: 07:30
NOTIFY_HOUR = 7
NOTIFY_MINUTE = 30

# Pre-fetch saati (vardiya biterken ertesi günün verisi çekilir): 18:00
PREFETCH_HOUR = 18
PREFETCH_MINUTE = 0

# Zaman dilimi
TIMEZONE = "Europe/Istanbul"

# Dosya yolları
SHIFTS_FILE = "shifts.json"
CACHE_DIR = "cache"


def dogrula() -> None:
    """Bot açılmadan önce kritik ayarlar var mı diye bakar, yoksa patlar."""
    if not TELEGRAM_TOKEN:
        raise RuntimeError(
            "Telegram token eksik. .env dosyana TELEGRAM_BOT_TOKEN=... ekle."
        )
