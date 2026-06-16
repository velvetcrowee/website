/* Çok dilli destek — arayüz metinleri Türkçe (kaynak) ve İngilizce olarak
   tutulur. Element adları ve açıklamaları paylaşılan havuzdan geldiği için
   Türkçe kalır; çevrilen yalnızca arayüz kabuğudur (menüler, butonlar, ayarlar).

   Kullanım:
   - JS: t("anahtar")  → seçili dildeki metin
   - HTML: <h3 data-i18n="anahtar"></h3>            → textContent
           <input data-i18n-ph="anahtar">           → placeholder
           <button data-i18n-title="anahtar"></button> → title
   applyStaticI18n() açılışta ve dil değişiminde bu öznitelikleri tarar. */

const STRINGS = {
	tr: {
		// Başlık
		title: "🧪 Element Simyası",
		lucky: "Şanslı birleştirme",
		book: "Keşif Defteri",
		clear: "Tuvali temizle",
		fullscreen: "Tam ekran",
		fullscreenExit: "Tam ekrandan çık",
		settings: "Ayarlar",
		// Panel
		search: "🔍 Ara…",
		slotPick: "＋ Seç",
		newRound: "Yeni hedef",
		all: "Tümü",
		// Favoriler
		pin: "Sabitle",
		unpin: "Sabitlemeyi kaldır",
		pinned: "sabitlendi",
		unpinned: "sabitlemesi kaldırıldı",
		// Keşif Defteri
		bookTitle: "📖 Keşif Defteri",
		leaderboard: "🏆 Liderlik Tablosu",
		catLeaderboard: "🏷️ Kategori Şampiyonları",
		activity: "📣 Son Keşifler",
		worldStats: "📊 Dünya İstatistikleri",
		statsNeedPool: "İstatistikler için havuz gerekli.",
		statsFail: "İstatistikler yüklenemedi.",
		loading: "Yükleniyor…",
		statPoolRecipes: "havuzdaki tarif",
		statPoolPlayers: "kâşif",
		categorySpread: "🏷️ Kategori dağılımı",
		poolGrowth: "📈 Son 14 gün",
		creativeLeaders: "✨ En yaratıcı kâşifler",
		latestFinds: "🆕 En yeni keşifler",
		badges: "🎖️ Rozetler",
		collections: "🧩 Koleksiyonlar",
		shareScore: "📣 Skorumu paylaş",
		discoveries: "🧭 Keşifler",
		bookHint: "Bir elemente dokunarak hikâyesini ve soy ağacını görebilirsiniz.",
		statElement: "element",
		statFirst: "🥇 dünya ilki",
		statCombo: "birleştirme",
		statDeepest: "en derin zincir",
		statLevel: "seviye",
		levelUp: "Seviye atladın:",
		levelLabel: "Sv",
		rar_common: "Sıradan",
		rar_uncommon: "Nadir",
		rar_rare: "Ender",
		rar_epic: "Destansı",
		rar_legendary: "Efsane",
		// Element detayı
		lineage: "🌳 Soy Ağacı",
		startEl: "Bu bir başlangıç elementi — her şey onunla başladı.",
		genImage: "🎨 Görsel üret",
		genImageWait: "🎨 Üretiliyor…",
		genImageNeedsKey: "Görsel üretmek için Ayarlar'dan bir Gemini anahtarı girin.",
		genImageFail: "Görsel üretilemedi, birazdan tekrar deneyin.",
		regenImage: "🔄 Yeniden üret",
		imageLoading: "🎨 Görsel yükleniyor…",
		// Profil
		profileTitle: "👤 Profil",
		profileFirsts: "dünya ilki",
		profileRecent: "Son ilk keşifleri",
		profileCats: "Kategoriler",
		profileNone: "Bu oyuncunun henüz dünya-ilki keşfi yok.",
		// Hedef / ipucu
		questHint: "💡 İpucu",
		hintNoRecipe: "Bu hedef için bilinen bir tarif yok — yaratıcı ol!",
		hintReveal: "💡 İpucu",
		goal: "Hedef",
		settingsSaved: "Ayarlar kaydedildi ✓",
		showMore: "Daha fazla göster",
		startEl2: "başlangıç",
		// Ayarlar
		settingsTitle: "⚙️ Ayarlar",
		profileMembership: "Profil & Üyelik",
		aiHeading: "Yapay Zekâ",
		poolHeading: "Küresel Havuz",
		gameHeading: "Oyun",
		dataHeading: "Veriler & Oyun Belleği",
		language: "Dil / Language",
		soundFx: "Ses efektleri",
		register: "Kayıt ol",
		login: "Giriş yap",
		logout: "Çıkış yap",
		syncNow: "☁️ Şimdi eşitle",
		save: "Kaydet",
		exportData: "📤 Verileri dışa aktar (JSON)",
		importData: "📥 Başka oyuncudan tarif aktar (JSON)",
		exportTrain: "🧠 Eğitim verisini dışa aktar (JSONL)",
		resetAll: "Tüm verileri sıfırla",
		usernamePh: "Kullanıcı adı (3-20 karakter)",
		passwordPh: "Şifre (en az 4 karakter)",
	},
	en: {
		title: "🧪 Element Alchemy",
		lucky: "Lucky combine",
		book: "Discovery Log",
		clear: "Clear canvas",
		fullscreen: "Fullscreen",
		fullscreenExit: "Exit fullscreen",
		settings: "Settings",
		search: "🔍 Search…",
		slotPick: "＋ Pick",
		newRound: "New goal",
		all: "All",
		pin: "Pin",
		unpin: "Unpin",
		pinned: "pinned",
		unpinned: "unpinned",
		bookTitle: "📖 Discovery Log",
		leaderboard: "🏆 Leaderboard",
		catLeaderboard: "🏷️ Category Champions",
		activity: "📣 Recent Discoveries",
		worldStats: "📊 World Stats",
		statsNeedPool: "A pool is required for stats.",
		statsFail: "Couldn't load stats.",
		loading: "Loading…",
		statPoolRecipes: "recipes in pool",
		statPoolPlayers: "explorers",
		categorySpread: "🏷️ Category spread",
		poolGrowth: "📈 Last 14 days",
		creativeLeaders: "✨ Most creative explorers",
		latestFinds: "🆕 Latest discoveries",
		badges: "🎖️ Badges",
		collections: "🧩 Collections",
		shareScore: "📣 Share my score",
		discoveries: "🧭 Discoveries",
		bookHint: "Tap an element to see its story and family tree.",
		statElement: "elements",
		statFirst: "🥇 world firsts",
		statCombo: "combines",
		statDeepest: "deepest chain",
		statLevel: "level",
		levelUp: "Level up:",
		levelLabel: "Lv",
		rar_common: "Common",
		rar_uncommon: "Uncommon",
		rar_rare: "Rare",
		rar_epic: "Epic",
		rar_legendary: "Legendary",
		lineage: "🌳 Family Tree",
		startEl: "This is a starting element — everything began with it.",
		genImage: "🎨 Generate image",
		genImageWait: "🎨 Generating…",
		genImageNeedsKey: "Enter a Gemini key in Settings to generate images.",
		genImageFail: "Could not generate image, try again shortly.",
		regenImage: "🔄 Regenerate",
		imageLoading: "🎨 Loading image…",
		profileTitle: "👤 Profile",
		profileFirsts: "world firsts",
		profileRecent: "Recent world firsts",
		profileCats: "Categories",
		profileNone: "This player has no world-first discoveries yet.",
		questHint: "💡 Hint",
		hintNoRecipe: "No known recipe for this goal — get creative!",
		hintReveal: "💡 Hint",
		goal: "Goal",
		settingsSaved: "Settings saved ✓",
		showMore: "Show more",
		startEl2: "start",
		settingsTitle: "⚙️ Settings",
		profileMembership: "Profile & Account",
		aiHeading: "Artificial Intelligence",
		poolHeading: "Global Pool",
		gameHeading: "Game",
		dataHeading: "Data & Game Memory",
		language: "Language / Dil",
		soundFx: "Sound effects",
		register: "Sign up",
		login: "Log in",
		logout: "Log out",
		syncNow: "☁️ Sync now",
		save: "Save",
		exportData: "📤 Export data (JSON)",
		importData: "📥 Import recipes from another player (JSON)",
		exportTrain: "🧠 Export training data (JSONL)",
		resetAll: "Reset all data",
		usernamePh: "Username (3-20 characters)",
		passwordPh: "Password (at least 4 characters)",
	},
};

function currentLang() {
	const l = Store.settings.lang;
	return l === "en" ? "en" : "tr";
}

function t(key) {
	const lang = currentLang();
	return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.tr[key] || key;
}

/* HTML'deki data-i18n / data-i18n-ph / data-i18n-title özniteliklerini doldurur. */
function applyStaticI18n() {
	document.querySelectorAll("[data-i18n]").forEach((el) => {
		el.textContent = t(el.dataset.i18n);
	});
	document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
		el.setAttribute("placeholder", t(el.dataset.i18nPh));
	});
	document.querySelectorAll("[data-i18n-title]").forEach((el) => {
		el.setAttribute("title", t(el.dataset.i18nTitle));
	});
	document.documentElement.lang = currentLang();
}
