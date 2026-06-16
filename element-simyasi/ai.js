/* Yapay zekâ katmanı — seçilen sağlayıcıya (Claude veya Gemini) tarayıcıdan
   doğrudan istek atar. Statik PWA olduğu için (paketleyici/sunucu yok) SDK
   yerine fetch kullanılır; anahtarlar kullanıcıya aittir ve yalnızca cihazda
   saklanır. */

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-4-8";

/* Gemini'de her modelin AYRI ücretsiz kotası vardır. Limit dolunca sıradaki
   modele geçilir (rotasyon) — tek modelin dakika limitine takılıp beklemek
   yerine üç modelin toplam kotası kullanılır. flash-lite hem en hızlısı hem
   en yüksek limitlisi olduğu için ilk sıradadır; bu basit görev için yeterlidir. */
const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];
let geminiModelIdx = 0;

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

function activeProvider() {
	return Store.settings.aiProvider || "gemini";
}

function activeKey() {
	const s = Store.settings;
	const p = activeProvider();
	if (p === "gemini") return s.geminiKey || "";
	if (p === "deepseek") return s.deepseekKey || "";
	return s.apiKey || "";
}

/* ---------- Claude ---------- */

async function claudeRequest(body) {
	const apiKey = Store.settings.apiKey;
	if (!apiKey) {
		throw new Error("NO_KEY");
	}
	const res = await fetch(CLAUDE_API_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"anthropic-dangerous-direct-browser-access": "true",
		},
		body: JSON.stringify({ model: CLAUDE_MODEL, thinking: { type: "adaptive" }, ...body }),
	});
	if (!res.ok) {
		let msg = `API hatası (${res.status})`;
		try {
			const err = await res.json();
			if (err.error && err.error.message) msg = err.error.message;
		} catch { /* gövde okunamadı */ }
		if (res.status === 401) msg = "Claude API anahtarı geçersiz. Ayarlar'dan kontrol edin.";
		if (res.status === 429) msg = "İstek limiti aşıldı, biraz bekleyip tekrar deneyin.";
		const e = new Error(msg);
		e.retryable = res.status === 429 || res.status === 503 || res.status === 529;
		throw e;
	}
	return res.json();
}

/* Claude structured outputs tüm nesnelerde additionalProperties:false ister;
   Gemini ise bu alanı kabul etmez. Ortak şemaya Claude için ekleriz. */
function withStrict(schema) {
	const s = JSON.parse(JSON.stringify(schema));
	(function walk(node) {
		if (!node || typeof node !== "object") return;
		if (node.type === "object") {
			node.additionalProperties = false;
			Object.values(node.properties || {}).forEach(walk);
		}
		if (node.type === "array") walk(node.items);
	})(s);
	return s;
}

/* ---------- Gemini ---------- */

async function geminiRequest({ parts, schema, maxTokens, model }) {
	const apiKey = Store.settings.geminiKey;
	if (!apiKey) {
		throw new Error("NO_KEY");
	}
	model = model || GEMINI_MODELS[0];
	const body = {
		contents: [{ role: "user", parts }],
		generationConfig: {
			// Gemini 2.5 "düşünme" tokenları çıktı bütçesinden yer; kapatınca
			// yanıt yarıda kesilmez (bozuk JSON biter), daha hızlı ve ucuz olur.
			// (2.0 modelleri thinkingConfig kabul etmez.)
			...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
			maxOutputTokens: maxTokens,
			...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}),
		},
	};
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-goog-api-key": apiKey,
			},
			body: JSON.stringify(body),
		}
	);
	if (!res.ok) {
		let msg = `API hatası (${res.status})`;
		try {
			const err = await res.json();
			if (err.error && err.error.message) msg = err.error.message;
		} catch { /* gövde okunamadı */ }
		if (res.status === 400 || res.status === 403) msg = "Gemini API anahtarı geçersiz olabilir. Ayarlar'dan kontrol edin.";
		if (res.status === 429) msg = "Gemini istek limiti aşıldı, biraz bekleyip tekrar deneyin.";
		const e = new Error(msg);
		// Geçici hatalar yeniden denenebilir (limit / aşırı yoğunluk / sunucu).
		e.retryable = res.status === 429 || res.status === 503 || res.status === 500;
		// Limitte sıradaki modele geçilir (her modelin kotası ayrıdır).
		e.rateLimited = res.status === 429 || res.status === 503;
		throw e;
	}
	const data = await res.json();
	// Yanıt MAX_TOKENS yüzünden kesildiyse bunu yeniden denenebilir say.
	const finish = data.candidates?.[0]?.finishReason;
	const text = (data.candidates?.[0]?.content?.parts || [])
		.map((p) => p.text || "")
		.join("");
	if (!text) {
		const e = new Error("Modelden yanıt alınamadı.");
		e.retryable = finish === "MAX_TOKENS" || finish === "OTHER" || !finish;
		throw e;
	}
	if (finish === "MAX_TOKENS") {
		const e = new Error("Yanıt yarıda kesildi.");
		e.retryable = true;
		throw e;
	}
	return text;
}

