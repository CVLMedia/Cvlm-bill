# 📱 Implementasi Telegram Bot untuk Monitoring - Dokumentasi Lengkap

## 📋 Daftar Isi
1. [Overview](#overview)
2. [Fitur yang Diimplementasikan](#fitur-yang-diimplementasikan)
3. [File yang Dibuat/Dimodifikasi](#file-yang-dibuatdimodifikasi)
4. [Instalasi Dependencies](#instalasi-dependencies)
5. [Konfigurasi](#konfigurasi)
6. [Setup Telegram Bot](#setup-telegram-bot)
7. [Cara Penggunaan](#cara-penggunaan)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

Telegram Bot khusus untuk monitoring sistem billing. Bot ini **hanya mengirim notifikasi monitoring** dan tidak menangani fitur billing lainnya (yang tetap menggunakan WhatsApp Bot).

### Perbedaan dengan WhatsApp Bot

| Fitur | WhatsApp Bot | Telegram Bot |
|-------|--------------|--------------|
| Billing & Invoice | ✅ | ❌ |
| Payment Notifications | ✅ | ❌ |
| Customer Commands | ✅ | ❌ |
| PPPoE Monitoring | ✅ | ✅ |
| RX Power Alerts | ✅ | ✅ |
| Connection Monitoring | ✅ | ✅ |

---

## ✨ Fitur yang Diimplementasikan

### 1. **PPPoE Login/Logout Notifications**
- Notifikasi real-time ketika user login ke PPPoE
- Notifikasi real-time ketika user logout dari PPPoE
- Menampilkan daftar user offline

### 2. **RX Power Alerts**
- Warning alert ketika RX Power mendekati threshold
- Critical alert ketika RX Power melewati batas kritis
- Informasi device, PPPoE username, dan nomor telepon

### 3. **Connection Monitoring**
- Alert ketika koneksi WhatsApp terputus/terhubung
- Alert ketika koneksi Mikrotik terputus/terhubung

### 4. **UI Configuration**
- Form konfigurasi di Admin Settings
- Status bot real-time
- Test connection
- Toggle enable/disable monitoring

---

## 📁 File yang Dibuat/Dimodifikasi

### File Baru yang Dibuat

1. **`config/telegram-monitor.js`**
   - Modul utama Telegram Bot
   - Handle koneksi, command, dan notifikasi
   - Auto-register chat ID dengan `/start`

2. **`docs/TELEGRAM_MONITORING_BOT.md`**
   - Dokumentasi penggunaan Telegram Bot

3. **`docs/TELEGRAM_BOT_IMPLEMENTATION_COMPLETE.md`**
   - Dokumentasi lengkap implementasi (file ini)

### File yang Dimodifikasi

1. **`config/pppoe-monitor.js`**
   - Integrasi dengan Telegram Bot untuk notifikasi PPPoE login/logout
   - Fix initial state untuk deteksi logout yang benar

2. **`config/rxPowerMonitor.js`**
   - Integrasi dengan Telegram Bot untuk RX Power alerts

3. **`config/connection-monitor.js`**
   - Integrasi dengan Telegram Bot untuk connection alerts

4. **`app.js`**
   - Inisialisasi Telegram Bot saat startup

5. **`views/adminSetting.ejs`**
   - UI form konfigurasi Telegram Bot
   - Status display real-time
   - Test connection button

6. **`routes/adminSetting.js`**
   - Route untuk get status Telegram Bot
   - Route untuk test connection Telegram Bot

7. **`settings.server.template.json`**
   - Template konfigurasi Telegram Bot token

8. **`package.json`**
   - Dependency `node-telegram-bot-api` (otomatis ditambahkan)

---

## 📦 Instalasi Dependencies

### 1. Install Library Telegram Bot

```bash
cd /home/enos/cvlmedia
npm install node-telegram-bot-api --save
```

### 2. Verifikasi Instalasi

```bash
npm list node-telegram-bot-api
```

Output yang diharapkan:
```
gembok-bill@2.1.0
└── node-telegram-bot-api@x.x.x
```

---

## ⚙️ Konfigurasi

### 1. Buat Telegram Bot via BotFather

1. Buka Telegram dan cari [@BotFather](https://t.me/BotFather)
2. Kirim perintah `/newbot`
3. Ikuti instruksi:
   - Masukkan nama bot (contoh: "CVL Media Monitoring Bot")
   - Masukkan username bot (contoh: "cvlmedia_monitoring_bot")
4. Simpan **Bot Token** yang diberikan (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Konfigurasi di settings.json

Tambahkan konfigurasi berikut di `settings.json`:

```json
{
  "telegram_bot_token": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
  "telegram_monitoring_enabled": true
}
```

**Catatan:** Ganti `123456789:ABCdefGHIjklMNOpqrsTUVwxyz` dengan Bot Token yang Anda dapatkan dari BotFather.

### 3. Konfigurasi via UI (Alternatif)

1. Buka halaman Admin Settings: `http://your-server:port/admin/settings`
2. Scroll ke section **"Telegram Monitoring Bot"**
3. Masukkan Bot Token di form
4. Aktifkan monitoring (toggle switch)
5. Klik **"Simpan Konfigurasi Telegram"**
6. Klik **"Test Koneksi Telegram"** untuk verifikasi

---

## 🚀 Setup Telegram Bot

### 1. Restart Aplikasi

Setelah konfigurasi, restart aplikasi:

```bash
# Jika menggunakan PM2
pm2 restart cvlmedia

# Atau jika menggunakan npm start
# Stop aplikasi (Ctrl+C) lalu:
npm start
```

### 2. Daftarkan Chat ID

1. Buka Telegram dan cari bot Anda (nama bot sesuai yang dibuat di BotFather)
2. Kirim perintah `/start` ke bot
3. Bot akan merespons:
   ```
   ✅ Chat ID Terdaftar!
   
   Halo [Nama Anda]! Chat ID Anda telah terdaftar untuk menerima notifikasi monitoring.
   
   📋 Info Chat:
   • Chat ID: [chat_id]
   • Username: @[username]
   
   🔔 Fitur Monitoring:
   • PPPoE Login/Logout
   • RX Power Alerts
   • Connection Monitoring
   ```

4. Chat ID otomatis tersimpan di `data/telegram-monitor-config.json`

### 3. Verifikasi Setup

Kirim perintah `/status` ke bot untuk melihat status:
```
📊 Status Telegram Monitoring Bot

Status: ✅ Terhubung
Total Chat Terdaftar: 1
Monitoring Aktif: ✅

Fitur Monitoring:
• PPPoE Login/Logout: ✅
• RX Power Alert: ✅
• Connection Monitor: ✅
```

---

## 📱 Cara Penggunaan

### Perintah Bot

| Perintah | Deskripsi |
|----------|-----------|
| `/start` | Daftarkan chat untuk menerima notifikasi monitoring |
| `/status` | Cek status bot dan monitoring |
| `/unregister` | Hapus chat dari daftar notifikasi |
| `/help` | Tampilkan bantuan |

### Notifikasi yang Dikirim

#### 1. PPPoE Login
```
🔔 PPPoE LOGIN

1. username1
• Address: 192.168.1.100
• Uptime: 1h 30m

🚫 Pelanggan Offline (5)
1. user1
2. user2
...
```

#### 2. PPPoE Logout
```
🔴 PPPoE LOGOUT

1. username1
2. username2

🚫 Total Pelanggan Offline: 7
```

#### 3. RX Power Warning
```
⚠️ RX POWER WARNING

Device: SN123456789
PPPoE: username1
Phone: 081234567890
RX Power: -26 dBm
Threshold: -25 dBm

RX Power mendekati batas kritis. Harap segera cek perangkat.
```

#### 4. RX Power Critical
```
🚨 RX POWER CRITICAL ALERT

Device: SN123456789
PPPoE: username1
Phone: 081234567890
RX Power: -28 dBm
Threshold: -27 dBm

⚠️ RX Power sudah melewati batas kritis!
Segera lakukan pengecekan dan perbaikan.
```

#### 5. Connection Alert
```
🔴 WHATSAPP TERPUTUS

Koneksi WhatsApp terputus. Mencoba reconnect...
```

---

## 🧪 Testing

### 1. Test Koneksi Bot

**Via UI:**
1. Buka Admin Settings → Telegram Monitoring Bot
2. Klik **"Test Koneksi Telegram"**
3. Pastikan muncul: `✅ Koneksi Telegram Bot berhasil!`

**Via Bot:**
1. Kirim `/status` ke bot
2. Pastikan status: `✅ Terhubung`

### 2. Test PPPoE Login Notification

1. Login user PPPoE baru
2. Tunggu maksimal 60 detik (interval default)
3. Cek Telegram, harus ada notifikasi login

### 3. Test PPPoE Logout Notification

1. Logout user PPPoE yang sedang aktif
2. Tunggu maksimal 60 detik
3. Cek Telegram, harus ada notifikasi logout

### 4. Test RX Power Alert

1. Pastikan ada device dengan RX Power di bawah threshold
2. Tunggu interval monitoring RX Power
3. Cek Telegram, harus ada alert

---

## 🔧 Troubleshooting

### Bot tidak merespons

**Solusi:**
1. Cek apakah bot token sudah benar di `settings.json`
2. Cek log aplikasi untuk error
3. Pastikan bot sudah di-start dengan perintah `/start`
4. Restart aplikasi

### Tidak menerima notifikasi

**Solusi:**
1. Pastikan Chat ID sudah terdaftar (kirim `/start`)
2. Cek status dengan `/status`
3. Pastikan monitoring aktif di settings:
   - `pppoe_notifications.enabled`: `true`
   - `rx_power_notification_enable`: `true`
4. Cek log aplikasi untuk error

### Bot error saat startup

**Solusi:**
1. Cek log aplikasi untuk detail error
2. Pastikan `node-telegram-bot-api` sudah terinstall
3. Pastikan bot token valid dan bot belum dihapus dari BotFather
4. Cek koneksi internet server

### Chat ID tidak terdaftar

**Solusi:**
1. Pastikan bot sudah terhubung (cek status di UI)
2. Kirim `/start` ke bot
3. Pastikan bot merespons dengan konfirmasi
4. Cek file `data/telegram-monitor-config.json` apakah chat ID sudah ada

---

## 📊 Monitoring Status di UI

### Lokasi
Admin Settings → Telegram Monitoring Bot

### Informasi yang Ditampilkan
- **Status:** Terhubung / Tidak Terhubung
- **Chat Terdaftar:** Jumlah chat ID yang terdaftar
- **Monitoring:** Aktif / Nonaktif
- **Fitur:** Status setiap fitur monitoring

### Auto-Refresh
Status otomatis di-refresh setiap 10 detik

---

## 📝 File Konfigurasi

### 1. settings.json
```json
{
  "telegram_bot_token": "YOUR_BOT_TOKEN",
  "telegram_monitoring_enabled": true
}
```

### 2. data/telegram-monitor-config.json (Auto-generated)
```json
{
  "chatIds": [
    123456789,
    987654321
  ]
}
```

**Catatan:** File ini otomatis dibuat saat chat ID terdaftar. Jangan edit manual.

---

## 🔐 Keamanan

### Best Practices

1. **Jangan commit Bot Token ke repository**
   - Bot Token bersifat rahasia
   - Tambahkan `settings.json` ke `.gitignore`

2. **Gunakan environment variables (opsional)**
   ```bash
   export TELEGRAM_BOT_TOKEN="your_token_here"
   ```

3. **Batasi akses ke file konfigurasi**
   ```bash
   chmod 600 settings.json
   chmod 600 data/telegram-monitor-config.json
   ```

---

## 📈 Performance

### Interval Monitoring

- **PPPoE Monitoring:** Default 60 detik (dapat diubah di settings)
- **RX Power Monitoring:** Sesuai konfigurasi di settings
- **Connection Monitoring:** Real-time

### Rate Limiting

Telegram Bot API memiliki rate limit:
- **30 pesan per detik** untuk group
- **20 pesan per detik** untuk private chat

Bot ini sudah mengimplementasikan delay 100ms antar pesan untuk menghindari rate limit.

---

## 🎯 Kesimpulan

Telegram Bot untuk monitoring sudah **100% berfungsi** dengan fitur:

✅ PPPoE Login/Logout notifications  
✅ RX Power alerts (Warning & Critical)  
✅ Connection monitoring alerts  
✅ UI configuration  
✅ Auto-register chat ID  
✅ Real-time status display  
✅ Test connection  
✅ Error handling & logging  

Bot ini khusus untuk **monitoring saja**. Fitur billing tetap menggunakan WhatsApp Bot.

---

## 📞 Support

Jika ada masalah:
1. Cek log aplikasi: `logs/app.log`
2. Cek status bot: Kirim `/status` ke bot
3. Cek konfigurasi: Pastikan `telegram_bot_token` sudah diisi di `settings.json`
4. Restart aplikasi setelah perubahan konfigurasi

---

**Dokumentasi ini dibuat untuk CVL Media Billing System**  
**Versi:** 1.0  
**Tanggal:** 2025-12-03  
**Status:** ✅ Production Ready

