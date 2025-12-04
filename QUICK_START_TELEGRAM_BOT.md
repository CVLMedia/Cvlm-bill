# 🚀 Quick Start: Telegram Bot untuk Monitoring

## ⚡ Setup Cepat (5 Menit)

### 1. Install Dependencies
```bash
npm install node-telegram-bot-api --save
```

### 2. Buat Bot di Telegram
1. Buka Telegram → Cari [@BotFather](https://t.me/BotFather)
2. Kirim `/newbot`
3. Ikuti instruksi, simpan **Bot Token**

### 3. Konfigurasi
Edit `settings.json`:
```json
{
  "telegram_bot_token": "YOUR_BOT_TOKEN_HERE",
  "telegram_monitoring_enabled": true
}
```

### 4. Restart Aplikasi
```bash
pm2 restart cvlmedia
# atau
npm start
```

### 5. Daftarkan Chat ID
1. Buka Telegram → Cari bot Anda
2. Kirim `/start`
3. Selesai! ✅

---

## 🧪 Test

### Test Koneksi
```bash
node scripts/check-telegram-bot-status.js
```

### Test via Bot
Kirim ke bot:
- `/status` - Cek status
- `/help` - Bantuan

---

## 📋 Checklist

- [ ] Dependencies terinstall
- [ ] Bot Token dikonfigurasi
- [ ] Aplikasi di-restart
- [ ] Chat ID terdaftar (kirim `/start`)
- [ ] Status bot: ✅ Terhubung
- [ ] Test notifikasi (PPPoE login/logout)

---

## 🎯 Fitur

✅ PPPoE Login/Logout notifications  
✅ RX Power alerts  
✅ Connection monitoring  
✅ UI Configuration  
✅ Auto-register chat ID  

---

## 📖 Dokumentasi Lengkap

Lihat: `docs/TELEGRAM_BOT_IMPLEMENTATION_COMPLETE.md`

---

**Status:** ✅ Production Ready  
**Versi:** 1.0