/* ---------- DeepSeek (OpenAI uyumlu) ---------- */

async function deepseekRequest({ prompt, schema, maxTokens }) {
	const apiKey = Store.settings.deepseekKey;
	if (!apiKey) {
		throw new Error("NO_KEY");
	}
	// DeepSeek JSON modunda şema almaz; istenen yapı prompt'a yazılır ve
	// response_format ile geçerli JSON garanti edilir.
	const sys = "Yalnızca şu şemaya uyan geçerli bir JSON nesnesi döndür, başka hiçbir metin yazma: "
		+ JSON.stringify(schema.properties) + " — zorunlu alanlar: " + (schema.required || []).join(", ") + ".";
	const res = await fetch(DEEPSEEK_API_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"authorization": "Bearer " + apiKey,
		},
		body: JSON.stringify({
			model: DEEPSEEK_MODEL,
			messages: [
				{ role: "system", content: sys },
				{ role: "user", content: prompt },
			],
			response_format: { type: "json_object" },
			max_tokens: maxTokens,
		}),
	});
	if (!res.ok) {
		let msg = `API hatası (${res.status})`;
		try {
			const err = await res.json();
			if (err.error && err.error.message) msg = err.error.message;
		} catch { /* gövde okunamadı */ }
		if (res.status === 401) msg = "DeepSeek API anahtarı geçersiz. Ayarlar'dan kontrol edin.";
		if (res.status === 402) msg = "DeepSeek bakiyeniz yetersiz. Hesabınıza kontör yükleyin.";
		if (res.status === 429) msg = "DeepSeek istek limiti aşıldı, biraz bekleyip tekrar deneyin.";
		const e = new Error(msg);
		e.retryable = res.status === 429 || res.status === 503 || res.status === 500;
		throw e;
	}
	const data = await res.json();
	const text = data.choices?.[0]?.message?.content || "";
	if (!text) throw new Error("Modelden yanıt alınamadı.");
	return text;
}

/* ---------- Sağlayıcıdan bağımsız yardımcılar ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Tek bir JSON şemalı istek (yeniden deneme yok). */
async function aiJsonOnce({ prompt, schema, maxTokens }) {
	const provider = activeProvider();
	if (provider === "gemini") {
		const model = GEMINI_MODELS[geminiModelIdx % GEMINI_MODELS.length];
		const raw = await geminiRequest({ parts: [{ text: prompt }], schema, maxTokens, model });
		try {
			return JSON.parse(raw);
		} catch {
			// Yarıda kesilmiş / bozuk JSON → yeniden denenebilir.
			const e = new Error("Yanıt çözümlenemedi.");
			e.retryable = true;
			throw e;
		}
	}
	if (provider === "deepseek") {
		const raw = await deepseekRequest({ prompt, schema, maxTokens });
		try {
			return JSON.parse(raw);
		} catch {
			const e = new Error("Yanıt çözümlenemedi.");
			e.retryable = true;
			throw e;
		}
	}
	const response = await claudeRequest({
		max_tokens: maxTokens,
		output_config: { format: { type: "json_schema", schema: withStrict(schema) } },
		messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
	});
	const block = response.content.find((b) => b.type === "text");
	if (!block) throw new Error("Modelden metin yanıtı alınamadı.");
	try {
		return JSON.parse(block.text);
	} catch {
		const e = new Error("Yanıt çözümlenemedi.");
		e.retryable = true;
		throw e;
	}
}

