/* Veri katmanı — tüm kayıtlar cihazda localStorage içinde tutulur. */

const DB = {
	read(key, fallback) {
		try {
			const raw = localStorage.getItem("liman." + key);
			return raw ? JSON.parse(raw) : fallback;
		} catch {
			return fallback;
		}
	},
	write(key, value) {
		localStorage.setItem("liman." + key, JSON.stringify(value));
	},
	remove(key) {
		localStorage.removeItem("liman." + key);
	},
};

const Store = {
	get config() { return DB.read("config", null); },
	set config(v) { DB.write("config", v); },

	get session() { return DB.read("session", null); },
	set session(v) {
		if (v === null) DB.remove("session");
		else DB.write("session", v);
	},

	get log() { return DB.read("log", []); },
	set log(v) { DB.write("log", v); },

	get settings() {
		return DB.read("settings", { durationMinutes: 30, vibrate: true });
	},
	set settings(v) { DB.write("settings", v); },

	resetAll() {
		Object.keys(localStorage)
			.filter((k) => k.startsWith("liman."))
			.forEach((k) => localStorage.removeItem(k));
	},
};

/* Pozisyon aralığından azalan sırada ikili üretir.
   Örnek: (4, 11) → [{positions:[10,11]}, {positions:[8,9]}, {positions:[6,7]}, {positions:[4,5]}] */
function derivePairs(startPos, endPos) {
	const pairs = [];
	for (let high = endPos; high > startPos; high -= 2) {
		pairs.push({ positions: [high - 1, high], names: ["", ""] });
	}
	return pairs;
}

/* İzlenen çiftin (son sıradaki) bir sonraki turuna kadar kalan ms.
   0 → şu an çalışıyorlar; -1 → yüklemeye geçtiler */
function etaForWatchedPair(session, config, nowMs) {
	const durationMs = session.durationMs;
	const watchedIdx = config.pairs.length - 1;
	const curIdx = session.currentPairIndex;

	if (curIdx === watchedIdx) return 0;

	const watchedPair = config.pairs[watchedIdx];
	if (watchedPair.positions.every((pos) => session.machinesGone.includes(pos))) return -1;

	const remainingOnCurrent = Math.max(0, durationMs - (nowMs - session.pairStartedAt));
	let eta = remainingOnCurrent;

	const n = config.pairs.length;
	let idx = (curIdx + 1) % n;
	let steps = 0;

	while (idx !== watchedIdx && steps < n) {
		const pair = config.pairs[idx];
		const gone = pair.positions.every((pos) => session.machinesGone.includes(pos));
		if (!gone) eta += durationMs;
		idx = (idx + 1) % n;
		steps++;
	}

	return eta;
}
