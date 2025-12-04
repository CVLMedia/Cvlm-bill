const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '../data/billing.db');

async function fixInvoiceBaseAmount() {
    const db = new sqlite3.Database(dbPath);
    
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT i.id, i.invoice_number, i.amount, i.package_id, i.base_amount, i.tax_rate
            FROM invoices i
            WHERE i.base_amount IS NULL OR i.tax_rate IS NULL
        `, async (err, invoices) => {
            if (err) {
                console.error('Error getting invoices:', err);
                reject(err);
                return;
            }
            
            console.log(`Found ${invoices.length} invoices without base_amount or tax_rate`);
            
            for (const invoice of invoices) {
                try {
                    // Get package data
                    const package = await new Promise((resolve, reject) => {
                        db.get('SELECT price, tax_rate FROM packages WHERE id = ?', [invoice.package_id], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    
                    if (package) {
                        const baseAmount = package.price;
                        const taxRate = package.tax_rate || 11;
                        
                        console.log(`Invoice ${invoice.invoice_number}:`);
                        console.log(`  Package Price: Rp ${baseAmount.toLocaleString('id-ID')}`);
                        console.log(`  Tax Rate: ${taxRate}%`);
                        console.log(`  Current Amount: Rp ${invoice.amount.toLocaleString('id-ID')}`);
                        console.log(`  Setting base_amount: Rp ${baseAmount.toLocaleString('id-ID')}, tax_rate: ${taxRate}%`);
                        
                        // Update invoice
                        await new Promise((resolve, reject) => {
                            db.run('UPDATE invoices SET base_amount = ?, tax_rate = ? WHERE id = ?', 
                                [baseAmount, taxRate, invoice.id], 
                                function(err) {
                                    if (err) reject(err);
                                    else resolve();
                                });
                        });
                        
                        console.log(`  ✅ Updated!\n`);
                    } else {
                        console.log(`Invoice ${invoice.invoice_number}: Package not found\n`);
                    }
                } catch (error) {
                    console.error(`Error processing invoice ${invoice.invoice_number}:`, error.message);
                }
            }
            
            db.close();
            resolve();
        });
    });
}

fixInvoiceBaseAmount()
    .then(() => {
        console.log('✅ All invoices updated successfully!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Error:', err);
        process.exit(1);
    });