/* Ağ hatası mı (fetch tamamen başarısız — bağlantı/CORS/sunucu erişilemez)? */
function isNetworkError(err) {
	return err && (err.name === "TypeError" || /failed to fetch|networkerror|load failed|fetch/i.test(err.message || ""));
}

/* Geçici hatalarda yeniden deneme sarmalayıcısı. Ağ hataları ve limit/yoğunluk
   gibi durumlar otomatik tekrar denenir; Gemini limitinde sıradaki modele geçilir.
   Hem kendi-anahtar (aiJson) hem havuz (poolCombine) yolunda kullanılır. */
async function withRetry(fn) {
	const maxAttempts = 5;
	let lastErr;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			if (isNetworkError(err)) err.retryable = true;
			if (!err.retryable || attempt === maxAttempts - 1) throw err;
			if (err.rateLimited && activeProvider() === "gemini") {
				geminiModelIdx = (geminiModelIdx + 1) % GEMINI_MODELS.length;
				await sleep(300);
			} else {
				await sleep([800, 1500, 3000, 5000][attempt] || 5000);
			}
		}
	}
	throw lastErr;
}

/* JSON şemalı istek + geçici hatalarda yeniden deneme. */
async function aiJson(opts) {
	return withRetry(() => aiJsonOnce(opts));
}

/* ---------- Element birleştirme ---------- */

const COMBINE_SCHEMA = {
	type: "object",
	properties: {
		name: { type: "string", description: "Sonuç elementin Türkçe adı, en fazla 3 kelime, baş harfler büyük" },
		emoji: { type: "string", description: "Kavramı en iyi anlatan TEK emoji" },
		isNew: { type: "boolean", description: "Sıra dışı/yaratıcı bir kavramsa true, bilinen temel bir birleşimse false" },
		desc: { type: "string", description: "Sonucu 2-3 cümleyle anlatan, bilgilendirici ve eğlenceli Türkçe açıklama (en az 2 cümle)" },
		category: {
			type: "string",
			enum: ["doga", "canli", "yiyecek", "insan", "teknoloji", "uzay", "mitoloji", "soyut"],
			description: "Sonucun kategorisi: doga(doğa), canli(canlılar), yiyecek, insan(insan&toplum), teknoloji, uzay, mitoloji(mitoloji&sihir), soyut(kültür&soyut)",
		},
	},
	required: ["name", "emoji", "isNew", "desc", "category"],
};

/* Oyunun belleğinden prompt'a bağlam üretir: son keşifler ve oyuncunun
   kendi dünyasından örnek tarifler. Oyun ilerledikçe yapay zekâ bu dünyayla
   tutarlı kalır ve daha cesur kavramlara yönelir — oyun keşifle gelişir. */
function memoryContext() {
	const els = elementList();
	const count = els.length;
	const recent = els.slice(0, 12).map((e) => `${e.emoji} ${e.name}`).join(", ");
	const learned = Object.entries(Store.recipes).slice(-8)
		.map(([k, r]) => { const [x, y] = k.split("++"); return `${x} + ${y} = ${r.name}`; });
	const level = count < 20
		? "Oyun henüz başlarda: temel, öğretici ve doğal sonuçlara öncelik ver."
		: count < 60
			? "Oyuncu ilerledi: daha yaratıcı olabilirsin; bilim, tarih ve kültüre açıl."
			: "Oyuncu usta seviyesinde: cesur ol; uzay, mitoloji, teknoloji, soyut kavramlar ve popüler kültürden sıra dışı sonuçlar üretebilirsin.";
	const lines = [
		`Oyunun hafızası: oyuncu şu ana kadar ${count} element keşfetti.`,
		recent ? `Son keşifler: ${recent}.` : "",
		learned.length ? `Oyuncunun dünyasından örnek tarifler: ${learned.join("; ")}.` : "",
		`Bu dünyayla tutarlı kal. ${level}`,
	];
	return lines.filter(Boolean).join("\n");
}

