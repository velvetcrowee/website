#!/usr/bin/env python3
"""
Flash uygulamasının kullandığı veri endpoint'ini bulur.

KULLANIM:
  1. Telefonu liman WiFi'sine bağlayın
  2. Termux'ta çalıştırın:
       python discover_endpoint.py

  Script, Flash uygulamasının çağırdığı olası URL'leri dener
  ve başarılı olanı ekrana yazdırır. Bulunan URL'i config.py'deki
  DATA_URL satırına yazın (veya .env'e PORT_DATA_URL=... olarak).

ALTERNATIF (HTTP Toolkit ile):
  1. F-Droid veya apktool üzerinden HTTP Toolkit yükleyin
  2. HTTP Toolkit'te "Android" modunu başlatın
  3. Puffin'de berth chart sayfasını açın
  4. HTTP Toolkit'te "berth", "xml", "data" içeren isteklere bakın
"""

import re
import sys
import json
import requests
from datetime import date
from bs4 import BeautifulSoup

BASE = "http://195.142.119.165:9120"
TIMEOUT = 8

s = requests.Session()
s.headers.update({
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120",
    "Accept": "text/xml,application/xml,text/html,*/*",
    "Accept-Language": "tr-TR,tr;q=0.9",
    "Referer": f"{BASE}/eServicePage.do?menuName=report/berth/BerthAllocationChart&webuserid=",
})

today = date.today()
ds = today.strftime("%Y%m%d")
y, m, d = today.year, f"{today.month:02d}", f"{today.day:02d}"


def probe(url, params=None, label="") -> requests.Response | None:
    try:
        r = s.get(url, params=params, timeout=TIMEOUT)
        if r.status_code == 200 and len(r.text.strip()) > 50:
            ct = r.headers.get("Content-Type", "")
            txt = r.text.strip()[:300].replace("\n", " ")
            print(f"\n  ✅  {label or url}")
            print(f"      HTTP 200 | {ct}")
            print(f"      İçerik:  {txt}")
            return r
        elif r.status_code != 404:
            print(f"  ·  {(label or url)[:60]}  → HTTP {r.status_code}")
    except requests.exceptions.ConnectionError:
        print(f"  ✗  BAĞLANTI HATASI — Liman WiFi'sine bağlı mısınız?")
        sys.exit(1)
    except Exception as e:
        print(f"  ·  {(label or url)[:60]}  → {e}")
    return None


print("=" * 65)
print("  Asya Port Endpoint Keşif Aracı")
print(f"  Sunucu: {BASE}")
print(f"  Tarih:  {today}")
print("=" * 65)

found = []

# ── 1. Ana sayfa analizi ──────────────────────────────────────────────────────
print("\n[1/3] Ana sayfa analiz ediliyor...")
r = probe(f"{BASE}/eServicePage.do", {
    "menuName": "report/berth/BerthAllocationChart",
    "webuserid": "",
}, "Ana sayfa")

if r:
    soup = BeautifulSoup(r.text, "html.parser")

    # Flash embed ve SWF parametreleri
    for tag in soup.find_all(["object", "embed", "param"]):
        for attr in ["src", "data", "value", "flashvars"]:
            val = str(tag.get(attr, ""))
            if not val or val == "None":
                continue
            if any(k in val.lower() for k in ("swf", "berth", "data", "xml", "chart")):
                print(f"\n  📌 Flash parametre [{attr}]: {val[:200]}")
                m_url = re.search(r"(?:dataURL|xmlURL|serviceURL|dataUrl)=([^&\"'\s]+)", val)
                if m_url:
                    found.append(("flashvars", m_url.group(1)))

    # Script içi URL'ler
    for script in soup.find_all("script"):
        if not script.string:
            continue
        urls = re.findall(r'["\']([^"\']*\.(?:do|xml|json|jsp|action)[^"\']*)["\']', script.string)
        for u in set(urls):
            if any(k in u.lower() for k in ("berth", "vessel", "chart", "data")):
                print(f"  📌 Script URL: {u}")
                found.append(("script", u))

    # iframe
    for iframe in soup.find_all("iframe"):
        src = iframe.get("src", "")
        if src:
            print(f"  📌 iframe: {src}")

