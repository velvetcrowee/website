# Oyunlar

Bu depo, GitHub Pages üzerinde yayınlanan iki web tabanlı uygulamayı barındırır.

## 🧪 Element Simyası

Infinite Craft tarzı, Türkçe, sonsuz element birleştirme oyunu. Ateş, Su,
Toprak ve Hava ile başlayıp yapay zekâ destekli sınırsız yeni kavramlar
keşfedersiniz. Topluluk havuzu, üyelik, liderlik, rozetler, koleksiyonlar ve
çoklu dil desteği içerir.

- **Oyna:** https://velvetcrowee.github.io/website/element-simyasi/
- **Kaynak:** [`element-simyasi/`](./element-simyasi/)
- **Sunucu (Cloudflare Worker):** [`cloudflare-worker/`](./cloudflare-worker/) —
  küresel tarif havuzu, üyelik ve bulut kayıt.

## 🏋️ Fitness Uygulaması

- **Aç:** https://velvetcrowee.github.io/website/
- **Kaynak:** [`fitness-app/`](./fitness-app/)

## Geliştirme

Build adımı yoktur (vanilla JS PWA'lar). Depo kökünden:

```sh
python3 -m http.server 8000
# Oyun:    http://localhost:8000/element-simyasi/
# Fitness: http://localhost:8000/fitness-app/
```

## Dağıtım

`.github/workflows/fitness-app-pages.yml` her iki uygulamayı `_site/` altında
birleştirip GitHub Pages'e yayınlar (master'a push'ta tetiklenir).
