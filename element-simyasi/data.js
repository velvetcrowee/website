/* Veri katmanı — tüm kayıtlar cihazda localStorage içinde tutulur. */

const DB = {
	read(key, fallback) {
		try {
			const raw = localStorage.getItem("simya." + key);
			return raw ? JSON.parse(raw) : fallback;
		} catch {
			return fallback;
		}
	},
	write(key, value) {
		localStorage.setItem("simya." + key, JSON.stringify(value));
	},
	remove(key) {
		localStorage.removeItem("simya." + key);
	},
};

const Store = {
	get settings() {
		return DB.read("settings", { aiProvider: "gemini", apiKey: "", geminiKey: "" });
	},
	set settings(v) { DB.write("settings", v); },

	// Keşfedilen elementler: { "buhar": { name, emoji, discoveredAt, firstDiscovery, fromPair } }
	get elements() { return DB.read("elements", {}); },
	set elements(v) { DB.write("elements", v); },

	// Yapay zekâ tarif önbelleği: { "ateş++su": { name, emoji, isNew } }
	get recipes() { return DB.read("recipes", {}); },
	set recipes(v) { DB.write("recipes", v); },

	get stats() { return DB.read("stats", { combos: 0, discoveries: 0, aiCalls: 0 }); },
	set stats(v) { DB.write("stats", v); },

	// Tuvaldeki örnekler: [{ id, name, x, y }]
	get workspace() { return DB.read("workspace", []); },
	set workspace(v) { DB.write("workspace", v); },

	resetAll() {
		Object.keys(localStorage)
			.filter((k) => k.startsWith("simya."))
			.forEach((k) => localStorage.removeItem(k));
	},

	exportAll() {
		const dump = {};
		Object.keys(localStorage)
			.filter((k) => k.startsWith("simya."))
			.forEach((k) => { dump[k] = JSON.parse(localStorage.getItem(k)); });
		return dump;
	},
};

/* Türkçe-güvenli normalizasyon (İ/i, I/ı). Element ve tarif anahtarları
   her zaman bu biçimde tutulur. */
function norm(s) {
	return String(s).trim().toLocaleLowerCase("tr");
}

/* Sıradan bağımsız ikili anahtarı: A+B ve B+A aynı tarife gider. */
function pairKey(a, b) {
	return [norm(a), norm(b)].sort((x, y) => x.localeCompare(y, "tr")).join("++");
}
