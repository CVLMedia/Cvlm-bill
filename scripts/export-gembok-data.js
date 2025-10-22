const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

console.log('📤 Starting data export from gembok-bill...\n');

// Path ke database gembok-bill
const gembokDbPath = '/root/gembok-bill/data/billing.db';
const exportDir = path.join(__dirname, '../data/migration');
const exportFile = path.join(exportDir, 'gembok-data-export.json');

// Pastikan direktori export ada
if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
    console.log('📁 Created migration directory');
}

// Koneksi ke database gembok-bill
const gembokDb = new sqlite3.Database(gembokDbPath, (err) => {
    if (err) {
        console.error('❌ Error connecting to gembok-bill database:', err);
        process.exit(1);
    } else {
        console.log('✅ Connected to gembok-bill database');
    }
});

async function exportData() {
    try {
        console.log('\n🔄 Exporting data...\n');

        // Export packages
        console.log('📦 Exporting packages...');
        const packages = await new Promise((resolve, reject) => {
            gembokDb.all('SELECT * FROM packages ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log(`✅ Exported ${packages.length} packages`);

        // Export customers
        console.log('👥 Exporting customers...');
        const customers = await new Promise((resolve, reject) => {
            gembokDb.all('SELECT * FROM customers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log(`✅ Exported ${customers.length} customers`);

        // Export invoices
        console.log('🧾 Exporting invoices...');
        const invoices = await new Promise((resolve, reject) => {
            gembokDb.all('SELECT * FROM invoices ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log(`✅ Exported ${invoices.length} invoices`);

        // Export payments
        console.log('💰 Exporting payments...');
        const payments = await new Promise((resolve, reject) => {
            gembokDb.all('SELECT * FROM payments ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log(`✅ Exported ${payments.length} payments`);

        // Export ODPs
        console.log('📡 Exporting ODPs...');
        const odps = await new Promise((resolve, reject) => {
            gembokDb.all('SELECT * FROM odps ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log(`✅ Exported ${odps.length} ODPs`);

        // Export cable routes
        console.log('🔌 Exporting cable routes...');
        const cableRoutes = await new Promise((resolve, reject) => {
            gembokDb.all('SELECT * FROM cable_routes ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log(`✅ Exported ${cableRoutes.length} cable routes`);

        // Export network segments
        console.log('🌐 Exporting network segments...');
        const networkSegments = await new Promise((resolve, reject) => {
            gembokDb.all('SELECT * FROM network_segments ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log(`✅ Exported ${networkSegments.length} network segments`);

        // Export payment gateway transactions
        console.log('💳 Exporting payment gateway transactions...');
        const paymentGatewayTransactions = await new Promise((resolve, reject) => {
            gembokDb.all('SELECT * FROM payment_gateway_transactions ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log(`✅ Exported ${paymentGatewayTransactions.length} payment gateway transactions`);

        // Export expenses
        console.log('💸 Exporting expenses...');
        const expenses = await new Promise((resolve, reject) => {
            gembokDb.all('SELECT * FROM expenses ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        console.log(`✅ Exported ${expenses.length} expenses`);

        // Compile all data
        const exportData = {
            exportDate: new Date().toISOString(),
            source: 'gembok-bill',
            target: 'billing-system',
            data: {
                packages,
                customers,
                invoices,
                payments,
                odps,
                cableRoutes,
                networkSegments,
                paymentGatewayTransactions,
                expenses
            },
            summary: {
                packagesCount: packages.length,
                customersCount: customers.length,
                invoicesCount: invoices.length,
                paymentsCount: payments.length,
                odpsCount: odps.length,
                cableRoutesCount: cableRoutes.length,
                networkSegmentsCount: networkSegments.length,
                paymentGatewayTransactionsCount: paymentGatewayTransactions.length,
                expensesCount: expenses.length
            }
        };

        // Write to file
        fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2));
        console.log(`\n✅ Data exported successfully to: ${exportFile}`);
        
        // Display summary
        console.log('\n📊 Export Summary:');
        console.log(`📦 Packages: ${packages.length}`);
        console.log(`👥 Customers: ${customers.length}`);
        console.log(`🧾 Invoices: ${invoices.length}`);
        console.log(`💰 Payments: ${payments.length}`);
        console.log(`📡 ODPs: ${odps.length}`);
        console.log(`🔌 Cable Routes: ${cableRoutes.length}`);
        console.log(`🌐 Network Segments: ${networkSegments.length}`);
        console.log(`💳 Payment Gateway Transactions: ${paymentGatewayTransactions.length}`);
        console.log(`💸 Expenses: ${expenses.length}`);

        // Close database connection
        gembokDb.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('\n✅ Database connection closed');
            }
        });

    } catch (error) {
        console.error('❌ Error during export:', error);
        process.exit(1);
    }
}

// Run export
exportData();
