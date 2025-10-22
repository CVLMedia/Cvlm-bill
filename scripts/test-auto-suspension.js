#!/usr/bin/env node

/**
 * Script untuk test auto suspension system
 * Menjalankan pengecekan dan isolir otomatis untuk pelanggan yang telat bayar
 */

const path = require('path');
const logger = require('../config/logger');

// Set working directory
process.chdir(path.join(__dirname, '..'));

async function testAutoSuspension() {
    try {
        console.log('🔧 Testing Auto Suspension System...\n');
        
        // Import required modules
        const serviceSuspension = require('../config/serviceSuspension');
        const billingManager = require('../config/billing');
        const { getSetting, clearSettingsCache } = require('../config/settingsManager');
        
        // Clear cache to ensure fresh settings
        clearSettingsCache();
        
        // Check settings
        console.log('📋 Checking Settings:');
        const autoSuspensionEnabled = getSetting('auto_suspension_enabled', true) === true || getSetting('auto_suspension_enabled', 'true') === 'true';
        const gracePeriodDays = parseInt(getSetting('suspension_grace_period_days', '7'));
        const isolirProfile = getSetting('isolir_profile', 'ISOLIR');
        
        console.log(`   • Auto Suspension Enabled: ${autoSuspensionEnabled}`);
        console.log(`   • Grace Period Days: ${gracePeriodDays}`);
        console.log(`   • Isolir Profile: ${isolirProfile}\n`);
        
        if (!autoSuspensionEnabled) {
            console.log('❌ Auto suspension is disabled in settings');
            return;
        }
        
        // Check overdue invoices
        console.log('📄 Checking Overdue Invoices:');
        const overdueInvoices = await billingManager.getOverdueInvoices();
        console.log(`   • Found ${overdueInvoices.length} overdue invoices\n`);
        
        if (overdueInvoices.length === 0) {
            console.log('✅ No overdue invoices found');
            return;
        }
        
        // Show overdue invoices details
        console.log('📋 Overdue Invoices Details:');
        for (const invoice of overdueInvoices.slice(0, 5)) { // Show first 5
            const customer = await billingManager.getCustomerById(invoice.customer_id);
            const dueDate = new Date(invoice.due_date);
            const today = new Date();
            const dueDateStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
            const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const daysOverdue = Math.floor((todayStart - dueDateStart) / (1000 * 60 * 60 * 24));
            
            console.log(`   • ${customer.name} (${customer.username})`);
            console.log(`     - Invoice: ${invoice.invoice_number}`);
            console.log(`     - Due Date: ${invoice.due_date}`);
            console.log(`     - Days Overdue: ${daysOverdue}`);
            console.log(`     - Customer Status: ${customer.status}`);
            console.log(`     - Auto Suspension: ${customer.auto_suspension === 1 ? 'Enabled' : 'Disabled'}`);
            console.log(`     - Should Suspend: ${daysOverdue >= gracePeriodDays ? 'YES' : 'NO'}\n`);
        }
        
        if (overdueInvoices.length > 5) {
            console.log(`   ... and ${overdueInvoices.length - 5} more invoices\n`);
        }
        
        // Run auto suspension check
        console.log('🚀 Running Auto Suspension Check:');
        const result = await serviceSuspension.checkAndSuspendOverdueCustomers();
        
        console.log('\n📊 Results:');
        console.log(`   • Checked: ${result.checked} invoices`);
        console.log(`   • Suspended: ${result.suspended} customers`);
        console.log(`   • Errors: ${result.errors}`);
        
        if (result.details && result.details.length > 0) {
            console.log('\n📋 Details:');
            for (const detail of result.details) {
                console.log(`   • ${detail.customer}: ${detail.status} (${detail.daysOverdue} days overdue)`);
            }
        }
        
        console.log('\n✅ Auto suspension test completed!');
        
    } catch (error) {
        console.error('❌ Error testing auto suspension:', error);
        process.exit(1);
    }
}

// Run the test
testAutoSuspension().then(() => {
    console.log('\n🎉 Test completed successfully!');
    process.exit(0);
}).catch((error) => {
    console.error('💥 Test failed:', error);
    process.exit(1);
});
