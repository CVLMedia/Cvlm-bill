#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Starting Gembok-Bill to Billing-System Data Migration\n');

console.log('📋 Migration Steps:');
console.log('1. Export data from gembok-bill database');
console.log('2. Import data to billing-system database');
console.log('3. Verify migration results\n');

try {
    // Step 1: Export data from gembok-bill
    console.log('📤 Step 1: Exporting data from gembok-bill...');
    console.log('=' .repeat(50));
    execSync('node scripts/export-gembok-data.js', { 
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
    });
    
    console.log('\n📥 Step 2: Importing data to billing-system...');
    console.log('=' .repeat(50));
    execSync('node scripts/import-gembok-data.js', { 
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
    });
    
    console.log('\n✅ Migration completed successfully!');
    console.log('\n📊 Next Steps:');
    console.log('1. Check the billing-system admin panel to verify data');
    console.log('2. Test customer management functionality');
    console.log('3. Test invoice generation and payment processing');
    console.log('4. Verify ODP and cable network data');
    
} catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure gembok-bill database exists and is accessible');
    console.log('2. Check that billing-system has proper permissions');
    console.log('3. Verify that all required tables exist in both databases');
    process.exit(1);
}
