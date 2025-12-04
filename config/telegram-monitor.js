// telegram-monitor.js - Telegram Bot khusus untuk monitoring
const TelegramBot = require('node-telegram-bot-api');
const { getSetting, setSetting } = require('./settingsManager');
const logger = require('./logger');
const path = require('path');
const fs = require('fs');

class TelegramMonitor {
    constructor() {
        this.bot = null;
        this.chatIds = [];
        this.isConnected = false;
        this.configFile = path.join(__dirname, '../data/telegram-monitor-config.json');
        this.loadConfig();
    }

    // Load configuration from file
    loadConfig() {
        try {
            if (fs.existsSync(this.configFile)) {
                const data = fs.readFileSync(this.configFile, 'utf8');
                const config = JSON.parse(data);
                this.chatIds = config.chatIds || [];
                logger.info(`[TELEGRAM] Loaded ${this.chatIds.length} chat IDs from config`);
            }
        } catch (error) {
            logger.error('[TELEGRAM] Error loading config:', error);
            this.chatIds = [];
        }
    }

    // Save configuration to file
    saveConfig() {
        try {
            const dataDir = path.dirname(this.configFile);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(this.configFile, JSON.stringify({ chatIds: this.chatIds }, null, 2));
            logger.info('[TELEGRAM] Config saved');
        } catch (error) {
            logger.error('[TELEGRAM] Error saving config:', error);
        }
    }

    // Initialize Telegram Bot
    async initialize() {
        try {
            const botToken = getSetting('telegram_bot_token', '');
            if (!botToken) {
                logger.warn('[TELEGRAM] Bot token tidak dikonfigurasi. Telegram monitoring tidak aktif.');
                return { success: false, message: 'Bot token tidak dikonfigurasi' };
            }

            // Create bot instance
            this.bot = new TelegramBot(botToken, { polling: true });

            // Set up command handlers
            this.setupCommands();

            // Handle polling errors
            this.bot.on('polling_error', (error) => {
                logger.error('[TELEGRAM] Polling error:', error);
            });

            // Handle successful connection
            this.bot.on('message', (msg) => {
                // Log incoming messages for debugging
                if (msg.text) {
                    if (msg.text.startsWith('/')) {
                        logger.info(`[TELEGRAM] Received command: ${msg.text} from chat ${msg.chat.id}`);
                    } else {
                        logger.debug(`[TELEGRAM] Received message from ${msg.chat.id}: ${msg.text}`);
                    }
                }
            });
            
            // Handle errors
            this.bot.on('error', (error) => {
                logger.error('[TELEGRAM] Bot error:', error);
            });

            this.isConnected = true;
            logger.info('[TELEGRAM] Bot initialized and connected successfully');
            logger.info(`[TELEGRAM] Total chat terdaftar: ${this.chatIds.length}`);

            // Send welcome message to all registered chats (jika ada)
            if (this.chatIds.length > 0) {
                await this.sendToAllChats('🤖 *Telegram Monitoring Bot Aktif*\n\nBot monitoring telah terhubung dan siap menerima notifikasi monitoring.');
            } else {
                logger.warn('[TELEGRAM] ⚠️ Bot sudah terhubung, tetapi belum ada chat ID yang terdaftar!');
                logger.warn('[TELEGRAM] ⚠️ Silakan kirim perintah /start ke bot untuk mendaftarkan chat ID Anda.');
            }

            return { success: true, message: 'Telegram Bot berhasil diinisialisasi' };
        } catch (error) {
            logger.error('[TELEGRAM] Error initializing bot:', error);
            this.isConnected = false;
            return { success: false, message: `Gagal menginisialisasi bot: ${error.message}` };
        }
    }

