import os

# Telegram bot token - BotFather'dan alın
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

# Bildirim gönderilecek Telegram chat ID
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# Asya Port URL
PORT_BASE_URL = "http://195.142.119.165:9120"
BERTH_CHART_PATH = "/eServicePage.do"

# Flash uygulamasının kullandığı gerçek veri URL'i
# discover_endpoint.py çalıştırıp bulduktan sonra buraya yazın.
# Örnek: "http://195.142.119.165:9120/report/berth/getBerthData.do"
DATA_URL = os.getenv("PORT_DATA_URL", "")

# Vardiya saatleri: 08:00 - 16:00
SHIFT_START_HOUR = 8
SHIFT_END_HOUR   = 16

# Sabah bildirim saati: 07:30
NOTIFY_HOUR   = 7
NOTIFY_MINUTE = 30

# Pre-fetch saati: vardiya biterken ertesi günün verisi çekilir
PREFETCH_HOUR   = 18
PREFETCH_MINUTE = 0

# Zaman dilimi
TIMEZONE = "Europe/Istanbul"

# Dosya yolları
SHIFTS_FILE = "shifts.json"
CACHE_DIR   = "cache"
