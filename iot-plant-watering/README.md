# 🌱 Akıllı Bitki Sulama Sistemi (ESP32)

Evdeki bitkiyi **otomatik sular**, sensör verilerini **internetten her yerden**
gösterir ve istediğin an **uzaktan "Şimdi Sula"** dersin.

## İçindekiler

```
iot-plant-watering/
├── firmware/
│   ├── plant_watering.ino     ESP32 kodu (Arduino)
│   └── config.example.h       Ayar şablonu -> config.h olarak kopyala
├── dashboard/
│   ├── index.html             İnternet paneli (telefon/bilgisayar)
│   ├── app.js                 MQTT bağlantısı + komutlar
│   └── styles.css
├── docs/
│   └── wiring.md              Bağlantı şeması + güç uyarıları
└── README.md
```

## 🧰 Malzemeler

| # | Parça | Açıklama |
|---|---|---|
| 1 | **ESP32 DevKit** | WiFi'li mikrodenetleyici (beyin) |
| 1 | **4 kanallı röle modülü** | senin "4'lü enerji kesici" — pompayı açıp kapatır |
| 1 | **5V mini su pompası** | suyu bitkiye basar |
| 1 | **DHT22** | sıcaklık + hava nemi |
| 1 | **LDR ışık modülü** | ortam ışığı (analog AO çıkışlı) |
| 1 | **Kapasitif toprak nem sensörü** | toprağın nemi (aşağıdaki nota bak) |
| 1 | **Ayrı 5V besleme** | pompa için (USB adaptör/powerbank) |
| – | jumper kablo, hortum, su kabı | |

> Şema ve pin bağlantıları: **[docs/wiring.md](docs/wiring.md)**

---

## ⚠️ "Toprak sensörü doğru çalışmıyor" — büyük ihtimalle nedeni

En sık sebep: **dirençli (siyah çatallı) toprak sensörü** kullanıyor olman.
Bu tip sensörler birkaç günde **elektroliz/korozyona** uğrar, değerleri kayar ve
"saçmalamaya" başlar. Çözüm sırasıyla:

1. **Kapasitif sensöre geç** (üzerinde "Capacitive Soil Moisture v1.2" yazan,
   çatalı olmayan düz tip). Korozyona uğramaz, çok daha kararlıdır.
2. **3.3V'tan besle**, 5V'tan değil. 5V ESP32'nin ADC'sini bozar/yanıltır.
3. **GPIO 34/35 gibi ADC1 pinleri** kullan. ESP32'de WiFi açıkken **ADC2
   pinleri (GPIO 2,4,12–15,25–27...) okuma yapmaz** — bu çok yaygın bir tuzaktır.
4. **Kalibre et** (aşağıda). Kalibrasyon yapılmazsa yüzde değeri anlamsız olur.
5. Kabloları kontrol et: kopuk/temassız hatlarda ham değer 0 veya 4095'e
   yapışır. Firmware bunu algılayıp panelde **"⚠️ sensör şüpheli"** uyarısı verir
   ve bu durumda **otomatik sulamayı durdurur** (güvenlik).

---

## 🚀 Kurulum

### 1) Donanımı bağla
[docs/wiring.md](docs/wiring.md) tablosuna göre bağla. **Pompayı mutlaka ayrı 5V
beslemeden** besle ve tüm GND'leri ortakla.

