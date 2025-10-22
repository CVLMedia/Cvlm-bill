const path = require('path');
const sqlite3 = require('sqlite3').verbose();

console.log('🧹 Cleaning up problematic data...\n');

// Path ke database billing-system
const billingDbPath = '/root/billing-system/data/billing.db';

// Koneksi ke database billing-system
const billingDb = new sqlite3.Database(billingDbPath, (err) => {
    if (err) {
        console.error('❌ Error connecting to billing-system database:', err);
        process.exit(1);
    } else {
        console.log('✅ Connected to billing-system database');
    }
});

async function cleanupData() {
    try {
        console.log('🔍 Finding and cleaning problematic data...\n');

        // Find invoices with invalid customer_id
        console.log('🧾 Cleaning invoices with invalid customer_id...');
        const invalidInvoices = await new Promise((resolve, reject) => {
            billingDb.all(`
                SELECT i.id, i.invoice_number, i.customer_id 
                FROM invoices i 
                LEFT JOIN customers c ON i.customer_id = c.id 
                WHERE c.id IS NULL
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        console.log(`Found ${invalidInvoices.length} invoices with invalid customer_id:`);
        invalidInvoices.forEach(invoice => {
            console.log(`  - Invoice ${invoice.id} (${invoice.invoice_number}) references customer ${invoice.customer_id}`);
        });

        // Delete invalid invoices
        if (invalidInvoices.length > 0) {
            const invoiceIds = invalidInvoices.map(inv => inv.id);
            await new Promise((resolve, reject) => {
                billingDb.run(`DELETE FROM invoices WHERE id IN (${invoiceIds.map(() => '?').join(',')})`, 
                    invoiceIds, function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`✅ Deleted ${this.changes} invalid invoices`);
                        resolve();
                    }
                });
            });
        }

        // Find payments with invalid invoice_id
        console.log('\n💰 Cleaning payments with invalid invoice_id...');
        const invalidPayments = await new Promise((resolve, reject) => {
            billingDb.all(`
                SELECT p.id, p.invoice_id 
                FROM payments p 
                LEFT JOIN invoices i ON p.invoice_id = i.id 
                WHERE i.id IS NULL
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        console.log(`Found ${invalidPayments.length} payments with invalid invoice_id:`);
        invalidPayments.forEach(payment => {
            console.log(`  - Payment ${payment.id} references invoice ${payment.invoice_id}`);
        });

        // Delete invalid payments
        if (invalidPayments.length > 0) {
            const paymentIds = invalidPayments.map(pay => pay.id);
            await new Promise((resolve, reject) => {
                billingDb.run(`DELETE FROM payments WHERE id IN (${paymentIds.map(() => '?').join(',')})`, 
                    paymentIds, function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`✅ Deleted ${this.changes} invalid payments`);
                        resolve();
                    }
                });
            });
        }

        // Find customers with invalid package_id
        console.log('\n👥 Checking customers with invalid package_id...');
        const invalidPackageCustomers = await new Promise((resolve, reject) => {
            billingDb.all(`
                SELECT c.id, c.name, c.package_id 
                FROM customers c 
                LEFT JOIN packages p ON c.package_id = p.id 
                WHERE c.package_id IS NOT NULL AND p.id IS NULL
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        console.log(`Found ${invalidPackageCustomers.length} customers with invalid package_id:`);
        invalidPackageCustomers.forEach(customer => {
            console.log(`  - Customer ${customer.id} (${customer.name}) references package ${customer.package_id}`);
        });

        // Set package_id to NULL for customers with invalid package_id
        if (invalidPackageCustomers.length > 0) {
            const customerIds = invalidPackageCustomers.map(cust => cust.id);
            await new Promise((resolve, reject) => {
                billingDb.run(`UPDATE customers SET package_id = NULL WHERE id IN (${customerIds.map(() => '?').join(',')})`, 
                    customerIds, function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`✅ Updated ${this.changes} customers with invalid package_id to NULL`);
                        resolve();
                    }
                });
            });
        }

        // Final verification
        console.log('\n🔍 Final verification...');
        
        const finalInvoiceCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM invoices', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const finalPaymentCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM payments', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const finalCustomerCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM customers', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        console.log(`📊 Final counts:`);
        console.log(`  - Customers: ${finalCustomerCount}`);
        console.log(`  - Invoices: ${finalInvoiceCount}`);
        console.log(`  - Payments: ${finalPaymentCount}`);

        // Check data integrity again
        const integrityCheck = await new Promise((resolve, reject) => {
            billingDb.get(`
                SELECT 
                    (SELECT COUNT(*) FROM customers c LEFT JOIN packages p ON c.package_id = p.id WHERE c.package_id IS NOT NULL AND p.id IS NULL) as invalid_packages,
                    (SELECT COUNT(*) FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE c.id IS NULL) as invalid_customers,
                    (SELECT COUNT(*) FROM payments p LEFT JOIN invoices i ON p.invoice_id = i.id WHERE i.id IS NULL) as invalid_invoices
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        console.log('\n🔍 Final integrity check:');
        console.log(`  - Customers with invalid package_id: ${integrityCheck.invalid_packages}`);
        console.log(`  - Invoices with invalid customer_id: ${integrityCheck.invalid_customers}`);
        console.log(`  - Payments with invalid invoice_id: ${integrityCheck.invalid_invoices}`);

        if (integrityCheck.invalid_packages === 0 && integrityCheck.invalid_customers === 0 && integrityCheck.invalid_invoices === 0) {
            console.log('\n🎉 All data integrity issues resolved!');
        } else {
            console.log('\n⚠️ Some data integrity issues remain.');
        }

        console.log('\n✅ Data cleanup completed!');

        // Close database connection
        billingDb.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('✅ Database connection closed');
            }
        });

    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        process.exit(1);
    }
}

// Run cleanup
cleanupData();
