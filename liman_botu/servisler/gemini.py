"""
servisler/gemini.py — Paylaşımlı Gemini erişimi.

Tüm modüller Gemini'ye BURADAN erişir. Amaç:
  * Yapılandırmayı (configure + model) tek yerde, tembel (lazy) ve önbellekli tutmak.
  * Her modülde `genai.configure(...)` tekrarını bitirmek.
  * "JSON üret", "çevir" gibi sık işleri hazır fonksiyona çevirmek.

Önemli: Gemini SADECE bir modül bilerek bu fonksiyonları çağırınca tetiklenir.
main.py asla buraya dokunmaz; API kotası böyle korunur.
"""

import json
import logging
import re

import config

logger = logging.getLogger("liman_botu.servis.gemini")

# Modeli bir kez kurup saklarız (tembel singleton).
_model = None


def _get_model():
    """Gemini modelini ilk çağrıda kurar, sonra önbellekten döner."""
    global _model
    if _model is None:
        import google.generativeai as genai

        if not config.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY ayarlı değil (.env kontrol et).")
        genai.configure(api_key=config.GEMINI_API_KEY)
        _model = genai.GenerativeModel(config.GEMINI_MODEL)
        logger.info("Gemini modeli hazırlandı: %s", config.GEMINI_MODEL)
    return _model


def uret(prompt: str) -> str:
    """Düz metin üretir. En temel çağrı."""
    yanit = _get_model().generate_content(prompt)
    return (yanit.text or "").strip()


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
