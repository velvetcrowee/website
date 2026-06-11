/* Başlangıç elementleri ve yerleşik tarifler. API anahtarı olmadan da
   oyunun hemen oynanabilmesini sağlar; bilinmeyen ikililer yapay zekâya gider. */

const BASE_ELEMENTS = [
	{ name: "Su", emoji: "💧" },
	{ name: "Ateş", emoji: "🔥" },
	{ name: "Toprak", emoji: "🌍" },
	{ name: "Hava", emoji: "💨" },
];

/* Anahtarlar pairKey() biçiminde (normalize + tr sıralı). */
const SEED_RECIPES = {
	// Temel ikililer
	"ateş++su": { name: "Buhar", emoji: "🌫️", isNew: false },
	"ateş++toprak": { name: "Lav", emoji: "🌋", isNew: false },
	"ateş++hava": { name: "Duman", emoji: "🚬", isNew: false },
	"su++toprak": { name: "Çamur", emoji: "🟤", isNew: false },
	"hava++su": { name: "Sis", emoji: "🌁", isNew: false },
	"hava++toprak": { name: "Toz", emoji: "🌪️", isNew: false },
	"su++su": { name: "Göl", emoji: "🏞️", isNew: false },
	"ateş++ateş": { name: "Volkan", emoji: "🌋", isNew: false },
	"toprak++toprak": { name: "Dağ", emoji: "⛰️", isNew: false },
	"hava++hava": { name: "Rüzgar", emoji: "🍃", isNew: false },

	// Hava olayları
	"buhar++hava": { name: "Bulut", emoji: "☁️", isNew: false },
	"buhar++buhar": { name: "Bulut", emoji: "☁️", isNew: false },
	"bulut++su": { name: "Yağmur", emoji: "🌧️", isNew: false },
	"bulut++bulut": { name: "Fırtına", emoji: "⛈️", isNew: false },
	"ateş++fırtına": { name: "Şimşek", emoji: "⚡", isNew: false },
	"bulut++dağ": { name: "Kar", emoji: "❄️", isNew: false },
	"kar++su": { name: "Buz", emoji: "🧊", isNew: false },
	"rüzgar++su": { name: "Dalga", emoji: "🌊", isNew: false },
	"bulut++güneş": { name: "Gökkuşağı", emoji: "🌈", isNew: false },
	"ateş++gökyüzü": { name: "Güneş", emoji: "☀️", isNew: false },
	"bulut++hava": { name: "Gökyüzü", emoji: "🌌", isNew: false },

	// Doğa
	"toprak++yağmur": { name: "Bitki", emoji: "🌱", isNew: false },
	"bitki++toprak": { name: "Ağaç", emoji: "🌳", isNew: false },
	"ağaç++ağaç": { name: "Orman", emoji: "🌲", isNew: false },
	"ağaç++ateş": { name: "Kül", emoji: "🪨", isNew: false },
	"bitki++su": { name: "Yosun", emoji: "🦠", isNew: false },
	"bitki++güneş": { name: "Çiçek", emoji: "🌸", isNew: false },
	"göl++göl": { name: "Deniz", emoji: "🌊", isNew: false },
	"deniz++deniz": { name: "Okyanus", emoji: "🌊", isNew: false },
	"bitki++deniz": { name: "Balık", emoji: "🐟", isNew: false },
	"balık++balık": { name: "Sürü", emoji: "🐠", isNew: false },
	"bitki++çamur": { name: "Bataklık", emoji: "🥬", isNew: false },

	// Madde ve zanaat
	"lav++su": { name: "Taş", emoji: "🪨", isNew: false },
	"rüzgar++taş": { name: "Kum", emoji: "🏖️", isNew: false },
	"ateş++kum": { name: "Cam", emoji: "🪟", isNew: false },
	"ateş++taş": { name: "Metal", emoji: "⚙️", isNew: false },
	"ateş++metal": { name: "Kılıç", emoji: "⚔️", isNew: false },
	"ateş++çamur": { name: "Tuğla", emoji: "🧱", isNew: false },
	"tuğla++tuğla": { name: "Duvar", emoji: "🧱", isNew: false },
	"duvar++duvar": { name: "Ev", emoji: "🏠", isNew: false },
	"ev++ev": { name: "Şehir", emoji: "🏙️", isNew: false },
	"kum++şimşek": { name: "Cam", emoji: "🪟", isNew: false },
	"metal++şimşek": { name: "Elektrik", emoji: "⚡", isNew: false },
	"cam++elektrik": { name: "Ampul", emoji: "💡", isNew: false },
	"deniz++kum": { name: "Plaj", emoji: "🏖️", isNew: false },
};
