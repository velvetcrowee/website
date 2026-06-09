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

Bir modül İSTEĞE BAĞLI olarak buton (inline keyboard) tıklamalarına da cevap
verebilir. Bunun için şunları ilan eder:
    CALLBACK_AD = "medya"                  # callback_data'nın ön eki / ad alanı
    async def callback(update, context)    # buton tıklamalarının giriş noktası
main.py, "medya:..." ile başlayan tüm callback'leri ilgili modüle yönlendirir.

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
    CallbackQueryHandler,
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
def moduller_yukle() -> tuple[dict, dict]:
    """`moduller/` paketini tarar; komut ve callback tablolarını inşa eder.

    Komut için iki şart: modülde `KOMUTLAR` listesi + `handle` fonksiyonu.
    Callback (buton) için iki şart: `CALLBACK_AD` + `callback` fonksiyonu (opsiyonel).

    Returns:
        (komut_tablosu, callback_tablosu)
          komut_tablosu:    {komut_adi: handle_fn}
          callback_tablosu: {callback_ad: callback_fn}
    """
    komut_tablosu: dict = {}
    callback_tablosu: dict = {}

    for modul_bilgi in pkgutil.iter_modules(moduller.__path__):
        ad = modul_bilgi.name
        if ad.startswith("_"):
            continue  # __init__ vb. atla

        modul = importlib.import_module(f"moduller.{ad}")

        # --- Komutlar ---
        komutlar = getattr(modul, "KOMUTLAR", None)
        handler = getattr(modul, "handle", None)
        if komutlar and callable(handler):
            for komut in komutlar:
                if komut in komut_tablosu:
                    logger.warning(
                        "Komut çakışması: /%s zaten kayıtlı, '%s' modülü eziyor.",
                        komut, ad,
                    )
                komut_tablosu[komut] = handler
                logger.info("Kaydedildi: /%s -> %s", komut, ad)
        else:
            logger.debug("Komut atlandı (KOMUTLAR/handle yok): %s", ad)

        # --- Callback (buton) ---
        callback_ad = getattr(modul, "CALLBACK_AD", None)
        callback_fn = getattr(modul, "callback", None)
        if callback_ad and callable(callback_fn):
            callback_tablosu[callback_ad] = callback_fn
            logger.info("Callback kaydedildi: %s: -> %s", callback_ad, ad)

    return komut_tablosu, callback_tablosu


# ----------------------------------------------------------------------------
# Erişim kontrolü
# ----------------------------------------------------------------------------
def _izinli_mi(update: Update) -> bool:
    if not config.ALLOWED_USER_IDS:
        return True  # Liste boşsa herkese açık.
    user = update.effective_user
    return bool(user and user.id in config.ALLOWED_USER_IDS)


def _yetki_sarmalayici(handler):
    """Komut handler'ını erişim kontrolüyle çevreler.

    Böylece yetki mantığı tek yerde durur; modüller bununla uğraşmaz.
    """
    async def sarmalanmis(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not _izinli_mi(update):
            await update.message.reply_text("Bu botu kullanma yetkin yok. 🚫")
            return
        await handler(update, context)

    return sarmalanmis


def _callback_yonlendirici(callback_tablosu: dict):
    """Tüm buton tıklamalarını tek noktadan ilgili modüle dağıtır.

    callback_data biçimi: "<ad>:<modüle özel veri>"  (örn. "medya:2")
    İlk ':' öncesi ad alanına bakılır ve o modülün callback'i çağrılır.
    """
    async def yonlendir(update: Update, context: ContextTypes.DEFAULT_TYPE):
        sorgu = update.callback_query
        if not _izinli_mi(update):
            await sorgu.answer("Yetkin yok.", show_alert=True)
            return
        ad = (sorgu.data or "").split(":", 1)[0]
        callback_fn = callback_tablosu.get(ad)
        if callback_fn is None:
            await sorgu.answer("Bilinmeyen işlem.")
            return
        await callback_fn(update, context)

    return yonlendir


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

    komut_tablosu, callback_tablosu = moduller_yukle()

    app = Application.builder().token(config.TELEGRAM_TOKEN).build()

    # /start her zaman çalışsın (keşfedilen komutları listeler).
    app.add_handler(CommandHandler("start", _start_handler(komut_tablosu)))

    # Keşfedilen her komutu, izin kontrolüyle sarıp kaydet.
    for komut, handler in komut_tablosu.items():
        app.add_handler(CommandHandler(komut, _yetki_sarmalayici(handler)))

    # Tüm buton tıklamaları tek yönlendiriciden geçer (callback_data ön ekine göre).
    if callback_tablosu:
        app.add_handler(CallbackQueryHandler(_callback_yonlendirici(callback_tablosu)))

    logger.info(
        "Bot başlıyor... Komutlar: %s | Callback'ler: %s",
        sorted(komut_tablosu), sorted(callback_tablosu),
    )
    app.run_polling()


if __name__ == "__main__":
    main()
