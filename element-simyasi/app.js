/* Arayüz katmanı — render, sürükle-bırak (Pointer Events), mobil birleştirme
   çubuğu, modallar ve bildirimler. Oyun kuralları game.js'tedir. */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const workspaceEl = $("#workspace");
const panelEl = $("#panel");
const chipListEl = $("#chip-list");

/* Yakın zamanda keşfedilenler — chip'te "YENİ" nabzı için. */
const freshNames = new Set();

let wsItems = [];
let wsIdSeq = 1;

/* ---------- Bildirimler ---------- */

function toast(text, kind = "", ms = 3000) {
	const el = document.createElement("div");
	el.className = `toast ${kind}`;
	el.textContent = text;
	$("#toast-area").appendChild(el);
	// Süre sonunda silinme (fade-out) efektiyle kaybolur.
	setTimeout(() => {
		el.classList.add("toast-out");
		setTimeout(() => el.remove(), 400);
	}, ms);
}

/* Yan bildirim: ekranın kenarında belirir, ~2.6 sn sonra silinme efektiyle gider.
   "X tarafından bulundu" gibi bilgilendirmeler için. */
function sideNote(text, ms = 2600) {
	const el = document.createElement("div");
	el.className = "side-note";
	el.textContent = text;
	$("#sidenote-area").appendChild(el);
	setTimeout(() => {
		el.classList.add("side-note-out");
		setTimeout(() => el.remove(), 450);
	}, ms);
}

function confetti() {
	const area = $("#confetti-area");
	const colors = ["#fbbf24", "#a78bfa", "#34d399", "#f87171", "#60a5fa"];
	for (let i = 0; i < 24; i++) {
		const s = document.createElement("span");
		s.className = "confetti";
		s.style.left = Math.random() * 100 + "vw";
		s.style.background = colors[i % colors.length];
		s.style.animationDelay = Math.random() * 0.4 + "s";
		area.appendChild(s);
		setTimeout(() => s.remove(), 2200);
	}
}

/* ---------- Ses efektleri (WebAudio, dosyasız) ---------- */

let audioCtx = null;

function sfx(kind) {
	if (Store.settings.sound === false) return;
	try {
		audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
		const tones = {
			merge: [[392, 0.07], [523, 0.09]],
			discover: [[523, 0.09], [659, 0.09], [784, 0.16]],
			first: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.22]],
			badge: [[659, 0.1], [880, 0.18]],
			error: [[196, 0.18]],
		}[kind] || [];
		let at = audioCtx.currentTime;
		tones.forEach(([f, d]) => {
			const o = audioCtx.createOscillator();
			const g = audioCtx.createGain();
			o.type = "triangle";
			o.frequency.value = f;
			g.gain.setValueAtTime(0.12, at);
			g.gain.exponentialRampToValueAtTime(0.001, at + d);
			o.connect(g).connect(audioCtx.destination);
			o.start(at);
			o.stop(at + d + 0.02);
			at += d * 0.85;
		});
	} catch { /* ses isteğe bağlı */ }
}

function announceResult(res) {
	// Bu elementi dünyada daha önce başkası bulduysa, yan tarafta kısa bir
	// "X tarafından bulundu" bildirimi göster (silinme efektiyle kaybolur).
	if (res.by && res.by !== getNickname()) {
		sideNote(`🥇 ${res.emoji} ${res.name} — ${res.by} tarafından bulundu`);
	}
	(res.newBadges || []).forEach((b, i) => {
		setTimeout(() => { toast(`🎖️ Rozet kazandın: ${b.emoji} ${b.name}`, "gold", 4500); sfx("badge"); }, 900 + i * 1200);
	});
	if (res.questDone) {
		setTimeout(() => {
			toast(`🎯 Hedef tamamlandı: ${res.questDone.emoji} ${res.questDone.name}!`, "gold", 5000);
			confetti();
			sfx("badge");
			renderQuest();
		}, 600);
	}
	if (!res.discovered) { sfx("merge"); return; }
	checkCollections();
	if (res.isNew) {
		toast(`🏆 İlk Keşif: ${res.emoji} ${res.name}`, "gold", 4500);
		confetti();
		sfx("first");
	} else {
		toast(`🎉 Yeni keşif: ${res.emoji} ${res.name}`);
		sfx("discover");
	}
	freshNames.add(norm(res.name));
	setTimeout(() => { freshNames.delete(norm(res.name)); renderChips(); }, 10000);
}

function handleCombineError(err) {
	if (err.message === "BUSY") return;
	if (err.message === "NO_KEY") {
		openSettings("Sınırsız birleşim için ücretsiz bir Gemini anahtarı girin — aistudio.google.com/apikey");
		return;
	}
	sfx("error");
	let msg = err.message || "Bir hata oluştu";
	if (/failed to fetch|networkerror|load failed|ulaşılamadı/i.test(msg)) {
		msg = "Sunucuya ulaşılamadı — internet bağlantını kontrol et, birazdan tekrar dene.";
	}
	toast(msg, "error", 4000);
}

/* ---------- Panel (keşfedilen elementler) ---------- */

function renderCount() {
	const n = Object.keys(Store.elements).length;
	$("#element-count").textContent = `${n} element`;
}

/* Aktif kategori filtresi ("" = tümü). */
let activeCat = "";

function renderCatFilter() {
	const counts = categoryCounts();
	const total = Object.keys(Store.elements).length;
	const bar = $("#cat-filter");
	bar.innerHTML = "";
	const mk = (id, label) => {
		const b = document.createElement("button");
		b.className = "cat-chip" + ((activeCat === id) ? " active" : "");
		b.dataset.cat = id;
		b.textContent = label;
		bar.appendChild(b);
	};
	mk("", `${t("all")} ${total}`);
	CATEGORIES.forEach((c) => {
		if (counts[c.id]) mk(c.id, `${c.emoji} ${c.name} ${counts[c.id]}`);
	});
}

$("#cat-filter").addEventListener("click", (ev) => {
	const b = ev.target.closest(".cat-chip");
	if (!b) return;
	activeCat = b.dataset.cat;
	renderChips();
});

/* Anahtarlı (keyed) artımlı render: tüm listeyi sıfırdan kurmak yerine var olan
   chip düğümlerini yeniden kullanır, yalnızca değişenleri günceller ve sırayı
   yerinde düzeltir. Favori sabitleme, birleştirme ve havuz tazelemesi gibi sık
   olaylarda 300+ düğümü her seferinde söküp yeniden kurmayı önler. */
const chipNodes = new Map(); // norm(ad) → buton düğümü

function createChip(e) {
	const chip = document.createElement("button");
	chip.className = "chip";
	const emo = document.createElement("span");
	const nm = document.createElement("span");
	const star = document.createElement("span");
	star.className = "chip-star";
	chip.append(emo, nm, star);
	updateChip(chip, e);
	return chip;
}

function updateChip(chip, e) {
	const fav = isFavorite(e.name);
	const cls = "chip" + (freshNames.has(norm(e.name)) ? " fresh" : "") + (fav ? " pinned" : "");
	if (chip.className !== cls) chip.className = cls;
	if (chip.dataset.name !== e.name) chip.dataset.name = e.name;
	// textContent kullanılır: ayrıca kaçış (escape) gerekmez, parse maliyeti yok.
	if (chip.children[0].textContent !== e.emoji) chip.children[0].textContent = e.emoji;
	if (chip.children[1].textContent !== e.name) chip.children[1].textContent = e.name;
	const star = chip.children[2];
	const starCh = fav ? "⭐" : "☆";
	if (star.textContent !== starCh) star.textContent = starCh;
	star.title = fav ? t("unpin") : t("pin");
}

