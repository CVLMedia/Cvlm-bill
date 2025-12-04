# Telegram Monitoring Bot

Telegram Bot khusus untuk monitoring sistem billing. Bot ini hanya mengirim notifikasi monitoring dan tidak menangani fitur billing lainnya (yang tetap menggunakan WhatsApp Bot).

## Fitur Monitoring

Bot ini mengirim notifikasi untuk:

1. **PPPoE Login/Logout** - Notifikasi ketika ada user yang login atau logout dari PPPoE
2. **RX Power Alerts** - Peringatan ketika RX Power device melewati threshold (Warning & Critical)
3. **Connection Monitoring** - Alert ketika koneksi WhatsApp atau Mikrotik terputus/terhubung kembali

## Setup

### 1. Buat Telegram Bot

1. Buka Telegram dan cari [@BotFather](https://t.me/BotFather)
2. Kirim perintah `/newbot`
3. Ikuti instruksi untuk memberikan nama bot
4. Simpan **Bot Token** yang diberikan (contoh: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Konfigurasi di settings.json

Tambahkan konfigurasi berikut di `settings.json`:

```json
{
  "telegram_bot_token": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
  "telegram_monitoring_enabled": true
}
```

**Catatan:** Ganti `123456789:ABCdefGHIjklMNOpqrsTUVwxyz` dengan Bot Token yang Anda dapatkan dari BotFather.

### 3. Daftarkan Chat ID

1. Setelah bot token dikonfigurasi, restart aplikasi
2. Buka Telegram dan cari bot Anda (nama bot sesuai yang Anda buat di BotFather)
3. Kirim perintah `/start` ke bot
4. Bot akan merespons dan mendaftarkan Chat ID Anda secara otomatis

**Catatan:** Chat ID disimpan di `data/telegram-monitor-config.json` dan akan otomatis digunakan untuk semua notifikasi monitoring.

### 4. Verifikasi Setup

Kirim perintah `/status` ke bot untuk melihat status:
- Status koneksi bot
- Jumlah chat terdaftar
- Status monitoring aktif

## Perintah Bot

- `/start` - Daftarkan chat untuk menerima notifikasi monitoring
- `/status` - Cek status bot dan monitoring
- `/unregister` - Hapus chat dari daftar notifikasi
- `/help` - Tampilkan bantuan

## Notifikasi yang Dikirim

### PPPoE Login
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

### PPPoE Logout
```
🔴 PPPoE LOGOUT

1. username1
2. username2

🚫 Total Pelanggan Offline: 7
```

### RX Power Warning
```
⚠️ RX POWER WARNING

Device: SN123456789
PPPoE: username1
Phone: 081234567890
RX Power: -26 dBm
Threshold: -25 dBm

RX Power mendekati batas kritis. Harap segera cek perangkat.
```

### RX Power Critical
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

### Connection Alert
```
🔴 WHATSAPP TERPUTUS

Koneksi WhatsApp terputus. Mencoba reconnect...
```

## Perbedaan dengan WhatsApp Bot

| Fitur | WhatsApp Bot | Telegram Bot |
|-------|--------------|--------------|
| Billing & Invoice | ✅ | ❌ |
| Payment Notifications | ✅ | ❌ |
| Customer Commands | ✅ | ❌ |
| PPPoE Monitoring | ✅ | ✅ |
| RX Power Alerts | ✅ | ✅ |
| Connection Monitoring | ✅ | ✅ |

**Kesimpulan:** Telegram Bot hanya untuk monitoring, WhatsApp Bot untuk semua fitur termasuk billing.

## Troubleshooting

### Bot tidak merespons

1. Cek apakah bot token sudah benar di `settings.json`
2. Cek log aplikasi untuk error
3. Pastikan bot sudah di-start dengan perintah `/start`

### Tidak menerima notifikasi

1. Pastikan Chat ID sudah terdaftar (kirim `/start`)
2. Cek status dengan `/status`
3. Pastikan monitoring aktif di settings:
   - `pppoe_notifications.enabled`: `true`
   - `rx_power_notification_enable`: `true`

### Bot error saat startup

1. Cek log aplikasi untuk detail error
2. Pastikan `node-telegram-bot-api` sudah terinstall: `npm install node-telegram-bot-api`
3. Pastikan bot token valid dan bot belum dihapus dari BotFather

## File Konfigurasi

- **Settings:** `settings.json` - Bot token dan enable/disable
- **Chat IDs:** `data/telegram-monitor-config.json` - Daftar chat yang terdaftar (auto-generated)

## Catatan Penting

1. **Bot Token bersifat rahasia** - Jangan commit ke repository
2. **Chat ID otomatis terdaftar** - Tidak perlu konfigurasi manual
3. **Bot hanya untuk monitoring** - Fitur billing tetap menggunakan WhatsApp
4. **Multiple chat support** - Bisa mendaftarkan beberapa chat untuk notifikasi

## Support

Jika ada masalah, cek:
1. Log aplikasi: `logs/app.log`
2. Status bot: Kirim `/status` ke bot
3. Konfigurasi: Pastikan `telegram_bot_token` sudah diisi di `settings.json`