    // Setup command handlers
    setupCommands() {
        // Command: /start - Register chat ID
        this.bot.onText(/\/start/, async (msg) => {
            try {
                const chatId = msg.chat.id;
                const username = msg.from.username || msg.from.first_name || 'User';
                const firstName = msg.from.first_name || 'User';

                if (!this.chatIds.includes(chatId)) {
                    this.chatIds.push(chatId);
                    this.saveConfig();
                    const welcomeMsg = `✅ *Chat ID Terdaftar!*\n\n` +
                        `Halo ${firstName}! Chat ID Anda telah terdaftar untuk menerima notifikasi monitoring.\n\n` +
                        `📋 *Info Chat:*\n` +
                        `• Chat ID: \`${chatId}\`\n` +
                        `• Username: @${username || 'N/A'}\n\n` +
                        `🔔 *Fitur Monitoring:*\n` +
                        `• PPPoE Login/Logout\n` +
                        `• RX Power Alerts\n` +
                        `• Connection Monitoring\n\n` +
                        `Gunakan /status untuk melihat status bot.\n` +
                        `Gunakan /help untuk melihat daftar perintah.`;
                    
                    await this.bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
                    logger.info(`[TELEGRAM] ✅ New chat registered: ${chatId} (@${username || firstName})`);
                    logger.info(`[TELEGRAM] Total chat terdaftar sekarang: ${this.chatIds.length}`);
                } else {
                    await this.bot.sendMessage(chatId, `✅ Chat ID Anda sudah terdaftar.\n\nChat ID: \`${chatId}\`\nUsername: @${username || 'N/A'}`, { parse_mode: 'Markdown' });
                    logger.info(`[TELEGRAM] Chat ID ${chatId} sudah terdaftar sebelumnya`);
                }
            } catch (error) {
                logger.error(`[TELEGRAM] Error handling /start command: ${error.message}`);
            }
        });

        // Command: /status - Check bot status
        this.bot.onText(/\/status/, async (msg) => {
            const chatId = msg.chat.id;
            const status = this.getStatus();
            await this.bot.sendMessage(chatId, `📊 *Status Telegram Monitoring Bot*\n\n` +
                `Status: ${status.isConnected ? '✅ Terhubung' : '❌ Tidak Terhubung'}\n` +
                `Total Chat Terdaftar: ${status.totalChats}\n` +
                `Monitoring Aktif: ${status.monitoringEnabled ? '✅' : '❌'}\n\n` +
                `Fitur Monitoring:\n` +
                `• PPPoE Login/Logout: ${status.pppoeMonitoring ? '✅' : '❌'}\n` +
                `• RX Power Alert: ${status.rxPowerMonitoring ? '✅' : '❌'}\n` +
                `• Connection Monitor: ${status.connectionMonitoring ? '✅' : '❌'}`);
        });

        // Command: /unregister - Unregister chat ID
        this.bot.onText(/\/unregister/, async (msg) => {
            const chatId = msg.chat.id;
            const index = this.chatIds.indexOf(chatId);
            if (index > -1) {
                this.chatIds.splice(index, 1);
                this.saveConfig();
                await this.bot.sendMessage(chatId, '❌ Chat ID Anda telah dihapus dari daftar notifikasi.');
                logger.info(`[TELEGRAM] Chat unregistered: ${chatId}`);
            } else {
                await this.bot.sendMessage(chatId, '⚠️ Chat ID Anda tidak terdaftar.');
            }
        });

        // Command: /help - Show help
        this.bot.onText(/\/help/, async (msg) => {
            const chatId = msg.chat.id;
            await this.bot.sendMessage(chatId, `📖 *Bantuan Telegram Monitoring Bot*\n\n` +
                `*Perintah yang tersedia:*\n\n` +
                `/start - Daftarkan chat untuk menerima notifikasi\n` +
                `/status - Cek status bot dan monitoring\n` +
                `/unregister - Hapus chat dari daftar notifikasi\n` +
                `/help - Tampilkan bantuan ini\n\n` +
                `*Fitur Monitoring:*\n` +
                `• PPPoE Login/Logout notifications\n` +
                `• RX Power alerts (Warning & Critical)\n` +
                `• Connection monitoring alerts\n\n` +
                `*Catatan:*\n` +
                `Bot ini khusus untuk monitoring saja. Untuk fitur billing dan lainnya, gunakan WhatsApp Bot.`);
        });
    }

    // Get bot status
    getStatus() {
        const pppoeEnabled = getSetting('pppoe_notifications.enabled', false);
        const rxPowerEnabled = getSetting('rx_power_notification_enable', false);
        const monitoringEnabled = pppoeEnabled || rxPowerEnabled;

        return {
            isConnected: this.isConnected,
            totalChats: this.chatIds.length,
            monitoringEnabled: monitoringEnabled,
            pppoeMonitoring: pppoeEnabled,
            rxPowerMonitoring: rxPowerEnabled,
            connectionMonitoring: true // Always enabled
        };
    }

    // Send message to all registered chats
    async sendToAllChats(message, options = {}) {
        if (!this.isConnected || !this.bot) {
            logger.warn('[TELEGRAM] Bot tidak terhubung, tidak dapat mengirim pesan');
            return { success: false, sent: 0, failed: 0 };
        }

        if (this.chatIds.length === 0) {
            logger.warn('[TELEGRAM] Tidak ada chat ID yang terdaftar. Silakan kirim perintah /start ke bot untuk mendaftarkan chat ID.');
            // Log info untuk debugging
            logger.info('[TELEGRAM] Untuk mendaftarkan chat ID:');
            logger.info('[TELEGRAM] 1. Buka bot di Telegram');
            logger.info('[TELEGRAM] 2. Kirim perintah /start');
            logger.info('[TELEGRAM] 3. Chat ID akan otomatis terdaftar');
            return { success: false, sent: 0, failed: 0, message: 'Tidak ada chat terdaftar' };
        }

        let sent = 0;
        let failed = 0;
        const errors = [];

        for (const chatId of this.chatIds) {
            try {
                await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
                sent++;
                // Small delay to avoid rate limiting
                await this.delay(100);
            } catch (error) {
                failed++;
                errors.push(`${chatId}: ${error.message}`);
                logger.error(`[TELEGRAM] Failed to send to ${chatId}:`, error.message);

                // Remove invalid chat IDs (e.g., user blocked bot)
                if (error.response?.statusCode === 403 || error.response?.statusCode === 400) {
                    const index = this.chatIds.indexOf(chatId);
                    if (index > -1) {
                        this.chatIds.splice(index, 1);
                        this.saveConfig();
                        logger.info(`[TELEGRAM] Removed invalid chat ID: ${chatId}`);
                    }
                }
            }
        }

        return { success: sent > 0, sent, failed, errors };
    }

