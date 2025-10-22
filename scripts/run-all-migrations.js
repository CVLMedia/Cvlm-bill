#!/usr/bin/env node

/**
 * Script to run all database migrations
 * Ensures database schema is up to date
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Running all database migrations...\n');

// Migration script paths
const migrationScripts = [
    'run-voucher-online-settings-migrations.js',
    'run-migration-whatsapp-group.js',
    'setup-collectors-system.js',
    'setup-monthly-summary.js',
    'setup-technicians.js',
    'setup-mapping-database.js'
];

let successCount = 0;
let errorCount = 0;

migrationScripts.forEach(script => {
    const scriptPath = path.join(__dirname, script);
    
    if (fs.existsSync(scriptPath)) {
        try {
            console.log(`🚀 Running ${script}...`);
            execSync(`node ${scriptPath}`, { stdio: 'inherit', cwd: __dirname });
            console.log(`✅ ${script} completed successfully\n`);
            successCount++;
        } catch (error) {
            console.log(`❌ ${script} failed: ${error.message}\n`);
            errorCount++;
        }
    } else {
        console.log(`⚠️  ${script} not found, skipping...\n`);
    }
});

console.log('📋 Migration Summary:');
console.log(`✅ Successful: ${successCount}`);
console.log(`❌ Failed: ${errorCount}`);
console.log(`⚠️  Skipped: ${migrationScripts.length - successCount - errorCount}`);

if (errorCount === 0) {
    console.log('\n🎉 All migrations completed successfully!');
    console.log('✅ Database schema is up to date');
} else {
    console.log('\n⚠️  Some migrations failed. Please check the errors above.');
    process.exit(1);
}