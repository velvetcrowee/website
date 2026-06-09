// ============================================================================
//  Akilli Bitki Sulama Sistemi  -  ESP32 Firmware
//  -------------------------------------------------------------------------
//  Donanim:
//    * ESP32 DevKit
//    * 4 kanalli role modulu (sizin "4'lu enerji kesici")
//    * 5V mini su pompasi  (role uzerinden, AYRI 5V besleme ile)
//    * DHT22  -> sicaklik + hava nemi
//    * LDR isik sensoru modulu (analog cikis)
//    * Kapasitif toprak nem sensoru (analog cikis)
//
//  Ozellikler:
//    * Toprak kuruyunca OTOMATIK sular (guvenlik sure limitli)
//    * Sensor verilerini MQTT ile internete yayinlar -> her yerden goruntule
//    * "Simdi sula" komutunu MQTT'den dinler -> istedigin an manuel sula
//    * LAN'da basit web sayfasi (http://<esp-ip>/) ile de calisir
//
//  Kutuphaneler (Arduino IDE -> Library Manager):
//    - "DHT sensor library" (Adafruit)  + "Adafruit Unified Sensor"
//    - "PubSubClient" (Nick O'Leary)
//  Kart: "ESP32 Dev Module"
// ============================================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <DHT.h>
#include "config.h"   // <-- config.example.h'i kopyalayip olustur

// -------------------- PIN HARITASI --------------------
// (Sema icin docs/wiring.md dosyasina bak)
#define PIN_DHT        4    // DHT22 DATA
#define PIN_SOIL      34    // Toprak nem AO (ADC1 - sadece giris)
#define PIN_LIGHT     35    // LDR modulu AO (ADC1 - sadece giris)
#define PIN_RELAY_PUMP 26   // Role IN1 -> su pompasi
#define PIN_RELAY_2   25    // Role IN2 -> bos (orn. bitki lambasi)
#define PIN_RELAY_3   33    // Role IN3 -> bos
#define PIN_RELAY_4   32    // Role IN4 -> bos

// Cogu mavi role modulu AKTIF-LOW'dur: IN=LOW iken role ceker (pompa calisir).
// Eger seninki ters calisirsa bu satiri 0 yap.
#define RELAY_ACTIVE_LOW 1

#define DHTTYPE DHT22

// -------------------- GLOBAL --------------------
DHT dht(PIN_DHT, DHTTYPE);
WebServer http(80);

#if MQTT_USE_TLS
  WiFiClientSecure net;
#else
  WiFiClient net;
#endif
PubSubClient mqtt(net);

// MQTT konulari (DEVICE_ID ile benzersizlestiriliyor)
String topicTelemetry;   // cihaz -> bulut (sensor verileri)
String topicCommand;     // bulut -> cihaz (komutlar)
String topicState;       // cihaz -> bulut (mod/durum)

// Durum
struct {
  float tempC   = NAN;
  float humAir  = NAN;
  int   soilRaw = 0;
  int   soilPct = 0;
  int   lightRaw = 0;
  int   lightPct = 0;
  bool  pumpOn  = false;
  bool  autoMode = AUTO_MODE_DEFAULT;
  bool  soilValid = true;       // sensor saglik kontrolu
  unsigned long lastWaterMs = 0;
  unsigned long pumpStopAtMs = 0;
} S;

unsigned long lastSensorMs = 0;
unsigned long lastPublishMs = 0;

// ============================================================================
//  ROLE YARDIMCILARI
// ============================================================================
void relayWrite(int pin, bool on) {
#if RELAY_ACTIVE_LOW
  digitalWrite(pin, on ? LOW : HIGH);
#else
  digitalWrite(pin, on ? HIGH : LOW);
#endif
}

void pumpOn(int seconds) {
  if (seconds <= 0) return;
  if (seconds > PUMP_MAX_SECONDS) seconds = PUMP_MAX_SECONDS; // GUVENLIK
  S.pumpOn = true;
  S.pumpStopAtMs = millis() + (unsigned long)seconds * 1000UL;
  relayWrite(PIN_RELAY_PUMP, true);
  Serial.printf("[PUMP] ON %d sn\n", seconds);
}

void pumpOff() {
  if (!S.pumpOn) return;
  S.pumpOn = false;
  relayWrite(PIN_RELAY_PUMP, false);
  S.lastWaterMs = millis();
  Serial.println("[PUMP] OFF");
}

