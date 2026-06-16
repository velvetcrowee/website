/* ─── Yardımcılar ─── */
const $ = (id) => document.getElementById(id);
const $el = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };

const RING_CIRC = 2 * Math.PI * 85; // ≈ 533.8

function formatMMSS(ms) {
	if (ms < 0) ms = 0;
	const totalSec = Math.round(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatHHMM(ms) {
	if (ms <= 0) return "az sonra";
	const totalMin = Math.ceil(ms / 60000);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (h > 0) return `${h} sa ${m} dk`;
	return `${m} dk`;
}

function formatSaat(ts) {
	return new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

let _toastTimer = null;
function toast(msg, ms = 2800) {
	const el = $("toast");
	el.textContent = msg;
	el.hidden = false;
	clearTimeout(_toastTimer);
	_toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ─── Tab geçişi ─── */
function switchTab(tabId) {
	document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
	document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
	$(tabId).classList.add("active");
	document.querySelector(`.nav-btn[data-tab="${tabId}"]`)?.classList.add("active");
	if (tabId === "tab-gecmis") renderHistory();
	if (tabId === "tab-ayarlar") {
		$("duration-input").value = Store.settings.durationMinutes;
	}
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
	btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

/* ─── Kurulum ekranı ─── */
function renderPairNameInputs() {
	const startPos = parseInt($("start-pos").value) || 4;
	const endPos = parseInt($("end-pos").value) || 11;
	if (startPos >= endPos) return;

	const pairs = derivePairs(startPos, endPos);
	const container = $("pair-names");
	container.innerHTML = "";

	pairs.forEach((pair, i) => {
		const isWatched = i === pairs.length - 1;
		const group = $el("div", "pair-input-group");

		const label = $el("div", "pair-input-label");
		label.textContent = `Pozisyon ${pair.positions[0]} & ${pair.positions[1]}`;
		if (isWatched) {
			const tag = $el("span", "watched-tag");
			tag.textContent = "Son sıra";
			label.appendChild(tag);
		}

		const row = $el("div", "pair-name-row");
		[0, 1].forEach((ni) => {
			const inp = $el("input");
			inp.type = "text";
			inp.placeholder = `${pair.positions[ni]}. pozisyon`;
			inp.dataset.pairIdx = i;
			inp.dataset.nameIdx = ni;
			row.appendChild(inp);
		});

		group.appendChild(label);
		group.appendChild(row);
		container.appendChild(group);
	});
}

$("start-pos").addEventListener("input", renderPairNameInputs);
$("end-pos").addEventListener("input", renderPairNameInputs);

$("btn-start").addEventListener("click", () => {
	const startPos = parseInt($("start-pos").value);
	const endPos = parseInt($("end-pos").value);
	const errEl = $("setup-error");
	errEl.hidden = true;

	if (!startPos || !endPos || startPos >= endPos) {
		errEl.textContent = "Geçerli bir pozisyon aralığı girin.";
		errEl.hidden = false;
		return;
	}
	if ((endPos - startPos + 1) % 2 !== 0) {
		errEl.textContent = "Pozisyon sayısı çift olmalıdır (örn. 4–11 = 8 makine).";
		errEl.hidden = false;
		return;
	}

	const pairs = derivePairs(startPos, endPos);

	document.querySelectorAll("#pair-names input").forEach((inp) => {
		const pi = parseInt(inp.dataset.pairIdx);
		const ni = parseInt(inp.dataset.nameIdx);
		pairs[pi].names[ni] = inp.value.trim() || `Poz.${pairs[pi].positions[ni]}`;
	});

	const settings = Store.settings;
	Store.config = { startPos, endPos, pairs };
	Store.session = {
		active: true,
		cycleNumber: 1,
		currentPairIndex: 0,
		pairStartedAt: Date.now(),
		durationMs: settings.durationMinutes * 60000,
		machinesGone: [],
	};

	$("setup-overlay").hidden = true;
	$("app").hidden = false;
	renderAll();
	startTick();
	requestNotifyPermission();
});

/* ─── Ekranı tam render et ─── */
function renderAll() {
	const config = Store.config;
	const session = Store.session;
	if (!config || !session) return;

	$("header-cycle").textContent = `Döngü ${session.cycleNumber}`;
	renderTimerCard(session, config);
	renderQueue(session, config);
	renderMachineGrid(session, config);
	renderEta(session, config);
}

/* ─── Timer kartı ─── */
function renderTimerCard(session, config) {
	const remaining = Math.max(0, session.durationMs - (Date.now() - session.pairStartedAt));
	updateTimerDisplay(remaining, session.durationMs);

	const pair = config.pairs[session.currentPairIndex];
	$("current-pair-info").innerHTML = `
		<div class="current-pair-names">${pair.names.join(" & ")}
			<span class="cycle-badge">Döngü ${session.cycleNumber}</span>
		</div>
		<div class="current-pair-pos">Pozisyon ${pair.positions[0]} & ${pair.positions[1]}</div>
	`;
}

function updateTimerDisplay(remainingMs, durationMs) {
	const fraction = durationMs > 0 ? remainingMs / durationMs : 0;
	const offset = RING_CIRC * (1 - fraction);
	$("timer-ring").style.strokeDashoffset = offset;
	$("timer-display").textContent = formatMMSS(remainingMs);
}

/* ─── Sıra listesi ─── */
function renderQueue(session, config) {
	const n = config.pairs.length;
	const curIdx = session.currentPairIndex;
	const watchedIdx = n - 1;
	const durationMs = session.durationMs;
	const remaining = Math.max(0, durationMs - (Date.now() - session.pairStartedAt));

	const container = $("queue-list");
	container.innerHTML = "";

	let cumulativeMs = remaining;
	let idx = (curIdx + 1) % n;
	let shown = 0;

	while (shown < n - 1) {
		const pair = config.pairs[idx];
		const isWatched = idx === watchedIdx;
		const isGone = pair.positions.every((pos) => session.machinesGone.includes(pos));

		const row = $el("div", `pair-row${isWatched ? " watched" : ""}${isGone ? " gone" : ""}`);

		const posEl = $el("div", "pair-pos");
		posEl.textContent = pair.positions.join(" & ");

		const nameEl = $el("div", "pair-names");
		nameEl.textContent = pair.names.join(" & ");

		const etaEl = $el("div", "pair-eta");
		if (isGone) {
			etaEl.textContent = "✓ Yüklemeye geçti";
		} else {
			etaEl.textContent = `~${formatHHMM(cumulativeMs)}`;
			cumulativeMs += durationMs;
		}

		row.appendChild(posEl);
		row.appendChild(nameEl);
		row.appendChild(etaEl);
		container.appendChild(row);

		idx = (idx + 1) % n;
		shown++;
	}

	if (container.children.length === 0) {
		const p = $el("p", "muted");
		p.style.cssText = "text-align:center;padding:8px";
		p.textContent = "Bu döngüde başka çift kalmadı.";
		container.appendChild(p);
	}
}

/* ─── ETA chip ─── */
function renderEta(session, config) {
	const chip = $("eta-chip");
	const watchedIdx = config.pairs.length - 1;

	if (session.currentPairIndex === watchedIdx) {
		chip.hidden = true;
		return;
	}

	const eta = etaForWatchedPair(session, config, Date.now());
	if (eta === -1) {
		chip.hidden = true;
		return;
	}

	const watchedPair = config.pairs[watchedIdx];
	chip.hidden = false;
	chip.innerHTML = `
		<div class="eta-icon">⏳</div>
		<div class="eta-text">
			<div class="eta-title">${watchedPair.names.join(" & ")} (poz. ${watchedPair.positions.join(" & ")})</div>
			<div class="eta-value">${eta === 0 ? "Şu an çalışıyorlar" : "~" + formatHHMM(eta) + " sonra sıraları"}</div>
		</div>
	`;
}

/* ─── Makine grid ─── */
function renderMachineGrid(session, config) {
	const container = $("machine-grid");
	container.innerHTML = "";
	const curPair = config.pairs[session.currentPairIndex];

	config.pairs.forEach((pair) => {
		pair.positions.forEach((pos) => {
			const isCurrent = curPair.positions.includes(pos);
			const isGone = session.machinesGone.includes(pos);
			const chip = $el("button", `machine-chip${isCurrent ? " current-machine" : ""}${isGone ? " gone" : ""}`);
			chip.textContent = pos;
			chip.title = `Pozisyon ${pos}${isGone ? " — yüklemeye geçti" : ""}`;
			chip.addEventListener("click", () => toggleMachineGone(pos));
			container.appendChild(chip);
		});
	});
}

function toggleMachineGone(pos) {
	const session = { ...Store.session };
	const machinesGone = [...session.machinesGone];
	const idx = machinesGone.indexOf(pos);
	if (idx === -1) {
		machinesGone.push(pos);
		toast(`Poz. ${pos} yüklemeye geçti ✓`);
	} else {
		machinesGone.splice(idx, 1);
		toast(`Poz. ${pos} geri alındı`);
	}
	session.machinesGone = machinesGone;
	Store.session = session;
	renderAll();
}

/* ─── Sıradaki aktif çifti bul ─── */
function nextActivePairIndex(session, config) {
	const n = config.pairs.length;
	const allGone = config.pairs.every((pair) =>
		pair.positions.every((pos) => session.machinesGone.includes(pos))
	);
	if (allGone) return -1;

	let idx = (session.currentPairIndex + 1) % n;
	for (let i = 0; i < n; i++) {
		const pair = config.pairs[idx];
		const gone = pair.positions.every((pos) => session.machinesGone.includes(pos));
		if (!gone) return idx;
		idx = (idx + 1) % n;
	}
	return -1;
}

/* ─── Timer motoru ─── */
let _tickInterval = null;
let _notifiedThisTurn = false;

function startTick() {
	clearInterval(_tickInterval);
	_notifiedThisTurn = false;
	_tickInterval = setInterval(tick, 500);
}

function tick() {
	const session = Store.session;
	if (!session || !session.active) return;

	const now = Date.now();
	const remaining = session.durationMs - (now - session.pairStartedAt);
	updateTimerDisplay(Math.max(0, remaining), session.durationMs);

	const config = Store.config;
	if (config) {
		renderEta(session, config);

		// 3 dk kala bildirim (sıradaki aktif çift izlenen çiftse)
		if (!_notifiedThisTurn && remaining > 0 && remaining <= 3 * 60000) {
			const nextIdx = nextActivePairIndex(session, config);
			if (nextIdx === config.pairs.length - 1) {
				_notifiedThisTurn = true;
				const wp = config.pairs[nextIdx];
				maybeNotify(`${wp.names.join(" & ")} — 3 dakika sonra sıranız!`);
			}
		}
	}

	if (remaining <= 0) advancePair("timer");
}

/* ─── Çift geçişi ─── */
function advancePair(reason) {
	const session = { ...Store.session };
	const config = Store.config;
	if (!session || !session.active || !config) return;

	const now = Date.now();
	const pair = config.pairs[session.currentPairIndex];

	const log = Store.log;
	log.push({
		id: Math.random().toString(36).slice(2),
		cycle: session.cycleNumber,
		pairIndex: session.currentPairIndex,
		positions: [...pair.positions],
		names: [...pair.names],
		startedAt: session.pairStartedAt,
		endedAt: now,
		durationMs: now - session.pairStartedAt,
		reason,
	});
	Store.log = log;

	const nextIdx = nextActivePairIndex(session, config);

	if (nextIdx === -1) {
		session.active = false;
		Store.session = session;
		clearInterval(_tickInterval);
		$("app").hidden = true;
		$("done-overlay").hidden = false;
		return;
	}

	// Yeni döngü kontrolü: nextIdx wrap yaptıysa
	if (nextIdx <= session.currentPairIndex) {
		session.cycleNumber++;
		toast(`🔄 Döngü ${session.cycleNumber} başladı`);
	}

	session.currentPairIndex = nextIdx;
	session.pairStartedAt = now;
	Store.session = session;

	_notifiedThisTurn = false;
	renderAll();
}

/* ─── Bildirim ─── */
function requestNotifyPermission() {
	if ("Notification" in window && Notification.permission === "default") {
		Notification.requestPermission();
	}
}

function maybeNotify(msg) {
	if (Store.settings.vibrate && "vibrate" in navigator) {
		navigator.vibrate([200, 100, 200]);
	}
	if ("Notification" in window && Notification.permission === "granted") {
		new Notification("⚓ Liman Rotasyon", { body: msg, icon: "icons/icon-192.png" });
	}
	toast("⚓ " + msg, 4000);
}

/* ─── Geçmiş ─── */
function renderHistory() {
	const log = Store.log;
	const container = $("history-list");
	const noHist = $("no-history");
	container.innerHTML = "";

	if (log.length === 0) {
		noHist.hidden = false;
		return;
	}
	noHist.hidden = true;

	[...log].reverse().forEach((entry) => {
		const dur = Math.round(entry.durationMs / 60000);
		const item = $el("div", "history-item");
		item.innerHTML = `
			<div class="history-head">
				<div class="history-names">${entry.names.join(" & ")}</div>
				<div class="history-dur">${dur} dk</div>
			</div>
			<div class="history-meta">
				Poz. ${entry.positions.join(" & ")} &middot; Döngü ${entry.cycle} &middot; ${formatSaat(entry.startedAt)} – ${formatSaat(entry.endedAt)}
			</div>
		`;
		container.appendChild(item);
	});
}

/* ─── Buton event'leri ─── */
$("btn-advance").addEventListener("click", () => {
	advancePair("manual");
});

$("btn-save-settings").addEventListener("click", () => {
	const minutes = parseInt($("duration-input").value);
	if (!minutes || minutes < 1 || minutes > 120) {
		toast("1–120 dakika arası bir değer girin");
		return;
	}
	const settings = Store.settings;
	settings.durationMinutes = minutes;
	Store.settings = settings;

	const session = Store.session;
	if (session && session.active) {
		session.durationMs = minutes * 60000;
		Store.session = session;
	}
	toast("Ayarlar kaydedildi ✓");
});

$("btn-new-session").addEventListener("click", () => {
	if (!confirm("Yeni oturum başlatılacak. Mevcut oturum sona erer. Devam?")) return;
	clearInterval(_tickInterval);
	Store.session = null;
	$("app").hidden = true;
	$("setup-overlay").hidden = false;
	renderPairNameInputs();
});

$("btn-reset-all").addEventListener("click", () => {
	if (!confirm("Tüm kayıtlar silinecek. Bu işlem geri alınamaz. Emin misiniz?")) return;
	clearInterval(_tickInterval);
	Store.resetAll();
	$("app").hidden = true;
	$("done-overlay").hidden = true;
	$("setup-overlay").hidden = false;
	renderPairNameInputs();
});

$("btn-done-new").addEventListener("click", () => {
	$("done-overlay").hidden = true;
	$("setup-overlay").hidden = false;
	$("app").hidden = true;
	renderPairNameInputs();
});

/* ─── Başlangıç ─── */
function init() {
	renderPairNameInputs();

	const config = Store.config;
	const session = Store.session;

	if (config && session && session.active) {
		$("setup-overlay").hidden = true;
		$("app").hidden = false;
		$("duration-input").value = Store.settings.durationMinutes;
		renderAll();
		startTick();
	}
}

if ("serviceWorker" in navigator) {
	navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
