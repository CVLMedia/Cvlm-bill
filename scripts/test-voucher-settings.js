#!/usr/bin/env node

/**
 * Test script to verify voucher settings functionality
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Path to database
const dbPath = path.join(__dirname, '../data/billing.db');

console.log('🔍 Testing voucher settings functionality...\n');

const db = new sqlite3.Database(dbPath);

// Test 1: Check table structure
console.log('📋 Test 1: Checking voucher_online_settings table structure');
db.all("PRAGMA table_info(voucher_online_settings)", (err, rows) => {
    if (err) {
        console.error('❌ Error:', err.message);
        return;
    }
    
    console.log('Table columns:');
    rows.forEach(row => {
        console.log(`  - ${row.name} (${row.type}) ${row.notnull ? 'NOT NULL' : ''} ${row.dflt_value ? 'DEFAULT ' + row.dflt_value : ''}`);
    });
    
    // Test 2: Check if we can read data
    console.log('\n📋 Test 2: Reading voucher online settings');
    db.all("SELECT * FROM voucher_online_settings LIMIT 1", (err, rows) => {
        if (err) {
            console.error('❌ Error:', err.message);
            return;
        }
        
        if (rows.length > 0) {
            console.log('✅ Successfully read data from voucher_online_settings');
            console.log('Sample row:', JSON.stringify(rows[0], null, 2));
        } else {
            console.log('⚠️  No data found in voucher_online_settings table');
        }
        
        // Test 3: Try to insert/update a record
        console.log('\n📋 Test 3: Testing insert/update operation');
        const testPackageId = 'test-package';
        const testValues = {
            package_id: testPackageId,
            name: 'Test Package',
            profile: 'test-profile',
            digits: 6,
            enabled: 1,
            agent_price: 1000,
            commission_amount: 200,
            is_active: 1
        };
        
        // First try to insert
        const insertSql = `
            INSERT OR REPLACE INTO voucher_online_settings 
            (package_id, name, profile, digits, enabled, agent_price, commission_amount, is_active, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `;
        
        const insertParams = [
            testValues.package_id,
            testValues.name,
            testValues.profile,
            testValues.digits,
            testValues.enabled,
            testValues.agent_price,
            testValues.commission_amount,
            testValues.is_active
        ];
        
        db.run(insertSql, insertParams, function(err) {
            if (err) {
                console.error('❌ Insert failed:', err.message);
                db.close();
                return;
            }
            
            console.log(`✅ Insert successful, row ID: ${this.lastID}`);
            
            // Now try to read it back
            db.get("SELECT * FROM voucher_online_settings WHERE package_id = ?", [testPackageId], (err, row) => {
                if (err) {
                    console.error('❌ Read after insert failed:', err.message);
                    db.close();
                    return;
                }
                
                if (row) {
                    console.log('✅ Read after insert successful');
                    console.log('Retrieved data:', JSON.stringify(row, null, 2));
                    
                    // Clean up test data
                    db.run("DELETE FROM voucher_online_settings WHERE package_id = ?", [testPackageId], (err) => {
                        if (err) {
                            console.error('⚠️  Cleanup failed:', err.message);
                        } else {
                            console.log('✅ Test data cleaned up');
                        }
                        db.close();
                        console.log('\n🎉 All tests completed successfully!');
                    });
                } else {
                    console.error('❌ Read after insert returned no data');
                    db.close();
                }
            });
        });
    });
});