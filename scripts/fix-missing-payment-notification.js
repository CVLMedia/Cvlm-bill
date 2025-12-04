const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const billingManager = require('../config/billing');
const whatsappNotifications = require('../config/whatsapp-notifications');
const logger = require('../config/logger');

const dbPath = path.join(__dirname, '../data/billing.db');

async function fixMissingPaymentNotification(invoiceNumber) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath);
        
        // Find invoice by number
        db.get(`
            SELECT i.id, i.invoice_number, i.status, i.amount, i.customer_id, i.payment_gateway,
                   c.name as customer_name, c.phone as customer_phone
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
            WHERE i.invoice_number = ? OR i.invoice_number LIKE ?
        `, [invoiceNumber, `%${invoiceNumber}%`], async (err, invoice) => {
            if (err) {
                db.close();
                return reject(err);
            }
            
            if (!invoice) {
                db.close();
                return reject(new Error(`Invoice not found: ${invoiceNumber}`));
            }
            
            console.log(`\n📋 Invoice ditemukan:`);
            console.log(`   ID: ${invoice.id}`);
            console.log(`   Nomor: ${invoice.invoice_number}`);
            console.log(`   Status: ${invoice.status}`);
            console.log(`   Amount: Rp ${invoice.amount.toLocaleString('id-ID')}`);
            console.log(`   Customer: ${invoice.customer_name} (${invoice.customer_phone})`);
            
            // Check if payment already exists
            db.get(`
                SELECT id, amount, payment_method, reference_number, payment_date
                FROM payments
                WHERE invoice_id = ?
                ORDER BY id DESC
                LIMIT 1
            `, [invoice.id], async (paymentErr, payment) => {
                if (paymentErr) {
                    db.close();
                    return reject(paymentErr);
                }
                
                if (payment) {
                    console.log(`\n✅ Payment sudah ada:`);
                    console.log(`   Payment ID: ${payment.id}`);
                    console.log(`   Amount: Rp ${payment.amount.toLocaleString('id-ID')}`);
                    console.log(`   Method: ${payment.payment_method}`);
                    console.log(`   Reference: ${payment.reference_number}`);
                    console.log(`   Date: ${payment.payment_date}`);
                    
                    // Check payment gateway transaction
                    db.get(`
                        SELECT id, gateway, order_id, status, amount, payment_type
                        FROM payment_gateway_transactions
                        WHERE invoice_id = ?
                        ORDER BY id DESC
                        LIMIT 1
                    `, [invoice.id], async (txErr, transaction) => {
                        db.close();
                        
                        if (transaction) {
                            console.log(`\n📦 Payment Gateway Transaction:`);
                            console.log(`   Gateway: ${transaction.gateway}`);
                            console.log(`   Order ID: ${transaction.order_id}`);
                            console.log(`   Status: ${transaction.status}`);
                            console.log(`   Amount: Rp ${transaction.amount.toLocaleString('id-ID')}`);
                        }
                        
                        // Send notification via API endpoint (uses running app's WhatsApp connection)
                        console.log(`\n📧 Mengirim notifikasi pembayaran...`);
                        try {
                            // Try API endpoint first (uses running app's WhatsApp)
                            // Always use localhost for internal API endpoint
                            const axios = require('axios');
                            const { getSetting } = require('../config/settingsManager');
                            const port = getSetting('server_port', 3003);
                            const baseUrl = `http://localhost:${port}`;
                            
                            try {
                                console.log(`   🔄 Mencoba kirim via API endpoint...`);
                                const apiResult = await axios.post(
                                    `${baseUrl}/api/internal/payments/${payment.id}/resend-notification`,
                                    {},
                                    { timeout: 30000 }
                                );
                                
                                if (apiResult.data && apiResult.data.success) {
                                    console.log(`   ✅ Notifikasi berhasil dikirim via API!`);
                                    resolve({ success: true, paymentId: payment.id, notificationSent: true, method: 'api' });
                                    return;
                                }
                            } catch (apiError) {
                                if (apiError.code === 'ECONNREFUSED' || apiError.code === 'ETIMEDOUT') {
                                    console.log(`   ⚠️  Tidak bisa terhubung ke aplikasi (${apiError.code}), mencoba metode langsung...`);
                                } else {
                                    console.log(`   ⚠️  API endpoint gagal: ${apiError.message}, mencoba metode langsung...`);
                                }
                            }
                            
                            // Fallback to direct method
                            const result = await whatsappNotifications.sendPaymentReceivedNotification(payment.id);
                            
                            if (result && result.success) {
                                console.log(`   ✅ Notifikasi berhasil dikirim!`);
                                if (result.withDocument) {
                                    console.log(`   📄 PDF invoice terlampir`);
                                }
                            } else {
                                console.log(`   ❌ Gagal mengirim notifikasi:`, result);
                            }
                            
                            resolve({ success: true, paymentId: payment.id, notificationSent: result?.success, method: 'direct' });
                        } catch (notifError) {
                            console.error(`   ❌ Error mengirim notifikasi:`, notifError.message);
                            reject(notifError);
                        }
                    });
                } else {
                    db.close();
                    
                    // Check payment gateway transaction
                    db.get(`
                        SELECT id, gateway, order_id, status, amount, payment_type
                        FROM payment_gateway_transactions
                        WHERE invoice_id = ?
                        ORDER BY id DESC
                        LIMIT 1
                    `, [invoice.id], async (txErr, transaction) => {
                        if (txErr) {
                            return reject(txErr);
                        }
                        
                        if (transaction && transaction.status === 'success') {
                            console.log(`\n⚠️  Payment gateway transaction sudah success tapi payment belum direcord!`);
                            console.log(`   Gateway: ${transaction.gateway}`);
                            console.log(`   Order ID: ${transaction.order_id}`);
                            console.log(`   Status: ${transaction.status}`);
                            
                            // Record payment manually
                            console.log(`\n💰 Mencatat payment...`);
                            try {
                                const paymentData = {
                                    invoice_id: invoice.id,
                                    amount: transaction.amount || invoice.amount,
                                    payment_method: 'online',
                                    reference_number: transaction.order_id,
                                    notes: `Payment via ${transaction.gateway} - ${transaction.payment_type || 'online'} (Manual fix)`
                                };
                                
                                const paymentResult = await billingManager.recordPayment(paymentData);
                                
                                if (paymentResult && paymentResult.success && paymentResult.id) {
                                    console.log(`   ✅ Payment berhasil dicatat: Payment ID ${paymentResult.id}`);
                                    
                                    // Update invoice status
                                    await billingManager.updateInvoiceStatus(invoice.id, 'paid', 'online');
                                    console.log(`   ✅ Invoice status diupdate menjadi 'paid'`);
                                    
                                    // Send notification via API endpoint (uses running app's WhatsApp connection)
                                    console.log(`\n📧 Mengirim notifikasi pembayaran...`);
                                    try {
                                        // Try API endpoint first (uses running app's WhatsApp)
                                        // Always use localhost for internal API endpoint
                                        const axios = require('axios');
                                        const { getSetting } = require('../config/settingsManager');
                                        const port = getSetting('server_port', 3003);
                                        const baseUrl = `http://localhost:${port}`;
                                        
                                        try {
                                            console.log(`   🔄 Mencoba kirim via API endpoint...`);
                                            const apiResult = await axios.post(
                                                `${baseUrl}/api/internal/payments/${paymentResult.id}/resend-notification`,
                                                {},
                                                { timeout: 30000 }
                                            );
                                            
                                            if (apiResult.data && apiResult.data.success) {
                                                console.log(`   ✅ Notifikasi berhasil dikirim via API!`);
                                                resolve({ success: true, paymentId: paymentResult.id, notificationSent: true, method: 'api' });
                                                return;
                                            }
                                        } catch (apiError) {
                                            if (apiError.code === 'ECONNREFUSED' || apiError.code === 'ETIMEDOUT') {
                                                console.log(`   ⚠️  Tidak bisa terhubung ke aplikasi (${apiError.code}), mencoba metode langsung...`);
                                            } else {
                                                console.log(`   ⚠️  API endpoint gagal: ${apiError.message}, mencoba metode langsung...`);
                                            }
                                        }
                                        
                                        // Fallback to direct method
                                        const notifResult = await whatsappNotifications.sendPaymentReceivedNotification(paymentResult.id);
                                        
                                        if (notifResult && notifResult.success) {
                                            console.log(`   ✅ Notifikasi berhasil dikirim!`);
                                        } else {
                                            console.log(`   ❌ Gagal mengirim notifikasi:`, notifResult);
                                        }
                                        
                                        resolve({ success: true, paymentId: paymentResult.id, notificationSent: notifResult?.success, method: 'direct' });
                                    } catch (notifError) {
                                        console.error(`   ❌ Error mengirim notifikasi:`, notifError.message);
                                        resolve({ success: true, paymentId: paymentResult.id, notificationSent: false, error: notifError.message });
                                    }
                                } else {
                                    reject(new Error('Failed to record payment'));
                                }
                            } catch (paymentError) {
                                console.error(`   ❌ Error:`, paymentError.message);
                                reject(paymentError);
                            }
                        } else {
                            console.log(`\n⚠️  Invoice belum dibayar atau payment gateway transaction belum success`);
                            if (transaction) {
                                console.log(`   Transaction status: ${transaction.status}`);
                            }
                            resolve({ success: false, message: 'Invoice not paid yet' });
                        }
                    });
                }
            });
        });
    });
}

async function main() {
    const invoiceNumber = process.argv[2];
    
    if (!invoiceNumber) {
        console.log('Usage: node scripts/fix-missing-payment-notification.js <invoice_number>');
        console.log('\nContoh:');
        console.log('  node scripts/fix-missing-payment-notification.js INV-202511-6709');
        process.exit(1);
    }
    
    console.log('🔧 Memperbaiki notifikasi pembayaran yang hilang...\n');
    
    try {
        const result = await fixMissingPaymentNotification(invoiceNumber);
        console.log('\n✅ Selesai!');
        console.log('Result:', result);
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();

