# 🔧 Panduan Troubleshooting Instalasi

## ❌ Error: `SQLITE_ERROR: no such table: invoices`

### 🎯 **Masalah yang Ditemukan**

Ketika menjalankan script `node scripts/add-payment-gateway-tables.js` pada instalasi baru, muncul error:

```
Error adding payment_gateway column: Error: SQLITE_ERROR: no such table: invoices
Error adding payment_token column: Error: SQLITE_ERROR: no such table: invoices
Error adding payment_url column: Error: SQLITE_ERROR: no such table: invoices
Error adding payment_status column: Error: SQLITE_ERROR: no such table: invoices
```

### 🔍 **Penyebab Masalah**

1. **Script `add-payment-gateway-tables.js` dirancang untuk instalasi fresh**, tetapi database sudah memiliki struktur yang lebih lengkap
2. **Tabel `invoices` sudah ada** dengan kolom-kolom payment gateway yang sudah terintegrasi
3. **Script mencoba menambahkan kolom yang sudah ada**, sehingga terjadi konflik

### ✅ **Solusi yang Diterapkan**

Script `add-payment-gateway-tables.js` telah diperbaiki dengan fitur-fitur berikut:

#### 🔍 **Smart Detection**
- **Cek keberadaan tabel** sebelum melakukan operasi
- **Cek keberadaan kolom** sebelum menambahkan kolom baru
- **Prevent duplicate operations** untuk menghindari error

#### 🛠️ **Improved Error Handling**
- **Graceful error handling** dengan try-catch
- **Informative logging** untuk setiap operasi
- **Idempotent operations** - bisa dijalankan berulang kali tanpa error

#### 📋 **New Features**
```javascript
// Function to check if table exists
function checkTableExists(tableName) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
}

// Function to check if column exists in table
function checkColumnExists(tableName, columnName) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
            if (err) reject(err);
            else {
                const exists = rows.some(col => col.name === columnName);
                resolve(exists);
            }
        });
    });
}
```

### 🚀 **Cara Menggunakan Script yang Sudah Diperbaiki**

#### **1. Jalankan Script**
```bash
cd /path/to/cvlintasmultimedia
node scripts/add-payment-gateway-tables.js
```

#### **2. Output yang Diharapkan**
```
🔍 Checking payment gateway database setup...
✅ invoices table found
✅ payment_gateway_transactions table already exists
✅ payment_gateway column already exists in invoices table
✅ payment_token column already exists in invoices table
✅ payment_url column already exists in invoices table
✅ payment_status column already exists in invoices table
📝 Creating indexes...
✅ Index created for payment_gateway_transactions invoice_id
✅ Index created for payment_gateway_transactions order_id
🎉 Payment gateway database setup completed successfully!
```

### 📋 **Struktur Database yang Benar**

#### **Tabel `invoices`**
```sql
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    due_date DATE NOT NULL,
    status TEXT DEFAULT 'unpaid',
    payment_date DATETIME,
    payment_method TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Payment Gateway Columns (sudah terintegrasi)
    payment_url TEXT,
    payment_token VARCHAR(255),
    payment_status VARCHAR(50) DEFAULT 'pending',
    payment_gateway VARCHAR(50),
    -- Additional columns
    base_amount DECIMAL(10,2),
    tax_rate DECIMAL(5,2),
    description TEXT NULL,
    package_name TEXT NULL,
    invoice_type TEXT DEFAULT 'monthly' CHECK (invoice_type IN ('monthly', 'voucher', 'manual')),
    FOREIGN KEY (customer_id) REFERENCES customers (id),
    FOREIGN KEY (package_id) REFERENCES packages (id)
);
```

#### **Tabel `payment_gateway_transactions`**
```sql
CREATE TABLE payment_gateway_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER,
    gateway VARCHAR(50),
    order_id VARCHAR(100),
    payment_url TEXT,
    token VARCHAR(255),
    amount DECIMAL(10,2),
    status VARCHAR(50),
    payment_type VARCHAR(50),
    fraud_status VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    payment_method VARCHAR(50),
    gateway_name VARCHAR(50),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);
```

### 🔄 **Proses Instalasi yang Benar**

#### **1. Setup Awal**
```bash
# Clone repository
git clone https://github.com/enosrotua/cvlintasmultimedia.git
cd cvlintasmultimedia

# Install dependencies
npm install

# Setup database (jalankan aplikasi sekali untuk membuat tabel)
npm start
# Tekan Ctrl+C setelah aplikasi berjalan
```

#### **2. Setup Payment Gateway**
```bash
# Jalankan script payment gateway
node scripts/add-payment-gateway-tables.js
```

#### **3. Konfigurasi**
```bash
# Edit settings.json sesuai kebutuhan
nano settings.json

# Jalankan aplikasi
npm start
```

### 🛡️ **Prevention Tips**

#### **Untuk Developer**
1. **Selalu cek keberadaan tabel/kolom** sebelum operasi database
2. **Gunakan `CREATE TABLE IF NOT EXISTS`** untuk tabel baru
3. **Gunakan `ALTER TABLE` dengan cek kolom** untuk modifikasi
4. **Test script pada database yang sudah ada**

#### **Untuk User**
1. **Jalankan aplikasi sekali** sebelum menjalankan script database
2. **Backup database** sebelum menjalankan script migrasi
3. **Baca error message** dengan teliti untuk troubleshooting

### 📞 **Support**

Jika masih mengalami masalah:

1. **Cek log aplikasi** untuk error detail
2. **Verifikasi struktur database** dengan sqlite3
3. **Hubungi support**: 0813-6888-8498

---

**Dokumentasi ini dibuat untuk membantu troubleshooting instalasi CV Lintas Multimedia.**
