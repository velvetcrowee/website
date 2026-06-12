/* Element Simyası — Küresel Tarif Havuzu (Cloudflare Worker)
 *
 * Tüm oyuncuların yapay zekâ keşifleri tek havuzda birikir: bir oyuncu bir
 * ikiliyi keşfettiğinde sonuç buraya yazılır; diğer oyuncular açılışta havuzu
 * indirir ve o ikili için bir daha yapay zekâya sorulmaz.
 *
 * Uçlar:
 *   GET  /pack    → tüm havuz { "ateş++su": {name,emoji,isNew,desc,cat}, ... }
 *   POST /recipe  → { key, result } yeni tarif ekler (var olanın üzerine yazmaz)
 *
 * Depolama: KV (RECIPES bağlaması), tek "pack" anahtarı altında.
 */

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-headers": "content-type",
};

const MAX_RECIPES = 50000;

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json", ...CORS },
	});
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

		if (url.pathname === "/" || url.pathname === "") {
			const pack = (await env.RECIPES.get("pack", "json")) || {};
			return json({ app: "Element Simyası Havuzu", recipes: Object.keys(pack).length });
		}

		return json({ error: "Bulunamadı" }, 404);
	},
};
