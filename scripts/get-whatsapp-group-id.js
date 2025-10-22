const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { getSetting } = require('../config/settingsManager');

console.log('🔍 WHATSAPP GROUP ID FINDER');
console.log('='.repeat(50));
console.log('Script ini akan membantu Anda mendapatkan Group ID WhatsApp');
console.log('');

async function getWhatsAppGroupId() {
    try {
        console.log('📱 Memulai koneksi WhatsApp...');

        // Buat direktori session
        const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Load auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }),
            browser: ['Group ID Finder', 'Chrome', '1.0.0']
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Error) &&
                                      (lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut);

                if (shouldReconnect) {
                    console.log('🔄 Mencoba koneksi ulang...');
                    setTimeout(getWhatsAppGroupId, 5000);
                } else {
                    console.log('❌ Koneksi ditutup');
                }
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp terhubung!');
                console.log('');
                console.log('📋 Cara mendapatkan Group ID:');
                console.log('');
                console.log('1️⃣  BUKA WHATSAPP WEB ATAU MOBILE');
                console.log('   - Buka grup WhatsApp yang ingin Anda dapatkan ID-nya');
                console.log('');
                console.log('2️⃣  COPY LINK GRUP (Hanya untuk Admin)');
                console.log('   - Klik nama grup > Group info > Invite via link');
                console.log('   - Copy link yang muncul');
                console.log('   - Link format: https://chat.whatsapp.com/XXXXXXXXXXXXXXXXXX');
                console.log('');
                console.log('3️⃣  EKSTRAK GROUP ID');
                console.log('   - Ambil bagian setelah "chat.whatsapp.com/"');
                console.log('   - Tambahkan "@g.us" di akhir');
                console.log('');
                console.log('   Contoh:');
                console.log('   Link: https://chat.whatsapp.com/D1234567890ABCDEF');
                console.log('   Group ID: D1234567890ABCDEF@g.us');
                console.log('');
                console.log('   ATAU lengkap: 120363D1234567890ABCDEF@g.us');
                console.log('');

                console.log('🚀 METODE OTOMATIS:');
                console.log('Script ini akan menampilkan semua grup yang Anda ikuti...');

                // Dapatkan semua grup
                const groups = await sock.groupFetchAllParticipating();
                const groupList = Object.values(groups);

                if (groupList.length > 0) {
                    console.log('');
                    console.log('📱 GRUP WHATSAPP YANG ANDA IKUTI:');
                    console.log('='.repeat(60));

                    groupList.forEach((group, index) => {
                        console.log(`${index + 1}. NAMA: ${group.subject || 'Tidak ada nama'}`);
                        console.log(`   ID: ${group.id}`);
                        console.log(`   Owner: ${group.owner || 'Tidak diketahui'}`);
                        console.log(`   Participants: ${group.participants ? group.participants.length : 0} orang`);
                        console.log(`   Description: ${group.desc || 'Tidak ada deskripsi'}`);
                        console.log('');
                    });

                    console.log('💡 UNTUK COPY GROUP ID:');
                    console.log('   Copy nilai "ID" dari grup yang diinginkan');
                    console.log('   Contoh: 120363123456789012@g.us');
                    console.log('');
                    console.log('📝 FORMAT YANG BENAR:');
                    console.log('   ✅ 120363123456789012@g.us');
                    console.log('   ✅ 120363D1234567890ABCDEF@g.us');
                    console.log('   ❌ 120363123456789012 (tanpa @g.us)');
                    console.log('   ❌ https://chat.whatsapp.com/XXXXXX');

                } else {
                    console.log('❌ Tidak ada grup ditemukan');
                }

                // Tutup koneksi setelah mendapatkan info
                setTimeout(() => {
                    console.log('');
                    console.log('🔚 Menutup koneksi...');
                    sock.logout();
                    process.exit(0);
                }, 5000);
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            // Handle pesan jika diperlukan
        });

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Jalankan script
console.log('📱 Memulai WhatsApp Group ID Finder...');
console.log('📸 Jika diminta QR Code, silakan scan dengan WhatsApp');
console.log('');

getWhatsAppGroupId();
