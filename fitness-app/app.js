/* Uygulama mantığı ve arayüz. */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DAY_NAMES = ["", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

function toast(msg, ms = 2600) {
	const el = $("#toast");
	el.textContent = msg;
	el.hidden = false;
	clearTimeout(el._t);
	el._t = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------- Sekmeler ---------- */

$$(".nav-btn").forEach((btn) => {
	btn.addEventListener("click", () => {
		$$(".nav-btn").forEach((b) => b.classList.remove("active"));
		$$(".tab").forEach((t) => t.classList.remove("active"));
		btn.classList.add("active");
		$("#" + btn.dataset.tab).classList.add("active");
		window.scrollTo(0, 0);
	});
});

/* ---------- Antrenman ---------- */

function isoDayOfWeek(d = new Date()) {
	return d.getDay() === 0 ? 7 : d.getDay();
}

function getTodayPlan() {
	const program = Store.program || DEFAULT_PROGRAM;
	return program.days.find((day) => day.dayOfWeek === isoDayOfWeek()) || null;
}

/* Hareketin daha önce kaydedilmiş son ağırlığını bul. */
function lastWeightFor(exerciseName) {
	const logs = Store.workoutLogs;
	const dates = Object.keys(logs).sort().reverse();
	for (const d of dates) {
		if (logs[d][exerciseName] !== undefined) {
			return { date: d, weight: logs[d][exerciseName].weight };
		}
	}
	return null;
}

function renderWorkout() {
	const plan = getTodayPlan();
	const list = $("#exercise-list");
	list.innerHTML = "";
	$("#no-program-card").hidden = !!Store.program;

	if (!plan) {
		$("#today-day-name").textContent = "Program bulunamadı";
		$("#today-focus").textContent = "";
		return;
	}

	$("#today-day-name").textContent = `${DAY_NAMES[plan.dayOfWeek]} — ${plan.name}`;
	$("#today-focus").textContent = plan.focus || "";

	if (!plan.exercises.length) {
		list.innerHTML = `<div class="card"><p>Bugün dinlenme günü. 😌</p><p class="muted">Toparlanma da gelişimin parçasıdır.</p></div>`;
		return;
	}

	const today = todayKey();
	const todayLog = Store.workoutLogs[today] || {};

	plan.exercises.forEach((ex) => {
		const saved = todayLog[ex.name];
		const last = lastWeightFor(ex.name);
		const div = document.createElement("div");
		div.className = "exercise" + (saved ? " done" : "");
		div.innerHTML = `
			<div class="ex-head">
				<span class="ex-name">${ex.name}</span>
				<span class="ex-scheme">${ex.sets}x${ex.reps}</span>
			</div>
			${last ? `<div class="ex-last">Son kayıt: <b>${last.weight} kg</b> (${last.date})</div>` : ""}
			<div class="ex-input-row">
				<input type="number" step="0.5" inputmode="decimal" placeholder="Ağırlık (kg)"
					value="${saved ? saved.weight : ""}">
				<button class="btn primary">Kaydet</button>
			</div>`;
		const input = div.querySelector("input");
		div.querySelector("button").addEventListener("click", () => {
			const w = parseFloat(input.value);
			if (isNaN(w) || w < 0) { toast("Geçerli bir ağırlık girin."); return; }
			const logs = Store.workoutLogs;
			if (!logs[today]) logs[today] = {};
			logs[today][ex.name] = { weight: w };
			Store.workoutLogs = logs;
			const prev = last && last.date !== today ? last.weight : null;
			if (prev !== null && w > prev) toast(`💪 ${ex.name}: ${prev} → ${w} kg. Gelişme var!`);
			else toast("Kaydedildi ✓");
			renderWorkout();
		});
		list.appendChild(div);
	});
}

$("#btn-generate-program").addEventListener("click", async () => {
	const btn = $("#btn-generate-program");
	if (!Store.settings.apiKey) {
		// Anahtar yoksa hedefe uygun hazır programı kur.
		Store.program = DEFAULT_PROGRAM;
		renderWorkout();
		toast("Hazır program yüklendi. Yapay zekâ programı için Ayarlar'dan API anahtarı ekleyin.");
		return;
	}
	btn.disabled = true;
	btn.innerHTML = `<span class="spinner">⏳</span> Program hazırlanıyor…`;
	try {
		const program = await aiGenerateProgram();
		Store.program = program;
		renderWorkout();
		toast("🤖 Yeni programınız hazır!");
	} catch (e) {
		toast(e.message === "NO_KEY" ? "Önce Ayarlar'dan API anahtarı girin." : "Hata: " + e.message, 4000);
	} finally {
		btn.disabled = false;
		btn.textContent = "🤖 Yapay Zekâ ile Program Oluştur";
	}
});

$("#btn-ai-tips").addEventListener("click", async () => {
	const plan = getTodayPlan();
	if (!plan || !plan.exercises.length) { toast("Bugün dinlenme günü, öneri gerekmez. 😊"); return; }
	const box = $("#ai-tips-box");
	const btn = $("#btn-ai-tips");
	btn.disabled = true;
	box.hidden = false;
	box.textContent = "Öneriler hazırlanıyor…";
	try {
		box.textContent = await aiDailyTips(plan);
	} catch (e) {
		box.hidden = true;
		toast(e.message === "NO_KEY" ? "Önce Ayarlar'dan API anahtarı girin." : "Hata: " + e.message, 4000);
	} finally {
		btn.disabled = false;
	}
});

/* ---------- Yemek ---------- */

let pendingPhotoB64 = null;
let pendingAnalysis = null;

$("#food-photo").addEventListener("change", async (e) => {
	const file = e.target.files[0];
	if (!file) return;
	try {
		pendingPhotoB64 = await resizeImageToBase64(file);
		const preview = $("#photo-preview");
		preview.src = "data:image/jpeg;base64," + pendingPhotoB64;
		preview.hidden = false;
		$("#photo-placeholder").hidden = true;
		$("#btn-analyze-food").disabled = false;
		$("#food-analysis").hidden = true;
		pendingAnalysis = null;
	} catch (err) {
		toast(err.message);
	}
});

$("#btn-analyze-food").addEventListener("click", async () => {
	if (!pendingPhotoB64) return;
	const btn = $("#btn-analyze-food");
	const box = $("#food-analysis");
	btn.disabled = true;
	btn.innerHTML = `<span class="spinner">⏳</span> Analiz ediliyor…`;
	try {
		const r = await aiAnalyzeFood(pendingPhotoB64);
		pendingAnalysis = r;
		box.hidden = false;
		box.innerHTML = `
			<b>${r.name}</b>
			<div class="kcal-big">≈ ${r.totalKcal} kcal</div>
			<div class="muted">Protein: ~${r.protein} g</div>
			<div style="margin:8px 0">${r.items.map((i) => `• ${i.item} — ${i.kcal} kcal`).join("<br>")}</div>
			<div>💬 ${r.comment}</div>
			<button class="btn primary full" style="margin-top:10px" id="btn-save-meal">Öğüne Kaydet</button>`;
		$("#btn-save-meal").addEventListener("click", saveAnalyzedMeal);
	} catch (e) {
		toast(e.message === "NO_KEY" ? "Fotoğraf analizi için Ayarlar'dan API anahtarı girin." : "Hata: " + e.message, 4000);
	} finally {
		btn.disabled = false;
		btn.textContent = "🔍 Yapay Zekâ ile Analiz Et";
	}
});

function saveAnalyzedMeal() {
	if (!pendingAnalysis) return;
	addMeal(pendingAnalysis.name, pendingAnalysis.totalKcal, pendingAnalysis.comment);
	pendingAnalysis = null;
	pendingPhotoB64 = null;
	$("#photo-preview").hidden = true;
	$("#photo-placeholder").hidden = false;
	$("#food-photo").value = "";
	$("#food-analysis").hidden = true;
	$("#btn-analyze-food").disabled = true;
	toast("Öğün kaydedildi ✓");
}

$("#btn-manual-food").addEventListener("click", () => {
	const name = $("#manual-food-name").value.trim();
	const kcal = parseInt($("#manual-food-kcal").value, 10);
	if (!name || isNaN(kcal)) { toast("Yemek adı ve kalori girin."); return; }
	addMeal(name, kcal, "");
	$("#manual-food-name").value = "";
	$("#manual-food-kcal").value = "";
	toast("Öğün kaydedildi ✓");
});

function addMeal(name, kcal, comment) {
	const meals = Store.meals;
	const now = new Date();
	meals.push({
		id: Date.now(),
		date: todayKey(),
		time: now.toTimeString().slice(0, 5),
		name, kcal, comment,
	});
	Store.meals = meals;
	renderMeals();
}

function renderMeals() {
	const meals = Store.meals.filter((m) => m.date === todayKey());
	const list = $("#meal-list");
	list.innerHTML = "";
	let total = 0;
	meals.slice().reverse().forEach((m) => {
		total += m.kcal;
		const li = document.createElement("li");
		li.innerHTML = `
			<div>${m.name}<span class="sub">${m.time}${m.comment ? " · " + m.comment : ""}</span></div>
			<span class="val">${m.kcal} kcal</span>
			<button class="del" title="Sil">✕</button>`;
		li.querySelector(".del").addEventListener("click", () => {
			Store.meals = Store.meals.filter((x) => x.id !== m.id);
			renderMeals();
		});
		list.appendChild(li);
	});
	if (!meals.length) list.innerHTML = `<li class="muted">Bugün henüz kayıt yok.</li>`;
	$("#today-kcal").textContent = `${total} kcal`;
}

/* ---------- Kilo ---------- */

$("#btn-add-weight").addEventListener("click", () => {
	const kg = parseFloat($("#weight-input").value);
	if (isNaN(kg) || kg <= 0) { toast("Geçerli bir kilo girin."); return; }
	const weights = Store.weights.filter((w) => w.date !== todayKey());
	weights.push({ date: todayKey(), kg });
	weights.sort((a, b) => a.date.localeCompare(b.date));
	Store.weights = weights;
	$("#weight-input").value = "";
	renderWeights();
	toast("Kilo kaydedildi ✓");
});

function renderWeights() {
	const weights = Store.weights;
	const list = $("#weight-list");
	list.innerHTML = "";
	weights.slice().reverse().forEach((w) => {
		const li = document.createElement("li");
		li.innerHTML = `<div>${w.date}</div><span class="val">${w.kg} kg</span>
			<button class="del" title="Sil">✕</button>`;
		li.querySelector(".del").addEventListener("click", () => {
			Store.weights = Store.weights.filter((x) => x.date !== w.date);
			renderWeights();
		});
		list.appendChild(li);
	});
	if (!weights.length) list.innerHTML = `<li class="muted">Henüz kayıt yok. İlk kilonuzu girin.</li>`;

	// Özet: güncel, ay başından bu yana fark, hedefe kalan
	const sum = $("#weight-summary");
	if (!weights.length) { sum.innerHTML = ""; drawChart([]); return; }
	const latest = weights[weights.length - 1];
	const monthStart = todayKey().slice(0, 7) + "-01";
	const baseline = weights.find((w) => w.date >= monthStart) || weights[0];
	const monthDiff = +(latest.kg - baseline.kg).toFixed(1);
	const target = Store.settings.targetWeight;
	const diffCls = monthDiff < 0 ? "pos" : monthDiff > 0 ? "neg" : "";
	sum.innerHTML = `
		<div class="stat"><b>${latest.kg} kg</b><span>Güncel</span></div>
		<div class="stat"><b class="${diffCls}">${monthDiff > 0 ? "+" : ""}${monthDiff} kg</b><span>Bu ay</span></div>
		<div class="stat"><b>${target ? (latest.kg - target).toFixed(1) + " kg" : "—"}</b><span>Hedefe kalan</span></div>`;
	drawChart(weights);
}

function drawChart(weights) {
	const canvas = $("#weight-chart");
	const ctx = canvas.getContext("2d");
	const W = canvas.width, H = canvas.height, P = 40;
	ctx.clearRect(0, 0, W, H);
	if (weights.length < 2) {
		ctx.fillStyle = "#94a3b8";
		ctx.font = "16px system-ui";
		ctx.textAlign = "center";
		ctx.fillText("Grafik için en az 2 kayıt gerekli", W / 2, H / 2);
		return;
	}
	const data = weights.slice(-60);
	const kgs = data.map((w) => w.kg);
	let min = Math.min(...kgs), max = Math.max(...kgs);
	if (max - min < 2) { min -= 1; max += 1; }
	const x = (i) => P + (i / (data.length - 1)) * (W - 2 * P);
	const y = (kg) => H - P - ((kg - min) / (max - min)) * (H - 2 * P);

	// Izgara + etiketler
	ctx.strokeStyle = "#2c3a4f";
	ctx.fillStyle = "#94a3b8";
	ctx.font = "12px system-ui";
	ctx.textAlign = "left";
	for (let g = 0; g <= 4; g++) {
		const kg = min + (g / 4) * (max - min);
		const yy = y(kg);
		ctx.beginPath(); ctx.moveTo(P, yy); ctx.lineTo(W - P, yy); ctx.stroke();
		ctx.fillText(kg.toFixed(1), 4, yy + 4);
	}

	// Hedef çizgisi
	const target = Store.settings.targetWeight;
	if (target && target >= min && target <= max) {
		ctx.strokeStyle = "#f59e0b";
		ctx.setLineDash([6, 4]);
		ctx.beginPath(); ctx.moveTo(P, y(target)); ctx.lineTo(W - P, y(target)); ctx.stroke();
		ctx.setLineDash([]);
	}

	// Çizgi
	ctx.strokeStyle = "#34d399";
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	data.forEach((w, i) => { i ? ctx.lineTo(x(i), y(w.kg)) : ctx.moveTo(x(i), y(w.kg)); });
	ctx.stroke();

	// Noktalar
	ctx.fillStyle = "#34d399";
	data.forEach((w, i) => {
		ctx.beginPath(); ctx.arc(x(i), y(w.kg), 3.5, 0, Math.PI * 2); ctx.fill();
	});
	ctx.lineWidth = 1;
}

/* ---------- Takviyeler ---------- */

$("#btn-add-supp").addEventListener("click", () => {
	const name = $("#supp-name").value.trim();
	const dose = $("#supp-dose").value.trim();
	if (!name) { toast("Takviye adı girin."); return; }
	const supps = Store.supplements;
	supps.push({ id: Date.now(), name, dose });
	Store.supplements = supps;
	$("#supp-name").value = "";
	$("#supp-dose").value = "";
	renderSupps();
	toast("Takviye eklendi ✓");
});

function renderSupps() {
	const supps = Store.supplements;
	const takenToday = Store.suppLogs[todayKey()] || [];
	const list = $("#supp-list");
	list.innerHTML = "";
	supps.forEach((s) => {
		const taken = takenToday.includes(s.id);
		const li = document.createElement("li");
		li.innerHTML = `
			<label class="supp-check">
				<input type="checkbox" ${taken ? "checked" : ""}>
				<div class="${taken ? "supp-taken" : ""}">${s.name}${s.dose ? `<span class="sub">${s.dose}</span>` : ""}</div>
			</label>
			<button class="del" title="Sil">✕</button>`;
		li.querySelector("input").addEventListener("change", (e) => {
			const logs = Store.suppLogs;
			const arr = logs[todayKey()] || [];
			logs[todayKey()] = e.target.checked ? [...arr, s.id] : arr.filter((id) => id !== s.id);
			Store.suppLogs = logs;
			renderSupps();
		});
		li.querySelector(".del").addEventListener("click", () => {
			Store.supplements = Store.supplements.filter((x) => x.id !== s.id);
			renderSupps();
		});
		list.appendChild(li);
	});
	if (!supps.length) list.innerHTML = `<li class="muted">Henüz takviye eklemediniz.</li>`;
}

/* ---------- Ayarlar ---------- */

$("#btn-save-goal").addEventListener("click", () => {
	const s = Store.settings;
	s.goal = $("#goal-select").value;
	const t = parseFloat($("#target-weight").value);
	s.targetWeight = isNaN(t) ? null : t;
	Store.settings = s;
	renderWeights();
	toast("Hedef kaydedildi ✓");
});

$("#btn-save-key").addEventListener("click", () => {
	const s = Store.settings;
	s.apiKey = $("#api-key-input").value.trim();
	Store.settings = s;
	updateKeyStatus();
	toast(s.apiKey ? "API anahtarı kaydedildi ✓" : "API anahtarı silindi.");
});

function updateKeyStatus() {
	$("#key-status").textContent = Store.settings.apiKey
		? "✓ Anahtar kayıtlı — yapay zekâ özellikleri aktif."
		: "Anahtar kayıtlı değil — yapay zekâ özellikleri kapalı.";
}

$("#btn-export").addEventListener("click", () => {
	const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: "application/json" });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = `fittakip-yedek-${todayKey()}.json`;
	a.click();
	URL.revokeObjectURL(a.href);
});

$("#btn-reset").addEventListener("click", () => {
	if (confirm("Tüm veriler (antrenman, yemek, kilo, takviye) silinecek. Emin misiniz?")) {
		Store.resetAll();
		location.reload();
	}
});

/* ---------- Başlangıç ---------- */

function init() {
	$("#header-date").textContent = new Date().toLocaleDateString("tr-TR", {
		weekday: "long", day: "numeric", month: "long",
	});

	const s = Store.settings;
	$("#goal-select").value = s.goal;
	if (s.targetWeight) $("#target-weight").value = s.targetWeight;
	if (s.apiKey) $("#api-key-input").value = s.apiKey;
	updateKeyStatus();

	renderWorkout();
	renderMeals();
	renderWeights();
	renderSupps();

	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.register("sw.js").catch(() => { /* çevrimdışı desteği isteğe bağlı */ });
	}
}

init();