### 2) Arduino IDE hazırlığı
- Kart yöneticisinden **ESP32** paketini kur, kart: *ESP32 Dev Module*.
- Kütüphaneler: **DHT sensor library** (Adafruit) + **Adafruit Unified Sensor**,
  **PubSubClient** (Nick O'Leary).

### 3) Ayarları gir
- `firmware/config.example.h` dosyasını **`config.h`** olarak kopyala.
- WiFi adı/şifresini yaz.
- `DEVICE_ID`'yi **tahmin edilemez, benzersiz** bir metinle değiştir
  (örn. `velvet-plant-7f3a9c`). Public broker kullandığımız için bu senin
  "gizli kanalın" olur.

### 4) Yükle
ESP32'yi USB'den bağla, doğru port'u seç, **Upload**. Seri Monitör'ü (115200)
açarsan IP adresini ve bağlantı durumunu görürsün.

### 5) Toprak sensörünü kalibre et
Seri Monitör'de `soilRaw` değerine bak:
- Sensörü **kuru havada/kuru toprakta** tut → çıkan sayıyı `SOIL_DRY_RAW` yap.
- Sensörü **bir bardak suya** batır → çıkan sayıyı `SOIL_WET_RAW` yap.
- `config.h`'i güncelle, tekrar yükle. Artık % değeri doğru.

### 6) Paneli aç
İki seçenek:
- **Yerel (LAN):** tarayıcıdan `http://<esp32-ip>/` adresine gir. Aynı WiFi'de
  çalışır, kurulum gerektirmez.
- **İnternet (her yerden):** `dashboard/` klasörünü bir yere yayınla
  (örn. GitHub Pages). `dashboard/app.js` içindeki `DEVICE_ID`'yi `config.h`
  ile **aynı** yap. Panel MQTT/WebSocket ile bağlanır — **port yönlendirme
  gerekmez**, mobil veride de çalışır.

---

## 🌐 Nasıl çalışıyor? (internet erişimi)

```
[ESP32] --(WiFi)--> [HiveMQ public MQTT broker] <--(WebSocket)-- [Web Paneli]
   ▲  sensör verisi yayınlar (plant/<ID>/telemetry)        verileri gösterir
   └──────── "water" / "stop" komutunu dinler (plant/<ID>/cmd) ◄── butonlar
```

- ESP32 sensör verilerini 5 sn'de bir yayınlar.
- Panel bunları canlı gösterir; "Şimdi Sula" butonu komut yollar.
- Hepsi bulut broker üzerinden gittiği için **evdeki modeme dokunmadan**,
  her yerden erişilir.

> **Güvenlik notu:** HiveMQ public broker herkese açıktır; `DEVICE_ID` tek
> koruman. Ciddi kullanım için ücretsiz **HiveMQ Cloud** hesabı açıp
> kullanıcı adı/şifre ekleyebilirsin (broker adresini `config.h` ve `app.js`'te
> değiştir).

---

## 🤖 Otomatik sulama mantığı

`config.h` içinden ayarlanır:

| Ayar | Anlamı |
|---|---|
| `SOIL_WATER_BELOW` | Toprak nemi bu %'nin altına düşerse otomatik sular |
| `PUMP_RUN_SECONDS` | Her sulamada pompa kaç saniye çalışır |
| `PUMP_MAX_SECONDS` | Güvenlik: tek seferde asla aşılmaz |
| `WATER_COOLDOWN_MIN` | İki otomatik sulama arası min. süre (su baskınını önler) |
| `AUTO_MODE_DEFAULT` | Açılışta otomatik mod açık mı |

**Güvenlik önlemleri:** açılışta pompa kapalı; sensör şüpheliyse otomatik
sulama durur; pompa süresi `PUMP_MAX_SECONDS` ile sınırlı; bekleme süresi
(cooldown) ile sürekli sulama engellenir.

---

## 🔧 Sık sorunlar

| Belirti | Çözüm |
|---|---|
| Toprak % hep 0 veya 100 | ADC2 pinine bağlamışsın → GPIO 34/35'e al; kalibrasyon yap |
| Pompa kendiliğinden çalışıyor/ters | `RELAY_ACTIVE_LOW`'u 0/1 arasında değiştir |
| ESP32 pompa çalışınca resetleniyor | Pompayı ayrı 5V'tan besle, ortak GND ver |
| Panel "bağlanıyor"da kalıyor | `DEVICE_ID` iki tarafta aynı mı; ağda WebSocket (8884) açık mı |
| DHT22 `null` | DATA pull-up'ı ekle, ilk okuma 2 sn gecikebilir |
