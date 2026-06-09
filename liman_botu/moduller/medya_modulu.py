"""
medya_modulu.py — Medya takibi + Obsidian entegrasyonu.

Akış (kullanıcı "/izledim One Piece 271, puanım 6" yazınca):

  Adım A — Gemini: Cümleyi ayrıştır, temiz bir JSON çıkar.
           {title, type, current_episode, rating}
  Adım B — Zenginleştirme:
             * dizi/film/anime  -> TMDB (language=tr-TR ile Türkçe özet)
             * manga            -> Jikan (gerekirse Gemini ile TR'ye çevir)
           Çekilenler: Türkçe özet, yayın yılı, kapak görseli.
  Adım C — Obsidian: Dataview uyumlu, YAML frontmatter'lı .md dosyası oluştur
           ya da varsa sadece bölüm/puan alanlarını güncelle.

Artık Gemini ve Obsidian işleri servisler/ katmanından geliyor; bu modül sadece
kendi iş akışına (prompt, TMDB/Jikan çağrıları, frontmatter şekli) odaklanır.

Not: API çağrıları senkron. python-telegram-bot async olduğundan bunları
asyncio.to_thread ile sararak event loop'u bloke etmiyoruz.
"""

import asyncio
import logging

import requests

from telegram import Update
from telegram.ext import ContextTypes

import config
from servisler import gemini, obsidian

logger = logging.getLogger("liman_botu.medya")

# Bu modülün sahiplendiği komutlar. main.py otomatik yükleyici bunu okur.
# Aynı handle'a birden fazla komut bağlanabilir (izledim = okudum mantığı).
KOMUTLAR = ["izledim", "okudum"]


# =============================================================================
# Adım A — GEMINI ile ayrıştırma (servis üzerinden)
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
# Adım B — ZENGİNLEŞTİRME (TMDB / Jikan)
# =============================================================================
def _zenginlestir(veri: dict) -> dict:
    """type'a göre doğru kaynağı seçer ve meta bilgileri ekler."""
    if veri.get("type") == "manga":
        return _jikan_meta(veri)
    return _tmdb_meta(veri)


def _tmdb_meta(veri: dict) -> dict:
    """TMDB'den Türkçe özet, yıl ve kapak görseli çeker (dizi/film/anime)."""
    arama_tipi = "tv" if veri.get("type") in ("dizi", "anime") else "movie"

    r = requests.get(
        f"https://api.themoviedb.org/3/search/{arama_tipi}",
        params={
            "api_key": config.TMDB_API_KEY,
            "query": veri["title"],
            "language": "tr-TR",
        },
        timeout=15,
    )
    r.raise_for_status()
    sonuclar = r.json().get("results", [])
    if not sonuclar:
        return {**veri, "ozet": "", "yil": None, "kapak": None}

    ilk = sonuclar[0]
    tarih = ilk.get("first_air_date") or ilk.get("release_date") or ""
    poster = ilk.get("poster_path")
    return {
        **veri,
        "ozet": ilk.get("overview", ""),
        "yil": tarih[:4] if tarih else None,
        "kapak": f"https://image.tmdb.org/t/p/w500{poster}" if poster else None,
    }


def _jikan_meta(veri: dict) -> dict:
    """Jikan'dan manga meta bilgisi çeker; özet İngilizce ise servisle çevirir."""
    r = requests.get(
        "https://api.jikan.moe/v4/manga",
        params={"q": veri["title"], "limit": 1},
        timeout=15,
    )
    r.raise_for_status()
    veriler = r.json().get("data", [])
    if not veriler:
        return {**veri, "ozet": "", "yil": None, "kapak": None}

    ilk = veriler[0]
    ozet_en = ilk.get("synopsis", "") or ""
    return {
        **veri,
        "ozet": gemini.cevir(ozet_en) if ozet_en else "",
        "yil": (ilk.get("published", {}).get("prop", {}).get("from", {}) or {}).get("year"),
        "kapak": ilk.get("images", {}).get("jpg", {}).get("image_url"),
    }


# =============================================================================
# Adım C — OBSIDIAN yazımı (obsidian servisi üzerinden)
# =============================================================================
def _kaydet(veri: dict) -> str:
    """Frontmatter + gövdeyi hazırlar ve obsidian servisine yazdırır."""
    frontmatter = {
        "title": veri.get("title", ""),
        "type": veri.get("type", ""),
        "rating": veri.get("rating"),
        "current_episode": veri.get("current_episode"),
        "year": veri.get("yil"),
        "cover": veri.get("kapak"),
        "guncelleme": "",  # servis bunu bugüne çeker
        "tags": ["medya", veri.get("type", "")],
    }
    govde = (
        f"# {veri.get('title', '')}\n\n"
        f"![kapak]({veri.get('kapak') or ''})\n\n"
        f"## Özet\n{veri.get('ozet') or '_Özet bulunamadı._'}"
    )
    return obsidian.kaydet(
        klasor=config.OBSIDIAN_MEDYA_PATH,
        baslik=veri["title"],
        frontmatter=frontmatter,
        govde=govde,
        # Dosya zaten varsa SADECE bunları güncelle:
        guncellenebilir_alanlar=["rating", "current_episode"],
    )


# =============================================================================
# GİRİŞ NOKTASI — main.py buraya paslar
# =============================================================================
async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/izledim ... veya /okudum ... komutunun giriş noktası."""
    cumle = " ".join(context.args).strip()
    if not cumle:
        await update.message.reply_text("Örnek: /izledim One Piece 271, puanım 6")
        return

    await update.message.reply_text("🔎 İşleniyor...")
    try:
        # Bloke eden (senkron) işleri ayrı thread'de çalıştır ki bot donmasın.
        veri = await asyncio.to_thread(_ayristir, cumle)        # Adım A
        veri = await asyncio.to_thread(_zenginlestir, veri)     # Adım B
        sonuc = await asyncio.to_thread(_kaydet, veri)          # Adım C
    except Exception as exc:  # noqa: BLE001 — kullanıcıya nazik hata dönsün
        logger.exception("Medya işleme hatası")
        await update.message.reply_text(f"⚠️ Bir şeyler ters gitti: {exc}")
        return

    await update.message.reply_text(sonuc)
