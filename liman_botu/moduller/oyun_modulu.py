"""
oyun_modulu.py — /oynadim : Oyun takibi (RAWG ile akıllı seçim).

Medya modülüyle aynı deseni kullanır: birden çok eşleşmede butonla "Hangisi?"
diye sorar, seçilen oyunun açıklaması (Türkçeye çevrilerek), yılı ve puanın
Obsidian'a yazılır. RAWG API ücretsizdir (rawg.io/apidocs).

Kullanım: /oynadim Elden Ring 9 puan
"""

import asyncio
import logging
from datetime import datetime

import requests

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

import config
from servisler import gemini, obsidian

logger = logging.getLogger("liman_botu.oyun")

KOMUTLAR = ["oynadim"]
CALLBACK_AD = "oyun"
_MAX_ADAY = 6

_PARSE_PROMPT = """Aşağıdaki cümleden oyun adını ve puanı çıkar. SADECE JSON döndür.
Şema: {{ "title": "oyun adı", "rating": 1-10 tamsayı veya null }}
Cümle: "{cumle}"
"""


def _ayristir(cumle: str) -> dict:
    return gemini.json_uret(_PARSE_PROMPT.format(cumle=cumle))


def _ara(veri: dict) -> list[dict]:
    """RAWG'da oyun arar; aday listesi (id, baslik, yil) döndürür."""
    r = requests.get(
        "https://api.rawg.io/api/games",
        params={"key": config.RAWG_API_KEY, "search": veri["title"],
                "page_size": _MAX_ADAY},
        timeout=15,
    )
    r.raise_for_status()
    adaylar = []
    for g in r.json().get("results", []):
        tarih = g.get("released") or ""
        adaylar.append({
            "id": g.get("id"),
            "baslik": g.get("name", veri["title"]),
            "yil": tarih[:4] if tarih else None,
            "kapak": g.get("background_image"),
        })
    return adaylar


def _detay_ve_kaydet(veri: dict, aday: dict) -> str:
    """Seçilen oyunun detayını çeker, açıklamayı çevirir ve Obsidian'a yazar."""
    aciklama = ""
    if aday.get("id"):
        d = requests.get(
            f"https://api.rawg.io/api/games/{aday['id']}",
            params={"key": config.RAWG_API_KEY},
            timeout=15,
        )
        if d.ok:
            ham = (d.json().get("description_raw") or "")[:600]
            aciklama = gemini.cevir(ham) if ham else ""

    simdi = datetime.now()
    frontmatter = {
        "title": aday["baslik"],
        "type": "oyun",
        "rating": veri.get("rating"),
        "year": aday.get("yil"),
        "cover": aday.get("kapak"),
        "oynanma": simdi.strftime("%Y-%m-%d %H:%M"),
        "guncelleme": "",
        "tags": ["oyun"],
    }
    govde = (
        f"# {aday['baslik']}\n\n"
        f"![kapak]({aday.get('kapak') or ''})\n\n"
        f"## Konu\n{aciklama or '_Açıklama bulunamadı._'}"
    )
    return obsidian.kaydet(
        klasor=config.OBSIDIAN_OYUN_PATH,
        baslik=aday["baslik"],
        frontmatter=frontmatter,
        govde=govde,
        guncellenebilir_alanlar=["rating"],
    )


async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cumle = " ".join(context.args).strip()
    if not cumle:
        await update.message.reply_text("Örnek: /oynadim Elden Ring 9 puan")
        return

    await update.message.reply_text("🎮 Aranıyor...")
    try:
        veri = await asyncio.to_thread(_ayristir, cumle)
        adaylar = await asyncio.to_thread(_ara, veri)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Oyun arama hatası")
        await update.message.reply_text(f"⚠️ Bir şeyler ters gitti: {exc}")
        return

    if not adaylar:
        await update.message.reply_text("😕 Eşleşen oyun bulamadım.")
        return

    if len(adaylar) == 1:
        sonuc = await asyncio.to_thread(_detay_ve_kaydet, veri, adaylar[0])
        await update.message.reply_text(sonuc)
        return

    context.user_data["oyun_bekleyen"] = {"veri": veri, "adaylar": adaylar}
    butonlar = [
        [InlineKeyboardButton(f"{a['baslik']} ({a['yil'] or '—'})",
                              callback_data=f"{CALLBACK_AD}:{i}")]
        for i, a in enumerate(adaylar)
    ]
    await update.message.reply_text(
        "🤔 Hangi oyun?", reply_markup=InlineKeyboardMarkup(butonlar)
    )


async def callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    sorgu = update.callback_query
    await sorgu.answer()

    bekleyen = context.user_data.pop("oyun_bekleyen", None)
    if not bekleyen:
        await sorgu.edit_message_text("⌛ Seçim zaman aşımına uğradı, tekrar dene.")
        return

    try:
        index = int((sorgu.data or "").split(":", 1)[1])
        aday = bekleyen["adaylar"][index]
    except (ValueError, IndexError):
        await sorgu.edit_message_text("⚠️ Geçersiz seçim.")
        return

    await sorgu.edit_message_text("💾 Kaydediliyor...")
    try:
        sonuc = await asyncio.to_thread(_detay_ve_kaydet, bekleyen["veri"], aday)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Oyun kaydetme hatası")
        await sorgu.edit_message_text(f"⚠️ Bir şeyler ters gitti: {exc}")
        return

    await sorgu.edit_message_text(sonuc)
