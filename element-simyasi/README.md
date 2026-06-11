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
- **Oyun belleği:** Her birleştirme olayı oyunun belleğine yazılır. Yapay zekâ
  prompt'u bu bellekle beslenir: son keşifler ve oyuncunun kendi tarifleri
  bağlama eklenir, keşif sayısı arttıkça yaratıcılık seviyesi yükselir — oyun
  oynandıkça gelişir.
- **Paylaşılan topluluk belleği:** `recipes.json` repoda barınan, tüm
  oyuncuların açılışta indirdiği ortak tarif paketidir (~130 yaygın birleşim).
  Çözümleme sırası: yerleşik → topluluk → oyuncunun önbelleği → yapay zekâ. Yani
  yaygın ikililer hiçbir zaman API'ye gitmez; bir oyuncunun keşfi pakete
  eklendiğinde herkes için "sistem bilir" hâle gelir. Ayarlar'daki **içe/dışa
  aktar** ile oyuncular tariflerini doğrudan paylaşabilir.
- **Limit dostu:** Gemini'nin "düşünme" tokenları kapatılır (yanıt yarıda
  kesilmez), istekler sıraya alınır (hızlı oynayınca paralel patlama olmaz) ve
  geçici hatalar (limit, yoğunluk, kesik yanıt) kullanıcıya gösterilmeden
  otomatik yeniden denenir.
- **Model rotasyonu:** Gemini'de her modelin kotası ayrıdır. Varsayılan
  `gemini-2.5-flash-lite` (en hızlı, en yüksek ücretsiz limit); 429/503'te
  otomatik olarak `gemini-2.5-flash` → `gemini-2.0-flash`'a geçilir. Tek
  modelin dakika limitine takılıp beklemek yerine üç modelin toplam kotası
  kullanılır.
- **Eğitim verisi:** Ayarlar'dan tüm öğrenilmiş + yerleşik tarifler, yapay zekâ
  ince ayarına hazır JSONL (sohbet biçimi) olarak dışa aktarılabilir.
- **Rozetler ve soy ağacı:** Kilometre taşları rozet kazandırır; Keşif
  Defteri'nde her elementin hikâyesi (açıklama) ve temel elementlere kadar inen
  soy ağacı görüntülenir. WebAudio ile dosyasız ses efektleri vardır.

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
