#!/data/data/com.termux/files/usr/bin/python3
"""
Asya Port Customer Services - Yanasma Programı Endpoint Bulucu
Termux'ta çalıştırın: python3 asya_public.py
"""

import sys, re, json
from datetime import date

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4", "-q"])
    import requests
    from bs4 import BeautifulSoup

BASE    = "https://customerservices.asyaport.com:9133"
ESVC    = f"{BASE}/esvc"
TODAY   = date.today().strftime("%Y%m%d")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120",
    "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
}

s = requests.Session()
s.headers.update(HEADERS)
s.verify = False  # Self-signed SSL olabilir
import urllib3; urllib3.disable_warnings()

print()
print("=" * 60)
print("  Asya Port Yanasma Programı - Endpoint Bulucu")
print(f"  {BASE}")
print("=" * 60)

# ── 1. Ana sayfa ──────────────────────────────────────────────
print("\n[1] Ana sayfa yükleniyor...")
try:
    r = s.get(ESVC + "/", timeout=15)
    print(f"  HTTP {r.status_code} | {len(r.content)} byte")
except Exception as e:
    try:
        r = s.get(ESVC, timeout=15)
        print(f"  HTTP {r.status_code} | {len(r.content)} byte")
    except Exception as e2:
        print(f"  ❌ Bağlantı hatası: {e2}")
        sys.exit(1)

soup = BeautifulSoup(r.text, "html.parser")

# Tüm linkleri bul
print("\n  Sayfadaki linkler:")
links = []
for a in soup.find_all("a", href=True):
    href = a["href"]
    text = a.get_text(strip=True)
    if text or href:
        print(f"    [{text}] → {href}")
        links.append((text, href))

# Script içi URL'ler
print("\n  Script içindeki URL'ler:")
for script in soup.find_all("script"):
    src = script.get("src", "")
    if src:
        print(f"    script src: {src}")
    if script.string:
        found_urls = re.findall(
            r'["\']([^"\']+(?:berth|vessel|yanasma|program|chart|esvc)[^"\']*)["\']',
            script.string, re.I
        )
        for u in set(found_urls):
            print(f"    inline: {u}")

# iframe ve embed
for tag in soup.find_all(["iframe", "frame", "embed", "object"]):
    for attr in ["src", "data"]:
        val = tag.get(attr, "")
        if val:
            print(f"    {tag.name}[{attr}]: {val}")

print("\n  İlk 2000 karakter:")
print(r.text[:2000])

# ── 2. "Yanasma" veya "Berth" içeren link bul ve takip et ──
print("\n\n[2] Yanasma programı linki takip ediliyor...")
berth_links = [
    (t, h) for t, h in links
    if any(k in (t+h).lower() for k in ("yanasma", "berth", "program", "chart", "schedule"))
]

for text, href in berth_links:
    if not href.startswith("http"):
        href = ESVC + "/" + href.lstrip("/")
    print(f"\n  → [{text}] {href}")
    try:
        r2 = s.get(href, timeout=15)
        print(f"    HTTP {r2.status_code} | {len(r2.content)} byte")
        print(f"    Content-Type: {r2.headers.get('Content-Type','?')}")
        print(f"    İçerik (ilk 1000):")
        print(r2.text[:1000])

        # Bu sayfadaki SWF / data URL ara
        swfs = re.findall(r'["\']([^"\']*\.swf[^"\']*)["\']', r2.text, re.I)
        data_urls = re.findall(
            r'["\']([^"\']*(?:data|xml|berth|vessel|chart|yanasma)[^"\']*\.(?:do|xml|json|jsp|action)[^"\']*)["\']',
            r2.text, re.I
        )
        if swfs:
            print(f"\n    📌 SWF: {swfs}")
        if data_urls:
            print(f"\n    📌 Data URL'leri: {data_urls}")
    except Exception as e:
        print(f"    ❌ {e}")

# ── 3. Direkt data endpoint tahminleri ───────────────────────
print("\n\n[3] Direkt data endpoint'leri deneniyor...")

candidates = [
    f"{ESVC}/report/berth/BerthAllocationChartData.do?date={TODAY}",
    f"{ESVC}/report/berth/getBerthData.do?date={TODAY}",
    f"{ESVC}/report/berth/BerthAllocationChart.do?date={TODAY}",
    f"{ESVC}/report/berth/vesselList.do?date={TODAY}",
    f"{ESVC}/eServicePage.do?menuName=report/berth/BerthAllocationChart&webuserid=",
    f"{BASE}/esvc/report/berth/berthData.xml?date={TODAY}",
    f"{BASE}/esvc/xml/BerthAllocationChart.xml?date={TODAY}",
    f"{BASE}/esvc/api/berth?date={TODAY}",
    f"{BASE}/esvc/BerthAllocationChart.do?date={TODAY}",
    f"{ESVC}/yanasma?date={TODAY}",
    f"{ESVC}/berth?date={TODAY}",
]

found = []
for url in candidates:
    try:
        r3 = s.get(url, timeout=8)
        if r3.status_code == 200 and len(r3.text.strip()) > 50:
            body = r3.text.strip()
            is_data = (
                body.startswith("<") and any(k in body.lower()
                    for k in ("vessel", "berth", "ship", "gemi", "alloc")) or
                body[0] in "{[" and len(body) > 100
            )
            mark = "✅" if is_data else "⚠️"
            print(f"  {mark} HTTP {r3.status_code} | {len(r3.content)} byte")
            print(f"     {url}")
            print(f"     {body[:200].replace(chr(10),' ')}")
            if is_data:
                found.append(url)
        else:
            print(f"  · HTTP {r3.status_code} {url.split('/')[-1][:50]}")
    except Exception as e:
        print(f"  · ERR {url.split('/')[-1][:40]}: {e}")

# ── Sonuç ─────────────────────────────────────────────────────
print("\n" + "=" * 60)
if found:
    print(f"✅ Veri endpoint bulundu!\n")
    for u in found:
        print(f"   {u}")
    print(f"\n.env'e ekleyin:\n   PORT_DATA_URL={found[0]}")
else:
    print("ℹ️  Otomatik bulunamadı.")
    print("Lütfen tüm çıktıyı Claude'a yapıştırın.")
print("=" * 60)
