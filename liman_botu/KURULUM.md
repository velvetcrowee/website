# Kurulum Rehberi — Liman Botu

> **Önemli:** Bot, notları **lokal Obsidian klasörüne** yazar. Bu yüzden botu,
> Obsidian vault'unun bulunduğu **kendi bilgisayarında** çalıştırmalısın.

---

## 1. Python'u kur

- [python.org/downloads](https://www.python.org/downloads/) adresinden **Python 3.10+** indir.
- **Windows'ta kurulumda "Add Python to PATH" kutusunu mutlaka işaretle.**
- Kontrol et (terminal/PowerShell):
  ```bash
  python --version
  ```

## 2. Kodu bilgisayarına indir

Git kuruluysa:
```bash
git clone https://github.com/velvetcrowee/website.git
cd website
git checkout claude/telegram-modular-bot-architecture-9fu2nx
cd liman_botu
```

Git yoksa: GitHub'da repo sayfasında **Code → Download ZIP** ile indir, aç,
içindeki `liman_botu` klasörüne gir.

## 3. Sanal ortam + kütüphaneler

```bash
# Sanal ortam oluştur
python -m venv .venv

# Etkinleştir:
#   Windows (PowerShell):
.venv\Scripts\Activate.ps1
#   Mac / Linux:
source .venv/bin/activate

# Kütüphaneleri kur
pip install -r requirements.txt
```

## 4. API anahtarlarını al

| Anahtar | Nereden | Zorunlu mu? |
|---------|---------|-------------|
| **Telegram Token** | Telegram'da [@BotFather](https://t.me/BotFather) → `/newbot` | ✅ Evet |
| **Telegram User ID** | [@userinfobot](https://t.me/userinfobot)'a yaz, ID'ni verir | ✅ Evet |
| **Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | ✅ (medya/finans için) |
| **TMDB** | [themoviedb.org → Settings → API](https://www.themoviedb.org/settings/api) | ⬜ (sadece /izledim) |
| **RAWG** | [rawg.io/apidocs](https://rawg.io/apidocs) | ⬜ (sadece /oynadim) |
| Hava durumu | — | ⬜ Anahtar gerekmez (Open-Meteo) |

### BotFather adımları
1. Telegram'da `@BotFather`'a yaz → `/newbot`
2. Bota bir isim ve kullanıcı adı ver (`...bot` ile bitmeli).
3. Sana `123456:ABC-DEF...` gibi bir **token** verir → kopyala.

## 5. `.env` dosyasını oluştur

`.env.example` dosyasını kopyalayıp `.env` yap:
```bash
# Windows:
copy .env.example .env
# Mac / Linux:
cp .env.example .env
```

Sonra `.env` dosyasını bir metin editörüyle aç ve doldur:
```ini
TELEGRAM_TOKEN=BotFather'dan aldığın token
ALLOWED_USER_IDS=senin Telegram ID'in
GEMINI_API_KEY=...
TMDB_API_KEY=...
RAWG_API_KEY=...

# Obsidian klasörlerini KENDİ vault yoluna göre yaz (TAM yol):
OBSIDIAN_MEDYA_PATH=C:/Users/SENIN_ADIN/Obsidian/Vault/Medya
OBSIDIAN_OYUN_PATH=C:/Users/SENIN_ADIN/Obsidian/Vault/Oyunlar
OBSIDIAN_FINANS_PATH=C:/Users/SENIN_ADIN/Obsidian/Vault/Finans
```

> Windows yollarında ters slash yerine **düz slash** (`/`) kullan, en kolayı budur.

## 6. Botu çalıştır

```bash
python main.py
```

Konsolda şunu görmelisin:
```
Bot başlıyor... Komutlar: ['harcama', 'havadurumu', 'izledim', ...]
```

Artık Telegram'da botuna git ve `/start` yaz. 🎉

---

## Sık karşılaşılan sorunlar

- **`/start`'a cevap yok:** `TELEGRAM_TOKEN` yanlış ya da `python main.py` çalışmıyor.
- **"Bu botu kullanma yetkin yok":** `.env`'deki `ALLOWED_USER_IDS` senin ID'in değil.
- **Medya/finans hata veriyor:** `GEMINI_API_KEY` eksik/yanlış.
- **Not oluşmuyor:** `OBSIDIAN_*_PATH` yolları yanlış. Klasörler yoksa bot otomatik
  oluşturur, ama üst klasör (vault) var olmalı.
- **Bilgisayarı kapatınca bot duruyor:** Normal. Bot, `python main.py` çalıştığı
  sürece açıktır. Sürekli açık kalsın istersen 7/24 açık bir makinede (eski telefon,
  Raspberry Pi, ucuz VPS) çalıştırman gerekir — ama o zaman Obsidian klasörünün de
  o makinede olması gerekir.
