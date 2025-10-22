const sqlite3 = require('sqlite3').verbose();
const path = require('path');

console.log('🔧 Adding Renewal Type and Fix Date columns to customers table...\n');

const dbPath = path.join(__dirname, '../data/billing.db');

async function addRenewalColumns() {
    let db;
    try {
        // Connect to database
        db = new sqlite3.Database(dbPath);
        console.log('✅ Connected to database');

        // Check current table structure
        console.log('📋 Current customers table structure:');
        const currentColumns = await new Promise((resolve, reject) => {
            db.all('PRAGMA table_info(customers)', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        currentColumns.forEach(col => {
            console.log(`  - ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.pk ? 'PRIMARY KEY' : ''}`);
        });

        // Check if renewal_type column exists
        const hasRenewalType = currentColumns.some(col => col.name === 'renewal_type');
        const hasFixDate = currentColumns.some(col => col.name === 'fix_date');

        console.log(`\n🔍 Has renewal_type column: ${hasRenewalType}`);
        console.log(`🔍 Has fix_date column: ${hasFixDate}`);

        // Add renewal_type column if it doesn't exist
        if (!hasRenewalType) {
            console.log('\n➕ Adding renewal_type column...');
            await new Promise((resolve, reject) => {
                db.run(`
                    ALTER TABLE customers 
                    ADD COLUMN renewal_type TEXT DEFAULT 'renewal' 
                    CHECK (renewal_type IN ('renewal', 'fix_date'))
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log('✅ renewal_type column added successfully');
        } else {
            console.log('✅ renewal_type column already exists');
        }

        // Add fix_date column if it doesn't exist
        if (!hasFixDate) {
            console.log('\n➕ Adding fix_date column...');
            await new Promise((resolve, reject) => {
                db.run(`
                    ALTER TABLE customers 
                    ADD COLUMN fix_date INTEGER DEFAULT NULL
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log('✅ fix_date column added successfully');
        } else {
            console.log('✅ fix_date column already exists');
        }

        // Show updated table structure
        console.log('\n📋 Updated customers table structure:');
        const updatedColumns = await new Promise((resolve, reject) => {
            db.all('PRAGMA table_info(customers)', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        updatedColumns.forEach(col => {
            console.log(`  - ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.pk ? 'PRIMARY KEY' : ''}`);
        });

        // Update existing customers to have default renewal_type
        console.log('\n🔄 Updating existing customers...');
        const updateResult = await new Promise((resolve, reject) => {
            db.run(`
                UPDATE customers 
                SET renewal_type = 'renewal' 
                WHERE renewal_type IS NULL
            `, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
        console.log(`✅ Updated ${updateResult} existing customers with default renewal_type`);

        // Show sample data
        console.log('\n📊 Sample customers data:');
        const sampleCustomers = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, renewal_type, fix_date, status 
                FROM customers 
                LIMIT 5
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        sampleCustomers.forEach(customer => {
            console.log(`  - ${customer.name}: renewal_type=${customer.renewal_type}, fix_date=${customer.fix_date}, status=${customer.status}`);
        });

        console.log('\n🎉 Renewal columns added successfully!');

    } catch (error) {
        console.error('❌ Error adding renewal columns:', error);
    } finally {
        if (db) {
            db.close();
            console.log('✅ Database connection closed');
        }
    }
}

// Run the migration
addRenewalColumns();
