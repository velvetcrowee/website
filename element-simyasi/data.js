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
		return DB.read("settings", { aiProvider: "gemini", apiKey: "", geminiKey: "", deepseekKey: "", sound: true, nickname: "" });
	},
	set settings(v) { DB.write("settings", v); },

	// Keşfedilen elementler: { "buhar": { name, emoji, desc, discoveredAt, firstDiscovery, fromPair } }
	get elements() { return DB.read("elements", {}); },
	set elements(v) { DB.write("elements", v); },

	// Yapay zekâ tarif önbelleği: { "ateş++su": { name, emoji, isNew, desc } }
	get recipes() { return DB.read("recipes", {}); },
	set recipes(v) { DB.write("recipes", v); },

	// Oyun belleği: her birleştirme olayı kronolojik kaydedilir (en fazla 1000).
	// [{ at, pair: [a, b], result, isNew, discovered, source: "seed"|"cache"|"ai"|"mock" }]
	get memory() { return DB.read("memory", []); },
	set memory(v) { DB.write("memory", v); },

	// Kazanılan rozetler: { rozetId: kazanılmaTarihiISO }
	get badges() { return DB.read("badges", {}); },
	set badges(v) { DB.write("badges", v); },

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

/* Oyuncunun kalıcı, benzersiz kimliği (bir kez üretilir, cihazda saklanır). */
function getUserId() {
	let id = DB.read("uid", null);
	if (!id) {
		id = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
		DB.write("uid", id);
	}
	return id;
}

/* Oyuncunun herkese görünen takma adı. Boşsa varsayılan üretilir ve saklanır. */
function getNickname() {
	const s = Store.settings;
	if (s.nickname && s.nickname.trim()) return s.nickname.trim();
	const def = "Simyacı" + (parseInt(getUserId().slice(-4), 36) % 9000 + 1000);
	Store.settings = { ...s, nickname: def };
	return def;
}
