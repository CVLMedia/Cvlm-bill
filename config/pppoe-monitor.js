// pppoe-monitor.js - Enhanced PPPoE monitoring with notification control
const logger = require('./logger');
const pppoeNotifications = require('./pppoe-notifications');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

let monitorInterval = null;
let lastActivePPPoE = [];
let isMonitoring = false;

// Start PPPoE monitoring
async function startPPPoEMonitoring() {
    try {
        if (isMonitoring) {
            logger.info('PPPoE monitoring is already running');
            return { success: true, message: 'Monitoring sudah berjalan' };
        }

        const settings = pppoeNotifications.getSettings();
        const interval = settings.monitorInterval || 60000; // Default 1 minute

        // Clear any existing interval
        if (monitorInterval) {
            clearInterval(monitorInterval);
        }

        // Start monitoring
        monitorInterval = setInterval(async () => {
            await checkPPPoEChanges();
        }, interval);

        isMonitoring = true;
        logger.info(`PPPoE monitoring started with interval ${interval}ms`);

        try {
            // Initialize lastActivePPPoE dengan user yang aktif saat ini
            // Ini penting agar logout bisa terdeteksi dengan benar
            const initialConnectionsResult = await pppoeNotifications.getActivePPPoEConnections();
            if (initialConnectionsResult.success && initialConnectionsResult.data) {
                lastActivePPPoE = initialConnectionsResult.data.map(conn => conn.name);
                logger.info(`[PPPOE] Initialized monitoring with ${lastActivePPPoE.length} active users`);
            }
            
            // Run first check (ini akan mendeteksi login/logout dari state awal)
            await checkPPPoEChanges();
        } catch (initialError) {
            logger.error(`Error in initial PPPoE monitoring check: ${initialError.message}`);
        }
        
        return { 
            success: true, 
            message: `PPPoE monitoring dimulai dengan interval ${interval/1000} detik` 
        };
    } catch (error) {
        logger.error(`Error starting PPPoE monitoring: ${error.message}`);
        return { 
            success: false, 
            message: `Gagal memulai monitoring: ${error.message}` 
        };
    }
}

// Stop PPPoE monitoring
function stopPPPoEMonitoring() {
    try {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
        
        isMonitoring = false;
        logger.info('PPPoE monitoring stopped');
        
        return { 
            success: true, 
            message: 'PPPoE monitoring dihentikan' 
        };
    } catch (error) {
        logger.error(`Error stopping PPPoE monitoring: ${error.message}`);
        return { 
            success: false, 
            message: `Gagal menghentikan monitoring: ${error.message}` 
        };
    }
}

// Restart PPPoE monitoring
async function restartPPPoEMonitoring() {
    try {
        stopPPPoEMonitoring();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        return await startPPPoEMonitoring();
    } catch (error) {
        logger.error(`Error restarting PPPoE monitoring: ${error.message}`);
        return { 
            success: false, 
            message: `Gagal restart monitoring: ${error.message}` 
        };
    }
}

// Check for PPPoE login/logout changes
async function checkPPPoEChanges() {
    try {
        const settings = pppoeNotifications.getSettings();
        
        // Skip if notifications are disabled
        if (!settings.enabled) {
            return;
        }

        // Get current active connections
        const connectionsResult = await pppoeNotifications.getActivePPPoEConnections();
        if (!connectionsResult.success) {
            logger.warn(`Failed to get PPPoE connections: ${connectionsResult.message || 'Unknown error'}`);
            return;
        }

        const connections = connectionsResult.data;
        const activeNow = connections.map(conn => conn.name);

        // Detect login/logout events
        const loginUsers = activeNow.filter(user => !lastActivePPPoE.includes(user));
        const logoutUsers = lastActivePPPoE.filter(user => !activeNow.includes(user));
        
        // Log untuk debugging
        if (loginUsers.length > 0 || logoutUsers.length > 0) {
            logger.debug(`[PPPOE] Detection: ${loginUsers.length} login, ${logoutUsers.length} logout. Last active: ${lastActivePPPoE.length}, Current active: ${activeNow.length}`);
        }

        // Handle login notifications
        if (loginUsers.length > 0 && settings.loginNotifications) {
            logger.info(`PPPoE LOGIN detected: ${loginUsers.join(', ')}`);
            
            // Get offline users for the notification
            const offlineUsers = await pppoeNotifications.getOfflinePPPoEUsers(activeNow);
            
            // Format and send login notification (WhatsApp)
            const message = pppoeNotifications.formatLoginMessage(loginUsers, connections, offlineUsers);
            await pppoeNotifications.sendNotification(message);
            
            // Send to Telegram Bot (monitoring only)
            try {
                const telegramMonitor = require('./telegram-monitor');
                const telegramResult = await telegramMonitor.sendPPPoELogin(loginUsers, connections, offlineUsers);
                if (telegramResult && !telegramResult.success) {
                    if (telegramResult.message === 'Tidak ada chat terdaftar') {
                        logger.warn(`[PPPOE] Telegram notification skipped: ${telegramResult.message}. Silakan kirim /start ke bot untuk mendaftarkan chat ID.`);
                    } else {
                        logger.warn(`[PPPOE] Telegram notification failed: ${telegramResult.message || 'Unknown error'}`);
                    }
                } else if (telegramResult && telegramResult.success) {
                    logger.info(`[PPPOE] Telegram notification sent: ${telegramResult.sent} success, ${telegramResult.failed} failed`);
                }
            } catch (telegramError) {
                logger.warn(`[PPPOE] Failed to send Telegram notification: ${telegramError.message}`);
            }
        }

        // Handle logout notifications
        if (logoutUsers.length > 0) {
            logger.info(`[PPPOE] LOGOUT detected: ${logoutUsers.join(', ')} (logoutNotifications: ${settings.logoutNotifications})`);
            
            if (settings.logoutNotifications) {
                // Get offline users for the notification
                const offlineUsers = await pppoeNotifications.getOfflinePPPoEUsers(activeNow);
                
                // Format and send logout notification (WhatsApp)
                const message = pppoeNotifications.formatLogoutMessage(logoutUsers, offlineUsers);
                await pppoeNotifications.sendNotification(message);
                
                // Send to Telegram Bot (monitoring only)
                try {
                    const telegramMonitor = require('./telegram-monitor');
                    const telegramResult = await telegramMonitor.sendPPPoELogout(logoutUsers, offlineUsers);
                    if (telegramResult && !telegramResult.success) {
                        if (telegramResult.message === 'Tidak ada chat terdaftar') {
                            logger.warn(`[PPPOE] Telegram notification skipped: ${telegramResult.message}. Silakan kirim /start ke bot untuk mendaftarkan chat ID.`);
                        } else {
                            logger.warn(`[PPPOE] Telegram notification failed: ${telegramResult.message || 'Unknown error'}`);
                        }
                    } else if (telegramResult && telegramResult.success) {
                        logger.info(`[PPPOE] Telegram notification sent: ${telegramResult.sent} success, ${telegramResult.failed} failed`);
                    }
                } catch (telegramError) {
                    logger.warn(`[PPPOE] Failed to send Telegram notification: ${telegramError.message}`);
                }
            } else {
                logger.debug(`[PPPOE] Logout notifications are disabled, skipping notification for: ${logoutUsers.join(', ')}`);
            }
        }

        // Update last active users
        lastActivePPPoE = activeNow;

        // Log monitoring status
        if (loginUsers.length > 0 || logoutUsers.length > 0) {
            logger.info(`PPPoE monitoring: ${connections.length} active connections, ${loginUsers.length} login, ${logoutUsers.length} logout`);
        }

    } catch (error) {
        logger.error(`Error in PPPoE monitoring check: ${error.message}`);
    }
}

