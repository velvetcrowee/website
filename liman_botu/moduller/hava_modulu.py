"""
hava_modulu.py — /havadurumu : 24 saatlik emoji'li hava tahmini.

Open-Meteo kullanır; API ANAHTARI GEREKTİRMEZ. Hem konum bulma (geocoding)
hem de tahmin ücretsizdir.

Kullanım:
    /havadurumu Barbaros Tekirdağ
    /havadurumu İstanbul
"""

import asyncio
import logging
from datetime import datetime

import requests

from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("liman_botu.hava")

KOMUTLAR = ["havadurumu"]

# WMO hava kodları -> emoji (Open-Meteo bu kodları döndürür).
_KOD_EMOJI = {
    0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
    45: "🌫️", 48: "🌫️",
    51: "🌦️", 53: "🌦️", 55: "🌦️", 56: "🌧️", 57: "🌧️",
    61: "🌧️", 63: "🌧️", 65: "🌧️", 66: "🌧️", 67: "🌧️",
    71: "❄️", 73: "❄️", 75: "❄️", 77: "❄️",
    80: "🌧️", 81: "🌧️", 82: "⛈️",
    85: "🌨️", 86: "🌨️",
    95: "⛈️", 96: "⛈️", 99: "⛈️",
}


def _konum_bul(sorgu: str) -> dict | None:
    """Yer adından koordinat bulur. 'Barbaros Tekirdağ' -> tam, olmazsa ilk kelime."""
    adaylar = [sorgu] + sorgu.split()  # önce tamı, sonra tek tek kelimeleri dene
    for ad in adaylar:
        r = requests.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": ad, "count": 1, "language": "tr"},
            timeout=15,
        )
        if not r.ok:
            continue
        sonuclar = r.json().get("results") or []
        if sonuclar:
            s = sonuclar[0]
            isim = ", ".join(x for x in [s.get("name"), s.get("admin1")] if x)
            return {"lat": s["latitude"], "lon": s["longitude"], "isim": isim}
    return None


def _tahmin(lat: float, lon: float) -> list[dict]:
    """Önümüzdeki 24 saatin saatlik tahminini döndürür."""
    r = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat, "longitude": lon,
            "hourly": "temperature_2m,weather_code",
            "forecast_hours": 24, "timezone": "auto",
        },
        timeout=15,
    )
    r.raise_for_status()
    h = r.json()["hourly"]
    return [
        {"saat": h["time"][i], "sicaklik": h["temperature_2m"][i],
         "kod": h["weather_code"][i]}
        for i in range(len(h["time"]))
    ]


def _bicimlendir(isim: str, saatler: list[dict]) -> str:
    satirlar = [f"🌍 {isim} · 24 saatlik tahmin\n"]
    for s in saatler:
        saat = datetime.fromisoformat(s["saat"]).strftime("%H:%M")
        emoji = _KOD_EMOJI.get(s["kod"], "❓")
        satirlar.append(f"{saat}  {emoji}  {round(s['sicaklik'])}°C")
    return "\n".join(satirlar)


def _hazirla(sorgu: str) -> str:
    konum = _konum_bul(sorgu)
    if not konum:
        return f"😕 '{sorgu}' için konum bulamadım."
    saatler = _tahmin(konum["lat"], konum["lon"])
    return _bicimlendir(konum["isim"], saatler)


async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    sorgu = " ".join(context.args).strip()
    if not sorgu:
        await update.message.reply_text("Örnek: /havadurumu Barbaros Tekirdağ")
        return

    await update.message.reply_text("🛰️ Hava verisi alınıyor...")
    try:
        sonuc = await asyncio.to_thread(_hazirla, sorgu)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Hava durumu hatası")
        await update.message.reply_text(f"⚠️ Bir şeyler ters gitti: {exc}")
        return

    await update.message.reply_text(sonuc)
