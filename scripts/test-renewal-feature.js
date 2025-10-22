const path = require('path');
const sqlite3 = require('sqlite3').verbose();

console.log('🧪 Testing Renewal and Fix Date Feature...\n');

const dbPath = path.join(__dirname, '../data/billing.db');

async function testRenewalFeature() {
    let db;
    try {
        // Connect to database
        db = new sqlite3.Database(dbPath);
        console.log('✅ Connected to database');

        // Test 1: Check if columns exist
        console.log('\n📋 Test 1: Checking if renewal_type and fix_date columns exist...');
        const columns = await new Promise((resolve, reject) => {
            db.all('PRAGMA table_info(customers)', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        const hasRenewalType = columns.some(col => col.name === 'renewal_type');
        const hasFixDate = columns.some(col => col.name === 'fix_date');

        if (hasRenewalType && hasFixDate) {
            console.log('✅ Both columns exist');
        } else {
            console.log(`❌ Missing columns: ${!hasRenewalType ? 'renewal_type ' : ''}${!hasFixDate ? 'fix_date' : ''}`);
            return;
        }

        // Test 2: Check sample customers
        console.log('\n📊 Test 2: Sample customers with renewal settings...');
        const sampleCustomers = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, renewal_type, fix_date, billing_day 
                FROM customers 
                LIMIT 10
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        sampleCustomers.forEach(customer => {
            console.log(`  - ${customer.name}: renewal_type=${customer.renewal_type}, fix_date=${customer.fix_date}, billing_day=${customer.billing_day}`);
        });

        // Test 3: Test calculateNextDueDate logic manually
        console.log('\n🧮 Test 3: Testing next due date calculation...');
        
        // Scenario 1: Fix Date - Payment before due date
        console.log('\nScenario 1: Fix Date - Payment before due date');
        const customer1 = {
            renewal_type: 'fix_date',
            fix_date: 15,
            billing_day: 15,
            name: 'Test Customer 1'
        };
        const currentDueDate1 = '2025-01-15';
        const paymentDate1 = '2025-01-10';
        const nextDue1 = calculateNextDueDate(customer1, currentDueDate1, paymentDate1);
        console.log(`  Current Due: ${currentDueDate1}, Payment: ${paymentDate1}, Next Due: ${nextDue1}`);
        console.log(`  Expected: 2025-02-15, Got: ${nextDue1}, ${nextDue1 === '2025-02-15' ? '✅ PASS' : '❌ FAIL'}`);

        // Scenario 2: Fix Date - Payment after due date
        console.log('\nScenario 2: Fix Date - Payment after due date');
        const customer2 = {
            renewal_type: 'fix_date',
            fix_date: 15,
            billing_day: 15,
            name: 'Test Customer 2'
        };
        const currentDueDate2 = '2025-01-15';
        const paymentDate2 = '2025-01-20';
        const nextDue2 = calculateNextDueDate(customer2, currentDueDate2, paymentDate2);
        console.log(`  Current Due: ${currentDueDate2}, Payment: ${paymentDate2}, Next Due: ${nextDue2}`);
        console.log(`  Expected: 2025-02-15, Got: ${nextDue2}, ${nextDue2 === '2025-02-15' ? '✅ PASS' : '❌ FAIL'}`);

        // Scenario 3: Renewal - Payment before due date
        console.log('\nScenario 3: Renewal - Payment before due date');
        const customer3 = {
            renewal_type: 'renewal',
            billing_day: 15,
            name: 'Test Customer 3'
        };
        const currentDueDate3 = '2025-01-15';
        const paymentDate3 = '2025-01-10';
        const nextDue3 = calculateNextDueDate(customer3, currentDueDate3, paymentDate3);
        console.log(`  Current Due: ${currentDueDate3}, Payment: ${paymentDate3}, Next Due: ${nextDue3}`);
        console.log(`  Expected: 2025-02-15, Got: ${nextDue3}, ${nextDue3 === '2025-02-15' ? '✅ PASS' : '❌ FAIL'}`);

        // Scenario 4: Renewal - Payment after due date
        console.log('\nScenario 4: Renewal - Payment after due date');
        const customer4 = {
            renewal_type: 'renewal',
            billing_day: 15,
            name: 'Test Customer 4'
        };
        const currentDueDate4 = '2025-01-15';
        const paymentDate4 = '2025-01-20';
        const nextDue4 = calculateNextDueDate(customer4, currentDueDate4, paymentDate4);
        console.log(`  Current Due: ${currentDueDate4}, Payment: ${paymentDate4}, Next Due: ${nextDue4}`);
        console.log(`  Expected: 2025-02-20, Got: ${nextDue4}, ${nextDue4 === '2025-02-20' ? '✅ PASS' : '❌ FAIL'}`);

        // Test 4: Check invoices
        console.log('\n📋 Test 4: Sample invoices...');
        const sampleInvoices = await new Promise((resolve, reject) => {
            db.all(`
                SELECT i.id, i.invoice_number, i.due_date, i.status, 
                       c.name as customer_name, c.renewal_type, c.fix_date 
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                ORDER BY i.created_at DESC
                LIMIT 5
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        sampleInvoices.forEach(invoice => {
            console.log(`  - ${invoice.invoice_number}: ${invoice.customer_name} (${invoice.renewal_type}), Due: ${invoice.due_date}, Status: ${invoice.status}`);
        });

        console.log('\n🎉 All tests completed!');

    } catch (error) {
        console.error('❌ Error during test:', error);
    } finally {
        if (db) {
            db.close();
            console.log('✅ Database connection closed');
        }
    }
}

// Calculate next due date based on renewal type (replicate from billing.js)
function calculateNextDueDate(customer, currentDueDate, paymentDate) {
    const renewalType = customer.renewal_type || 'renewal';
    const fixDate = customer.fix_date || customer.billing_day || 15;
    const payment = new Date(paymentDate);
    const currentDue = new Date(currentDueDate);
    
    if (renewalType === 'fix_date') {
        // Fix Date: Tanggal jatuh tempo tetap sesuai fix_date
        const nextDue = new Date(currentDue);
        nextDue.setMonth(nextDue.getMonth() + 1);
        nextDue.setDate(Math.min(fixDate, new Date(nextDue.getFullYear(), nextDue.getMonth() + 1, 0).getDate()));
        return nextDue.toISOString().split('T')[0];
    } else {
        // Renewal: Tanggal jatuh tempo mengikuti tanggal pembayaran
        // Jika bayar sebelum jatuh tempo, tanggal tetap
        // Jika bayar setelah jatuh tempo, tanggal berubah sesuai tanggal bayar
        
        if (payment <= currentDue) {
            // Bayar sebelum atau tepat jatuh tempo: tanggal tetap
            const nextDue = new Date(currentDue);
            nextDue.setMonth(nextDue.getMonth() + 1);
            return nextDue.toISOString().split('T')[0];
        } else {
            // Bayar setelah jatuh tempo: tanggal berubah sesuai tanggal bayar
            const nextDue = new Date(payment);
            nextDue.setMonth(nextDue.getMonth() + 1);
            return nextDue.toISOString().split('T')[0];
        }
    }
}

// Run test
testRenewalFeature();
