#!/usr/bin/env node

/**
 * Script untuk mengecek status Telegram Bot
 * Usage: node scripts/check-telegram-bot-status.js
 */

const path = require('path');
const fs = require('fs');
const { getSetting } = require('../config/settingsManager');

console.log('==========================================');
console.log('  Telegram Bot Status Check');
console.log('  CVL Media Billing System');
console.log('==========================================');
console.log('');

// Check bot token
const botToken = getSetting('telegram_bot_token', '');
if (!botToken) {
    console.log('❌ Telegram Bot Token: NOT CONFIGURED');
    console.log('   Please configure telegram_bot_token in settings.json');
    process.exit(1);
} else {
    console.log('✅ Telegram Bot Token: CONFIGURED');
    console.log(`   Token: ${botToken.substring(0, 10)}...${botToken.substring(botToken.length - 10)}`);
}

// Check monitoring enabled
const monitoringEnabled = getSetting('telegram_monitoring_enabled', true);
console.log(`✅ Monitoring Enabled: ${monitoringEnabled ? 'YES' : 'NO'}`);

// Check config file
const configFile = path.join(__dirname, '../data/telegram-monitor-config.json');
if (fs.existsSync(configFile)) {
    try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        const chatIds = config.chatIds || [];
        console.log(`✅ Chat IDs Registered: ${chatIds.length}`);
        if (chatIds.length > 0) {
            console.log(`   Chat IDs: ${chatIds.join(', ')}`);
        } else {
            console.log('   ⚠️  No chat IDs registered. Send /start to bot to register.');
        }
    } catch (error) {
        console.log('❌ Error reading config file:', error.message);
    }
} else {
    console.log('⚠️  Config file not found (will be created when first chat registers)');
}

// Check bot module
try {
    const telegramMonitor = require('../config/telegram-monitor');
    const status = telegramMonitor.getStatus();
    
    console.log('');
    console.log('==========================================');
    console.log('  Bot Status:');
    console.log('==========================================');
    console.log(`Connected: ${status.isConnected ? '✅ YES' : '❌ NO'}`);
    console.log(`Total Chats: ${status.totalChats}`);
    console.log(`Monitoring Enabled: ${status.monitoringEnabled ? '✅ YES' : '❌ NO'}`);
    console.log(`PPPoE Monitoring: ${status.pppoeMonitoring ? '✅ YES' : '❌ NO'}`);
    console.log(`RX Power Monitoring: ${status.rxPowerMonitoring ? '✅ YES' : '❌ NO'}`);
    console.log(`Connection Monitoring: ${status.connectionMonitoring ? '✅ YES' : '❌ NO'}`);
    
    if (!status.isConnected) {
        console.log('');
        console.log('⚠️  Bot is not connected. Please restart the application.');
    }
    
    if (status.totalChats === 0) {
        console.log('');
        console.log('⚠️  No chat IDs registered. Send /start to bot to register.');
    }
    
} catch (error) {
    console.log('❌ Error checking bot status:', error.message);
    console.log('   Make sure the application is running');
}

console.log('');
console.log('==========================================');

