# COR3 Bot - Android APK Projesi

## 📱 Ne Yapar?
- `https://os.cor3.gg/` sitesini otomatik açar
- `cor3helpers.js` scriptini sayfa yüklenince otomatik enjekte eder
- Expedition otomasyonu, auto-decision ve diğer görevler arka planda çalışır
- Ekran tam ekran & her zaman açık kalır

---

## 🛠️ APK Yapmak İçin

### 1. Android Studio İndir
https://developer.android.com/studio

### 2. Projeyi Aç
- Android Studio → **Open** → Bu klasörü seç (`COR3Bot/`)

### 3. APK Derle
- Üst menü: **Build → Build Bundle(s) / APK(s) → Build APK(s)**
- Bekle (~2-3 dakika)
- Çıktı: `app/build/outputs/apk/debug/app-debug.apk`

### 4. Telefona Yükle
- `app-debug.apk` dosyasını telefona at
- Ayarlar → **Bilinmeyen Kaynaklardan Yükleme** izni ver
- APK'yı yükle

---

## 📂 Proje Yapısı
```
COR3Bot/
├── app/
│   ├── src/main/
│   │   ├── assets/
│   │   │   └── cor3helpers.js      ← Bot scripti (buraya)
│   │   ├── java/com/cor3/bot/
│   │   │   └── MainActivity.java   ← Ana uygulama
│   │   ├── res/
│   │   │   ├── drawable/ic_launcher.png
│   │   │   └── values/styles.xml
│   │   └── AndroidManifest.xml
│   └── build.gradle
└── settings.gradle
```

---

## ⚙️ Scripti Güncellemek
`app/src/main/assets/cor3helpers.js` dosyasını değiştir → APK'yı yeniden derle.

---

## 🔧 Teknik Detaylar
- **WebView** ile `os.cor3.gg` açılır
- `onPageFinished` tetiklenince JS enjekte edilir
- Desktop Chrome user-agent kullanır (site uyumluluğu için)
- WebSocket hook, expedition auto-start/collect, auto-decision hepsi çalışır
- Logları görmek için: Android Studio → **Logcat** → `COR3Bot` filtrele
