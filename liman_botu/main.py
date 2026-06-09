"""
main.py — Ana Yönlendirici (Dispatcher) + Otomatik Modül Yükleyici.

Görevi TEK ŞEY: Telegram'dan gelen komutları dinlemek ve doğru modüle paslamak.
Burada hiçbir iş mantığı (business logic) yoktur. Liman işleri liman_modulu'nde,
medya işleri medya_modulu'nde durur. main.py sadece bir santral memurudur.

API limitlerini (Gemini) korumak için: gelen DÜZ metinler yapay zekaya GİTMEZ.
Sadece modüllerin ilan ettiği "/" ön ekli komutlar işlenir. Yapay zeka ancak
ilgili modül (örn. medya) gerek duyunca tetiklenir.

>>> OTOMATİK MODÜL KEŞFİ <<<
Artık komutları elle bir tabloya yazmıyoruz. main.py açılışta `moduller/`
paketini tarar ve şu iki şeyi tanımlayan her dosyayı OTOMATİK kaydeder:
    KOMUTLAR = ["komut_adi", ...]        # modülün sahiplendiği komutlar
    async def handle(update, context)    # standart giriş noktası

>>> YENİ MODÜL EKLEMEK (örn. akilli_ev_modulu.py): <<<
    1) moduller/akilli_ev_modulu.py dosyasını oluştur.
    2) İçine şunları yaz:
           KOMUTLAR = ["ev"]
           async def handle(update, context): ...
    3) Bitti. /ev komutu otomatik çalışır. main.py'ye HİÇ dokunmana gerek yok.
"""

import importlib
import logging
import pkgutil

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)

import config
import moduller  # tarayacağımız paket

# ----------------------------------------------------------------------------
# Loglama
# ----------------------------------------------------------------------------
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("liman_botu")


# ----------------------------------------------------------------------------
# OTOMATİK MODÜL KEŞFİ
# ----------------------------------------------------------------------------
def komut_tablosu_olustur() -> dict:
    """`moduller/` paketini tarar ve {komut: handler} tablosunu inşa eder.

    Bir modülün kaydedilmesi için iki şart:
      * modül seviyesinde `KOMUTLAR` listesi olmalı
      * `handle` adında bir fonksiyon olmalı
    Bu ikisinden biri eksikse modül sessizce atlanır (yardımcı dosyalar,
    __init__.py vb. bozmasın diye).
    """
    tablo: dict = {}

    for modul_bilgi in pkgutil.iter_modules(moduller.__path__):
        ad = modul_bilgi.name
        if ad.startswith("_"):
            continue  # __init__ vb. atla

        modul = importlib.import_module(f"moduller.{ad}")
        komutlar = getattr(modul, "KOMUTLAR", None)
        handler = getattr(modul, "handle", None)

        if not komutlar or not callable(handler):
            logger.debug("Atlandı (KOMUTLAR/handle yok): %s", ad)
            continue

        for komut in komutlar:
            if komut in tablo:
                logger.warning(
                    "Komut çakışması: /%s zaten kayıtlı, '%s' modülü eziyor.",
                    komut, ad,
                )
            tablo[komut] = handler
            logger.info("Kaydedildi: /%s -> %s", komut, ad)

    return tablo


# ----------------------------------------------------------------------------
# Erişim kontrolü
# ----------------------------------------------------------------------------
def _izinli_mi(update: Update) -> bool:
    if not config.ALLOWED_USER_IDS:
        return True  # Liste boşsa herkese açık.
    user = update.effective_user
    return bool(user and user.id in config.ALLOWED_USER_IDS)


def _yetki_sarmalayici(handler):
    """Her modül handler'ını erişim kontrolüyle çevreler.

    Böylece yetki mantığı tek yerde durur; modüller bununla uğraşmaz.
    """
    async def sarmalanmis(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not _izinli_mi(update):
            await update.message.reply_text("Bu botu kullanma yetkin yok. 🚫")
            return
        await handler(update, context)

    return sarmalanmis


# ----------------------------------------------------------------------------
# /start
# ----------------------------------------------------------------------------
def _start_handler(komut_tablosu: dict):
    async def baslat(update: Update, _: ContextTypes.DEFAULT_TYPE) -> None:
        komutlar = ", ".join(f"/{k}" for k in sorted(komut_tablosu))
        await update.message.reply_text(
            "Liman Botu hazır. ⚓\n"
            f"Kullanabileceğin komutlar: {komutlar or '(henüz yok)'}"
        )
    return baslat


def main() -> None:
    config.dogrula()

    komut_tablosu = komut_tablosu_olustur()

    app = Application.builder().token(config.TELEGRAM_TOKEN).build()

    # /start her zaman çalışsın (keşfedilen komutları listeler).
    app.add_handler(CommandHandler("start", _start_handler(komut_tablosu)))

    # Keşfedilen her komutu, izin kontrolüyle sarıp kaydet.
    for komut, handler in komut_tablosu.items():
        app.add_handler(CommandHandler(komut, _yetki_sarmalayici(handler)))

    logger.info("Bot başlıyor... Aktif komutlar: %s", sorted(komut_tablosu))
    app.run_polling()


if __name__ == "__main__":
    main()
