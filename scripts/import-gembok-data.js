const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

console.log('📥 Starting data import to billing-system...\n');

// Path ke database billing-system
const billingDbPath = '/root/billing-system/data/billing.db';
const exportDir = path.join(__dirname, '../data/migration');
const exportFile = path.join(exportDir, 'gembok-data-export.json');

// Pastikan file export ada
if (!fs.existsSync(exportFile)) {
    console.error('❌ Export file not found. Please run export-gembok-data.js first.');
    process.exit(1);
}

// Pastikan direktori data billing-system ada
const dataDir = path.dirname(billingDbPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 Created billing-system data directory');
}

// Koneksi ke database billing-system
const billingDb = new sqlite3.Database(billingDbPath, (err) => {
    if (err) {
        console.error('❌ Error connecting to billing-system database:', err);
        process.exit(1);
    } else {
        console.log('✅ Connected to billing-system database');
    }
});

// Enable foreign keys
billingDb.run("PRAGMA foreign_keys = ON", (err) => {
    if (err) {
        console.error('❌ Error enabling foreign keys:', err);
    } else {
        console.log('✅ Foreign keys enabled');
    }
});

async function importData() {
    try {
        // Read export file
        console.log('📖 Reading export file...');
        const exportData = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
        console.log(`✅ Export file loaded (exported on: ${exportData.exportDate})`);

        const { data } = exportData;

        // Import packages first (no dependencies)
        console.log('\n📦 Importing packages...');
        let importedPackages = 0;
        for (const packageData of data.packages) {
            try {
                await new Promise((resolve, reject) => {
                    const sql = `INSERT OR REPLACE INTO packages (
                        id, name, speed, price, tax_rate, description, 
                        pppoe_profile, is_active, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    
                    billingDb.run(sql, [
                        packageData.id,
                        packageData.name,
                        packageData.speed,
                        packageData.price,
                        packageData.tax_rate || 11.00,
                        packageData.description,
                        packageData.pppoe_profile || 'default',
                        packageData.is_active !== undefined ? packageData.is_active : 1,
                        packageData.created_at || new Date().toISOString()
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                importedPackages++;
            } catch (error) {
                console.error(`❌ Error importing package ${packageData.id}:`, error.message);
            }
        }
        console.log(`✅ Imported ${importedPackages}/${data.packages.length} packages`);

        // Import ODPs (no dependencies)
        console.log('\n📡 Importing ODPs...');
        let importedODPs = 0;
        for (const odpData of data.odps) {
            try {
                await new Promise((resolve, reject) => {
                    const sql = `INSERT OR REPLACE INTO odps (
                        id, name, code, latitude, longitude, address, 
                        capacity, used_ports, status, installation_date, 
                        notes, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    
                    billingDb.run(sql, [
                        odpData.id,
                        odpData.name,
                        odpData.code,
                        odpData.latitude,
                        odpData.longitude,
                        odpData.address,
                        odpData.capacity || 64,
                        odpData.used_ports || 0,
                        odpData.status || 'active',
                        odpData.installation_date,
                        odpData.notes,
                        odpData.created_at || new Date().toISOString(),
                        odpData.updated_at || new Date().toISOString()
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                importedODPs++;
            } catch (error) {
                console.error(`❌ Error importing ODP ${odpData.id}:`, error.message);
            }
        }
        console.log(`✅ Imported ${importedODPs}/${data.odps.length} ODPs`);

        // Import customers (depends on packages and ODPs)
        console.log('\n👥 Importing customers...');
        let importedCustomers = 0;
        for (const customerData of data.customers) {
            try {
                await new Promise((resolve, reject) => {
                    const sql = `INSERT OR REPLACE INTO customers (
                        id, username, name, phone, pppoe_username, email, 
                        address, latitude, longitude, package_id, pppoe_profile, 
                        status, join_date, cable_type, cable_length, port_number, 
                        cable_status, cable_notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    
                    billingDb.run(sql, [
                        customerData.id,
                        customerData.username,
                        customerData.name,
                        customerData.phone,
                        customerData.pppoe_username,
                        customerData.email,
                        customerData.address,
                        customerData.latitude,
                        customerData.longitude,
                        customerData.package_id,
                        customerData.pppoe_profile,
                        customerData.status || 'active',
                        customerData.join_date || new Date().toISOString(),
                        customerData.cable_type,
                        customerData.cable_length,
                        customerData.port_number,
                        customerData.cable_status || 'connected',
                        customerData.cable_notes
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                importedCustomers++;
            } catch (error) {
                console.error(`❌ Error importing customer ${customerData.id}:`, error.message);
            }
        }
        console.log(`✅ Imported ${importedCustomers}/${data.customers.length} customers`);

        // Import invoices (depends on customers and packages)
        console.log('\n🧾 Importing invoices...');
        let importedInvoices = 0;
        for (const invoiceData of data.invoices) {
            try {
                await new Promise((resolve, reject) => {
                    const sql = `INSERT OR REPLACE INTO invoices (
                        id, customer_id, package_id, invoice_number, amount, 
                        due_date, status, payment_date, payment_method, 
                        payment_gateway, payment_token, payment_url, 
                        payment_status, notes, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    
                    billingDb.run(sql, [
                        invoiceData.id,
                        invoiceData.customer_id,
                        invoiceData.package_id,
                        invoiceData.invoice_number,
                        invoiceData.amount,
                        invoiceData.due_date,
                        invoiceData.status || 'unpaid',
                        invoiceData.payment_date,
                        invoiceData.payment_method,
                        invoiceData.payment_gateway,
                        invoiceData.payment_token,
                        invoiceData.payment_url,
                        invoiceData.payment_status || 'pending',
                        invoiceData.notes,
                        invoiceData.created_at || new Date().toISOString()
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                importedInvoices++;
            } catch (error) {
                console.error(`❌ Error importing invoice ${invoiceData.id}:`, error.message);
            }
        }
        console.log(`✅ Imported ${importedInvoices}/${data.invoices.length} invoices`);

        // Import payments (depends on invoices)
        console.log('\n💰 Importing payments...');
        let importedPayments = 0;
        for (const paymentData of data.payments) {
            try {
                await new Promise((resolve, reject) => {
                    const sql = `INSERT OR REPLACE INTO payments (
                        id, invoice_id, amount, payment_date, 
                        payment_method, reference_number, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`;
                    
                    billingDb.run(sql, [
                        paymentData.id,
                        paymentData.invoice_id,
                        paymentData.amount,
                        paymentData.payment_date || new Date().toISOString(),
                        paymentData.payment_method,
                        paymentData.reference_number,
                        paymentData.notes
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                importedPayments++;
            } catch (error) {
                console.error(`❌ Error importing payment ${paymentData.id}:`, error.message);
            }
        }
        console.log(`✅ Imported ${importedPayments}/${data.payments.length} payments`);

        // Import cable routes (depends on customers and ODPs)
        console.log('\n🔌 Importing cable routes...');
        let importedCableRoutes = 0;
        for (const cableRouteData of data.cableRoutes) {
            try {
                await new Promise((resolve, reject) => {
                    const sql = `INSERT OR REPLACE INTO cable_routes (
                        id, customer_id, odp_id, cable_length, cable_type, 
                        installation_date, status, port_number, notes, 
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    
                    billingDb.run(sql, [
                        cableRouteData.id,
                        cableRouteData.customer_id,
                        cableRouteData.odp_id,
                        cableRouteData.cable_length,
                        cableRouteData.cable_type || 'Fiber Optic',
                        cableRouteData.installation_date,
                        cableRouteData.status || 'connected',
                        cableRouteData.port_number,
                        cableRouteData.notes,
                        cableRouteData.created_at || new Date().toISOString(),
                        cableRouteData.updated_at || new Date().toISOString()
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                importedCableRoutes++;
            } catch (error) {
                console.error(`❌ Error importing cable route ${cableRouteData.id}:`, error.message);
            }
        }
        console.log(`✅ Imported ${importedCableRoutes}/${data.cableRoutes.length} cable routes`);

        // Import network segments (depends on ODPs)
        console.log('\n🌐 Importing network segments...');
        let importedNetworkSegments = 0;
        for (const segmentData of data.networkSegments) {
            try {
                await new Promise((resolve, reject) => {
                    const sql = `INSERT OR REPLACE INTO network_segments (
                        id, name, start_odp_id, end_odp_id, segment_type, 
                        cable_length, status, installation_date, notes, 
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    
                    billingDb.run(sql, [
                        segmentData.id,
                        segmentData.name,
                        segmentData.start_odp_id,
                        segmentData.end_odp_id,
                        segmentData.segment_type || 'Backbone',
                        segmentData.cable_length,
                        segmentData.status || 'active',
                        segmentData.installation_date,
                        segmentData.notes,
                        segmentData.created_at || new Date().toISOString(),
                        segmentData.updated_at || new Date().toISOString()
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                importedNetworkSegments++;
            } catch (error) {
                console.error(`❌ Error importing network segment ${segmentData.id}:`, error.message);
            }
        }
        console.log(`✅ Imported ${importedNetworkSegments}/${data.networkSegments.length} network segments`);

        // Import payment gateway transactions (depends on invoices)
        console.log('\n💳 Importing payment gateway transactions...');
        let importedPaymentGatewayTransactions = 0;
        for (const transactionData of data.paymentGatewayTransactions) {
            try {
                await new Promise((resolve, reject) => {
                    const sql = `INSERT OR REPLACE INTO payment_gateway_transactions (
                        id, invoice_id, gateway, order_id, payment_url, token, 
                        amount, status, payment_type, fraud_status, 
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    
                    billingDb.run(sql, [
                        transactionData.id,
                        transactionData.invoice_id,
                        transactionData.gateway,
                        transactionData.order_id,
                        transactionData.payment_url,
                        transactionData.token,
                        transactionData.amount,
                        transactionData.status || 'pending',
                        transactionData.payment_type,
                        transactionData.fraud_status,
                        transactionData.created_at || new Date().toISOString(),
                        transactionData.updated_at || new Date().toISOString()
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                importedPaymentGatewayTransactions++;
            } catch (error) {
                console.error(`❌ Error importing payment gateway transaction ${transactionData.id}:`, error.message);
            }
        }
        console.log(`✅ Imported ${importedPaymentGatewayTransactions}/${data.paymentGatewayTransactions.length} payment gateway transactions`);

        // Import expenses (no dependencies)
        console.log('\n💸 Importing expenses...');
        let importedExpenses = 0;
        for (const expenseData of data.expenses) {
            try {
                await new Promise((resolve, reject) => {
                    const sql = `INSERT OR REPLACE INTO expenses (
                        id, description, amount, category, expense_date, 
                        payment_method, notes, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    
                    billingDb.run(sql, [
                        expenseData.id,
                        expenseData.description,
                        expenseData.amount,
                        expenseData.category,
                        expenseData.expense_date,
                        expenseData.payment_method,
                        expenseData.notes,
                        expenseData.created_at || new Date().toISOString(),
                        expenseData.updated_at || new Date().toISOString()
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                importedExpenses++;
            } catch (error) {
                console.error(`❌ Error importing expense ${expenseData.id}:`, error.message);
            }
        }
        console.log(`✅ Imported ${importedExpenses}/${data.expenses.length} expenses`);

        // Display final summary
        console.log('\n📊 Import Summary:');
        console.log(`📦 Packages: ${importedPackages}/${data.packages.length}`);
        console.log(`👥 Customers: ${importedCustomers}/${data.customers.length}`);
        console.log(`🧾 Invoices: ${importedInvoices}/${data.invoices.length}`);
        console.log(`💰 Payments: ${importedPayments}/${data.payments.length}`);
        console.log(`📡 ODPs: ${importedODPs}/${data.odps.length}`);
        console.log(`🔌 Cable Routes: ${importedCableRoutes}/${data.cableRoutes.length}`);
        console.log(`🌐 Network Segments: ${importedNetworkSegments}/${data.networkSegments.length}`);
        console.log(`💳 Payment Gateway Transactions: ${importedPaymentGatewayTransactions}/${data.paymentGatewayTransactions.length}`);
        console.log(`💸 Expenses: ${importedExpenses}/${data.expenses.length}`);

        console.log('\n✅ Data import completed successfully!');

        // Close database connection
        billingDb.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('✅ Database connection closed');
            }
        });

    } catch (error) {
        console.error('❌ Error during import:', error);
        process.exit(1);
    }
}

// Run import
importData();