function renderChips() {
	const q = norm($("#search").value || "");
	const list = elementList()
		.filter((e) => !q || norm(e.name).includes(q))
		.filter((e) => !activeCat || elementCategory(e) === activeCat)
		// Favoriler her zaman en üstte (sabitlenmiş) görünür. sort kararlıdır:
		// grup içinde keşif sırası (yenilik) korunur.
		.sort((a, b) => (isFavorite(b.name) ? 1 : 0) - (isFavorite(a.name) ? 1 : 0));

	const seen = new Set();
	let prev = null;
	for (const e of list) {
		const key = norm(e.name);
		seen.add(key);
		let node = chipNodes.get(key);
		if (!node) { node = createChip(e); chipNodes.set(key, node); }
		else updateChip(node, e);
		// Düğümü prev'den hemen sonraya getir (zaten oradaysa dokunma).
		const ref = prev ? prev.nextSibling : chipListEl.firstChild;
		if (ref !== node) chipListEl.insertBefore(node, ref);
		prev = node;
	}
	// Artık listede olmayan (arama/filtre dışı kalan) düğümleri kaldır.
	for (const [key, node] of chipNodes) {
		if (!seen.has(key)) { node.remove(); chipNodes.delete(key); }
	}
	renderCount();
	renderCatFilter();
}

/* Yıldıza tıklayınca elementi favorile/çıkar (sürüklemeyi başlatmaz). */
chipListEl.addEventListener("click", (ev) => {
	const star = ev.target.closest(".chip-star");
	if (!star) return;
	ev.stopPropagation();
	const chip = star.closest(".chip");
	if (!chip) return;
	const nowFav = toggleFavorite(chip.dataset.name);
	toast(nowFav ? `⭐ ${chip.dataset.name} ${t("pinned")}` : `${chip.dataset.name} ${t("unpinned")}`, "", 1500);
	renderChips();
});

