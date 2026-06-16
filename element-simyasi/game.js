/* Oyun mantığı — tarif çözümleme (seed → önbellek → yapay zekâ), keşif kaydı
   ve istatistikler. Arayüzden bağımsızdır; konsoldan da test edilebilir. */

/* Aynı ikili için eşzamanlı ikinci istek atılmasın. */
const inFlight = new Set();

/* Yapay zekâ istekleri sıraya alınır: hızlı oynayınca paralel çağrı atıp
   limite takılmamak için aynı anda yalnızca bir istek gider, aralarına küçük
   bir bekleme konur. Seed/önbellek isabetleri kuyruğa girmez, anında döner. */
let aiQueue = Promise.resolve();
function enqueueAi(task) {
	const run = aiQueue.then(task, task);
	// Kuyruğun bir sonraki işe geçmeden önce kısa nefes alması (limit dostu).
	// Düşük tutuldu: hızlı oynamak için sıradaki istek çabuk başlasın.
	aiQueue = run.then(() => sleepGame(120), () => sleepGame(120));
	return run;
}
const sleepGame = (ms) => new Promise((r) => setTimeout(r, ms));

/* Topluluk tarif paketi: tüm oyuncuların paylaştığı ortak bellek. Açılışta
   recipes.json'dan indirilip belleğe katılır; bir oyuncunun keşfettiği yaygın
   birleşimler bu pakete eklendiğinde herkes için "sistem bilir" hâle gelir ve
   yapay zekâya gerek kalmaz. */
let COMMUNITY_RECIPES = {};

/* Sitenin yerleşik küresel havuzu. Site sahibi cloudflare-worker/ altındaki
   Worker'ı BİR KEZ kurup adresini buraya yazar; ondan sonra HER oyuncu
   otomatik bağlanır — oyuncuların hiçbir şey yapması gerekmez.
   Boşken havuz devre dışıdır; Ayarlar'daki alan kişisel havuz kullananlar
   için geçersiz kılma (override) görevi görür. */
const DEFAULT_POOL_URL = "https://simya-havuz.alituna5923.workers.dev";

function activePoolUrl() {
	return (Store.settings.poolUrl || DEFAULT_POOL_URL).replace(/\/+$/, "");
}

/* Küratörlü yerleşik paket (recipes.json) — bir kez indirilir, bellekte tutulur. */
let CURATED_RECIPES = null;
/* Küresel havuzun yerel kopyası — localStorage'da kalıcı; açılışta anında yüklenir
   ve sunucudan yalnızca DELTA (yeni tarifler) çekilerek güncellenir. Böylece
   havuz 5000+ olsa da her açılış/yenilemede tüm paket baştan inmez. */
let POOL_RECIPES = null;
let POOL_CURSOR = null;  // bu sekmenin işlediği son rowid; sekme-içi tutarlı kalır
const POOL_CAP = 20000;  // güvenlik sınırı: ~1.8 MB; aşılırsa en eski girdiler düşer

function capPool(pool) {
	const keys = Object.keys(pool);
	if (keys.length <= POOL_CAP) return pool;
	const out = {};
	for (const k of keys.slice(keys.length - POOL_CAP)) out[k] = pool[k];
	return out;
}

