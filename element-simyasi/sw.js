/* Çevrimdışı destek: uygulama dosyaları için "önce ağ" stratejisi kullanılır —
   çevrimiçiyken her zaman en güncel sürüm getirilir (güncellemeler anında
   görünür), ağ yoksa önbellekteki kopya sunulur. API istekleri her zaman ağa
   gider. */

const CACHE = "simya-v11";
const ASSETS = [
	"./",
	"./index.html",
	"./styles.css",
	"./data.js",
	"./categories.js",
	"./seed.js",
	"./ai.js",
	"./game.js",
	"./app.js",
	"./recipes.json",
	"./manifest.webmanifest",
	"./icons/icon-192.png",
	"./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener("fetch", (e) => {
	const url = new URL(e.request.url);
	// API istekleri ve diğer origin'ler her zaman ağa gider.
	if (url.origin !== location.origin) return;
	if (e.request.method !== "GET") return;
	// Önce ağ: güncel kopyayı getir ve önbelleği tazele; ağ yoksa önbelleğe düş.
	e.respondWith(
		fetch(e.request)
			.then((res) => {
				const copy = res.clone();
				caches.open(CACHE).then((c) => c.put(e.request, copy));
				return res;
			})
			.catch(() => caches.match(e.request).then((cached) => cached || Promise.reject()))
	);
});
