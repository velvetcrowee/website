// ============================================================================
//  config.example.h  ->  Kopyalayıp "config.h" olarak kaydet ve doldur.
//  (config.h .gitignore ile gizlenir, şifreler repoya gitmez.)
// ============================================================================
#pragma once

// --- WiFi ---
#define WIFI_SSID      "EV_WIFI_ADIN"
#define WIFI_PASSWORD  "WIFI_SIFREN"

// --- Cihaz kimliği (internetten erişim için BENZERSIZ ve gizli olmalı) ---
// Public MQTT broker kullandığımız için bu metni tahmin edilemez yap.
// Örn: "velvet-plant-7f3a9c". Aynısını dashboard/app.js içine de yazacaksın.
#define DEVICE_ID      "velvet-plant-DEGISTIR-beni"

// --- MQTT (internet üzerinden uzaktan erişim) ---
// Varsayılan: HiveMQ ücretsiz public broker (kurulum gerektirmez).
#define MQTT_HOST      "broker.hivemq.com"
#define MQTT_PORT      8883          // 8883 = TLS. Plain için 1883 yap ve aşağıyı kapat.
#define MQTT_USE_TLS   1            // 1 = TLS (8883), 0 = şifresiz (1883)

// --- Otomatik sulama ayarları ---
#define SOIL_DRY_RAW       3200      // KURU toprakta okunan ham ADC değeri (kalibre et)
#define SOIL_WET_RAW       1300      // ISLAK toprakta okunan ham ADC değeri (kalibre et)
#define SOIL_WATER_BELOW   35        // % nem bunun altına düşerse otomatik sula
#define PUMP_RUN_SECONDS   6         // Her sulamada pompa kaç saniye çalışsın
#define PUMP_MAX_SECONDS   15        // Güvenlik: tek seferde asla bu süreyi aşma
#define WATER_COOLDOWN_MIN 60        // İki otomatik sulama arası en az kaç dakika
#define AUTO_MODE_DEFAULT  true      // Açılışta otomatik mod açık mı?
