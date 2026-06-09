"""
servisler/gemini.py — Paylaşımlı Gemini erişimi.

Tüm modüller Gemini'ye BURADAN erişir. Amaç:
  * Yapılandırmayı (configure + model) tek yerde, tembel (lazy) ve önbellekli tutmak.
  * Her modülde `genai.configure(...)` tekrarını bitirmek.
  * "JSON üret", "çevir" gibi sık işleri hazır fonksiyona çevirmek.
  * Model adı değişse/emekliye ayrılsa bile ÇALIŞAN modeli otomatik bulmak.

Önemli: Gemini SADECE bir modül bilerek bu fonksiyonları çağırınca tetiklenir.
main.py asla buraya dokunmaz; API kotası böyle korunur.
"""

import json
import logging
import re

import config

logger = logging.getLogger("liman_botu.servis.gemini")

# Sırayla denenecek model adayları. İlk çalışan önbelleğe alınır.
# (Google zaman zaman model adlarını değiştirdiği için liste tutuyoruz.)
_ADAY_MODELLER = [
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.0-flash-001",
    "gemini-1.5-flash",
]

_genai = None        # configure edilmiş modül (tembel)
_model = None        # çalıştığı doğrulanmış model nesnesi (önbellek)
_model_adi = None    # çalışan modelin adı


def _ensure_genai():
    """google-generativeai'yi bir kez configure eder, sonra önbellekten döner."""
    global _genai
    if _genai is None:
        import google.generativeai as genai
        if not config.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY ayarlı değil (.env kontrol et).")
        genai.configure(api_key=config.GEMINI_API_KEY)
        _genai = genai
        logger.info("Gemini yapılandırıldı.")
    return _genai


def _aday_sirasi() -> list[str]:
    """Önce .env'deki tercih, sonra aday liste (tekrarsız)."""
    tercih = config.GEMINI_MODEL
    return [tercih] + [m for m in _ADAY_MODELLER if m != tercih]


def uret(prompt: str) -> str:
    """Düz metin üretir. Çalışan modeli otomatik bulur ve önbelleğe alır."""
    global _model, _model_adi
    genai = _ensure_genai()

    # Daha önce çalışan bir model bulduysak direkt onu kullan.
    if _model is not None:
        yanit = _model.generate_content(prompt)
        return (yanit.text or "").strip()

    # İlk çağrı: adayları sırayla dene, çalışanı önbelleğe al.
    son_hata = None
    for ad in _aday_sirasi():
        try:
            model = genai.GenerativeModel(ad)
            yanit = model.generate_content(prompt)
            _model, _model_adi = model, ad
            logger.info("Gemini modeli seçildi: %s", ad)
            return (yanit.text or "").strip()
        except Exception as e:  # noqa: BLE001 — 404/uyumsuz modeli atla, sıradakini dene
            logger.warning("Model '%s' çalışmadı: %s", ad, e)
            son_hata = e
    raise RuntimeError(
        "Hiçbir Gemini modeli çalışmadı. .env'e GEMINI_MODEL=... ile geçerli bir "
        f"model yazabilirsin. Son hata: {son_hata}"
    )


def json_uret(prompt: str) -> dict:
    """Gemini'den JSON ister ve sözlüğe çevirir.

    Model bazen ```json ... ``` ile sarar; içindeki saf JSON sökülür.
    """
    ham = uret(prompt)
    eslesme = re.search(r"\{.*\}", ham, re.DOTALL)
    if not eslesme:
        raise ValueError(f"Gemini'den JSON alınamadı: {ham!r}")
    return json.loads(eslesme.group(0))


def cevir(metin: str, hedef_dil: str = "Türkçe") -> str:
    """Verilen metni hedef dile kısaca çevirir. Boş metinde boş döner."""
    if not metin:
        return ""
    return uret(
        f"Aşağıdaki metni akıcı ve kısa bir {hedef_dil}ye çevir, "
        f"sadece çeviriyi yaz:\n\n{metin}"
    )
