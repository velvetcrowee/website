#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# Hızlı Test - Termux'ta direkt çalıştırın
# Sunucuya erişimi test eder ve endpoint'i arar
# ============================================================
# Termux'ta:
#   curl -sL https://raw.githubusercontent.com/velvetcrowee/website/claude/port-vessel-telegram-bot-qQa8D/vessel-bot/hizli_test.sh | bash
# ============================================================

BASE="http://195.142.119.165:9120"
TODAY=$(date +%Y%m%d)

echo ""
echo "======================================================"
echo "  Asya Port Sunucu Testi"
echo "======================================================"
echo ""

# 1. Bağlantı testi
echo "→ Sunucuya bağlanılıyor..."
HTTP_CODE=$(curl -s -o /tmp/asya_ana.html -w "%{http_code}" \
  --max-time 15 \
  -H "User-Agent: Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36" \
  "$BASE/eServicePage.do?menuName=report/berth/BerthAllocationChart&webuserid=")

if [ "$HTTP_CODE" = "200" ]; then
  echo "  ✅ Bağlantı başarılı! (HTTP 200)"
  echo ""
  echo "  Sayfa boyutu: $(wc -c < /tmp/asya_ana.html) byte"
  echo ""
  echo "  İlk 500 karakter:"
  echo "  ---"
  head -c 500 /tmp/asya_ana.html
  echo ""
  echo "  ---"
else
  echo "  ❌ Bağlantı hatası (HTTP $HTTP_CODE)"
  echo "  İnternet bağlantısını kontrol edin."
  exit 1
fi

# Flash/SWF URL ara
echo ""
echo "→ SWF dosyası aranıyor..."
SWF=$(grep -oi 'src="[^"]*\.swf[^"]*"' /tmp/asya_ana.html | head -1 || true)
if [ -n "$SWF" ]; then
  echo "  ✅ SWF bulundu: $SWF"
fi

# 2. Yaygın data endpoint'leri dene
echo ""
echo "→ Veri endpoint'leri deneniyor..."
echo ""

try_url() {
  local URL="$1"
  local LABEL="$2"
  local CODE
  CODE=$(curl -s -o /tmp/asya_test.txt -w "%{http_code}" --max-time 8 \
    -H "User-Agent: Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36" \
    -H "Referer: $BASE/eServicePage.do?menuName=report/berth/BerthAllocationChart&webuserid=" \
    "$URL")

  if [ "$CODE" = "200" ]; then
    SIZE=$(wc -c < /tmp/asya_test.txt)
    if [ "$SIZE" -gt 50 ]; then
      echo "  ✅ $LABEL"
      echo "     URL: $URL"
      echo "     Boyut: $SIZE byte"
      echo "     İçerik: $(head -c 200 /tmp/asya_test.txt | tr -d '\n')"
      echo ""
      echo "PORT_DATA_URL=$URL" >> /tmp/bulunan_url.txt
      return 0
    fi
  fi
  return 1
}

rm -f /tmp/bulunan_url.txt

try_url "$BASE/report/berth/BerthAllocationChartData.do?date=$TODAY"  "Chart Data 1"
try_url "$BASE/report/berth/getBerthData.do?date=$TODAY"              "getBerthData"
try_url "$BASE/report/berth/BerthAllocationChart.do?date=$TODAY"      "Chart .do"
try_url "$BASE/BerthAllocationChartData.do?date=$TODAY"               "Root Chart"
try_url "$BASE/report/berth/vesselList.do?date=$TODAY"                "Vessel List"
try_url "$BASE/eServicePage.do?menuName=report/berth/BerthAllocationChartData&date=$TODAY&webuserid=" "eService Data"
try_url "$BASE/xml/BerthAllocationChart.xml?date=$TODAY"              "XML"
try_url "$BASE/api/berth/chart?date=$TODAY"                           "REST API"
try_url "$BASE/report/berth/berthData.do?date=$TODAY"                 "berthData"
try_url "$BASE/BerthChart.do?date=$TODAY"                             "BerthChart"

echo ""
echo "======================================================"
if [ -f /tmp/bulunan_url.txt ]; then
  echo "  ✅ ENDPOINT BULUNDU!"
  echo ""
  cat /tmp/bulunan_url.txt
  echo ""
  echo "  Bu satırı vessel-bot/.env dosyasına ekleyin:"
  head -1 /tmp/bulunan_url.txt
else
  echo "  ℹ️  Otomatik endpoint bulunamadı."
  echo ""
  echo "  Sonraki adım: HTTP Toolkit ile manuel bul"
  echo "  (aşağıdaki talimatlar için README'ye bakın)"
fi
echo "======================================================"
echo ""
echo "→ Ham sayfa kaydedildi: /tmp/asya_ana.html"
echo "   Tüm içeriği görmek için: cat /tmp/asya_ana.html"
