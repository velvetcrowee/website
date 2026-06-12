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
	toast(err.message, "error", 4000);
}

/* ---------- Panel (keşfedilen elementler) ---------- */

function renderCount() {
	const n = Object.keys(Store.elements).length;
	$("#element-count").textContent = `${n} element`;
}

/* Aktif kategori filtresi ("" = tümü). */
let activeCat = "";

function renderCatFilter() {
	const counts = {};
	elementList().forEach((e) => {
		const c = elementCategory(e);
		counts[c] = (counts[c] || 0) + 1;
	});
	const bar = $("#cat-filter");
	bar.innerHTML = "";
	const mk = (id, label) => {
		const b = document.createElement("button");
		b.className = "cat-chip" + ((activeCat === id) ? " active" : "");
		b.dataset.cat = id;
		b.textContent = label;
		bar.appendChild(b);
	};
	mk("", `Tümü ${Object.keys(Store.elements).length}`);
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

function renderChips() {
	const q = norm($("#search").value || "");
	chipListEl.innerHTML = "";
	elementList()
		.filter((e) => !q || norm(e.name).includes(q))
		.filter((e) => !activeCat || elementCategory(e) === activeCat)
		.forEach((e) => {
			const chip = document.createElement("button");
			chip.className = "chip" + (freshNames.has(norm(e.name)) ? " fresh" : "");
			chip.dataset.name = e.name;
			chip.innerHTML = `<span>${e.emoji}</span><span>${escapeHtml(e.name)}</span>`;
			chipListEl.appendChild(chip);
		});
	renderCount();
	renderCatFilter();
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

/* ---------- Hedef göstergesi ---------- */

function renderQuest() {
	const q = currentQuest();
	const bar = $("#quest-bar");
	if (!q) { bar.hidden = true; return; }
	const cat = categoryInfo(CATEGORY_MAP[norm(q.name)] || "diger");
	$("#quest-text").textContent = `🎯 Hedef: ${q.emoji} ${q.name} (${cat.emoji} ${cat.name})`;
	bar.hidden = false;
}

$("#quest-skip").addEventListener("click", () => {
	DB.write("quest", pickQuest());
	renderQuest();
	toast("🎯 Yeni hedef belirlendi");
});

/* ---------- Başlık butonları ---------- */

$("#btn-clear").addEventListener("click", () => {
	wsItems = [];
	Store.workspace = [];
	renderWorkspace();
});

/* ---------- Keşif Defteri ---------- */

$("#btn-book").addEventListener("click", () => {
	const stats = Store.stats;
	const maxDepth = elementList().reduce((m, e) => Math.max(m, elementDepth(e.name)), 0);
	$("#book-stats").innerHTML = `
		<div class="stat"><b>${stats.discoveries}</b><span>element</span></div>
		<div class="stat"><b>${stats.combos}</b><span>birleştirme</span></div>
		<div class="stat"><b>${stats.aiCalls}</b><span>yapay zekâ</span></div>
		<div class="stat"><b>${maxDepth}</b><span>en derin zincir</span></div>`;

	const earned = Store.badges;
	$("#badge-grid").innerHTML = BADGES.map((b) => `
		<div class="badge-card ${earned[b.id] ? "earned" : "locked"}">
			<span class="b-emoji">${b.emoji}</span>
			<span class="b-name">${b.name}</span>
			<span class="b-goal">${b.goal}</span>
		</div>`).join("");

	const list = $("#book-list");
	list.innerHTML = "";
	elementList().forEach((e) => {
		const li = document.createElement("li");
		li.dataset.name = e.name;
		const date = new Date(e.discoveredAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
		const from = e.fromPair ? `${e.fromPair[0]} + ${e.fromPair[1]}` : "başlangıç";
		li.innerHTML = `<span>${e.emoji}</span><span>${escapeHtml(e.name)}${e.firstDiscovery ? " 🏆" : ""}</span>
			<span class="sub">${escapeHtml(from)} — ${date}</span>`;
		list.appendChild(li);
	});
	$("#modal-book").hidden = false;
});

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

function openDetail(name) {
	const e = getElement(name);
	if (!e) return;
	$("#detail-title").textContent = `${e.emoji} ${e.name}`;
	$("#detail-desc").textContent = e.desc || "";
	$("#detail-desc").hidden = !e.desc;
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
	$("#modal-detail").hidden = false;
}

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
	if (s.poolUrl) $("#pool-url-input").value = s.poolUrl;
	$("#sound-toggle").checked = s.sound !== false;
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
		poolUrl: newPool,
	};
	updateKeyStatus();
	toast("Ayarlar kaydedildi ✓");
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

/* ---------- Başlangıç ---------- */

async function init() {
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

	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.register("sw.js").catch(() => { /* çevrimdışı desteği isteğe bağlı */ });
	}
}

init();
