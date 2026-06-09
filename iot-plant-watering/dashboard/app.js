// ============================================================================
//  Bitki paneli - internet uzerinden ESP32 ile haberlesir (MQTT/WebSocket)
//  Bu dosya tarayicida calisir; GitHub Pages gibi bir yere koyup her yerden
//  acabilirsin. ESP32 ile ayni broker ve ayni DEVICE_ID kullanir.
// ============================================================================

// !!! ESP32'deki config.h ile AYNI olmali !!!
const DEVICE_ID = "velvet-plant-DEGISTIR-beni";

// HiveMQ public broker - WebSocket Secure (wss) ucu
const BROKER = "wss://broker.hivemq.com:8884/mqtt";

const T_TELEMETRY = `plant/${DEVICE_ID}/telemetry`;
const T_COMMAND   = `plant/${DEVICE_ID}/cmd`;

const $ = (id) => document.getElementById(id);
$("curId").textContent = DEVICE_ID;

const conn = $("conn");
let client;

function connect() {
  client = mqtt.connect(BROKER, {
    clientId: "web-" + Math.random().toString(16).slice(2),
    reconnectPeriod: 3000,
    connectTimeout: 8000,
  });

  client.on("connect", () => {
    conn.textContent = "bağlı";
    conn.className = "badge on";
    client.subscribe(T_TELEMETRY);
  });

  client.on("reconnect", () => {
    conn.textContent = "yeniden bağlanıyor…";
    conn.className = "badge off";
  });

  client.on("error", (e) => {
    conn.textContent = "bağlantı hatası";
    conn.className = "badge off";
    console.error(e);
  });

  client.on("message", (topic, payload) => {
    if (topic !== T_TELEMETRY) return;
    try { render(JSON.parse(payload.toString())); }
    catch (e) { console.warn("bozuk veri", e); }
  });
}

function send(cmd) {
  if (!client || !client.connected) {
    alert("Panel henüz bağlı değil, birkaç saniye bekle.");
    return;
  }
  client.publish(T_COMMAND, cmd);
}

function render(d) {
  // Toprak
  const soil = d.soilPct ?? 0;
  $("soilPct").textContent = soil;
  $("soilBar").style.width = soil + "%";
  $("soilBar").className = "fill " + (soil < 35 ? "low" : soil < 60 ? "mid" : "ok");

  const hint = $("soilHint");
  if (d.soilValid === false) {
    hint.textContent = "⚠️ Sensör verisi şüpheli (kablo/konum?) — bkz. README";
    hint.className = "hint warn";
  } else {
    hint.textContent = soil < 35 ? "Toprak kuru" : soil < 60 ? "İdeal" : "Nemli";
    hint.className = "hint";
  }

  $("temp").textContent   = d.temp   ?? "–";
  $("humAir").textContent = d.humAir ?? "–";
  $("light").textContent  = d.lightPct ?? "–";
  $("pump").textContent   = d.pump ? "AÇIK 💦" : "kapalı";

  $("autoToggle").checked = !!d.auto;
  $("updated").textContent = new Date().toLocaleTimeString("tr-TR");
}

// Butonlar
$("btnWater").onclick   = () => send("water");
$("btnWater10").onclick = () => send("water:10");
$("btnStop").onclick    = () => send("stop");
$("autoToggle").onchange = (e) => send(e.target.checked ? "auto:on" : "auto:off");

connect();
