/* Veri katmanı — tüm kayıtlar cihazda localStorage içinde tutulur. */

const DB = {
	read(key, fallback) {
		try {
			const raw = localStorage.getItem("fittakip." + key);
			return raw ? JSON.parse(raw) : fallback;
		} catch {
			return fallback;
		}
	},
	write(key, value) {
		localStorage.setItem("fittakip." + key, JSON.stringify(value));
	},
	remove(key) {
		localStorage.removeItem("fittakip." + key);
	},
};

const Store = {
	get settings() {
		return DB.read("settings", {
			goal: "fatloss-muscle", targetWeight: null,
			aiProvider: "gemini", apiKey: "", geminiKey: "",
			age: null, height: null, gender: "m",
		});
	},
	set settings(v) { DB.write("settings", v); },

	// Haftalık program: { days: [{ dayOfWeek: 1..7, name, focus, exercises: [{name, sets, reps}] }] }
	get program() { return DB.read("program", null); },
	set program(v) { DB.write("program", v); },

	// Antrenman kayıtları: { "YYYY-MM-DD": { "Hareket Adı": { weight: 40 } } }
	get workoutLogs() { return DB.read("workoutLogs", {}); },
	set workoutLogs(v) { DB.write("workoutLogs", v); },

	// Yemekler: [{ id, date, time, name, kcal, comment }]
	get meals() { return DB.read("meals", []); },
	set meals(v) { DB.write("meals", v); },

	// Kilo: [{ date, kg }]
	get weights() { return DB.read("weights", []); },
	set weights(v) { DB.write("weights", v); },

	// Takviyeler: [{ id, name, dose }]
	get supplements() { return DB.read("supplements", []); },
	set supplements(v) { DB.write("supplements", v); },

	// Takviye alım kayıtları: { "YYYY-MM-DD": [suppId, ...] }
	get suppLogs() { return DB.read("suppLogs", {}); },
	set suppLogs(v) { DB.write("suppLogs", v); },

	// Su kayıtları: { "YYYY-MM-DD": ml }
	get waterLogs() { return DB.read("waterLogs", {}); },
	set waterLogs(v) { DB.write("waterLogs", v); },

	resetAll() {
		Object.keys(localStorage)
			.filter((k) => k.startsWith("fittakip."))
			.forEach((k) => localStorage.removeItem(k));
	},

	exportAll() {
		const dump = {};
		Object.keys(localStorage)
			.filter((k) => k.startsWith("fittakip."))
			.forEach((k) => { dump[k] = JSON.parse(localStorage.getItem(k)); });
		return dump;
	},
};