function combinePrompt(a, b) {
	return [
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
		"9. category alanına sonucun en uygun kategorisini yaz.",
		"",
		memoryContext(),
		"",
		`Birleştirilecek elementler: "${a.emoji} ${a.name}" + "${b.emoji} ${b.name}"`,
	].join("\n");
}

/* Mock modu: anahtar gerektirmeden tüm boru hattını (önbellek, dedup, toast,
   kalıcılık) test etmek için deterministik sahte sonuç üretir. ?mock=1 ile açılır. */
function mockEnabled() {
	return new URLSearchParams(location.search).has("mock") || DB.read("mock", false);
}

function mockCombine(a, b) {
	const name = `${a.name}-${b.name} Karışımı`.slice(0, 40);
	const cats = ["doga", "canli", "teknoloji", "uzay", "mitoloji", "soyut"];
	return {
		name, emoji: "🧪",
		isNew: (norm(a.name) + norm(b.name)).length % 3 === 0,
		desc: `${a.name} ile ${b.name} deney tüpünde buluştu.`,
		category: cats[(norm(a.name) + norm(b.name)).length % cats.length],
	};
}

/* ---------- Element görseli (Gemini görsel üretimi) ----------
   Oyuncunun kendi Gemini anahtarıyla, istek üzerine tek bir element görseli
   üretir; sonuç data URL olarak döner ve cihazda önbelleğe alınır (tekrar
   üretilmez). Havuz sunucusunda görsel ucu olmadığından bu özellik yalnızca
   kendi Gemini anahtarı olan oyuncular için çalışır. */
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";

async function generateElementImage(el) {
	const apiKey = Store.settings.geminiKey;
	if (!apiKey) throw new Error("NO_KEY");
	const prompt = `"${el.name}" kavramını temsil eden, renkli, parlak, oyun ikonu/sticker tarzında, sade ve tek renkli arka planlı küçük bir illüstrasyon üret. Yazı ekleme.`;
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,
		{
			method: "POST",
			headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
			body: JSON.stringify({
				contents: [{ role: "user", parts: [{ text: prompt }] }],
				generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
			}),
		}
	);
	if (!res.ok) {
		let msg = `Görsel API hatası (${res.status})`;
		try { const err = await res.json(); if (err.error?.message) msg = err.error.message; } catch { /* gövde yok */ }
		throw new Error(msg);
	}
	const data = await res.json();
	const parts = data.candidates?.[0]?.content?.parts || [];
	const img = parts.find((p) => p.inlineData && p.inlineData.data);
	if (!img) throw new Error("Görsel üretilemedi.");
	return `data:${img.inlineData.mimeType || "image/png"};base64,${img.inlineData.data}`;
}

/* ---------- Paylaşımlı element görseli (Pollinations) ----------
   Anahtarsız, ücretsiz görsel servisi. Element adından deterministik bir URL
   kurulur (seed = ad hash'i) → aynı element herkeste AYNI görseli verir ve sayfa
   yenilense de sabit kalır. Kurulum/anahtar/sunucu gerekmez; <img src> doğrudan
   yükler. (İleride kendi R2'mize taşımak istenirse yalnızca poolImageUrl değişir.) */
function strHash(s) {
	// djb2 — küçük, deterministik 32-bit hash (seed için yeterli).
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
	return h >>> 0;
}

