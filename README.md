# CVLMEDIA Billing System

Sistem billing lengkap untuk ISP dengan dukungan multi-NAS (Mikrotik) dan multi-GenieACS server.

## Fitur Utama

- ✅ Multi-NAS (Network Access Server) Management
- ✅ Multi-GenieACS Server Support
- ✅ Customer Management dengan Mapping ke NAS
- ✅ Billing & Invoice System
- ✅ PPPoE & Hotspot User Management
- ✅ Auto Isolation/Suspension
- ✅ Payment Collection System
- ✅ Customer Portal
- ✅ Real-time Monitoring Dashboard
- ✅ WhatsApp Integration

## Requirements

- Node.js >= 14.x
- npm atau yarn
- SQLite3 (built-in dengan Node.js)
- PM2 (untuk production)

## Installation

### 1. Clone Repository

```bash
git clone https://github.com/enosrotua/BillCVLmedia.git
cd BillCVLmedia
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Configuration

Buat file `settings.json` dari template:

```bash
cp settings.server.template.json settings.json
```

Edit `settings.json` sesuai kebutuhan:

- `admins.0`: Nomor WhatsApp admin utama
- `server_host`: IP/hostname server
- `server_port`: Port aplikasi (default: 3003)
- `company_header`: Nama perusahaan
- Dan lainnya sesuai kebutuhan

### 4. Initialize Database

Database SQLite akan otomatis dibuat saat pertama kali aplikasi dijalankan di `data/billing.db`.

### 5. Setup NAS (Mikrotik Routers)

Buka halaman `/admin/routers` dan tambahkan NAS devices (Mikrotik routers) dengan konfigurasi:
- Nama NAS
- IP Address
- Port API (default: 8728)
- Username
- Password
- GenieACS Server (opsional)

### 6. Setup GenieACS Servers (Optional)

Buka halaman `/admin/genieacs-servers` dan tambahkan GenieACS servers:
- Nama Server
- URL (contoh: http://192.168.1.100:7557)
- Username
- Password

### 7. Run Application

#### Development Mode

```bash
npm start
```

#### Production Mode (dengan PM2)

```bash
pm2 start app.js --name cvlmedia
pm2 save
pm2 startup
```

Aplikasi akan berjalan di `http://localhost:3003` (atau port yang dikonfigurasi).

## Default Login

- Username: `admin` (atau sesuai `settings.json`)
- Password: `admin` (atau sesuai `settings.json`)

**⚠️ PENTING: Ubah password admin setelah pertama kali login!**

## Konfigurasi Penting

### Multi-NAS Setup

1. Tambahkan NAS devices di `/admin/routers`
2. Setiap customer harus di-mapping ke NAS tertentu
3. Sistem akan otomatis menggunakan NAS yang sesuai untuk setiap operasi

### Multi-GenieACS Setup

1. Tambahkan GenieACS servers di `/admin/genieacs-servers`
2. Mapping GenieACS server ke router di `/admin/routers`
3. Sistem akan otomatis menggunakan server yang sesuai berdasarkan mapping customer → router → GenieACS server

### Customer Portal

Akses customer portal di:
- Login: `/customer/login`
- Dashboard: `/customer/dashboard` (setelah login)

Customer dapat login menggunakan nomor telepon yang terdaftar di sistem billing.

## Struktur Direktori

```
BillCVLmedia/
├── config/           # Konfigurasi dan helper functions
├── data/             # Database SQLite (git-ignored)
├── public/           # Static files (CSS, JS, images)
├── routes/           # Express routes
├── views/            # EJS templates
├── app.js            # Main application file
├── settings.json     # Configuration file (git-ignored)
└── package.json      # Node.js dependencies
```

## File yang Di-ignore (Git)

- `settings.json` - Konfigurasi aplikasi (sensitive)
- `data/billing.db` - Database SQLite
- `whatsapp-session/` - WhatsApp session files
- `node_modules/` - Dependencies
- `.env` - Environment variables

## Update dari Repository

```bash
git pull origin main
npm install  # Jika ada dependency baru
pm2 restart cvlmedia
```

## Troubleshooting

### Database Error

Jika ada error database, pastikan direktori `data/` dapat ditulis:

```bash
chmod 755 data/
```

### Port Already in Use

Ubah `server_port` di `settings.json` atau stop aplikasi yang menggunakan port tersebut.

### WhatsApp Connection Issue

Pastikan:
1. Nomor WhatsApp admin sudah benar di `settings.json`
2. WhatsApp session tidak expired (hapus folder `whatsapp-session/` untuk regenerate)

## Support

Untuk pertanyaan atau issue, silakan buat issue di repository GitHub ini.

## License

Proprietary - CV Lintas Multimedia
