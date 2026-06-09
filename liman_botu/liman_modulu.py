"""
liman_modulu.py — Liman işleri (vardiya, iş takibi vb.).

Bu modül main.py'den BAĞIMSIZ düşünülmeli: main.py sadece /liman komutunu
buradaki `handle` fonksiyonuna paslar. Geri kalan her şey burada döner.

İş mantığını bir sınıf (LimanYoneticisi) içinde topladım; böylece ileride
durum (state), veritabanı bağlantısı vb. eklemek istediğinde tek yerden
yönetirsin. handle() ise sadece komutu ayrıştırıp sınıfa yönlendiren ince
bir köprüdür.
"""

import logging

from telegram import Update
from telegram.ext import ContextTypes

logger = logging.getLogger("liman_botu.liman")


class LimanYoneticisi:
    """Liman ile ilgili tüm işlevlerin toplandığı sınıf.

    Şimdilik iskelet. Eski taslaklardaki fonksiyonlarını buradaki metotlara
    taşıyabilirsin (vardiya başlat/bitir, rapor, vb.).
    """

    def vardiya_baslat(self, kullanici: str) -> str:
        # TODO: gerçek vardiya başlatma mantığı (kayıt, saat, vs.)
        return f"⚓ Vardiya başladı. İyi çalışmalar {kullanici}."

    def vardiya_bitir(self, kullanici: str) -> str:
        # TODO: süre hesabı, özet, kayıt.
        return "🛑 Vardiya kapatıldı. Kayıt alındı."

    def durum(self) -> str:
        # TODO: aktif iş / bekleyen iş özeti.
        return "📋 Şu an aktif bir vardiya bilgisi yok (iskelet)."


# Modül seviyesinde tek bir örnek (singleton gibi). main.py durum tutmaz,
# durum burada yaşar.
_yonetici = LimanYoneticisi()


# --- Alt komut tablosu --------------------------------------------------------
# /liman <alt_komut> ...  şeklinde gelenleri buradan dağıtıyoruz.
def _alt_komutlar(yonetici: LimanYoneticisi, kullanici: str) -> dict:
    return {
        "basla": lambda _args: yonetici.vardiya_baslat(kullanici),
        "bitir": lambda _args: yonetici.vardiya_bitir(kullanici),
        "durum": lambda _args: yonetici.durum(),
    }


async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """main.py'nin çağırdığı giriş noktası.

    Örnek mesaj: "/liman basla"  ->  context.args == ["basla"]
    """
    args = context.args  # /liman'dan sonraki kelimeler (liste)
    kullanici = update.effective_user.first_name if update.effective_user else "Kaptan"

    if not args:
        await update.message.reply_text(
            "Liman komutları: /liman basla | /liman bitir | /liman durum"
        )
        return

    alt = args[0].lower()
    tablo = _alt_komutlar(_yonetici, kullanici)

    if alt not in tablo:
        await update.message.reply_text(f"Bilinmeyen liman komutu: {alt}")
        return

    cevap = tablo[alt](args[1:])
    await update.message.reply_text(cevap)
