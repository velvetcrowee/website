/* Yapay zekâ katmanı — seçilen sağlayıcıya (Claude veya Gemini) tarayıcıdan
   doğrudan istek atar. Statik PWA olduğu için (paketleyici/sunucu yok) SDK
   yerine fetch kullanılır; anahtarlar kullanıcıya aittir ve yalnızca cihazda
   saklanır. */

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-4-8";
const GEMINI_MODEL = "gemini-2.5-flash";

function activeProvider() {
	return Store.settings.aiProvider || "claude";
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

/* JSON şemalı istek: isteğe bağlı fotoğraf + metin → şemaya uyan nesne. */
async function aiJson({ imageB64, prompt, schema, maxTokens }) {
	if (activeProvider() === "gemini") {
		const parts = [];
		if (imageB64) parts.push({ inline_data: { mime_type: "image/jpeg", data: imageB64 } });
		parts.push({ text: prompt });
		return JSON.parse(await geminiRequest({ parts, schema, maxTokens }));
	}
	const content = [];
	if (imageB64) {
		content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } });
	}
	content.push({ type: "text", text: prompt });
	const response = await claudeRequest({
		max_tokens: maxTokens,
		output_config: { format: { type: "json_schema", schema: withStrict(schema) } },
		messages: [{ role: "user", content }],
	});
	const block = response.content.find((b) => b.type === "text");
	if (!block) throw new Error("Modelden metin yanıtı alınamadı.");
	return JSON.parse(block.text);
}

/* Serbest metin isteği. */
async function aiText({ prompt, maxTokens }) {
	if (activeProvider() === "gemini") {
		return geminiRequest({ parts: [{ text: prompt }], maxTokens });
	}
	const response = await claudeRequest({
		max_tokens: maxTokens,
		messages: [{ role: "user", content: prompt }],
	});
	const block = response.content.find((b) => b.type === "text");
	return block ? block.text : "";
}

/* ---------- Uygulama özellikleri ---------- */

/* Fotoğrafı analiz et: yemeği tanı, yorumla, kaloriyi tahmin et. */
async function aiAnalyzeFood(base64Jpeg) {
	const schema = {
		type: "object",
		properties: {
			name: { type: "string", description: "Yemeğin Türkçe adı" },
			items: {
				type: "array",
				description: "Tabaktaki bileşenler ve tahmini kalorileri",
				items: {
					type: "object",
					properties: {
						item: { type: "string" },
						kcal: { type: "integer" },
					},
					required: ["item", "kcal"],
				},
			},
			totalKcal: { type: "integer", description: "Toplam tahmini kalori" },
			protein: { type: "integer", description: "Tahmini protein (gram)" },
			comment: { type: "string", description: "Kullanıcının hedefine göre 1-2 cümle Türkçe değerlendirme" },
		},
		required: ["name", "items", "totalKcal", "protein", "comment"],
	};

	const goal = GOAL_LABELS[Store.settings.goal] || GOAL_LABELS["fatloss-muscle"];
	return aiJson({
		imageB64: base64Jpeg,
		maxTokens: 4000,
		schema,
		prompt:
			"Bu yemek fotoğrafını analiz et. Yemeği tanı, porsiyon büyüklüğünü göz önünde " +
			"bulundurarak bileşen bileşen kalori tahmini yap ve toplam kaloriyi ver. " +
			`Kullanıcının hedefi: ${goal}. Bu hedefe göre kısa bir Türkçe yorum ekle ` +
			"(örn. protein yeterli mi, porsiyon uygun mu).",
	});
}

/* Hedefe yönelik haftalık antrenman programı oluştur. */
async function aiGenerateProgram() {
	const schema = {
		type: "object",
		properties: {
			days: {
				type: "array",
				items: {
					type: "object",
					properties: {
						dayOfWeek: { type: "integer", description: "1=Pazartesi ... 7=Pazar" },
						name: { type: "string", description: "Günün Türkçe adı, örn. 'Sırt Günü'" },
						focus: { type: "string", description: "Hedeflenen kas grupları, Türkçe" },
						exercises: {
							type: "array",
							items: {
								type: "object",
								properties: {
									name: { type: "string", description: "Hareketin adı (yaygın kullanılan haliyle)" },
									sets: { type: "integer" },
									reps: { type: "integer" },
								},
								required: ["name", "sets", "reps"],
							},
						},
					},
					required: ["dayOfWeek", "name", "focus", "exercises"],
				},
			},
		},
		required: ["days"],
	};

	const s = Store.settings;
	const goal = GOAL_LABELS[s.goal] || GOAL_LABELS["fatloss-muscle"];
	const weights = Store.weights;
	const current = weights.length ? `${weights[weights.length - 1].kg} kg` : "bilinmiyor";
	const target = s.targetWeight ? `${s.targetWeight} kg` : "belirtilmedi";

	return aiJson({
		maxTokens: 8000,
		schema,
		prompt:
			"Spor salonunda ağırlık antrenmanı yapan bir kullanıcı için 7 günlük haftalık program hazırla. " +
			`Hedef: ${goal}. Mevcut kilo: ${current}. Hedef kilo: ${target}. ` +
			"Kurallar: her antrenman günü 4-6 hareket içersin; set x tekrar şeması hedefe uygun olsun " +
			"(örn. 3x12, 4x10); haftada 1-2 dinlenme veya kardiyo günü olsun; gün adları ve açıklamalar " +
			"Türkçe, hareket adları salonlarda yaygın kullanılan haliyle yazılsın. " +
			"dayOfWeek alanında 1 Pazartesi, 7 Pazar demektir ve 7 günün tamamı listede olmalı " +
			"(dinlenme günü için exercises boş dizi olabilir).",
	});
}

