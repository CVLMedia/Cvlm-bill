# Dark & Light Theme System

Sistem tema gelap dan terang telah ditambahkan ke dalam aplikasi GEMBOK-BILL. Pengguna sekarang dapat beralih antara tema terang (light) dan tema gelap (dark).

## Fitur

- **Tema Terang (Light Mode)**: Tema default dengan warna terang untuk penggunaan siang hari
- **Tema Gelap (Dark Mode)**: Tema gelap dengan warna yang nyaman untuk mata
- **Toggle Mudah**: Tombol untuk beralih antar tema
- **Penyimpanan Preferensi**: Preferensi tema tersimpan di localStorage
- **Transisi Smooth**: Perubahan tema dengan animasi halus

## Cara Menggunakan

### 1. Toggle Tema
- Klik tombol dengan ikon bulan/matahari di sidebar
- Teks tombol akan berubah otomatis sesuai tema yang aktif:
  - **Dark Mode**: Ketika sedang dalam mode terang
  - **Light Mode**: Ketika sedang dalam mode gelap

### 2. Pemilihan Tema Otomatis
- Saat pertama kali membuka aplikasi, sistem akan menggunakan:
  - Tema terang sebagai default
  - Atau tema yang pernah dipilih pengguna sebelumnya (tersimpan di browser)

## File yang Ditambahkan/Dimodifikasi

### File Baru
1. `public/js/theme-switcher.js` - JavaScript untuk mengelola tema
2. `views/partials/theme-switcher.ejs` - Komponen tombol toggle tema

### File yang Dimodifikasi
1. `public/css/theme.css` - Sistem tema dengan support light & dark mode
2. `views/partials/admin-header.ejs` - Menambahkan script theme-switcher
3. `views/partials/admin-sidebar.ejs` - Menambahkan tombol toggle
4. `views/partials/admin-responsive-sidebar.ejs` - Menambahkan tombol toggle dan styling
5. `views/adminDashboard.ejs` - Menambahkan script theme-switcher

## Struktur Tema

### CSS Variables
Sistem tema menggunakan CSS custom properties (variables) yang didefinisikan di `public/css/theme.css`:

```css
/* Light Theme */
--bg-0: #f5f6fa
--bg-1: #ffffff
--text: #212529
--border: #dee2e6
...

/* Dark Theme */
--bg-0: #0f172a
--bg-1: #111827
--text: #e5e7eb
--border: #263244
...
```

### Atribut Data
Aplikasi menggunakan atribut `data-theme` pada elemen `<html>` atau `<body>`:
- `data-theme="light"` - Tema terang
- `data-theme="dark"` - Tema gelap

## Cara Menambahkan Tema ke Halaman Baru

Untuk menambahkan support tema di halaman baru:

1. **Include CSS Theme:**
```html
<link href="/css/theme.css?v=1" rel="stylesheet">
```

2. **Include JavaScript Theme Switcher:**
```html
<script src="/js/theme-switcher.js" defer></script>
```

3. **Include Tombol Toggle (Optional):**
```html
<a href="#" class="nav-link" data-theme-toggle>
  <i id="theme-icon" class="bi bi-moon-fill"></i>
  <span id="theme-text">Dark Mode</span>
</a>
```

## Komponen yang Mendukung Tema

Semua komponen UI berikut akan otomatis berubah sesuai tema:
- Cards
- Tables
- Forms
- Buttons
- Navbar
- Modals
- Dropdowns
- Alerts
- Badges
- Sidebar

## Customization

### Mengubah Warna Tema

Edit file `public/css/theme.css` dan modifikasi CSS variables:

```css
/* Light Theme */
:root,
[data-theme="light"] {
  --primary: #3b82f6;
  --primary-2: #2563eb;
  /* ... */
}

/* Dark Theme */
[data-theme="dark"] {
  --primary: #60a5fa;
  --primary-2: #3b82f6;
  /* ... */
}
```

### Menambahkan Elemen yang Mendukung Tema

Tambahkan styling untuk elemen baru di `public/css/theme.css`:

```css
/* Contoh */
.my-custom-element {
  background-color: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
}
```

## Browser Support

Sistem tema bekerja di semua browser modern yang mendukung:
- CSS Custom Properties
- localStorage API
- data attributes

## Troubleshooting

### Tema tidak berubah
1. Pastikan file `theme-switcher.js` sudah dimuat
2. Periksa browser console untuk error JavaScript
3. Pastikan `data-theme` attribute ada di elemen HTML

### Preferensi tidak tersimpan
1. Pastikan localStorage enabled di browser
2. Periksa browser settings (private/incognito mode dapat membatasi localStorage)

## Teknologi yang Digunakan

- CSS Custom Properties (CSS Variables)
- CSS Transitions untuk animasi smooth
- JavaScript localStorage untuk menyimpan preferensi
- Bootstrap Icons untuk ikon tema

