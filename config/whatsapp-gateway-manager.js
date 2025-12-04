/**
 * WhatsApp Gateway Manager
 * Mengelola multiple WhatsApp gateway (Baileys & Fonnte)
 * Dengan sistem fallback otomatis
 */

const { getSetting } = require('./settingsManager');
const logger = require('./logger');

// Import gateways
let baileysGateway = null;
let fonnteGateway = null;

// Status gateways
let gatewayStatus = {
    primary: 'baileys', // 'baileys' atau 'fonnte'
    fallback: 'fonnte',
    baileys: {
        available: false,
        lastError: null,
        errorCount: 0
    },
    fonnte: {
        available: false,
        lastError: null,
        errorCount: 0
    }
};

/**
 * Initialize gateway manager
 */
function initialize() {
    try {
        // Load Baileys gateway
        try {
            baileysGateway = require('./whatsapp');
            gatewayStatus.baileys.available = true;
            logger.info('✅ Baileys Gateway loaded');
        } catch (error) {
            logger.warn('⚠️ Baileys Gateway tidak bisa di-load:', error.message);
            gatewayStatus.baileys.available = false;
        }

        // Load Fonnte gateway
        try {
            fonnteGateway = require('./fonnte-gateway');
            // Initialize Fonnte jika API key tersedia
            const fonnteApiKey = getSetting('fonnte_api_key', '');
            if (fonnteApiKey) {
                fonnteGateway.initialize().then(result => {
                    if (result.success) {
                        gatewayStatus.fonnte.available = true;
                        logger.info('✅ Fonnte Gateway initialized');
                    } else {
                        logger.warn('⚠️ Fonnte Gateway tidak bisa di-initialize:', result.error);
                        gatewayStatus.fonnte.available = false;
                    }
                }).catch(err => {
                    logger.error('❌ Error initializing Fonnte Gateway:', err);
                    gatewayStatus.fonnte.available = false;
                });
            } else {
                logger.info('ℹ️ Fonnte API key tidak dikonfigurasi, skip initialization');
            }
        } catch (error) {
            logger.warn('⚠️ Fonnte Gateway tidak bisa di-load:', error.message);
            gatewayStatus.fonnte.available = false;
        }

        // Set primary gateway dari settings
        const primaryGateway = getSetting('whatsapp_primary_gateway', 'baileys');
        if (primaryGateway === 'fonnte' && gatewayStatus.fonnte.available) {
            gatewayStatus.primary = 'fonnte';
            gatewayStatus.fallback = 'baileys';
        } else {
            gatewayStatus.primary = 'baileys';
            gatewayStatus.fallback = 'fonnte';
        }

        logger.info(`📱 WhatsApp Gateway Manager initialized - Primary: ${gatewayStatus.primary}, Fallback: ${gatewayStatus.fallback}`);
    } catch (error) {
        logger.error('❌ Error initializing Gateway Manager:', error);
    }
}

/**
 * Get active gateway (primary dengan fallback)
 */
function getActiveGateway() {
    const primary = gatewayStatus.primary;
    const fallback = gatewayStatus.fallback;

    // Cek primary gateway
    if (primary === 'baileys' && baileysGateway) {
        const baileysStatus = baileysGateway.getWhatsAppStatus ? baileysGateway.getWhatsAppStatus() : null;
        if (baileysStatus && baileysStatus.connected) {
            return { gateway: 'baileys', instance: baileysGateway };
        }
    } else if (primary === 'fonnte' && fonnteGateway && fonnteGateway.isAvailable()) {
        return { gateway: 'fonnte', instance: fonnteGateway };
    }

    // Fallback ke gateway alternatif
    if (fallback === 'fonnte' && fonnteGateway && fonnteGateway.isAvailable()) {
        logger.warn('⚠️ Primary gateway tidak tersedia, menggunakan Fonnte sebagai fallback');
        return { gateway: 'fonnte', instance: fonnteGateway, isFallback: true };
    } else if (fallback === 'baileys' && baileysGateway) {
        const baileysStatus = baileysGateway.getWhatsAppStatus ? baileysGateway.getWhatsAppStatus() : null;
        if (baileysStatus && baileysStatus.connected) {
            logger.warn('⚠️ Primary gateway tidak tersedia, menggunakan Baileys sebagai fallback');
            return { gateway: 'baileys', instance: baileysGateway, isFallback: true };
        }
    }

    return null;
}

