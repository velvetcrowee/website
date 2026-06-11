/* Yapay zekâ katmanı — seçilen sağlayıcıya (Claude veya Gemini) tarayıcıdan
   doğrudan istek atar. Statik PWA olduğu için (paketleyici/sunucu yok) SDK
   yerine fetch kullanılır; anahtarlar kullanıcıya aittir ve yalnızca cihazda
   saklanır. */

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-4-8";
const GEMINI_MODEL = "gemini-2.5-flash";

function activeProvider() {
	return Store.settings.aiProvider || "gemini";
}

function activeKey() {
	const s = Store.settings;
	return activeProvider() === "gemini" ? (s.geminiKey || "") : (s.apiKey || "");
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

async function geminiRequest({ parts, schema, maxTokens }) {
	const apiKey = Store.settings.geminiKey;
	if (!apiKey) {
		throw new Error("NO_KEY");
	}
	const body = {
		contents: [{ role: "user", parts }],
		generationConfig: {
			// Gemini 2.5 "düşünme" tokenları çıktı bütçesinden yer; kapatınca
			// yanıt yarıda kesilmez (bozuk JSON biter), daha hızlı ve ucuz olur.
			thinkingConfig: { thinkingBudget: 0 },
			maxOutputTokens: maxTokens,
			...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}),
		},
	};
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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

/* ---------- Sağlayıcıdan bağımsız yardımcılar ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Tek bir JSON şemalı istek (yeniden deneme yok). */
async function aiJsonOnce({ prompt, schema, maxTokens }) {
	if (activeProvider() === "gemini") {
		const raw = await geminiRequest({ parts: [{ text: prompt }], schema, maxTokens });
		try {
			return JSON.parse(raw);
		} catch {
			// Yarıda kesilmiş / bozuk JSON → yeniden denenebilir.
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

/* JSON şemalı istek + geçici hatalarda üstel backoff'lu yeniden deneme.
   Limit/yoğunluk/kesik yanıt gibi durumlarda kullanıcıya hata göstermeden
   kendiliğinden tekrar dener. */
async function aiJson(opts) {
	const delays = [800, 2000, 4500];
	let lastErr;
	for (let attempt = 0; attempt <= delays.length; attempt++) {
		try {
			return await aiJsonOnce(opts);
		} catch (err) {
			lastErr = err;
			if (!err.retryable || attempt === delays.length) throw err;
			await sleep(delays[attempt]);
		}
	}
	throw lastErr;
}

/* ---------- Element birleştirme ---------- */

const COMBINE_SCHEMA = {
	type: "object",
	properties: {
		name: { type: "string", description: "Sonuç elementin Türkçe adı, en fazla 3 kelime, baş harfler büyük" },
		emoji: { type: "string", description: "Kavramı en iyi anlatan TEK emoji" },
		isNew: { type: "boolean", description: "Sıra dışı/yaratıcı bir kavramsa true, bilinen temel bir birleşimse false" },
		desc: { type: "string", description: "Sonucu bir cümleyle anlatan kısa Türkçe açıklama" },
	},
	required: ["name", "emoji", "isNew", "desc"],
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
		"8. desc alanına sonucu bir cümleyle anlatan kısa, eğlenceli bir Türkçe açıklama yaz.",
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
	return {
		name, emoji: "🧪",
		isNew: (norm(a.name) + norm(b.name)).length % 3 === 0,
		desc: `${a.name} ile ${b.name} deney tüpünde buluştu.`,
	};
}

/* İki elementi yapay zekâ ile birleştirir; { name, emoji, isNew } döner. */
async function aiCombine(a, b) {
	if (mockEnabled()) return mockCombine(a, b);
	return aiJson({ prompt: combinePrompt(a, b), schema: COMBINE_SCHEMA, maxTokens: 400 });
}
