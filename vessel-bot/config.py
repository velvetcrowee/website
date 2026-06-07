import os

# Telegram bot token - BotFather'dan alın
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

# Bildirim gönderilecek Telegram chat ID
# Botu başlatıp /start yazınca öğrenebilirsiniz
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# Asya Port URL
PORT_BASE_URL = "http://195.142.119.165:9120"
BERTH_CHART_PATH = "/eServicePage.do"

# Vardiya saatleri (08:00 - 16:00)
SHIFT_START_HOUR = 8
SHIFT_END_HOUR = 16

# Bildirim saati (07:30)
NOTIFY_HOUR = 7
NOTIFY_MINUTE = 30

# Zaman dilimi
TIMEZONE = "Europe/Istanbul"

# Vardiya takviminizin kaydedileceği dosya
SHIFTS_FILE = "shifts.json"