// ============================================================================
//  SENSOR OKUMA
// ============================================================================
int readAvg(int pin, int n = 8) {
  long sum = 0;
  for (int i = 0; i < n; i++) { sum += analogRead(pin); delay(3); }
  return (int)(sum / n);
}

int mapClamp(int x, int inMin, int inMax, int outMin, int outMax) {
  int v = map(x, inMin, inMax, outMin, outMax);
  if (v < outMin) v = outMin;
  if (v > outMax) v = outMax;
  return v;
}

void readSensors() {
  // --- DHT22 ---
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) S.tempC = t;
  if (!isnan(h)) S.humAir = h;

  // --- Toprak nem ---
  S.soilRaw = readAvg(PIN_SOIL);
  // Kalibrasyon: kuru = SOIL_DRY_RAW, islak = SOIL_WET_RAW
  S.soilPct = mapClamp(S.soilRaw, SOIL_DRY_RAW, SOIL_WET_RAW, 0, 100);

  // Sensor saglik kontrolu: kablo kopuk/yanlis baglanti uc degerlerde takilir.
  // (Toprak sensorun "dogru calismiyor" demistin - bu uyariyi panele yansitiyoruz)
  S.soilValid = (S.soilRaw > 200 && S.soilRaw < 4000);

  // --- Isik ---
  S.lightRaw = readAvg(PIN_LIGHT);
  // Cogu LDR modulunde aydinlik = dusuk ADC. Ters ise 100-... yap.
  S.lightPct = mapClamp(S.lightRaw, 4095, 0, 0, 100);
}

// ============================================================================
//  OTOMATIK SULAMA MANTIGI
// ============================================================================
void autoWaterCheck() {
  if (!S.autoMode || S.pumpOn) return;
  if (!S.soilValid) return;  // bozuk sensorle sulama yapma (guvenlik)

  unsigned long cooldown = (unsigned long)WATER_COOLDOWN_MIN * 60UL * 1000UL;
  bool cooledDown = (S.lastWaterMs == 0) || (millis() - S.lastWaterMs > cooldown);

  if (S.soilPct < SOIL_WATER_BELOW && cooledDown) {
    Serial.printf("[AUTO] Toprak %%%d < %%%d -> sula\n", S.soilPct, SOIL_WATER_BELOW);
    pumpOn(PUMP_RUN_SECONDS);
  }
}

// Pompa zamanlayicisi (bloklamadan kapatma)
void pumpTick() {
  if (S.pumpOn && millis() >= S.pumpStopAtMs) pumpOff();
}

// ============================================================================
//  MQTT
// ============================================================================
String telemetryJson() {
  String j = "{";
  j += "\"id\":\"" + String(DEVICE_ID) + "\",";
  j += "\"temp\":" + (isnan(S.tempC) ? String("null") : String(S.tempC, 1)) + ",";
  j += "\"humAir\":" + (isnan(S.humAir) ? String("null") : String(S.humAir, 1)) + ",";
  j += "\"soilPct\":" + String(S.soilPct) + ",";
  j += "\"soilRaw\":" + String(S.soilRaw) + ",";
  j += "\"soilValid\":" + String(S.soilValid ? "true" : "false") + ",";
  j += "\"lightPct\":" + String(S.lightPct) + ",";
  j += "\"pump\":" + String(S.pumpOn ? "true" : "false") + ",";
  j += "\"auto\":" + String(S.autoMode ? "true" : "false") + ",";
  j += "\"uptime\":" + String(millis() / 1000);
  j += "}";
  return j;
}

void publishTelemetry() {
  if (!mqtt.connected()) return;
  String j = telemetryJson();
  mqtt.publish(topicTelemetry.c_str(), j.c_str(), true /*retain*/);
}

void onMqtt(char* topic, byte* payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  msg.trim();
  Serial.printf("[MQTT] %s -> %s\n", topic, msg.c_str());

  // Desteklenen komutlar:
  //   "water"        -> varsayilan sure kadar sula
  //   "water:10"     -> 10 sn sula
  //   "stop"         -> pompayi durdur
  //   "auto:on" / "auto:off"
  if (msg == "water") {
    pumpOn(PUMP_RUN_SECONDS);
  } else if (msg.startsWith("water:")) {
    pumpOn(msg.substring(6).toInt());
  } else if (msg == "stop") {
    pumpOff();
  } else if (msg == "auto:on") {
    S.autoMode = true;
  } else if (msg == "auto:off") {
    S.autoMode = false;
  }
  publishTelemetry();
}

