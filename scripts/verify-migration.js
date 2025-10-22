const path = require('path');
const sqlite3 = require('sqlite3').verbose();

console.log('🔍 Verifying migration results...\n');

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

async function verifyMigration() {
    try {
        console.log('📊 Migration Verification Results:\n');

        // Count packages
        const packageCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM packages', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`📦 Packages: ${packageCount}`);

        // Count customers
        const customerCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM customers', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`👥 Customers: ${customerCount}`);

        // Count invoices
        const invoiceCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM invoices', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`🧾 Invoices: ${invoiceCount}`);

        // Count payments
        const paymentCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM payments', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`💰 Payments: ${paymentCount}`);

        // Count ODPs
        const odpCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM odps', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`📡 ODPs: ${odpCount}`);

        // Count cable routes
        const cableRouteCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM cable_routes', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`🔌 Cable Routes: ${cableRouteCount}`);

        // Count network segments
        const networkSegmentCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM network_segments', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`🌐 Network Segments: ${networkSegmentCount}`);

        // Count payment gateway transactions
        const paymentGatewayTransactionCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM payment_gateway_transactions', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`💳 Payment Gateway Transactions: ${paymentGatewayTransactionCount}`);

        // Count expenses
        const expenseCount = await new Promise((resolve, reject) => {
            billingDb.get('SELECT COUNT(*) as count FROM expenses', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`💸 Expenses: ${expenseCount}`);

        // Show sample data
        console.log('\n📋 Sample Data:');
        
        // Sample packages
        const samplePackages = await new Promise((resolve, reject) => {
            billingDb.all('SELECT id, name, speed, price FROM packages LIMIT 3', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log('\n📦 Sample Packages:');
        samplePackages.forEach(pkg => {
            console.log(`  - ${pkg.name}: ${pkg.speed} (Rp ${pkg.price})`);
        });

        // Sample customers
        const sampleCustomers = await new Promise((resolve, reject) => {
            billingDb.all('SELECT id, name, username, phone, status FROM customers LIMIT 3', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log('\n👥 Sample Customers:');
        sampleCustomers.forEach(customer => {
            console.log(`  - ${customer.name} (${customer.username}) - ${customer.phone} [${customer.status}]`);
        });

        // Sample invoices
        const sampleInvoices = await new Promise((resolve, reject) => {
            billingDb.all('SELECT id, invoice_number, amount, status, due_date FROM invoices LIMIT 3', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log('\n🧾 Sample Invoices:');
        sampleInvoices.forEach(invoice => {
            console.log(`  - ${invoice.invoice_number}: Rp ${invoice.amount} [${invoice.status}] Due: ${invoice.due_date}`);
        });

        // Check for data integrity
        console.log('\n🔍 Data Integrity Checks:');
        
        // Check customers with invalid package_id
        const invalidPackageCustomers = await new Promise((resolve, reject) => {
            billingDb.get(`
                SELECT COUNT(*) as count 
                FROM customers c 
                LEFT JOIN packages p ON c.package_id = p.id 
                WHERE c.package_id IS NOT NULL AND p.id IS NULL
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`  - Customers with invalid package_id: ${invalidPackageCustomers}`);

        // Check invoices with invalid customer_id
        const invalidCustomerInvoices = await new Promise((resolve, reject) => {
            billingDb.get(`
                SELECT COUNT(*) as count 
                FROM invoices i 
                LEFT JOIN customers c ON i.customer_id = c.id 
                WHERE c.id IS NULL
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`  - Invoices with invalid customer_id: ${invalidCustomerInvoices}`);

        // Check payments with invalid invoice_id
        const invalidInvoicePayments = await new Promise((resolve, reject) => {
            billingDb.get(`
                SELECT COUNT(*) as count 
                FROM payments p 
                LEFT JOIN invoices i ON p.invoice_id = i.id 
                WHERE i.id IS NULL
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        console.log(`  - Payments with invalid invoice_id: ${invalidInvoicePayments}`);

        console.log('\n✅ Migration verification completed!');
        
        if (invalidPackageCustomers === 0 && invalidCustomerInvoices === 0 && invalidInvoicePayments === 0) {
            console.log('🎉 All data integrity checks passed!');
        } else {
            console.log('⚠️ Some data integrity issues found, but migration is functional.');
        }

        // Close database connection
        billingDb.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('✅ Database connection closed');
            }
        });

    } catch (error) {
        console.error('❌ Error during verification:', error);
        process.exit(1);
    }
}

// Run verification
verifyMigration();