async function loadCommunityRecipes() {
	// 1) Küratörlü yerleşik tarifler (bir kez).
	if (!CURATED_RECIPES) {
		CURATED_RECIPES = {};
		try {
			const res = await fetch("recipes.json", { cache: "no-cache" });
			if (res.ok) CURATED_RECIPES = await res.json();
		} catch { /* çevrimdışı — yerleşik tarifler yeter */ }
	}
	// 2) Havuzun kalıcı kopyasını ve imleci bir kez yükle (anında açılış). İkisi de
	//    sekme-içi bellekte tutulur ki delta her zaman bu sekmenin POOL'uyla uyumlu
	//    ilerlesin (çok-sekme durumunda her sekme kendi tam kopyasını tamamlar).
	if (!POOL_RECIPES) POOL_RECIPES = DB.read("poolCache", {}) || {};
	if (POOL_CURSOR === null) POOL_CURSOR = DB.read("poolCursor", 0) || 0;

	// 3) Sunucudan yalnızca delta çek: imleçten (rowid) sonraki yeni tarifler.
	const poolUrl = activePoolUrl();
	if (poolUrl) {
		try {
			// Farklı imleç → farklı URL olduğundan yanıt zaten tazedir (?t/no-store gerekmez).
			const res = await fetch(poolUrl + "/pack" + (POOL_CURSOR ? "?since=" + POOL_CURSOR : ""));
			if (res.ok) {
				const delta = await res.json();
				const newCursor = parseInt(res.headers.get("X-Pool-Cursor") || "0", 10) || 0;
				if (Object.keys(delta).length) {
					Object.assign(POOL_RECIPES, delta);
					POOL_RECIPES = capPool(POOL_RECIPES);
					try { DB.write("poolCache", POOL_RECIPES); } catch { /* kota — bellekte kalır */ }
				}
				if (newCursor > POOL_CURSOR) { POOL_CURSOR = newCursor; DB.write("poolCursor", newCursor); }
			}
		} catch { /* havuza ulaşılamadı — yerel kopyayla devam */ }
	}

	// Yerel küratörlü paket önceliklidir; havuz boşlukları doldurur.
	COMMUNITY_RECIPES = { ...POOL_RECIPES, ...CURATED_RECIPES };
	lastPoolChanged = reconcileElements();
	return COMMUNITY_RECIPES;
}
let lastPoolChanged = false;

/* Tutarlılık: keşfedilen elementlerin emoji/kategorisini paylaşılan kanonik
   tarife (seed → recipes.json → havuz) eşitler. Böylece aynı element herkeste
   aynı emojiyle görünür — farklı oyuncuların yereldeki farklı AI çıktıları
   havuzun ilk-yazan sürümüne yakınsar. */
function reconcileElements() {
	const canon = {};
	for (const r of Object.values(COMMUNITY_RECIPES)) {
		if (r && r.name && !canon[norm(r.name)]) canon[norm(r.name)] = r;
	}
	const els = Store.elements;
	let changed = false;
	for (const k of Object.keys(els)) {
		const c = canon[k];
		if (!c) continue;
		if (c.emoji && els[k].emoji !== c.emoji) { els[k].emoji = c.emoji; changed = true; }
		if (c.cat && els[k].cat !== c.cat) { els[k].cat = c.cat; changed = true; }
		// İlk-keşfeden de havuzun kanonik sürümüne eşitlenir: iyimser olarak
		// kendini ilk sanan oyuncu, havuz başkasını söylüyorsa düzeltilir.
		if (c.by && (els[k].firstBy !== c.by || els[k].firstAt !== c.at)) {
			els[k].firstBy = c.by;
			els[k].firstAt = c.at || els[k].firstAt;
			changed = true;
		}
	}
	if (changed) Store.elements = els;
	return changed;
}

/* Yapay zekânın ürettiği yeni tarifi küresel havuza gönderir (beklemeden).
   İlk keşfeden bilgisi (takma ad + tarih) de eklenir; havuz ilk yazanı saklar. */
function pushToPool(key, result) {
	const poolUrl = activePoolUrl();
	if (!poolUrl) return;
	fetch(poolUrl + "/recipe", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ key, result, by: getNickname(), token: getToken(), at: result.at || new Date().toISOString() }),
	}).catch(() => { /* havuz isteğe bağlı */ });
}

/* ---------- Bulut kayıt (hesaba bağlı ilerleme senkronu) ---------- */

let _saveTimer = null;
let _lastSaveAt = 0;
let _savePending = false;
/* Bulut kaydı KV'ye yazıyor ve KV ücretsiz katmanı günde yalnızca 1000 yazma
   veriyor. Bu yüzden kaydı kısıtlarız: keşif başına değil, en az 2 dakikada bir
   yaz. Çıkışta (sekme gizlenince) bekleyen kayıt anında gönderilir. */
const SAVE_MIN_INTERVAL = 120000;

