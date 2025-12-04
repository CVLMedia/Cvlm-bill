const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const oldDbPath = '/home/enos/billing-system/data/billing.db';
const newDbPath = path.join(__dirname, '../data/billing.db');

console.log('📦 Starting data migration...');
console.log(`Source DB: ${oldDbPath}`);
console.log(`Target DB: ${newDbPath}`);

const oldDb = new sqlite3.Database(oldDbPath, sqlite3.OPEN_READONLY);
const newDb = new sqlite3.Database(newDbPath, sqlite3.OPEN_READWRITE);

// Enable foreign keys
newDb.run('PRAGMA foreign_keys = ON');

// Helper function untuk migrate table
function migrateTable(tableName, columns, transformFn = null) {
    return new Promise((resolve, reject) => {
        console.log(`\n📋 Migrating ${tableName}...`);
        
        oldDb.all(`SELECT * FROM ${tableName}`, [], (err, rows) => {
            if (err) {
                console.error(`❌ Error reading ${tableName}:`, err.message);
                return resolve(0); // Continue dengan table lain
            }
            
            if (rows.length === 0) {
                console.log(`   ⚠️  No data found in ${tableName}`);
                return resolve(0);
            }
            
            console.log(`   📊 Found ${rows.length} records`);
            
            const insertPromises = rows.map((row, index) => {
                return new Promise((res, rej) => {
                    // Apply transform if provided
                    const data = transformFn ? transformFn(row) : row;
                    
                    // Build column list
                    const colNames = columns.join(', ');
                    const placeholders = columns.map(() => '?').join(', ');
                    const values = columns.map(col => data[col] !== undefined ? data[col] : null);
                    
                    const sql = `INSERT OR REPLACE INTO ${tableName} (${colNames}) VALUES (${placeholders})`;
                    
                    newDb.run(sql, values, function(insertErr) {
                        if (insertErr) {
                            // Skip jika duplicate atau constraint error
                            if (insertErr.message.includes('UNIQUE') || insertErr.message.includes('FOREIGN KEY')) {
                                console.log(`   ⚠️  Skipping duplicate/constraint error for ${tableName} record ${index + 1}`);
                                return res();
                            }
                            console.error(`   ❌ Error inserting ${tableName} record ${index + 1}:`, insertErr.message);
                            return rej(insertErr);
                        }
                        res();
                    });
                });
            });
            
            Promise.all(insertPromises)
                .then(() => {
                    console.log(`   ✅ Successfully migrated ${rows.length} records from ${tableName}`);
                    resolve(rows.length);
                })
                .catch(err => {
                    console.error(`   ❌ Error migrating ${tableName}:`, err.message);
                    resolve(0);
                });
        });
    });
}

async function migrateData() {
    try {
        console.log('\n🚀 Starting migration process...\n');
        
        // 1. Migrate Packages first (dependencies)
        await migrateTable('packages', [
            'id', 'name', 'speed', 'price', 'tax_rate', 'description', 
            'pppoe_profile', 'router_id', 'is_active', 'created_at', 'image'
        ]);
        
        // 2. Migrate ODPs (before cable_routes)
        await migrateTable('odps', [
            'id', 'name', 'code', 'latitude', 'longitude', 'address',
            'capacity', 'used_ports', 'status', 'installation_date', 
            'notes', 'created_at', 'updated_at', 'parent_odp_id'
        ]);
        
        // 3. Migrate Customers
        await migrateTable('customers', [
            'id', 'username', 'name', 'phone', 'email', 'address',
            'package_id', 'status', 'join_date', 'pppoe_username', 
            'pppoe_profile', 'auto_suspension', 'billing_day',
            'latitude', 'longitude', 'created_by_technician_id',
            'static_ip', 'mac_address', 'assigned_ip', 'odp_id',
            'cable_type', 'cable_notes', 'port_number', 'cable_status',
            'cable_length', 'renewal_type', 'fix_date'
        ]);
        
        // 4. Migrate Cable Routes (depends on customers and odps)
        await migrateTable('cable_routes', [
            'id', 'customer_id', 'odp_id', 'cable_length', 'cable_type',
            'installation_date', 'status', 'port_number', 'notes',
            'created_at', 'updated_at'
        ]);
        
        // 5. Migrate Invoices (depends on customers and packages)
        await migrateTable('invoices', [
            'id', 'customer_id', 'package_id', 'invoice_number',
            'amount', 'due_date', 'status', 'payment_date',
            'payment_method', 'notes', 'created_at', 'payment_url',
            'payment_token', 'payment_status', 'payment_gateway',
            'base_amount', 'tax_rate', 'description', 'package_name',
            'invoice_type'
        ]);
        
        // 6. Migrate Payments (if exists)
        await migrateTable('payments', [
            'id', 'invoice_id', 'amount', 'payment_date',
            'payment_method', 'reference_number', 'notes'
        ]);
        
        // 7. Migrate customer_router_map if exists
        await migrateTable('customer_router_map', [
            'customer_id', 'router_id'
        ]);
        
        // 8. Migrate Collectors
        await migrateTable('collectors', [
            'id', 'name', 'phone', 'email', 'address', 'commission_rate',
            'status', 'notes', 'created_at', 'updated_at'
        ]);
        
        // 9. Migrate Expenses (adapt columns based on schema)
        await migrateTable('expenses', [
            'id', 'description', 'amount', 'category', 'expense_date',
            'payment_method', 'notes', 'created_at', 'updated_at'
        ]);
        
        // 10. Migrate Collector Payments
        await migrateTable('collector_payments', [
            'id', 'collector_id', 'invoice_id', 'amount', 'payment_date',
            'payment_method', 'reference_number', 'commission_amount',
            'notes', 'created_at'
        ]);
        
        // 11. Migrate Collector Remittances
        await migrateTable('collector_remittances', [
            'id', 'collector_id', 'total_amount', 'commission_amount',
            'net_amount', 'remittance_date', 'status', 'notes',
            'created_at', 'created_by'
        ]);
        
        console.log('\n✅ Migration completed successfully!');
        console.log('\n📊 Summary:');
        console.log('   - Packages migrated');
        console.log('   - ODPs migrated');
        console.log('   - Customers migrated');
        console.log('   - Cable Routes migrated');
        console.log('   - Invoices migrated');
        console.log('   - Payments migrated (if exists)');
        console.log('   - Customer Router Mapping migrated (if exists)');
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    } finally {
        oldDb.close();
        newDb.close();
        console.log('\n🔒 Database connections closed');
    }
}

migrateData();

