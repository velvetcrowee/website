"""
main.py — Ana Yönlendirici (Dispatcher).

Görevi TEK ŞEY: Telegram'dan gelen komutları dinlemek ve doğru modüle paslamak.
Burada hiçbir iş mantığı (business logic) yoktur. Liman işleri liman_modulu'nde,
medya işleri medya_modulu'nde durur. main.py sadece bir santral memurudur.

API limitlerini (Gemini) korumak için: gelen DÜZ metinler yapay zekaya GİTMEZ.
Sadece aşağıdaki KOMUT_TABLOSU'nda kayıtlı "/" ön ekli komutlar işlenir.
Yapay zeka ancak ilgili modül (örn. medya) gerek duyunca tetiklenir.
"""

import logging

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)

import config
import liman_modulu
import medya_modulu

# ----------------------------------------------------------------------------
# Loglama: Konsola ne olup bittiğini düzgün yazsın.
# ----------------------------------------------------------------------------
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("liman_botu")


# ----------------------------------------------------------------------------
# KOMUT TABLOSU (Routing Registry)
# ----------------------------------------------------------------------------
# Bütün modüllerin bağlandığı yer burası. Her satır:
#   "komut_adi": ilgili_modulun_handler_fonksiyonu
#
# >>> YENİ MODÜL EKLEMEK İÇİN (örn. akilli_ev_modulu.py): <<<
#   1) Yeni dosyanı yaz ve içinde "async def handle(update, context)" tanımla.
#   2) Yukarıya  ->  import akilli_ev_modulu  satırını ekle.
#   3) Aşağıdaki tabloya tek satır ekle:
#         "ev": akilli_ev_modulu.handle,
#   4) Bitti. Artık /ev komutu otomatik olarak o modüle gider.
#   main.py'de başka HİÇBİR yeri değiştirmene gerek yok.
# ----------------------------------------------------------------------------
KOMUT_TABLOSU = {
    "liman": liman_modulu.handle,    # /liman ...  -> vardiya / iş takibi
    "izledim": medya_modulu.handle,  # /izledim ... -> Obsidian medya kaydı
    "okudum": medya_modulu.handle,   # /okudum ...  -> manga için aynı modül
    # "ev": akilli_ev_modulu.handle,   # (örnek: ileride açacağın modül)
}


# ----------------------------------------------------------------------------
# Erişim kontrolü: Botu sadece izinli kişiler kullansın.
# ----------------------------------------------------------------------------
def _izinli_mi(update: Update) -> bool:
    if not config.ALLOWED_USER_IDS:
        return True  # Liste boşsa herkese açık.
    user = update.effective_user
    return bool(user and user.id in config.ALLOWED_USER_IDS)


async def baslat(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/start — kısa bir karşılama ve mevcut komutların listesi."""
    komutlar = ", ".join(f"/{k}" for k in KOMUT_TABLOSU)
    await update.message.reply_text(
        "Liman Botu hazır. ⚓\n"
        f"Kullanabileceğin komutlar: {komutlar}"
    )


async def izinsiz(update: Update, _: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("Bu botu kullanma yetkin yok. 🚫")


def main() -> None:
    config.dogrula()

    app = Application.builder().token(config.TELEGRAM_TOKEN).build()

    # /start her zaman çalışsın.
    app.add_handler(CommandHandler("start", baslat))

    # KOMUT_TABLOSU'ndaki her komutu, izin kontrolüyle sarıp kaydet.
    for komut, handler in KOMUT_TABLOSU.items():
        app.add_handler(CommandHandler(komut, _yetki_sarmalayici(handler)))

    logger.info("Bot başlıyor... Kayıtlı komutlar: %s", list(KOMUT_TABLOSU))
    app.run_polling()


def _yetki_sarmalayici(handler):
    """Her modül handler'ını erişim kontrolüyle çevreleyen yardımcı.

    Böylece her modülde tek tek 'bu kullanıcı izinli mi' diye bakmak gerekmez;
    yetki mantığı tek yerde (burada) durur.
    """
    async def sarmalanmis(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not _izinli_mi(update):
            await izinsiz(update, context)
            return
        await handler(update, context)

    return sarmalanmis


if __name__ == "__main__":
    main()
