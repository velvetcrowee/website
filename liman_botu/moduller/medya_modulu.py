"""
medya_modulu.py — Medya takibi + Obsidian entegrasyonu (akıllı seçim ile).

Akış (kullanıcı "/izledim xmen, puanım 7" yazınca):

  Adım A — Gemini: Cümleyi ayrıştır -> {title, type, current_episode, rating}
  Adım B — ARAMA: TMDB (dizi/film/anime) veya Jikan (manga) ile EŞLEŞEN ADAYLARI
           listeler. Birden fazla aday varsa kullanıcıya butonlarla "Hangisi?"
           diye sorar (X-Men mi, X-Men 2 mi?). Tek aday varsa direkt yazar.
  Adım C — SEÇİM sonrası: seçilen eserin konusu/yılı/kapağı + PUAN + İZLEME SAATİ
           ile Dataview uyumlu .md dosyası oluşturulur veya güncellenir.

Böylece Obsidian küçük bir veritabanı gibi olur: sonradan nota bakınca filmin
konusunu, kaç puan verdiğini ve ne zaman izlediğini görürsün.

Gemini SADECE bu modülde, sadece ayrıştırma ve (gerekirse) çeviride tetiklenir.
"""

import asyncio
import logging
from datetime import datetime

import requests

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

import config
from servisler import gemini, obsidian

logger = logging.getLogger("liman_botu.medya")

# main.py otomatik yükleyici bunları okur.
KOMUTLAR = ["izledim", "okudum"]   # komutlar
KOMUT_ACIKLAMA = {
    "izledim": "Dizi/film/anime kaydet",
    "okudum": "Manga kaydet",
}
CALLBACK_AD = "medya"              # butonlardan gelen callback'lerin ön eki

# Aynı anda gösterilecek en fazla aday sayısı (buton kalabalığı olmasın).
_MAX_ADAY = 6


# =============================================================================
# Adım A — GEMINI ile ayrıştırma
# =============================================================================
_PARSE_PROMPT = """Aşağıdaki cümleyi bir medya takip kaydına çevir.
SADECE geçerli JSON döndür, başka hiçbir şey yazma.
Şema:
{{
  "title": "eserin adı (string)",
  "type": "anime | dizi | film | manga",
  "current_episode": tamsayı veya null,
  "rating": 1-10 arası tamsayı veya null
}}
Cümle: "{cumle}"
"""


def _ayristir(cumle: str) -> dict:
    """Adım A: cümleden yapılandırılmış JSON çıkar (gemini servisi)."""
    return gemini.json_uret(_PARSE_PROMPT.format(cumle=cumle))


# =============================================================================
# Adım B — ARAMA (aday listesi üret): TMDB / Jikan
# =============================================================================
def _arama(veri: dict) -> list[dict]:
    """type'a göre kaynaktan EŞLEŞEN ADAYLARI normalize edilmiş liste döndürür.

    Her aday: {baslik, yil, ozet, kapak, ozet_dili}
    """
    if veri.get("type") == "manga":
        return _jikan_ara(veri)
    return _tmdb_ara(veri)


def _tmdb_get(path: str, params: dict):
    """TMDB'ye istek atar. Anahtar tipini (v3 api_key vs v4 Bearer token)
    otomatik algılar; hangisini yapıştırdığın fark etmez."""
    key = (config.TMDB_API_KEY or "").strip()
    if not key:
        raise RuntimeError(
            "TMDB anahtarı yok. .env dosyana TMDB_API_KEY=... ekle "
            "(themoviedb.org → Settings → API)."
        )
    p = dict(params)
    headers = {}
    # v4 token: uzun ve 'eyJ' ile başlayan JWT -> Authorization header ile gider.
    if key.startswith("eyJ") or len(key) > 45:
        headers["Authorization"] = f"Bearer {key}"
    else:  # v3 anahtarı -> api_key query parametresi
        p["api_key"] = key
    r = requests.get(f"https://api.themoviedb.org/3{path}", params=p,
                     headers=headers, timeout=15)
    if r.status_code == 401:
        raise RuntimeError(
            "TMDB anahtarı geçersiz (401). themoviedb.org → Settings → API'den "
            "doğru anahtarı kopyaladığından emin ol (v3 'API Key' ya da v4 token)."
        )
    r.raise_for_status()
    return r


def _tmdb_ara(veri: dict) -> list[dict]:
    """TMDB'de Türkçe arama yapar (dizi/film/anime); aday listesi döndürür."""
    arama_tipi = "tv" if veri.get("type") in ("dizi", "anime") else "movie"
    r = _tmdb_get(f"/search/{arama_tipi}",
                  {"query": veri["title"], "language": "tr-TR"})
    adaylar = []
    for s in r.json().get("results", [])[:_MAX_ADAY]:
        tarih = s.get("first_air_date") or s.get("release_date") or ""
        poster = s.get("poster_path")
        adaylar.append({
            "baslik": s.get("name") or s.get("title") or veri["title"],
            "yil": tarih[:4] if tarih else None,
            "ozet": s.get("overview", ""),
            "kapak": f"https://image.tmdb.org/t/p/w500{poster}" if poster else None,
            "ozet_dili": "tr",  # TMDB tr-TR ile geldi, çeviri gerekmez
        })
    return adaylar


