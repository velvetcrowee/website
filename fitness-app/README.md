# FitTakip — Antrenman & Beslenme Takip Uygulaması

Ağırlık antrenmanı, beslenme, kilo ve takviye takibi için Türkçe, kurulum
gerektirmeyen bir PWA (Progressive Web App). Android'de tarayıcıdan açıp
**"Ana ekrana ekle"** dediğinizde normal bir uygulama gibi çalışır ve
çevrimdışı da açılır.

## Özellikler

- 🏋️ **Antrenman takibi** — Uygulamayı açınca o günün antrenmanını gösterir
  (örn. "Salı — Çekiş Günü"). Hareketler hazır set×tekrar şemasıyla gelir
  (3x12, 4x10 gibi); siz yalnızca kaldırdığınız **ağırlığı** girersiniz.
  Her harekette bir önceki kaydınız gösterilir, gelişiminizi takip edersiniz.
- 🤖 **Yapay zekâ programı** — Claude, hedefinize göre (kilo verme + kas
  kazanımı) hareket isimleriyle birlikte haftalık program oluşturur. API
  anahtarı yoksa hazır bir recomposition programı yüklenir.
- 🍽️ **Yemek fotoğrafı analizi** — Yemeğin fotoğrafını çekin; yapay zekâ ne
  olduğunu tanır, bileşen bileşen kalori tahmini yapar ve hedefinize göre
  yorumlar. Elle giriş de mümkündür.
- ⚖️ **Kilo takibi** — Kilonuzu girin; grafik, aylık değişim ve hedefe kalan
  mesafe otomatik hesaplanır.
- 💊 **Takviye takibi** — Takviyelerinizi ekleyin, her gün aldıklarınızı
  işaretleyin.
- 📤 Tüm veriler cihazda saklanır (localStorage); JSON olarak dışa
  aktarılabilir.

## Çalıştırma

Statik dosyalardır; herhangi bir web sunucusuyla servis edin:

```sh
cd fitness-app
python3 -m http.server 8080
# http://localhost:8080
```

Android'de kullanmak için dosyaları HTTPS sunan bir yere yayınlayın
(GitHub Pages, Netlify vb.), telefonda Chrome ile açın ve
"Ana ekrana ekle" seçeneğini kullanın. (Service worker ve kamera erişimi
için HTTPS gereklidir; `localhost` da çalışır.)

## Yapay zekâ özellikleri

Ayarlar sekmesine bir Anthropic API anahtarı (`sk-ant-...`) girin —
<https://platform.claude.com/> üzerinden alabilirsiniz. Anahtar yalnızca
cihazınızda saklanır ve istekler doğrudan tarayıcınızdan Claude API'ye gider
(model: `claude-opus-4-8`). Anahtarsız da uygulamanın tüm kayıt/takip
özellikleri çalışır; yalnızca fotoğraf analizi ve yapay zekâ önerileri kapalı
olur.

> Not: Kalori tahminleri yaklaşıktır; tıbbi/beslenme tavsiyesi değildir.