function escapeHtml(s) {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Tuval ---------- */

function persistWorkspaceSoon() {
	clearTimeout(persistWorkspaceSoon.t);
	persistWorkspaceSoon.t = setTimeout(() => { Store.workspace = wsItems; }, 300);
}

function wsItemEl(id) {
	return workspaceEl.querySelector(`[data-id="${id}"]`);
}

function clampToWorkspace(x, y) {
	const r = workspaceEl.getBoundingClientRect();
	return {
		x: Math.max(0, Math.min(x, r.width - 60)),
		y: Math.max(0, Math.min(y, r.height - 36)),
	};
}

function addWsItem(name, x, y, pop = false) {
	const el = getElement(name);
	if (!el) return null;
	const p = clampToWorkspace(x, y);
	const item = { id: "w" + wsIdSeq++, name: el.name, x: p.x, y: p.y };
	wsItems.push(item);
	renderWsItem(item, pop);
	persistWorkspaceSoon();
	return item;
}

function removeWsItem(id) {
	wsItems = wsItems.filter((i) => i.id !== id);
	wsItemEl(id)?.remove();
	persistWorkspaceSoon();
}

function renderWsItem(item, pop = false) {
	const e = getElement(item.name);
	if (!e) return;
	const node = document.createElement("div");
	node.className = "ws-item" + (pop ? " pop" : "");
	node.dataset.id = item.id;
	node.dataset.name = item.name;
	node.style.left = item.x + "px";
	node.style.top = item.y + "px";
	node.innerHTML = `<span>${e.emoji}</span><span>${escapeHtml(e.name)}</span>`;
	workspaceEl.appendChild(node);
}

function renderWorkspace() {
	// Yalnızca element örneklerini temizle; hedef çubuğu gibi sabitler kalsın.
	workspaceEl.querySelectorAll(".ws-item").forEach((n) => n.remove());
	wsItems.forEach((i) => renderWsItem(i));
}

/* İki tuval öğesini birleştirir; başarıda ikisinin yerine sonucu koyar. */
async function mergeItems(idA, idB) {
	const a = wsItems.find((i) => i.id === idA);
	const b = wsItems.find((i) => i.id === idB);
	if (!a || !b) return;
	const elA = wsItemEl(idA), elB = wsItemEl(idB);
	elA?.classList.add("pending");
	elB?.classList.add("pending");
	elA && (elA.firstChild.textContent = "⏳");
	try {
		const res = await combine(a.name, b.name);
		const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
		removeWsItem(idA);
		removeWsItem(idB);
		addWsItem(res.name, mx, my, true);
		announceResult(res);
		renderChips();
	} catch (err) {
		elA?.classList.remove("pending");
		elB?.classList.remove("pending");
		const ea = getElement(a.name);
		if (elA && ea) elA.firstChild.textContent = ea.emoji;
		elB?.classList.remove("merge-target");
		handleCombineError(err);
	}
}

/* ---------- Orta tık: tuvaldeki elementi kopyala ---------- */

// Orta tık otomatik kaydırmasını engelle.
workspaceEl.addEventListener("mousedown", (ev) => {
	if (ev.button === 1 && ev.target.closest(".ws-item")) ev.preventDefault();
});
workspaceEl.addEventListener("auxclick", (ev) => {
	if (ev.button !== 1) return; // orta tuş
	const item = ev.target.closest(".ws-item");
	if (!item) return;
	ev.preventDefault();
	const x = parseFloat(item.style.left) + 28;
	const y = parseFloat(item.style.top) + 24;
	addWsItem(item.dataset.name, x, y, true);
});

/* ---------- Sürükle-bırak (Pointer Events) ---------- */

const drag = { active: false };

document.addEventListener("pointerdown", (ev) => {
	// Favori yıldızı sürüklemeyi başlatmaz (ayrı click ile ele alınır).
	if (ev.target.closest(".chip-star")) return;
	const chip = ev.target.closest(".chip");
	const wsItem = ev.target.closest(".ws-item");
	if (!chip && !wsItem) return;
	// Yalnızca sol tuş/parmakla sürükle; orta/sağ tuş ayrı ele alınır.
	if (ev.pointerType === "mouse" && ev.button !== 0) return;
	ev.preventDefault();
	drag.active = true;
	drag.moved = false;
	drag.startX = ev.clientX;
	drag.startY = ev.clientY;
	drag.pointerId = ev.pointerId;
	// Pointer capture yalnızca farede: masaüstünde panelden tuvale sürükleme
	// fare hızlı gitse de kesilmez. Dokunmatikte kapatılır ki panel listesi
	// parmakla normal şekilde kaydırılabilsin (touch-action: pan-y).
	if (ev.pointerType === "mouse") {
		try { (chip || wsItem).setPointerCapture(ev.pointerId); } catch { /* desteklenmiyor */ }
	}

	if (chip) {
		drag.type = "chip";
		drag.name = chip.dataset.name;
		drag.ghost = null;
		drag.src = chip;
	} else {
		drag.type = "ws";
		drag.id = wsItem.dataset.id;
		const r = wsItem.getBoundingClientRect();
		drag.offX = ev.clientX - r.left;
		drag.offY = ev.clientY - r.top;
		wsItem.classList.add("dragging");
	}
});

/* pointermove saniyede onlarca kez tetiklenir; konum güncellemesini
   requestAnimationFrame ile kareye bir kez sıkıştırırız (layout thrash azalır,
   sürükleme akıcılaşır). Son olay saklanır, kare geldiğinde işlenir. */
let _moveEv = null, _moveRaf = 0;

document.addEventListener("pointermove", (ev) => {
	if (!drag.active) return;
	if (Math.abs(ev.clientX - drag.startX) + Math.abs(ev.clientY - drag.startY) > 6) drag.moved = true;
	if (!drag.moved) return;
	// PointerEvent'ten yalnızca konumu sakla (olay nesnesi sonra geçersiz olabilir).
	_moveEv = { clientX: ev.clientX, clientY: ev.clientY };
	if (!_moveRaf) _moveRaf = requestAnimationFrame(processMove);
}, { passive: true });

function processMove() {
	_moveRaf = 0;
	const ev = _moveEv;
	if (!ev || !drag.active || !drag.moved) return;

	if (drag.type === "chip") {
		if (!drag.ghost) {
			drag.ghost = drag.src.cloneNode(true);
			drag.ghost.classList.add("drag-ghost");
			document.body.appendChild(drag.ghost);
		}
		// transform: GPU katmanı, left/top'tan daha akıcı.
		drag.ghost.style.transform = `translate3d(${ev.clientX - 30}px, ${ev.clientY - 18}px, 0)`;
	} else {
		const node = wsItemEl(drag.id);
		if (!node) return;
		const wr = workspaceEl.getBoundingClientRect();
		const p = clampToWorkspace(ev.clientX - wr.left - drag.offX, ev.clientY - wr.top - drag.offY);
		node.style.left = p.x + "px";
		node.style.top = p.y + "px";
		// Birleşme hedefini vurgula
		$$(".ws-item.merge-target").forEach((n) => n.classList.remove("merge-target"));
		const target = hitTest(ev, node);
		if (target?.classList.contains("ws-item")) target.classList.add("merge-target");
		panelEl.classList.toggle("trash-hint", !!target?.closest?.("#panel") || isOverPanel(ev));
	}
}

function cancelPendingMove() {
	if (_moveRaf) { cancelAnimationFrame(_moveRaf); _moveRaf = 0; }
	_moveEv = null;
}

/* Bırakmadan (pointerup) hemen önce bekleyen son kareyi uygula: aksi halde
   rAF iptal edilince öğe son hareketin bir kare gerisinde kalır ve o eski konum
   kaydedilirdi. drag.active hâlâ true iken çağrılmalı. */
function flushPendingMove() {
	if (_moveRaf) { cancelAnimationFrame(_moveRaf); _moveRaf = 0; processMove(); }
}

document.addEventListener("pointerup", (ev) => {
	if (!drag.active) return;
	flushPendingMove();
	const d = { ...drag };
	drag.active = false;
	cancelPendingMove();
	panelEl.classList.remove("trash-hint");

	if (d.type === "chip") {
		d.ghost?.remove();
		if (d.moved) {
			// Hedefi tespit et (hayalet pointer-events:none olduğu için sayılmaz).
			const under = document.elementFromPoint(ev.clientX, ev.clientY);
			const targetChip = under?.closest?.(".chip");
			const targetWsItem = under?.closest?.(".ws-item");
			const wr = workspaceEl.getBoundingClientRect();
			const overWs = ev.clientX >= wr.left && ev.clientX <= wr.right && ev.clientY >= wr.top && ev.clientY <= wr.bottom;
			if (targetChip && targetChip.dataset.name !== d.name) {
				// Başka bir element chip'inin üstüne bırakıldı → panelde birleştir.
				combineByNames(d.name, targetChip.dataset.name);
			} else if (targetWsItem) {
				// Tuvaldeki bir öğenin üstüne bırakıldı → onunla birleştir.
				const wsName = targetWsItem.dataset.name;
				const mid = { x: parseFloat(targetWsItem.style.left), y: parseFloat(targetWsItem.style.top) };
				removeWsItem(targetWsItem.dataset.id);
				combineDroppedOnCanvas(d.name, wsName, mid);
			} else if (overWs) {
				// Boş tuvale bırakıldı → örnek oluştur.
				addWsItem(d.name, ev.clientX - wr.left - 30, ev.clientY - wr.top - 18);
			}
		} else {
			chipTapped(d.name);
		}
		return;
	}

	// Tuval öğesi bırakıldı
	const node = wsItemEl(d.id);
	node?.classList.remove("dragging");
	$$(".ws-item.merge-target").forEach((n) => n.classList.remove("merge-target"));
	if (!node) return;

	if (!d.moved) return; // yerinde dokunuş — şimdilik işlemsiz

	if (isOverPanel(ev)) {
		removeWsItem(d.id); // panele bırakmak siler
		return;
	}

	const item = wsItems.find((i) => i.id === d.id);
	if (item) {
		item.x = parseFloat(node.style.left);
		item.y = parseFloat(node.style.top);
		persistWorkspaceSoon();
	}

	const target = hitTest(ev, node);
	if (target?.classList.contains("ws-item") && target.dataset.id !== d.id) {
		mergeItems(d.id, target.dataset.id);
	}
});

document.addEventListener("pointercancel", () => {
	if (!drag.active) return;
	drag.active = false;
	cancelPendingMove();
	drag.ghost?.remove();
	if (drag.type === "ws") wsItemEl(drag.id)?.classList.remove("dragging");
	$$(".ws-item.merge-target").forEach((n) => n.classList.remove("merge-target"));
	panelEl.classList.remove("trash-hint");
});

function hitTest(ev, ignoreNode) {
	ignoreNode.style.visibility = "hidden";
	const el = document.elementFromPoint(ev.clientX, ev.clientY);
	ignoreNode.style.visibility = "";
	return el?.closest(".ws-item, #panel") || null;
}

function isOverPanel(ev) {
	const r = panelEl.getBoundingClientRect();
	return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
}

/* ---------- Chip dokunuşu: paneldeki birleştirme çubuğunu doldurur ----------
   Tıklama → sağdaki çubukta birleştir (tuvale getirmeye gerek yok).
   Sürükleme → tuvale ekle veya başka chip'in üstüne bırakıp birleştir. */

const slots = { a: "", b: "" };

function chipTapped(name) {
	if ($("#slot-result").dataset.name) clearSlots(); // önceki sonuçtan sonra yeni tur
	if (!slots.a) slots.a = name;
	else if (!slots.b) slots.b = name;
	else { clearSlots(); slots.a = name; }
	renderSlots();
	if (slots.a && slots.b) combineSlots();
}

function clearSlots() {
	slots.a = slots.b = "";
	$("#slot-result").dataset.name = "";
	renderSlots();
}

function slotLabel(name) {
	const e = name && getElement(name);
	return e ? `${e.emoji} ${e.name}` : t("slotPick");
}

function renderSlots() {
	$("#slot-a").textContent = slotLabel(slots.a);
	$("#slot-a").classList.toggle("filled", !!slots.a);
	$("#slot-b").textContent = slotLabel(slots.b);
	$("#slot-b").classList.toggle("filled", !!slots.b);
	const resName = $("#slot-result").dataset.name;
	$("#slot-result").textContent = resName ? slotLabel(resName) : "?";
}

async function combineSlots() {
	$("#slot-result").textContent = "⏳";
	try {
		const res = await combine(slots.a, slots.b);
		$("#slot-result").dataset.name = res.name;
		renderSlots();
		announceResult(res);
		renderChips();
	} catch (err) {
		$("#slot-result").textContent = "?";
		handleCombineError(err);
	}
}

/* Bir chip'i başka chip'in üstüne bırakınca doğrudan birleştir (panelde,
   tuvale getirmeden). Sonuç çubukta da gösterilir. */
async function combineByNames(nameA, nameB) {
	slots.a = nameA; slots.b = nameB;
	renderSlots();
	await combineSlots();
}

/* Panelden bir chip'i tuvaldeki öğenin üstüne bırakınca tuvalde birleştir. */
async function combineDroppedOnCanvas(nameA, nameB, pos) {
	try {
		const res = await combine(nameA, nameB);
		addWsItem(res.name, pos.x, pos.y, true);
		announceResult(res);
		renderChips();
	} catch (err) {
		handleCombineError(err);
	}
}

$("#slot-a").addEventListener("click", () => { slots.a = ""; $("#slot-result").dataset.name = ""; renderSlots(); });
$("#slot-b").addEventListener("click", () => { slots.b = ""; $("#slot-result").dataset.name = ""; renderSlots(); });
$("#slot-result").addEventListener("click", () => {
	const name = $("#slot-result").dataset.name;
	if (!name) return;
	const r = workspaceEl.getBoundingClientRect();
	addWsItem(name, r.width / 2 - 40, r.height / 2 - 18, true);
	clearSlots();
});

/* ---------- Arama ---------- */

// Aramayı debounce et: her tuş vuruşunda tüm listeyi yeniden çizme.
let _searchTimer = null;
$("#search").addEventListener("input", () => {
	clearTimeout(_searchTimer);
	_searchTimer = setTimeout(renderChips, 140);
});

/* ---------- Hedef göstergesi ---------- */

function renderQuest() {
	const q = currentQuest();
	const bar = $("#quest-bar");
	if (!q) { bar.hidden = true; return; }
	const cat = categoryInfo(CATEGORY_MAP[norm(q.name)] || "diger");
	$("#quest-text").textContent = `🎯 ${t("goal")}: ${q.emoji} ${q.name} (${cat.emoji} ${cat.name})`;
	bar.hidden = false;
}

$("#quest-skip").addEventListener("click", () => {
	DB.write("quest", pickQuest());
	renderQuest();
	toast(currentLang() === "en" ? "🎯 New goal set" : "🎯 Yeni hedef belirlendi");
});

/* Hedefin görünür adı: keşfedildiyse kayıtlı ad, değilse ilk harfi büyük. */
function displayName(normName) {
	const e = getElement(normName);
	if (e) return e.name;
	return normName.charAt(0).toLocaleUpperCase("tr") + normName.slice(1);
}

/* Gizli bileşen için ipucu: kategori + ilk harf (tamamını vermez). */
function secretClue(normName) {
	const ci = categoryInfo(CATEGORY_MAP[normName] || "diger");
	const first = normName.charAt(0).toLocaleUpperCase("tr");
	return `${ci.emoji} ${first}…`;
}

/* İpucu: hedefi üreten bilinen bir tarifi bulur; bir bileşeni açık, diğerini
   kategori + ilk harf olarak gösterir (havuz/yerleşik tariflerden, AI'sız). */
$("#quest-hint").addEventListener("click", () => {
	const q = currentQuest();
	if (!q) return;
	const pool = { ...SEED_RECIPES, ...COMMUNITY_RECIPES };
	const entry = Object.entries(pool).find(([, r]) => r && r.name && norm(r.name) === norm(q.name));
	if (!entry) { toast(t("hintNoRecipe"), "", 4000); return; }
	const [a, b] = entry[0].split("++");
	const haveA = !!getElement(a), haveB = !!getElement(b);
	// Oyuncunun zaten sahip olduğu bileşeni açık göster, diğerini ipucu yap.
	let known, secret;
	if (haveB && !haveA) { known = b; secret = a; } else { known = a; secret = b; }
	toast(`💡 ${q.emoji} ${q.name} = ${displayName(known)} + ${secretClue(secret)}`, "gold", 6000);
});

/* ---------- Başlık butonları ---------- */

$("#btn-clear").addEventListener("click", () => {
	wsItems = [];
	Store.workspace = [];
	renderWorkspace();
});

/* Tam ekran: telefonda element sürüklerken tarayıcının üst/alt çubukları
   (örn. Opera'nın alt navigasyon çubuğu) kazara açılmasın diye tüm tarayıcı
   arayüzünü gizler (Fullscreen API). PWA olarak ana ekrandan açıldıysa
   (standalone) zaten tam ekran olduğundan ve iOS Safari sayfa tam ekranını
   desteklemediğinden, buton yalnızca işe yarayacağı yerde (tarayıcı sekmesi +
   API destekli) gösterilir. */
const fsBtn = $("#btn-fullscreen");
function fsActive() { return document.fullscreenElement || document.webkitFullscreenElement; }
function fsSupported() {
	const el = document.documentElement;
	return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}
function inStandalone() {
	return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
}
async function enterFullscreen() {
	const el = document.documentElement;
	try {
		if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
		else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
		// Tam ekranda dönüşü kilitlemeye çalış (destekleyen cihazlarda dikey kalsın).
		if (screen.orientation && screen.orientation.lock) screen.orientation.lock("portrait").catch(() => {});
	} catch { /* kullanıcı reddetti veya desteklenmiyor */ }
}
async function exitFullscreen() {
	try {
		if (document.exitFullscreen) await document.exitFullscreen();
		else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
	} catch { /* yok say */ }
}
function syncFsBtn() {
	const show = fsSupported() && !inStandalone();
	fsBtn.hidden = !show;
	if (!show) return;
	const on = !!fsActive();
	fsBtn.classList.toggle("active", on);
	fsBtn.title = t(on ? "fullscreenExit" : "fullscreen");
}
fsBtn.addEventListener("click", () => { fsActive() ? exitFullscreen() : enterFullscreen(); });
document.addEventListener("fullscreenchange", syncFsBtn);
document.addEventListener("webkitfullscreenchange", syncFsBtn);
syncFsBtn();

/* Şanslı birleştirme: keşfedilmiş iki rastgele elementi panelde birleştirir. */
$("#btn-lucky").addEventListener("click", () => {
	const names = Object.values(Store.elements).map((e) => e.name);
	if (names.length < 1) return;
	const a = names[Math.floor(Math.random() * names.length)];
	const b = names[Math.floor(Math.random() * names.length)];
	combineByNames(a, b);
});

/* Skoru paylaş: Web Share API, yoksa panoya kopyalar. */
$("#btn-share").addEventListener("click", async () => {
	const me = getNickname();
	const firsts = Object.values(Store.elements).filter((e) => e.firstBy && e.firstBy === me).length;
	const text = `🧪 Element Simyası'nda ${Store.stats.discoveries} element keşfettim`
		+ (firsts ? `, ${firsts} tanesini dünyada ilk ben buldum! 🥇` : "!")
		+ "\nSen de oyna: " + location.href;
	try {
		if (navigator.share) { await navigator.share({ title: "Element Simyası", text }); }
		else { await navigator.clipboard.writeText(text); toast("📋 Skor panoya kopyalandı"); }
	} catch { /* kullanıcı vazgeçti */ }
});

/* ---------- Keşif Defteri ---------- */

$("#btn-book").addEventListener("click", () => {
	const stats = Store.stats;
	const maxDepth = elementList().reduce((m, e) => Math.max(m, elementDepth(e.name)), 0);
	const me = getNickname();
	const worldFirsts = Object.values(Store.elements).filter((e) => e.firstBy && e.firstBy === me).length;
	// "dünya ilki" değeri liderlik tablosu yüklenince kesinleşir (id ile güncellenir).
	$("#book-stats").innerHTML = `
		<div class="stat"><b>${stats.discoveries}</b><span>${t("statElement")}</span></div>
		<div class="stat"><b id="stat-firsts">${worldFirsts}</b><span>${t("statFirst")}</span></div>
		<div class="stat"><b>${stats.combos}</b><span>${t("statCombo")}</span></div>
		<div class="stat"><b>${maxDepth}</b><span>${t("statDeepest")}</span></div>`;

	const earned = Store.badges;
	$("#badge-grid").innerHTML = BADGES.map((b) => `
		<div class="badge-card ${earned[b.id] ? "earned" : "locked"}">
			<span class="b-emoji">${b.emoji}</span>
			<span class="b-name">${b.name}</span>
			<span class="b-goal">${b.goal}</span>
		</div>`).join("");
	renderCollections();

	// Modal hemen açılsın; ağır liste ve liderlik sonraki kareye ertelenir.
	$("#modal-book").hidden = false;
	requestAnimationFrame(() => {
		renderBookReset();
		renderWorldStats();
		renderLeaderboard();
		renderCatLeaderboard();
		renderActivityFeed();
	});
});

/* Keşif listesi sayfalı yüklenir: çok büyük koleksiyonlarda binlerce DOM düğümü
   tek seferde basmaz; "Daha fazla göster" ile parça parça eklenir. */
const BOOK_PAGE = 80;
let _bookItems = [], _bookShown = 0;

function renderBookReset() {
	_bookItems = elementList();
	_bookShown = 0;
	$("#book-list").innerHTML = "";
	renderBookMore();
}

function renderBookMore() {
	const en = currentLang() === "en";
	const loc = en ? "en-US" : "tr-TR";
	const frag = document.createDocumentFragment();
	const end = Math.min(_bookShown + BOOK_PAGE, _bookItems.length);
	for (let i = _bookShown; i < end; i++) {
		const e = _bookItems[i];
		const li = document.createElement("li");
		li.dataset.name = e.name;
		const date = new Date(e.discoveredAt).toLocaleDateString(loc, { day: "numeric", month: "long" });
		const from = e.fromPair ? `${e.fromPair[0]} + ${e.fromPair[1]}` : t("startEl2");
		const first = e.firstBy ? ` <span class="first-tag">🥇 ${escapeHtml(e.firstBy)}</span>` : "";
		li.innerHTML = `<span>${e.emoji}</span><span>${escapeHtml(e.name)}${e.firstDiscovery ? " 🏆" : ""}${first}</span>
			<span class="sub">${escapeHtml(from)} — ${date}</span>`;
		frag.appendChild(li);
	}
	$("#book-list").appendChild(frag);
	_bookShown = end;
	$("#btn-book-more").hidden = _bookShown >= _bookItems.length;
}

$("#btn-book-more").addEventListener("click", renderBookMore);

/* Koleksiyon ilerlemesi: her set için bulunan/toplam ve eksik üyeler. */
function renderCollections() {
	const grid = $("#collection-grid");
	grid.innerHTML = COLLECTIONS.map((col) => {
		const p = collectionProgress(col);
		const pct = Math.round((p.found / p.total) * 100);
		const missing = p.missing.slice(0, 4).map(escapeHtml).join(", ")
			+ (p.missing.length > 4 ? "…" : "");
		return `<div class="coll-card ${p.done ? "coll-done" : ""}">
			<div class="coll-head"><span>${col.emoji} ${escapeHtml(col.name)}</span><span class="coll-count">${p.found}/${p.total}${p.done ? " ✓" : ""}</span></div>
			<div class="coll-bar"><div class="coll-fill" style="width:${pct}%"></div></div>
			<div class="coll-sub">${p.done ? escapeHtml(col.desc) : (currentLang() === "en" ? "Missing: " : "Eksik: ") + missing}</div>
		</div>`;
	}).join("");
}

/* Kategori şampiyonları: havuzdaki ilk-keşifleri kategoriye göre sayıp her
   kategorinin en çok ilk keşfe sahip oyuncusunu gösterir. Tamamen havuzdan
   (COMMUNITY_RECIPES) türetilir — sunucuda ek bir uç gerekmez. */
function renderCatLeaderboard() {
	const box = $("#cat-leaderboard");
	// kategori → { oyuncu: sayı }
	const perCat = {};
	for (const r of Object.values(COMMUNITY_RECIPES)) {
		if (!r || !r.by) continue;
		const cat = r.cat || "diger";
		(perCat[cat] = perCat[cat] || {})[r.by] = (perCat[cat]?.[r.by] || 0) + 1;
	}
	const me = getNickname();
	const rows = CATEGORIES.filter((c) => perCat[c.id]).map((c) => {
		const [name, count] = Object.entries(perCat[c.id]).sort((a, b) => b[1] - a[1])[0];
		const mine = name === me ? " lb-me" : "";
		return `<li class="${mine.trim()}"><span class="lb-rank">${c.emoji}</span><span class="lb-name">${escapeHtml(c.name)}</span><span class="lb-champ" data-profile="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="lb-count">${count} 🥇</span></li>`;
	});
	box.innerHTML = rows.length
		? `<ol class="lb-list">${rows.join("")}</ol>`
		: `<p class="muted">${currentLang() === "en" ? "No category champions yet." : "Henüz kategori şampiyonu yok."}</p>`;
}

/* Son keşifler akışı: havuzdaki tarifleri tarihe göre sıralayıp en yeni
   ilk-keşifleri "X az önce Y'yi buldu" biçiminde listeler. */
function renderActivityFeed() {
	const box = $("#activity-feed");
	const en = currentLang() === "en";
	const recent = Object.values(COMMUNITY_RECIPES)
		.filter((r) => r && r.by && r.at)
		.sort((a, b) => new Date(b.at) - new Date(a.at))
		.slice(0, 12);
	if (!recent.length) {
		box.innerHTML = `<p class="muted">${en ? "No discoveries yet." : "Henüz keşif yok."}</p>`;
		return;
	}
	const me = getNickname();
	box.innerHTML = `<ul class="feed-list">${recent.map((r) => {
		const when = timeAgo(r.at, en);
		const found = en ? "discovered" : "keşfetti";
		const mine = r.by === me ? " feed-me" : "";
		return `<li class="${mine.trim()}"><span>${r.emoji || "✨"}</span>
			<span class="feed-text"><b data-profile="${escapeHtml(r.by)}">${escapeHtml(r.by)}</b> ${found} <b>${escapeHtml(r.name)}</b></span>
			<span class="feed-when">${when}</span></li>`;
	}).join("")}</ul>`;
}

/* Göreli zaman ("3 dk önce" / "3m ago"). */
function timeAgo(iso, en) {
	const diff = Date.now() - new Date(iso).getTime();
	if (isNaN(diff)) return "";
	const m = Math.floor(diff / 60000);
	if (m < 1) return en ? "just now" : "az önce";
	if (m < 60) return en ? `${m}m ago` : `${m} dk önce`;
	const h = Math.floor(m / 60);
	if (h < 24) return en ? `${h}h ago` : `${h} sa önce`;
	const d = Math.floor(h / 24);
	return en ? `${d}d ago` : `${d} gün önce`;
}

/* ---------- Oyuncu profili (herkese açık, havuzdan türetilir) ---------- */

function openProfile(name) {
	const en = currentLang() === "en";
	// Bu oyuncunun havuzdaki tüm ilk-keşifleri.
	const firsts = Object.values(COMMUNITY_RECIPES).filter((r) => r && r.by === name);
	$("#profile-title").textContent = `👤 ${name}`;
	if (!firsts.length) {
		$("#profile-body").innerHTML = `<p class="muted">${t("profileNone")}</p>`;
		$("#modal-profile").hidden = false;
		return;
	}
	// Kategori dağılımı.
	const catCounts = {};
	firsts.forEach((r) => { const c = r.cat || "diger"; catCounts[c] = (catCounts[c] || 0) + 1; });
	const cats = Object.entries(catCounts).sort((a, b) => b[1] - a[1])
		.map(([id, n]) => { const ci = categoryInfo(id); return `<span class="prof-cat">${ci.emoji} ${escapeHtml(ci.name)} ${n}</span>`; }).join("");
	// Son ilk keşifleri.
	const recent = firsts.filter((r) => r.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
	const recentHtml = recent.map((r) =>
		`<li><span>${r.emoji || "✨"}</span><span>${escapeHtml(r.name)}</span><span class="sub">${timeAgo(r.at, en)}</span></li>`).join("");
	$("#profile-body").innerHTML = `
		<div class="stats-row">
			<div class="stat"><b>${firsts.length}</b><span>${t("profileFirsts")}</span></div>
			<div class="stat"><b>${Object.keys(catCounts).length}</b><span>${t("profileCats")}</span></div>
		</div>
		<div class="prof-cats">${cats}</div>
		<h3>${t("profileRecent")}</h3>
		<ul class="item-list">${recentHtml}</ul>`;
	$("#modal-profile").hidden = false;
}

/* Liderlik / kategori / akıştaki oyuncu adına tıklayınca profili aç. */
$("#modal-book").addEventListener("click", (ev) => {
	const p = ev.target.closest("[data-profile]");
	if (p) openProfile(p.dataset.profile);
});

/* ---------- Koleksiyon tamamlanma kutlaması ---------- */

/* Yeni tamamlanan koleksiyonları (daha önce kutlanmamış) bulup kutlar. */
function checkCollections() {
	const claimed = DB.read("collectionsClaimed", []);
	let changed = false;
	COLLECTIONS.forEach((col) => {
		if (claimed.includes(col.id)) return;
		if (collectionProgress(col).done) {
			claimed.push(col.id);
			changed = true;
			const en = currentLang() === "en";
			setTimeout(() => {
				toast(`${col.emoji} ${en ? "Collection complete" : "Koleksiyon tamamlandı"}: ${col.name}!`, "gold", 5000);
				confetti();
				sfx("first");
			}, 1400);
		}
	});
	if (changed) DB.write("collectionsClaimed", claimed);
}

/* Dünya istatistik panosu: havuzun sunucu tarafı toplaması (/stats). Tüm
   tarifleri istemcide taramak yerine D1 toplar — havuz büyüse de hızlı kalır. */
async function renderWorldStats() {
	const box = $("#world-stats");
	const poolUrl = activePoolUrl();
	if (!poolUrl) { box.innerHTML = `<p class='muted'>${t("statsNeedPool")}</p>`; return; }
	box.innerHTML = `<p class='muted'>${t("loading")}</p>`;
	const en = currentLang() === "en";
	let s;
	try {
		const res = await fetch(poolUrl + "/stats?t=" + Date.now(), { cache: "no-store" });
		s = await res.json();
	} catch { box.innerHTML = `<p class='muted'>${t("statsFail")}</p>`; return; }

	// Yatay oranlı çubuk üreticisi (en yüksek değer = %100).
	const bars = (rows, label, value, max) => {
		if (!rows.length) return "";
		const top = Math.max(1, ...rows.map(value));
		return `<div class="stat-bars">` + rows.map((r) => {
			const pct = Math.round((value(r) / top) * 100);
			return `<div class="stat-bar-row"><span class="stat-bar-label">${label(r)}</span>`
				+ `<span class="stat-bar"><span class="stat-fill" style="width:${pct}%"></span></span>`
				+ `<span class="stat-bar-val">${value(r)}</span></div>`;
		}).join("") + `</div>`;
	};

	const cats = (s.categories || []).map((c) => {
		const info = categoryInfo(c.cat);
		return { ...c, lbl: `${info.emoji} ${escapeHtml(info.name)}` };
	});
	const growth = (s.growth || []).slice().reverse(); // eskiden yeniye
	const creative = s.topCreative || [];
	const latest = s.latest || [];

	box.innerHTML = `
		<div class="stats-row">
			<div class="stat"><b>${s.totalRecipes || 0}</b><span>${t("statPoolRecipes")}</span></div>
			<div class="stat"><b>${s.totalPlayers || 0}</b><span>${t("statPoolPlayers")}</span></div>
		</div>
		${cats.length ? `<h4 class="stat-h">${t("categorySpread")}</h4>` + bars(cats, (r) => r.lbl, (r) => r.count) : ""}
		${growth.length ? `<h4 class="stat-h">${t("poolGrowth")}</h4>` + bars(growth, (r) => escapeHtml(r.day.slice(5)), (r) => r.count) : ""}
		${creative.length ? `<h4 class="stat-h">${t("creativeLeaders")}</h4>`
			+ `<ol class="lb-list">` + creative.map((u, i) => {
				const rank = ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
				return `<li><span class="lb-rank">${rank}</span><span class="lb-name" data-profile="${escapeHtml(u.name)}">${escapeHtml(u.name)}</span><span class="lb-count">${u.creative} ✨</span></li>`;
			}).join("") + `</ol>` : ""}
		${latest.length ? `<h4 class="stat-h">${t("latestFinds")}</h4>`
			+ `<ul class="feed-list">` + latest.map((r) => `
				<li><span>${r.emoji || "✨"}</span>
				<span class="feed-text"><b data-profile="${escapeHtml(r.by || "")}">${escapeHtml(r.by || "?")}</b> ${en ? "discovered" : "keşfetti"} <b>${escapeHtml(r.name)}</b></span>
				<span class="feed-when">${timeAgo(r.at, en)}</span></li>`).join("") + `</ul>` : ""}
	`;
}

/* Liderlik tablosu: havuzdan en çok "dünya ilki" keşfe sahip oyuncular. */
async function renderLeaderboard() {
	const box = $("#leaderboard");
	const poolUrl = activePoolUrl();
	if (!poolUrl) { box.innerHTML = "<p class='muted'>Liderlik tablosu için havuz gerekli.</p>"; return; }
	box.innerHTML = "<p class='muted'>Yükleniyor…</p>";
	const me = getNickname();
	try {
		const res = await fetch(poolUrl + "/leaderboard?me=" + encodeURIComponent(me) + "&t=" + Date.now(), { cache: "no-store" });
		const data = await res.json();
		// "dünya ilki" istatistiğini havuzdaki kesin değerle güncelle.
		if (typeof data.you === "number" && $("#stat-firsts")) $("#stat-firsts").textContent = data.you;
		if (!data.top || !data.top.length) {
			box.innerHTML = "<p class='muted'>Henüz keşif yok — ilk sen ol!</p>";
		} else {
			const medals = ["🥇", "🥈", "🥉"];
			box.innerHTML = `<p class="muted">🌍 Dünyada ${data.totalRecipes} tarif · ${data.totalPlayers} kâşif</p>`
				+ '<ol class="lb-list">' + data.top.map((u, i) => {
					const mine = u.name === me ? " lb-me" : "";
					const rank = medals[i] || `${i + 1}.`;
					return `<li class="${mine.trim()}"><span class="lb-rank">${rank}</span><span class="lb-name" data-profile="${escapeHtml(u.name)}">${escapeHtml(u.name)}</span><span class="lb-count">${u.count} 🥇</span></li>`;
				}).join("") + "</ol>";
		}
	} catch {
		box.innerHTML = "<p class='muted'>Liderlik tablosu yüklenemedi.</p>";
	}
}

/* ---------- Element detayı: hikâye + soy ağacı ---------- */

function lineageSteps(name, seen = new Set(), out = []) {
	const e = getElement(name);
	if (!e || !e.fromPair || seen.has(norm(name)) || out.length >= 30) return out;
	seen.add(norm(name));
	out.push(e);
	lineageSteps(e.fromPair[0], seen, out);
	lineageSteps(e.fromPair[1], seen, out);
	return out;
}

function fmtEl(name) {
	const e = getElement(name);
	return e ? `${e.emoji} ${escapeHtml(e.name)}` : escapeHtml(name);
}

let detailName = "";

function renderDetailImage() {
	const box = $("#detail-image-box");
	const btn = $("#btn-gen-image");
	const img = Store.images[norm(detailName)];
	if (img) {
		box.innerHTML = `<img class="element-img" src="${img}" alt="${escapeHtml(detailName)}">`;
		btn.textContent = t("regenImage");
	} else {
		box.innerHTML = "";
		btn.textContent = t("genImage");
	}
}

/* Açıklamayı havuzdan tembel çek: /pack artık desc taşımıyor (hafif), bu yüzden
   yerelde açıklaması olmayan bir element detayı açılınca tek tarif için
   /recipe?key= çağrılır, sonuç yerele yazılır (bir daha çekilmez). Yan fayda:
   açıklaması hiç olmayan yerleşik (seed) elementler de havuzda varsa açıklama alır. */
async function loadDescLazy(e) {
	const poolUrl = activePoolUrl();
	if (!poolUrl || !e.fromPair) return;
	const key = pairKey(e.fromPair[0], e.fromPair[1]);
	try {
		const res = await fetch(poolUrl + "/recipe?key=" + encodeURIComponent(key));
		if (!res.ok) return;
		const r = await res.json();
		if (!r || !r.desc) return;
		const els = Store.elements;
		const k = norm(e.name);
		if (els[k] && !els[k].desc) { els[k].desc = r.desc; Store.elements = els; }
		if (detailName === e.name) {
			const descEl = $("#detail-desc");
			descEl.textContent = r.desc;
			descEl.hidden = false;
		}
	} catch { /* ağ yok — açıklama bir dahaki sefere gelir */ }
}

function openDetail(name) {
	const e = getElement(name);
	if (!e) return;
	detailName = e.name;
	$("#detail-title").textContent = `${e.emoji} ${e.name}`;
	$("#detail-desc").textContent = e.desc || "";
	$("#detail-desc").hidden = !e.desc;
	if (!e.desc) loadDescLazy(e);
	// Dünyada ilk keşfeden kişi + tarih (havuzdan).
	const firstEl = $("#detail-first");
	if (e.firstBy) {
		const fdate = e.firstAt
			? " · " + new Date(e.firstAt).toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
			: "";
		firstEl.textContent = `🥇 İlk bulan: ${e.firstBy}${fdate}`;
		firstEl.hidden = false;
	} else {
		firstEl.hidden = true;
	}
	const date = new Date(e.discoveredAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
	const depth = elementDepth(e.name);
	const cat = categoryInfo(elementCategory(e));
	$("#detail-meta").textContent =
		`${cat.emoji} ${cat.name} · ${date} tarihinde keşfedildi · derinlik: ${depth}` + (e.firstDiscovery ? " · 🏆 İlk Keşif" : "");
	const lin = $("#detail-lineage");
	lin.innerHTML = "";
	const steps = lineageSteps(e.name);
	if (!steps.length) {
		lin.innerHTML = "<li><span class='sub'>Bu bir başlangıç elementi — her şey onunla başladı.</span></li>";
	} else {
		steps.forEach((s) => {
			const li = document.createElement("li");
			li.dataset.name = s.name;
			li.innerHTML = `<span>${fmtEl(s.name)}</span><span class="sub">${fmtEl(s.fromPair[0])} + ${fmtEl(s.fromPair[1])}</span>`;
			lin.appendChild(li);
		});
	}
	renderDetailImage();
	$("#modal-detail").hidden = false;
}

/* İstek üzerine element görseli üret (kendi Gemini anahtarıyla), cihazda sakla. */
$("#btn-gen-image").addEventListener("click", async () => {
	if (!detailName) return;
	const e = getElement(detailName);
	if (!e) return;
	if (!Store.settings.geminiKey) { toast(t("genImageNeedsKey"), "error", 4500); return; }
	const btn = $("#btn-gen-image");
	btn.disabled = true;
	btn.textContent = t("genImageWait");
	try {
		const dataUrl = await generateElementImage(e);
		const imgs = Store.images;
		// Görseller büyüktür (base64); localStorage kotasını korumak için en
		// fazla son 24 görseli sakla (en eskiyi düşür). Aksi halde kota dolunca
		// oyun ilerlemesi yazımları da sessizce başarısız olabilirdi.
		const keys = Object.keys(imgs);
		if (keys.length >= 24 && !imgs[norm(detailName)]) delete imgs[keys[0]];
		imgs[norm(detailName)] = dataUrl;
		Store.images = imgs;
		renderDetailImage();
	} catch (err) {
		toast(err.message === "NO_KEY" ? t("genImageNeedsKey") : t("genImageFail"), "error", 4500);
		renderDetailImage();
	} finally {
		btn.disabled = false;
	}
});

$("#book-list").addEventListener("click", (ev) => {
	const li = ev.target.closest("li[data-name]");
	if (li) openDetail(li.dataset.name);
});
$("#detail-lineage").addEventListener("click", (ev) => {
	const li = ev.target.closest("li[data-name]");
	if (li) openDetail(li.dataset.name);
});

/* ---------- Ayarlar ---------- */

function syncProviderRows() {
	const p = $("#ai-provider").value;
	$("#gemini-key-row").hidden = p !== "gemini";
	$("#deepseek-key-row").hidden = p !== "deepseek";
	$("#claude-key-row").hidden = p !== "claude";
}

function updateKeyStatus() {
	$("#key-status").textContent = activeKey()
		? "Anahtar kayıtlı ✓ — sınırsız birleşim açık."
		: (activePoolUrl()
			? "Anahtar yok — sitenin ortak yapay zekâsı (havuz) üzerinden oynarsınız."
			: "Anahtar yok — yalnızca yerleşik tarifler çalışır.");
}

/* ---------- Üyelik ---------- */

function renderAccount() {
	const inEl = $("#account-loggedin"), outEl = $("#account-loggedout");
	if (isLoggedIn()) {
		inEl.hidden = false;
		outEl.hidden = true;
		$("#account-line").textContent = "👤 Giriş yapıldı: " + getAccount().username;
	} else {
		inEl.hidden = true;
		outEl.hidden = false;
	}
}

async function doAuth(kind) {
	const username = $("#auth-username").value.trim();
	const password = $("#auth-password").value;
	$("#auth-status").textContent = "İşleniyor…";
	try {
		const name = kind === "register"
			? await registerAccount(username, password)
			: await loginAccount(username, password);
		$("#auth-status").textContent = "";
		$("#auth-password").value = "";
		renderAccount();
		toast(`👤 Hoş geldin, ${name}!`);
		// İlerlemeyi buluttan yükle (başka cihazdaki keşifler gelsin), sonra
		// birleşmiş hâli geri kaydet. Sonucu dürüstçe göster.
		$("#auth-status").textContent = "İlerleme eşitleniyor…";
		const r = await syncProgress();
		renderChips();
		renderQuest();
		if (r.ok) {
			$("#auth-status").textContent = "";
			toast(`☁️ İlerleme eşitlendi (${Object.keys(Store.elements).length} element)`);
		} else {
			const err = (r.load.error || r.save.error || "bilinmeyen hata");
			$("#auth-status").textContent = "⚠️ Eşitlenemedi: " + err;
			toast("⚠️ Bulut eşitleme başarısız", "error", 4500);
		}
	} catch (err) {
		$("#auth-status").textContent = err.message;
	}
}

$("#btn-register").addEventListener("click", () => doAuth("register"));
$("#btn-login").addEventListener("click", () => doAuth("login"));
$("#btn-logout").addEventListener("click", () => {
	logoutAccount();
	renderAccount();
	toast("Çıkış yapıldı");
});

$("#btn-sync").addEventListener("click", async () => {
	$("#sync-status").textContent = "Eşitleniyor…";
	const r = await syncProgress();
	renderChips();
	renderQuest();
	if (r.ok) {
		$("#sync-status").textContent = `✓ Eşitlendi · ${Object.keys(Store.elements).length} element (yükleme: ${r.load.count ?? 0})`;
		toast("☁️ Eşitlendi");
	} else {
		$("#sync-status").textContent = "⚠️ " + (r.load.error || r.save.error || "hata");
	}
});

function openSettings(hint = "") {
	const s = Store.settings;
	renderAccount();
	$("#uid-line").textContent = "Cihaz kimliği: " + getUserId();
	$("#ai-provider").value = s.aiProvider || "gemini";
	if (s.apiKey) $("#api-key-input").value = s.apiKey;
	if (s.geminiKey) $("#gemini-key-input").value = s.geminiKey;
	if (s.deepseekKey) $("#deepseek-key-input").value = s.deepseekKey;
	if (s.poolUrl) $("#pool-url-input").value = s.poolUrl;
	$("#pool-status").textContent = activePoolUrl()
		? "🌐 Küresel havuz bağlı — tüm oyuncuların keşifleri ortak bellekte birikiyor; sizin bir şey yapmanız gerekmiyor."
		: "Havuz henüz kurulmadı. Site sahibi kurduğunda otomatik bağlanacaksınız — oyuncuların bir şey yapması gerekmez.";
	$("#sound-toggle").checked = s.sound !== false;
	$("#lang-select").value = currentLang();
	const mem = Store.memory;
	const learned = Object.keys(Store.recipes).length;
	const community = Object.keys(COMMUNITY_RECIPES).length;
	$("#memory-info").textContent =
		`Oyun belleği: ${mem.length} olay · ${learned} öğrenilmiş tarif · ${Object.keys(SEED_RECIPES).length} yerleşik · ${community} topluluk tarifi (paylaşılan).`;
	syncProviderRows();
	updateKeyStatus();
	$("#settings-hint").textContent = hint;
	$("#settings-hint").hidden = !hint;
	$("#modal-settings").hidden = false;
}

$("#sound-toggle").addEventListener("change", () => {
	Store.settings = { ...Store.settings, sound: $("#sound-toggle").checked };
	if ($("#sound-toggle").checked) sfx("discover");
});

/* Dil değişimi: kaydet, statik metinleri yeniden uygula, görünür alanları çiz. */
$("#lang-select").addEventListener("change", () => {
	Store.settings = { ...Store.settings, lang: $("#lang-select").value };
	applyStaticI18n();
	renderSlots();
	renderQuest();
	renderChips();
});

$("#btn-settings").addEventListener("click", () => openSettings());
$("#ai-provider").addEventListener("change", syncProviderRows);

$("#btn-save-key").addEventListener("click", () => {
	const oldPool = Store.settings.poolUrl || "";
	const newPool = $("#pool-url-input").value.trim();
	Store.settings = {
		...Store.settings,
		aiProvider: $("#ai-provider").value,
		apiKey: $("#api-key-input").value.trim(),
		geminiKey: $("#gemini-key-input").value.trim(),
		deepseekKey: $("#deepseek-key-input").value.trim(),
		poolUrl: newPool,
	};
	updateKeyStatus();
	toast(t("settingsSaved"));
	// Havuz adresi değiştiyse hemen indir ve hedef adaylarını tazele.
	if (newPool && newPool !== oldPool) {
		loadCommunityRecipes().then(() => {
			toast(`🌐 Havuz bağlandı: ${Object.keys(COMMUNITY_RECIPES).length} ortak tarif`);
			renderQuest();
		});
	}
});

function downloadBlob(content, filename, type) {
	const blob = new Blob([content], { type });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	a.click();
	URL.revokeObjectURL(a.href);
}

$("#btn-export").addEventListener("click", () => {
	downloadBlob(JSON.stringify(Store.exportAll(), null, 2), "element-simyasi-yedek.json", "application/json");
});

$("#btn-export-train").addEventListener("click", () => {
	downloadBlob(trainingDataJsonl(), "element-simyasi-egitim.jsonl", "application/jsonl");
	toast("🧠 Eğitim verisi indirildi");
});

/* Başka oyuncunun yedeğinden (dışa aktarılan JSON) tarif ve elementleri katar.
   Aynı ikili için yapay zekâya gerek kalmaz — paylaşılan keşif. */
$("#btn-import").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (ev) => {
	const file = ev.target.files[0];
	if (!file) return;
	try {
		const data = JSON.parse(await file.text());
		const incomingRecipes = data["simya.recipes"] || data.recipes || {};
		const incomingElements = data["simya.elements"] || data.elements || {};
		let addedR = 0, addedE = 0;
		const recipes = Store.recipes;
		for (const [k, v] of Object.entries(incomingRecipes)) {
			if (!recipes[k] && v && v.name) { recipes[k] = v; addedR++; }
		}
		Store.recipes = recipes;
		const els = Store.elements;
		for (const [k, v] of Object.entries(incomingElements)) {
			if (!els[k] && v && v.name) { els[k] = v; addedE++; }
		}
		Store.elements = els;
		const stats = Store.stats;
		stats.discoveries = Object.keys(els).length;
		Store.stats = stats;
		renderChips();
		toast(`📥 ${addedR} tarif, ${addedE} element aktarıldı`);
		openSettings();
	} catch {
		toast("Dosya okunamadı — geçerli bir yedek JSON seçin.", "error", 4000);
	}
	ev.target.value = "";
});

$("#btn-reset").addEventListener("click", () => {
	if (confirm("Tüm keşifler, tarifler ve ayarlar silinecek. Emin misiniz?")) {
		Store.resetAll();
		location.reload();
	}
});

/* ---------- Modal kapatma ---------- */

$$(".modal").forEach((m) => {
	m.addEventListener("click", (ev) => {
		if (ev.target === m || ev.target.classList.contains("modal-close")) m.hidden = true;
	});
});

/* ---------- Mobil: tuval/panel ayracı (sürükleyerek yeniden boyutlandırma) ----------
   Kullanıcı tutamağı yukarı/aşağı sürükleyerek panelin kapladığı alanı ayarlar;
   tercih kaydedilir. Yalnızca mobilde (≤920px) görünür. */

const vsplitEl = $("#vsplit");

// Kayıtlı oran varsa uygula (açılışta).
{
	const savedH = DB.read("wsHeight", null);
	if (savedH) document.documentElement.style.setProperty("--ws-h", savedH);
}

let splitDragging = false;

vsplitEl.addEventListener("pointerdown", (ev) => {
	splitDragging = true;
	vsplitEl.classList.add("dragging");
	try { vsplitEl.setPointerCapture(ev.pointerId); } catch { /* desteklenmiyor */ }
	ev.preventDefault();
});

vsplitEl.addEventListener("pointermove", (ev) => {
	if (!splitDragging) return;
	const g = $("#game").getBoundingClientRect();
	if (!g.height) return;
	// Tuval yüksekliği = parmağın oyun alanı içindeki dikey konumu (oran olarak).
	let pct = ((ev.clientY - g.top) / g.height) * 100;
	pct = Math.max(12, Math.min(78, pct)); // tuval %12–%78 arası kalsın
	document.documentElement.style.setProperty("--ws-h", pct.toFixed(1) + "%");
});

function endSplitDrag(ev) {
	if (!splitDragging) return;
	splitDragging = false;
	vsplitEl.classList.remove("dragging");
	try { vsplitEl.releasePointerCapture(ev.pointerId); } catch { /* yok say */ }
	DB.write("wsHeight", document.documentElement.style.getPropertyValue("--ws-h").trim());
}
vsplitEl.addEventListener("pointerup", endSplitDrag);
vsplitEl.addEventListener("pointercancel", endSplitDrag);

/* Sekme gizlenince / kapanırken bekleyen bulut kaydını hemen gönder (keepalive
   ile tamamlanır). Böylece çıkışta ilerleme kaybolmaz ama normal oyunda yazma
   sayısı düşük kalır (KV günlük limitini korur). */
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") flushSave();
});
window.addEventListener("pagehide", flushSave);