void mqttReconnect() {
  if (mqtt.connected()) return;
  static unsigned long lastTry = 0;
  if (millis() - lastTry < 3000) return;  // bloklamadan, 3 sn'de bir dene
  lastTry = millis();

  String clientId = "esp32-" + String(DEVICE_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.print("[MQTT] baglaniyor... ");
  if (mqtt.connect(clientId.c_str())) {
    Serial.println("OK");
    mqtt.subscribe(topicCommand.c_str());
    publishTelemetry();
  } else {
    Serial.printf("hata rc=%d\n", mqtt.state());
  }
}

// ============================================================================
//  LAN WEB SUNUCUSU (internet yokken/yerel test icin)
// ============================================================================
const char* PAGE = R"HTML(
<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Bitki</title><style>body{font-family:system-ui;background:#0f1115;color:#e7e7e7;max-width:480px;margin:24px auto;padding:0 16px}
.c{background:#1a1d24;border-radius:14px;padding:16px;margin:10px 0}.v{font-size:30px;font-weight:700}
button{font-size:16px;padding:12px 18px;border:0;border-radius:10px;background:#3ba776;color:#fff;margin:4px}</style>
<h2>🌱 Bitki Paneli (yerel)</h2><div id=app>yukleniyor...</div>
<button onclick=cmd('water')>💧 Sula</button>
<button onclick=cmd('stop')>⏹ Durdur</button>
<button onclick=cmd('auto:on')>Oto AC</button>
<button onclick=cmd('auto:off')>Oto KAPAT</button>
<script>
async function load(){let r=await fetch('/api');let d=await r.json();
app.innerHTML=`<div class=c>Toprak nem<div class=v>%${d.soilPct} ${d.soilValid?'':'⚠️ sensor?'}</div></div>
<div class=c>Sicaklik<div class=v>${d.temp??'-'}°C</div></div>
<div class=c>Hava nem<div class=v>%${d.humAir??'-'}</div></div>
<div class=c>Isik<div class=v>%${d.lightPct}</div></div>
<div class=c>Pompa: ${d.pump?'ACIK':'kapali'} · Oto: ${d.auto?'acik':'kapali'}</div>`}
async function cmd(c){await fetch('/cmd?c='+c);setTimeout(load,400)}
load();setInterval(load,3000);
</script>)HTML";

void handleApi()  { http.send(200, "application/json", telemetryJson()); }
void handleRoot() { http.send(200, "text/html", PAGE); }
void handleCmd() {
  String c = http.arg("c");
  if (c == "water") pumpOn(PUMP_RUN_SECONDS);
  else if (c == "stop") pumpOff();
  else if (c == "auto:on") S.autoMode = true;
  else if (c == "auto:off") S.autoMode = false;
  http.send(200, "text/plain", "ok");
}

// ============================================================================
//  SETUP / LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(PIN_RELAY_PUMP, OUTPUT);
  pinMode(PIN_RELAY_2, OUTPUT);
  pinMode(PIN_RELAY_3, OUTPUT);
  pinMode(PIN_RELAY_4, OUTPUT);
  relayWrite(PIN_RELAY_PUMP, false);   // ACILISTA POMPA KAPALI (cok onemli)
  relayWrite(PIN_RELAY_2, false);
  relayWrite(PIN_RELAY_3, false);
  relayWrite(PIN_RELAY_4, false);

  analogReadResolution(12);            // 0..4095
  dht.begin();

  topicTelemetry = "plant/" + String(DEVICE_ID) + "/telemetry";
  topicCommand   = "plant/" + String(DEVICE_ID) + "/cmd";
  topicState     = "plant/" + String(DEVICE_ID) + "/state";

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] baglaniyor");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print("."); }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WiFi] BAGLANAMADI - yerel calismaya devam");
  }

  // MQTT
#if MQTT_USE_TLS
  net.setInsecure();   // public broker icin sertifika dogrulamasi yok (hobi)
#endif
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqtt);
  mqtt.setBufferSize(512);

  // Web
  http.on("/", handleRoot);
  http.on("/api", handleApi);
  http.on("/cmd", handleCmd);
  http.begin();
}

void loop() {
  http.handleClient();

  if (WiFi.status() == WL_CONNECTED) {
    mqttReconnect();
    mqtt.loop();
  }

  pumpTick();

  if (millis() - lastSensorMs > 2000) {     // 2 sn'de bir oku
    lastSensorMs = millis();
    readSensors();
    autoWaterCheck();
  }

  if (millis() - lastPublishMs > 5000) {    // 5 sn'de bir yayinla
    lastPublishMs = millis();
    publishTelemetry();
  }
}
