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

Gemini SADECE bu modülde, sadece Adım A'da (ve gerekirse çeviri için)
tetiklenir. main.py asla yapay zekayı çağırmaz — kota böyle korunur.

Not: İçerideki API çağrıları senkron requests/SDK ile yazıldı. python-telegram-bot
async olduğu için bunları event loop'u bloke etmeyecek şekilde
asyncio.to_thread ile sarmaladık.
"""

import asyncio
import json
import logging
import os
import re
from datetime import date

import requests

from telegram import Update
from telegram.ext import ContextTypes

import config

logger = logging.getLogger("liman_botu.medya")


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


def _gemini_ayristir(cumle: str) -> dict:
    """Adım A: Gemini ile cümleden yapılandırılmış JSON çıkarır."""
    import google.generativeai as genai

    genai.configure(api_key=config.GEMINI_API_KEY)
    model = genai.GenerativeModel(config.GEMINI_MODEL)

    yanit = model.generate_content(_PARSE_PROMPT.format(cumle=cumle))
    return _json_cikar(yanit.text)


def _gemini_cevir(metin: str) -> str:
    """Yardımcı: İngilizce özeti kısaca Türkçeye çevirir (Jikan için)."""
    if not metin:
        return ""
    import google.generativeai as genai

    genai.configure(api_key=config.GEMINI_API_KEY)
    model = genai.GenerativeModel(config.GEMINI_MODEL)
    yanit = model.generate_content(
        f"Aşağıdaki metni akıcı ve kısa bir Türkçeye çevir, "
        f"sadece çeviriyi yaz:\n\n{metin}"
    )
    return (yanit.text or "").strip()


def _json_cikar(ham: str) -> dict:
    """Gemini bazen ```json ... ``` ile sarar; saf JSON'u söküp alır."""
    eslesme = re.search(r"\{.*\}", ham, re.DOTALL)
    if not eslesme:
        raise ValueError(f"Gemini'den JSON alınamadı: {ham!r}")
    return json.loads(eslesme.group(0))


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
    title = veri["title"]
    arama_tipi = "tv" if veri.get("type") in ("dizi", "anime") else "movie"

    r = requests.get(
        f"https://api.themoviedb.org/3/search/{arama_tipi}",
        params={
            "api_key": config.TMDB_API_KEY,
            "query": title,
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
    """Jikan'dan manga meta bilgisi çeker; özet İngilizce ise Gemini ile çevirir."""
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
        "ozet": _gemini_cevir(ozet_en) if ozet_en else "",
        "yil": (ilk.get("published", {}).get("prop", {}).get("from", {}) or {}).get("year"),
        "kapak": ilk.get("images", {}).get("jpg", {}).get("image_url"),
    }


# =============================================================================
# Adım C — OBSIDIAN yazımı (Dataview + YAML frontmatter)
# =============================================================================
def _dosya_yolu(title: str) -> str:
    """Başlıktan güvenli bir dosya adı üretir."""
    guvenli = re.sub(r"[^\w\s-]", "", title).strip().replace(" ", "_")
    return os.path.join(config.OBSIDIAN_MEDYA_PATH, f"{guvenli}.md")


def _frontmatter_yaz(veri: dict) -> str:
    """Dataview'in okuyabileceği YAML frontmatter + gövde üretir."""
    return f"""---
title: "{veri.get('title', '')}"
type: {veri.get('type', '')}
rating: {veri.get('rating') if veri.get('rating') is not None else ''}
current_episode: {veri.get('current_episode') if veri.get('current_episode') is not None else ''}
year: {veri.get('yil') or ''}
cover: {veri.get('kapak') or ''}
guncelleme: {date.today().isoformat()}
tags: [medya, {veri.get('type', '')}]
---

# {veri.get('title', '')}

![kapak]({veri.get('kapak') or ''})

## Özet
{veri.get('ozet') or '_Özet bulunamadı._'}
"""


def _obsidian_kaydet(veri: dict) -> str:
    """Yeni dosya oluşturur veya mevcutsa SADECE bölüm/puan alanlarını günceller.

    Dönüş: kullanıcıya gösterilecek kısa durum mesajı.
    """
    os.makedirs(config.OBSIDIAN_MEDYA_PATH, exist_ok=True)
    yol = _dosya_yolu(veri["title"])

    if os.path.exists(yol):
        with open(yol, "r", encoding="utf-8") as f:
            icerik = f.read()
        icerik = _alan_guncelle(icerik, "rating", veri.get("rating"))
        icerik = _alan_guncelle(icerik, "current_episode", veri.get("current_episode"))
        icerik = _alan_guncelle(icerik, "guncelleme", date.today().isoformat())
        with open(yol, "w", encoding="utf-8") as f:
            f.write(icerik)
        return f"♻️ Güncellendi: {veri['title']} (bölüm/puan)."

    with open(yol, "w", encoding="utf-8") as f:
        f.write(_frontmatter_yaz(veri))
    return f"✅ Oluşturuldu: {veri['title']}."


def _alan_guncelle(icerik: str, alan: str, deger) -> str:
    """Frontmatter içindeki tek bir alanı (varsa) yeni değerle değiştirir."""
    if deger is None:
        return icerik
    desen = rf"^({alan}:).*$"
    return re.sub(desen, rf"\g<1> {deger}", icerik, count=1, flags=re.MULTILINE)


# =============================================================================
# GİRİŞ NOKTASI — main.py buraya paslar
# =============================================================================
async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/izledim ... veya /okudum ... komutunun giriş noktası."""
    cumle = " ".join(context.args).strip()
    if not cumle:
        await update.message.reply_text(
            "Örnek: /izledim One Piece 271, puanım 6"
        )
        return

    await update.message.reply_text("🔎 İşleniyor...")
    try:
        # Bloke eden (senkron) işleri ayrı thread'de çalıştır ki bot donmasın.
        veri = await asyncio.to_thread(_gemini_ayristir, cumle)      # Adım A
        veri = await asyncio.to_thread(_zenginlestir, veri)          # Adım B
        sonuc = await asyncio.to_thread(_obsidian_kaydet, veri)      # Adım C
    except Exception as exc:  # noqa: BLE001 — kullanıcıya nazik hata dönsün
        logger.exception("Medya işleme hatası")
        await update.message.reply_text(f"⚠️ Bir şeyler ters gitti: {exc}")
        return

    await update.message.reply_text(sonuc)
