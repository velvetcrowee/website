# 🔌 Bağlantı Şeması (Wiring)

## Pin haritası

| Bileşen | Bileşen pini | ESP32 pini | Not |
|---|---|---|---|
| **DHT22** (sıcaklık/nem) | VCC | 3V3 | DATA hattına 10k pull-up (modülde varsa gerekmez) |
| | DATA | GPIO 4 | |
| | GND | GND | |
| **Toprak nem** (kapasitif) | VCC | 3V3 | ⚠️ 3.3V kullan, 5V değil |
| | AO (analog) | GPIO 34 | sadece giriş pini |
| | GND | GND | |
| **LDR ışık modülü** | VCC | 3V3 | |
| | AO (analog) | GPIO 35 | sadece giriş pini |
| | GND | GND | |
| **4 kanallı röle** | VCC | 5V (VIN) | Röleyi ESP'nin 5V'undan besle |
| | GND | GND | ortak GND şart |
| | IN1 | GPIO 26 | → su pompası |
| | IN2/IN3/IN4 | GPIO 25 / 33 / 32 | boş (ileride lamba vb.) |
| **5V mini pompa** | (+) | Röle IN1 COM/NO üzerinden | **ayrı 5V besleme** |
| | (–) | 5V beslemenin GND'si | |

## ASCII şema

```
                    +---------------------+
   3V3 ------+------| VCC  DHT22          |
             |      | DATA ---> GPIO 4    |
             |      | GND ----+           |
             |               (GND)        |
             |
   3V3 ------+------| VCC  Toprak Nem     |
             |      | AO  ---> GPIO 34    |
             |      | GND ----+           |
             |
   3V3 ------+------| VCC  LDR Işık       |
                    | AO  ---> GPIO 35    |
                    | GND ----+           |

   ESP32                         4 KANALLI RÖLE
   GPIO26 --------------------> IN1     COM --- 5V(+) ayrı besleme
   5V     --------------------> VCC     NO  --- Pompa(+)
   GND    --------------------> GND
                                          Pompa(-) --- 5V besleme GND
   * ESP32 GND  <->  Röle GND  <->  Pompa beslemesi GND  (HEPSİ ORTAK)
```

## ⚡ Güç / besleme — ÇOK ÖNEMLİ

- **Pompayı ESP32'nin 3V3 veya 5V pininden BESLEME.** Motorun anlık akımı
  ESP32'yi resetler/yakar. Pompaya **ayrı bir 5V adaptör veya powerbank/USB**
  ver, röle sadece bu hattı açıp kapatır.
- **Ortak GND zorunlu:** ESP32 GND, röle GND ve pompa beslemesinin GND'si
  birbirine bağlı olmalı; yoksa röle tetiklenmez.
- Pompa motoruna ters gerilim için **flyback diyot (1N4007)** koy: katot (+),
  anot (–) tarafına. Röle modülleri bunu çoğunlukla içerir ama motor için ek
  diyot ömrü uzatır.
- Röle modülleri genelde **aktif-LOW**'dur (IN=LOW → röle çeker). Firmware'de
  `RELAY_ACTIVE_LOW 1` ayarı bunu yönetir; ters çalışırsa `0` yap.

## Görsel şema oluşturma

Fritzing benzeri görsel şema istersen yukarıdaki pin tablosunu
[wokwi.com](https://wokwi.com) veya [app.cirkitdesigner.com](https://app.cirkitdesigner.com)
üzerinde simülasyon olarak da kurabilirsin (kod birebir çalışır).