# ── 2. Yaygın endpoint kalıpları ─────────────────────────────────────────────
print(f"\n[2/3] Veri endpoint kalıpları deneniyor (tarih: {ds})...")

candidates = [
    (f"{BASE}/report/berth/BerthAllocationChartData.do", {"date": ds},          "Chart Data 1"),
    (f"{BASE}/report/berth/getBerthData.do",             {"date": ds},          "Get Berth Data"),
    (f"{BASE}/report/berth/BerthAllocationChart.do",     {"date": ds},          "Chart .do"),
    (f"{BASE}/BerthAllocationChartData.do",              {"date": ds},          "Root Chart Data"),
    (f"{BASE}/report/berth/vesselList.do",               {"date": ds},          "Vessel List"),
    (f"{BASE}/report/berth/berthList.do",                {"date": ds},          "Berth List"),
    (f"{BASE}/eServicePage.do", {"menuName": "report/berth/BerthAllocationChart",
                                  "date": ds, "format": "xml", "webuserid": ""},  "eService XML"),
    (f"{BASE}/eServicePage.do", {"menuName": "report/berth/BerthAllocationChartData",
                                  "date": ds, "webuserid": ""},                    "eService Data"),
    (f"{BASE}/report/berth/BerthAllocationChart.do", {"year": y, "month": m, "day": d}, "Chart y/m/d"),
    (f"{BASE}/xml/BerthAllocationChart.xml",         {"date": ds},              "XML dosyası"),
    (f"{BASE}/xml/berth.xml",                        {"date": ds},              "XML berth"),
    (f"{BASE}/BerthChart.do",                        {"date": ds},              "BerthChart"),
    (f"{BASE}/servlet/BerthData",                    {"date": ds},              "Servlet"),
    (f"{BASE}/api/berth/chart",                      {"date": ds},              "REST API"),
    (f"{BASE}/api/vessel/schedule",                  {"date": ds},              "Vessel Schedule"),
    (f"{BASE}/data/berth",                           {"date": ds},              "Data/berth"),
]

for url, params, label in candidates:
    r = probe(url, params, label)
    if r:
        found.append((label, url + "?" + "&".join(f"{k}={v}" for k, v in params.items())))

# ── 3. SWF dosyası ────────────────────────────────────────────────────────────
print("\n[3/3] SWF dosyası aranıyor...")
swf_paths = [
    "/swf/BerthAllocationChart.swf",
    "/flash/BerthAllocationChart.swf",
    "/BerthAllocationChart.swf",
    "/web/BerthAllocationChart.swf",
    "/eService/BerthAllocationChart.swf",
    "/resources/BerthAllocationChart.swf",
    "/static/BerthAllocationChart.swf",
]
for path in swf_paths:
    try:
        r = s.head(f"{BASE}{path}", timeout=5)
        if r.status_code == 200:
            size = r.headers.get("Content-Length", "?")
            print(f"\n  ✅  SWF bulundu: {BASE}{path}  ({size} byte)")
            print("      SWF'i indirip JPEXS (FFDec) ile açarsanız tüm URL'leri görebilirsiniz.")
            found.append(("SWF", f"{BASE}{path}"))
    except Exception:
        pass

# ── Sonuç ─────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
if found:
    print(f"\n✅  {len(found)} şey bulundu:\n")
    for label, url in found:
        print(f"  [{label}]  {url}")
    print(f"""
⚙️  Yapılandırma:
   .env dosyasına şunu ekleyin:
   PORT_DATA_URL={found[0][1]}

   Veya config.py içinde:
   DATA_URL = "{found[0][1]}"
""")
else:
    print("""
❌  Otomatik bulunamadı.

Seçenekler:

1. HTTP Toolkit ile manuel bulma:
   - Play Store'dan "HTTP Toolkit" indirin (ücretsiz)
   - "Android (port forward)" modunu seçin
   - Puffin'de berth chart sayfasını açın
   - HTTP Toolkit'te gelen isteklere bakın
   - "berth", "xml", "data", "vessel" içerenleri not edin

2. Manuel gemi girişi:
   - Telegram botunda /gemi_ekle komutunu kullanın
   - Her gün vardiyadan önce gemileri girin

3. Liman IT'ye sorun:
   - Flash uygulamasının hangi URL'den veri çektiğini öğrenin
""")
print("=" * 65)
