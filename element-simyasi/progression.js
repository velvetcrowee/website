/* İlerleme katmanı — nadirlik seviyeleri (#5) ve XP/seviye (#12).
   Her ikisi de element verisinden TÜRETİLİR (ayrı kayıt tutulmaz); sonuçlar
   elementsVersion ile önbelleğe alınır, yalnızca elementler değişince yeniden
   hesaplanır. Bu dosya game.js'ten sonra, app.js'ten önce yüklenir; çağırdığı
   yardımcılar (elementDepth, getElement) çağrı anında hazırdır. */

const RARITIES = [
	{ id: "common", emoji: "⚪", color: "#94a3b8", stars: 1 },
	{ id: "uncommon", emoji: "🟢", color: "#34d399", stars: 2 },
	{ id: "rare", emoji: "🔵", color: "#60a5fa", stars: 3 },
	{ id: "epic", emoji: "🟣", color: "#a78bfa", stars: 4 },
	{ id: "legendary", emoji: "🟡", color: "#fbbf24", stars: 5 },
];
const RARITY_BY_ID = Object.fromEntries(RARITIES.map((r) => [r.id, r]));
const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));

/* Soy ağacı derinliği önbelleği (her elementsVersion için bir kez). */
let _depthCache = new Map(), _depthVer = -1;
function depthOf(name) {
	if (_depthVer !== elementsVersion) { _depthCache = new Map(); _depthVer = elementsVersion; }
	const k = norm(name);
	if (_depthCache.has(k)) return _depthCache.get(k);
	const d = (typeof elementDepth === "function") ? elementDepth(name) : 0;
	_depthCache.set(k, d);
	return d;
}

/* Nadirlik = derinlik kademesi; "ilk keşif" (sıra dışı yenilik) bir kademe artırır. */
function rarityIdFor(el) {
	if (!el || !el.fromPair) return "common"; // temel elementler sıradan
	const d = depthOf(el.name);
	let tier = d <= 2 ? 0 : d <= 5 ? 1 : d <= 9 ? 2 : d <= 14 ? 3 : 4;
	if (el.firstDiscovery) tier = Math.min(4, Math.max(1, tier + 1));
	return RARITIES[tier].id;
}

let _rarCache = new Map(), _rarVer = -1;
function rarityOf(el) {
	if (_rarVer !== elementsVersion) { _rarCache = new Map(); _rarVer = elementsVersion; }
	const k = el && el.name ? norm(el.name) : "";
	if (_rarCache.has(k)) return RARITY_BY_ID[_rarCache.get(k)];
	const id = rarityIdFor(el);
	_rarCache.set(k, id);
	return RARITY_BY_ID[id];
}
function rarityRank(el) { return RARITY_RANK[rarityIdFor(el)] || 0; }
function rarityName(id) { return (typeof t === "function") ? t("rar_" + id) : id; }

/* ---------- XP / Seviye ---------- */

const XP_BY_RARITY = { common: 4, uncommon: 10, rare: 25, epic: 70, legendary: 180 };

let _xpCache = -1, _xpVer = -1;
function playerXP() {
	if (_xpVer === elementsVersion && _xpCache >= 0) return _xpCache;
	let sum = 0;
	for (const el of Object.values(Store.elements)) sum += XP_BY_RARITY[rarityIdFor(el)] || 4;
	_xpCache = sum; _xpVer = elementsVersion;
	return sum;
}

/* Seviye eğrisi: L. seviyenin başlangıç XP'si = 50*(L-1)^2 (kademeli artar). */
function levelInfo(xp) {
	const level = Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
	const start = 50 * (level - 1) * (level - 1);
	const next = 50 * level * level;
	const into = xp - start;
	const span = next - start || 1;
	return { level, into, span, progress: Math.max(0, Math.min(1, into / span)), xp, next };
}
function playerLevel() { return levelInfo(playerXP()).level; }
