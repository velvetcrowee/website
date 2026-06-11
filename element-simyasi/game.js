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
	// Bilinen bir element dönerse kayıtlı ad ve emojiyi kullan (dedup).
	const existing = getElement(name);
	if (existing) {
		name = existing.name;
		emoji = existing.emoji;
	}
	return { name, emoji, isNew: !!raw?.isNew };
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
				discoveredAt: new Date().toISOString(),
				firstDiscovery: !!result.isNew,
				fromPair: [a.name, b.name],
			};
			Store.elements = els;
			stats.discoveries += 1;
			discovered = true;
		}
		Store.stats = stats;

		return { ...result, discovered };
	} finally {
		inFlight.delete(key);
	}
}
