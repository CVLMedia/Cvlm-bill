const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Checking payment gateway database setup...');

// Function to check if table exists
function checkTableExists(tableName) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
}

// Function to check if column exists in table
function checkColumnExists(tableName, columnName) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
            if (err) reject(err);
            else {
                const exists = rows.some(col => col.name === columnName);
                resolve(exists);
            }
        });
    });
}

async function setupPaymentGatewayTables() {
    try {
        // Check if invoices table exists
        const invoicesExists = await checkTableExists('invoices');
        if (!invoicesExists) {
            console.log('❌ invoices table not found. Please run the main application first to initialize the database.');
            db.close();
            return;
        }

        console.log('✅ invoices table found');

        // Check if payment_gateway_transactions table exists
        const transactionsExists = await checkTableExists('payment_gateway_transactions');
        if (!transactionsExists) {
            console.log('📝 Creating payment_gateway_transactions table...');
            
            await new Promise((resolve, reject) => {
                db.run(`
                    CREATE TABLE payment_gateway_transactions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        invoice_id INTEGER,
                        gateway VARCHAR(50),
                        order_id VARCHAR(100),
                        payment_url TEXT,
                        token VARCHAR(255),
                        amount DECIMAL(10,2),
                        status VARCHAR(50),
                        payment_type VARCHAR(50),
                        fraud_status VARCHAR(50),
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
                    )
                `, function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log('✅ payment_gateway_transactions table created successfully');
        } else {
            console.log('✅ payment_gateway_transactions table already exists');
        }

        // Check and add payment gateway columns to invoices table
        const columnsToAdd = [
            { name: 'payment_gateway', type: 'VARCHAR(50)' },
            { name: 'payment_token', type: 'VARCHAR(255)' },
            { name: 'payment_url', type: 'TEXT' },
            { name: 'payment_status', type: "VARCHAR(50) DEFAULT 'pending'" }
        ];

        for (const column of columnsToAdd) {
            const columnExists = await checkColumnExists('invoices', column.name);
            if (!columnExists) {
                console.log(`📝 Adding ${column.name} column to invoices table...`);
                await new Promise((resolve, reject) => {
                    db.run(`ALTER TABLE invoices ADD COLUMN ${column.name} ${column.type}`, function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.log(`✅ ${column.name} column added to invoices table`);
            } else {
                console.log(`✅ ${column.name} column already exists in invoices table`);
            }
        }

        // Create indexes for better performance
        console.log('📝 Creating indexes...');
        
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE INDEX IF NOT EXISTS idx_payment_gateway_transactions_invoice_id 
                ON payment_gateway_transactions(invoice_id)
            `, function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ Index created for payment_gateway_transactions invoice_id');

        await new Promise((resolve, reject) => {
            db.run(`
                CREATE INDEX IF NOT EXISTS idx_payment_gateway_transactions_order_id 
                ON payment_gateway_transactions(order_id)
            `, function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ Index created for payment_gateway_transactions order_id');

        console.log('🎉 Payment gateway database setup completed successfully!');
        
    } catch (error) {
        console.error('❌ Error during payment gateway setup:', error);
    } finally {
        db.close();
    }
}

// Run the setup
setupPaymentGatewayTables(); 