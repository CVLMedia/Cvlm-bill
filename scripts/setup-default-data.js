#!/usr/bin/env node

/**
 * Default Data Setup - Menambahkan data default untuk server baru
 * Script ini akan menambahkan data default yang diperlukan tanpa menghapus data yang sudah ada
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function setupDefaultData() {
    const dbPath = path.join(__dirname, '../data/billing.db');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('🚀 Setting up default data for new server...\n');
        
        // Step 1: Check if packages exist, if not create default packages
        console.log('📦 Step 1: Checking packages...');
        const packageCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM packages', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        
        if (packageCount === 0) {
            console.log('   📦 No packages found, creating default packages...');
            const defaultPackages = [
                {
                    name: 'Paket Internet Dasar',
                    speed: '10 Mbps',
                    price: 100000,
                    tax_rate: 11,
                    description: 'Paket internet dasar 10 Mbps unlimited',
                    pppoe_profile: 'default'
                },
                {
                    name: 'Paket Internet Standard',
                    speed: '20 Mbps',
                    price: 150000,
                    tax_rate: 11,
                    description: 'Paket internet standard 20 Mbps unlimited',
                    pppoe_profile: 'standard'
                },
                {
                    name: 'Paket Internet Premium',
                    speed: '50 Mbps',
                    price: 250000,
                    tax_rate: 11,
                    description: 'Paket internet premium 50 Mbps unlimited',
                    pppoe_profile: 'premium'
                }
            ];
            
            for (const pkg of defaultPackages) {
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO packages (name, speed, price, tax_rate, description, pppoe_profile) 
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        pkg.name, pkg.speed, pkg.price, pkg.tax_rate, pkg.description, pkg.pppoe_profile
                    ], function(err) {
                        if (err) reject(err);
                        else {
                            console.log(`   ✅ Package ${pkg.name} created (ID: ${this.lastID})`);
                            resolve();
                        }
                    });
                });
            }
        } else {
            console.log(`   ✅ Found ${packageCount} existing packages`);
        }
        
        // Step 2: Check if technicians exist, if not create default technician
        console.log('\n👨‍💼 Step 2: Checking technicians...');
        const technicianCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM technicians', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        
        if (technicianCount === 0) {
            console.log('   👨‍💼 No technicians found, creating default technician...');
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO technicians (name, phone, role, is_active, area_coverage, join_date, created_at) 
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `, [
                    'Administrator',
                    '081234567890',
                    'technician',
                    1,
                    'All Areas'
                ], function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`   ✅ Default technician created (ID: ${this.lastID})`);
                        resolve();
                    }
                });
            });
        } else {
            console.log(`   ✅ Found ${technicianCount} existing technicians`);
        }
        
        // Step 3: Check if voucher pricing exists, if not create default voucher pricing
        console.log('\n🎫 Step 3: Checking voucher pricing...');
        const voucherCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM voucher_pricing', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        
        if (voucherCount === 0) {
            console.log('   🎫 No voucher pricing found, creating default voucher pricing...');
            const defaultVouchers = [
                {
                    package_name: '3K',
                    duration: 1,
                    duration_type: 'days',
                    customer_price: 3000,
                    agent_price: 2000,
                    commission_amount: 1000,
                    voucher_digit_type: 'numbers',
                    voucher_length: 4,
                    account_type: 'voucher',
                    hotspot_profile: '3k',
                    description: 'Voucher 3K - 1 hari',
                    is_active: 1
                },
                {
                    package_name: '5K',
                    duration: 2,
                    duration_type: 'days',
                    customer_price: 5000,
                    agent_price: 4000,
                    commission_amount: 1000,
                    voucher_digit_type: 'numbers',
                    voucher_length: 5,
                    account_type: 'voucher',
                    hotspot_profile: '5k',
                    description: 'Voucher 5K - 2 hari',
                    is_active: 1
                },
                {
                    package_name: '10K',
                    duration: 5,
                    duration_type: 'days',
                    customer_price: 10000,
                    agent_price: 8000,
                    commission_amount: 2000,
                    voucher_digit_type: 'numbers',
                    voucher_length: 5,
                    account_type: 'voucher',
                    hotspot_profile: '10k',
                    description: 'Voucher 10K - 5 hari',
                    is_active: 1
                }
            ];
            
            for (const voucher of defaultVouchers) {
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO voucher_pricing (
                            package_name, duration, duration_type, customer_price, agent_price,
                            commission_amount, voucher_digit_type, voucher_length, account_type,
                            hotspot_profile, description, is_active, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    `, [
                        voucher.package_name, voucher.duration, voucher.duration_type,
                        voucher.customer_price, voucher.agent_price, voucher.commission_amount,
                        voucher.voucher_digit_type, voucher.voucher_length, voucher.account_type,
                        voucher.hotspot_profile, voucher.description, voucher.is_active
                    ], function(err) {
                        if (err) reject(err);
                        else {
                            console.log(`   ✅ Voucher ${voucher.package_name} created (ID: ${this.lastID})`);
                            resolve();
                        }
                    });
                });
            }
        } else {
            console.log(`   ✅ Found ${voucherCount} existing voucher pricing`);
        }
        
        // Step 4: Check if agents exist, if not create default agent
        console.log('\n👤 Step 4: Checking agents...');
        const agentCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM agents', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        
        if (agentCount === 0) {
            console.log('   👤 No agents found, creating default agent...');
            const agentId = await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO agents (name, username, phone, email, password, status, created_at) 
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    'Agent Test',
                    'agent_test',
                    '081234567890',
                    'agent@test.com',
                    'password123',
                    'active'
                ], function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`   ✅ Default agent created (ID: ${this.lastID})`);
                        resolve(this.lastID);
                    }
                });
            });
            
            // Create agent balance
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO agent_balances (agent_id, balance, last_updated) 
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                `, [agentId, 100000], function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`   ✅ Agent balance created: Rp 100,000`);
                        resolve();
                    }
                });
            });
        } else {
            console.log(`   ✅ Found ${agentCount} existing agents`);
        }
        
        // Step 5: Check if collectors exist, if not create default collector
        console.log('\n💰 Step 5: Checking collectors...');
        const collectorCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM collectors', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        
        if (collectorCount === 0) {
            console.log('   💰 No collectors found, creating default collector...');
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO collectors (name, phone, email, status, commission_rate, created_at) 
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    'Kolektor Utama',
                    '081234567891',
                    'kolektor@company.com',
                    'active',
                    10.0
                ], function(err) {
                    if (err) reject(err);
                    else {
                        console.log(`   ✅ Default collector created (ID: ${this.lastID})`);
                        resolve();
                    }
                });
            });
        } else {
            console.log(`   ✅ Found ${collectorCount} existing collectors`);
        }
        
        // Step 6: Create sample invoice to test invoice_type column
        console.log('\n📄 Step 6: Creating sample invoice for testing...');
        const invoiceCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM invoices', (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
        
        if (invoiceCount === 0) {
            console.log('   📄 No invoices found, creating sample invoice...');
            
            // Get first package and technician
            const firstPackage = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM packages LIMIT 1', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (firstPackage) {
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO invoices (
                            customer_id, package_id, invoice_number, amount, due_date, 
                            status, invoice_type, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    `, [
                        1, // dummy customer_id
                        firstPackage.id,
                        'SAMPLE-001',
                        100000,
                        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                        'unpaid',
                        'monthly'
                    ], function(err) {
                        if (err) {
                            console.log(`   ⚠️  Could not create sample invoice: ${err.message}`);
                            resolve(); // Don't fail the whole process
                        } else {
                            console.log(`   ✅ Sample invoice created (ID: ${this.lastID})`);
                            resolve();
                        }
                    });
                });
            }
        } else {
            console.log(`   ✅ Found ${invoiceCount} existing invoices`);
        }
        
        console.log('\n🎉 Default data setup completed successfully!');
        console.log('📋 Summary:');
        console.log('   ✅ Packages checked/created');
        console.log('   ✅ Technicians checked/created');
        console.log('   ✅ Voucher pricing checked/created');
        console.log('   ✅ Agents checked/created');
        console.log('   ✅ Collectors checked/created');
        console.log('   ✅ Sample invoice created for testing');
        console.log('\n🚀 Server is ready for use!');
        
    } catch (error) {
        console.error('❌ Error during default data setup:', error);
        throw error;
    } finally {
        db.close();
    }
}

// Run if called directly
if (require.main === module) {
    setupDefaultData()
        .then(() => {
            console.log('\n✅ Default data setup completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Default data setup failed:', error);
            process.exit(1);
        });
}

module.exports = setupDefaultData;
