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
	setTimeout(() => el.remove(), ms);
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

function announceResult(res) {
	if (!res.discovered) return;
	if (res.isNew) {
		toast(`🏆 İlk Keşif: ${res.emoji} ${res.name}`, "gold", 4500);
		confetti();
	} else {
		toast(`🎉 Yeni keşif: ${res.emoji} ${res.name}`);
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
	toast(err.message, "error", 4000);
}

/* ---------- Panel (keşfedilen elementler) ---------- */

function renderCount() {
	const n = Object.keys(Store.elements).length;
	$("#element-count").textContent = `${n} element`;
}

function renderChips() {
	const q = norm($("#search").value || "");
	chipListEl.innerHTML = "";
	elementList()
		.filter((e) => !q || norm(e.name).includes(q))
		.forEach((e) => {
			const chip = document.createElement("button");
			chip.className = "chip" + (freshNames.has(norm(e.name)) ? " fresh" : "");
			chip.dataset.name = e.name;
			chip.innerHTML = `<span>${e.emoji}</span><span>${escapeHtml(e.name)}</span>`;
			chipListEl.appendChild(chip);
		});
	renderCount();
}

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
	workspaceEl.innerHTML = "";
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

/* ---------- Sürükle-bırak (Pointer Events) ---------- */

const drag = { active: false };

document.addEventListener("pointerdown", (ev) => {
	const chip = ev.target.closest(".chip");
	const wsItem = ev.target.closest(".ws-item");
	if (!chip && !wsItem) return;
	ev.preventDefault();
	drag.active = true;
	drag.moved = false;
	drag.startX = ev.clientX;
	drag.startY = ev.clientY;

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

document.addEventListener("pointermove", (ev) => {
	if (!drag.active) return;
	if (Math.abs(ev.clientX - drag.startX) + Math.abs(ev.clientY - drag.startY) > 6) drag.moved = true;
	if (!drag.moved) return;

	if (drag.type === "chip") {
		if (!drag.ghost) {
			drag.ghost = drag.src.cloneNode(true);
			drag.ghost.classList.add("drag-ghost");
			document.body.appendChild(drag.ghost);
		}
		drag.ghost.style.left = ev.clientX - 30 + "px";
		drag.ghost.style.top = ev.clientY - 18 + "px";
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
});

document.addEventListener("pointerup", (ev) => {
	if (!drag.active) return;
	const d = { ...drag };
	drag.active = false;
	panelEl.classList.remove("trash-hint");

	if (d.type === "chip") {
		d.ghost?.remove();
		if (d.moved) {
			// Tuvale bırakıldıysa örnek oluştur
			const wr = workspaceEl.getBoundingClientRect();
			if (ev.clientX >= wr.left && ev.clientX <= wr.right && ev.clientY >= wr.top && ev.clientY <= wr.bottom) {
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

/* ---------- Chip dokunuşu: mobilde birleştirme çubuğu, masaüstünde tuvale ekle ---------- */

const slots = { a: "", b: "" };

function chipTapped(name) {
	const combinerVisible = getComputedStyle($("#combiner")).display !== "none";
	if (!combinerVisible) {
		const r = workspaceEl.getBoundingClientRect();
		addWsItem(name, r.width / 2 - 40 + (Math.random() - 0.5) * 120, r.height / 2 - 18 + (Math.random() - 0.5) * 80, true);
		return;
	}
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
	return e ? `${e.emoji} ${e.name}` : "＋ Seç";
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

$("#search").addEventListener("input", renderChips);

/* ---------- Başlık butonları ---------- */

$("#btn-clear").addEventListener("click", () => {
	wsItems = [];
	Store.workspace = [];
	renderWorkspace();
});

/* ---------- Keşif Defteri ---------- */

$("#btn-book").addEventListener("click", () => {
	const stats = Store.stats;
	$("#book-stats").innerHTML = `
		<div class="stat"><b>${stats.discoveries}</b><span>element</span></div>
		<div class="stat"><b>${stats.combos}</b><span>birleştirme</span></div>
		<div class="stat"><b>${stats.aiCalls}</b><span>yapay zekâ</span></div>`;
	const list = $("#book-list");
	list.innerHTML = "";
	elementList().forEach((e) => {
		const li = document.createElement("li");
		const date = new Date(e.discoveredAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
		const from = e.fromPair ? `${e.fromPair[0]} + ${e.fromPair[1]}` : "başlangıç";
		li.innerHTML = `<span>${e.emoji}</span><span>${escapeHtml(e.name)}${e.firstDiscovery ? " 🏆" : ""}</span>
			<span class="sub">${escapeHtml(from)} — ${date}</span>`;
		list.appendChild(li);
	});
	$("#modal-book").hidden = false;
});

/* ---------- Ayarlar ---------- */

function syncProviderRows() {
	const p = $("#ai-provider").value;
	$("#gemini-key-row").hidden = p !== "gemini";
	$("#claude-key-row").hidden = p !== "claude";
}

function updateKeyStatus() {
	$("#key-status").textContent = activeKey()
		? "Anahtar kayıtlı ✓ — sınırsız birleşim açık."
		: "Anahtar yok — yalnızca yerleşik tarifler çalışır.";
}

function openSettings(hint = "") {
	const s = Store.settings;
	$("#ai-provider").value = s.aiProvider || "gemini";
	if (s.apiKey) $("#api-key-input").value = s.apiKey;
	if (s.geminiKey) $("#gemini-key-input").value = s.geminiKey;
	syncProviderRows();
	updateKeyStatus();
	$("#settings-hint").textContent = hint;
	$("#settings-hint").hidden = !hint;
	$("#modal-settings").hidden = false;
}

$("#btn-settings").addEventListener("click", () => openSettings());
$("#ai-provider").addEventListener("change", syncProviderRows);

$("#btn-save-key").addEventListener("click", () => {
	Store.settings = {
		...Store.settings,
		aiProvider: $("#ai-provider").value,
		apiKey: $("#api-key-input").value.trim(),
		geminiKey: $("#gemini-key-input").value.trim(),
	};
	updateKeyStatus();
	toast("Ayarlar kaydedildi ✓");
});

$("#btn-export").addEventListener("click", () => {
	const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: "application/json" });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = "element-simyasi-yedek.json";
	a.click();
	URL.revokeObjectURL(a.href);
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

/* ---------- Başlangıç ---------- */

function init() {
	seedBaseElements();

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

	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.register("sw.js").catch(() => { /* çevrimdışı desteği isteğe bağlı */ });
	}
}

init();
