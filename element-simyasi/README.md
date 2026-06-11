# 🧪 Element Simyası

Infinite Craft tarzı, Türkçe, sonsuz element birleştirme oyunu. Ateş 🔥, Su 💧,
Toprak 🌍 ve Hava 💨 ile başlayıp elementleri sürükleyip üst üste bırakarak yeni
elementler keşfedersiniz — Karadelik'e, Film'e ve ötesine kadar.

## Nasıl çalışır?

- **Yerleşik tarifler:** ~40 klasik birleşim (Ateş + Su = Buhar gibi) anahtar
  gerektirmeden çalışır.
- **Sınırsız mod:** Bilinmeyen her ikiliyi yapay zekâ üretir. Ayarlar'dan ücretsiz
  bir Gemini anahtarı (aistudio.google.com/apikey) veya Claude anahtarı girin.
  Anahtarlar yalnızca cihazınızda (localStorage) saklanır.
- **Kalıcılık:** Keşfedilen her element, tarif önbelleği, istatistikler ve tuval
  durumu cihazda saklanır. Aynı ikili yapay zekâya yalnızca bir kez sorulur;
  A+B ile B+A aynı sonucu verir.

## Geliştirme

Build adımı yoktur. Depo kökünden:

```sh
python3 -m http.server 8000
# http://localhost:8000/element-simyasi/
```

### Anahtarsız test (mock modu)

`http://localhost:8000/element-simyasi/?mock=1` — bilinmeyen ikililer için ağ
çağrısı yapmadan deterministik sahte sonuç üretir; önbellek, keşif kaydı ve
arayüz akışının tamamı test edilebilir.

## Dosyalar

| Dosya | Görev |
|---|---|
| `data.js` | localStorage katmanı (`simya.` öneki), Türkçe-güvenli normalizasyon |
| `seed.js` | Başlangıç elementleri + yerleşik tarifler |
| `ai.js` | Gemini/Claude istemcisi, birleştirme prompt'u, mock modu |
| `game.js` | Tarif çözümleme (seed → önbellek → AI), keşif kaydı |
| `app.js` | Arayüz: sürükle-bırak, mobil birleştirme çubuğu, modallar |