def _jikan_ara(veri: dict) -> list[dict]:
    """Jikan'da manga arar; aday listesi döndürür (özetler İngilizce)."""
    r = requests.get(
        "https://api.jikan.moe/v4/manga",
        params={"q": veri["title"], "limit": _MAX_ADAY},
        timeout=15,
    )
    r.raise_for_status()
    adaylar = []
    for m in r.json().get("data", []):
        yil = (m.get("published", {}).get("prop", {}).get("from", {}) or {}).get("year")
        adaylar.append({
            "baslik": m.get("title", veri["title"]),
            "yil": yil,
            "ozet": m.get("synopsis", "") or "",
            "kapak": m.get("images", {}).get("jpg", {}).get("image_url"),
            "ozet_dili": "en",  # Jikan İngilizce; seçilince çevrilecek
        })
    return adaylar


# =============================================================================
# Adım C — SONLANDIR: seçilen adayı Obsidian'a yaz
# =============================================================================
def _sonlandir(veri: dict, aday: dict) -> str:
    """Seçilen adayın bilgilerini PUAN + İZLEME SAATİ ile birleştirip yazar."""
    ozet = aday.get("ozet", "")
    if aday.get("ozet_dili") == "en" and ozet:
        ozet = gemini.cevir(ozet)  # sadece SEÇİLEN aday çevrilir (kota dostu)

    simdi = datetime.now()
    frontmatter = {
        "title": aday["baslik"],
        "type": veri.get("type", ""),
        "rating": veri.get("rating"),
        "current_episode": veri.get("current_episode"),
        "year": aday.get("yil"),
        "cover": aday.get("kapak"),
        "izlenme": simdi.strftime("%Y-%m-%d %H:%M"),  # tarih + SAAT
        "guncelleme": "",  # servis bunu bugüne çeker
        "tags": ["medya", veri.get("type", "")],
    }
    govde = (
        f"# {aday['baslik']}\n\n"
        f"![kapak]({aday.get('kapak') or ''})\n\n"
        f"## Konu\n{ozet or '_Özet bulunamadı._'}"
    )
    return obsidian.kaydet(
        klasor=config.OBSIDIAN_MEDYA_PATH,
        baslik=aday["baslik"],
        frontmatter=frontmatter,
        govde=govde,
        # Dosya zaten varsa SADECE bunlar güncellenir (izlenme saati korunur):
        guncellenebilir_alanlar=["rating", "current_episode"],
    )


# =============================================================================
# GİRİŞ NOKTASI (komut) — main.py buraya paslar
# =============================================================================
async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/izledim ... veya /okudum ... komutunun giriş noktası."""
    cumle = " ".join(context.args).strip()
    if not cumle:
        await update.message.reply_text("Örnek: /izledim xmen, puanım 7")
        return

    await update.message.reply_text("🔎 Aranıyor...")
    try:
        veri = await asyncio.to_thread(_ayristir, cumle)       # Adım A
        adaylar = await asyncio.to_thread(_arama, veri)        # Adım B
    except Exception as exc:  # noqa: BLE001
        logger.exception("Medya arama hatası")
        await update.message.reply_text(f"⚠️ Bir şeyler ters gitti: {exc}")
        return

    if not adaylar:
        await update.message.reply_text("😕 Eşleşen bir şey bulamadım.")
        return

    # Tek aday varsa soru sormaya gerek yok, direkt yaz.
    if len(adaylar) == 1:
        sonuc = await asyncio.to_thread(_sonlandir, veri, adaylar[0])
        await update.message.reply_text(sonuc)
        return

    # Birden fazla aday: kullanıcıya "Hangisi?" diye butonlarla sor.
    # Seçim callback'te lazım olacağı için bekleyen durumu user_data'da sakla.
    context.user_data["medya_bekleyen"] = {"veri": veri, "adaylar": adaylar}
    butonlar = [
        [InlineKeyboardButton(
            f"{a['baslik']} ({a['yil'] or '—'})",
            callback_data=f"{CALLBACK_AD}:{i}",
        )]
        for i, a in enumerate(adaylar)
    ]
    await update.message.reply_text(
        "🤔 Hangisini kastettin?",
        reply_markup=InlineKeyboardMarkup(butonlar),
    )


# =============================================================================
# GİRİŞ NOKTASI (callback) — kullanıcı bir butona basınca main.py buraya paslar
# =============================================================================
async def callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """'medya:<index>' callback'ini işler: seçilen adayı kaydeder."""
    sorgu = update.callback_query
    await sorgu.answer()  # Telegram'a "aldım" de (butondaki saat ikonu kaybolsun).

    bekleyen = context.user_data.pop("medya_bekleyen", None)
    if not bekleyen:
        await sorgu.edit_message_text(
            "⌛ Seçim zaman aşımına uğradı, komutu tekrar gönder."
        )
        return

    try:
        index = int((sorgu.data or "").split(":", 1)[1])
        aday = bekleyen["adaylar"][index]
    except (ValueError, IndexError):
        await sorgu.edit_message_text("⚠️ Geçersiz seçim.")
        return

    await sorgu.edit_message_text("💾 Kaydediliyor...")
    try:
        sonuc = await asyncio.to_thread(_sonlandir, bekleyen["veri"], aday)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Medya kaydetme hatası")
        await sorgu.edit_message_text(f"⚠️ Bir şeyler ters gitti: {exc}")
        return

    await sorgu.edit_message_text(sonuc)
