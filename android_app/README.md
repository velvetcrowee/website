# Liman Asistanı — Android (Chaquopy) Uygulaması

Kotlin arayüz + gömülü Python motoru. Tüm "akıl" Python'da (`python/engine.py`),
tüm "görüntü" Kotlin'de. En zor parça (AMF gemi çekici) Python'da aynen korunur.

```
android_app/
├── python/
│   ├── engine.py          # Kotlin'in çağırdığı, JSON döndüren fonksiyonlar
│   └── liman_gemi_cek.py  # AMF gemi çekici (değişmedi)
└── README.md
```

## Motor fonksiyonları (Kotlin bunları çağırır, hepsi JSON string döndürür)

| Fonksiyon | Ne yapar |
|-----------|----------|
| `yapilandir(gemini_key, tmdb_key, rawg_key)` | Anahtarları ayarlar (uygulama ayar ekranından) |
| `hava(sorgu)` | 24 saatlik tahmin → `{konum, saatler:[{saat,sicaklik,emoji}]}` |
| `liman_gemiler(gun_once, gun_sonra)` | Gemi listesi → `{gemiler:[{ad,rihtim,yanasma,kalkis,durum}]}` |
| `medya_ara(cumle)` | Ayrıştır + adaylar → `{veri, adaylar:[...]}` |
| `medya_sonlandir(veri_json, aday_json)` | Seçilen kaydı döndürür (Kotlin DB'ye yazar) |
| `finans_ayristir(cumle)` | Harcamayı kategorize eder |
| `oyun_ara(cumle)` / `oyun_sonlandir(...)` | Oyun arama + kayıt |

Her cevap: `{"ok": true, "veri": {...}}` veya `{"ok": false, "hata": "..."}`.

---

## Android Studio kurulumu (adım adım)

### 1. Android Studio'yu kur
[developer.android.com/studio](https://developer.android.com/studio) → indir, kur.

### 2. Yeni proje
- **New Project → Empty Activity (Compose)**
- Dil: **Kotlin**, Minimum SDK: **24** (Android 7.0)

### 3. Chaquopy eklentisini ekle
**`settings.gradle.kts`** → pluginManagement içine repo (genelde hazır gelir).

**Proje düzeyi `build.gradle.kts`** → plugins:
```kotlin
plugins {
    id("com.chaquo.python") version "16.0.0" apply false
}
```

**Modül (`app`) `build.gradle.kts`** → plugins:
```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.chaquo.python")          // <-- ekle
}

android {
    defaultConfig {
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }  // telefon + emülatör
    }
}

chaquopy {
    defaultConfig {
        version = "3.11"
        pip {
            install("requests")       // motorun tek bağımlılığı
        }
    }
}
```

### 4. Python dosyalarını koy
`app/src/main/python/` klasörü oluştur, içine **`engine.py`** ve
**`liman_gemi_cek.py`** dosyalarını kopyala.

### 5. Kotlin'den çağır (örnek)
```kotlin
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import org.json.JSONObject

// Uygulama açılışında bir kez:
if (!Python.isStarted()) Python.start(AndroidPlatform(this))
val engine = Python.getInstance().getModule("engine")

// Anahtarları ayarla (kullanıcının girdiği değerler):
engine.callAttr("yapilandir", geminiKey, tmdbKey, rawgKey)

// Hava durumu çek (ağ işi olduğu için ARKA PLAN thread'inde çağır!):
val json = engine.callAttr("hava", "barbaros tekirdağ").toString()
val obj = JSONObject(json)
if (obj.getBoolean("ok")) {
    val veri = obj.getJSONObject("veri")
    val konum = veri.getString("konum")
    val saatler = veri.getJSONArray("saatler")   // [{saat,sicaklik,emoji}]
    // ekranda göster
} else {
    // obj.getString("hata") -> kullanıcıya göster
}
```
> ⚠️ Python ağ çağrıları **ana thread'de çağrılmaz** (uygulama donar/çöker).
> `lifecycleScope.launch(Dispatchers.IO) { ... }` içinde çağır.

### 6. İnternet izni
`AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

---

## Yol haritası (önerilen sıra)
1. ✅ Python motoru (bu klasör) — hazır.
2. ⬜ Android Studio + Chaquopy iskeleti, tek ekran: **Hava durumu** (en kolay, anahtarsız) → "uçtan uca çalışıyor mu" testi.
3. ⬜ **Ayarlar ekranı** — Gemini/TMDB/RAWG anahtarlarını gir, kalıcı sakla (DataStore).
4. ⬜ **Gemi listesi** ekranı + **çizelge** (Kotlin Compose Canvas ile native çizim).
5. ⬜ **Medya** (arama → buton seçimi → yerel DB) ve **finans/oyun**.
6. ⬜ Yerel veritabanı (Room) — medya/finans/oyun kayıtları için.

## Notlar
- Anahtarlar `.env`'de değil; uygulama içinde (DataStore) saklanır, açılışta `yapilandir`'a verilir.
- Çizelge matplotlib YERİNE Kotlin'de çizilir (native, akıcı). Python sadece gemi verisini verir.
- Medya/finans kayıtları telefonda yerel DB'de tutulur (Obsidian klasörü yok).
