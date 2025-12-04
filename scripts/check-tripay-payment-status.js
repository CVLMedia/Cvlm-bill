const path = require('path');
const crypto = require('crypto');
const { getSetting } = require('../config/settingsManager');
const billingManager = require('../config/billing');
const whatsappNotifications = require('../config/whatsapp-notifications');
const logger = require('../config/logger');

// Load Tripay config
function getTripayConfig() {
    const settings = getSetting('payment_gateway', {});
    const tripayConfig = settings.tripay || {};
    
    if (!tripayConfig.api_key || !tripayConfig.private_key || !tripayConfig.merchant_code) {
        throw new Error('Tripay configuration is incomplete. Please check settings.');
    }
    
    return {
        api_key: tripayConfig.api_key,
        private_key: tripayConfig.private_key,
        merchant_code: tripayConfig.merchant_code,
        production: tripayConfig.production !== false, // Default to production
        baseUrl: tripayConfig.production !== false 
            ? 'https://tripay.co.id/api' 
            : 'https://tripay.co.id/api-sandbox'
    };
}

// Check payment status from Tripay API
async function checkTripayPaymentStatus(reference) {
    const config = getTripayConfig();
    
    const fetchFn = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;
    
    console.log(`\n🔍 Checking payment status from Tripay API...`);
    console.log(`   Reference: ${reference}`);
    console.log(`   API URL: ${config.baseUrl}/transaction/detail`);
    
    try {
        const url = new URL(`${config.baseUrl}/transaction/detail`);
        url.searchParams.append('reference', reference);
        
        const response = await fetchFn(url.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${config.api_key}`,
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.message || `Tripay API error: ${response.status}`);
        }
        
        return result.data;
    } catch (error) {
        console.error(`❌ Error checking Tripay payment status:`, error.message);
        throw error;
    }
}

// Check webhook logs (from application logs)
async function checkWebhookLogs(invoiceNumber) {
    console.log(`\n📋 Checking webhook logs for invoice: ${invoiceNumber}`);
    console.log(`   ⚠️  Note: Check application logs for webhook entries`);
    console.log(`   Look for entries containing: [WEBHOOK], [TRIPAY], ${invoiceNumber}`);
}

// Process payment manually if Tripay status is PAID
async function processManualPayment(invoiceId, tripayData) {
    console.log(`\n💰 Processing manual payment...`);
    
    try {
        const invoice = await billingManager.getInvoiceById(invoiceId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }
        
        // Check if payment already exists
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const existingPayment = await new Promise((resolve, reject) => {
            db.get(`
                SELECT id FROM payments 
                WHERE invoice_id = ? AND reference_number = ?
            `, [invoiceId, tripayData.merchant_ref], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existingPayment) {
            console.log(`   ⚠️  Payment already exists: Payment ID ${existingPayment.id}`);
            return { success: false, message: 'Payment already exists', paymentId: existingPayment.id };
        }
        
        // Record payment
        const paymentData = {
            invoice_id: invoiceId,
            amount: tripayData.amount,
            payment_method: 'online',
            reference_number: tripayData.merchant_ref,
            notes: `Payment via Tripay - ${tripayData.payment_method || 'online'} (Manual process from API check)`
        };
        
        const paymentResult = await billingManager.recordPayment(paymentData);
        
        if (!paymentResult || !paymentResult.success || !paymentResult.id) {
            throw new Error('Failed to record payment');
        }
        
        console.log(`   ✅ Payment recorded: Payment ID ${paymentResult.id}`);
        
        // Update invoice status
        await billingManager.updateInvoiceStatus(invoiceId, 'paid', 'online');
        console.log(`   ✅ Invoice status updated to 'paid'`);
        
        // Update payment gateway transaction status
        const db2 = new sqlite3.Database(dbPath);
        await new Promise((resolve, reject) => {
            db2.run(`
                UPDATE payment_gateway_transactions
                SET status = 'success', 
                    payment_type = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE invoice_id = ? AND order_id = ?
            `, [tripayData.payment_method || 'online', invoiceId, tripayData.merchant_ref], (err) => {
                db2.close();
                if (err) reject(err);
                else resolve();
            });
        });
        console.log(`   ✅ Payment gateway transaction updated`);
        
        // Send notification
        console.log(`\n📧 Sending payment notification...`);
        try {
            const notifResult = await whatsappNotifications.sendPaymentReceivedNotification(paymentResult.id);
            
            if (notifResult && notifResult.success) {
                console.log(`   ✅ Notification sent successfully!`);
            } else {
                console.log(`   ⚠️  Notification returned:`, notifResult);
            }
            
            return { 
                success: true, 
                paymentId: paymentResult.id, 
                notificationSent: notifResult?.success 
            };
        } catch (notifError) {
            console.error(`   ❌ Error sending notification:`, notifError.message);
            return { 
                success: true, 
                paymentId: paymentResult.id, 
                notificationSent: false,
                notificationError: notifError.message
            };
        }
    } catch (error) {
        console.error(`   ❌ Error:`, error.message);
        throw error;
    }
}

// Main function
async function main() {
    const invoiceNumber = process.argv[2];
    
    if (!invoiceNumber) {
        console.log('Usage: node scripts/check-tripay-payment-status.js <invoice_number>');
        console.log('\nContoh:');
        console.log('  node scripts/check-tripay-payment-status.js INV-202511-6709');
        console.log('\nScript ini akan:');
        console.log('  1. Mencari invoice dan payment gateway transaction');
        console.log('  2. Mengecek status payment di Tripay API');
        console.log('  3. Memproses payment manual jika status PAID di Tripay');
        console.log('  4. Mengirim notifikasi WhatsApp');
        process.exit(1);
    }
    
    console.log('🔍 Checking Tripay Payment Status\n');
    console.log(`Invoice: ${invoiceNumber}\n`);
    
    try {
        // Find invoice
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const invoice = await new Promise((resolve, reject) => {
            db.get(`
                SELECT i.id, i.invoice_number, i.status, i.amount, i.customer_id,
                       c.name as customer_name, c.phone as customer_phone
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                WHERE i.invoice_number = ? OR i.invoice_number LIKE ?
            `, [invoiceNumber, `%${invoiceNumber}%`], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!invoice) {
            console.error(`❌ Invoice not found: ${invoiceNumber}`);
            process.exit(1);
        }
        
        console.log(`📋 Invoice ditemukan:`);
        console.log(`   ID: ${invoice.id}`);
        console.log(`   Nomor: ${invoice.invoice_number}`);
        console.log(`   Status: ${invoice.status}`);
        console.log(`   Amount: Rp ${invoice.amount.toLocaleString('id-ID')}`);
        console.log(`   Customer: ${invoice.customer_name} (${invoice.customer_phone})`);
        
        // Find payment gateway transaction
        const db2 = new sqlite3.Database(dbPath);
        const transaction = await new Promise((resolve, reject) => {
            db2.get(`
                SELECT id, gateway, order_id, token, status, amount, payment_type, payment_method
                FROM payment_gateway_transactions
                WHERE invoice_id = ?
                ORDER BY id DESC
                LIMIT 1
            `, [invoice.id], (err, row) => {
                db2.close();
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!transaction) {
            console.error(`❌ Payment gateway transaction not found for invoice ${invoice.id}`);
            process.exit(1);
        }
        
        console.log(`\n📦 Payment Gateway Transaction:`);
        console.log(`   Gateway: ${transaction.gateway}`);
        console.log(`   Order ID: ${transaction.order_id}`);
        console.log(`   Token/Reference: ${transaction.token || 'N/A'}`);
        console.log(`   Status (Local): ${transaction.status}`);
        console.log(`   Amount: Rp ${transaction.amount.toLocaleString('id-ID')}`);
        console.log(`   Payment Method: ${transaction.payment_method || transaction.payment_type || 'N/A'}`);
        
        // Check status from Tripay API
        if (transaction.gateway !== 'tripay') {
            console.log(`\n⚠️  Gateway is not Tripay, cannot check API status`);
            process.exit(0);
        }
        
        // Use token as reference (Tripay reference is stored in token column)
        const referenceToCheck = transaction.token;
        
        if (!referenceToCheck) {
            console.error(`❌ No reference or order_id found for transaction`);
            process.exit(1);
        }
        
        try {
            const tripayData = await checkTripayPaymentStatus(referenceToCheck);
            
            console.log(`\n✅ Tripay API Response:`);
            console.log(`   Reference: ${tripayData.reference}`);
            console.log(`   Merchant Ref: ${tripayData.merchant_ref}`);
            console.log(`   Status: ${tripayData.status}`);
            console.log(`   Amount: Rp ${tripayData.amount.toLocaleString('id-ID')}`);
            console.log(`   Payment Method: ${tripayData.payment_method || 'N/A'}`);
            console.log(`   Paid At: ${tripayData.paid_at || 'N/A'}`);
            console.log(`   Expired At: ${tripayData.expired_at || 'N/A'}`);
            
            // Check if payment is PAID in Tripay
            if (tripayData.status === 'PAID') {
                console.log(`\n✅ Payment is PAID in Tripay!`);
                
                // Check local status
                if (invoice.status === 'paid') {
                    console.log(`   ℹ️  Invoice already marked as paid locally`);
                    
                    // Check if payment record exists
                    const db3 = new sqlite3.Database(dbPath);
                    const payment = await new Promise((resolve, reject) => {
                        db3.get(`
                            SELECT id FROM payments WHERE invoice_id = ?
                        `, [invoice.id], (err, row) => {
                            db3.close();
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    
                    if (payment) {
                        console.log(`   ℹ️  Payment record exists: Payment ID ${payment.id}`);
                        console.log(`\n📧 Sending notification...`);
                        const notifResult = await whatsappNotifications.sendPaymentReceivedNotification(payment.id);
                        if (notifResult && notifResult.success) {
                            console.log(`   ✅ Notification sent!`);
                        } else {
                            console.log(`   ⚠️  Notification:`, notifResult);
                        }
                    } else {
                        console.log(`   ⚠️  Payment record not found, processing...`);
                        const result = await processManualPayment(invoice.id, tripayData);
                        console.log(`\n✅ Result:`, result);
                    }
                } else {
                    console.log(`   ⚠️  Invoice not marked as paid locally, processing...`);
                    const result = await processManualPayment(invoice.id, tripayData);
                    console.log(`\n✅ Result:`, result);
                }
            } else if (tripayData.status === 'UNPAID') {
                console.log(`\n⚠️  Payment is still UNPAID in Tripay`);
                console.log(`   Status lokal: ${invoice.status}`);
                console.log(`   Status Tripay: ${tripayData.status}`);
            } else if (tripayData.status === 'EXPIRED' || tripayData.status === 'FAILED') {
                console.log(`\n❌ Payment is ${tripayData.status} in Tripay`);
            } else {
                console.log(`\n⚠️  Unknown status: ${tripayData.status}`);
            }
            
        } catch (apiError) {
            console.error(`\n❌ Error checking Tripay API:`, apiError.message);
            console.log(`\n💡 Kemungkinan masalah:`);
            console.log(`   1. Webhook dari Tripay belum terkirim`);
            console.log(`   2. Webhook terkirim tapi gagal diproses (cek log aplikasi)`);
            console.log(`   3. Reference/Order ID tidak valid`);
            
            // Check webhook logs suggestion
            await checkWebhookLogs(invoiceNumber);
        }
        
        console.log(`\n✅ Selesai!`);
        process.exit(0);
        
    } catch (error) {
        console.error(`\n❌ Error:`, error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();

