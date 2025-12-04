# Sistem Auto-Notifikasi Pembayaran

## ✅ Status: **SUDAH OTOMATIS!**

Sistem sekarang **sudah bisa otomatis** mengirim notifikasi WhatsApp kepada pelanggan ketika pembayaran via Payment Gateway (Tripay) sudah sukses, **bahkan jika webhook gagal**.

## 🔄 Cara Kerja

### 1. **Webhook (Primary Method)**
Ketika pelanggan membayar via Tripay:
- Tripay mengirim webhook ke server
- Sistem memproses webhook
- Payment direcord, invoice diupdate
- **Notifikasi otomatis terkirim** ✅

### 2. **Auto-Check (Backup Method)**
Jika webhook gagal atau tidak terkirim:
- **Setiap 15 menit**, sistem otomatis mengecek:
  - Payment gateway transactions yang masih `pending`
  - Status payment di Tripay API
  - Jika status `PAID` di Tripay tapi belum diproses lokal:
    - ✅ Record payment
    - ✅ Update invoice status
    - ✅ **Kirim notifikasi otomatis**

## ⏰ Jadwal Auto-Check

**Cron Job:** `*/15 * * * *` (setiap 15 menit)

**Timezone:** Asia/Jakarta

**Fitur:**
- Cek payment gateway transactions yang masih `pending`
- Hanya cek transaksi dalam 24 jam terakhir (untuk efisiensi)
- Maksimal 20 transaksi per eksekusi
- Auto-process payment yang sudah PAID
- Auto-send notification setelah payment diproses

## 📋 Log Monitoring

Semua aktivitas auto-check dicatat di log dengan prefix `[AUTO-CHECK]`:

```bash
# Cek log auto-check
pm2 logs | grep "AUTO-CHECK"

# Atau cek file log
tail -f logs/app.log | grep "AUTO-CHECK"
```

**Contoh log:**
```
[AUTO-CHECK] Starting automatic payment gateway status check...
[AUTO-CHECK] Found 2 pending Tripay transactions to check
[AUTO-CHECK] Payment PAID found: Invoice INV-202511-6709, Processing...
[AUTO-CHECK] ✅ Payment processed: Invoice INV-202511-6709, Payment ID 95
[AUTO-CHECK] ✅ Notification sent for invoice INV-202511-6709
[AUTO-CHECK] Completed: 1 processed, 0 errors
```

## 🎯 Skenario

### Skenario 1: Webhook Berhasil ✅
1. Pelanggan bayar via Tripay
2. Tripay kirim webhook → Server terima
3. Payment diproses → Notifikasi terkirim
4. **Pelanggan langsung dapat notifikasi** ✅

### Skenario 2: Webhook Gagal, Auto-Check Menyelamatkan ✅
1. Pelanggan bayar via Tripay
2. Tripay kirim webhook → **Gagal terkirim** ❌
3. **Maksimal 15 menit kemudian:**
   - Auto-check menemukan payment sudah PAID
   - Payment diproses otomatis
   - **Notifikasi terkirim** ✅
4. **Pelanggan tetap dapat notifikasi** (maksimal delay 15 menit)

### Skenario 3: Webhook Terkirim Tapi Gagal Diproses ✅
1. Pelanggan bayar via Tripay
2. Tripay kirim webhook → Server terima tapi **gagal diproses** ❌
3. **Maksimal 15 menit kemudian:**
   - Auto-check menemukan payment sudah PAID
   - Payment diproses otomatis
   - **Notifikasi terkirim** ✅
4. **Pelanggan tetap dapat notifikasi** (maksimal delay 15 menit)

## 🔧 Konfigurasi

Auto-check **otomatis aktif** jika:
- ✅ Tripay gateway enabled
- ✅ Tripay API key dan private key dikonfigurasi
- ✅ Scheduler berjalan (otomatis saat aplikasi start)

**Tidak perlu konfigurasi manual!**

## 📊 Monitoring

### Cek Status Auto-Check

```bash
# Cek apakah scheduler berjalan
pm2 logs | grep "Payment gateway auto-check scheduler"

# Cek aktivitas terakhir
pm2 logs | grep "AUTO-CHECK" | tail -20
```

### Manual Trigger (Testing)

```bash
# Via Node.js
node -e "const s = require('./config/scheduler'); s.checkAndProcessPendingPayments().then(r => console.log(r));"
```

## ⚠️ Catatan Penting

1. **Delay Maksimal:** 15 menit
   - Jika webhook gagal, notifikasi akan terkirim maksimal 15 menit setelah pembayaran

2. **WhatsApp Harus Terhubung:**
   - Notifikasi hanya terkirim jika WhatsApp terhubung
   - Jika WhatsApp tidak terhubung, payment tetap diproses, tapi notifikasi akan gagal
   - Notifikasi bisa dikirim ulang setelah WhatsApp terhubung

3. **Template Notifikasi:**
   - Pastikan template `payment_received` enabled
   - Cek di: Admin → Settings → WhatsApp Templates

4. **Rate Limiting:**
   - Auto-check hanya cek 20 transaksi per eksekusi
   - Hanya cek transaksi dalam 24 jam terakhir
   - Tidak akan membebani API Tripay

## 🎉 Kesimpulan

**Ya, sistem sudah otomatis!** 

Pelanggan akan **otomatis menerima notifikasi** ketika sudah bayar, dengan 2 mekanisme:
1. **Webhook** (instant, jika berhasil)
2. **Auto-Check** (maksimal 15 menit delay, jika webhook gagal)

**Tidak perlu intervensi manual lagi!** 🚀

