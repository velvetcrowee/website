/* Koleksiyonlar — tematik element setleri. Bir setin tüm üyelerini keşfetmek
   bir kilometre taşıdır: tamamlanınca kutlama gelir. Üyeler, kategorilerde ve
   topluluk tariflerinde geçen, ulaşılabilir element adlarıdır.

   İlerleme keşfedilen elementlerden türetilir (ayrı kayıt tutulmaz); yalnızca
   "tamamlandı" kutlamasının bir kez gösterilmesi için claimed listesi saklanır. */

const COLLECTIONS = [
	{
		id: "klasik", emoji: "🌟", name: "Klasik Dörtlü",
		desc: "Her şeyin başladığı dört temel element.",
		members: ["Su", "Ateş", "Toprak", "Hava"],
	},
	{
		id: "gokyuzu", emoji: "🌌", name: "Gök Cisimleri",
		desc: "Uzayın derinliklerindeki cisimler.",
		members: ["Güneş", "Ay", "Dünya", "Yıldız", "Gezegen", "Galaksi", "Karadelik", "Asteroit"],
	},
	{
		id: "havaolay", emoji: "🌦️", name: "Hava Olayları",
		desc: "Gökyüzünden gelen her şey.",
		members: ["Bulut", "Yağmur", "Kar", "Fırtına", "Şimşek", "Sis", "Gökkuşağı", "Rüzgar"],
	},
	{
		id: "sular", emoji: "🌊", name: "Suyun Halleri",
		desc: "Damladan okyanusa.",
		members: ["Göl", "Deniz", "Okyanus", "Nehir", "Buz", "Buhar", "Dalga"],
	},
	{
		id: "yasam", emoji: "🌱", name: "Yaşam Ağı",
		desc: "Doğanın canlı dokusu.",
		members: ["Bitki", "Ağaç", "Çiçek", "Hayvan", "Balık", "Kuş", "İnsan", "Böcek"],
	},
	{
		id: "uygarlik", emoji: "🏙️", name: "Uygarlık",
		desc: "Tuğladan şehre, insan eserleri.",
		members: ["Tuğla", "Duvar", "Ev", "Köy", "Kasaba", "Şehir", "Ülke"],
	},
	{
		id: "teknoloji", emoji: "🤖", name: "Teknoloji Çağı",
		desc: "Metalden yapay zekâya.",
		members: ["Metal", "Elektrik", "Ampul", "Makine", "Robot", "Bilgisayar", "İnternet", "Yapay Zekâ"],
	},
	{
		id: "efsane", emoji: "🐉", name: "Efsaneler Diyarı",
		desc: "Mitlerin ve büyünün kahramanları.",
		members: ["Ejderha", "Anka Kuşu", "Tek Boynuz", "Deniz Kızı", "Büyücü", "Şövalye", "Hayalet"],
	},
	{
		id: "mineral", emoji: "🪨", name: "Yerin Derinlikleri",
		desc: "Taştan lavla, yerin altından gelenler.",
		members: ["Taş", "Kaya", "Kum", "Kül", "Lav", "Mağara", "Çöl", "Petrol"],
	},
	{
		id: "mutfak", emoji: "🍽️", name: "Türk Mutfağı",
		desc: "Sofranın baş tacı lezzetler.",
		members: ["Ekmek", "Peynir", "Çay", "Bal", "Kebap", "Lahmacun", "Döner", "Yoğurt", "Ayran"],
	},
	{
		id: "krallik", emoji: "🏰", name: "Krallık",
		desc: "Kılıçtan kaleye, şövalyelerin çağı.",
		members: ["Asker", "Kılıç", "Kale", "Kral", "Ordu", "Şövalye", "Hazine", "Efsanevi Kılıç"],
	},
	{
		id: "kesif", emoji: "🚀", name: "Uzay Keşfi",
		desc: "Yıldızlara uzanan yolculuk.",
		members: ["Roket", "Astronot", "Uzay Gemisi", "Koloni", "Teleskop", "Gözlem", "Uzay Yolculuğu"],
	},
	{
		id: "dijital", emoji: "💻", name: "Dijital Çağ",
		desc: "Çipten yapay zekâya, bilgi devrimi.",
		members: ["Bilgisayar", "İnternet", "Çip", "İşlemci", "Sosyal Medya", "E-Spor", "E-Ticaret", "Yapay Zekâ"],
	},
	{
		id: "sanat", emoji: "🎨", name: "Sanat & Kültür",
		desc: "İnsanlığın yaratıcı ruhu.",
		members: ["Müzik", "Resim", "Sanat", "Film", "Sinema", "Kitap", "Şarkı", "Dans"],
	},
	{
		id: "duygu", emoji: "💭", name: "Duygular",
		desc: "Kalbin ve aklın derin halleri.",
		members: ["Aşk", "Mutluluk", "Hüzün", "Korku", "Hayal", "Rüya", "Bilgelik", "Hatıra"],
	},
	{
		id: "ulasim", emoji: "🚗", name: "Yollar & Araçlar",
		desc: "Tekerlekten yelkene, hareket halinde.",
		members: ["Araba", "Uçak", "Gemi", "Tekne", "Tekerlek", "Motor", "Yelkenli", "Trafik"],
	},
	{
		id: "yaratik", emoji: "👹", name: "Mitik Yaratıklar",
		desc: "Efsanelerin canavar ve ruhları.",
		members: ["Ejderha", "Anka Kuşu", "Deniz Kızı", "Tek Boynuz", "Canavar", "Kurt Adam", "Hayalet", "Ruh"],
	},
	{
		id: "bilim", emoji: "🔬", name: "Bilim Dünyası",
		desc: "Atomdan teleskoba, evreni anlamak.",
		members: ["Atom", "Molekül", "Bilim", "Elektrik", "Çelik", "Mercek", "Teleskop", "DNA"],
	},
];

/* Bir koleksiyonun ilerlemesi: { found, total, missing[], done }. */
function collectionProgress(col) {
	const found = [];
	const missing = [];
	for (const name of col.members) {
		if (getElement(name)) found.push(name); else missing.push(name);
	}
	return { found: found.length, total: col.members.length, missing, done: missing.length === 0 };
}
