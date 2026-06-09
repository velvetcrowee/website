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

from telegram import BotCommand, Update
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
def moduller_yukle() -> tuple[dict, dict, list]:
    """`moduller/` paketini tarar; komut, callback ve setup hook'larını toplar.

    Bir modül şunları (hepsi opsiyonel) ilan edebilir:
      * KOMUTLAR = ["x"] + handle        -> hepsi tek handle'a gider (basit modül)
      * KOMUT_HANDLERS = {"x": fn, ...}  -> her komut kendi fonksiyonuna gider
                                            (çok komutlu modüller için, örn. liman)
      * CALLBACK_AD + callback           -> "ad:..." ile başlayan buton tıklamaları
      * async def setup(app)             -> zamanlanmış görev/menü kurulumu

    Returns:
        (komut_tablosu, callback_tablosu, setup_hooklari)
    """
    komut_tablosu: dict = {}
    callback_tablosu: dict = {}
    setup_hooklari: list = []
    aciklamalar: dict = {}   # {komut: "menüde görünecek açıklama"}

    def _komut_ekle(komut, fn, ad):
        if komut in komut_tablosu:
            logger.warning(
                "Komut çakışması: /%s zaten kayıtlı, '%s' modülü eziyor.", komut, ad,
            )
        komut_tablosu[komut] = fn
        logger.info("Kaydedildi: /%s -> %s", komut, ad)

    for modul_bilgi in pkgutil.iter_modules(moduller.__path__):
        ad = modul_bilgi.name
        if ad.startswith("_"):
            continue  # __init__ vb. atla

        try:
            modul = importlib.import_module(f"moduller.{ad}")
        except Exception:  # noqa: BLE001 — bir modülün eksik bağımlılığı diğerlerini batırmasın
            logger.exception("Modül yüklenemedi, atlanıyor: %s", ad)
            continue

        # --- Basit komutlar: KOMUTLAR + handle (hepsi tek handle'a) ---
        komutlar = getattr(modul, "KOMUTLAR", None)
        handler = getattr(modul, "handle", None)
        if komutlar and callable(handler):
            for komut in komutlar:
                _komut_ekle(komut, handler, ad)

        # --- Çok komutlu: KOMUT_HANDLERS = {komut: fonksiyon} ---
        komut_handlers = getattr(modul, "KOMUT_HANDLERS", None)
        if isinstance(komut_handlers, dict):
            for komut, fn in komut_handlers.items():
                if callable(fn):
                    _komut_ekle(komut, fn, ad)

        # --- Menü açıklamaları (opsiyonel): KOMUT_ACIKLAMA = {komut: "açıklama"} ---
        modul_aciklama = getattr(modul, "KOMUT_ACIKLAMA", None)
        if isinstance(modul_aciklama, dict):
            aciklamalar.update(modul_aciklama)

        # --- Callback (buton) ---
        callback_ad = getattr(modul, "CALLBACK_AD", None)
        callback_fn = getattr(modul, "callback", None)
        if callback_ad and callable(callback_fn):
            callback_tablosu[callback_ad] = callback_fn
            logger.info("Callback kaydedildi: %s: -> %s", callback_ad, ad)

        # --- Setup hook (zamanlanmış görev / menü kurulumu) ---
        setup_fn = getattr(modul, "setup", None)
        if callable(setup_fn):
            setup_hooklari.append(setup_fn)
            logger.info("Setup hook bulundu: %s", ad)

    return komut_tablosu, callback_tablosu, setup_hooklari, aciklamalar


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

    komut_tablosu, callback_tablosu, setup_hooklari, aciklamalar = moduller_yukle()

    app = Application.builder().token(config.TELEGRAM_TOKEN).build()

    # /start her zaman çalışsın (keşfedilen komutları listeler).
    app.add_handler(CommandHandler("start", _start_handler(komut_tablosu)))

    # Keşfedilen her komutu, izin kontrolüyle sarıp kaydet.
    for komut, handler in komut_tablosu.items():
        app.add_handler(CommandHandler(komut, _yetki_sarmalayici(handler)))

    # Tüm buton tıklamaları tek yönlendiriciden geçer (callback_data ön ekine göre).
    if callback_tablosu:
        app.add_handler(CallbackQueryHandler(_callback_yonlendirici(callback_tablosu)))

    # Bot başlarken: (1) Telegram komut menüsünü TÜM modüllerden topla,
    #                (2) modüllerin setup hook'larını (zamanlanmış görevler) çalıştır.
    async def _post_init(application):
        # Telegram'da "/" yazınca çıkan menü — keşfedilen her komut burada.
        komut_menusu = [
            BotCommand(k, aciklamalar.get(k, k)) for k in sorted(komut_tablosu)
        ]
        try:
            await application.bot.set_my_commands(komut_menusu)
        except Exception:  # noqa: BLE001
            logger.exception("Komut menüsü ayarlanamadı")
        for setup_fn in setup_hooklari:
            try:
                await setup_fn(application)
            except Exception:  # noqa: BLE001 — bir modül patlasa bot ayakta kalsın
                logger.exception("Setup hook hatası")
    app.post_init = _post_init

    logger.info(
        "Bot başlıyor... Komutlar: %s | Callback'ler: %s",
        sorted(komut_tablosu), sorted(callback_tablosu),
    )
    app.run_polling()


if __name__ == "__main__":
    main()
