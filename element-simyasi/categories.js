/* Element kategorileri. Bilinen elementler burada elle sınıflandırılır;
   yapay zekânın ürettiği yeni elementlerin kategorisini modelin kendisi seçer
   (şemadaki category alanı). Eşleşme yoksa "diger" kullanılır. */

const CATEGORIES = [
	{ id: "doga", name: "Doğa", emoji: "🌍" },
	{ id: "canli", name: "Canlılar", emoji: "🐾" },
	{ id: "yiyecek", name: "Yiyecek", emoji: "🍽️" },
	{ id: "insan", name: "İnsan & Toplum", emoji: "🏛️" },
	{ id: "teknoloji", name: "Teknoloji", emoji: "⚙️" },
	{ id: "uzay", name: "Uzay", emoji: "🌌" },
	{ id: "mitoloji", name: "Mitoloji & Sihir", emoji: "🐉" },
	{ id: "soyut", name: "Kültür & Soyut", emoji: "💭" },
	{ id: "diger", name: "Diğer", emoji: "✨" },
];

const CATEGORY_LISTS = {
	doga: [
		"Su", "Ateş", "Toprak", "Hava", "Ada", "Basınç", "Bataklık", "Bulut", "Buz",
		"Buzdağı", "Buzul", "Çamur", "Çöl", "Dağ", "Dalga", "Deniz", "Deprem",
		"Duman", "Enerji", "Fırtına", "Gayzer", "Gece", "Gökkuşağı", "Gökyüzü",
		"Göl", "Işık", "Kar", "Karanlık", "Kasırga", "Kaya", "Kıta", "Kıyı", "Kum",
		"Kül", "Lav", "Mağara", "Nehir", "Okyanus", "Plaj", "Rüzgar", "Sahra",
		"Sıradağ", "Sis", "Şimşek", "Taş", "Toz", "Tsunami", "Vaha", "Volkan",
		"Yağmur", "Yangın", "Oksijen", "Tuz",
	],
	canli: [
		"Ağaç", "Akrep", "Algler", "Arı", "Ayı", "Bakteri", "Balık", "Baykuş",
		"Bitki", "Böcek", "Buket", "Çiçek", "Deve", "DNA", "Evcil Hayvan",
		"Hayvan", "İnek", "Kelebek", "Keçi", "Kurbağa", "Kurt", "Kuş", "Martı",
		"Mercan", "Nektar", "Orman", "Penguen", "Polen", "Solucan", "Sürü",
		"Yaprak", "Yarasa", "Yaşam", "Yılan", "Yosun", "Ateş Böceği",
		"Kılıç Balığı", "Vahşi Doğa",
	],
	yiyecek: [
		"Ayran", "Bal", "Buğday", "Çay", "Döner", "Ekmek", "Elma", "Et", "Hamur",
		"Kahvaltı", "Kebap", "Lahmacun", "Mangal", "Meyve", "Meyve Suyu",
		"Peynir", "Süt", "Un", "Yemek", "Yoğurt",
	],
	insan: [
		"Aile", "Alet", "Asker", "Balıkçı", "Balta", "Banka", "Bina", "Çiftçi",
		"Çoban", "Denizci", "Duvar", "Ev", "Evlilik", "Gökdelen", "İnsan", "Kale",
		"Kâğıt", "Kasaba", "Kılıç", "Köy", "Kral", "Odun", "Okul", "Ordu",
		"Öğrenci", "Para", "Sal", "Şehir", "Tarım", "Tuğla", "Ülke", "Kamp Ateşi",
		"Kardan Adam", "Yaşlılık", "Ölüm", "Şarkı", "Dans",
	],
	teknoloji: [
		"Ampul", "Araba", "Atom", "Ayna", "Bilgisayar", "Bilim", "Cam", "Çelik",
		"Çip", "E-Spor", "E-Ticaret", "Elektrik", "Fotoğraf", "Gemi", "İnternet",
		"İşlemci", "Kamera", "Makine", "Mercek", "Metal", "Molekül", "Motor",
		"Pas", "Petrol", "Robot", "Saat", "Sosyal Medya", "Tekerlek", "Tekne",
		"Teleskop", "Trafik", "Uçak", "Yakıt", "Yapay Zekâ", "Yelkenli",
		"Zaman Makinesi",
	],
	uzay: [
		"Asteroit", "Astronot", "Ay", "Ay Yürüyüşü", "Çekim", "Dünya", "Evren",
		"Galaksi", "Gezegen", "Gözlem", "Güneş", "Karadelik", "Koloni",
		"Kozmoloji", "Kuyruklu Yıldız", "Olay Ufku", "Roket", "Sistem", "Tutulma",
		"Uzay", "Uzay Gemisi", "Uzay Yolculuğu", "Yıldız",
	],
	mitoloji: [
		"Anka Kuşu", "Büyü", "Büyücü", "Canavar", "Deniz Kızı", "Dilek", "Efsane",
		"Efsanevi Kılıç", "Ejderha", "Hayalet", "Hazine", "Kıyamet", "Kurt Adam",
		"Nazar Boncuğu", "Ruh", "Sihir", "Şövalye", "Tek Boynuz",
	],
	soyut: [
		"Aşk", "Bilgelik", "Bilgi", "Denge", "Döngü", "Eğlence", "Film",
		"Gelecek", "Hatıra", "Hayal", "Hikaye", "Hüzün", "Kitap", "Korku",
		"Korku Filmi", "Kütüphane", "Mutluluk", "Müzik", "Oyun", "Resim", "Rüya",
		"Sanat", "Sinema", "Uyku", "Zaman",
	],
};

/* norm(ad) → kategori id. data.js'teki norm() ile kurulur. */
const CATEGORY_MAP = {};
for (const [cat, names] of Object.entries(CATEGORY_LISTS)) {
	for (const n of names) CATEGORY_MAP[norm(n)] = cat;
}

function categoryInfo(id) {
	return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}