function imagePromptText(name) {
	return `${name}, renkli parlak oyun ikonu, sticker tarzı, sade düz arka plan, yazısız dijital illüstrasyon`;
}

// Görsel önbellek sürümü: prompt/üretim mantığı değişince artır → eski (alakasız)
// önbellekli görseller atlanır, yenisi üretilir.
const POOL_IMG_VER = 7;
function poolImageUrl(name) {
	// Önce havuz Worker'ı üzerinden: görseli Cloudflare'in ağı çağırır (kullanıcının
	// ağı Pollinations'a erişemese de çalışır) ve sunucuda önbelleğe alınır.
	const base = (typeof activePoolUrl === "function") ? activePoolUrl() : "";
	if (base) return base + "/image?name=" + encodeURIComponent(name) + "&v=" + POOL_IMG_VER;
	// Havuz yoksa doğrudan Pollinations (yedek).
	const seed = strHash(norm(name));
	const prompt = encodeURIComponent(imagePromptText(name));
	return `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&seed=${seed}&nologo=true&model=flux`;
}

/* ---------- Üyelik (havuz sunucusu üzerinden) ---------- */

async function accountRequest(path, payload) {
	const poolUrl = typeof activePoolUrl === "function" ? activePoolUrl() : "";
	if (!poolUrl) throw new Error("Üyelik için havuz sunucusu gerekli — site sahibine bildirin.");
	const res = await fetch(poolUrl + path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	let data = {};
	try { data = await res.json(); } catch { /* gövde yok */ }
	if (!res.ok) throw new Error(data.error || `Sunucu hatası (${res.status})`);
	return data;
}

/* Yeni hesap oluşturur; benzersiz kullanıcı adını sunucu garanti eder. */
async function registerAccount(username, password) {
	const data = await accountRequest("/register", { username, password, userId: getUserId() });
	DB.write("account", { token: data.token, username: data.username });
	return data.username;
}

/* Var olan hesaba giriş yapar. */
async function loginAccount(username, password) {
	const data = await accountRequest("/login", { username, password });
	DB.write("account", { token: data.token, username: data.username });
	return data.username;
}

function logoutAccount() {
	DB.remove("account");
}

/* Ortak yapay zekâ: oyuncunun kendi anahtarı yoksa istek, havuz sunucusuna
   gider — DeepSeek anahtarı sunucuda gizli tutulur, tarayıcıya asla inmez. */
async function poolCombine(poolUrl, a, b) {
	let res;
	try {
		res = await fetch(poolUrl + "/combine", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				a: { name: a.name, emoji: a.emoji },
				b: { name: b.name, emoji: b.emoji },
				finder: getNickname(),
				finderId: getUserId(),
				token: getToken(),
			}),
		});
	} catch {
		// Ağ/bağlantı hatası → yeniden denenebilir.
		const e = new Error("Sunucuya ulaşılamadı, tekrar deneniyor…");
		e.retryable = true;
		throw e;
	}
	if (!res.ok) {
		let msg = `Ortak yapay zekâ hatası (${res.status})`;
		try {
			const err = await res.json();
			if (err.error) msg = err.error;
		} catch { /* gövde okunamadı */ }
		// Sunucuda ortak anahtar yoksa normal anahtarsız akışa düş.
		if (res.status === 501) throw new Error("NO_KEY");
		const e = new Error(msg);
		e.retryable = res.status === 429 || res.status === 503 || res.status === 500;
		throw e;
	}
	return res.json();
}

/* İki elementi yapay zekâ ile birleştirir; { name, emoji, isNew, ... } döner. */
async function aiCombine(a, b) {
	if (mockEnabled()) return mockCombine(a, b);
	if (!activeKey()) {
		const poolUrl = typeof activePoolUrl === "function" ? activePoolUrl() : "";
		if (poolUrl) return withRetry(() => poolCombine(poolUrl, a, b));
	}
	return aiJson({ prompt: combinePrompt(a, b), schema: COMBINE_SCHEMA, maxTokens: 400 });
}