/**
 * Send message dengan auto fallback
 */
async function sendMessage(number, message) {
    const activeGateway = getActiveGateway();
    
    if (!activeGateway) {
        logger.error('❌ Tidak ada gateway yang tersedia');
        return { success: false, error: 'Tidak ada WhatsApp gateway yang tersedia' };
    }

    try {
        logger.info(`📱 Mengirim pesan via ${activeGateway.gateway}${activeGateway.isFallback ? ' (fallback)' : ''} ke ${number}`);
        
        let result;
        if (activeGateway.gateway === 'baileys') {
            // Gunakan sendMessage dari sendMessage.js dengan useGatewayManager = false untuk menghindari loop
            const sendMessageModule = require('./sendMessage');
            result = await sendMessageModule.sendMessage(number, message, false);
        } else if (activeGateway.gateway === 'fonnte') {
            result = await activeGateway.instance.sendMessage(number, message);
        } else {
            logger.error(`❌ Unknown gateway: ${activeGateway.gateway}`);
            return { success: false, error: `Unknown gateway: ${activeGateway.gateway}` };
        }

        // Pastikan result memiliki format yang konsisten
        if (!result || typeof result !== 'object') {
            logger.error(`❌ Invalid result format from ${activeGateway.gateway}:`, result);
            result = { success: false, error: 'Invalid response format' };
        }

        // Update error count jika berhasil
        if (result.success) {
            gatewayStatus[activeGateway.gateway].errorCount = 0;
            gatewayStatus[activeGateway.gateway].lastError = null;
            logger.info(`✅ Message sent successfully via ${activeGateway.gateway} to ${number}`);
        } else {
            gatewayStatus[activeGateway.gateway].errorCount++;
            gatewayStatus[activeGateway.gateway].lastError = result.error || 'Unknown error';
            logger.warn(`⚠️ Failed to send message via ${activeGateway.gateway}: ${result.error || 'Unknown error'}`);
            
            // Jika error, coba fallback
            if (activeGateway.gateway === gatewayStatus.primary && !activeGateway.isFallback) {
                logger.warn(`⚠️ Primary gateway (${activeGateway.gateway}) gagal, mencoba fallback...`);
                return await sendMessageWithFallback(number, message, activeGateway.gateway);
            }
        }

        return result;
    } catch (error) {
        logger.error(`❌ Error sending message via ${activeGateway.gateway}:`, error);
        
        // Coba fallback jika primary gateway error
        if (activeGateway.gateway === gatewayStatus.primary && !activeGateway.isFallback) {
            return await sendMessageWithFallback(number, message, activeGateway.gateway);
        }
        
        return { success: false, error: error.message };
    }
}

/**
 * Send message dengan fallback ke gateway lain
 */
async function sendMessageWithFallback(number, message, failedGateway) {
    const fallbackGateway = failedGateway === 'baileys' ? 'fonnte' : 'baileys';
    
    logger.info(`🔄 Mencoba fallback ke ${fallbackGateway}...`);
    
    try {
        let result;
        if (fallbackGateway === 'baileys' && baileysGateway) {
            const sendMessageModule = require('./sendMessage');
            result = await sendMessageModule.sendMessage(number, message);
        } else if (fallbackGateway === 'fonnte' && fonnteGateway && fonnteGateway.isAvailable()) {
            result = await fonnteGateway.sendMessage(number, message);
        } else {
            return { success: false, error: `Fallback gateway (${fallbackGateway}) tidak tersedia` };
        }

        if (result.success) {
            logger.info(`✅ Fallback ke ${fallbackGateway} berhasil`);
        }
        
        return result;
    } catch (error) {
        logger.error(`❌ Fallback ke ${fallbackGateway} juga gagal:`, error);
        return { success: false, error: `Semua gateway gagal: ${error.message}` };
    }
}

