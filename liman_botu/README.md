# Liman Botu — Modüler Telegram Süper Asistanı

Temiz, modüler bir mimari. `main.py` sadece yönlendirir; iş mantığı modüllerde durur.

```
liman_botu/
├── main.py            # Ana yönlendirici (santral). İş mantığı yok.
├── config.py          # .env'den tüm ayarları okur. Tek doğruluk kaynağı.
├── liman_modulu.py    # /liman — vardiya & iş takibi (sınıf tabanlı)
├── medya_modulu.py    # /izledim, /okudum — Gemini + TMDB/Jikan + Obsidian
├── requirements.txt
└── .env.example       # Kopyala -> .env yap, anahtarları doldur
```

## Kurulum

```bash
cd liman_botu
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # sonra .env içini doldur
python main.py
```

## Modüller nasıl haberleşir?

`main.py` içindeki **KOMUT_TABLOSU** tek bağlantı noktasıdır:

```python
KOMUT_TABLOSU = {
    "liman":   liman_modulu.handle,
    "izledim": medya_modulu.handle,
    "okudum":  medya_modulu.handle,
}
```

Telegram'dan `/izledim ...` gelince main.py bunu `medya_modulu.handle`'a paslar.
Her modülde standart bir imza vardır: `async def handle(update, context)`.

## Yeni modül eklemek (örn. `akilli_ev_modulu.py`)

1. Dosyayı oluştur, içine `async def handle(update, context): ...` yaz.
2. `main.py`'ye `import akilli_ev_modulu` ekle.
3. `KOMUT_TABLOSU`'na `"ev": akilli_ev_modulu.handle,` satırını ekle.
4. Bitti — `/ev` komutu artık otomatik çalışır. Başka yeri değiştirmen gerekmez.

## API kotası koruması

Düz metinler **asla** yapay zekaya gitmez. Sadece kayıtlı `/` komutları işlenir.
Gemini yalnızca `medya_modulu` içinde, cümleyi ayrıştırırken (ve gerekirse
Jikan özetini çevirirken) tetiklenir.
