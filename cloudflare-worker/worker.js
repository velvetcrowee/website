/* Element Simyası — Küresel Tarif Havuzu + Ortak Yapay Zekâ (Cloudflare Worker)
 *
 * Tüm oyuncuların yapay zekâ keşifleri tek havuzda birikir: bir oyuncu bir
 * ikiliyi keşfettiğinde sonuç buraya yazılır; diğer oyuncular açılışta havuzu
 * indirir ve o ikili için bir daha yapay zekâya sorulmaz.
 *
 * İsteğe bağlı ORTAK YAPAY ZEKÂ: site sahibi `wrangler secret put DEEPSEEK_KEY`
 * ile bir DeepSeek anahtarı eklerse, kendi anahtarı olmayan oyuncuların
 * birleşimleri bu sunucu üzerinden üretilir — anahtar tarayıcıya ASLA inmez.
 *
 * Uçlar:
 *   GET  /            → durum { recipes, ai }
 *   GET  /pack        → havuz (hafif, desc YOK) { "ateş++su": {name,emoji,isNew,cat,by,at}, ... }
 *                       ?since=<rid> → yalnızca delta; X-Pool-Cursor başlığı imleci taşır
 *   GET  /recipe?key= → tek tarifin tam kaydı (desc dahil; detay açılışında tembel çekilir)
 *   GET  /leaderboard → en çok "dünya ilki" keşfe sahip oyuncular
 *   GET  /stats       → dünya panosu (kategori dağılımı, büyüme, en yaratıcı, en yeni)
 *   POST /recipe      → { key, result } yeni tarif ekler (var olanı ezmez)
 *   POST /combine     → { a:{name,emoji}, b:{name,emoji} } → tarif (havuz → AI)
 *   POST /register, /login, /save, /load · GET /checkname → üyelik (KV)
 *
 * Depolama:
 *   D1  (DB bağlaması)      → tarifler (recipes tablosu, satır başına bir tarif).
 *                             Günlük 100.000 yazma — KV'nin 1000'inden çok yüksek.
 *   KV  (RECIPES bağlaması) → kullanıcılar, oturum tokenları, bulut kayıtlar.
 *                             (Token TTL gerektiği için bunlar KV'de kalır.)
 *
 * D1 tablo şeması (bir kez D1 konsolunda oluşturulur):
 *   CREATE TABLE IF NOT EXISTS recipes (
 *     key TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT,
 *     isnew INTEGER, descr TEXT, cat TEXT, finder TEXT, at TEXT
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_recipes_finder ON recipes(finder);
 */

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-headers": "content-type",
	// /pack delta imlecini (X-Pool-Cursor) çapraz-köken JS'in okuyabilmesi için.
	"access-control-expose-headers": "X-Pool-Cursor",
};

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];

/* D1'den okunan tarif satırlarında istemcinin beklediği sütunlar. Tabloda
   bazı sütun adları SQL'e/eski şemaya uyacak biçimde farklıdır; istemciye
   dönerken eşlenir (descr→desc, finder→by, isnew→isNew). */
const RECIPE_COLS = "key, name, emoji, isnew, descr, cat, finder, at";

/* /pack için HAFİF sütunlar: ağır `descr` ALANI YOK (yükü ~%50-65 düşürür).
   Açıklama yalnızca detay açılışında tembel olarak /recipe?key= ile iner.
   rowid: silme olmadığı için monotonik artan kusursuz "delta" imleci. */
const PACK_COLS = "rowid AS rid, key, name, emoji, isnew, cat, finder, at";

/* Birleştirme şeması (Gemini responseSchema için). */
const COMBINE_SCHEMA = {
	type: "object",
	properties: {
		name: { type: "string" },
		emoji: { type: "string" },
		isNew: { type: "boolean" },
		desc: { type: "string" },
		category: { type: "string", enum: ["doga", "canli", "yiyecek", "insan", "teknoloji", "uzay", "mitoloji", "soyut"] },
	},
	required: ["name", "emoji", "isNew", "desc", "category"],
};

