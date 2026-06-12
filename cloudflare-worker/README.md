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

## Kurulum (yaklaşık 5 dakika)

1. **Cloudflare hesabı** açın (ücretsiz): https://dash.cloudflare.com/sign-up

2. Bilgisayarınızda (Node.js kuruluysa) şu komutları çalıştırın:

   ```sh
   npm install -g wrangler
   cd cloudflare-worker
   wrangler login                          # tarayıcıda Cloudflare'e izin verin
   wrangler kv namespace create RECIPES    # çıktıdaki id'yi kopyalayın
   ```

3. `wrangler.toml` içindeki `KV_NAMESPACE_ID_BURAYA` yazısını az önce
   kopyaladığınız id ile değiştirin.

4. Yayınlayın:

   ```sh
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

> Komut satırı kullanmak istemezseniz: dash.cloudflare.com → **Workers &
> Pages → Create Worker** deyip `worker.js` içeriğini editöre yapıştırın,
> ardından Worker ayarlarından **KV Namespace Binding** ekleyin
> (isim: `RECIPES`).

## Uçlar

| Uç | Açıklama |
|---|---|
| `GET /` | Havuz durumu (tarif sayısı) |
| `GET /pack` | Tüm havuz (oyun açılışta bunu indirir) |
| `POST /recipe` | `{ key, result }` — yeni tarif ekler; var olanın üzerine yazmaz (ilk yazan kazanır, havuz deterministik kalır) |

## Notlar

- Sunucuda **API anahtarı yoktur**; havuz yalnızca sonuçları saklar. Anahtarlar
  oyuncuların cihazında kalmaya devam eder.
- Girdiler sunucuda doğrulanır (uzunluk/alan sınırları), havuz 50.000 tarifle
  sınırlıdır.
- Eşzamanlı iki yazma nadiren birbirini ezebilir (KV "son yazan kazanır");
  oyun için zararsızdır — kaybolan tarif bir dahaki sefere yeniden eklenir.
