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
 *   GET  /         → durum { recipes, ai }
 *   GET  /pack     → tüm havuz { "ateş++su": {name,emoji,isNew,desc,cat}, ... }
 *   POST /recipe   → { key, result } yeni tarif ekler (var olanı ezmez)
 *   POST /combine  → { a:{name,emoji}, b:{name,emoji} } → tarif (havuz → AI)
 *
 * Depolama: KV (RECIPES bağlaması), tek "pack" anahtarı altında.
 */

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-headers": "content-type",
};

const MAX_RECIPES = 50000;
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];

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
   başarısız sayarız. Böylece limit dolsa bile oyun oynanmaya devam eder —
   birleştirme sonucu yine döner, yalnızca o an havuza/buluta yazılamaz. */
async function safePut(env, key, value, options) {
	try {
		await env.RECIPES.put(key, value, options);
		return true;
	} catch {
		return false;
	}
}

/* ---------- Toplu havuz yazımı (KV günlük yazma limitini korur) ----------
   Her yeni tarifte KV'ye yazmak yerine yeni tarifleri bellekte biriktirir ve en
   sık FLUSH_MIN_MS'de bir, mevcut KV havuzuyla birleştirerek TEK seferde yazarız.
   Böylece yazma SAYISI çok düşer (limit kolay kolay dolmaz). Bekleyen tarifler
   aynı isolate içindeki okumalardan da servis edilir; bu yüzden henüz yazılmamış
   olsa bile aynı ikili için yapay zekâ tekrar çağrılmaz. (En iyi çaba: isolate
   düşerse yazılmamış birkaç tarif kaybolur, oyun onları sonra yeniden üretir.) */
let PENDING = {};            // henüz KV'ye yazılmamış yeni tarifler { key: clean }
let LAST_FLUSH = 0;          // son KV yazma zamanı (ms)
const FLUSH_MIN_MS = 120000; // en sık 2 dakikada bir KV'ye yaz

/* Bekleyen tarifleri mevcut KV havuzuyla birleştirip yazar (throttle'lı).
   ctx.waitUntil ile yanıtı bloklamadan çalışır. */
async function flushPending(env, ctx, force) {
	if (!Object.keys(PENDING).length) return;
	const now = Date.now();
	if (!force && now - LAST_FLUSH < FLUSH_MIN_MS) return; // henüz erken — sonraki istekte yazılır
	LAST_FLUSH = now;
	const batch = PENDING;
	PENDING = {};
	const work = (async () => {
		// Diğer isolate'lerin eklediklerini ezmemek için taze KV ile birleştir.
		const current = (await env.RECIPES.get("pack", "json")) || {};
		let changed = false;
		for (const [k, v] of Object.entries(batch)) {
			if (!current[k] && Object.keys(current).length < MAX_RECIPES) { current[k] = v; changed = true; }
		}
		if (changed) {
			const ok = await safePut(env, "pack", JSON.stringify(current));
			if (!ok) Object.assign(PENDING, batch); // limit/hata → sonra tekrar denemek üzere geri koy
		}
	})();
	if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
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

		if (url.pathname === "/pack" && req.method === "GET") {
			const pack = (await env.RECIPES.get("pack", "json")) || {};
			// Henüz yazılmamış (bekleyen) tarifleri de kat — oyuncular hemen görür.
			return json(Object.keys(PENDING).length ? { ...pack, ...PENDING } : pack);
		}

		/* Liderlik tablosu: havuzdaki tüm tariflerde "ilk bulan"ları sayar,
		   en çok ilk keşfe sahip oyuncuları sıralar. */
		if (url.pathname === "/leaderboard" && req.method === "GET") {
			const pack = (await env.RECIPES.get("pack", "json")) || {};
			const counts = {};
			for (const r of Object.values(pack)) {
				if (r && r.by) counts[r.by] = (counts[r.by] || 0) + 1;
			}
			const top = Object.entries(counts)
				.map(([name, count]) => ({ name, count }))
				.sort((a, b) => b.count - a.count)
				.slice(0, 30);
			// İstek yapan oyuncunun kesin sayısı (top 30 dışında olsa bile).
			const me = url.searchParams.get("me");
			const you = me ? (counts[me] || 0) : undefined;
			return json({ top, totalRecipes: Object.keys(pack).length, totalPlayers: Object.keys(counts).length, you });
		}

		if (url.pathname === "/recipe" && req.method === "POST") {
			let body;
			try { body = await req.json(); } catch { return json({ error: "Geçersiz JSON" }, 400); }
			// İlk keşfeden: doğrulanmış kullanıcı adı (token) varsa o esas alınır,
			// yoksa istemcinin gönderdiği takma ad (misafir) kullanılır.
			const authedUser = await resolveUser(env, body?.token);
			const credit = authedUser || body?.by || body?.result?.by;
			const incoming = { ...(body?.result || {}), by: credit, at: new Date().toISOString() };
			const clean = sanitize(body?.key, incoming);
			if (!clean) return json({ error: "Geçersiz tarif" }, 400);

			const pack = (await env.RECIPES.get("pack", "json")) || {};
			if (pack[body.key] || PENDING[body.key]) {
				// İlk yazan kazanır: havuz deterministik kalır.
				return json({ ok: true, existing: true, total: Object.keys(pack).length });
			}
			if (Object.keys(pack).length >= MAX_RECIPES) {
				return json({ error: "Havuz dolu" }, 507);
			}
			// Toplu yazıma al (KV yazma sayısını düşürür); bekleyen okumalardan görünür.
			PENDING[body.key] = clean;
			await flushPending(env, ctx);
			return json({ ok: true, total: Object.keys(pack).length + 1 });
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
			const pack = (await env.RECIPES.get("pack", "json")) || {};
			if (pack[key]) return json(pack[key]);
			// Henüz yazılmamış ama bu isolate'te biliniyorsa yapay zekâya gitme.
			if (PENDING[key]) return json(PENDING[key]);

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

			// Havuza (toplu) yaz: yazımlar biriktirilip ~2 dakikada bir tek seferde
			// KV'ye gider — günlük yazma limiti korunur. Limit dolsa bile sonuç yine
			// döner; oyun kırılmaz.
			PENDING[key] = clean;
			await flushPending(env, ctx);
			return json(clean);
		}

		if (url.pathname === "/" || url.pathname === "") {
			const pack = (await env.RECIPES.get("pack", "json")) || {};
			return json({
				app: "Element Simyası Havuzu",
				recipes: Object.keys(pack).length,
				ai: Boolean(env.GEMINI_KEY || env.DEEPSEEK_KEY),
				gemini: Boolean(env.GEMINI_KEY),
				deepseek: Boolean(env.DEEPSEEK_KEY),
			});
		}

		return json({ error: "Bulunamadı" }, 404);
	},
};
