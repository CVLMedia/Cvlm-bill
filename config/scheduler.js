const cron = require('node-cron');
const billingManager = require('./billing');
const logger = require('./logger');

class InvoiceScheduler {
    constructor() {
        this.initScheduler();
    }

    initScheduler() {
        // Schedule monthly invoice generation on 1st of every month at 08:00
        cron.schedule('0 8 1 * *', async () => {
            try {
                logger.info('Starting automatic monthly invoice generation (08:00)...');
                await this.generateMonthlyInvoices();
                logger.info('Automatic monthly invoice generation completed');
            } catch (error) {
                logger.error('Error in automatic monthly invoice generation:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });

        logger.info('Invoice scheduler initialized - will run on 1st of every month at 08:00');
        
        // Daily invoice generation by billing_day is disabled as per policy (only monthly on the 1st)
        logger.info('Daily invoice-by-billing_day scheduler is DISABLED (only monthly on the 1st)');
        
        // Schedule daily due date reminders at 09:00
        cron.schedule('0 9 * * *', async () => {
            try {
                logger.info('Starting daily due date reminders...');
                await this.sendDueDateReminders();
                logger.info('Daily due date reminders completed');
            } catch (error) {
                logger.error('Error in daily due date reminders:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });
        
        logger.info('Due date reminder scheduler initialized - will run daily at 09:00');

        // Schedule voucher cleanup every 6 hours
        cron.schedule('0 */6 * * *', async () => {
            try {
                logger.info('Starting voucher cleanup...');
                await this.cleanupExpiredVoucherInvoices();
                logger.info('Voucher cleanup completed');
            } catch (error) {
                logger.error('Error in voucher cleanup:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });
        
        logger.info('Voucher cleanup scheduler initialized - will run every 6 hours');

        // Schedule monthly summary generation on 1st of every month at 23:59
        cron.schedule('59 23 1 * *', async () => {
            try {
                logger.info('Starting monthly summary generation...');
                await this.generateMonthlySummary();
                logger.info('Monthly summary generation completed');
            } catch (error) {
                logger.error('Error in monthly summary generation:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });
        
        logger.info('Monthly summary scheduler initialized - will run on 1st of every month at 23:59');

        // Schedule monthly reset on 1st of every month at 00:01 (after summary generation)
        cron.schedule('1 0 1 * *', async () => {
            try {
                logger.info('Starting monthly reset process...');
                await this.performMonthlyReset();
                logger.info('Monthly reset process completed');
            } catch (error) {
                logger.error('Error in monthly reset process:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });
        
        logger.info('Monthly reset scheduler initialized - will run on 1st of every month at 00:01');

        // Schedule daily service suspension check at 10:00
        cron.schedule('0 10 * * *', async () => {
            try {
                logger.info('Starting daily service suspension check...');
                const serviceSuspension = require('./serviceSuspension');
                await serviceSuspension.checkAndSuspendOverdueCustomers();
                logger.info('Daily service suspension check completed');
            } catch (error) {
                logger.error('Error in daily service suspension check:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });

        // Schedule daily service restoration check at 11:00
        cron.schedule('0 11 * * *', async () => {
            try {
                logger.info('Starting daily service restoration check...');
                const serviceSuspension = require('./serviceSuspension');
                await serviceSuspension.checkAndRestorePaidCustomers();
                logger.info('Daily service restoration check completed');
            } catch (error) {
                logger.error('Error in daily service restoration check:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });

        logger.info('Service suspension/restoration scheduler initialized - will run daily at 10:00 and 11:00');

        // Schedule voucher cleanup every 6 hours (00:00, 06:00, 12:00, 18:00)
        cron.schedule('0 0,6,12,18 * * *', async () => {
            try {
                logger.info('Starting automatic voucher cleanup...');

                // Make HTTP request to cleanup endpoint
                const https = require('http');

                const options = {
                    hostname: 'localhost',
                    port: process.env.PORT || 3004,
                    path: '/voucher/cleanup-expired',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    res.on('end', () => {
                        try {
                            const result = JSON.parse(data);
                            if (result.success) {
                                logger.info(`Automatic voucher cleanup completed: ${result.message}`);
                                if (result.details) {
                                    logger.info(`Database deleted: ${result.details.database_deleted}, Mikrotik deleted: ${result.details.mikrotik_deleted}`);
                                }
                            } else {
                                logger.error('Automatic voucher cleanup failed:', result.message);
                            }
                        } catch (e) {
                            logger.error('Error parsing voucher cleanup response:', e);
                        }
                    });
                });

                req.on('error', (e) => {
                    logger.error('Error in automatic voucher cleanup request:', e.message);
                });

                req.write(JSON.stringify({}));
                req.end();

            } catch (error) {
                logger.error('Error in automatic voucher cleanup:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });

        logger.info('Voucher cleanup scheduler initialized - will run every 6 hours');
        
        // Schedule automatic payment gateway status check every 15 minutes
        // This ensures payments that are PAID in gateway but webhook failed will be processed
        cron.schedule('*/15 * * * *', async () => {
            try {
                logger.info('[AUTO-CHECK] Starting automatic payment gateway status check...');
                await this.checkAndProcessPendingPayments();
                logger.info('[AUTO-CHECK] Automatic payment gateway status check completed');
            } catch (error) {
                logger.error('[AUTO-CHECK] Error in automatic payment gateway status check:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });
        
        logger.info('Payment gateway auto-check scheduler initialized - will run every 15 minutes');

        // Schedule automatic activity logs cleanup daily at 02:00 (delete logs older than 30 days)
        cron.schedule('0 2 * * *', async () => {
            try {
                logger.info('Starting automatic activity logs cleanup (30 days)...');
                const { cleanupOldLogs } = require('../utils/activityLogger');
                const result = await cleanupOldLogs(30);
                if (result.success) {
                    logger.info(`Automatic activity logs cleanup completed: ${result.message}`);
                } else {
                    logger.error('Automatic activity logs cleanup failed:', result.message);
                }
            } catch (error) {
                logger.error('Error in automatic activity logs cleanup:', error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });
        
        logger.info('Activity logs cleanup scheduler initialized - will run daily at 02:00 (delete logs older than 30 days)');

    }

    async sendDueDateReminders() {
        try {
            const whatsappNotifications = require('./whatsapp-notifications');
            const invoices = await billingManager.getInvoices();
            const today = new Date();
            
            // Filter invoices that are due today or overdue
            const dueInvoices = invoices.filter(invoice => {
                if (invoice.status !== 'unpaid') return false;
                
                const dueDate = new Date(invoice.due_date);
                const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
                
                // Send reminder for invoices due today or overdue (0 or negative days)
                return daysUntilDue <= 0;
            });
            
            logger.info(`Found ${dueInvoices.length} invoices due today or overdue`);
            
            for (const invoice of dueInvoices) {
                try {
                    await whatsappNotifications.sendDueDateReminder(invoice.id);
                    logger.info(`Due date reminder sent for invoice ${invoice.invoice_number}`);
                } catch (error) {
                    logger.error(`Error sending due date reminder for invoice ${invoice.invoice_number}:`, error);
                }
            }
        } catch (error) {
            logger.error('Error in sendDueDateReminders:', error);
            throw error;
        }
    }

    async generateMonthlyInvoices() {
        try {
            // Get all active customers
            const customers = await billingManager.getCustomers();
            const activeCustomers = customers.filter(customer => 
                customer.status === 'active' && customer.package_id
            );

            logger.info(`Found ${activeCustomers.length} active customers for invoice generation`);

            for (const customer of activeCustomers) {
                try {
                                            // Get customer's package
                        const packageData = await billingManager.getPackageById(customer.package_id);
                        if (!packageData) {
                            logger.warn(`Package not found for customer ${customer.username}`);
                            continue;
                        }

                    // Check if invoice already exists for this month
                    const currentDate = new Date();
                    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
                    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

                    const existingInvoices = await billingManager.getInvoicesByCustomerAndDateRange(
                        customer.username,
                        startOfMonth,
                        endOfMonth
                    );

                    if (existingInvoices.length > 0) {
                        logger.info(`Invoice already exists for customer ${customer.username} this month`);
                        continue;
                    }

                    // Set due date based on customer's renewal type
                    let dueDate;
                    const renewalType = customer.renewal_type || 'renewal';
                    
                    if (renewalType === 'fix_date') {
                        // Fix Date: Use fix_date or billing_day
                        const fixDate = customer.fix_date || customer.billing_day || 15;
                        const targetDay = Math.min(fixDate, 28);
                        const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
                        const finalDay = Math.min(targetDay, lastDayOfMonth);
                        dueDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), finalDay);
                    } else {
                        // Renewal: Use billing_day (default behavior)
                        const billingDay = (() => {
                            const v = parseInt(customer.billing_day, 10);
                            if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
                            return 15;
                        })();
                        const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
                        const targetDay = Math.min(billingDay, lastDayOfMonth);
                        dueDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), targetDay);
                    }

                    // Create invoice data with PPN calculation
                    const basePrice = packageData.price;
                    const taxRate = (packageData.tax_rate === 0 || (typeof packageData.tax_rate === 'number' && packageData.tax_rate > -1))
                        ? Number(packageData.tax_rate)
                        : 11.00; // Default 11% only when undefined/null/invalid
                    const amountWithTax = billingManager.calculatePriceWithTax(basePrice, taxRate);
                    
                    const invoiceData = {
                        customer_id: customer.id,
                        package_id: customer.package_id,
                        amount: amountWithTax, // Use price with tax
                        base_amount: basePrice, // Store base price for reference
                        tax_rate: taxRate, // Store tax rate for reference
                        due_date: dueDate.toISOString().split('T')[0],
                        notes: `Tagihan bulanan ${currentDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })} - ${renewalType === 'fix_date' ? 'Fix Date' : 'Renewal'} type`,
                        invoice_type: 'monthly'
                    };

                    // Create the invoice
                    const newInvoice = await billingManager.createInvoice(invoiceData);
                    logger.info(`Created invoice ${newInvoice.invoice_number} for customer ${customer.username}`);

                    // Kirim notifikasi WhatsApp setelah invoice berhasil dibuat
                    try {
                        const whatsappNotifications = require('./whatsapp-notifications');
                        await whatsappNotifications.sendInvoiceCreatedNotification(customer.id, newInvoice.id);
                        logger.info(`WhatsApp notification sent for invoice ${newInvoice.invoice_number} to customer ${customer.username}`);
                    } catch (notificationError) {
                        logger.error(`Failed to send WhatsApp notification for invoice ${newInvoice.invoice_number}:`, notificationError);
                        // Jangan stop proses invoice generation jika notifikasi gagal
                    }

                } catch (error) {
                    logger.error(`Error creating invoice for customer ${customer.username}:`, error);
                }
            }

        } catch (error) {
            logger.error('Error in generateMonthlyInvoices:', error);
            throw error;
        }
    }

    // Generate invoices daily for customers whose billing_day is today
    async generateDailyInvoicesByBillingDay() {
        try {
            // Get all active customers
            const customers = await billingManager.getCustomers();
            const activeCustomers = customers.filter(customer => 
                customer.status === 'active' && customer.package_id
            );

            const today = new Date();
            const todayDay = today.getDate();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth();

            // Compute start and end of current month for duplicate checks
            const startOfMonth = new Date(currentYear, currentMonth, 1);
            const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

            // For each active customer whose billing_day == today (capped 1-28)
            for (const customer of activeCustomers) {
                try {
                    const normalizedBillingDay = (() => {
                        const v = parseInt(customer.billing_day, 10);
                        if (Number.isFinite(v)) return Math.min(Math.max(v, 1), 28);
                        return 15;
                    })();

                    // If today matches the customer's billing day (allowing month shorter than 31)
                    if (todayDay !== normalizedBillingDay) {
                        continue;
                    }

                    // Get package
                    const packageData = await billingManager.getPackageById(customer.package_id);
                    if (!packageData) {
                        logger.warn(`Package not found for customer ${customer.username}`);
                        continue;
                    }

                    // Check if invoice already exists for this month
                    const existingInvoices = await billingManager.getInvoicesByCustomerAndDateRange(
                        customer.username,
                        startOfMonth,
                        endOfMonth
                    );
                    if (existingInvoices.length > 0) {
                        logger.info(`Invoice already exists for customer ${customer.username} this month (daily generator)`);
                        continue;
                    }

                    // Set due date to today's date (which equals billing_day)
                    const dueDate = new Date(currentYear, currentMonth, normalizedBillingDay)
                        .toISOString()
                        .split('T')[0];

                    // Calculate amount with tax
                    const basePrice = packageData.price;
                    const taxRate = (packageData.tax_rate === 0 || (typeof packageData.tax_rate === 'number' && packageData.tax_rate > -1))
                        ? Number(packageData.tax_rate)
                        : 11.00;
                    const amountWithTax = billingManager.calculatePriceWithTax(basePrice, taxRate); // Sudah include rounding

                    const invoiceData = {
                        customer_id: customer.id,
                        package_id: customer.package_id,
                        amount: amountWithTax,
                        base_amount: basePrice,
                        tax_rate: taxRate,
                        due_date: dueDate,
                        notes: `Tagihan bulanan ${today.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`
                    };

                    const newInvoice = await billingManager.createInvoice(invoiceData);
                    logger.info(`(Daily) Created invoice ${newInvoice.invoice_number} for customer ${customer.username}`);

                    // Kirim notifikasi WhatsApp setelah invoice berhasil dibuat (untuk daily generation juga)
                    try {
                        const whatsappNotifications = require('./whatsapp-notifications');
                        await whatsappNotifications.sendInvoiceCreatedNotification(customer.id, newInvoice.id);
                        logger.info(`(Daily) WhatsApp notification sent for invoice ${newInvoice.invoice_number} to customer ${customer.username}`);
                    } catch (notificationError) {
                        logger.error(`(Daily) Failed to send WhatsApp notification for invoice ${newInvoice.invoice_number}:`, notificationError);
                        // Jangan stop proses invoice generation jika notifikasi gagal
                    }

                } catch (error) {
                    logger.error(`(Daily) Error creating invoice for customer ${customer.username}:`, error);
                }
            }
        } catch (error) {
            logger.error('Error in generateDailyInvoicesByBillingDay:', error);
            throw error;
        }
    }

    // Manual trigger for testing
    async triggerMonthlyInvoices() {
        try {
            logger.info('Triggering monthly invoice generation manually...');
            await this.generateMonthlyInvoices();
            logger.info('Manual monthly invoice generation completed');
            return { success: true, message: 'Monthly invoices generated successfully' };
        } catch (error) {
            logger.error('Error in manual monthly invoice generation:', error);
            throw error;
        }
    }

    // Manual trigger for monthly reset
    async triggerMonthlyReset() {
        try {
            logger.info('Triggering monthly reset manually...');
            const result = await this.performMonthlyReset();
            logger.info('Manual monthly reset completed');
            return result;
        } catch (error) {
            logger.error('Error in manual monthly reset:', error);
            throw error;
        }
    }

    async cleanupExpiredVoucherInvoices() {
        try {
            logger.info('Starting voucher cleanup process...');
            const result = await billingManager.cleanupExpiredVoucherInvoices();
            
            if (result.success) {
                if (result.cleaned > 0) {
                    logger.info(`Voucher cleanup completed: ${result.message}`);
                } else {
                    logger.info('Voucher cleanup completed: No expired invoices found');
                }
            } else {
                logger.error('Voucher cleanup failed:', result.message);
            }
            
            return result;
        } catch (error) {
            logger.error('Error in cleanupExpiredVoucherInvoices:', error);
            throw error;
        }
    }

    async generateMonthlySummary() {
        try {
            logger.info('Starting monthly summary generation...');
            const result = await billingManager.generateMonthlySummary();
            
            if (result.success) {
                logger.info(`Monthly summary generated: ${result.message}`);
            } else {
                logger.error('Monthly summary generation failed:', result.message);
            }
            
            return result;
        } catch (error) {
            logger.error('Error in generateMonthlySummary:', error);
            throw error;
        }
    }

    async performMonthlyReset() {
        try {
            logger.info('Starting monthly reset process...');
            const result = await billingManager.performMonthlyReset();
            
            if (result.success) {
                logger.info(`Monthly reset completed: ${result.message}`);
                logger.info(`Summary saved for ${result.previousYear}-${result.previousMonth}`);
                logger.info(`Reset for ${result.year}-${result.month}`);
                logger.info(`Processed ${result.collectorsProcessed} collectors`);
            } else {
                logger.error('Monthly reset failed:', result.message);
            }
            
            return result;
        } catch (error) {
            logger.error('Error in performMonthlyReset:', error);
            throw error;
        }
    }

    async checkAndProcessPendingPayments() {
        try {
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = require('path').join(__dirname, '../data/billing.db');
            const { getSetting } = require('./settingsManager');
            const whatsappNotifications = require('./whatsapp-notifications');
            
            // Get Tripay config
            const settings = getSetting('payment_gateway', {});
            const tripayConfig = settings.tripay || {};
            
            if (!tripayConfig.enabled || !tripayConfig.api_key || !tripayConfig.private_key) {
                logger.info('[AUTO-CHECK] Tripay not enabled or config incomplete, skipping...');
                return { success: true, processed: 0, skipped: true };
            }
            
            const baseUrl = tripayConfig.production !== false 
                ? 'https://tripay.co.id/api' 
                : 'https://tripay.co.id/api-sandbox';
            
            // Find pending Tripay transactions (created within last 24 hours)
            const db = new sqlite3.Database(dbPath);
            const pendingTransactions = await new Promise((resolve, reject) => {
                const oneDayAgo = new Date();
                oneDayAgo.setHours(oneDayAgo.getHours() - 24);
                const oneDayAgoStr = oneDayAgo.toISOString().replace('T', ' ').substring(0, 19);
                
                db.all(`
                    SELECT pgt.id, pgt.invoice_id, pgt.order_id, pgt.token, pgt.status, pgt.amount,
                           i.invoice_number, i.status as invoice_status
                    FROM payment_gateway_transactions pgt
                    JOIN invoices i ON pgt.invoice_id = i.id
                    WHERE pgt.gateway = 'tripay'
                      AND pgt.status = 'pending'
                      AND pgt.token IS NOT NULL
                      AND pgt.token != ''
                      AND pgt.created_at >= ?
                    ORDER BY pgt.created_at DESC
                    LIMIT 20
                `, [oneDayAgoStr], (err, rows) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
            
            if (pendingTransactions.length === 0) {
                logger.info('[AUTO-CHECK] No pending Tripay transactions found');
                return { success: true, processed: 0 };
            }
            
            logger.info(`[AUTO-CHECK] Found ${pendingTransactions.length} pending Tripay transactions to check`);
            
            const fetchFn = typeof fetch === 'function' ? fetch : require('node-fetch').default;
            let processedCount = 0;
            let errorCount = 0;
            
            for (const transaction of pendingTransactions) {
                try {
                    // Check status from Tripay API
                    const url = new URL(`${baseUrl}/transaction/detail`);
                    url.searchParams.append('reference', transaction.token);
                    
                    const response = await fetchFn(url.toString(), {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${tripayConfig.api_key}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    const result = await response.json();
                    
                    if (!response.ok || !result.success) {
                        logger.warn(`[AUTO-CHECK] Failed to check transaction ${transaction.token}: ${result.message || 'Unknown error'}`);
                        errorCount++;
                        continue;
                    }
                    
                    const tripayData = result.data;
                    
                    // If payment is PAID in Tripay but not processed locally
                    if (tripayData.status === 'PAID' && transaction.invoice_status === 'unpaid') {
                        logger.info(`[AUTO-CHECK] Payment PAID found: Invoice ${transaction.invoice_number}, Processing...`);
                        
                        // Check if payment already exists
                        const db2 = new sqlite3.Database(dbPath);
                        const existingPayment = await new Promise((resolve, reject) => {
                            db2.get(`
                                SELECT id FROM payments 
                                WHERE invoice_id = ? AND reference_number = ?
                            `, [transaction.invoice_id, transaction.order_id], (err, row) => {
                                db2.close();
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });
                        
                        if (existingPayment) {
                            logger.info(`[AUTO-CHECK] Payment already exists for invoice ${transaction.invoice_number}, skipping...`);
                            continue;
                        }
                        
                        // Record payment
                        const paymentData = {
                            invoice_id: transaction.invoice_id,
                            amount: tripayData.amount || transaction.amount,
                            payment_method: 'online',
                            reference_number: transaction.order_id,
                            notes: `Payment via Tripay - ${tripayData.payment_method || 'online'} (Auto-processed from API check)`
                        };
                        
                        const paymentResult = await billingManager.recordPayment(paymentData);
                        
                        if (paymentResult && paymentResult.success && paymentResult.id) {
                            // Update invoice status
                            await billingManager.updateInvoiceStatus(transaction.invoice_id, 'paid', 'online');
                            
                            // Update payment gateway transaction
                            const db3 = new sqlite3.Database(dbPath);
                            await new Promise((resolve, reject) => {
                                db3.run(`
                                    UPDATE payment_gateway_transactions
                                    SET status = 'success', 
                                        payment_type = ?,
                                        updated_at = CURRENT_TIMESTAMP
                                    WHERE id = ?
                                `, [tripayData.payment_method || 'online', transaction.id], (err) => {
                                    db3.close();
                                    if (err) reject(err);
                                    else resolve();
                                });
                            });
                            
                            logger.info(`[AUTO-CHECK] ✅ Payment processed: Invoice ${transaction.invoice_number}, Payment ID ${paymentResult.id}`);
                            
                            // Send notification
                            try {
                                const notifResult = await whatsappNotifications.sendPaymentReceivedNotification(paymentResult.id);
                                if (notifResult && notifResult.success) {
                                    logger.info(`[AUTO-CHECK] ✅ Notification sent for invoice ${transaction.invoice_number}`);
                                } else {
                                    logger.warn(`[AUTO-CHECK] ⚠️  Notification failed for invoice ${transaction.invoice_number}:`, notifResult);
                                }
                            } catch (notifError) {
                                logger.error(`[AUTO-CHECK] ❌ Error sending notification for invoice ${transaction.invoice_number}:`, notifError.message);
                            }
                            
                            processedCount++;
                        } else {
                            logger.error(`[AUTO-CHECK] ❌ Failed to record payment for invoice ${transaction.invoice_number}`);
                            errorCount++;
                        }
                    } else if (tripayData.status === 'EXPIRED' || tripayData.status === 'FAILED') {
                        // Update expired/failed transactions
                        const db4 = new sqlite3.Database(dbPath);
                        await new Promise((resolve, reject) => {
                            db4.run(`
                                UPDATE payment_gateway_transactions
                                SET status = 'failed',
                                    updated_at = CURRENT_TIMESTAMP
                                WHERE id = ?
                            `, [transaction.id], (err) => {
                                db4.close();
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                        logger.info(`[AUTO-CHECK] Updated transaction ${transaction.token} status to failed (${tripayData.status})`);
                    }
                    
                } catch (error) {
                    logger.error(`[AUTO-CHECK] Error processing transaction ${transaction.token}:`, error.message);
                    errorCount++;
                }
            }
            
            logger.info(`[AUTO-CHECK] Completed: ${processedCount} processed, ${errorCount} errors`);
            return { success: true, processed: processedCount, errors: errorCount };
            
        } catch (error) {
            logger.error('[AUTO-CHECK] Error in checkAndProcessPendingPayments:', error);
            throw error;
        }
    }


}

module.exports = new InvoiceScheduler(); 