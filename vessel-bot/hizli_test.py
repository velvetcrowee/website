#!/data/data/com.termux/files/usr/bin/python3
"""
Termux'ta direkt çalıştırın:
  python3 hizli_test.py

curl olmadan, sadece Python requests ile çalışır.
"""

import sys
import json
import re
from datetime import date

try:
    import requests
except ImportError:
    print("requests kuruluyor...")
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

BASE    = "http://195.142.119.165:9120"
TODAY   = date.today().strftime("%Y%m%d")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
    "Accept":     "text/html,application/xml,text/xml,*/*",
    "Accept-Language": "tr-TR,tr;q=0.9",
    "Referer":    f"{BASE}/eServicePage.do?menuName=report/berth/BerthAllocationChart&webuserid=",
}

print()
print("=" * 60)
print("  Asya Port Sunucu Testi")
print("=" * 60)

# ── 1. Ana sayfa ──────────────────────────────────────────────
print("\n[1] Ana sayfaya bağlanılıyor...")
try:
    r = requests.get(
        f"{BASE}/eServicePage.do",
        params={"menuName": "report/berth/BerthAllocationChart", "webuserid": ""},
        headers=HEADERS, timeout=15,
    )
    print(f"  HTTP {r.status_code} | {len(r.content)} byte")
    print(f"  Content-Type: {r.headers.get('Content-Type','?')}")

    body = r.text
    print("\n  --- Sayfa içeriği (ilk 1500 karakter) ---")
    print(body[:1500])
    print("  ---")

    # SWF URL ara
    swf_urls = re.findall(r'["\']([^"\']*\.swf[^"\']*)["\']', body, re.I)
    if swf_urls:
        print(f"\n  📌 SWF dosyaları bulundu:")
        for u in swf_urls:
            print(f"     {u}")

    # data/xml URL ara
    data_urls = re.findall(
        r'["\']([^"\']*(?:data|xml|berth|vessel|chart|service)[^"\']*\.(?:do|xml|json|jsp|action)[^"\']*)["\']',
        body, re.I
    )
    if data_urls:
        print(f"\n  📌 Veri URL'leri bulundu:")
        for u in set(data_urls):
            print(f"     {u}")

except requests.exceptions.ConnectionError as e:
    print(f"\n  ❌ BAĞLANTI HATASI: {e}")
    print("  Sunucu erişilemiyor.")
    sys.exit(1)
except Exception as e:
    print(f"\n  ❌ HATA: {e}")
    sys.exit(1)

# ── 2. Veri endpoint kalıpları ────────────────────────────────
print("\n\n[2] Veri endpoint'leri aranıyor...")

found = []

def probe(label, url, params=None):
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=8)
        if r.status_code == 200 and len(r.text.strip()) > 50:
            content = r.text.strip()
            # Gerçek veri mi yoksa login/hata sayfası mı?
            is_data = (
                content.startswith("<") and any(k in content.lower()
                    for k in ("vessel", "berth", "ship", "gemi", "rıhtım", "alloc")) or
                content.startswith("[") or
                (content.startswith("{") and "vessel" in content.lower())
            )
            status = "✅" if is_data else "⚠️ (HTML/hata?)"
            print(f"  {status} {label}")
            print(f"     URL: {r.url}")
            print(f"     Boyut: {len(r.content)} byte")
            print(f"     İçerik: {content[:300].replace(chr(10),' ')}")
            print()
            if is_data:
                found.append(r.url)
            return r
    except Exception as e:
        print(f"  · {label}: {e}")
    return None

probe("Chart Data 1",  f"{BASE}/report/berth/BerthAllocationChartData.do", {"date": TODAY})
probe("getBerthData",  f"{BASE}/report/berth/getBerthData.do",             {"date": TODAY})
probe("Chart .do",     f"{BASE}/report/berth/BerthAllocationChart.do",     {"date": TODAY})
probe("Root Chart",    f"{BASE}/BerthAllocationChartData.do",              {"date": TODAY})
probe("Vessel List",   f"{BASE}/report/berth/vesselList.do",               {"date": TODAY})
probe("Berth List",    f"{BASE}/report/berth/berthList.do",                {"date": TODAY})
probe("eService Data", f"{BASE}/eServicePage.do", {
    "menuName": "report/berth/BerthAllocationChartData",
    "date": TODAY, "webuserid": "",
})
probe("XML",           f"{BASE}/xml/BerthAllocationChart.xml",             {"date": TODAY})
probe("berthData",     f"{BASE}/report/berth/berthData.do",                {"date": TODAY})
probe("BerthChart",    f"{BASE}/BerthChart.do",                            {"date": TODAY})
probe("vesselInfo",    f"{BASE}/report/berth/vesselInfo.do",               {"date": TODAY})
probe("REST chart",    f"{BASE}/api/berth/chart",                          {"date": TODAY})
probe("REST vessel",   f"{BASE}/api/vessel/schedule",                      {"date": TODAY})

# ── 3. Sonuç ─────────────────────────────────────────────────
print("=" * 60)
if found:
    print(f"\n✅ {len(found)} veri endpoint bulundu!\n")
    for u in found:
        print(f"   {u}")
    print(f"\n.env dosyasına ekleyin:")
    print(f"   PORT_DATA_URL={found[0]}")
else:
    print("\nℹ️  Otomatik veri endpoint bulunamadı.")
    print("\nLütfen yukarıdaki [1] bölümündeki sayfa içeriğini")
    print("kopyalayıp Claude'a yapıştırın — Flash embed parametrelerini")
    print("analiz ederek doğru URL'i bulacağız.")
print("=" * 60)
