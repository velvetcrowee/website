"""
servisler/obsidian.py — Paylaşımlı Obsidian not yazıcısı.

Genel amaçlıdır: medya modülüne özel DEĞİL. İleride finans, not, kitap gibi
modüller de buradan yazar. Dataview uyumlu YAML frontmatter üretir.

Sunduğu işler:
  * kaydet(...)          -> yoksa oluştur, varsa SADECE belirli alanları güncelle
  * gunluk_nota_ekle(...) -> günlük nota (daily note) satır ekler
"""

import logging
import os
import re
from datetime import date

logger = logging.getLogger("liman_botu.servis.obsidian")


def guvenli_dosya_adi(baslik: str) -> str:
    """Başlıktan dosya sistemi için güvenli bir ad üretir."""
    return re.sub(r"[^\w\s-]", "", baslik).strip().replace(" ", "_")


def _yaml_deger(deger) -> str:
    """Tek bir değeri YAML/Dataview dostu biçime sokar."""
    if deger is None:
        return ""
    if isinstance(deger, bool):
        return "true" if deger else "false"
    if isinstance(deger, (int, float)):
        return str(deger)
    if isinstance(deger, (list, tuple)):
        return "[" + ", ".join(str(x) for x in deger) + "]"
    # String: tırnak içine al (Dataview metin alanlarını böyle sever).
    return f'"{deger}"'


def frontmatter_olustur(alanlar: dict) -> str:
    """Sözlükten YAML frontmatter bloğu (--- ... ---) üretir."""
    satirlar = ["---"]
    for anahtar, deger in alanlar.items():
        satirlar.append(f"{anahtar}: {_yaml_deger(deger)}")
    satirlar.append("---")
    return "\n".join(satirlar)


def _alan_guncelle(icerik: str, alan: str, deger) -> str:
    """Frontmatter içindeki tek bir alanı yeni değerle değiştirir (varsa)."""
    if deger is None:
        return icerik
    return re.sub(
        rf"^({alan}:).*$",
        rf"\g<1> {_yaml_deger(deger)}",
        icerik,
        count=1,
        flags=re.MULTILINE,
    )


def kaydet(
    klasor: str,
    baslik: str,
    frontmatter: dict,
    govde: str = "",
    guncellenebilir_alanlar: list | None = None,
) -> str:
    """Notu oluşturur ya da varsa sadece seçili alanları günceller.

    Args:
        klasor: Notun yazılacağı Obsidian klasörü (tam yol).
        baslik: Dosya adı + başlık.
        frontmatter: YAML alanları (sözlük).
        govde: Frontmatter'dan sonraki Markdown gövdesi (yeni dosyalar için).
        guncellenebilir_alanlar: Dosya zaten varsa SADECE bu alanlar güncellenir
            (örn. ["rating", "current_episode"]). None ise dosya olduğu gibi kalır.

    Returns:
        Kullanıcıya gösterilecek kısa durum mesajı.
    """
    os.makedirs(klasor, exist_ok=True)
    yol = os.path.join(klasor, f"{guvenli_dosya_adi(baslik)}.md")

    if os.path.exists(yol):
        with open(yol, "r", encoding="utf-8") as f:
            icerik = f.read()
        for alan in (guncellenebilir_alanlar or []):
            icerik = _alan_guncelle(icerik, alan, frontmatter.get(alan))
        # "guncelleme" alanı varsa otomatik bugüne çek.
        if "guncelleme" in frontmatter:
            icerik = _alan_guncelle(icerik, "guncelleme", date.today().isoformat())
        with open(yol, "w", encoding="utf-8") as f:
            f.write(icerik)
        logger.info("Güncellendi: %s", yol)
        return f"♻️ Güncellendi: {baslik}"

    # "guncelleme" alanı boş bırakıldıysa oluştururken bugüne çek.
    if frontmatter.get("guncelleme") == "":
        frontmatter = {**frontmatter, "guncelleme": date.today().isoformat()}

    icerik = frontmatter_olustur(frontmatter)
    if govde:
        icerik += "\n\n" + govde
    with open(yol, "w", encoding="utf-8") as f:
        f.write(icerik + "\n")
    logger.info("Oluşturuldu: %s", yol)
    return f"✅ Oluşturuldu: {baslik}"


def _yaml_coz(deger: str):
    """YAML değerini Python'a çevirir (tırnak/sayı/liste için basit ayrıştırma)."""
    deger = deger.strip()
    if deger.startswith("[") and deger.endswith("]"):
        return [x.strip().strip('"') for x in deger[1:-1].split(",") if x.strip()]
    if deger.startswith('"') and deger.endswith('"'):
        return deger[1:-1]
    if deger.lstrip("-").isdigit():
        return int(deger)
    return deger


def frontmatter_oku(yol: str) -> dict:
    """Bir .md dosyasının YAML frontmatter'ını sözlüğe çevirir."""
    with open(yol, "r", encoding="utf-8") as f:
        icerik = f.read()
    if not icerik.startswith("---"):
        return {}
    son = icerik.find("\n---", 3)
    if son == -1:
        return {}
    alanlar = {}
    for satir in icerik[3:son].strip().splitlines():
        if ":" in satir:
            anahtar, _, ham = satir.partition(":")
            alanlar[anahtar.strip()] = _yaml_coz(ham)
    return alanlar


def notlari_listele(klasor: str) -> list[dict]:
    """Klasördeki tüm notların frontmatter'larını liste olarak döndürür.

    /listem gibi "veritabanını geri okuyan" komutlar için. Klasör yoksa boş döner.
    """
    if not os.path.isdir(klasor):
        return []
    sonuc = []
    for ad in os.listdir(klasor):
        if ad.endswith(".md"):
            fm = frontmatter_oku(os.path.join(klasor, ad))
            if fm:
                sonuc.append(fm)
    return sonuc


def gunluk_nota_ekle(klasor: str, satir: str) -> str:
    """Bugünün günlük notuna (YYYY-MM-DD.md) bir madde ekler.

    Not, finans/hızlı-not gibi modüller için pratik bir paylaşımlı yardımcıdır.
    """
    os.makedirs(klasor, exist_ok=True)
    yol = os.path.join(klasor, f"{date.today().isoformat()}.md")
    with open(yol, "a", encoding="utf-8") as f:
        f.write(f"- {satir}\n")
    return f"📝 Günlük nota eklendi: {satir}"
