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
│   └── medya_modulu.py      # /izledim, /okudum — akıllı seçim + TMDB/Jikan + servisler
├── servisler/               # Paylaşımlı altyapı; modüller buradan import eder.
│   ├── __init__.py
│   ├── gemini.py            # Tek yerden Gemini: uret / json_uret / cevir
│   └── obsidian.py          # Not yazıcısı: kaydet / gunluk_nota_ekle
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

### Butonlar (isteğe bağlı)

Bir modül kullanıcıya buton gösterip cevabını almak isterse (örn. medya modülünün
"🤔 Hangisini kastettin?" sorusu) şu ikisini ek olarak ilan eder:

```python
CALLBACK_AD = "medya"                      # callback_data ön eki
async def callback(update, context): ...   # buton tıklamalarının giriş noktası
```

main.py, `medya:...` ile başlayan tüm buton tıklamalarını bu modüle yönlendirir.
Soru ile cevap arasındaki durum `context.user_data` içinde tutulur.

## Yeni modül eklemek (örn. `akilli_ev_modulu.py`)

```bash
cp moduller/_sablon.py moduller/akilli_ev_modulu.py
```

Sonra içindeki `KOMUTLAR` ve `handle`'ı doldur, botu yeniden başlat. `/ev` komutu
otomatik aktif olur — **`main.py`'ye hiç dokunmazsın.**

## Paylaşımlı servisler (`servisler/`)

Tekrar eden altyapı işleri burada toplanır; modüller bunları import edip kullanır.
Böylece her modül kendi Gemini/dosya kodunu yazmaz, kod tekrarı olmaz.

```python
from servisler import gemini, obsidian

veri  = gemini.json_uret(prompt)          # Gemini'den JSON al
ozet  = gemini.cevir(ingilizce_metin)     # Türkçeye çevir
durum = obsidian.kaydet(                   # not oluştur / kısmi güncelle
    klasor, baslik, frontmatter, govde,
    guncellenebilir_alanlar=["rating"],
)
obsidian.gunluk_nota_ekle(klasor, "satır") # günlük nota madde ekle
```

Gemini tek yerden (tembel singleton) yapılandırılır; modüllerde `genai.configure`
tekrarı yoktur. Yeni bir paylaşımlı bağımlılık (örn. Spotify, Google Sheets)
gerektiğinde `servisler/` altına yeni bir dosya açman yeterli.

## API kotası koruması

Düz metinler **asla** yapay zekaya gitmez. Sadece kayıtlı `/` komutları işlenir.
Gemini yalnızca `medya_modulu` içinde, cümleyi ayrıştırırken (ve gerekirse
Jikan özetini çevirirken) tetiklenir.
