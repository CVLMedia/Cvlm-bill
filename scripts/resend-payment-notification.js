const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const { getSetting } = require('../config/settingsManager');

const dbPath = path.join(__dirname, '../data/billing.db');

// Try to get base URL from settings or use default
function getBaseUrl() {
    try {
        const baseUrl = getSetting('app_base_url', '');
        if (baseUrl) {
            return baseUrl;
        }
        
        // Try to get port from environment or default
        const port = process.env.PORT || 3000;
        return `http://localhost:${port}`;
    } catch (error) {
        // Fallback to default
        return 'http://localhost:3000';
    }
}

async function resendPaymentNotification(paymentId, useApi = true) {
    // Try using API first (recommended - uses running app's WhatsApp socket)
    if (useApi) {
        try {
            const baseUrl = getBaseUrl();
            const adminToken = process.env.ADMIN_TOKEN || getSetting('admin_token', '');
            
            console.log(`\n📧 Mengirim ulang notifikasi untuk Payment ID: ${paymentId} (via API)`);
            
            // Get payment details first for display
            const db = new sqlite3.Database(dbPath);
            const payment = await new Promise((resolve, reject) => {
                db.get(`
                    SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.reference_number, p.payment_date,
                           i.invoice_number, i.customer_id,
                           c.name as customer_name, c.phone as customer_phone
                    FROM payments p
                    JOIN invoices i ON p.invoice_id = i.id
                    JOIN customers c ON i.customer_id = c.id
                    WHERE p.id = ?
                `, [paymentId], (err, row) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (payment) {
                console.log(`   Invoice: ${payment.invoice_number}`);
                console.log(`   Customer: ${payment.customer_name} (${payment.customer_phone})`);
                console.log(`   Amount: Rp ${payment.amount.toLocaleString('id-ID')}`);
            }
            
            // Call API endpoint (internal API, localhost only)
            const response = await axios.post(
                `${baseUrl}/api/internal/payments/${paymentId}/resend-notification`,
                {},
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000,
                    validateStatus: function (status) {
                        return status < 500; // Don't throw on 4xx errors
                    }
                }
            );
            
            if (response.data.success) {
                console.log(`   ✅ Notifikasi berhasil dikirim!`);
                if (response.data.withDocument) {
                    console.log(`   📄 PDF invoice terlampir`);
                }
                return response.data;
            } else {
                console.log(`   ❌ Gagal mengirim notifikasi: ${response.data.message || 'Unknown error'}`);
                if (response.data.skipped) {
                    console.log(`   ⚠️  Notifikasi dilewati: ${response.data.reason}`);
                }
                return response.data;
            }
        } catch (apiError) {
            if (apiError.response) {
                console.error(`   ❌ API Error: ${apiError.response.data?.message || apiError.message}`);
            } else if (apiError.code === 'ECONNREFUSED' || apiError.code === 'ETIMEDOUT') {
                console.warn(`   ⚠️  Tidak dapat terhubung ke aplikasi. Mencoba metode langsung...`);
                // Fallback to direct method
                return await resendPaymentNotification(paymentId, false);
            } else {
                console.error(`   ❌ Error: ${apiError.message}`);
                // Fallback to direct method
                return await resendPaymentNotification(paymentId, false);
            }
        }
    }
    
    // Direct method (requires WhatsApp socket to be initialized)
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath);
        
        // Get payment details
        db.get(`
            SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.reference_number, p.payment_date,
                   i.invoice_number, i.customer_id,
                   c.name as customer_name, c.phone as customer_phone
            FROM payments p
            JOIN invoices i ON p.invoice_id = i.id
            JOIN customers c ON i.customer_id = c.id
            WHERE p.id = ?
        `, [paymentId], async (err, payment) => {
            db.close();
            
            if (err) {
                console.error(`❌ Error fetching payment ${paymentId}:`, err.message);
                return reject(err);
            }
            
            if (!payment) {
                console.error(`❌ Payment ${paymentId} not found`);
                return reject(new Error('Payment not found'));
            }
            
            console.log(`\n📧 Mengirim ulang notifikasi untuk Payment ID: ${paymentId} (langsung)`);
            console.log(`   Invoice: ${payment.invoice_number}`);
            console.log(`   Customer: ${payment.customer_name} (${payment.customer_phone})`);
            console.log(`   Amount: Rp ${payment.amount.toLocaleString('id-ID')}`);
            
            try {
                const whatsappNotifications = require('../config/whatsapp-notifications');
                const result = await whatsappNotifications.sendPaymentReceivedNotification(paymentId);
                
                if (result.success) {
                    console.log(`   ✅ Notifikasi berhasil dikirim!`);
                    if (result.withDocument) {
                        console.log(`   📄 PDF invoice terlampir`);
                    }
                } else {
                    console.log(`   ❌ Gagal mengirim notifikasi: ${result.error || 'Unknown error'}`);
                    if (result.skipped) {
                        console.log(`   ⚠️  Notifikasi dilewati: ${result.reason}`);
                    }
                }
                
                resolve(result);
            } catch (error) {
                console.error(`   ❌ Error:`, error.message);
                reject(error);
            }
        });
    });
}

async function main() {
    const paymentIds = process.argv.slice(2).map(id => parseInt(id));
    
    if (paymentIds.length === 0) {
        console.log('Usage: node scripts/resend-payment-notification.js <payment_id1> [payment_id2] ...');
        console.log('\nContoh:');
        console.log('  node scripts/resend-payment-notification.js 88 103 87');
        process.exit(1);
    }
    
    console.log('🚀 Memulai pengiriman ulang notifikasi pembayaran...\n');
    
    for (const paymentId of paymentIds) {
        try {
            await resendPaymentNotification(paymentId);
        } catch (error) {
            console.error(`\n❌ Gagal mengirim notifikasi untuk Payment ID ${paymentId}:`, error.message);
        }
    }
    
    console.log('\n✅ Selesai!');
    process.exit(0);
}

main();

