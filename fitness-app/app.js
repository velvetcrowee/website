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
		const entry = logs[d][exerciseName];
		if (entry !== undefined && entry.weight !== undefined) {
			return { date: d, weight: entry.weight };
		}
	}
	return null;
}

/* Antrenman serisi: bugünden (veya dünden) geriye kesintisiz antrenman günü sayısı. */
function computeStreak() {
	const logs = Store.workoutLogs;
	let streak = 0;
	const d = new Date();
	if (!logs[todayKey(d)]) d.setDate(d.getDate() - 1);
	while (logs[todayKey(d)]) {
		streak++;
		d.setDate(d.getDate() - 1);
	}
	let week = 0;
	for (let i = 0; i < 7; i++) {
		const dd = new Date();
		dd.setDate(dd.getDate() - i);
		if (logs[todayKey(dd)]) week++;
	}
	return { streak, week };
}

function renderStreak() {
	const { streak, week } = computeStreak();
	const chips = [];
	if (streak > 0) chips.push(`<span class="chip">🔥 ${streak} gün seri</span>`);
	chips.push(`<span class="chip">📅 Bu hafta ${week} antrenman</span>`);
	$("#streak-chips").innerHTML = chips.join("");
}

function renderWorkout() {
	const plan = getTodayPlan();
	const list = $("#exercise-list");
	list.innerHTML = "";
	$("#no-program-card").hidden = !!Store.program;
	renderStreak();

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
		const div = document.createElement("div");
		div.className = "exercise" + (saved ? " done" : "");

		if (isBodyweight(ex)) {
			// Vücut ağırlığı / kardiyo: ağırlık girilmez, tamamlandı olarak işaretlenir.
			div.innerHTML = `
				<div class="ex-head">
					<span class="ex-name" role="button">${ex.name}</span>
					<span class="ex-scheme">${ex.sets}x${ex.reps}</span>
				</div>
				<div class="ex-input-row">
					<button class="btn ${saved ? "" : "primary"} grow">${saved ? "✓ Yapıldı — geri al" : "Yaptım ✓"}</button>
				</div>`;
			div.querySelector(".ex-name").addEventListener("click", () => openExerciseHistory(ex.name));
			div.querySelector(".ex-input-row button").addEventListener("click", () => {
				const logs = Store.workoutLogs;
				if (!logs[today]) logs[today] = {};
				if (saved) {
					delete logs[today][ex.name];
					if (!Object.keys(logs[today]).length) delete logs[today];
				} else {
					logs[today][ex.name] = { done: true };
				}
				Store.workoutLogs = logs;
				if (!saved) { toast("Kaydedildi ✓"); showRestTimer(); }
				renderWorkout();
			});
			list.appendChild(div);
			return;
		}

		const last = lastWeightFor(ex.name);
		div.innerHTML = `
			<div class="ex-head">
				<span class="ex-name" role="button">${ex.name}</span>
				<span class="ex-scheme">${ex.sets}x${ex.reps}</span>
			</div>
			${last ? `<div class="ex-last">Son kayıt: <b>${last.weight} kg</b> (${last.date})</div>` : ""}
			<div class="ex-input-row">
				<input type="number" step="0.5" inputmode="decimal" placeholder="Ağırlık (kg)"
					value="${saved && saved.weight !== undefined ? saved.weight : ""}">
				<button class="btn primary">Kaydet</button>
			</div>`;
		div.querySelector(".ex-name").addEventListener("click", () => openExerciseHistory(ex.name));
		const input = div.querySelector("input");
		div.querySelector(".ex-input-row button").addEventListener("click", () => {
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
			showRestTimer();
		});
		list.appendChild(div);
	});
}

/* ---------- Hareket gelişim grafiği (modal) ---------- */

