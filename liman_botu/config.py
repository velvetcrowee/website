"""
config.py — Merkezi yapılandırma.

Tüm gizli anahtarlar ve ayarlar .env dosyasından buraya okunur.
Hiçbir modül os.getenv'i doğrudan çağırmaz; herkes buradan import eder.
Böylece bir ayarı değiştireceğin zaman tek bir yere bakman yeter.
"""

import os
from dotenv import load_dotenv

# .env dosyasını (bu dosyanın yanındaki) belleğe yükle.
load_dotenv()

# --- Telegram ---
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")

# "111,222" -> {111, 222}. Boşsa herkese açık (filtre uygulanmaz).
_raw_ids = os.getenv("ALLOWED_USER_IDS", "").strip()
ALLOWED_USER_IDS = {
    int(uid) for uid in _raw_ids.split(",") if uid.strip().isdigit()
} if _raw_ids else set()

# --- API Anahtarları ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "")

# --- Obsidian ---
OBSIDIAN_MEDYA_PATH = os.getenv("OBSIDIAN_MEDYA_PATH", "./vault/Medya")

# Gemini için kullanılacak model (kotayı korumak adına hızlı/ucuz olanı).
GEMINI_MODEL = "gemini-1.5-flash"


def dogrula() -> None:
    """Bot açılmadan önce kritik ayarlar var mı diye bakar, yoksa patlar."""
    if not TELEGRAM_TOKEN:
        raise RuntimeError("TELEGRAM_TOKEN eksik. .env dosyanı kontrol et.")