/* Sunucudaki kaydı yerele birleştirir (birleşim; çakışmada yerel korunur). */
function mergeSaveIntoLocal(save) {
	if (!save || typeof save !== "object") return;
	const els = Store.elements;
	for (const [k, v] of Object.entries(save.elements || {})) if (!els[k] && v && v.name) els[k] = v;
	Store.elements = els;
	const recipes = Store.recipes;
	for (const [k, v] of Object.entries(save.recipes || {})) if (!recipes[k] && v && v.name) recipes[k] = v;
	Store.recipes = recipes;
	const badges = Store.badges;
	for (const [k, v] of Object.entries(save.badges || {})) if (!badges[k]) badges[k] = v;
	Store.badges = badges;
	const s = Store.stats, ss = save.stats || {};
	s.combos = Math.max(s.combos || 0, ss.combos || 0);
	s.aiCalls = Math.max(s.aiCalls || 0, ss.aiCalls || 0);
	s.quests = Math.max(s.quests || 0, ss.quests || 0);
	s.discoveries = Object.keys(Store.elements).length;
	Store.stats = s;
}

/* İlerlemeyi buluta yazar (giriş yapıldıysa). Sunucu mevcut kayıtla birleştirir.
   Dönüş: { ok, error, elements } — başarı durumunu çağıran görebilsin.
   keepalive: yalnızca sayfa kapanırken (pagehide) anlamlıdır AMA tarayıcılar
   keepalive isteklerini ~64KB ile sınırlar; oyun büyüyünce kayıt gövdesi bunu
   aşar ve istek "Bağlantı kurulamadı" ile düşer. Bu yüzden keepalive varsayılan
   KAPALI ve yalnızca gövde sınırın altındaysa açılır (büyük kayıt normal fetch
   ile boyut sınırı olmadan gider). */
async function saveProgressNow(keepalive = false) {
	const poolUrl = activePoolUrl();
	if (!poolUrl || !isLoggedIn()) return { ok: false, error: "Giriş yok" };
	try {
		const body = JSON.stringify({
			token: getToken(),
			data: { elements: Store.elements, recipes: Store.recipes, stats: Store.stats, badges: Store.badges },
		});
		const opts = { method: "POST", headers: { "content-type": "application/json" }, body };
		// keepalive yalnızca kapanış anında VE gövde 64KB sınırının altındaysa.
		if (keepalive && body.length < 60000) opts.keepalive = true;
		const res = await fetch(poolUrl + "/save", opts);
		if (!res.ok) {
			let msg = `Sunucu hatası (${res.status})`;
			if (res.status === 404) msg = "Sunucu güncel değil (bulut kayıt yok). Worker'ı güncelleyin.";
			if (res.status === 401) msg = "Oturum geçersiz, tekrar giriş yapın.";
			return { ok: false, error: msg };
		}
		const data = await res.json().catch(() => ({}));
		// Sunucu günlük yazma limitinde { ok:false } döndürebilir (200 ile) —
		// bunu dürüstçe yansıt: ilerleme yerelde, sonra eşitlenecek.
		return { ok: data.ok !== false, elements: data.elements, error: data.error };
	} catch {
		return { ok: false, error: "Bağlantı kurulamadı" };
	}
}

/* Kaydı kısıtlar: en az SAVE_MIN_INTERVAL arayla buluta yazar (KV günlük yazma
   limitini korumak için keşif başına yazmaz). Araya gelen değişiklikler tek bir
   sonraki kayıtta toplanır. */
function scheduleSave() {
	if (!isLoggedIn() || !activePoolUrl()) return;
	_savePending = true;
	const since = Date.now() - _lastSaveAt;
	if (since >= SAVE_MIN_INTERVAL) {
		flushSave();
	} else if (!_saveTimer) {
		_saveTimer = setTimeout(flushSave, SAVE_MIN_INTERVAL - since);
	}
}

/* Bekleyen kaydı hemen gönderir (kısıtlamayı atlar) — çıkışta veya zaman dolunca.
   unloading=true yalnızca pagehide'da verilir (keepalive denemesi için). */