function getConfiguredRouters() {
    return new Promise((resolve) => {
        try {
            const dbPath = path.join(__dirname, '../data/billing.db');
            const db = new sqlite3.Database(dbPath);
            db.all('SELECT id, name, nas_ip, port FROM routers ORDER BY id', (err, rows) => {
                db.close();
                if (err) {
                    logger.error(`[PPPOE] Error loading router configuration: ${err.message}`);
                    resolve([]);
                } else {
                    resolve(rows || []);
                }
            });
        } catch (error) {
            logger.error(`[PPPOE] Error accessing router database: ${error.message}`);
            resolve([]);
        }
    });
}

// Get monitoring status
function getMonitoringStatus() {
    const settings = pppoeNotifications.getSettings();
    const adminNumbers = pppoeNotifications.getAdminNumbers();
    const technicianNumbers = pppoeNotifications.getTechnicianNumbers();
    
    return {
        isRunning: isMonitoring,
        notificationsEnabled: settings.enabled,
        loginNotifications: settings.loginNotifications,
        logoutNotifications: settings.logoutNotifications,
        interval: settings.monitorInterval,
        intervalSeconds: (settings.monitorInterval || 60000) / 1000,
        adminNumbers: adminNumbers,
        technicianNumbers: technicianNumbers,
        activeConnections: lastActivePPPoE.length,
        lastActiveUsers: lastActivePPPoE
    };
}

// Set monitoring interval
async function setMonitoringInterval(intervalMs) {
    try {
        const settings = pppoeNotifications.getSettings();
        settings.monitorInterval = intervalMs;
        
        if (pppoeNotifications.saveSettings(settings)) {
            // Restart monitoring with new interval if it's running
            if (isMonitoring) {
                await restartPPPoEMonitoring();
            }
            
            logger.info(`PPPoE monitoring interval updated to ${intervalMs}ms`);
            return { 
                success: true, 
                message: `Interval monitoring diubah menjadi ${intervalMs/1000} detik` 
            };
        } else {
            return { 
                success: false, 
                message: 'Gagal menyimpan pengaturan interval' 
            };
        }
    } catch (error) {
        logger.error(`Error setting monitoring interval: ${error.message}`);
        return { 
            success: false, 
            message: `Gagal mengubah interval: ${error.message}` 
        };
    }
}

// Initialize monitoring on startup
async function initializePPPoEMonitoring() {
    try {
        const settings = pppoeNotifications.getSettings();
        
        // Auto-start monitoring if enabled
        if (settings.enabled) {
            const routers = await getConfiguredRouters();
            if (!routers.length) {
                logger.warn('[PPPOE] Tidak ditemukan router Mikrotik yang aktif di menu admin/routers. PPPoE monitoring tidak dapat dimulai.');
                return;
            }

            const routerSummary = routers
                .map(router => `${router.name || 'Router'} (${router.nas_ip}${router.port ? `:${router.port}` : ''})`)
                .join(', ');
            logger.info(`[PPPOE] Router yang digunakan untuk monitoring: ${routerSummary}`);

            await startPPPoEMonitoring();
            logger.info('PPPoE monitoring auto-started on initialization');
        } else {
            logger.info('PPPoE monitoring disabled in settings');
        }
    } catch (error) {
        logger.error(`Error initializing PPPoE monitoring: ${error.message}`);
    }
}

// Set WhatsApp socket
function setSock(sockInstance) {
    pppoeNotifications.setSock(sockInstance);
}

module.exports = {
    setSock,
    startPPPoEMonitoring,
    stopPPPoEMonitoring,
    restartPPPoEMonitoring,
    getMonitoringStatus,
    setMonitoringInterval,
    initializePPPoEMonitoring,
    checkPPPoEChanges
};
