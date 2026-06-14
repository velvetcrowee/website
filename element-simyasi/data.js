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

	// Favori (sabitlenen) elementler: norm(ad) dizisi. Panelin üstünde gösterilir.
	get favorites() { return DB.read("favorites", []); },
	set favorites(v) { DB.write("favorites", v); },

	// Üretilen element görselleri: { norm(ad): "data:image/...;base64,..." }.
	// Yapay zekâ ile bir kez üretilip cihazda saklanır (tekrar üretilmez).
	get images() { return DB.read("images", {}); },
	set images(v) { DB.write("images", v); },

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

/* Üyelik: { token, username } — giriş yapıldıysa dolu. */
function getAccount() {
	return DB.read("account", null);
}
function isLoggedIn() {
	const a = getAccount();
	return !!(a && a.token && a.username);
}
function getToken() {
	const a = getAccount();
	return a && a.token ? a.token : "";
}

/* Oyuncunun herkese görünen adı: giriş yapıldıysa kullanıcı adı (benzersiz),
   yoksa "Misafir-XXXX" biçiminde geçici bir ad. */
function getNickname() {
	const a = getAccount();
	if (a && a.username) return a.username;
	const s = Store.settings;
	if (s.nickname && s.nickname.trim()) return s.nickname.trim();
	const def = "Misafir-" + (parseInt(getUserId().slice(-4), 36) % 9000 + 1000);
	Store.settings = { ...s, nickname: def };
	return def;
}

/* ---------- Favoriler ---------- */

function isFavorite(name) {
	return Store.favorites.includes(norm(name));
}

/* Favoriyi ekler/çıkarır; yeni durumu (true=favori) döndürür. */
function toggleFavorite(name) {
	const key = norm(name);
	const favs = Store.favorites;
	const i = favs.indexOf(key);
	if (i >= 0) { favs.splice(i, 1); Store.favorites = favs; return false; }
	favs.push(key);
	Store.favorites = favs;
	return true;
}