/* ---------- Başlangıç ---------- */

async function init() {
	applyStaticI18n();
	seedBaseElements();

	// Paylaşılan topluluk tariflerini (ve varsa küresel havuzu) indir;
	// hedef adayları buna bağlı olduğundan bitince hedef göstergesi tazelenir.
	loadCommunityRecipes().then(renderQuest);

	wsItems = Store.workspace;
	wsIdSeq = wsItems.reduce((m, i) => Math.max(m, parseInt(i.id.slice(1)) || 0), 0) + 1;
	// İlk açılışta 4 temel elementi tuvale serpiştir
	if (!wsItems.length && !DB.read("welcomed", false)) {
		DB.write("welcomed", true);
		setTimeout(() => {
			const r = workspaceEl.getBoundingClientRect();
			BASE_ELEMENTS.forEach((e, i) => {
				addWsItem(e.name, r.width / 2 - 120 + (i % 2) * 160, r.height / 2 - 60 + Math.floor(i / 2) * 70);
			});
		}, 50);
	}

	renderWorkspace();
	renderChips();
	renderSlots();

	// Giriş yapıldıysa açılışta bulut ilerlemesini çek ve birleştir; sonra
	// yerel ilerlemeyi de geri kaydet (iki yönlü senkron / ilk yükleme).
	if (isLoggedIn() && activePoolUrl()) {
		loadProgress().then((ok) => {
			if (ok) { renderChips(); renderQuest(); }
			saveProgressNow();
		});
	}

	// Havuzu periyodik tazele: ortak emojiler/sayaçlar diğer oyuncularla
	// yakınsasın (KV birkaç saniye gecikmeli yayıldığı için tam anlık değil).
	if (activePoolUrl()) {
		setInterval(() => {
			loadCommunityRecipes().then(() => {
				// Yalnızca bir şey değiştiyse yeniden çiz (gereksiz DOM yükü olmasın).
				if (lastPoolChanged) renderChips();
				if (!$("#modal-book").hidden) renderLeaderboard();
			});
		}, 60000);
	}

	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.register("sw.js").catch(() => { /* çevrimdışı desteği isteğe bağlı */ });
	}
}

init();