function flushSave(unloading = false) {
	clearTimeout(_saveTimer);
	_saveTimer = null;
	if (!_savePending || !isLoggedIn() || !activePoolUrl()) return;
	_savePending = false;
	_lastSaveAt = Date.now();
	saveProgressNow(unloading === true);
}

/* Buluttan ilerlemeyi yükleyip yerele katar.
   Dönüş: { ok, error, count } — kaç element yüklendiği bilgisiyle. */
async function loadProgress() {
	const poolUrl = activePoolUrl();
	if (!poolUrl || !isLoggedIn()) return { ok: false, error: "Giriş yok" };
	try {
		const res = await fetch(poolUrl + "/load", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: getToken() }),
		});
		if (!res.ok) {
			let msg = `Sunucu hatası (${res.status})`;
			if (res.status === 404) msg = "Sunucu güncel değil (bulut kayıt yok). Worker'ı güncelleyin.";
			if (res.status === 401) msg = "Oturum geçersiz, tekrar giriş yapın.";
			return { ok: false, error: msg };
		}
		const save = await res.json();
		mergeSaveIntoLocal(save);
		return { ok: true, count: Object.keys(save.elements || {}).length };
	} catch {
		return { ok: false, error: "Bağlantı kurulamadı" };
	}
}

/* Tam senkron: önce yükle-birleştir, sonra birleşmiş hâli geri kaydet. */
async function syncProgress() {
	const l = await loadProgress();
	const s = await saveProgressNow();
	return { load: l, save: s, ok: l.ok && s.ok };
}

/* Elementin kategorisi: kayıtlı alan → bilinen harita → diğer. */
function elementCategory(e) {
	if (!e) return "diger";
	return e.cat || CATEGORY_MAP[norm(e.name)] || "diger";
}

/* Yapay zekâ çağrısı yapmadan, bilinen kaynaklardan tarif bul. */
function lookupRecipe(key) {
	return SEED_RECIPES[key] || COMMUNITY_RECIPES[key] || Store.recipes[key] || null;
}

function getElement(name) {
	return Store.elements[norm(name)] || null;
}

/* Keşif sırasına göre (yeni→eski) sıralı element listesi. Sonuç, elementler
   değişene dek (elementsVersion) önbelleğe alınır — her render'da yeniden
   sıralamayı önler. Çağıranlar diziyi yerinde değiştirmez (filter/sort kopya
   üretir), bu yüzden önbellek referansı paylaşmak güvenlidir. */
let _elListCache = null, _elListVer = -1;
function elementList() {
	if (_elListVer === elementsVersion && _elListCache) return _elListCache;
	_elListCache = Object.values(Store.elements)
		.sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt));
	_elListVer = elementsVersion;
	return _elListCache;
}

/* Kategori → element sayısı; elementler değişene dek önbelleğe alınır. */
let _catCountCache = null, _catCountVer = -1;
function categoryCounts() {
	if (_catCountVer === elementsVersion && _catCountCache) return _catCountCache;
	const counts = {};
	for (const e of Object.values(Store.elements)) {
		const c = elementCategory(e);
		counts[c] = (counts[c] || 0) + 1;
	}
	_catCountCache = counts;
	_catCountVer = elementsVersion;
	return counts;
}

/* İlk açılışta 4 temel elementi ekler. */
function seedBaseElements() {
	const els = Store.elements;
	let changed = false;
	BASE_ELEMENTS.forEach((e) => {
		if (!els[norm(e.name)]) {
			els[norm(e.name)] = {
				name: e.name, emoji: e.emoji,
				discoveredAt: new Date().toISOString(),
				firstDiscovery: false, fromPair: null,
			};
			changed = true;
		}
	});
	if (changed) {
		Store.elements = els;
		const stats = Store.stats;
		stats.discoveries = Object.keys(els).length;
		Store.stats = stats;
	}
}

