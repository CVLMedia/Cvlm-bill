const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

console.log('🔧 Fixing foreign key constraint issues...\n');

// Path ke database billing-system
const billingDbPath = '/root/billing-system/data/billing.db';
const exportDir = path.join(__dirname, '../data/migration');
const exportFile = path.join(exportDir, 'gembok-data-export.json');

// Koneksi ke database billing-system
const billingDb = new sqlite3.Database(billingDbPath, (err) => {
    if (err) {
        console.error('❌ Error connecting to billing-system database:', err);
        process.exit(1);
    } else {
        console.log('✅ Connected to billing-system database');
    }
});

// Disable foreign keys temporarily for fixing
billingDb.run("PRAGMA foreign_keys = OFF", (err) => {
    if (err) {
        console.error('❌ Error disabling foreign keys:', err);
    } else {
        console.log('✅ Foreign keys disabled for fixing');
    }
});

async function fixForeignKeyIssues() {
    try {
        // Read export file
        console.log('📖 Reading export file...');
        const exportData = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
        const { data } = exportData;

        // First, let's check what customers failed to import
        console.log('\n🔍 Checking failed customers...');
        const failedCustomers = [];
        for (const customerData of data.customers) {
            const exists = await new Promise((resolve, reject) => {
                billingDb.get('SELECT id FROM customers WHERE id = ?', [customerData.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                });
            });
            if (!exists) {
                failedCustomers.push(customerData);
            }
        }
        console.log(`Found ${failedCustomers.length} customers that failed to import`);

        // Try to import failed customers with NULL package_id if package doesn't exist
        console.log('\n👥 Fixing customer imports...');
        let fixedCustomers = 0;
        for (const customerData of failedCustomers) {
            try {
                // Check if package exists
                const packageExists = await new Promise((resolve, reject) => {
                    billingDb.get('SELECT id FROM packages WHERE id = ?', [customerData.package_id], (err, row) => {
                        if (err) reject(err);
                        else resolve(!!row);
                    });
                });

                const packageId = packageExists ? customerData.package_id : null;

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
                        packageId,
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
                fixedCustomers++;
                console.log(`✅ Fixed customer ${customerData.id} (package_id: ${packageId})`);
            } catch (error) {
                console.error(`❌ Still failed to import customer ${customerData.id}:`, error.message);
            }
        }
        console.log(`✅ Fixed ${fixedCustomers}/${failedCustomers.length} customers`);

        // Now fix invoices
        console.log('\n🧾 Fixing invoice imports...');
        const failedInvoices = [];
        for (const invoiceData of data.invoices) {
            const exists = await new Promise((resolve, reject) => {
                billingDb.get('SELECT id FROM invoices WHERE id = ?', [invoiceData.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                });
            });
            if (!exists) {
                failedInvoices.push(invoiceData);
            }
        }
        console.log(`Found ${failedInvoices.length} invoices that failed to import`);

        let fixedInvoices = 0;
        for (const invoiceData of failedInvoices) {
            try {
                // Check if customer exists
                const customerExists = await new Promise((resolve, reject) => {
                    billingDb.get('SELECT id FROM customers WHERE id = ?', [invoiceData.customer_id], (err, row) => {
                        if (err) reject(err);
                        else resolve(!!row);
                    });
                });

                // Check if package exists
                const packageExists = await new Promise((resolve, reject) => {
                    billingDb.get('SELECT id FROM packages WHERE id = ?', [invoiceData.package_id], (err, row) => {
                        if (err) reject(err);
                        else resolve(!!row);
                    });
                });

                if (!customerExists || !packageExists) {
                    console.log(`⚠️ Skipping invoice ${invoiceData.id} - missing customer (${customerExists}) or package (${packageExists})`);
                    continue;
                }

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
                fixedInvoices++;
                console.log(`✅ Fixed invoice ${invoiceData.id}`);
            } catch (error) {
                console.error(`❌ Still failed to import invoice ${invoiceData.id}:`, error.message);
            }
        }
        console.log(`✅ Fixed ${fixedInvoices}/${failedInvoices.length} invoices`);

        // Now fix payments
        console.log('\n💰 Fixing payment imports...');
        const failedPayments = [];
        for (const paymentData of data.payments) {
            const exists = await new Promise((resolve, reject) => {
                billingDb.get('SELECT id FROM payments WHERE id = ?', [paymentData.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                });
            });
            if (!exists) {
                failedPayments.push(paymentData);
            }
        }
        console.log(`Found ${failedPayments.length} payments that failed to import`);

        let fixedPayments = 0;
        for (const paymentData of failedPayments) {
            try {
                // Check if invoice exists
                const invoiceExists = await new Promise((resolve, reject) => {
                    billingDb.get('SELECT id FROM invoices WHERE id = ?', [paymentData.invoice_id], (err, row) => {
                        if (err) reject(err);
                        else resolve(!!row);
                    });
                });

                if (!invoiceExists) {
                    console.log(`⚠️ Skipping payment ${paymentData.id} - missing invoice ${paymentData.invoice_id}`);
                    continue;
                }

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
                fixedPayments++;
                console.log(`✅ Fixed payment ${paymentData.id}`);
            } catch (error) {
                console.error(`❌ Still failed to import payment ${paymentData.id}:`, error.message);
            }
        }
        console.log(`✅ Fixed ${fixedPayments}/${failedPayments.length} payments`);

        // Re-enable foreign keys
        billingDb.run("PRAGMA foreign_keys = ON", (err) => {
            if (err) {
                console.error('❌ Error re-enabling foreign keys:', err);
            } else {
                console.log('✅ Foreign keys re-enabled');
            }
        });

        console.log('\n✅ Foreign key constraint fixes completed!');

        // Close database connection
        billingDb.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('✅ Database connection closed');
            }
        });

    } catch (error) {
        console.error('❌ Error during fix:', error);
        process.exit(1);
    }
}

// Run fix
fixForeignKeyIssues();
