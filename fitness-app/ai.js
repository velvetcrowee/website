/* Yapay zekâ katmanı — Claude API'ye tarayıcıdan doğrudan istek atar.
   Statik PWA olduğu için (paketleyici/sunucu yok) SDK yerine fetch kullanılır;
   anahtar kullanıcıya aittir ve yalnızca cihazda saklanır. */

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-4-8";

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
		if (res.status === 401) msg = "API anahtarı geçersiz. Ayarlar'dan kontrol edin.";
		if (res.status === 429) msg = "İstek limiti aşıldı, biraz bekleyip tekrar deneyin.";
		throw new Error(msg);
	}
	return res.json();
}

function extractJson(response) {
	const block = response.content.find((b) => b.type === "text");
	if (!block) throw new Error("Modelden metin yanıtı alınamadı.");
	return JSON.parse(block.text);
}

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
					additionalProperties: false,
				},
			},
			totalKcal: { type: "integer", description: "Toplam tahmini kalori" },
			protein: { type: "integer", description: "Tahmini protein (gram)" },
			comment: { type: "string", description: "Kullanıcının hedefine göre 1-2 cümle Türkçe değerlendirme" },
		},
		required: ["name", "items", "totalKcal", "protein", "comment"],
		additionalProperties: false,
	};

	const goal = GOAL_LABELS[Store.settings.goal] || GOAL_LABELS["fatloss-muscle"];
	const response = await claudeRequest({
		max_tokens: 4000,
		output_config: { format: { type: "json_schema", schema } },
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: { type: "base64", media_type: "image/jpeg", data: base64Jpeg },
					},
					{
						type: "text",
						text:
							"Bu yemek fotoğrafını analiz et. Yemeği tanı, porsiyon büyüklüğünü göz önünde " +
							"bulundurarak bileşen bileşen kalori tahmini yap ve toplam kaloriyi ver. " +
							`Kullanıcının hedefi: ${goal}. Bu hedefe göre kısa bir Türkçe yorum ekle ` +
							"(örn. protein yeterli mi, porsiyon uygun mu).",
					},
				],
			},
		],
	});
	return extractJson(response);
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
								additionalProperties: false,
							},
						},
					},
					required: ["dayOfWeek", "name", "focus", "exercises"],
					additionalProperties: false,
				},
			},
		},
		required: ["days"],
		additionalProperties: false,
	};

	const s = Store.settings;
	const goal = GOAL_LABELS[s.goal] || GOAL_LABELS["fatloss-muscle"];
	const weights = Store.weights;
	const current = weights.length ? `${weights[weights.length - 1].kg} kg` : "bilinmiyor";
	const target = s.targetWeight ? `${s.targetWeight} kg` : "belirtilmedi";

	const response = await claudeRequest({
		max_tokens: 8000,
		output_config: { format: { type: "json_schema", schema } },
		messages: [
			{
				role: "user",
				content:
					"Spor salonunda ağırlık antrenmanı yapan bir kullanıcı için 7 günlük haftalık program hazırla. " +
					`Hedef: ${goal}. Mevcut kilo: ${current}. Hedef kilo: ${target}. ` +
					"Kurallar: her antrenman günü 4-6 hareket içersin; set x tekrar şeması hedefe uygun olsun " +
					"(örn. 3x12, 4x10); haftada 1-2 dinlenme veya kardiyo günü olsun; gün adları ve açıklamalar " +
					"Türkçe, hareket adları salonlarda yaygın kullanılan haliyle yazılsın. " +
					"dayOfWeek alanında 1 Pazartesi, 7 Pazar demektir ve 7 günün tamamı listede olmalı " +
					"(dinlenme günü için exercises boş dizi olabilir).",
			},
		],
	});
	return extractJson(response);
}

/* Bugünkü antrenman + son kayıtlara göre kısa öneri metni. */
async function aiDailyTips(todayPlan) {
	const logs = Store.workoutLogs;
	const recent = Object.keys(logs).sort().slice(-7)
		.map((d) => `${d}: ${Object.entries(logs[d]).map(([ex, v]) => `${ex} ${v.weight} kg`).join(", ")}`)
		.join("\n") || "Henüz kayıt yok.";
	const goal = GOAL_LABELS[Store.settings.goal] || GOAL_LABELS["fatloss-muscle"];

	const response = await claudeRequest({
		max_tokens: 2000,
		messages: [
			{
				role: "user",
				content:
					`Hedefim: ${goal}.\n` +
					`Bugünkü antrenman: ${todayPlan.name} — ` +
					todayPlan.exercises.map((e) => `${e.name} ${e.sets}x${e.reps}`).join(", ") + ".\n" +
					`Son 7 günün ağırlık kayıtları:\n${recent}\n\n` +
					"Bana bugünkü antrenman için kısa, maddeler halinde Türkçe öneriler ver: " +
					"hangi harekette ağırlığı artırabilirim, nelere dikkat etmeliyim, form ipuçları. " +
					"En fazla 6 madde, toplam 120 kelimeyi geçme. Başlık veya giriş cümlesi yazma.",
			},
		],
	});
	const block = response.content.find((b) => b.type === "text");
	return block ? block.text : "";
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