/* Yapay zekâ çıktısı güvensizdir: adı temizle, emojiyi doğrula. */
function validateResult(raw) {
	let name = String(raw?.name || "").trim().replace(/^["'.,;:!?]+|["'.,;:!?]+$/g, "").slice(0, 40).trim();
	if (!name) throw new Error("Model geçerli bir element adı üretemedi.");
	let emoji = String(raw?.emoji || "").trim();
	if (!/\p{Extended_Pictographic}/u.test(emoji)) emoji = "✨";
	const desc = String(raw?.desc || "").trim().slice(0, 400);
	const validCats = CATEGORIES.map((c) => c.id);
	const rawCat = raw?.category || raw?.cat; // istemci şeması "category", havuz "cat" kullanır
	const cat = validCats.includes(rawCat) ? rawCat : (CATEGORY_MAP[norm(name)] || "diger");
	// Havuzdan gelen ilk keşfeden bilgisi (varsa) korunur.
	const by = raw?.by ? String(raw.by).slice(0, 24) : "";
	const at = raw?.at ? String(raw.at).slice(0, 30) : "";
	// Bilinen bir element dönerse kayıtlı ad ve emojiyi kullan (dedup).
	const existing = getElement(name);
	if (existing) {
		name = existing.name;
		emoji = existing.emoji;
	}
	return { name, emoji, isNew: !!raw?.isNew, desc, cat, by, at };
}

/* ---------- Oyun belleği ---------- */

function logMemory(entry) {
	const mem = Store.memory;
	mem.push(entry);
	if (mem.length > 1000) mem.splice(0, mem.length - 1000);
	Store.memory = mem;
}

/* Elementin temel elementlerden uzaklığı (soy ağacı derinliği). */
function elementDepth(name, seen = new Set()) {
	const e = getElement(name);
	if (!e || !e.fromPair || seen.has(norm(name))) return 0;
	seen.add(norm(name));
	// fromPair 2-4 üyeli olabilir (#4 çoklu birleştirme).
	return 1 + Math.max(0, ...e.fromPair.map((n) => elementDepth(n, seen)));
}

/* ---------- Rozetler ---------- */

const BADGES = [
	{ id: "cirak", emoji: "🧪", name: "Çırak Simyacı", goal: "10 element keşfet", test: (s) => s.discoveries >= 10 },
	{ id: "kalfa", emoji: "⚗️", name: "Kalfa", goal: "25 element keşfet", test: (s) => s.discoveries >= 25 },
	{ id: "usta", emoji: "🔮", name: "Usta Simyacı", goal: "50 element keşfet", test: (s) => s.discoveries >= 50 },
	{ id: "efsane", emoji: "👑", name: "Efsanevi Simyacı", goal: "100 element keşfet", test: (s) => s.discoveries >= 100 },
	{ id: "kasif", emoji: "🚀", name: "Sınır Tanımaz", goal: "250 element keşfet", test: (s) => s.discoveries >= 250 },
	{ id: "bilinmeyen", emoji: "🤖", name: "Bilinmeyene Yolculuk", goal: "Yapay zekâya ilk soruyu sor", test: (s) => s.aiCalls >= 1 },
	{ id: "sorgucu", emoji: "🧠", name: "Sorgucu", goal: "Yapay zekâya 50 yeni ikili sor", test: (s) => s.aiCalls >= 50 },
	{ id: "deneyci", emoji: "🔁", name: "Deneyci", goal: "100 birleştirme yap", test: (s) => s.combos >= 100 },
	{ id: "oncu", emoji: "🏆", name: "Öncü", goal: "Sıra dışı bir 'ilk keşif' yap", test: (s, ctx) => !!ctx.firstDiscovery },
	{ id: "derin", emoji: "🌀", name: "Derin Simya", goal: "5 adım derinlikte bir element üret", test: (s, ctx) => ctx.depth >= 5 },
	{ id: "dipsiz", emoji: "🕳️", name: "Dipsiz Kuyu", goal: "10 adım derinlikte bir element üret", test: (s, ctx) => ctx.depth >= 10 },
	{ id: "avci", emoji: "🎯", name: "Hedef Avcısı", goal: "İlk hedefini tamamla", test: (s) => (s.quests || 0) >= 1 },
	{ id: "keskin", emoji: "🏹", name: "Keskin Nişancı", goal: "10 hedef tamamla", test: (s) => (s.quests || 0) >= 10 },
	{ id: "cokyonlu", emoji: "🌈", name: "Çok Yönlü", goal: "8 farklı kategoriden element keşfet", test: (s, ctx) => ctx.catCount >= 8 },
	{ id: "evrimci", emoji: "🧬", name: "Evrimci", goal: "Bir elementi 3 kez evrimle (kendisiyle birleştir)", test: (s) => (s.evolves || 0) >= 3 },
];

/* Evrim zinciri (#5): bir elementin kendisiyle birleşiminden doğan üst formları
   bilinen tariflerden (seed/havuz) takip eder. [{name, emoji, have}] döner. */
function evolveChain(name, max = 6) {
	const cur0 = getElement(name);
	const chain = [{ name: cur0 ? cur0.name : name, emoji: cur0 ? cur0.emoji : "✨", have: !!cur0 }];
	const seen = new Set([norm(name)]);
	let cur = chain[0].name;
	for (let i = 0; i < max; i++) {
		const r = lookupRecipe(comboKey([cur, cur]));
		if (!r || !r.name || seen.has(norm(r.name))) break;
		seen.add(norm(r.name));
		chain.push({ name: r.name, emoji: r.emoji || "✨", have: !!getElement(r.name) });
		cur = r.name;
	}
	return chain;
}

/* ---------- Hedef görevi ---------- */

/* Henüz keşfedilmemiş, tariflerle ulaşılabilir bir element hedef seçilir.
   Oyuncu onu bulunca kutlama + yeni hedef gelir — oyuna amaç katar. */
function pickQuest() {
	const pool = { ...SEED_RECIPES, ...COMMUNITY_RECIPES };
	const candidates = [...new Set(Object.values(pool).map((r) => r.name))]
		.filter((n) => !getElement(n));
	if (!candidates.length) return null;
	const pick = candidates[Math.floor(Math.random() * candidates.length)];
	const recipe = Object.values(pool).find((r) => r.name === pick);
	return { name: pick, emoji: recipe?.emoji || "🎯", setAt: new Date().toISOString() };
}

function currentQuest() {
	let q = DB.read("quest", null);
	if (!q || getElement(q.name)) {
		q = pickQuest();
		DB.write("quest", q);
	}
	return q;
}

/* ---------- Günün Elementi (#3) ----------
   Tarihten DETERMİNİSTİK seçilir → o gün herkeste AYNI hedef. Sabit bir küratör
   listesinden (DAILY_POOL) günün indeksi hesaplanır; oyuncu bulunca seri (streak)
   artar. Hedef, ilgi çekici ve ulaşılabilir orta-seviye elementlerden seçilir. */
const DAILY_POOL = [
	{ name: "Buhar", emoji: "🌫️" }, { name: "Bulut", emoji: "☁️" }, { name: "Yağmur", emoji: "🌧️" },
	{ name: "Şimşek", emoji: "⚡" }, { name: "Fırtına", emoji: "⛈️" }, { name: "Gökkuşağı", emoji: "🌈" },
	{ name: "Kar", emoji: "❄️" }, { name: "Buz", emoji: "🧊" }, { name: "Volkan", emoji: "🌋" },
	{ name: "Lav", emoji: "🌋" }, { name: "Deniz", emoji: "🌊" }, { name: "Okyanus", emoji: "🌊" },
	{ name: "Dağ", emoji: "⛰️" }, { name: "Çöl", emoji: "🏜️" }, { name: "Ada", emoji: "🏝️" },
	{ name: "Ağaç", emoji: "🌳" }, { name: "Orman", emoji: "🌲" }, { name: "Çiçek", emoji: "🌸" },
	{ name: "Balık", emoji: "🐟" }, { name: "Kuş", emoji: "🐦" }, { name: "Kelebek", emoji: "🦋" },
	{ name: "İnsan", emoji: "🧑" }, { name: "Şehir", emoji: "🏙️" }, { name: "Kale", emoji: "🏰" },
	{ name: "Robot", emoji: "🤖" }, { name: "Bilgisayar", emoji: "💻" }, { name: "İnternet", emoji: "🌐" },
	{ name: "Yapay Zekâ", emoji: "🤖" }, { name: "Roket", emoji: "🚀" }, { name: "Astronot", emoji: "👨‍🚀" },
	{ name: "Gezegen", emoji: "🪐" }, { name: "Yıldız", emoji: "⭐" }, { name: "Galaksi", emoji: "🌌" },
	{ name: "Karadelik", emoji: "🕳️" }, { name: "Güneş", emoji: "☀️" }, { name: "Ay", emoji: "🌙" },
	{ name: "Ejderha", emoji: "🐉" }, { name: "Anka Kuşu", emoji: "🔥" }, { name: "Deniz Kızı", emoji: "🧜‍♀️" },
	{ name: "Tek Boynuz", emoji: "🦄" }, { name: "Büyücü", emoji: "🧙" }, { name: "Şövalye", emoji: "⚔️" },
	{ name: "Kılıç", emoji: "🗡️" }, { name: "Kral", emoji: "👑" }, { name: "Hazine", emoji: "💰" },
	{ name: "Ekmek", emoji: "🍞" }, { name: "Peynir", emoji: "🧀" }, { name: "Kebap", emoji: "🍢" },
	{ name: "Bal", emoji: "🍯" }, { name: "Çay", emoji: "🍵" }, { name: "Müzik", emoji: "🎵" },
	{ name: "Film", emoji: "🎬" }, { name: "Sinema", emoji: "🎬" }, { name: "Kitap", emoji: "📖" },
	{ name: "Resim", emoji: "🖼️" }, { name: "Dans", emoji: "💃" }, { name: "Aşk", emoji: "❤️" },
	{ name: "Mutluluk", emoji: "😊" }, { name: "Rüya", emoji: "💭" }, { name: "Bilgelik", emoji: "🦉" },
	{ name: "Metal", emoji: "🔩" }, { name: "Çelik", emoji: "🔩" }, { name: "Cam", emoji: "🪟" },
	{ name: "Elektrik", emoji: "⚡" }, { name: "Atom", emoji: "⚛️" }, { name: "DNA", emoji: "🧬" },
	{ name: "Teleskop", emoji: "🔭" }, { name: "Araba", emoji: "🚗" }, { name: "Uçak", emoji: "✈️" },
	{ name: "Gemi", emoji: "🚢" }, { name: "Tuğla", emoji: "🧱" }, { name: "Ev", emoji: "🏠" },
];

function dateStr(ms) {
	const d = new Date(ms);
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function dailyKey() { return dateStr(Date.now()); }
function dailyHash(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
	return h >>> 0;
}
/* O günün hedefi (herkeste aynı). */
function dailyTarget() {
	return DAILY_POOL[dailyHash(dailyKey()) % DAILY_POOL.length];
}
function dailyState() { return DB.read("daily", { doneDate: "", streak: 0 }); }
function dailyDoneToday() { return dailyState().doneDate === dailyKey(); }

/* Yeni kazanılan rozetleri kaydedip döndürür. */
function checkBadges(ctx) {
	const earned = Store.badges;
	const fresh = [];
	for (const b of BADGES) {
		if (!earned[b.id] && b.test(Store.stats, ctx)) {
			earned[b.id] = new Date().toISOString();
			fresh.push(b);
		}
	}
	if (fresh.length) Store.badges = earned;
	return fresh;
}

/* 2-4 elementi birleştirir (#4 çoklu birleştirme). Tek dizi argüman alır.
   Dönüş: { name, emoji, isNew, discovered } — discovered: oyuncu için yeni mi. */
async function combine(names) {
	const list = (Array.isArray(names) ? names : [names]).slice(0, 4);
	const elsIn = list.map(getElement);
	if (elsIn.length < 2 || elsIn.some((e) => !e)) throw new Error("Bilinmeyen element.");
	const namesC = elsIn.map((e) => e.name);

	const key = comboKey(namesC);
	if (inFlight.has(key)) throw new Error("BUSY");
	inFlight.add(key);
	try {
		let source = SEED_RECIPES[key] ? "seed"
			: COMMUNITY_RECIPES[key] ? "community"
			: Store.recipes[key] ? "cache"
			: (mockEnabled() ? "mock" : "ai");
		let result = lookupRecipe(key);
		if (!result) {
			// Yalnızca gerçek yapay zekâ çağrıları sıraya alınır.
			result = validateResult(await enqueueAi(() => aiCombine(elsIn)));
			// Havuz ilk keşfeden bilgisini döndürmediyse (kendi anahtarıyla
			// üreten oyuncu), iyimser olarak bu oyuncuyu ilk keşfeden say.
			if (!result.by) { result.by = getNickname(); result.at = new Date().toISOString(); }
			Store.recipes = { ...Store.recipes, [key]: result };
			const stats = Store.stats;
			stats.aiCalls += 1;
			Store.stats = stats;
			// Keşfi küresel havuza paylaş — yalnızca kendi anahtarıyla üretildiyse;
			// havuz (ortak yapay zekâ) yolunda sonuç zaten sunucuda saklanmıştır.
			if (typeof activeKey === "function" && activeKey()) pushToPool(key, result);
		}

		const stats = Store.stats;
		stats.combos += 1;
		// Evrim (#5): aynı elementin kendisiyle birleşimi (X+X[+X]) bir "evrim" sayılır.
		if (namesC.length >= 2 && namesC.every((n) => norm(n) === norm(namesC[0]))) {
			stats.evolves = (stats.evolves || 0) + 1;
		}

		let discovered = false;
		const els = Store.elements;
		if (!els[norm(result.name)]) {
			els[norm(result.name)] = {
				name: result.name, emoji: result.emoji,
				desc: result.desc || "",
				cat: result.cat || CATEGORY_MAP[norm(result.name)] || "diger",
				discoveredAt: new Date().toISOString(),
				firstDiscovery: !!result.isNew,
				fromPair: namesC,
				// Dünyada ilk keşfeden (havuzdan ya da bu oyuncu) ve tarihi.
				firstBy: result.by || "",
				firstAt: result.at || "",
			};
			Store.elements = els;
			stats.discoveries += 1;
			discovered = true;
			scheduleSave(); // yeni keşfi buluta kaydet (giriş yapıldıysa)
		}

		// Hedef tamamlandı mı?
		let questDone = null;
		if (discovered) {
			const q = DB.read("quest", null);
			if (q && norm(q.name) === norm(result.name)) {
				stats.quests = (stats.quests || 0) + 1;
				questDone = q;
				DB.write("quest", pickQuest());
			}
		}
		Store.stats = stats;

		// Oyunun belleğine yaz: her olay kaydedilir, oyun bu hafızayla gelişir.
		logMemory({
			at: new Date().toISOString(),
			pair: namesC,
			result: result.name,
			isNew: !!result.isNew,
			discovered,
			source,
		});

		const catCount = new Set(Object.values(Store.elements).map((e) => elementCategory(e)))
			.size - (Object.values(Store.elements).some((e) => elementCategory(e) === "diger") ? 1 : 0);
		const newBadges = checkBadges({
			firstDiscovery: discovered && !!result.isNew,
			depth: discovered ? elementDepth(result.name) : 0,
			catCount,
		});

		return { ...result, discovered, newBadges, questDone };
	} finally {
		inFlight.delete(key);
	}
}

/* Tüm bilinen tarifleri (yerleşik + öğrenilmiş) eğitim verisi olarak döker.
   Her satır sohbet biçiminde bir JSONL kaydıdır — ince ayar için hazırdır. */
function trainingDataJsonl() {
	const all = { ...SEED_RECIPES, ...COMMUNITY_RECIPES, ...Store.recipes };
	return Object.entries(all).map(([key, r]) => {
		const [x, y] = key.split("++");
		const out = { name: r.name, emoji: r.emoji, isNew: !!r.isNew };
		if (r.desc) out.desc = r.desc;
		return JSON.stringify({
			messages: [
				{ role: "user", content: `${x} + ${y}` },
				{ role: "assistant", content: JSON.stringify(out) },
			],
		});
	}).join("\n");
}
