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

/* Türkçe-güvenli normalizasyon ve sıradan bağımsız ikili anahtarı —
   oyundaki data.js ile birebir aynı olmalıdır. */
function norm(s) {
	return String(s).trim().toLocaleLowerCase("tr");
}
function pairKey(a, b) {
	return [norm(a), norm(b)].sort((x, y) => x.localeCompare(y, "tr")).join("++");
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
	const desc = String(result?.desc || "").trim().slice(0, 160);
	const cats = ["doga", "canli", "yiyecek", "insan", "teknoloji", "uzay", "mitoloji", "soyut", "diger"];
	const cat = cats.includes(result?.cat) ? result.cat : "diger";
	return { name, emoji, isNew: !!result?.isNew, desc, cat };
}

export default {
	async fetch(req, env) {
		if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
		const url = new URL(req.url);

		if (url.pathname === "/pack" && req.method === "GET") {
			const pack = (await env.RECIPES.get("pack", "json")) || {};
			return json(pack);
		}

		if (url.pathname === "/recipe" && req.method === "POST") {
			let body;
			try { body = await req.json(); } catch { return json({ error: "Geçersiz JSON" }, 400); }
			const clean = sanitize(body?.key, body?.result);
			if (!clean) return json({ error: "Geçersiz tarif" }, 400);

			const pack = (await env.RECIPES.get("pack", "json")) || {};
			if (pack[body.key]) {
				// İlk yazan kazanır: havuz deterministik kalır.
				return json({ ok: true, existing: true, total: Object.keys(pack).length });
			}
			if (Object.keys(pack).length >= MAX_RECIPES) {
				return json({ error: "Havuz dolu" }, 507);
			}
			pack[body.key] = clean;
			await env.RECIPES.put("pack", JSON.stringify(pack));
			return json({ ok: true, total: Object.keys(pack).length });
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

			if (!env.DEEPSEEK_KEY) {
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
				"8. desc alanına sonucu bir cümleyle anlatan kısa, eğlenceli bir Türkçe açıklama yaz.",
				"9. category alanına şunlardan birini yaz: doga, canli, yiyecek, insan, teknoloji, uzay, mitoloji, soyut.",
				"",
				`Birleştirilecek elementler: "${aEmoji} ${aName}" + "${bEmoji} ${bName}"`,
			].join("\n");

			const res = await fetch(DEEPSEEK_API_URL, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"authorization": "Bearer " + env.DEEPSEEK_KEY,
				},
				body: JSON.stringify({
					model: DEEPSEEK_MODEL,
					messages: [
						{ role: "system", content: 'Yalnızca {"name","emoji","isNew","desc","category"} alanlarını içeren geçerli bir JSON nesnesi döndür, başka hiçbir metin yazma.' },
						{ role: "user", content: prompt },
					],
					response_format: { type: "json_object" },
					max_tokens: 400,
				}),
			});
			if (!res.ok) {
				const status = res.status === 429 ? 429 : 502;
				let msg = `Yapay zekâ hatası (${res.status})`;
				if (res.status === 402) msg = "Ortak yapay zekâ bakiyesi tükendi — site sahibine haber verin.";
				if (res.status === 429) msg = "Ortak yapay zekâ yoğun, biraz bekleyip tekrar deneyin.";
				return json({ error: msg }, status);
			}
			const data = await res.json();
			let raw;
			try { raw = JSON.parse(data.choices?.[0]?.message?.content || ""); }
			catch { return json({ error: "Yapay zekâ yanıtı çözümlenemedi" }, 502); }

			const clean = sanitize(key, { ...raw, cat: raw.category || raw.cat });
			if (!clean) return json({ error: "Yapay zekâ geçersiz sonuç üretti" }, 502);

			// Havuza yaz: dünyada bir daha sorulmaz.
			const fresh = (await env.RECIPES.get("pack", "json")) || {};
			if (!fresh[key] && Object.keys(fresh).length < MAX_RECIPES) {
				fresh[key] = clean;
				await env.RECIPES.put("pack", JSON.stringify(fresh));
			}
			return json(fresh[key] || clean);
		}

		if (url.pathname === "/" || url.pathname === "") {
			const pack = (await env.RECIPES.get("pack", "json")) || {};
			return json({
				app: "Element Simyası Havuzu",
				recipes: Object.keys(pack).length,
				ai: Boolean(env.DEEPSEEK_KEY),
			});
		}

		return json({ error: "Bulunamadı" }, 404);
	},
};
