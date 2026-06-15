# 🌐 Element Simyası — Küresel Tarif Havuzu

> **Önemli:** Bu kurulumu yalnızca **site sahibi, bir kez** yapar.
> Oyuncuların Cloudflare ile hiçbir işi yoktur — site sahibi havuzu kurup
> adresi oyuna yazdıktan sonra herkes **otomatik** bağlanır.

Bu Worker, tüm oyuncuların yapay zekâ keşiflerini **tek bir küresel havuzda**
toplar:

- Bir oyuncu yeni bir ikili keşfettiğinde sonuç havuza yazılır.
- Diğer oyuncular oyunu açtığında havuzu indirir → aynı ikili **dünyada
  yalnızca bir kez** yapay zekâya sorulur.
- Sonuç: çok daha az Gemini isteği, çok daha az limit beklemesi ve herkes için
  ortak, tutarlı bir oyun dünyası.

Cloudflare'in ücretsiz katmanı bu iş için fazlasıyla yeterlidir
(günde 100.000 istek).

## Depolama: D1 (tarifler) + KV (üyelik)

Tarif havuzu **Cloudflare D1** (SQLite) içinde, satır başına bir tarif olarak
tutulur — günde **100.000 yazma** hakkı vardır (eski KV "pack" yönteminin
1000/gün limitinin çok üstünde, bu yüzden yoğun günlerde oyun artık kilitlenmez).
Kullanıcılar, oturum tokenları ve bulut kayıtlar TTL gerektirdiğinden **KV**'de
kalır. D1 tablosu boşsa Worker, eski KV "pack" anahtarındaki tarifleri **ilk
istekte otomatik olarak** D1'e taşır (tekrar çalışsa da güvenli).

## Kurulum (yaklaşık 5 dakika)

1. **Cloudflare hesabı** açın (ücretsiz): https://dash.cloudflare.com/sign-up

2. Bilgisayarınızda (Node.js kuruluysa) şu komutları çalıştırın:

   ```sh
   npm install -g wrangler
   cd cloudflare-worker
   wrangler login                          # tarayıcıda Cloudflare'e izin verin
   wrangler kv namespace create RECIPES    # çıktıdaki id'yi kopyalayın
   wrangler d1 create simya-db             # çıktıdaki database_id'yi kopyalayın
   ```

3. `wrangler.toml` içindeki `KV_NAMESPACE_ID_BURAYA` ve
   `D1_DATABASE_ID_BURAYA` yazılarını az önce kopyaladığınız id'lerle
   değiştirin.

4. D1 tablosunu oluşturun ve yayınlayın:

   ```sh
   wrangler d1 execute simya-db --file schema.sql
   wrangler deploy
   ```

   Komut size şöyle bir adres verir:
   `https://simya-havuz.<kullanici>.workers.dev`

5. **Adresi oyuna gömün (tek satır):** `element-simyasi/game.js` dosyasındaki

   ```js
   const DEFAULT_POOL_URL = "";
   ```

   satırına Worker adresinizi yazın:

   ```js
   const DEFAULT_POOL_URL = "https://simya-havuz.<kullanici>.workers.dev";
   ```

   Değişikliği master'a gönderin — site yeniden yayınlanır ve **tüm
   oyuncular kendiliğinden havuza bağlanır**. Kimsenin ayar girmesi gerekmez.

   > İpucu: Bu satırı kendiniz düzenlemek istemezseniz Worker adresini
   > Claude'a söylemeniz yeterli; tek satırı yazıp yayınlar.

> Komut satırı kullanmak istemezseniz panelden: dash.cloudflare.com →
> **Workers & Pages → Create Worker** deyip `worker.js` içeriğini editöre
> yapıştırın, ardından Worker → **Settings → Bindings** altından şunları
> ekleyin:
> - **KV Namespace Binding** — isim: `RECIPES`
> - **D1 Database Binding** — isim: `DB`, veritabanı: `simya-db`
>
> D1 tablosunu da bir kez oluşturun: **Storage & Databases → D1 → simya-db →
> Console** açıp `schema.sql` içeriğini çalıştırın.

## Ortak yapay zekâ: anahtarı sunucuya gömme (isteğe bağlı, önerilen)

> ⚠️ API anahtarını **asla oyun koduna/siteye yazmayın** — kod herkese açıktır,
> anahtar dakikalar içinde çalınır. Anahtarın güvenli yeri burası, sunucudur.

Bir yapay zekâ anahtarını Worker'a **gizli değişken** olarak eklerseniz, kendi
anahtarı olmayan TÜM oyuncular otomatik olarak ortak yapay zekâyı kullanır
(anahtar tarayıcıya hiç inmez). İki sağlayıcı desteklenir:

- **`GEMINI_KEY`** — Google Gemini (ÜCRETSİZ katman, **önerilen birincil**).
  Ücretsiz anahtar: https://aistudio.google.com/apikey
- **`DEEPSEEK_KEY`** — DeepSeek (ücretli, **yedek**).

Worker önce **ücretsiz Gemini'yi** dener; Gemini limitine/​hataya takılırsa
DeepSeek'e düşer. Böylece ücretli DeepSeek bakiyeniz çok daha uzun dayanır
(yalnızca Gemini yetmeyince harcanır). En az birini eklemeniz yeterlidir;
ikisini birden eklemek en sağlamıdır.

```sh
cd cloudflare-worker
wrangler secret put GEMINI_KEY      # önerilen (ücretsiz)
wrangler secret put DEEPSEEK_KEY    # isteğe bağlı yedek
wrangler deploy
```

Panelden: Worker → **Settings → Variables and Secrets → Add → Secret**,
isim: `GEMINI_KEY` (ve/veya `DEEPSEEK_KEY`).

Korumalar: sonuçlar önce havuzdan döner (tekrar sorular bedava), IP başına
dakikada 35 yeni istek sınırı vardır ve `deepseek-chat` çok ucuz olduğu için
2$ bakiye ~binlerce birleşime yeter.

## Uçlar

| Uç | Açıklama |
|---|---|
| `GET /` | Havuz durumu (tarif sayısı, depo türü, ortak yapay zekâ açık mı) |
| `GET /pack` | Tüm havuz (oyun açılışta bunu indirir) |
| `GET /leaderboard` | En çok "dünya ilki" keşfe sahip oyuncular |
| `POST /recipe` | `{ key, result }` — yeni tarif ekler; var olanın üzerine yazmaz (ilk yazan kazanır, havuz deterministik kalır) |
| `POST /combine` | `{ a:{name,emoji}, b:{name,emoji} }` — havuzdan, yoksa ortak yapay zekâdan tarif döndürür |
| `POST /register`, `/login`, `/save`, `/load` · `GET /checkname` | Üyelik ve bulut kayıt (KV) |

## Notlar

- Sunucuda **API anahtarı yoktur**; havuz yalnızca sonuçları saklar. Anahtarlar
  oyuncuların cihazında kalmaya devam eder.
- Girdiler sunucuda doğrulanır (uzunluk/alan sınırları).
- Tarifler D1'de `INSERT OR IGNORE` ile yazılır: **ilk yazan kazanır**, eşzamanlı
  yazmalar birbirini ezmez (eski KV "son yazan kazanır" sorunu yoktur).
- D1'in günlük 100.000 yazma hakkı, KV'nin 1000'ine göre çok daha yüksektir;
  yoğun günlerde de havuza yazma kesilmez.
