/**
 * Check Database Structure
 * Script untuk mengecek struktur database yang ada
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkDatabaseStructure() {
    try {
        console.log('🔍 Checking database structure...');
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Check if database exists and is accessible
        console.log('📊 Database path:', dbPath);
        
        // Get all tables
        const tables = await new Promise((resolve, reject) => {
            db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log('📋 Existing tables:');
        tables.forEach(table => {
            console.log(`  ✅ ${table.name}`);
        });
        
        // Check customers table structure
        if (tables.some(t => t.name === 'customers')) {
            console.log('\n👥 Customers table structure:');
            const customerColumns = await new Promise((resolve, reject) => {
                db.all("PRAGMA table_info(customers)", (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
            
            customerColumns.forEach(col => {
                console.log(`  - ${col.name} (${col.type})`);
            });
        } else {
            console.log('\n❌ Customers table not found!');
        }
        
        // Check invoices table structure
        if (tables.some(t => t.name === 'invoices')) {
            console.log('\n🧾 Invoices table structure:');
            const invoiceColumns = await new Promise((resolve, reject) => {
                db.all("PRAGMA table_info(invoices)", (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
            
            invoiceColumns.forEach(col => {
                console.log(`  - ${col.name} (${col.type})`);
            });
        } else {
            console.log('\n❌ Invoices table not found!');
        }
        
        // Check if collectors tables exist
        const collectorTables = ['collectors', 'collector_payments', 'collector_assignments'];
        console.log('\n👥 Collector tables status:');
        for (const tableName of collectorTables) {
            const exists = tables.some(t => t.name === tableName);
            console.log(`  ${exists ? '✅' : '❌'} ${tableName}`);
        }
        
        db.close();
        console.log('\n🎉 Database structure check completed!');
        
    } catch (error) {
        console.error('💥 Error checking database structure:', error);
        process.exit(1);
    }
}

// Run check if called directly
if (require.main === module) {
    checkDatabaseStructure();
}

module.exports = checkDatabaseStructure;