    // Send PPPoE login notification
    async sendPPPoELogin(loginUsers, connections, offlineUsers) {
        if (!this.isConnected) return { success: false };

        let message = `🔔 *PPPoE LOGIN*\n\n`;
        
        loginUsers.forEach((username, index) => {
            const conn = connections.find(c => c.name === username);
            message += `*${index + 1}. ${username}*\n`;
            if (conn) {
                message += `• Address: ${conn.address || '-'}\n`;
                message += `• Uptime: ${conn.uptime || '-'}\n`;
            }
            message += `\n`;
        });

        if (offlineUsers && offlineUsers.length > 0) {
            message += `🚫 *Pelanggan Offline* (${offlineUsers.length})\n`;
            offlineUsers.slice(0, 10).forEach((user, index) => {
                message += `${index + 1}. ${user}\n`;
            });
            if (offlineUsers.length > 10) {
                message += `... dan ${offlineUsers.length - 10} lainnya\n`;
            }
        }

        return await this.sendToAllChats(message);
    }

    // Send PPPoE logout notification
    async sendPPPoELogout(logoutUsers, offlineUsers) {
        if (!this.isConnected) return { success: false };

        let message = `🔴 *PPPoE LOGOUT*\n\n`;
        
        logoutUsers.forEach((username, index) => {
            message += `${index + 1}. ${username}\n`;
        });

        if (offlineUsers && offlineUsers.length > 0) {
            message += `\n🚫 *Total Pelanggan Offline*: ${offlineUsers.length}\n`;
        }

        return await this.sendToAllChats(message);
    }

    // Send RX Power warning notification
    async sendRXPowerWarning(device, rxPowerValue, threshold) {
        if (!this.isConnected) return { success: false };

        const serialNumber = device?.DeviceID?.SerialNumber || device?._id || 'Unknown';
        const tags = Array.isArray(device?._tags) && device._tags.length > 0 ? device._tags : (device?.Tags || []);
        const phoneNumber = tags.find(tag => /^08\d{8,13}$/.test(tag)) || '-';
        const pppoeUsername = device.VirtualParameters?.pppoeUsername?._value || 
                             device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value || 
                             device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value || '-';

        const message = `⚠️ *RX POWER WARNING*\n\n` +
            `Device: ${serialNumber}\n` +
            `PPPoE: ${pppoeUsername}\n` +
            `Phone: ${phoneNumber}\n` +
            `RX Power: ${rxPowerValue} dBm\n` +
            `Threshold: ${threshold} dBm\n\n` +
            `RX Power mendekati batas kritis. Harap segera cek perangkat.`;

        return await this.sendToAllChats(message);
    }

    // Send RX Power critical notification
    async sendRXPowerCritical(device, rxPowerValue, threshold) {
        if (!this.isConnected) return { success: false };

        const serialNumber = device?.DeviceID?.SerialNumber || device?._id || 'Unknown';
        const tags = Array.isArray(device?._tags) && device._tags.length > 0 ? device._tags : (device?.Tags || []);
        const phoneNumber = tags.find(tag => /^08\d{8,13}$/.test(tag)) || '-';
        const pppoeUsername = device.VirtualParameters?.pppoeUsername?._value || 
                             device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value || 
                             device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value || '-';

        const message = `🚨 *RX POWER CRITICAL ALERT*\n\n` +
            `Device: ${serialNumber}\n` +
            `PPPoE: ${pppoeUsername}\n` +
            `Phone: ${phoneNumber}\n` +
            `RX Power: ${rxPowerValue} dBm\n` +
            `Threshold: ${threshold} dBm\n\n` +
            `⚠️ RX Power sudah melewati batas kritis!\n` +
            `Segera lakukan pengecekan dan perbaikan.`;

        return await this.sendToAllChats(message);
    }

    // Send connection monitoring alert
    async sendConnectionAlert(service, status, message) {
        if (!this.isConnected) return { success: false };

        const emoji = status === 'disconnected' ? '🔴' : status === 'connected' ? '✅' : '⚠️';
        const statusText = status === 'disconnected' ? 'TERPUTUS' : status === 'connected' ? 'TERHUBUNG' : 'PERINGATAN';

        const alertMessage = `${emoji} *${service.toUpperCase()} ${statusText}*\n\n${message}`;

        return await this.sendToAllChats(alertMessage);
    }

    // Utility function for delays
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Stop bot
    stop() {
        if (this.bot) {
            this.bot.stopPolling();
            this.isConnected = false;
            logger.info('[TELEGRAM] Bot stopped');
        }
    }
}

// Export singleton instance
module.exports = new TelegramMonitor();