function openExerciseHistory(name) {
	const logs = Store.workoutLogs;
	const all = Object.keys(logs)
		.sort()
		.filter((d) => logs[d][name] !== undefined)
		.map((d) => ({ date: d, kg: logs[d][name].weight }));
	const weighted = all.filter((e) => e.kg !== undefined);

	$("#modal-title").textContent = name;
	const list = $("#modal-list");
	list.innerHTML = "";
	if (!all.length) {
		list.innerHTML = `<li class="muted">Bu hareket için henüz kayıt yok.</li>`;
	} else {
		all.slice().reverse().slice(0, 15).forEach((e, i, arr) => {
			let valHtml = `<span class="val">✓ yapıldı</span>`;
			if (e.kg !== undefined) {
				const prev = arr.slice(i + 1).find((p) => p.kg !== undefined);
				const diff = prev ? +(e.kg - prev.kg).toFixed(1) : null;
				const diffHtml = diff === null || diff === 0 ? "" :
					diff > 0 ? ` <span class="up">▲ +${diff}</span>` : ` <span class="down">▼ ${diff}</span>`;
				valHtml = `<span class="val">${e.kg} kg${diffHtml}</span>`;
			}
			const li = document.createElement("li");
			li.innerHTML = `<div>${e.date}</div>${valHtml}`;
			list.appendChild(li);
		});
	}
	const canvas = $("#modal-chart");
	canvas.hidden = weighted.length < 2;
	drawLineChart(canvas, weighted.map((e) => e.kg), "kg");
	$("#modal").hidden = false;
}

$("#modal-close").addEventListener("click", () => { $("#modal").hidden = true; });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").hidden = true; });

/* Genel amaçlı çizgi grafik. */
function drawLineChart(canvas, values, unit) {
	const ctx = canvas.getContext("2d");
	const W = canvas.width, H = canvas.height, P = 40;
	ctx.clearRect(0, 0, W, H);
	if (values.length < 2) {
		ctx.fillStyle = "#94a3b8";
		ctx.font = "16px system-ui";
		ctx.textAlign = "center";
		ctx.fillText("Grafik için en az 2 kayıt gerekli", W / 2, H / 2);
		return;
	}
	const data = values.slice(-60);
	let min = Math.min(...data), max = Math.max(...data);
	if (max - min < 2) { min -= 1; max += 1; }
	const x = (i) => P + (i / (data.length - 1)) * (W - 2 * P);
	const y = (v) => H - P + 14 - ((v - min) / (max - min)) * (H - 2 * P);

	ctx.strokeStyle = "#2c3a4f";
	ctx.fillStyle = "#94a3b8";
	ctx.font = "12px system-ui";
	ctx.textAlign = "left";
	for (let g = 0; g <= 4; g++) {
		const v = min + (g / 4) * (max - min);
		const yy = y(v);
		ctx.beginPath(); ctx.moveTo(P, yy); ctx.lineTo(W - P, yy); ctx.stroke();
		ctx.fillText(v.toFixed(1), 4, yy + 4);
	}

	ctx.strokeStyle = "#34d399";
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	data.forEach((v, i) => { i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)); });
	ctx.stroke();
	ctx.fillStyle = "#34d399";
	data.forEach((v, i) => {
		ctx.beginPath(); ctx.arc(x(i), y(v), 3.5, 0, Math.PI * 2); ctx.fill();
	});
	ctx.lineWidth = 1;
}

/* ---------- Dinlenme sayacı ---------- */

let restInterval = null;

function showRestTimer() {
	$("#rest-timer").hidden = false;
	$("#rest-count").textContent = "";
}

function startRest(sec) {
	clearInterval(restInterval);
	let left = sec;
	const out = $("#rest-count");
	out.textContent = `${left} sn`;
	restInterval = setInterval(() => {
		left--;
		out.textContent = left > 0 ? `${left} sn` : "Hadi! 💪";
		if (left <= 0) {
			clearInterval(restInterval);
			if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
			toast("⏱️ Dinlenme bitti, sıradaki set!");
		}
	}, 1000);
}

$$(".rest-btn").forEach((b) => b.addEventListener("click", () => startRest(parseInt(b.dataset.sec, 10))));
$("#rest-close").addEventListener("click", () => {
	clearInterval(restInterval);
	$("#rest-timer").hidden = true;
});

/* ---------- Yapay zekâ butonları ---------- */

