# Troubleshooting Payment Webhook - Notifikasi Pembayaran Tidak Terkirim

## Masalah
Pembayaran via Payment Gateway (Tripay) sudah sukses dan uang sudah masuk, tetapi:
- Invoice masih berstatus `unpaid`
- Tidak ada notifikasi WhatsApp yang terkirim
- Payment tidak tercatat di sistem

## Kemungkinan Penyebab

### 1. Webhook dari Tripay Belum Terkirim
- Tripay belum mengirim webhook ke server
- Webhook gagal dikirim karena server tidak accessible
- Callback URL tidak valid atau tidak bisa diakses dari internet

### 2. Webhook Terkirim Tapi Gagal Diproses
- Signature verification gagal
- Error saat processing webhook
- Database error saat menyimpan payment

### 3. Payment Sudah Diproses Tapi Notifikasi Gagal
- WhatsApp tidak terhubung
- Template notifikasi disabled
- Error saat mengirim notifikasi

## Cara Mengecek dan Memperbaiki

### Step 1: Cek Status Payment di Tripay API

Gunakan script untuk mengecek status payment langsung dari Tripay API:

```bash
node scripts/check-tripay-payment-status.js INV-202511-6709
```

Script ini akan:
- ✅ Mencari invoice dan payment gateway transaction
- ✅ Mengecek status payment di Tripay API
- ✅ Memproses payment manual jika status PAID di Tripay
- ✅ Mengirim notifikasi WhatsApp

**Output yang diharapkan:**
```
✅ Tripay API Response:
   Status: PAID
   Amount: Rp 117.172
   Payment Method: DANA
   Paid At: 1763436105
```

### Step 2: Cek Log Webhook

Cek apakah webhook pernah diterima oleh server:

```bash
# Cek PM2 logs
pm2 logs --lines 200 | grep -i "webhook\|tripay\|INV-202511-6709"

# Atau gunakan script
./scripts/check-webhook-logs.sh INV-202511-6709
```

**Cari keyword:**
- `[WEBHOOK]` - Webhook processing
- `[TRIPAY]` - Tripay specific logs
- `Invalid signature` - Signature verification failed
- `Failed to process` - Processing error

### Step 3: Cek Database

Cek status di database:

```bash
# Cek invoice status
sqlite3 data/billing.db "SELECT id, invoice_number, status, amount FROM invoices WHERE invoice_number LIKE '%6709%';"

# Cek payment gateway transaction
sqlite3 data/billing.db "SELECT id, gateway, order_id, token, status, amount FROM payment_gateway_transactions WHERE invoice_id = 83;"

# Cek payment records
sqlite3 data/billing.db "SELECT id, invoice_id, amount, payment_method, reference_number FROM payments WHERE invoice_id = 83;"
```

### Step 4: Proses Manual (Jika Payment Sudah PAID di Tripay)

Jika status di Tripay sudah PAID tapi belum diproses di sistem:

```bash
# Script akan otomatis memproses jika status PAID
node scripts/check-tripay-payment-status.js INV-202511-6709
```

Atau manual:

```bash
# 1. Update payment gateway transaction status
sqlite3 data/billing.db "UPDATE payment_gateway_transactions SET status = 'success' WHERE invoice_id = 83;"

# 2. Record payment dan kirim notifikasi
node scripts/fix-missing-payment-notification.js INV-202511-6709
```

### Step 5: Kirim Ulang Notifikasi

Jika payment sudah direcord tapi notifikasi belum terkirim:

```bash
# Cari payment ID terlebih dahulu
sqlite3 data/billing.db "SELECT id FROM payments WHERE invoice_id = 83 ORDER BY id DESC LIMIT 1;"

# Kirim ulang notifikasi (ganti 95 dengan payment ID yang ditemukan)
node scripts/resend-payment-notification.js 95
```

## Verifikasi

Setelah memperbaiki, verifikasi:

1. ✅ Invoice status = `paid`
2. ✅ Payment record ada di tabel `payments`
3. ✅ Payment gateway transaction status = `success`
4. ✅ Notifikasi WhatsApp terkirim

```bash
# Cek semua status sekaligus
sqlite3 data/billing.db "
SELECT 
    i.invoice_number,
    i.status as invoice_status,
    p.id as payment_id,
    p.amount as payment_amount,
    pgt.status as gateway_status
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id
LEFT JOIN payment_gateway_transactions pgt ON pgt.invoice_id = i.id
WHERE i.invoice_number LIKE '%6709%';
"
```

## Pencegahan

### 1. Pastikan Callback URL Valid
- Callback URL harus accessible dari internet
- Gunakan domain atau IP public, bukan localhost
- Pastikan port terbuka dan tidak di-block firewall

### 2. Monitor Logs
- Setup log monitoring untuk webhook
- Alert jika ada webhook yang gagal diproses
- Regular check untuk payment yang stuck

### 3. Setup Retry Mechanism
- Script otomatis untuk cek payment status setiap X jam
- Auto-process payment yang sudah PAID di Tripay
- Auto-resend notification jika gagal

## Script yang Tersedia

1. **check-tripay-payment-status.js**
   - Cek status payment di Tripay API
   - Auto-process jika sudah PAID
   - Auto-send notification

2. **fix-missing-payment-notification.js**
   - Fix payment yang sudah direcord tapi belum dapat notifikasi
   - Record payment manual jika perlu
   - Send notification

3. **resend-payment-notification.js**
   - Kirim ulang notifikasi untuk payment yang sudah ada

4. **check-webhook-logs.sh**
   - Cek log webhook dari berbagai sumber

## Contoh Kasus: INV-202511-6709

**Masalah:**
- Payment sukses di Tripay (status PAID)
- Invoice masih unpaid di sistem
- Tidak ada notifikasi

**Solusi:**
```bash
# 1. Cek status di Tripay API
node scripts/check-tripay-payment-status.js INV-202511-6709

# Output:
# ✅ Payment is PAID in Tripay!
# ✅ Payment recorded: Payment ID 95
# ✅ Invoice status updated to 'paid'
# ⚠️  Notification failed: WhatsApp not connected

# 2. Jika WhatsApp sudah terhubung, kirim ulang notifikasi
node scripts/resend-payment-notification.js 95
```

## Support

Jika masih ada masalah:
1. Cek log aplikasi untuk error detail
2. Cek Tripay dashboard untuk status payment
3. Verifikasi callback URL di Tripay settings
4. Pastikan WhatsApp terhubung untuk notifikasi

