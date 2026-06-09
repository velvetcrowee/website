# Kurulum Rehberi — Liman Botu

> **Önemli:** Bot, notları **lokal Obsidian klasörüne** yazar. Bu yüzden botu,
> Obsidian vault'unun bulunduğu **kendi bilgisayarında** çalıştırmalısın.

---

## 0. Mevcut Asya Port kodunu taşı (ÖNEMLİ)

Senin çalışan liman botun (`scraper.py`, `formatter.py`, `chart.py`,
`amf_client.py`, `shift_manager.py`, `shifts.json`) artık yeni modüler botun
**liman modülü** olarak çalışıyor. Bu dosyaları `liman_botu/` klasörünün
**içine** kopyala:

```
liman_botu/
├── main.py            (yeni)
├── config.py          (yeni — eski config.py'nin yerine, ikisi birleştirildi)
├── scraper.py         ← senin dosyan, buraya kopyala
├── formatter.py       ← senin dosyan, buraya kopyala
├── chart.py           ← senin dosyan, buraya kopyala
├── amf_client.py      ← senin dosyan, buraya kopyala
├── shift_manager.py   ← senin dosyan, buraya kopyala
├── shifts.json        ← senin dosyan, buraya kopyala
├── moduller/
│   └── liman_modulu.py  (yeni — eski bot.py'nin işini yapıyor)
└── servisler/
```

> **Eski `bot.py` ve eski `config.py`'yi KOPYALAMA.** Onların işini artık
> `main.py` + `moduller/liman_modulu.py` + yeni `config.py` yapıyor.
> Eski `config.py`'deki tüm ayarlar (port URL, vardiya saatleri, timezone)
> yeni `config.py`'ye taşındı.

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
TELEGRAM_BOT_TOKEN=BotFather'dan aldığın token
TELEGRAM_CHAT_ID=senin Telegram ID'in
GEMINI_API_KEY=...
TMDB_API_KEY=...
RAWG_API_KEY=...

# Obsidian klasörlerini KENDİ vault yoluna göre yaz (TAM yol):
OBSIDIAN_MEDYA_PATH=C:/Users/SENIN_ADIN/Obsidian/Vault/Medya
OBSIDIAN_OYUN_PATH=C:/Users/SENIN_ADIN/Obsidian/Vault/Oyunlar
OBSIDIAN_FINANS_PATH=C:/Users/SENIN_ADIN/Obsidian/Vault/Finans
```

> Eski botun `.env`'i zaten `TELEGRAM_BOT_TOKEN` ve `TELEGRAM_CHAT_ID`
> kullanıyordu — aynen geçerli, yeni isim aramana gerek yok.
> Windows yollarında ters slash yerine **düz slash** (`/`) kullan.
> `TELEGRAM_CHAT_ID`'yi bilmiyorsan: botu çalıştır, Telegram'da **/kimlik** yaz.

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