/* D1 satırını istemcinin beklediği tarif nesnesine çevirir. */
function rowToRecipe(row) {
	const out = {
		name: row.name,
		emoji: row.emoji || "✨",
		isNew: !!row.isnew,
		desc: row.descr || "",
		cat: row.cat || "diger",
	};
	if (row.finder) out.by = row.finder;
	if (row.at) out.at = row.at;
	return out;
}

/* /pack için hafif eşleyici: desc YOK. İstemci açıklamayı detay açılışında
   /recipe?key= ile ayrıca çeker. */
function rowToLite(row) {
	const out = {
		name: row.name,
		emoji: row.emoji || "✨",
		isNew: !!row.isnew,
		cat: row.cat || "diger",
	};
	if (row.finder) out.by = row.finder;
	if (row.at) out.at = row.at;
	return out;
}

/* Temizlenmiş tarifi recipes tablosuna ekler (var olanı EZMEZ). */
function insertRecipeStmt(env, key, clean) {
	return env.DB
		.prepare(`INSERT OR IGNORE INTO recipes (${RECIPE_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
		.bind(key, clean.name, clean.emoji, clean.isNew ? 1 : 0, clean.desc, clean.cat, clean.by || null, clean.at || null);
}

/* Gemini ile birleştir (ücretsiz katman). Model rotasyonu: limitte sıradakine
   geçer. Başarısızsa null döner ki çağıran DeepSeek'e düşebilsin. */
async function geminiCombine(env, prompt) {
	if (!env.GEMINI_KEY) return null;
	for (const model of GEMINI_MODELS) {
		let res;
		try {
			res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
				method: "POST",
				headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
				body: JSON.stringify({
					contents: [{ role: "user", parts: [{ text: prompt }] }],
					generationConfig: {
						...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
						maxOutputTokens: 700,
						responseMimeType: "application/json",
						responseSchema: COMBINE_SCHEMA,
					},
				}),
			});
		} catch { return null; }
		if (res.status === 429 || res.status === 503 || res.status === 500) continue; // sıradaki model
		if (!res.ok) return null;
		const data = await res.json().catch(() => null);
		const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
		if (!text) continue;
		try { return JSON.parse(text); } catch { continue; }
	}
	return null;
}

/* DeepSeek ile birleştir (ücretli yedek). Başarısızsa null. */
async function deepseekCombine(env, prompt) {
	if (!env.DEEPSEEK_KEY) return null;
	let res;
	try {
		res = await fetch(DEEPSEEK_API_URL, {
			method: "POST",
			headers: { "content-type": "application/json", "authorization": "Bearer " + env.DEEPSEEK_KEY },
			body: JSON.stringify({
				model: DEEPSEEK_MODEL,
				messages: [
					{ role: "system", content: 'Yalnızca {"name","emoji","isNew","desc","category"} alanlarını içeren geçerli bir JSON nesnesi döndür, başka hiçbir metin yazma.' },
					{ role: "user", content: prompt },
				],
				response_format: { type: "json_object" },
				max_tokens: 700,
			}),
		});
	} catch { return null; }
	if (!res.ok) return null;
	const data = await res.json().catch(() => null);
	try { return JSON.parse(data?.choices?.[0]?.message?.content || ""); } catch { return null; }
}

/* IP başına basit hız sınırı (izolat belleğinde, en iyi çaba):
   ortak anahtarın bakiyesini korur. */
const RATE_LIMIT_PER_MIN = 35;
const rateMap = new Map();
function rateLimited(ip) {
	const now = Date.now();
	const slot = rateMap.get(ip);
	if (!slot || now > slot.resetAt) {
		rateMap.set(ip, { count: 1, resetAt: now + 60000 });
		return false;
	}
	slot.count += 1;
	return slot.count > RATE_LIMIT_PER_MIN;
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json", ...CORS },
	});
}

/* KV yazma sarmalayıcısı: günlük yazma limiti (ücretsiz katmanda 1000/gün) ya
   da geçici bir hata olduğunda isteği 500 ile düşürmek yerine sessizce
   başarısız sayarız. Böylece limit dolsa bile üyelik/kayıt akışı kırılmaz.
   (Tarifler artık D1'de — 100.000/gün — bu yüzden bu yalnızca KV içindir.) */
async function safePut(env, key, value, options) {
	try {
		await env.RECIPES.put(key, value, options);
		return true;
	} catch {
		return false;
	}
}

/* ---------- Tek seferlik göç: KV "pack" → D1 ----------
   Eski sürüm tarifleri tek bir KV "pack" anahtarında tutuyordu. D1'e geçişte
   o tarifleri bir kez D1'e taşırız. Tablo boşsa ve KV'de pack varsa kopyalanır;
   INSERT OR IGNORE olduğu için tekrar çalışsa bile zarar vermez. İzolat başına
   tek kez kontrol edilir (migrationDone bayrağı). */
let migrationDone = false;
async function ensureMigrated(env) {
	if (migrationDone || !env.DB) return;
	try {
		const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM recipes").first();
		if (row && row.n > 0) { migrationDone = true; return; }
		const pack = (env.RECIPES ? await env.RECIPES.get("pack", "json") : null) || {};
		const entries = Object.entries(pack);
		if (!entries.length) { migrationDone = true; return; }
		const CHUNK = 40; // batch başına ifade sayısı (8 parametre × 40 = 320 bağ)
		for (let i = 0; i < entries.length; i += CHUNK) {
			const stmts = entries.slice(i, i + CHUNK).map(([key, r]) => {
				const clean = {
					name: String(r?.name || "").slice(0, 40),
					emoji: String(r?.emoji || "✨").slice(0, 8),
					isNew: !!r?.isNew,
					desc: String(r?.desc || "").slice(0, 400),
					cat: String(r?.cat || "diger").slice(0, 16),
					by: r?.by ? String(r.by).slice(0, 24) : null,
					at: r?.at ? String(r.at).slice(0, 30) : null,
				};
				return insertRecipeStmt(env, key, clean);
			});
			await env.DB.batch(stmts);
		}
		migrationDone = true;
	} catch {
		// Göç başarısız olursa bayrağı set etmeyiz: sonraki istekte tekrar denenir.
	}
}

/* Türkçe-güvenli normalizasyon ve sıradan bağımsız ikili anahtarı —
   oyundaki data.js ile birebir aynı olmalıdır. */
function norm(s) {
	return String(s).trim().toLocaleLowerCase("tr");
}
function pairKey(a, b) {
	return [norm(a), norm(b)].sort((x, y) => x.localeCompare(y, "tr")).join("++");
}

/* ---------- Üyelik (benzersiz kullanıcı adı) ---------- */

async function sha256(s) {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validUsername(u) {
	return typeof u === "string" && /^[A-Za-z0-9_çğıöşüÇĞİÖŞÜ]{3,20}$/.test(u);
}

function randomToken() {
	return (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "" + Math.random())).replace(/-/g, "");
}

/* token → kullanıcı adı (doğrulanmış kimlik). */
async function resolveUser(env, token) {
	if (!token || typeof token !== "string") return null;
	const uname = await env.RECIPES.get("tok:" + token);
	if (!uname) return null;
	const acc = await env.RECIPES.get("user:" + uname, "json");
	return acc ? acc.username : null;
}

/* İstemciden gelen veri güvensizdir: anahtar ve alanlar sıkıca doğrulanır. */
function sanitize(key, result) {
	if (typeof key !== "string" || key.length > 90) return null;
	const parts = key.split("++");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	if (parts[0].length > 40 || parts[1].length > 40) return null;
	const name = String(result?.name || "").trim().slice(0, 40);
	if (!name) return null;
	const emoji = String(result?.emoji || "✨").trim().slice(0, 8);
	const desc = String(result?.desc || "").trim().slice(0, 400);
	const cats = ["doga", "canli", "yiyecek", "insan", "teknoloji", "uzay", "mitoloji", "soyut", "diger"];
	const cat = cats.includes(result?.cat) ? result.cat : "diger";
	const out = { name, emoji, isNew: !!result?.isNew, desc, cat };
	// İlk keşfeden bilgisi (varsa): görünen takma ad + tarih.
	const by = String(result?.by || "").trim().replace(/[<>]/g, "").slice(0, 24);
	if (by) out.by = by;
	const at = String(result?.at || "").trim().slice(0, 30);
	if (at) out.at = at;
	return out;
}

/* En fazla `max` anahtar tut (kayıt boyutunu sınırlar). */
function capObj(obj, max) {
	const keys = Object.keys(obj || {});
	if (keys.length <= max) return obj || {};
	const out = {};
	for (const k of keys.slice(0, max)) out[k] = obj[k];
	return out;
}

/* İki kaydı birleştirir: elementler/tarifler/rozetler birleşim, sayaçlar maks.
   Çakışmada mevcut (a) korunur — keşif tarihi/ilk-bulan stabil kalsın. */
function mergeSaves(a, b) {
	a = a || {}; b = b || {};
	const elements = capObj({ ...(b.elements || {}), ...(a.elements || {}) }, 8000);
	const recipes = capObj({ ...(b.recipes || {}), ...(a.recipes || {}) }, 8000);
	const badges = { ...(b.badges || {}), ...(a.badges || {}) };
	const sa = a.stats || {}, sb = b.stats || {};
	return {
		elements, recipes, badges,
		stats: {
			combos: Math.max(sa.combos || 0, sb.combos || 0),
			aiCalls: Math.max(sa.aiCalls || 0, sb.aiCalls || 0),
			quests: Math.max(sa.quests || 0, sb.quests || 0),
			discoveries: Object.keys(elements).length,
		},
	};
}

export default {
	async fetch(req, env, ctx) {
		if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
		const url = new URL(req.url);

		/* ---------- Üyelik ---------- */

		if (url.pathname === "/register" && req.method === "POST") {
			let body;
			try { body = await req.json(); } catch { return json({ error: "Geçersiz JSON" }, 400); }
			const username = String(body?.username || "").trim();
			const password = String(body?.password || "");
			if (!validUsername(username)) return json({ error: "Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _)." }, 400);
			if (password.length < 4) return json({ error: "Şifre en az 4 karakter olmalı." }, 400);
			const lower = norm(username);
			const existing = await env.RECIPES.get("user:" + lower, "json");
			if (existing) return json({ error: "Bu kullanıcı adı alınmış, başka bir tane deneyin." }, 409);
			const salt = randomToken();
			const hash = await sha256(salt + password);
			const acc = { username, salt, hash, userId: String(body?.userId || "").slice(0, 40), createdAt: new Date().toISOString() };
			const stored = await safePut(env, "user:" + lower, JSON.stringify(acc));
			if (!stored) return json({ error: "Kayıt şu an yapılamıyor (günlük yazma limiti doldu). Biraz sonra tekrar deneyin." }, 503);
			const token = randomToken();
			await safePut(env, "tok:" + token, lower, { expirationTtl: 60 * 60 * 24 * 365 });
			return json({ ok: true, token, username });
		}

		if (url.pathname === "/login" && req.method === "POST") {
			let body;
			try { body = await req.json(); } catch { return json({ error: "Geçersiz JSON" }, 400); }
			const username = String(body?.username || "").trim();
			const password = String(body?.password || "");
			const lower = norm(username);
			const acc = await env.RECIPES.get("user:" + lower, "json");
			if (!acc) return json({ error: "Kullanıcı bulunamadı." }, 404);
			const hash = await sha256(acc.salt + password);
			if (hash !== acc.hash) return json({ error: "Şifre yanlış." }, 401);
			const token = randomToken();
			await safePut(env, "tok:" + token, lower, { expirationTtl: 60 * 60 * 24 * 365 });
			return json({ ok: true, token, username: acc.username });
		}

		if (url.pathname === "/checkname" && req.method === "GET") {
			const username = String(url.searchParams.get("u") || "").trim();
			if (!validUsername(username)) return json({ available: false, error: "Geçersiz ad" });
			const existing = await env.RECIPES.get("user:" + norm(username), "json");
			return json({ available: !existing });
		}

		/* ---------- Bulut kayıt (hesaba bağlı ilerleme) ---------- */

		if (url.pathname === "/save" && req.method === "POST") {
			let body;
			try { body = await req.json(); } catch { return json({ error: "Geçersiz JSON" }, 400); }
			const user = await resolveUser(env, body?.token);
			if (!user) return json({ error: "Giriş gerekli." }, 401);
			const lower = norm(user);
			const existing = (await env.RECIPES.get("save:" + lower, "json")) || {};
			// Sunucu tarafı birleştirme: iki cihaz da katkı yapar, biri diğerini ezmez.
			const merged = mergeSaves(existing, body?.data || {});
			const saved = await safePut(env, "save:" + lower, JSON.stringify(merged));
			// Limit dolsa bile 500 atma: ilerleme yerelde duruyor, sonra eşitlenir.
			if (!saved) return json({ ok: false, error: "Günlük kayıt limiti doldu; ilerlemen cihazda güvende, sonra eşitlenecek." });
			return json({ ok: true, elements: Object.keys(merged.elements).length });
		}

		if (url.pathname === "/load" && req.method === "POST") {
			let body;
			try { body = await req.json(); } catch { return json({ error: "Geçersiz JSON" }, 400); }
			const user = await resolveUser(env, body?.token);
			if (!user) return json({ error: "Giriş gerekli." }, 401);
			const save = (await env.RECIPES.get("save:" + norm(user), "json")) || {};
			return json(save);
		}

		/* ---------- Tarif havuzu (D1) ---------- */

		/* Havuz paketi (hafif: desc YOK). Delta için ?since=<rid>: yalnızca o
		   imleçten SONRAKİ satırlar döner. Gövde DEĞİŞMEDEN düz {key: lite}
		   haritasıdır (eski istemciler bozulmaz); en büyük rowid yanıt başlığında
		   (X-Pool-Cursor) gelir — istemci bir sonraki çağrıda ?since olarak verir. */
		if (url.pathname === "/pack" && req.method === "GET") {
			if (!env.DB) return new Response("{}", { headers: { "content-type": "application/json", "X-Pool-Cursor": "0", ...CORS } });
			await ensureMigrated(env);
			const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
			const stmt = since > 0
				? env.DB.prepare(`SELECT ${PACK_COLS} FROM recipes WHERE rowid > ? ORDER BY rowid`).bind(since)
				: env.DB.prepare(`SELECT ${PACK_COLS} FROM recipes ORDER BY rowid`);
			const { results } = await stmt.all();
			const pack = {};
			let cursor = since;
			for (const row of results || []) {
				pack[row.key] = rowToLite(row);
				if (row.rid > cursor) cursor = row.rid;
			}
			return new Response(JSON.stringify(pack), {
				headers: { "content-type": "application/json", "X-Pool-Cursor": String(cursor), ...CORS },
			});
		}

		/* Tek tarifin tam kaydı (desc dahil) — istemci açıklamayı detay açılışında
		   tembel çeker (/pack artık desc taşımaz). */
		if (url.pathname === "/recipe" && req.method === "GET") {
			if (!env.DB) return json({});
			await ensureMigrated(env);
			const key = String(url.searchParams.get("key") || "");
			if (!key) return json({ error: "key gerekli" }, 400);
			const row = await env.DB.prepare(`SELECT ${RECIPE_COLS} FROM recipes WHERE key = ?`).bind(key).first();
			return row ? json(rowToRecipe(row)) : json({}, 404);
		}

		/* Liderlik tablosu: havuzdaki tüm tariflerde "ilk bulan"ları sayar,
		   en çok ilk keşfe sahip oyuncuları sıralar. */
		if (url.pathname === "/leaderboard" && req.method === "GET") {
			if (!env.DB) return json({ top: [], totalRecipes: 0, totalPlayers: 0 });
			await ensureMigrated(env);
			const { results } = await env.DB
				.prepare("SELECT finder AS name, COUNT(*) AS count FROM recipes WHERE finder IS NOT NULL AND finder != '' GROUP BY finder ORDER BY count DESC LIMIT 30")
				.all();
			const totals = await env.DB
				.prepare("SELECT (SELECT COUNT(*) FROM recipes) AS recipes, (SELECT COUNT(DISTINCT finder) FROM recipes WHERE finder IS NOT NULL AND finder != '') AS players")
				.first();
			// İstek yapan oyuncunun kesin sayısı (top 30 dışında olsa bile).
			const me = url.searchParams.get("me");
			let you;
			if (me) {
				const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM recipes WHERE finder = ?").bind(me).first();
				you = r ? r.c : 0;
			}
			return json({
				top: results || [],
				totalRecipes: totals?.recipes || 0,
				totalPlayers: totals?.players || 0,
				you,
			});
		}

		/* Dünya istatistik panosu: havuzun tek seferde sunucu tarafı toplaması.
		   İstemcide tüm tarifleri taramak yerine D1 toplar (ölçeklenir). */
		if (url.pathname === "/stats" && req.method === "GET") {
			if (!env.DB) return json({ totalRecipes: 0, totalPlayers: 0, categories: [], growth: [], topCreative: [], latest: [] });
			await ensureMigrated(env);
			const res = await env.DB.batch([
				env.DB.prepare("SELECT (SELECT COUNT(*) FROM recipes) AS recipes, (SELECT COUNT(DISTINCT finder) FROM recipes WHERE finder IS NOT NULL AND finder != '') AS players"),
				env.DB.prepare("SELECT cat, COUNT(*) AS count FROM recipes GROUP BY cat ORDER BY count DESC"),
				env.DB.prepare("SELECT substr(at,1,10) AS day, COUNT(*) AS count FROM recipes WHERE at IS NOT NULL AND at != '' GROUP BY day ORDER BY day DESC LIMIT 14"),
				env.DB.prepare("SELECT finder AS name, SUM(isnew) AS creative, COUNT(*) AS total FROM recipes WHERE finder IS NOT NULL AND finder != '' GROUP BY finder HAVING creative > 0 ORDER BY creative DESC, total DESC LIMIT 10"),
				env.DB.prepare("SELECT name, emoji, cat, finder AS by, at FROM recipes WHERE at IS NOT NULL AND at != '' ORDER BY at DESC LIMIT 12"),
			]);
			const totals = (res[0].results || [])[0] || {};
			return json({
				totalRecipes: totals.recipes || 0,
				totalPlayers: totals.players || 0,
				categories: res[1].results || [],
				growth: res[2].results || [],
				topCreative: res[3].results || [],
				latest: res[4].results || [],
			});
		}

		if (url.pathname === "/recipe" && req.method === "POST") {
			if (!env.DB) return json({ ok: false, error: "Havuz deposu yapılandırılmamış" }, 501);
			let body;
			try { body = await req.json(); } catch { return json({ error: "Geçersiz JSON" }, 400); }
			await ensureMigrated(env);
			// İlk keşfeden: doğrulanmış kullanıcı adı (token) varsa o esas alınır,
			// yoksa istemcinin gönderdiği takma ad (misafir) kullanılır.
			const authedUser = await resolveUser(env, body?.token);
			const credit = authedUser || body?.by || body?.result?.by;
			const incoming = { ...(body?.result || {}), by: credit, at: body?.at || body?.result?.at || new Date().toISOString() };
			const clean = sanitize(body?.key, incoming);
			if (!clean) return json({ error: "Geçersiz tarif" }, 400);
			// İlk yazan kazanır (INSERT OR IGNORE): havuz deterministik kalır.
			await insertRecipeStmt(env, body.key, clean).run();
			return json({ ok: true });
		}

		if (url.pathname === "/combine" && req.method === "POST") {
			let body;
			try { body = await req.json(); } catch { return json({ error: "Geçersiz JSON" }, 400); }
			const aName = String(body?.a?.name || "").trim().slice(0, 40);
			const bName = String(body?.b?.name || "").trim().slice(0, 40);
			if (!aName || !bName) return json({ error: "Geçersiz elementler" }, 400);
			const aEmoji = String(body?.a?.emoji || "✨").slice(0, 8);
			const bEmoji = String(body?.b?.emoji || "✨").slice(0, 8);

			const key = pairKey(aName, bName);

			// Önce havuz: dünyada daha önce sorulduysa anında ve bedava döner.
			if (env.DB) {
				await ensureMigrated(env);
				const row = await env.DB.prepare(`SELECT ${RECIPE_COLS} FROM recipes WHERE key = ?`).bind(key).first();
				if (row) return json(rowToRecipe(row));
			}

			if (!env.GEMINI_KEY && !env.DEEPSEEK_KEY) {
				return json({ error: "Ortak yapay zekâ yapılandırılmamış" }, 501);
			}

			const ip = req.headers.get("cf-connecting-ip") || "?";
			if (rateLimited(ip)) {
				return json({ error: "Çok hızlı! Biraz yavaşlayın, ortak yapay zekâ herkesin." }, 429);
			}

			const prompt = [
				'Sen "Element Simyası" adlı bir element birleştirme oyununun motorusun. Sana verilen iki elementin birleşiminden doğacak EN mantıklı ve yaratıcı TEK sonucu üret.',
				"Kurallar:",
				"1. Sonuç Türkçe tek bir kavram olsun (en fazla 3 kelime), baş harfleri büyük.",
				"2. Bağlantı mantıksal, bilimsel, kültürel veya esprili olabilir; somut nesneler, doğa olayları, canlılar, mitolojik varlıklar, teknoloji, soyut kavramlar ve popüler kültür (örn. Karadelik, Film, Ejderha, İnternet) geçerlidir.",
				'3. Mümkünse girdilerden daha "ileri" bir kavram üret (örn. Su + Ateş = Buhar; Yıldız + Yıldız = Galaksi).',
				"4. Sonuç girdilerden biriyle aynı olmasın (gerçekten en mantıklı sonuç oysa istisna).",
				"5. Aynı iki girdi için her zaman aynı tek cevabı verirmiş gibi en olası sonucu seç.",
				"6. emoji alanına kavramı en iyi anlatan TEK emoji yaz.",
				"7. isNew: sonuç sıra dışı/şaşırtıcı yeni bir buluşsa true, herkesin bileceği temel bir birleşimse false.",
				"8. desc alanına sonucu 2-3 cümleyle anlatan, hem bilgilendirici hem eğlenceli bir Türkçe açıklama yaz (en az 2 cümle).",
				"9. category alanına şunlardan birini yaz: doga, canli, yiyecek, insan, teknoloji, uzay, mitoloji, soyut.",
				"",
				`Birleştirilecek elementler: "${aEmoji} ${aName}" + "${bEmoji} ${bName}"`,
			].join("\n");

			// Önce ücretsiz Gemini; başarısız/limit ise ücretli DeepSeek'e düş.
			// Böylece DeepSeek bakiyesi yalnızca Gemini yetmediğinde harcanır.
			let raw = await geminiCombine(env, prompt);
			if (!raw) raw = await deepseekCombine(env, prompt);
			if (!raw) {
				return json({ error: "Ortak yapay zekâ şu an yanıt veremedi (limit/bakiye). Birazdan tekrar deneyin." }, 502);
			}

			// İlk keşfeden: doğrulanmış kullanıcı (token) önceliklidir, yoksa
			// gönderilen misafir takma adı kullanılır.
			const authed = await resolveUser(env, body?.token);
			const finder = (authed || String(body?.finder || "")).trim().replace(/[<>]/g, "").slice(0, 24);
			const clean = sanitize(key, {
				...raw, cat: raw.category || raw.cat,
				by: finder, at: new Date().toISOString(),
			});
			if (!clean) return json({ error: "Yapay zekâ geçersiz sonuç üretti" }, 502);

			// Havuza yaz (D1, satır başına bir tarif). İlk yazan kazanır.
			// D1 yazımı başarısız olsa bile sonuç yine döner; oyun kırılmaz.
			if (env.DB) {
				try {
					if (ctx && ctx.waitUntil) ctx.waitUntil(insertRecipeStmt(env, key, clean).run());
					else await insertRecipeStmt(env, key, clean).run();
				} catch { /* en iyi çaba */ }
			}
			return json(clean);
		}

		if (url.pathname === "/" || url.pathname === "") {
			let recipes = 0;
			if (env.DB) {
				try {
					await ensureMigrated(env);
					const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM recipes").first();
					recipes = row?.n || 0;
				} catch { /* D1 erişilemedi */ }
			}
			return json({
				app: "Element Simyası Havuzu",
				store: env.DB ? "d1" : "yok",
				recipes,
				ai: Boolean(env.GEMINI_KEY || env.DEEPSEEK_KEY),
				gemini: Boolean(env.GEMINI_KEY),
				deepseek: Boolean(env.DEEPSEEK_KEY),
			});
		}

		return json({ error: "Bulunamadı" }, 404);
	},
};
