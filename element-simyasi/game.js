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
			const res = await fetch(poolUrl + "/pack");
			if (res.ok) {
				const pack = await res.json();
				// Yerel küratörlü paket önceliklidir; havuz boşlukları doldurur.
				COMMUNITY_RECIPES = { ...pack, ...COMMUNITY_RECIPES };
			}
		} catch { /* havuza ulaşılamadı — oyun yereliyle devam eder */ }
	}
	return COMMUNITY_RECIPES;
}

/* Yapay zekânın ürettiği yeni tarifi küresel havuza gönderir (beklemeden).
   İlk keşfeden bilgisi (takma ad + tarih) de eklenir; havuz ilk yazanı saklar. */
function pushToPool(key, result) {
	const poolUrl = activePoolUrl();
	if (!poolUrl) return;
	fetch(poolUrl + "/recipe", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ key, result, by: getNickname(), at: result.at || new Date().toISOString() }),
	}).catch(() => { /* havuz isteğe bağlı */ });
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

function elementList() {
	return Object.values(Store.elements)
		.sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt));
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
