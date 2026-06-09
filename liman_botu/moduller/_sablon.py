"""
_sablon.py — Yeni modül şablonu (KOPYALA-YAPIŞTIR başlangıç noktası).

Bu dosya YÜKLENMEZ: adı "_" ile başladığı için otomatik keşif onu atlar.
Yeni bir modül yazmak istediğinde:

    1) Bu dosyayı kopyala, anlamlı bir ada koy:
           cp moduller/_sablon.py moduller/akilli_ev_modulu.py
    2) Aşağıdaki KOMUTLAR ve handle'ı kendine göre doldur.
    3) Botu yeniden başlat. Komutun otomatik aktif olur.
       main.py'ye HİÇ dokunma.
"""

import logging

from telegram import Update
from telegram.ext import ContextTypes

import config  # gerekirse ayarlara/anahtarlara buradan eriş

logger = logging.getLogger("liman_botu.sablon")

# Bu modülün sahiplendiği komut(lar). Birden fazla olabilir.
KOMUTLAR = ["ev"]  # örnek: /ev


async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """main.py'nin çağırdığı standart giriş noktası.

    context.args  ->  komuttan sonraki kelimeler (liste).
    Örn: "/ev salon ışık aç"  ->  context.args == ["salon", "ışık", "aç"]
    """
    args = context.args
    if not args:
        await update.message.reply_text("Örnek kullanım: /ev salon ışık aç")
        return

    # TODO: gerçek iş mantığını buraya yaz.
    await update.message.reply_text(f"(şablon) Aldığım komut: {' '.join(args)}")