$("#btn-generate-program").addEventListener("click", async () => {
	const btn = $("#btn-generate-program");
	if (!activeKey()) {
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

$("#btn-weekly-report").addEventListener("click", async () => {
	const box = $("#weekly-report-box");
	const btn = $("#btn-weekly-report");
	btn.disabled = true;
	box.hidden = false;
	box.textContent = "Son 7 günün verileri analiz ediliyor…";
	try {
		box.textContent = await aiWeeklyReport();
	} catch (e) {
		box.hidden = true;
		toast(e.message === "NO_KEY" ? "Rapor için Ayarlar'dan API anahtarı girin." : "Hata: " + e.message, 4000);
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
	addMeal(pendingAnalysis.name, pendingAnalysis.totalKcal, pendingAnalysis.comment, pendingAnalysis.protein);
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
	const protein = parseInt($("#manual-food-protein").value, 10);
	if (!name || isNaN(kcal)) { toast("Yemek adı ve kalori girin."); return; }
	addMeal(name, kcal, "", isNaN(protein) ? 0 : protein);
	$("#manual-food-name").value = "";
	$("#manual-food-kcal").value = "";
	$("#manual-food-protein").value = "";
	toast("Öğün kaydedildi ✓");
});

function addMeal(name, kcal, comment, protein = 0) {
	const meals = Store.meals;
	const now = new Date();
	meals.push({
		id: Date.now(),
		date: todayKey(),
		time: now.toTimeString().slice(0, 5),
		name, kcal, comment, protein,
	});
	Store.meals = meals;
	renderMeals();
}

function renderMeals() {
	const meals = Store.meals.filter((m) => m.date === todayKey());
	const list = $("#meal-list");
	list.innerHTML = "";
	let total = 0, totalProtein = 0;
	meals.slice().reverse().forEach((m) => {
		total += m.kcal;
		totalProtein += m.protein || 0;
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
	renderMacroBars(total, totalProtein);
}

/* Kalori ve protein hedef çubukları. */
function renderMacroBars(kcal, protein) {
	const kcalT = calorieTarget();
	const protT = proteinTarget();
	const box = $("#macro-bars");
	if (!kcalT) {
		box.innerHTML = `<p class="muted">Günlük hedef için Ayarlar'dan yaş, boy girin ve kilonuzu kaydedin.</p>`;
		return;
	}
	const kcalPct = Math.min(100, Math.round((kcal / kcalT) * 100));
	const protPct = protT ? Math.min(100, Math.round((protein / protT) * 100)) : 0;
	const over = kcal > kcalT;
	box.innerHTML = `
		<div class="bar-label"><span>Kalori</span><span>${kcal} / ${kcalT} kcal${over ? " ⚠️" : ""}</span></div>
		<div class="bar-wrap"><div class="bar-fill ${over ? "over" : ""}" style="width:${kcalPct}%"></div></div>
		<div class="bar-label"><span>Protein</span><span>${protein} / ${protT} g</span></div>
		<div class="bar-wrap"><div class="bar-fill protein" style="width:${protPct}%"></div></div>`;
}

/* ---------- Su ---------- */

function changeWater(deltaMl) {
	const logs = Store.waterLogs;
	const cur = logs[todayKey()] || 0;
	logs[todayKey()] = Math.max(0, cur + deltaMl);
	Store.waterLogs = logs;
	renderWater();
}

function renderWater() {
	const ml = Store.waterLogs[todayKey()] || 0;
	$("#water-total").textContent = ml >= 1000 ? `${(ml / 1000).toFixed(2)} L` : `${ml} ml`;
	$("#water-bar").style.width = Math.min(100, Math.round((ml / WATER_TARGET_ML) * 100)) + "%";
}

$("#btn-water-plus").addEventListener("click", () => {
	changeWater(250);
	const ml = Store.waterLogs[todayKey()] || 0;
	if (ml === WATER_TARGET_ML) toast("💧 Günlük su hedefine ulaştınız!");
});
$("#btn-water-minus").addEventListener("click", () => changeWater(-250));

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
	renderMeals(); // kalori hedefi kiloya bağlı
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
	if (!weights.length) { sum.innerHTML = ""; drawWeightChart([]); return; }
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
	drawWeightChart(weights);
}

function drawWeightChart(weights) {
	const canvas = $("#weight-chart");
	drawLineChart(canvas, weights.map((w) => w.kg), "kg");
	// Hedef çizgisi
	const target = Store.settings.targetWeight;
	if (!target || weights.length < 2) return;
	const data = weights.slice(-60).map((w) => w.kg);
	let min = Math.min(...data), max = Math.max(...data);
	if (max - min < 2) { min -= 1; max += 1; }
	if (target < min || target > max) return;
	const ctx = canvas.getContext("2d");
	const W = canvas.width, H = canvas.height, P = 40;
	const y = H - P + 14 - ((target - min) / (max - min)) * (H - 2 * P);
	ctx.strokeStyle = "#f59e0b";
	ctx.setLineDash([6, 4]);
	ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke();
	ctx.setLineDash([]);
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
	const age = parseInt($("#profile-age").value, 10);
	s.age = isNaN(age) ? null : age;
	const h = parseInt($("#profile-height").value, 10);
	s.height = isNaN(h) ? null : h;
	s.gender = $("#profile-gender").value;
	Store.settings = s;
	renderWeights();
	renderMeals();
	toast("Profil kaydedildi ✓");
});

function syncProviderRows() {
	const provider = $("#ai-provider").value;
	$("#gemini-key-row").hidden = provider !== "gemini";
	$("#claude-key-row").hidden = provider !== "claude";
}

$("#ai-provider").addEventListener("change", syncProviderRows);

$("#btn-save-key").addEventListener("click", () => {
	const s = Store.settings;
	s.aiProvider = $("#ai-provider").value;
	s.apiKey = $("#api-key-input").value.trim();
	s.geminiKey = $("#gemini-key-input").value.trim();
	Store.settings = s;
	updateKeyStatus();
	toast(activeKey() ? "Yapay zekâ ayarları kaydedildi ✓" : "Kaydedildi — seçili sağlayıcının anahtarı boş.");
});

function updateKeyStatus() {
	const provider = activeProvider() === "gemini" ? "Gemini" : "Claude";
	$("#key-status").textContent = activeKey()
		? `✓ ${provider} aktif — yapay zekâ özellikleri açık.`
		: `${provider} seçili ama anahtar kayıtlı değil — yapay zekâ özellikleri kapalı.`;
}

$("#btn-export").addEventListener("click", () => {
	const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: "application/json" });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = `fittakip-yedek-${todayKey()}.json`;
	a.click();
	URL.revokeObjectURL(a.href);
});

$("#btn-import").addEventListener("click", () => $("#import-file").click());

$("#import-file").addEventListener("change", (e) => {
	const file = e.target.files[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = () => {
		try {
			const dump = JSON.parse(reader.result);
			const keys = Object.keys(dump).filter((k) => k.startsWith("fittakip."));
			if (!keys.length) { toast("Geçerli bir FitTakip yedeği değil."); return; }
			if (!confirm(`${keys.length} veri grubu geri yüklenecek ve mevcut veriler üzerine yazılacak. Devam edilsin mi?`)) return;
			keys.forEach((k) => localStorage.setItem(k, JSON.stringify(dump[k])));
			location.reload();
		} catch {
			toast("Dosya okunamadı — bozuk veya yanlış format.");
		}
	};
	reader.readAsText(file);
	e.target.value = "";
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
	if (s.age) $("#profile-age").value = s.age;
	if (s.height) $("#profile-height").value = s.height;
	$("#profile-gender").value = s.gender || "m";
	$("#ai-provider").value = s.aiProvider || "gemini";
	if (s.apiKey) $("#api-key-input").value = s.apiKey;
	if (s.geminiKey) $("#gemini-key-input").value = s.geminiKey;
	syncProviderRows();
	updateKeyStatus();

	renderWorkout();
	renderMeals();
	renderWater();
	renderWeights();
	renderSupps();

	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.register("sw.js").catch(() => { /* çevrimdışı desteği isteğe bağlı */ });
	}
}

init();