/**
 * Send group message
 */
async function sendGroupMessage(groupId, message) {
    const activeGateway = getActiveGateway();
    
    if (!activeGateway) {
        return { success: false, error: 'Tidak ada gateway yang tersedia' };
    }

    try {
        let result;
        if (activeGateway.gateway === 'baileys') {
            const sendMessageModule = require('./sendMessage');
            result = await sendMessageModule.sendMessage(groupId, message);
        } else if (activeGateway.gateway === 'fonnte') {
            result = await activeGateway.instance.sendGroupMessage(groupId, message);
        }

        return result;
    } catch (error) {
        logger.error(`❌ Error sending group message:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Get gateway status
 */
function getGatewayStatus() {
    // Get real-time status from Baileys (always check fresh)
    let baileysStatus = null;
    if (baileysGateway && baileysGateway.getWhatsAppStatus) {
        try {
            baileysStatus = baileysGateway.getWhatsAppStatus();
            // Update gateway status based on real-time check
            if (baileysStatus) {
                gatewayStatus.baileys.available = true;
            }
        } catch (error) {
            logger.warn('Error getting Baileys status:', error.message);
            baileysStatus = null;
        }
    }
    
    // Get real-time status from Fonnte
    let fonnteStatus = null;
    if (fonnteGateway) {
        try {
            fonnteStatus = fonnteGateway.getStatus ? fonnteGateway.getStatus() : null;
            // Update fonnte availability based on actual status
            if (fonnteGateway.isAvailable) {
                gatewayStatus.fonnte.available = fonnteGateway.isAvailable();
            } else if (fonnteStatus) {
                gatewayStatus.fonnte.available = fonnteStatus.connected || false;
            }
        } catch (error) {
            logger.warn('Error getting Fonnte status:', error.message);
            fonnteStatus = null;
        }
    }
    
    // Get active gateway (this also checks real-time status)
    const activeGateway = getActiveGateway();

    return {
        primary: gatewayStatus.primary,
        fallback: gatewayStatus.fallback,
        active: activeGateway ? activeGateway.gateway : null,
        isFallback: activeGateway ? activeGateway.isFallback : false,
        baileys: {
            available: gatewayStatus.baileys.available,
            connected: baileysStatus ? (baileysStatus.connected === true) : false,
            phoneNumber: baileysStatus ? baileysStatus.phoneNumber : null,
            status: baileysStatus ? baileysStatus.status : 'not_loaded',
            errorCount: gatewayStatus.baileys.errorCount,
            lastError: gatewayStatus.baileys.lastError
        },
        fonnte: {
            available: gatewayStatus.fonnte.available,
            connected: fonnteStatus ? (fonnteStatus.connected === true) : false,
            phoneNumber: fonnteStatus ? fonnteStatus.phoneNumber : null,
            status: fonnteStatus ? fonnteStatus.status : 'disconnected',
            errorCount: gatewayStatus.fonnte.errorCount,
            lastError: gatewayStatus.fonnte.lastError
        }
    };
}

/**
 * Switch primary gateway
 */
function switchPrimaryGateway(gateway) {
    if (gateway === 'baileys' || gateway === 'fonnte') {
        const oldPrimary = gatewayStatus.primary;
        gatewayStatus.primary = gateway;
        gatewayStatus.fallback = gateway === 'baileys' ? 'fonnte' : 'baileys';
        logger.info(`🔄 Primary gateway diubah dari ${oldPrimary} ke ${gateway}`);
        return { success: true, message: `Primary gateway diubah ke ${gateway}` };
    }
    return { success: false, error: 'Gateway tidak valid' };
}

// Initialize saat module di-load
initialize();

module.exports = {
    initialize,
    sendMessage,
    sendGroupMessage,
    getActiveGateway,
    getGatewayStatus,
    switchPrimaryGateway,
    baileysGateway: () => baileysGateway,
    fonnteGateway: () => fonnteGateway
};

