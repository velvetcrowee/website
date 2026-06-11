/* Oyun mantığı — tarif çözümleme (seed → önbellek → yapay zekâ), keşif kaydı
   ve istatistikler. Arayüzden bağımsızdır; konsoldan da test edilebilir. */

/* Aynı ikili için eşzamanlı ikinci istek atılmasın. */
const inFlight = new Set();

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
	const desc = String(raw?.desc || "").trim().slice(0, 160);
	// Bilinen bir element dönerse kayıtlı ad ve emojiyi kullan (dedup).
	const existing = getElement(name);
	if (existing) {
		name = existing.name;
		emoji = existing.emoji;
	}
	return { name, emoji, isNew: !!raw?.isNew, desc };
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
];

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
		let source = SEED_RECIPES[key] ? "seed" : Store.recipes[key] ? "cache" : (mockEnabled() ? "mock" : "ai");
		let result = SEED_RECIPES[key] || Store.recipes[key];
		if (!result) {
			result = validateResult(await aiCombine(a, b));
			Store.recipes = { ...Store.recipes, [key]: result };
			const stats = Store.stats;
			stats.aiCalls += 1;
			Store.stats = stats;
		}

		const stats = Store.stats;
		stats.combos += 1;

		let discovered = false;
		const els = Store.elements;
		if (!els[norm(result.name)]) {
			els[norm(result.name)] = {
				name: result.name, emoji: result.emoji,
				desc: result.desc || "",
				discoveredAt: new Date().toISOString(),
				firstDiscovery: !!result.isNew,
				fromPair: [a.name, b.name],
			};
			Store.elements = els;
			stats.discoveries += 1;
			discovered = true;
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

		const newBadges = checkBadges({
			firstDiscovery: discovered && !!result.isNew,
			depth: discovered ? elementDepth(result.name) : 0,
		});

		return { ...result, discovered, newBadges };
	} finally {
		inFlight.delete(key);
	}
}

/* Tüm bilinen tarifleri (yerleşik + öğrenilmiş) eğitim verisi olarak döker.
   Her satır sohbet biçiminde bir JSONL kaydıdır — ince ayar için hazırdır. */
function trainingDataJsonl() {
	const all = { ...SEED_RECIPES, ...Store.recipes };
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
