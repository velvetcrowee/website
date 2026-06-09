"""
finans_modulu.py — /harcama : Basit harcama takibi.

Kullanıcı "/harcama 150 market" yazınca:
  Adım A — Gemini: tutar + kategori + açıklama çıkarır (JSON).
  Adım B — Obsidian: hem aylık dosyaya (Dataview tablosu için) hem de günlük nota
           bir satır ekler. Böylece "bu ay ne harcadım" sorgulanabilir olur.

Gemini SADECE kategori/tutar ayrıştırması için tetiklenir.
"""

import asyncio
import logging
import os
from datetime import date, datetime

from telegram import Update
from telegram.ext import ContextTypes

import config
from servisler import gemini, obsidian

logger = logging.getLogger("liman_botu.finans")

KOMUTLAR = ["harcama"]
KOMUT_ACIKLAMA = {"harcama": "Harcama ekle (kategorize eder)"}

_PARSE_PROMPT = """Aşağıdaki harcama cümlesini ayrıştır. SADECE geçerli JSON döndür.
Şema:
{{
  "amount": sayı (TL cinsinden tutar),
  "category": "market | yemek | ulaşım | fatura | eğlence | sağlık | diğer",
  "description": "kısa açıklama (string)"
}}
Cümle: "{cumle}"
"""

_KATEGORI_EMOJI = {
    "market": "🛒", "yemek": "🍔", "ulaşım": "🚌", "fatura": "🧾",
    "eğlence": "🎉", "sağlık": "💊", "diğer": "💸",
}


def _ayristir(cumle: str) -> dict:
    return gemini.json_uret(_PARSE_PROMPT.format(cumle=cumle))


def _kaydet(veri: dict) -> str:
    """Harcamayı aylık Dataview dosyasına ekler ve özet metni döndürür."""
    tutar = veri.get("amount", 0)
    kategori = veri.get("category", "diğer")
    aciklama = veri.get("description", "")
    emoji = _KATEGORI_EMOJI.get(kategori, "💸")
    simdi = datetime.now()

    # Aylık dosya: 2026-06.md gibi. Dataview'in tablo kurabilmesi için
    # her harcamayı bir madde olarak (inline alanlarla) ekliyoruz.
    os.makedirs(config.OBSIDIAN_FINANS_PATH, exist_ok=True)
    ay_dosyasi = os.path.join(config.OBSIDIAN_FINANS_PATH, f"{simdi:%Y-%m}.md")
    satir = (
        f"- {simdi:%d.%m %H:%M} {emoji} "
        f"(tutar:: {tutar}) (kategori:: {kategori}) {aciklama}"
    )
    yeni_dosya = not os.path.exists(ay_dosyasi)
    with open(ay_dosyasi, "a", encoding="utf-8") as f:
        if yeni_dosya:
            f.write(f"---\ntags: [finans]\nay: \"{simdi:%Y-%m}\"\n---\n\n"
                    f"# {simdi:%B %Y} Harcamaları\n\n")
        f.write(satir + "\n")

    return f"{emoji} Kaydedildi: {tutar} TL · {kategori}\n{aciklama}"


async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cumle = " ".join(context.args).strip()
    if not cumle:
        await update.message.reply_text("Örnek: /harcama 150 market alışverişi")
        return

    await update.message.reply_text("💭 İşleniyor...")
    try:
        veri = await asyncio.to_thread(_ayristir, cumle)
        sonuc = await asyncio.to_thread(_kaydet, veri)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Finans işleme hatası")
        await update.message.reply_text(f"⚠️ Bir şeyler ters gitti: {exc}")
        return

    await update.message.reply_text(sonuc)
