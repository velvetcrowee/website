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
		throw new Error(msg);
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
		throw new Error(msg);
	}
	const data = await res.json();
	const text = (data.candidates?.[0]?.content?.parts || [])
		.map((p) => p.text || "")
		.join("");
	if (!text) throw new Error("Modelden yanıt alınamadı.");
	return text;
}

/* ---------- Sağlayıcıdan bağımsız yardımcılar ---------- */

/* JSON şemalı istek: metin → şemaya uyan nesne. */
async function aiJson({ prompt, schema, maxTokens }) {
	if (activeProvider() === "gemini") {
		return JSON.parse(await geminiRequest({ parts: [{ text: prompt }], schema, maxTokens }));
	}
	const response = await claudeRequest({
		max_tokens: maxTokens,
		output_config: { format: { type: "json_schema", schema: withStrict(schema) } },
		messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
	});
	const block = response.content.find((b) => b.type === "text");
	if (!block) throw new Error("Modelden metin yanıtı alınamadı.");
	return JSON.parse(block.text);
}

/* ---------- Element birleştirme ---------- */

const COMBINE_SCHEMA = {
	type: "object",
	properties: {
		name: { type: "string", description: "Sonuç elementin Türkçe adı, en fazla 3 kelime, baş harfler büyük" },
		emoji: { type: "string", description: "Kavramı en iyi anlatan TEK emoji" },
		isNew: { type: "boolean", description: "Sıra dışı/yaratıcı bir kavramsa true, bilinen temel bir birleşimse false" },
	},
	required: ["name", "emoji", "isNew"],
};

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
	return { name, emoji: "🧪", isNew: (norm(a.name) + norm(b.name)).length % 3 === 0 };
}

/* İki elementi yapay zekâ ile birleştirir; { name, emoji, isNew } döner. */
async function aiCombine(a, b) {
	if (mockEnabled()) return mockCombine(a, b);
	return aiJson({ prompt: combinePrompt(a, b), schema: COMBINE_SCHEMA, maxTokens: 1000 });
}
