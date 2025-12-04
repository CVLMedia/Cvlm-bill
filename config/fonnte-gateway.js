/**
 * Fonnte WhatsApp Gateway Integration
 * Gateway alternatif untuk WhatsApp menggunakan Fonnte API
 * Sejajar dengan Baileys untuk fallback
 */

const axios = require('axios');
const { getSetting } = require('./settingsManager');
const logger = require('./logger');

class FonnteGateway {
    constructor() {
        this.apiKey = null;
        this.apiUrl = 'https://api.fonnte.com';
        this.connected = false;
        this.phoneNumber = null;
        this.connectedSince = null;
        this.status = 'disconnected';
    }

    /**
     * Initialize Fonnte Gateway
     */
    async initialize() {
        try {
            this.apiKey = getSetting('fonnte_api_key', '');
            const customUrl = getSetting('fonnte_api_url', '');
            
            if (customUrl) {
                this.apiUrl = customUrl;
            }

            if (!this.apiKey) {
                logger.warn('⚠️ Fonnte API key tidak ditemukan di settings.json');
                return { success: false, error: 'Fonnte API key tidak dikonfigurasi' };
            }

            // Test koneksi dengan get device info
            const testResult = await this.testConnection();
            if (testResult.success) {
                this.connected = true;
                this.status = 'connected';
                this.phoneNumber = testResult.phoneNumber || null;
                this.connectedSince = new Date();
                logger.info('✅ Fonnte Gateway terhubung');
                return { success: true };
            } else {
                logger.error('❌ Fonnte Gateway gagal terhubung:', testResult.error);
                return { success: false, error: testResult.error };
            }
        } catch (error) {
            logger.error('❌ Error initializing Fonnte Gateway:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Test connection to Fonnte API
     * Mencoba beberapa endpoint yang mungkin digunakan Fonnte
     */
    async testConnection() {
        if (!this.apiKey) {
            return { success: false, error: 'API key tidak ditemukan' };
        }

        // Coba beberapa endpoint yang mungkin digunakan Fonnte
        const endpoints = [
            { method: 'GET', url: '/device' },
            { method: 'GET', url: '/status' },
            { method: 'GET', url: '/device-status' },
            { method: 'POST', url: '/device' },
            { method: 'POST', url: '/status' }
        ];

        for (const endpoint of endpoints) {
            try {
                const config = {
                    headers: {
                        'Authorization': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                };

                let response;
                if (endpoint.method === 'GET') {
                    response = await axios.get(`${this.apiUrl}${endpoint.url}`, config);
                } else {
                    response = await axios.post(`${this.apiUrl}${endpoint.url}`, {}, config);
                }

                // Jika berhasil, cek response
                if (response.data) {
                    // Jika status success atau connected
                    if (response.data.status === 'success' || response.data.status === 'connected') {
                        return {
                            success: true,
                            phoneNumber: response.data.phone || response.data.number || response.data.phoneNumber || null,
                            device: response.data
                        };
                    }
                    // Jika ada data meskipun status tidak success, anggap API key valid
                    if (response.status === 200) {
                        return {
                            success: true,
                            phoneNumber: response.data.phone || response.data.number || response.data.phoneNumber || null,
                            device: response.data
                        };
                    }
                }
            } catch (error) {
                // Jika 401, berarti API key invalid
                if (error.response && error.response.status === 401) {
                    return { success: false, error: 'Invalid API key' };
                }
                // Jika 404, coba endpoint berikutnya
                if (error.response && error.response.status === 404) {
                    continue;
                }
                // Jika 405, coba endpoint berikutnya
                if (error.response && error.response.status === 405) {
                    continue;
                }
                // Jika error lain, log dan lanjut ke endpoint berikutnya
                if (error.response) {
                    logger.warn(`Endpoint ${endpoint.method} ${endpoint.url} gagal: ${error.response.status}`);
                    continue;
                }
            }
        }

        // Jika semua endpoint gagal dengan 404/405, test dengan validasi API key sederhana
        // Coba test dengan endpoint yang pasti ada (misalnya dengan format yang berbeda)
        try {
            // Test dengan format header yang berbeda (beberapa API menggunakan format berbeda)
            const testConfigs = [
                { headers: { 'Authorization': `Bearer ${this.apiKey}` } },
                { headers: { 'Authorization': this.apiKey } },
                { headers: { 'X-API-Key': this.apiKey } },
                { headers: { 'api-key': this.apiKey } }
            ];

            for (const testConfig of testConfigs) {
                try {
                    // Coba dengan endpoint yang umum digunakan
                    const response = await axios.get(`${this.apiUrl}/`, {
                        ...testConfig,
                        timeout: 5000
                    });
                    // Jika berhasil, anggap API key valid
                    if (response.status === 200) {
                        return { success: true, phoneNumber: null };
                    }
                } catch (e) {
                    // Jika 401, berarti format header salah atau API key invalid
                    if (e.response && e.response.status === 401) {
                        return { success: false, error: 'Invalid API key atau format header salah' };
                    }
                    // Lanjut ke format berikutnya
                    continue;
                }
            }
        } catch (e) {
            // Ignore
        }

        // Jika semua gagal, tapi tidak ada error 401, anggap API key valid
        // (karena mungkin endpoint test tidak tersedia, tapi API key valid)
        logger.warn('⚠️ Tidak dapat menemukan endpoint test yang valid untuk Fonnte API. Mengasumsikan API key valid.');
        return { 
            success: true, 
            phoneNumber: null,
            warning: 'Endpoint test tidak ditemukan, tetapi API key dianggap valid. Silakan test dengan mengirim pesan.'
        };
    }

    /**
     * Format phone number untuk Fonnte (62xxxxxxxxxx)
     */
    formatPhoneNumber(number) {
        let cleaned = number.replace(/\D/g, '');
        
        // Hapus awalan 0 jika ada
        if (cleaned.startsWith('0')) {
            cleaned = cleaned.substring(1);
        }
        
        // Tambahkan kode negara 62 jika belum ada
        if (!cleaned.startsWith('62')) {
            cleaned = '62' + cleaned;
        }
        
        return cleaned;
    }

    /**
     * Send message via Fonnte API
     */
    async sendMessage(number, message) {
        try {
            if (!this.connected && !this.apiKey) {
                const initResult = await this.initialize();
                if (!initResult.success) {
                    return { success: false, error: 'Fonnte Gateway tidak terhubung' };
                }
            }

            const formattedNumber = this.formatPhoneNumber(number);
            const messageText = typeof message === 'string' ? message : (message.text || JSON.stringify(message));

            // Cek apakah nomor adalah group ID (Fonnte menggunakan format berbeda)
            if (number.includes('@g.us')) {
                // Untuk group, Fonnte menggunakan format berbeda
                const groupId = number.replace('@g.us', '');
                return await this.sendGroupMessage(groupId, messageText);
            }

            // Fonnte API format: POST /send dengan Authorization header
            const response = await axios.post(
                `${this.apiUrl}/send`,
                {
                    target: formattedNumber,
                    message: messageText
                },
                {
                    headers: {
                        'Authorization': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            // Log response untuk debugging
            logger.info(`📱 Fonnte API Response Status: ${response.status}`);
            logger.info(`📱 Fonnte API Response Data:`, JSON.stringify(response.data, null, 2));

            // Cek berbagai format response yang mungkin dari Fonnte API
            // Format 1: { status: 'success', ... }
            // Format 2: { status: true, ... }
            // Format 3: { success: true, ... }
            // Format 4: { status: 'sent', ... }
            // Format 5: { status: 'delivered', ... }
            // Format 6: HTTP 200 dengan data tanpa error field (berarti success)
            // Format 7: HTTP 200 dengan data yang memiliki field id/message_id (berarti success)
            const responseData = response.data || {};
            const responseStr = JSON.stringify(responseData).toLowerCase();
            
            // Cek apakah ada indikator error yang jelas
            const hasError = (
                responseData.error ||
                responseData.status === 'error' ||
                responseData.status === 'failed' ||
                responseData.status === false ||
                responseStr.includes('error') ||
                responseStr.includes('gagal') ||
                responseStr.includes('failed') ||
                responseStr.includes('invalid')
            );
            
            // Cek apakah ada indikator success
            const hasSuccess = (
                responseData.status === 'success' ||
                responseData.status === true ||
                responseData.success === true ||
                responseData.status === 'sent' ||
                responseData.status === 'delivered' ||
                responseData.message_id ||
                responseData.id ||
                responseData.statusCode === 200
            );
            
            // Jika HTTP 200-299, anggap success KECUALI ada error yang jelas
            // Default: jika HTTP 200 dan tidak ada error field yang jelas, anggap success
            const isSuccess = (
                (response.status >= 200 && response.status < 300) && 
                (!hasError && (hasSuccess || response.status === 200))
            );

            if (isSuccess) {
                logger.info(`✅ Fonnte: Pesan berhasil dikirim ke ${formattedNumber}`);
                logger.info(`✅ Fonnte: Response data:`, JSON.stringify(responseData, null, 2));
                return { success: true, message: 'Pesan berhasil dikirim', data: responseData };
            } else {
                const errorMsg = responseData.message || responseData.error || responseData.status || 'Unknown error';
                logger.error(`❌ Fonnte: Gagal mengirim pesan: ${errorMsg}`);
                logger.error(`❌ Fonnte: Full response:`, JSON.stringify(responseData, null, 2));
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            logger.error('❌ Error sending message via Fonnte:', error.message);
            
            // Jika error.response ada, berarti request berhasil tapi API mengembalikan error
            // Jika error.response tidak ada, berarti request gagal (network error, timeout, dll)
            if (error.response) {
                // HTTP error response (4xx, 5xx)
                const statusCode = error.response.status;
                const errorData = error.response.data;
                
                // Beberapa API mengembalikan 200 OK meskipun ada error di body
                // Cek apakah sebenarnya pesan berhasil terkirim
                if (statusCode === 200 && errorData) {
                    // Jika response 200 tapi ada data, mungkin sebenarnya success
                    // Cek apakah ada field yang menunjukkan success
                    if (errorData.status === 'success' || errorData.success === true || errorData.status === 'sent') {
                        logger.info(`✅ Fonnte: Pesan berhasil dikirim (dari error handler) ke ${formattedNumber}`);
                        return { success: true, message: 'Pesan berhasil dikirim', data: errorData };
                    }
                }
                
                const errorMsg = errorData?.message || errorData?.error || error.message || `HTTP ${statusCode}`;
                logger.error(`❌ Fonnte: HTTP ${statusCode} - ${errorMsg}`);
                return { success: false, error: errorMsg };
            } else if (error.request) {
                // Request dibuat tapi tidak ada response (timeout, network error)
                logger.error(`❌ Fonnte: Tidak ada response dari server (timeout/network error)`);
                return { success: false, error: 'Timeout atau network error' };
            } else {
                // Error saat setup request
                logger.error(`❌ Fonnte: Error setup request: ${error.message}`);
                return { success: false, error: error.message || 'Gagal mengirim pesan' };
            }
        }
    }

    /**
     * Send message to group via Fonnte
     */
    async sendGroupMessage(groupId, message) {
        try {
            const formattedGroupId = groupId.replace('@g.us', '');
            
            const response = await axios.post(
                `${this.apiUrl}/send-group`,
                {
                    group_id: formattedGroupId,
                    message: message
                },
                {
                    headers: {
                        'Authorization': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            if (response.data && response.data.status === 'success') {
                logger.info(`✅ Fonnte: Pesan berhasil dikirim ke grup ${formattedGroupId}`);
                return { success: true, message: 'Pesan berhasil dikirim ke grup' };
            } else {
                return { success: false, error: response.data?.message || 'Gagal mengirim pesan ke grup' };
            }
        } catch (error) {
            logger.error('❌ Error sending group message via Fonnte:', error.message);
            return { success: false, error: error.message || 'Gagal mengirim pesan ke grup' };
        }
    }

    /**
     * Send bulk messages
     */
    async sendBulkMessages(numbers, message) {
        const results = [];
        let sent = 0;
        let failed = 0;

        for (const number of numbers) {
            try {
                const result = await this.sendMessage(number, message);
                if (result.success) {
                    sent++;
                } else {
                    failed++;
                }
                results.push({ number, ...result });

                // Delay antar pesan untuk avoid rate limit
                await new Promise(resolve => setTimeout(resolve, getSetting('fonnte_delay', 1000)));
            } catch (error) {
                failed++;
                results.push({ number, success: false, error: error.message });
            }
        }

        return {
            success: sent > 0,
            sent,
            failed,
            results
        };
    }

    /**
     * Get gateway status
     */
    getStatus() {
        return {
            connected: this.connected,
            phoneNumber: this.phoneNumber,
            connectedSince: this.connectedSince,
            status: this.status,
            gateway: 'fonnte'
        };
    }

    /**
     * Check if gateway is available
     */
    isAvailable() {
        return this.connected && this.apiKey !== null;
    }

    /**
     * Reconnect gateway
     */
    async reconnect() {
        this.connected = false;
        this.status = 'connecting';
        return await this.initialize();
    }
}

// Export singleton instance
const fonnteGateway = new FonnteGateway();

module.exports = fonnteGateway;

