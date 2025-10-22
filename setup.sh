#!/bin/bash

# Gembok Bill - Quick Setup Script
# Script untuk setup awal aplikasi Gembok Bill

echo "🚀 Gembok Bill - Quick Setup Script"
echo "=================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js tidak ditemukan. Installing Node.js..."
    
    # Install Node.js 20.x
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    echo "✅ Node.js berhasil diinstall"
else
    echo "✅ Node.js sudah terinstall: $(node --version)"
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm tidak ditemukan. Installing npm..."
    sudo apt-get install -y npm
    echo "✅ npm berhasil diinstall"
else
    echo "✅ npm sudah terinstall: $(npm --version)"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check if sqlite3 installation failed
if [ $? -ne 0 ]; then
    echo "⚠️  Ada masalah dengan sqlite3, mencoba rebuild..."
    npm rebuild sqlite3
    
    if [ $? -ne 0 ]; then
        echo "⚠️  Rebuild gagal, mencoba build from source..."
        npm install sqlite3 --build-from-source
    fi
fi

# Create settings.json from template if not exists
if [ ! -f "settings.json" ]; then
    echo "📝 Creating settings.json from template..."
    if [ -f "settings.server.template.json" ]; then
        cp settings.server.template.json settings.json
        echo "✅ settings.json created from template"
    else
        echo "⚠️  Template settings tidak ditemukan, buat manual settings.json"
    fi
else
    echo "✅ settings.json sudah ada"
fi

# Setup database
echo "🗄️  Setting up database..."
if [ -f "scripts/add-payment-gateway-tables.js" ]; then
    node scripts/add-payment-gateway-tables.js
    echo "✅ Database setup completed"
else
    echo "⚠️  Database setup script tidak ditemukan"
fi

# Create logs directory if not exists
if [ ! -d "logs" ]; then
    mkdir -p logs
    echo "✅ Logs directory created"
fi

# Create whatsapp-session directory if not exists
if [ ! -d "whatsapp-session" ]; then
    mkdir -p whatsapp-session
    echo "✅ WhatsApp session directory created"
fi

echo ""
echo "🎉 Setup selesai!"
echo ""
echo "📋 Langkah selanjutnya:"
echo "1. Edit settings.json dengan konfigurasi yang sesuai"
echo "2. Jalankan aplikasi dengan: npm start"
echo "3. Atau dengan PM2: pm2 start app.js --name gembok-bill"
echo ""
echo "🌐 Akses web portal di: http://localhost:3003"
echo "📱 Scan QR code untuk setup WhatsApp bot"
echo ""
echo "📚 Dokumentasi lengkap: README.md"
echo "🚀 Panduan instalasi cepat: INSTALL.md"
echo ""
echo "🆘 Support: 0813-6888-8498"
