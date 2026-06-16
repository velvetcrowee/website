"""
engine.py — Android (Chaquopy) için Python motoru.

Kotlin tarafı bu modüldeki fonksiyonları çağırır ve JSON (string) alır.
Tüm "akıl" burada; tüm "görüntü" Kotlin'de. Hiçbir dosya yazılmaz, hiçbir
ekran çizilmez — sadece veri döndürülür (Android'e uygun ayrım).

Bağımlılık: requests  (Chaquopy: pip { install("requests") })
Gemini SDK KULLANILMAZ — doğrudan REST (grpc/SDK derdi yok).

Kotlin'den kullanım örneği (Chaquopy):
    val py = Python.getInstance()
    val engine = py.getModule("engine")
    engine.callAttr("yapilandir", geminiKey, tmdbKey, rawgKey)
    val havaJson = engine.callAttr("hava", "barbaros tekirdağ").toString()
    // havaJson'u org.json ile parse et
"""

import json
from datetime import date, datetime, timedelta

import requests

import liman_gemi_cek  # AMF gemi çekici (aynen korundu)

# ── Çalışma zamanı ayarları (uygulama ayar ekranından gelir) ──────────────────
_AYAR = {"gemini_key": "", "tmdb_key": "", "rawg_key": ""}

_GEMINI_MODELLER = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-flash-latest",
                    "gemini-2.0-flash-001"]
_gemini_calisan = None   # ilk çalışan model önbelleğe alınır


def yapilandir(gemini_key="", tmdb_key="", rawg_key="") -> str:
    """Anahtarları ayarlar. Uygulama açılışında/ayar değişince Kotlin çağırır."""
    _AYAR["gemini_key"] = (gemini_key or "").strip()
    _AYAR["tmdb_key"] = (tmdb_key or "").strip()
    _AYAR["rawg_key"] = (rawg_key or "").strip()
    return _ok({"yapilandirildi": True})


# ── Yardımcılar ───────────────────────────────────────────────────────────────
def _ok(veri):
    return json.dumps({"ok": True, "veri": veri}, ensure_ascii=False)


def _hata(mesaj):
    return json.dumps({"ok": False, "hata": str(mesaj)}, ensure_ascii=False)


# ── Gemini (REST) ─────────────────────────────────────────────────────────────
def _gemini_uret(prompt: str) -> str:
    global _gemini_calisan
    key = _AYAR["gemini_key"]
    if not key:
        raise RuntimeError("Gemini anahtarı girilmemiş (Ayarlar).")
    adaylar = [_gemini_calisan] if _gemini_calisan else _GEMINI_MODELLER
    son_hata = None
    for model in adaylar:
        url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{model}:generateContent?key={key}")
        try:
            r = requests.post(url, json={"contents": [{"parts": [{"text": prompt}]}]},
                              timeout=30)
            if r.status_code == 404:
                son_hata = f"{model}: 404"; continue
            r.raise_for_status()
            data = r.json()
            metin = data["candidates"][0]["content"]["parts"][0]["text"]
            _gemini_calisan = model
            return (metin or "").strip()
        except Exception as e:  # noqa: BLE001
            son_hata = e
    raise RuntimeError(f"Gemini modeli çalışmadı: {son_hata}")


def _gemini_json(prompt: str) -> dict:
    import re
    ham = _gemini_uret(prompt)
    m = re.search(r"\{.*\}", ham, re.DOTALL)
    if not m:
        raise ValueError(f"JSON alınamadı: {ham!r}")
    return json.loads(m.group(0))


def _gemini_cevir(metin: str) -> str:
    if not metin:
        return ""
    return _gemini_uret("Aşağıdaki metni kısa ve akıcı Türkçeye çevir, "
                        "sadece çeviriyi yaz:\n\n" + metin)


# ── TMDB (v3/v4 anahtar otomatik) ─────────────────────────────────────────────
def _tmdb_get(path: str, params: dict):
    key = _AYAR["tmdb_key"]
    if not key:
        raise RuntimeError("TMDB anahtarı girilmemiş (Ayarlar).")
    p = dict(params); headers = {}
    if key.startswith("eyJ") or len(key) > 45:
        headers["Authorization"] = f"Bearer {key}"
    else:
        p["api_key"] = key
    r = requests.get(f"https://api.themoviedb.org/3{path}", params=p,
                     headers=headers, timeout=20)
    if r.status_code == 401:
        raise RuntimeError("TMDB anahtarı geçersiz (401).")
    r.raise_for_status()
    return r


