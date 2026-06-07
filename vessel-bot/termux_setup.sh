#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# Asya Port Vardiya Botu - Termux Kurulum Scripti
# ============================================================
# Termux'ta çalıştırın:
#   bash termux_setup.sh
# ============================================================

set -e

echo ""
echo "======================================================"
echo "  Asya Port Vardiya Botu - Termux Kurulum"
echo "======================================================"
echo ""

# Termux paketleri
echo "[1/4] Termux paketleri kuruluyor..."
pkg update -y -q
pkg install -y python python-pip openssl-tool 2>/dev/null
echo "  ✓ Python kuruldu"

# Python bağımlılıkları
echo ""
echo "[2/4] Python kütüphaneleri kuruluyor..."
pip install -q python-telegram-bot==20.7 requests beautifulsoup4 apscheduler pytz lxml
echo "  ✓ Kütüphaneler kuruldu"

# .env dosyası
echo ""
echo "[3/4] Bot yapılandırması..."

BOT_DIR="$HOME/vessel-bot"
mkdir -p "$BOT_DIR"
cd "$BOT_DIR"

if [ ! -f ".env" ]; then
    echo ""
    echo "  BotFather'dan aldığınız token'ı girin:"
    read -r TOKEN
    echo ""
    echo "  Telegram Chat ID'nizi girin"
    echo "  (Botu başlatıp /start yazınca öğreneceksiniz - şimdi boş bırakabilirsiniz):"
    read -r CHAT_ID

    cat > .env << EOF
TELEGRAM_BOT_TOKEN=$TOKEN
TELEGRAM_CHAT_ID=$CHAT_ID
# Flash uygulamasının veri URL'i (discover_endpoint.py ile bulun)
# PORT_DATA_URL=http://195.142.119.165:9120/report/berth/getBerthData.do
EOF
    echo "  ✓ .env dosyası oluşturuldu"
else
    echo "  ✓ .env zaten mevcut"
fi

# Termux:Boot otomatik başlatma
echo ""
echo "[4/4] Otomatik başlatma ayarlanıyor..."
BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"

cat > "$BOOT_DIR/start-vessel-bot.sh" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Telefon açıldığında botu başlat
cd ~/vessel-bot
source .env
export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID PORT_DATA_URL

# Arka planda çalıştır, logları kaydet
nohup python bot.py >> bot.log 2>&1 &
echo "Bot başlatıldı: PID=$!"
EOF
chmod +x "$BOOT_DIR/start-vessel-bot.sh"
echo "  ✓ Termux:Boot scripti oluşturuldu"

echo ""
echo "======================================================"
echo "  Kurulum tamamlandı!"
echo "======================================================"
echo ""
echo "  Sıradaki adımlar:"
echo ""
echo "  1. Botu başlatın:"
echo "     cd ~/vessel-bot && python bot.py"
echo ""
echo "  2. Telegram'da bota /start yazın → Chat ID'yi öğrenin"
echo "     .env dosyasına TELEGRAM_CHAT_ID=... olarak ekleyin"
echo ""
echo "  3. Liman WiFi'sindeyken endpoint'i keşfedin:"
echo "     python discover_endpoint.py"
echo ""
echo "  4. Vardiya günlerinizi ekleyin:"
echo "     Telegram botunda: /vardiya_ekle 2026-06-08"
echo ""
echo "  5. Termux:Boot uygulamasını Play Store'dan yükleyin"
echo "     (Bot telefon açıldığında otomatik başlar)"
echo ""
echo "  6. Termux'u arka planda açık tutun (pil optimizasyonunu kapatın)"
echo "======================================================"