/* Bugünkü antrenman + son kayıtlara göre kısa öneri metni. */
async function aiDailyTips(todayPlan) {
	const logs = Store.workoutLogs;
	const recent = Object.keys(logs).sort().slice(-7)
		.map((d) => `${d}: ${Object.entries(logs[d]).map(([ex, v]) => `${ex} ${v.weight} kg`).join(", ")}`)
		.join("\n") || "Henüz kayıt yok.";
	const goal = GOAL_LABELS[Store.settings.goal] || GOAL_LABELS["fatloss-muscle"];

	return aiText({
		maxTokens: 2000,
		prompt:
			`Hedefim: ${goal}.\n` +
			`Bugünkü antrenman: ${todayPlan.name} — ` +
			todayPlan.exercises.map((e) => `${e.name} ${e.sets}x${e.reps}`).join(", ") + ".\n" +
			`Son 7 günün ağırlık kayıtları:\n${recent}\n\n` +
			"Bana bugünkü antrenman için kısa, maddeler halinde Türkçe öneriler ver: " +
			"hangi harekette ağırlığı artırabilirim, nelere dikkat etmeliyim, form ipuçları. " +
			"En fazla 6 madde, toplam 120 kelimeyi geçme. Başlık veya giriş cümlesi yazma.",
	});
}

/* Son 7 günün tüm verilerini analiz edip Türkçe haftalık rapor üretir. */
async function aiWeeklyReport() {
	const days = [];
	for (let i = 6; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		days.push(todayKey(d));
	}

	const logs = Store.workoutLogs;
	const workoutLines = days
		.filter((d) => logs[d])
		.map((d) => `${d}: ${Object.entries(logs[d]).map(([ex, v]) => `${ex} ${v.weight} kg`).join(", ")}`)
		.join("\n") || "Bu hafta antrenman kaydı yok.";

	const meals = Store.meals.filter((m) => days.includes(m.date));
	const kcalByDay = days
		.map((d) => {
			const dayMeals = meals.filter((m) => m.date === d);
			if (!dayMeals.length) return null;
			const kcal = dayMeals.reduce((a, m) => a + m.kcal, 0);
			const prot = dayMeals.reduce((a, m) => a + (m.protein || 0), 0);
			return `${d}: ${kcal} kcal, ${prot} g protein`;
		})
		.filter(Boolean)
		.join("\n") || "Bu hafta yemek kaydı yok.";

	const weights = Store.weights.filter((w) => days.includes(w.date));
	const weightLines = weights.map((w) => `${w.date}: ${w.kg} kg`).join("\n") || "Bu hafta kilo kaydı yok.";

	const s = Store.settings;
	const goal = GOAL_LABELS[s.goal] || GOAL_LABELS["fatloss-muscle"];
	const kcalTarget = calorieTarget();
	const protTarget = proteinTarget();

	return aiText({
		maxTokens: 3000,
		prompt:
			`Fitness verilerimin haftalık değerlendirmesini yap. Hedefim: ${goal}.` +
			(s.targetWeight ? ` Hedef kilom: ${s.targetWeight} kg.` : "") +
			(kcalTarget ? ` Günlük kalori hedefim: ${kcalTarget} kcal, protein hedefim: ${protTarget} g.` : "") +
			`\n\nANTRENMANLAR (hareket ve kaldırılan ağırlık):\n${workoutLines}` +
			`\n\nBESLENME (günlük toplamlar):\n${kcalByDay}` +
			`\n\nKİLO:\n${weightLines}` +
			"\n\nTürkçe, kısa ve samimi bir haftalık rapor yaz: " +
			"1) Antrenman gelişimi (ağırlık artışları/eksik günler), " +
			"2) Beslenme değerlendirmesi (kalori/protein hedefe uygun mu), " +
			"3) Kilo gidişatı, " +
			"4) Gelecek hafta için 2-3 somut öneri. " +
			"Toplam 180 kelimeyi geçme, emoji kullanabilirsin, başlıkları kısa tut.",
	});
}

/* Fotoğrafı küçültüp JPEG base64'e çevirir (maliyet ve boyut limiti için). */
function resizeImageToBase64(file, maxEdge = 1024) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		img.onload = () => {
			URL.revokeObjectURL(url);
			const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
			const canvas = document.createElement("canvas");
			canvas.width = Math.round(img.width * scale);
			canvas.height = Math.round(img.height * scale);
			canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
			const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
			resolve(dataUrl.split(",")[1]);
		};
		img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Görsel okunamadı.")); };
		img.src = url;
	});
}