# =============================================================================
# HAVA DURUMU  (Open-Meteo, anahtar gerekmez)
# =============================================================================
_KOD_EMOJI = {0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️",
              51: "🌦️", 53: "🌦️", 55: "🌦️", 61: "🌧️", 63: "🌧️", 65: "🌧️",
              71: "❄️", 73: "❄️", 75: "❄️", 80: "🌧️", 81: "🌧️", 82: "⛈️",
              95: "⛈️", 96: "⛈️", 99: "⛈️"}


def _konum_bul(sorgu: str):
    kelimeler = [k for k in sorgu.lower().split() if k]
    en_iyi, en_iyi_skor = None, -1
    for tohum in [sorgu] + kelimeler:
        try:
            r = requests.get("https://geocoding-api.open-meteo.com/v1/search",
                             params={"name": tohum, "count": 10, "language": "tr"},
                             timeout=15)
            sonuclar = r.json().get("results") or []
        except Exception:
            continue
        for s in sonuclar:
            alan = " ".join(str(s.get(k) or "") for k in
                            ("name", "admin1", "admin2", "admin3", "country")).lower()
            skor = sum(1 for k in kelimeler if k in alan)
            if skor > en_iyi_skor:
                en_iyi, en_iyi_skor = s, skor
        if en_iyi_skor >= len(kelimeler):
            break
    return en_iyi


def hava(sorgu: str) -> str:
    """24 saatlik tahmin. Kotlin liste olarak çizer."""
    try:
        k = _konum_bul(sorgu)
        if not k:
            return _hata(f"'{sorgu}' için konum bulunamadı.")
        r = requests.get("https://api.open-meteo.com/v1/forecast",
                         params={"latitude": k["latitude"], "longitude": k["longitude"],
                                 "hourly": "temperature_2m,weather_code",
                                 "forecast_hours": 24, "timezone": "auto"}, timeout=15)
        r.raise_for_status()
        h = r.json()["hourly"]
        saatler = [{"saat": datetime.fromisoformat(h["time"][i]).strftime("%H:%M"),
                    "sicaklik": round(h["temperature_2m"][i]),
                    "emoji": _KOD_EMOJI.get(h["weather_code"][i], "❓")}
                   for i in range(len(h["time"]))]
        isim = ", ".join(x for x in [k.get("name"), k.get("admin1")] if x)
        return _ok({"konum": isim, "saatler": saatler})
    except Exception as e:  # noqa: BLE001
        return _hata(e)


# =============================================================================
# LİMAN GEMİLERİ  (AMF — liman_gemi_cek.py)
# =============================================================================
def liman_gemiler(gun_once: int = 1, gun_sonra: int = 3) -> str:
    """Gemi listesini döndürür. Kotlin hem liste hem çizelge olarak gösterir."""
    try:
        bugun = date.today()
        gemiler = liman_gemi_cek.gemileri_getir(
            bugun - timedelta(days=int(gun_once)),
            bugun + timedelta(days=int(gun_sonra)))
        # 'ham' sözlüğü JSON'a ağır; sadeleştir.
        sade = [{"ad": g["ad"], "rihtim": g["rihtim"],
                 "yanasma": g["yanasma"], "kalkis": g["kalkis"], "durum": g["durum"]}
                for g in gemiler]
        return _ok({"gemiler": sade})
    except Exception as e:  # noqa: BLE001
        return _hata(e)


# =============================================================================
# MEDYA  (Gemini ayrıştır + TMDB ara -> adaylar; Kotlin seçtirir)
# =============================================================================
_MEDYA_PROMPT = """Aşağıdaki cümleyi medya kaydına çevir. SADECE JSON döndür.
Şema: {{"title":"ad","type":"anime|dizi|film|manga","current_episode":sayı|null,"rating":1-10|null}}
Cümle: "{c}" """


def medya_ara(cumle: str) -> str:
    """Cümleyi ayrıştırır + adayları (TMDB/Jikan) döndürür. Kotlin buton gösterir."""
    try:
        veri = _gemini_json(_MEDYA_PROMPT.format(c=cumle))
        if veri.get("type") == "manga":
            adaylar = _jikan_ara(veri["title"])
        else:
            adaylar = _tmdb_ara(veri)
        return _ok({"veri": veri, "adaylar": adaylar})
    except Exception as e:  # noqa: BLE001
        return _hata(e)


def _tmdb_ara(veri: dict) -> list:
    tip = "tv" if veri.get("type") in ("dizi", "anime") else "movie"
    r = _tmdb_get(f"/search/{tip}", {"query": veri["title"], "language": "tr-TR"})
    out = []
    for s in r.json().get("results", [])[:6]:
        tarih = s.get("first_air_date") or s.get("release_date") or ""
        poster = s.get("poster_path")
        out.append({"baslik": s.get("name") or s.get("title") or veri["title"],
                    "yil": tarih[:4] if tarih else None, "ozet": s.get("overview", ""),
                    "kapak": f"https://image.tmdb.org/t/p/w500{poster}" if poster else None,
                    "ozet_dili": "tr"})
    return out


