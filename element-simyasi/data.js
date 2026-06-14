/* Veri katmanı — tüm kayıtlar cihazda localStorage içinde tutulur.

   Performans: ayrıştırılmış (parse edilmiş) değerler bellekte önbelleğe alınır.
   Önceden her okuma JSON.parse çalıştırıyordu; arayüz aynı anahtarı (elements,
   recipes, settings…) tek render'da defalarca okuduğu için bu pahalıydı. Artık
   parse yalnızca bir kez yapılır; yazma hem önbelleği hem localStorage'ı tazeler.
   Tüm yazımlar Store ayarlayıcılarından (setter) geçtiği için önbellek tutarlı
   kalır. */

const _cache = new Map();

/* Elementler her değiştiğinde artar; türetilmiş veriler (sıralı liste, kategori
   sayımları) bu sürümle önbelleğe alınıp yalnızca değişince yeniden hesaplanır. */
let elementsVersion = 0;

const DB = {
	read(key, fallback) {
		if (_cache.has(key)) return _cache.get(key);
		let val = fallback;
		try {
			const raw = localStorage.getItem("simya." + key);
			if (raw != null) val = JSON.parse(raw);
		} catch {
			val = fallback;
		}
		_cache.set(key, val);
		return val;
	},
	write(key, value) {
		_cache.set(key, value);
		try {
			localStorage.setItem("simya." + key, JSON.stringify(value));
		} catch { /* kota dolu/erişilemez — bellekteki değer yine de günceldir */ }
	},
	remove(key) {
		_cache.delete(key);
		localStorage.removeItem("simya." + key);
	},
	clearCache() {
		_cache.clear();
	},
};

const Store = {
	get settings() {
		return DB.read("settings", { aiProvider: "gemini", apiKey: "", geminiKey: "", deepseekKey: "", sound: true, nickname: "" });
	},
	set settings(v) { DB.write("settings", v); },

	// Keşfedilen elementler: { "buhar": { name, emoji, desc, discoveredAt, firstDiscovery, fromPair } }
	get elements() { return DB.read("elements", {}); },
	set elements(v) { DB.write("elements", v); elementsVersion++; },

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
		DB.clearCache();
	},

	exportAll() {
		const dump = {};
		// Bellekteki (önbellek) değer önceliklidir: bir yazma kota nedeniyle
		// localStorage'a geçememiş olsa bile dışa aktarma ekrandakiyle tutarlı olur.
		Object.keys(localStorage)
			.filter((k) => k.startsWith("simya."))
			.forEach((k) => {
				const short = k.slice(6); // "simya." sonrası
				dump[k] = _cache.has(short) ? _cache.get(short) : JSON.parse(localStorage.getItem(k));
			});
		for (const [short, val] of _cache) {
			const full = "simya." + short;
			if (!(full in dump)) dump[full] = val;
		}
		return dump;
	},
};

/* Çoklu sekme tutarlılığı: başka bir sekme localStorage'ı değiştirince ilgili
   önbellek anahtarını düşürürüz; böylece bu sekme bir sonraki okumada güncel
   değeri alır ve sekmeler birbirinin ilerlemesini ezmez. 'storage' olayı
   yalnızca DİĞER sekmelerde tetiklenir (yazan sekmede değil). */
if (typeof window !== "undefined" && window.addEventListener) {
	window.addEventListener("storage", (e) => {
		if (!e.key || e.key.indexOf("simya.") !== 0) return;
		const short = e.key.slice(6);
		_cache.delete(short);
		if (short === "elements") elementsVersion++;
	});
}

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