function todayKey(d = new Date()) {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const g = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${g}`;
}

const WATER_TARGET_ML = 2500;

/* Günlük kalori hedefi (Mifflin-St Jeor + orta aktivite + hedefe göre düzeltme).
   Yaş/boy/kilo eksikse null döner. */
function calorieTarget() {
	const s = Store.settings;
	const weights = Store.weights;
	const kg = weights.length ? weights[weights.length - 1].kg : null;
	if (!kg || !s.height || !s.age) return null;
	const bmr = 10 * kg + 6.25 * s.height - 5 * s.age + (s.gender === "f" ? -161 : 5);
	const tdee = bmr * 1.5;
	const adj = { "fatloss-muscle": -350, "fatloss": -500, "muscle": 300, "maintain": 0 }[s.goal] || 0;
	return Math.round(tdee + adj);
}

/* Günlük protein hedefi: kas koruma/kazanım için ~1.8 g/kg. */
function proteinTarget() {
	const weights = Store.weights;
	const kg = weights.length ? weights[weights.length - 1].kg : null;
	return kg ? Math.round(kg * 1.8) : null;
}

/* Dış ağırlık gerektirmeyen hareketler (vücut ağırlığı / kardiyo / esneme).
   Yeni programlarda yapay zekâ bodyweight alanını doldurur; eski kayıtlar
   için isim üzerinden tahmin edilir. */
const BODYWEIGHT_RE = /(plank|yürüyüş|koşu|kardiyo|esneme|mobilite|crunch|mekik|şınav|burpee|jumping|ip atlama|leg raise|sit ?up|dağcı|mountain climber|superman|bisiklet|hiit|yüzme|bicycle)/i;

function isBodyweight(ex) {
	if (typeof ex.bodyweight === "boolean") return ex.bodyweight;
	return BODYWEIGHT_RE.test(ex.name);
}

const GOAL_LABELS = {
	"fatloss-muscle": "kilo verme ve aynı anda kas kazanma (body recomposition)",
	"muscle": "kas kütlesi kazanma (bulk)",
	"fatloss": "yağ yakımı / kilo verme",
	"maintain": "mevcut formu koruma",
};

/* API anahtarı yokken de uygulama çalışsın diye hedefe uygun hazır program. */
const DEFAULT_PROGRAM = {
	goal: "fatloss-muscle",
	days: [
		{
			dayOfWeek: 1, name: "İtiş Günü (Göğüs + Omuz + Arka Kol)", focus: "Üst vücut itiş kasları",
			exercises: [
				{ name: "Bench Press", sets: 4, reps: 10 },
				{ name: "Incline Dumbbell Press", sets: 3, reps: 12 },
				{ name: "Omuz Press (Dumbbell)", sets: 4, reps: 10 },
				{ name: "Lateral Raise", sets: 3, reps: 15 },
				{ name: "Triceps Pushdown", sets: 3, reps: 12 },
			],
		},
		{
			dayOfWeek: 2, name: "Çekiş Günü (Sırt + Ön Kol)", focus: "Üst vücut çekiş kasları",
			exercises: [
				{ name: "Lat Pulldown", sets: 4, reps: 10 },
				{ name: "Barbell Row", sets: 4, reps: 10 },
				{ name: "Seated Cable Row", sets: 3, reps: 12 },
				{ name: "Face Pull", sets: 3, reps: 15 },
				{ name: "Biceps Curl (Barbell)", sets: 3, reps: 12 },
			],
		},
		{
			dayOfWeek: 3, name: "Kardiyo + Karın", focus: "Yağ yakımı ve core",
			exercises: [
				{ name: "Tempolu Yürüyüş / Koşu (30-40 dk)", sets: 1, reps: 1, bodyweight: true },
				{ name: "Plank (45 sn)", sets: 3, reps: 1, bodyweight: true },
				{ name: "Crunch", sets: 3, reps: 20, bodyweight: true },
				{ name: "Leg Raise", sets: 3, reps: 15, bodyweight: true },
			],
		},
		{
			dayOfWeek: 4, name: "Bacak Günü", focus: "Alt vücut",
			exercises: [
				{ name: "Squat", sets: 4, reps: 10 },
				{ name: "Romanian Deadlift", sets: 3, reps: 12 },
				{ name: "Leg Press", sets: 3, reps: 12 },
				{ name: "Leg Curl", sets: 3, reps: 12 },
				{ name: "Calf Raise", sets: 4, reps: 15 },
			],
		},
		{
			dayOfWeek: 5, name: "Üst Vücut (Karışık)", focus: "Tüm üst vücut",
			exercises: [
				{ name: "Incline Bench Press", sets: 3, reps: 10 },
				{ name: "Pull-up / Assisted Pull-up", sets: 3, reps: 8 },
				{ name: "Arnold Press", sets: 3, reps: 12 },
				{ name: "Cable Fly", sets: 3, reps: 15 },
				{ name: "Hammer Curl", sets: 3, reps: 12 },
			],
		},
		{
			dayOfWeek: 6, name: "Aktif Dinlenme", focus: "Hafif kardiyo, esneme",
			exercises: [
				{ name: "Yürüyüş (45-60 dk)", sets: 1, reps: 1, bodyweight: true },
				{ name: "Esneme / Mobilite (15 dk)", sets: 1, reps: 1, bodyweight: true },
			],
		},
		{
			dayOfWeek: 7, name: "Dinlenme", focus: "Tam dinlenme ve toparlanma",
			exercises: [],
		},
	],
};
