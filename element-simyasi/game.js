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

async function loadCommunityRecipes() {
	try {
		const res = await fetch("recipes.json", { cache: "no-cache" });
		if (res.ok) COMMUNITY_RECIPES = await res.json();
	} catch { /* çevrimdışı veya bulunamadı — yerleşik tarifler yeter */ }
	// Küresel havuz (Cloudflare Worker) varsa onu da kat: tüm oyuncuların
	// AI keşifleri tek havuzda birikir, aynı ikili dünyada bir kez sorulur.
	const poolUrl = activePoolUrl();
	if (poolUrl) {
		try {
			// no-store: tarayıcı/CDN önbelleğe almasın, sayaçlar tazelensin.
			const res = await fetch(poolUrl + "/pack?t=" + Date.now(), { cache: "no-store" });
			if (res.ok) {
				const pack = await res.json();
				// Yerel küratörlü paket önceliklidir; havuz boşlukları doldurur.
				COMMUNITY_RECIPES = { ...pack, ...COMMUNITY_RECIPES };
			}
		} catch { /* havuza ulaşılamadı — oyun yereliyle devam eder */ }
	}
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
   Dönüş: { ok, error, elements } — başarı durumunu çağıran görebilsin. */
async function saveProgressNow() {
	const poolUrl = activePoolUrl();
	if (!poolUrl || !isLoggedIn()) return { ok: false, error: "Giriş yok" };
	try {
		const res = await fetch(poolUrl + "/save", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				token: getToken(),
				data: { elements: Store.elements, recipes: Store.recipes, stats: Store.stats, badges: Store.badges },
			}),
		});
		if (!res.ok) {
			let msg = `Sunucu hatası (${res.status})`;
			if (res.status === 404) msg = "Sunucu güncel değil (bulut kayıt yok). Worker'ı güncelleyin.";
			if (res.status === 401) msg = "Oturum geçersiz, tekrar giriş yapın.";
			return { ok: false, error: msg };
		}
		const data = await res.json().catch(() => ({}));
		return { ok: true, elements: data.elements };
	} catch {
		return { ok: false, error: "Bağlantı kurulamadı" };
	}
}

/* Sık değişimlerde ağı yormamak için kaydı geciktir. */
function scheduleSave() {
	if (!isLoggedIn() || !activePoolUrl()) return;
	clearTimeout(_saveTimer);
	_saveTimer = setTimeout(saveProgressNow, 2500);
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
	return 1 + Math.max(elementDepth(e.fromPair[0], seen), elementDepth(e.fromPair[1], seen));
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
];

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

/* İki elementi birleştirir.
   Dönüş: { name, emoji, isNew, discovered } — discovered: oyuncu için yeni mi. */
async function combine(nameA, nameB) {
	const a = getElement(nameA);
	const b = getElement(nameB);
	if (!a || !b) throw new Error("Bilinmeyen element.");

	const key = pairKey(nameA, nameB);
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
			result = validateResult(await enqueueAi(() => aiCombine(a, b)));
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

		let discovered = false;
		const els = Store.elements;
		if (!els[norm(result.name)]) {
			els[norm(result.name)] = {
				name: result.name, emoji: result.emoji,
				desc: result.desc || "",
				cat: result.cat || CATEGORY_MAP[norm(result.name)] || "diger",
				discoveredAt: new Date().toISOString(),
				firstDiscovery: !!result.isNew,
				fromPair: [a.name, b.name],
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
			pair: [a.name, b.name],
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
