# Liman Botu — Modüler Telegram Süper Asistanı

Temiz, modüler bir mimari. `main.py` sadece yönlendirir; iş mantığı modüllerde durur.

```
liman_botu/
├── main.py                  # Yönlendirici + otomatik modül yükleyici. İş mantığı yok.
├── config.py                # .env'den tüm ayarları okur. Tek doğruluk kaynağı.
├── moduller/                # Tüm özellik modülleri burada; main.py bunu tarar.
│   ├── __init__.py
│   ├── _sablon.py           # Yeni modül için kopyala-yapıştır şablonu (yüklenmez).
│   ├── liman_modulu.py      # /liman — vardiya & iş takibi (sınıf tabanlı)
│   └── medya_modulu.py      # /izledim, /okudum — Gemini + TMDB/Jikan + Obsidian
├── requirements.txt
└── .env.example             # Kopyala -> .env yap, anahtarları doldur
```

## Kurulum

```bash
cd liman_botu
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # sonra .env içini doldur
python main.py
```

## Modüller nasıl haberleşir? (Otomatik Keşif)

Artık elle bir komut tablosu yok. `main.py` açılışta `moduller/` paketini tarar
ve şu ikisini tanımlayan her dosyayı **otomatik** kaydeder:

```python
KOMUTLAR = ["izledim", "okudum"]          # modülün sahiplendiği komutlar
async def handle(update, context): ...    # standart giriş noktası
```

Telegram'dan `/izledim ...` gelince main.py bunu ilgili modülün `handle`'ına paslar.
Adı `_` ile başlayan dosyalar (örn. `_sablon.py`) ve bu ikisini tanımlamayan
dosyalar sessizce atlanır.

## Yeni modül eklemek (örn. `akilli_ev_modulu.py`)

```bash
cp moduller/_sablon.py moduller/akilli_ev_modulu.py
```

Sonra içindeki `KOMUTLAR` ve `handle`'ı doldur, botu yeniden başlat. `/ev` komutu
otomatik aktif olur — **`main.py`'ye hiç dokunmazsın.**

## API kotası koruması

Düz metinler **asla** yapay zekaya gitmez. Sadece kayıtlı `/` komutları işlenir.
Gemini yalnızca `medya_modulu` içinde, cümleyi ayrıştırırken (ve gerekirse
Jikan özetini çevirirken) tetiklenir.
