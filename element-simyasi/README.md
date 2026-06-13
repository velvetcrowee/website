# 🧪 Element Simyası

Infinite Craft tarzı, Türkçe, sonsuz element birleştirme oyunu. Ateş 🔥, Su 💧,
Toprak 🌍 ve Hava 💨 ile başlayıp elementleri sürükleyip üst üste bırakarak yeni
elementler keşfedersiniz — Karadelik'e, Film'e ve ötesine kadar.

## Nasıl çalışır?

- **Yerleşik tarifler:** ~40 klasik birleşim (Ateş + Su = Buhar gibi) anahtar
  gerektirmeden çalışır.
- **Sınırsız mod:** Bilinmeyen her ikiliyi yapay zekâ üretir. Ayarlar'dan üç
  sağlayıcıdan biri için anahtar girin — anahtarlar yalnızca cihazınızda
  (localStorage) saklanır:
  - **Gemini** (Google) — ücretsiz anahtar: aistudio.google.com/apikey
  - **DeepSeek** — ucuz ve güçlü: platform.deepseek.com (OpenAI uyumlu, JSON modu)
  - **Claude** (Anthropic) — platform.claude.com
- **Kalıcılık:** Keşfedilen her element, tarif önbelleği, istatistikler ve tuval
  durumu cihazda saklanır. Aynı ikili yapay zekâya yalnızca bir kez sorulur;
  A+B ile B+A aynı sonucu verir.
- **Oyun belleği:** Her birleştirme olayı oyunun belleğine yazılır. Yapay zekâ
  prompt'u bu bellekle beslenir: son keşifler ve oyuncunun kendi tarifleri
  bağlama eklenir, keşif sayısı arttıkça yaratıcılık seviyesi yükselir — oyun
  oynandıkça gelişir.
- **Panelde birleştirme:** Sağ paneldeki birleştirme çubuğu artık masaüstünde
  de görünür — element chip'ine tıklayınca `[A] + [B] = [?]` çubuğunda birleşir,
  tuvale getirmeye gerek kalmaz. Ayrıca bir chip'i başka bir chip'in (veya
  tuvaldeki bir öğenin) üstüne sürükleyerek de doğrudan birleştirebilirsiniz.
- **🎲 Şanslı birleştirme & 📣 paylaş:** Başlıktaki zar tuşu rastgele iki
  elementi birleştirir; Keşif Defteri'ndeki paylaş tuşu skorunuzu (Web Share /
  pano) paylaşır.
- **🏆 Liderlik tablosu:** Keşif Defteri, havuzdaki "ilk keşfedenleri" sayıp en
  çok dünya-ilkine sahip oyuncuları sıralar; kendi sıranız vurgulanır. Defterde
  ayrıca "kaç elementi dünyada ilk siz buldunuz" sayacı gösterilir.
- **Üyelik (benzersiz kullanıcı adı):** Ayarlar → Profil'den kullanıcı adı +
  şifre ile kayıt olunur; havuz sunucusu adların benzersiz olmasını garanti
  eder (kimse aynı adı alamaz). Giriş yapıldığında bu ad, ilk keşiflerde
  kimliğiniz olur. Şifreler sunucuda tuzlanmış SHA-256 ile saklanır, düz metin
  tutulmaz. Üye olmadan da misafir olarak oynanabilir.
- **Bulut kayıt (cihazlar arası senkron):** Giriş yapıldığında keşfettiğiniz
  elementler, tarifler, istatistikler ve rozetler hesabınıza bağlı olarak
  buluta kaydedilir (`/save`, `/load`). Telefonda oynayıp PC'de giriş yapınca
  ilerlemeniz gelir; iki taraf sunucuda birleştirilir, biri diğerini ezmez.
- **İlk keşfeden:** Bir elementi dünyada ilk keşfeden oyuncunun adı ve tarihi
  havuzda kalıcı kaydedilir; element detayında ve keşif defterinde
  "🥇 İlk bulan: …" olarak görünür. Giriş yapıldıysa kimlik token ile
  sunucuda doğrulanır (sahte ad gönderilemez).
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
- **Rozetler, kategoriler, hedefler ve soy ağacı:** Kilometre taşları rozet
  kazandırır. Her element 9 kategoriden birine girer (Doğa, Canlılar, Yiyecek,
  İnsan & Toplum, Teknoloji, Uzay, Mitoloji & Sihir, Kültür & Soyut, Diğer);
  panelde kategoriye göre filtrelenir. Tuvalin köşesinde bir **hedef** gösterilir
  — henüz bulunmamış bir elementi keşfetmeniz istenir, tamamlayınca kutlama ve
  yeni hedef gelir. Keşif Defteri'nde her elementin hikâyesi, kategorisi ve
  temel elementlere inen soy ağacı görüntülenir. WebAudio ile dosyasız ses
  efektleri vardır.
- **Küresel havuz (isteğe bağlı):** `cloudflare-worker/` altındaki Worker
  kurulup adresi Ayarlar'a girilirse, tüm oyuncuların yapay zekâ keşifleri tek
  bir küresel havuzda toplanır — aynı ikili dünyada yalnızca bir kez sorulur,
  Gemini istekleri ciddi biçimde azalır. Kurulum: `cloudflare-worker/README.md`.

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
