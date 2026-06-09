"""
liste_modulu.py — /listem : Medya veritabanını geri okuma.

Obsidian'daki medya notlarını (medya_modulu'nün yazdıkları) okuyup özet bir
liste döndürür. Böylece "8+ verdiğim animeler neydi?" gibi sorulara bot cevap verir.

Kullanım:
    /listem               -> hepsi (puana göre sıralı)
    /listem anime         -> sadece anime
    /listem 8             -> puanı 8 ve üzeri
    /listem anime 8       -> 8+ animeler
"""

import logging

from telegram import Update
from telegram.ext import ContextTypes

import config
from servisler import obsidian

logger = logging.getLogger("liman_botu.liste")

KOMUTLAR = ["listem"]

_TUR_EMOJI = {"anime": "🍙", "dizi": "📺", "film": "🎬", "manga": "📚"}
_GECERLI_TURLER = set(_TUR_EMOJI)


def _filtreleri_coz(args: list[str]) -> tuple[str | None, int | None]:
    """Argümanlardan (tür, asgari_puan) çıkarır. Sıra önemsiz."""
    tur, min_puan = None, None
    for a in args:
        dusuk = a.lower()
        if dusuk in _GECERLI_TURLER:
            tur = dusuk
        elif a.isdigit():
            min_puan = int(a)
    return tur, min_puan


def _puan(kayit: dict) -> int:
    """Sıralama için puanı güvenli biçimde int'e çevirir (boşsa -1)."""
    try:
        return int(kayit.get("rating"))
    except (TypeError, ValueError):
        return -1


async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    tur, min_puan = _filtreleri_coz(context.args)

    kayitlar = obsidian.notlari_listele(config.OBSIDIAN_MEDYA_PATH)
    if not kayitlar:
        await update.message.reply_text("📭 Henüz hiç medya kaydın yok.")
        return

    if tur:
        kayitlar = [k for k in kayitlar if k.get("type") == tur]
    if min_puan is not None:
        kayitlar = [k for k in kayitlar if _puan(k) >= min_puan]

    if not kayitlar:
        await update.message.reply_text("😕 Bu filtreye uyan kayıt yok.")
        return

    kayitlar.sort(key=_puan, reverse=True)

    satirlar = []
    for k in kayitlar:
        emoji = _TUR_EMOJI.get(k.get("type"), "•")
        puan = k.get("rating")
        puan_str = f"⭐ {puan}" if puan not in (None, "") else "—"
        yil = k.get("year")
        yil_str = f" ({yil})" if yil else ""
        satirlar.append(f"{emoji} {k.get('title', '?')}{yil_str} — {puan_str}")

    baslik = "🎞️ Medya listen"
    if tur:
        baslik += f" · {tur}"
    if min_puan is not None:
        baslik += f" · {min_puan}+"
    await update.message.reply_text(f"{baslik}\n\n" + "\n".join(satirlar))