def _jikan_ara(baslik: str) -> list:
    r = requests.get("https://api.jikan.moe/v4/manga",
                     params={"q": baslik, "limit": 6}, timeout=15)
    out = []
    for m in r.json().get("data", []):
        yil = (m.get("published", {}).get("prop", {}).get("from", {}) or {}).get("year")
        out.append({"baslik": m.get("title", baslik), "yil": yil,
                    "ozet": m.get("synopsis", "") or "",
                    "kapak": m.get("images", {}).get("jpg", {}).get("image_url"),
                    "ozet_dili": "en"})
    return out


def medya_sonlandir(veri_json: str, aday_json: str) -> str:
    """Kullanıcı bir aday seçince çağrılır; kaydedilecek tam kaydı döndürür.

    Kotlin bu kaydı yerel veritabanına (Room/SQLite) yazar.
    """
    try:
        veri = json.loads(veri_json); aday = json.loads(aday_json)
        ozet = aday.get("ozet", "")
        if aday.get("ozet_dili") == "en" and ozet:
            ozet = _gemini_cevir(ozet)
        kayit = {"baslik": aday["baslik"], "tur": veri.get("type"),
                 "puan": veri.get("rating"), "bolum": veri.get("current_episode"),
                 "yil": aday.get("yil"), "kapak": aday.get("kapak"), "konu": ozet,
                 "izlenme": datetime.now().strftime("%Y-%m-%d %H:%M")}
        return _ok(kayit)
    except Exception as e:  # noqa: BLE001
        return _hata(e)


# =============================================================================
# FİNANS  (Gemini kategorize)
# =============================================================================
_FINANS_PROMPT = """Harcama cümlesini ayrıştır. SADECE JSON döndür.
Şema: {{"amount":sayı,"category":"market|yemek|ulaşım|fatura|eğlence|sağlık|diğer","description":"kısa"}}
Cümle: "{c}" """


def finans_ayristir(cumle: str) -> str:
    """Harcamayı kategorize eder. Kotlin yerel DB'ye yazar."""
    try:
        veri = _gemini_json(_FINANS_PROMPT.format(c=cumle))
        veri["tarih"] = datetime.now().strftime("%Y-%m-%d %H:%M")
        return _ok(veri)
    except Exception as e:  # noqa: BLE001
        return _hata(e)


# =============================================================================
# OYUN  (RAWG ara -> adaylar; Kotlin seçtirir)
# =============================================================================
_OYUN_PROMPT = """Cümleden oyun adı ve puanı çıkar. SADECE JSON.
Şema: {{"title":"ad","rating":1-10|null}}  Cümle: "{c}" """


def oyun_ara(cumle: str) -> str:
    try:
        if not _AYAR["rawg_key"]:
            raise RuntimeError("RAWG anahtarı girilmemiş (Ayarlar).")
        veri = _gemini_json(_OYUN_PROMPT.format(c=cumle))
        r = requests.get("https://api.rawg.io/api/games",
                         params={"key": _AYAR["rawg_key"], "search": veri["title"],
                                 "page_size": 6}, timeout=15)
        r.raise_for_status()
        adaylar = []
        for g in r.json().get("results", []):
            t = g.get("released") or ""
            adaylar.append({"id": g.get("id"), "baslik": g.get("name", veri["title"]),
                            "yil": t[:4] if t else None,
                            "kapak": g.get("background_image")})
        return _ok({"veri": veri, "adaylar": adaylar})
    except Exception as e:  # noqa: BLE001
        return _hata(e)


def oyun_sonlandir(veri_json: str, aday_json: str) -> str:
    try:
        veri = json.loads(veri_json); aday = json.loads(aday_json)
        konu = ""
        if aday.get("id") and _AYAR["rawg_key"]:
            d = requests.get(f"https://api.rawg.io/api/games/{aday['id']}",
                             params={"key": _AYAR["rawg_key"]}, timeout=15)
            if d.ok:
                ham = (d.json().get("description_raw") or "")[:600]
                konu = _gemini_cevir(ham) if ham else ""
        kayit = {"baslik": aday["baslik"], "tur": "oyun", "puan": veri.get("rating"),
                 "yil": aday.get("yil"), "kapak": aday.get("kapak"), "konu": konu,
                 "oynanma": datetime.now().strftime("%Y-%m-%d %H:%M")}
        return _ok(kayit)
    except Exception as e:  # noqa: BLE001
        return _hata(e)
