// Modul untuk koneksi dan operasi Mikrotik
const { RouterOSAPI } = require('node-routeros');
const logger = require('./logger');
const { getSetting } = require('./settingsManager');
// mysql removed - Full API Mikrotik only
const fs = require('fs');
const path = require('path');
const cacheManager = require('./cacheManager');

let sock = null;
let mikrotikConnection = null;
let monitorInterval = null;

// Fungsi untuk set instance sock
function setSock(sockInstance) {
    sock = sockInstance;
}

// Fungsi untuk koneksi ke Mikrotik
async function connectToMikrotik() {
    try {
        // Dapatkan konfigurasi Mikrotik
        const host = getSetting('mikrotik_host', '192.168.8.1');
        const port = parseInt(getSetting('mikrotik_port', '8728'));
        const user = getSetting('mikrotik_user', 'admin');
        const password = getSetting('mikrotik_password', 'admin');
        
        if (!host || !user || !password) {
            logger.error('Mikrotik configuration is incomplete');
            return null;
        }
        
        // Buat koneksi ke Mikrotik
        const conn = new RouterOSAPI({
            host,
            port,
            user,
            password,
            keepalive: true,
            timeout: 5000 // 5 second timeout
        });
        
        // Connect ke Mikrotik
        await conn.connect();
        logger.info(`Connected to Mikrotik at ${host}:${port}`);
        
        // Set global connection
        mikrotikConnection = conn;
        
        return conn;
    } catch (error) {
        logger.error(`Error connecting to Mikrotik: ${error.message}`);
        return null;
    }
}

// Fungsi untuk mendapatkan koneksi Mikrotik
async function getMikrotikConnection() {
    if (!mikrotikConnection) {
        // PRIORITAS: gunakan NAS (routers) terlebih dahulu
        try {
            const sqlite3 = require('sqlite3').verbose();
            const db = new sqlite3.Database(require('path').join(__dirname, '../data/billing.db'));
            const router = await new Promise((resolve) => {
                db.get('SELECT * FROM routers ORDER BY id LIMIT 1', [], (err, row) => resolve(row || null));
            });
            db.close();
            if (router) {
                const conn = await getMikrotikConnectionForRouter(router);
                mikrotikConnection = conn;
                return conn;
            }
        } catch (e) {
            logger.warn('Connect via routers table failed: ' + e.message);
        }

        // Fallback terakhir: legacy settings.json (untuk kompatibilitas)
        let conn = await connectToMikrotik();
        if (conn) {
            mikrotikConnection = conn;
            return conn;
        }
        return null;
    }
    return mikrotikConnection;
}

// === MULTI-NAS helpers ===
async function getMikrotikConnectionForRouter(routerObj) {
    const { RouterOSAPI } = require('node-routeros');
    if (!routerObj || !routerObj.nas_ip || !routerObj.id) {
        throw new Error('Router data kurang lengkap: id atau nas_ip tidak ditemukan');
    }
    const host = routerObj.nas_ip;
    const port = parseInt(routerObj.port || routerObj.nas_port || 8728);
    const user = routerObj.user || routerObj.nas_user || routerObj.username;
    const password = routerObj.secret || routerObj.password;
    
    if (!host) throw new Error('Koneksi router gagal: IP address (nas_ip) tidak ditemukan');
    if (!user) throw new Error('Koneksi router gagal: Username tidak ditemukan');
    if (!password) throw new Error('Koneksi router gagal: Password tidak ditemukan');
    
    logger.info(`Creating connection to ${host}:${port} with user ${user}`);
    const conn = new RouterOSAPI({ host, port, user, password, keepalive: true, timeout: 10000 });
    
    try {
        await conn.connect();
        logger.info(`✓ Successfully connected to ${host}:${port}`);
        return conn;
    } catch (connectError) {
        logger.error(`✗ Failed to connect to ${host}:${port}:`, connectError.message);
        throw new Error(`Gagal koneksi ke ${host}:${port} - ${connectError.message}`);
    }
}

async function getMikrotikConnectionForCustomer(customer) {
    if (!customer || !customer.id) throw new Error('Customer tidak ditemukan');
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(require('path').join(__dirname, '../data/billing.db'));
    const router = await new Promise((resolve, reject) => {
        db.get('SELECT r.* FROM customer_router_map m JOIN routers r ON r.id = m.router_id WHERE m.customer_id = ? LIMIT 1', [customer.id], (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
    db.close();
    if (!router) throw new Error('Customer belum memilih router/NAS');
    return await getMikrotikConnectionForRouter(router);
}

// Fungsi untuk mendapatkan seluruh user PPPoE dari Mikrotik API (Full API Mikrotik)
async function getPPPoEUsers() {
    const conn = await getMikrotikConnection();
    if (!conn) {
        logger.error('No Mikrotik connection available');
        return [];
    }
    // Ambil semua secret PPPoE
    const pppSecrets = await conn.write('/ppp/secret/print');
    // Ambil semua koneksi aktif
    const activeResult = await getActivePPPoEConnections();
    const activeNames = (activeResult && activeResult.success && Array.isArray(activeResult.data)) ? activeResult.data.map(c => c.name) : [];
    // Gabungkan data
    return pppSecrets.map(secret => ({
        id: secret['.id'],
        name: secret.name,
        password: secret.password,
        profile: secret.profile,
        active: activeNames.includes(secret.name)
    }));
}

// Fungsi untuk edit user PPPoE (berdasarkan id)
async function editPPPoEUser({ id, username, password, profile }) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        await conn.write('/ppp/secret/set', [
            '=.id=' + id,
            '=name=' + username,
            '=password=' + password,
            '=profile=' + profile
        ]);
        return { success: true };
    } catch (error) {
        logger.error(`Error editing PPPoE user: ${error.message}`);
        throw error;
    }
}

// Fungsi untuk hapus user PPPoE (berdasarkan id)
async function deletePPPoEUser(id) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        await conn.write('/ppp/secret/remove', [ '=.id=' + id ]);
        return { success: true };
    } catch (error) {
        logger.error(`Error deleting PPPoE user: ${error.message}`);
        throw error;
    }
}

// Fungsi untuk mendapatkan daftar koneksi PPPoE aktif
async function getActivePPPoEConnections() {
    try {
        // Check cache first
        const cacheKey = 'mikrotik:pppoe:active';
        const cachedData = cacheManager.get(cacheKey);
        
        if (cachedData) {
            logger.debug(`✅ Using cached active PPPoE connections (${cachedData.data.length} connections)`);
            return cachedData;
        }

        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }
        
        logger.debug('🔍 Fetching active PPPoE connections from Mikrotik API...');
        // Dapatkan daftar koneksi PPPoE aktif
        const pppConnections = await conn.write('/ppp/active/print');
        
        const result = {
            success: true,
            message: `Ditemukan ${pppConnections.length} koneksi PPPoE aktif`,
            data: pppConnections
        };
        
        // Cache the response for 1 minute (shorter TTL for real-time data)
        cacheManager.set(cacheKey, result, 1 * 60 * 1000);
        
        logger.debug(`✅ Found ${pppConnections.length} active PPPoE connections from API`);
        return result;
    } catch (error) {
        logger.error(`Error getting active PPPoE connections: ${error.message}`);
        return { success: false, message: `Gagal ambil data PPPoE: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan daftar user PPPoE offline
async function getOfflinePPPoEUsers() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return [];
        }
        
        // Dapatkan semua secret PPPoE
        const pppSecrets = await conn.write('/ppp/secret/print');
        
        // Dapatkan koneksi aktif
        const activeConnections = await getActivePPPoEConnections();
        const activeUsers = activeConnections.map(conn => conn.name);
        
        // Filter user yang offline
        const offlineUsers = pppSecrets.filter(secret => !activeUsers.includes(secret.name));
        
        return offlineUsers;
    } catch (error) {
        logger.error(`Error getting offline PPPoE users: ${error.message}`);
        return [];
    }
}

// Fungsi untuk mendapatkan informasi user PPPoE yang tidak aktif (untuk whatsapp.js)
async function getInactivePPPoEUsers() {
    try {
        // Check cache first
        const cacheKey = 'mikrotik:pppoe:inactive';
        const cachedData = cacheManager.get(cacheKey);
        
        if (cachedData) {
            logger.debug(`✅ Using cached inactive PPPoE users (${cachedData.totalInactive} users)`);
            return cachedData;
        }

        logger.debug('🔍 Fetching inactive PPPoE users from Mikrotik API...');
        
        // Dapatkan semua secret PPPoE
        const pppSecrets = await getMikrotikConnection().then(conn => {
            if (!conn) return [];
            return conn.write('/ppp/secret/print');
        });
        
        // Dapatkan koneksi aktif
        let activeUsers = [];
        const activeConnectionsResult = await getActivePPPoEConnections();
        if (activeConnectionsResult && activeConnectionsResult.success && Array.isArray(activeConnectionsResult.data)) {
            activeUsers = activeConnectionsResult.data.map(conn => conn.name);
        }
        
        // Filter user yang offline
        const inactiveUsers = pppSecrets.filter(secret => !activeUsers.includes(secret.name));
        
        // Format hasil untuk whatsapp.js
        const result = {
            success: true,
            totalSecrets: pppSecrets.length,
            totalActive: activeUsers.length,
            totalInactive: inactiveUsers.length,
            data: inactiveUsers.map(user => ({
                name: user.name,
                comment: user.comment || '',
                profile: user.profile,
                lastLogout: user['last-logged-out'] || 'N/A'
            }))
        };
        
        // Cache the response for 1 minute (shorter TTL for real-time data)
        cacheManager.set(cacheKey, result, 1 * 60 * 1000);
        
        logger.debug(`✅ Found ${inactiveUsers.length} inactive PPPoE users from API`);
        return result;
    } catch (error) {
        logger.error(`Error getting inactive PPPoE users: ${error.message}`);
        return {
            success: false,
            message: error.message,
            totalSecrets: 0,
            totalActive: 0,
            totalInactive: 0,
            data: []
        };
    }
}

// Fungsi untuk mendapatkan resource router
async function getRouterResources(routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return null;
        }

        // Dapatkan resource router
        const resources = await conn.write('/system/resource/print');

        if (!resources || !resources[0]) {
            logger.warn('No resource data returned from Mikrotik');
            return null;
        }

        const resourceData = resources[0];
        
        // Coba ambil temperature dari /system/health/print (jika tersedia)
        let temperatureFromHealth = null;
        try {
            const health = await conn.write('/system/health/print');
            if (health && health.length > 0) {
                const healthData = health[0];
                // Prioritaskan cpu-temperature jika ada (lebih akurat untuk monitoring)
                if (healthData['cpu-temperature'] !== undefined) {
                    temperatureFromHealth = safeNumber(healthData['cpu-temperature']);
                    logger.info(`[TEMP] CPU Temperature from /system/health: ${temperatureFromHealth}°C`);
                } else if (healthData.temperature !== undefined) {
                    temperatureFromHealth = safeNumber(healthData.temperature);
                    logger.info(`[TEMP] Temperature from /system/health: ${temperatureFromHealth}°C`);
                }
                // Log semua temperature-related fields untuk debugging
                Object.keys(healthData).forEach(key => {
                    if (key.toLowerCase().includes('temp')) {
                        logger.debug(`[TEMP] Health field ${key}: ${healthData[key]}`);
                    }
                });
            }
        } catch (e) {
            logger.debug(`[TEMP] /system/health/print not available or error: ${e.message}`);
        }
        
        // Simpan temperature ke resourceData jika ditemukan dari health
        if (temperatureFromHealth !== null) {
            resourceData['temperature'] = temperatureFromHealth;
            resourceData['cpu-temperature'] = temperatureFromHealth;
            logger.info(`[TEMP] Final temperature set: ${temperatureFromHealth}°C (from /system/health)`);
        }
        
        // Debug: Log untuk temperature fields
        const tempRelatedFields = Object.keys(resourceData).filter(key => {
            const keyLower = key.toLowerCase();
            const val = resourceData[key];
            return (keyLower.includes('temp') || keyLower.includes('thermal')) && 
                   val !== undefined && val !== null && val !== '';
        });
        
        if (tempRelatedFields.length > 0) {
            logger.info(`[TEMP] Temperature-related fields found: ${tempRelatedFields.join(', ')}`);
            tempRelatedFields.forEach(field => {
                logger.info(`[TEMP] ${field} = ${resourceData[field]} (type: ${typeof resourceData[field]})`);
            });
        } else {
            logger.warn('[TEMP] No temperature-related fields found in resource data');
            // Log semua field untuk debugging (hanya jika tidak ada temp field) - dengan nilai
            const allFields = Object.keys(resourceData).sort();
            logger.info(`[TEMP] All available fields (${allFields.length}): ${allFields.join(', ')}`);
            // Log beberapa field yang mungkin relevan untuk temperature
            const possibleFields = allFields.filter(f => 
                f.includes('thermal') || 
                f.includes('sensor') ||
                f.includes('board') ||
                f.includes('cpu')
            );
            if (possibleFields.length > 0) {
                logger.info(`[TEMP] Possible related fields: ${possibleFields.join(', ')}`);
                possibleFields.forEach(f => {
                    logger.info(`[TEMP]   ${f} = ${resourceData[f]}`);
                });
            }
        }

        return resourceData;
    } catch (error) {
        logger.error(`Error getting router resources: ${error.message}`);
        return null;
    }
}

function safeNumber(val) {
    if (val === undefined || val === null) return 0;
    const n = Number(val);
    return isNaN(n) ? 0 : n;
}

// Format uptime dari Mikrotik (format: "1w2d3h4m5s" atau seconds)
function formatUptime(uptimeStr) {
    if (!uptimeStr || uptimeStr === 'N/A') return 'N/A';
    
    // Jika sudah berupa string formatted, return langsung
    if (typeof uptimeStr === 'string' && (uptimeStr.includes('w') || uptimeStr.includes('d') || uptimeStr.includes('h'))) {
        return uptimeStr;
    }
    
    // Jika berupa number (seconds), convert ke formatted string
    let seconds = 0;
    if (typeof uptimeStr === 'number') {
        seconds = uptimeStr;
    } else if (typeof uptimeStr === 'string') {
        // Parse format Mikrotik: "1w2d3h4m5s"
        const weeks = (uptimeStr.match(/(\d+)w/) || [0, 0])[1];
        const days = (uptimeStr.match(/(\d+)d/) || [0, 0])[1];
        const hours = (uptimeStr.match(/(\d+)h/) || [0, 0])[1];
        const minutes = (uptimeStr.match(/(\d+)m/) || [0, 0])[1];
        const secs = (uptimeStr.match(/(\d+)s/) || [0, 0])[1];
        seconds = parseInt(weeks || 0) * 604800 + 
                  parseInt(days || 0) * 86400 + 
                  parseInt(hours || 0) * 3600 + 
                  parseInt(minutes || 0) * 60 + 
                  parseInt(secs || 0);
        
        // Jika tidak ada format, coba parse sebagai angka
        if (seconds === 0) {
            seconds = parseInt(uptimeStr) || 0;
        }
    }
    
    if (seconds === 0) return 'N/A';
    
    const weeks = Math.floor(seconds / 604800);
    const days = Math.floor((seconds % 604800) / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    let result = [];
    if (weeks > 0) result.push(`${weeks}w`);
    if (days > 0) result.push(`${days}d`);
    if (hours > 0) result.push(`${hours}h`);
    if (minutes > 0) result.push(`${minutes}m`);
    if (secs > 0 || result.length === 0) result.push(`${secs}s`);
    
    return result.join('');
}

// Helper function untuk parsing memory dengan berbagai format
function parseMemoryValue(value) {
    if (!value) return 0;

    // Jika sudah berupa number, return langsung
    if (typeof value === 'number') return value;

    // Jika berupa string yang berisi angka
    if (typeof value === 'string') {
        // Coba parse sebagai integer dulu (untuk format bytes dari MikroTik)
        const intValue = parseInt(value);
        if (!isNaN(intValue)) return intValue;

        // Jika gagal, coba parse dengan unit
        const str = value.toString().toLowerCase();
        const numericPart = parseFloat(str.replace(/[^0-9.]/g, ''));
        if (isNaN(numericPart)) return 0;

        // Check for units
        if (str.includes('kib') || str.includes('kb')) {
            return numericPart * 1024;
        } else if (str.includes('mib') || str.includes('mb')) {
            return numericPart * 1024 * 1024;
        } else if (str.includes('gib') || str.includes('gb')) {
            return numericPart * 1024 * 1024 * 1024;
        } else {
            // Assume bytes if no unit
            return numericPart;
        }
    }

    return 0;
}

// Fungsi untuk mendapatkan informasi resource yang diformat
        // Fungsi untuk mendapatkan resource info per router
async function getResourceInfoForRouter(routerObj = null) {
    let routerboard = null; // Deklarasi di awal fungsi untuk akses global
    try {
        const resources = await getRouterResources(routerObj);
        if (!resources) {
            return { success: false, message: 'Resource router tidak ditemukan', data: null };
        }
        
        // Debug: Log semua field yang tersedia dari Mikrotik (hanya sekali per router)
        if (routerObj && routerObj.id) {
            logger.info(`[TEMP DEBUG] Router ${routerObj.name} (${routerObj.nas_ip}) - All resource fields:`, Object.keys(resources).sort());
            // Log semua nilai yang mungkin terkait temperature
            Object.keys(resources).forEach(key => {
                const val = resources[key];
                if (typeof val !== 'undefined' && val !== null && String(val).toLowerCase().includes('temp')) {
                    logger.info(`[TEMP DEBUG] Potential temp field: ${key} = ${val}`);
                }
            });
        }

        // Get connection untuk mengambil data tambahan (identity, routerboard, interfaces)
        // Buat koneksi sekali dan gunakan untuk semua operasi
        let conn = null;
        try {
            if (routerObj) {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } else {
                conn = await getMikrotikConnection();
            }
        } catch (e) {
            logger.error(`Error getting connection for router ${routerObj ? routerObj.name : 'default'}: ${e.message}`);
        }
        
        // Jika tidak ada koneksi, return error
        if (!conn) {
            logger.error(`No connection available for router ${routerObj ? routerObj.name : 'default'}`);
            return { success: false, message: 'Tidak dapat membuat koneksi ke router', data: null };
        }
        
        // Get all interfaces traffic for total network in/out
        let totalRx = 0, totalTx = 0;
        let interfacesData = [];
        try {
            const interfaces = await conn.write('/interface/print');
            if (Array.isArray(interfaces)) {
                for (const iface of interfaces) {
                    if (iface.name && !iface.name.startsWith('<')) {
                        try {
                            // Get traffic rate (bits per second)
                            const monitor = await conn.write('/interface/monitor-traffic', [
                                `=interface=${iface.name}`,
                                '=once='
                            ]);
                            
                            if (monitor && monitor.length > 0) {
                                const m = monitor[0];
                                // rx-bits-per-second dan tx-bits-per-second sudah dalam bits per second
                                // Langsung convert ke Mbps (1 Mbps = 1,000,000 bits per second)
                                const rxBits = parseInt(m['rx-bits-per-second'] || 0);
                                const txBits = parseInt(m['tx-bits-per-second'] || 0);
                                // Konversi langsung dari bits/s ke Mbps
                                totalRx += rxBits; // Total dalam bits per second
                                totalTx += txBits; // Total dalam bits per second
                                
                                // Get cumulative bytes from interface
                                const rxByte = parseInt(iface['rx-byte'] || 0);
                                const txByte = parseInt(iface['tx-byte'] || 0);
                                
                                // Convert bits to bytes per second for interface data
                                const rxBytesPerSec = rxBits / 8;
                                const txBytesPerSec = txBits / 8;
                                
                                interfacesData.push({
                                    name: iface.name,
                                    rxBytesPerSec: rxBytesPerSec,
                                    txBytesPerSec: txBytesPerSec,
                                    rxBytesTotal: rxByte,
                                    txBytesTotal: txByte
                                });
                            }
                        } catch (e) {
                            // Skip interface yang error, tapi tetap ambil cumulative bytes jika ada
                            const rxByte = parseInt(iface['rx-byte'] || 0);
                            const txByte = parseInt(iface['tx-byte'] || 0);
                            if (rxByte > 0 || txByte > 0) {
                                interfacesData.push({
                                    name: iface.name,
                                    rxBytesPerSec: 0,
                                    txBytesPerSec: 0,
                                    rxBytesTotal: rxByte,
                                    txBytesTotal: txByte
                                });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            logger.warn('Error getting interfaces traffic:', e.message);
        }

        // Parse memory berdasarkan field yang tersedia di debug
        const totalMem = parseMemoryValue(resources['total-memory']) || 0;
        const freeMem = parseMemoryValue(resources['free-memory']) || 0;
        const usedMem = totalMem > 0 && freeMem >= 0 ? totalMem - freeMem : 0;

        // Parse disk space berdasarkan field yang tersedia di debug
        const totalDisk = parseMemoryValue(resources['total-hdd-space']) || 0;
        const freeDisk = parseMemoryValue(resources['free-hdd-space']) || 0;
        const usedDisk = totalDisk > 0 && freeDisk >= 0 ? totalDisk - freeDisk : 0;

        // Parse CPU load (bisa dalam format percentage atau decimal)
        let cpuLoad = safeNumber(resources['cpu-load']);
        if (cpuLoad > 0 && cpuLoad <= 1) {
            cpuLoad = cpuLoad * 100; // Convert dari decimal ke percentage
        }

        // Parse temperature - ambil dari resourceData (sudah di-set dari health jika ada)
        let temperature = null;
        if (resources['temperature'] !== undefined && resources['temperature'] !== null) {
            const tempVal = safeNumber(resources['temperature']);
            if (tempVal > 0 && tempVal < 150) {
                temperature = tempVal;
            }
        } else if (resources['cpu-temperature'] !== undefined && resources['cpu-temperature'] !== null) {
            const tempVal = safeNumber(resources['cpu-temperature']);
            if (tempVal > 0 && tempVal < 150) {
                temperature = tempVal;
            }
        }
        
        // Ambil informasi tambahan: Identity, Routerboard, CPU, Version, Voltage
        let routerIdentity = null;
        let routerboardInfo = null;
        let voltage = null;
        
        if (conn) {
            try {
                // Ambil identity dari /system/identity/print
                const identityResult = await conn.write('/system/identity/print');
                if (identityResult && identityResult.length > 0 && identityResult[0].name) {
                    routerIdentity = identityResult[0].name;
                    logger.info(`[INFO] Router identity retrieved: ${routerIdentity} for router ${routerObj ? routerObj.name : 'default'}`);
                } else {
                    logger.warn(`[INFO] No identity found for router ${routerObj ? routerObj.name : 'default'}`);
                }
            } catch (e) {
                logger.error(`[INFO] /system/identity/print error for router ${routerObj ? routerObj.name : 'default'}: ${e.message}`);
            }
            
            // Ambil routerboard info
            try {
                const rb = await conn.write('/system/routerboard/print');
                if (rb && rb.length > 0) {
                    routerboardInfo = rb[0];
                    if (routerboardInfo['voltage'] !== undefined) {
                        voltage = safeNumber(routerboardInfo['voltage']);
                    }
                }
            } catch (e) {
                logger.debug(`[INFO] /system/routerboard/print error: ${e.message}`);
            }
        } else {
            logger.warn(`[INFO] No connection available for router ${routerObj ? routerObj.name : 'default'} to fetch identity and routerboard info`);
        }
        
        // Simpan informasi tambahan ke resources
        if (routerIdentity) {
            resources['identity'] = routerIdentity;
        }
        if (routerboardInfo) {
            if (routerboardInfo['board-name']) {
                resources['board-name'] = routerboardInfo['board-name'];
            }
            if (routerboardInfo['model']) {
                resources['model'] = routerboardInfo['model'];
            }
        }
        if (voltage !== null) {
            resources['voltage'] = voltage;
        }

        const data = {
            // System info
            routerId: routerObj ? routerObj.id : null,
            routerName: routerObj ? routerObj.name : 'Default Router',
            routerIp: routerObj ? routerObj.nas_ip : null,
            
            // CPU
            cpuLoad: Math.round(cpuLoad),
            cpuCount: safeNumber(resources['cpu-count']),
            cpuFrequency: safeNumber(resources['cpu-frequency']),
            
            // Memory
            memoryUsedMB: totalMem > 0 ? parseFloat((usedMem / 1024 / 1024).toFixed(2)) : 0,
            memoryFreeMB: totalMem > 0 ? parseFloat((freeMem / 1024 / 1024).toFixed(2)) : 0,
            totalMemoryMB: totalMem > 0 ? parseFloat((totalMem / 1024 / 1024).toFixed(2)) : 0,
            memoryUsedPercent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
            
            // HDD
            diskUsedMB: totalDisk > 0 ? parseFloat((usedDisk / 1024 / 1024).toFixed(2)) : 0,
            diskFreeMB: totalDisk > 0 ? parseFloat((freeDisk / 1024 / 1024).toFixed(2)) : 0,
            totalDiskMB: totalDisk > 0 ? parseFloat((totalDisk / 1024 / 1024).toFixed(2)) : 0,
            diskUsedPercent: totalDisk > 0 ? Math.round((usedDisk / totalDisk) * 100) : 0,
            
            // Temperature
            temperature: temperature, // Sudah di-set dari /system/health atau resource
            
            // Network (aggregated from all interfaces)
            // totalRx dan totalTx sudah dalam bits per second, convert ke Mbps (divide by 1,000,000)
            totalNetworkInMbps: parseFloat((totalRx / 1000000).toFixed(2)),
            totalNetworkOutMbps: parseFloat((totalTx / 1000000).toFixed(2)),
            
            // Interfaces with Rx Bytes Total
            interfaces: interfacesData.sort((a, b) => b.rxBytesTotal - a.rxBytesTotal).slice(0, 10), // Top 10
            
            // Other info
            uptime: resources.uptime || 'N/A',
            uptimeFormatted: formatUptime(resources.uptime),
            version: resources.version || 'N/A',
            model: resources['model'] || resources['board-name'] || 'N/A',
            boardName: resources['board-name'] || 'N/A',
            platform: resources['platform'] || 'N/A',
            // Additional system info
            identity: resources['identity'] || routerIdentity || 'N/A', // Fallback ke routerIdentity jika belum di-set ke resources
            cpu: resources['cpu'] || resources['architecture-name'] || 'N/A',
            voltage: resources['voltage'] !== undefined && resources['voltage'] !== null ? safeNumber(resources['voltage']) : null
        };

        return {
            success: true,
            message: 'Berhasil mengambil info resource router',
            data
        };
    } catch (error) {
        logger.error(`Error getting resource info for router: ${error.message}`);
        return { success: false, message: `Gagal ambil resource router: ${error.message}`, data: null };
    }
}

async function getResourceInfo() {
    // Ambil traffic interface utama (default ether1)
    const interfaceName = getSetting('main_interface', 'ether1');
    let traffic = { rx: 0, tx: 0 };
    try {
        traffic = await getInterfaceTraffic(interfaceName);
    } catch (e) { traffic = { rx: 0, tx: 0 }; }

    try {
        const resources = await getRouterResources();
        if (!resources) {
            return { success: false, message: 'Resource router tidak ditemukan', data: null };
        }

        // Debug: Log raw resource data (bisa dinonaktifkan nanti)
        // logger.info('Raw MikroTik resource data:', JSON.stringify(resources, null, 2));

        // Parse memory berdasarkan field yang tersedia di debug
        // Berdasarkan debug: free-memory: 944705536, total-memory: 1073741824 (dalam bytes)
        const totalMem = parseMemoryValue(resources['total-memory']) || 0;
        const freeMem = parseMemoryValue(resources['free-memory']) || 0;
        const usedMem = totalMem > 0 && freeMem >= 0 ? totalMem - freeMem : 0;

        // Parse disk space berdasarkan field yang tersedia di debug
        // Berdasarkan debug: free-hdd-space: 438689792, total-hdd-space: 537133056 (dalam bytes)
        const totalDisk = parseMemoryValue(resources['total-hdd-space']) || 0;
        const freeDisk = parseMemoryValue(resources['free-hdd-space']) || 0;
        const usedDisk = totalDisk > 0 && freeDisk >= 0 ? totalDisk - freeDisk : 0;

        // Parse CPU load (bisa dalam format percentage atau decimal)
        let cpuLoad = safeNumber(resources['cpu-load']);
        if (cpuLoad > 0 && cpuLoad <= 1) {
            cpuLoad = cpuLoad * 100; // Convert dari decimal ke percentage
        }

        const data = {
            trafficRX: traffic && traffic.rx ? (traffic.rx / 1000000).toFixed(2) : '0.00',
            trafficTX: traffic && traffic.tx ? (traffic.tx / 1000000).toFixed(2) : '0.00',
            cpuLoad: Math.round(cpuLoad),
            cpuCount: safeNumber(resources['cpu-count']),
            cpuFrequency: safeNumber(resources['cpu-frequency']),
            architecture: resources['architecture-name'] || resources['cpu'] || 'N/A',
            model: resources['model'] || resources['board-name'] || 'N/A',
            serialNumber: resources['serial-number'] || 'N/A',
            firmware: resources['firmware-type'] || resources['version'] || 'N/A',
            voltage: resources['voltage'] || resources['board-voltage'] || 'N/A',
            temperature: resources['temperature'] || resources['board-temperature'] || 'N/A',
            badBlocks: resources['bad-blocks'] || 'N/A',
            // Konversi dari bytes ke MB dengan 2 decimal places
            memoryUsed: totalMem > 0 ? parseFloat((usedMem / 1024 / 1024).toFixed(2)) : 0,
            memoryFree: totalMem > 0 ? parseFloat((freeMem / 1024 / 1024).toFixed(2)) : 0,
            totalMemory: totalMem > 0 ? parseFloat((totalMem / 1024 / 1024).toFixed(2)) : 0,
            diskUsed: totalDisk > 0 ? parseFloat((usedDisk / 1024 / 1024).toFixed(2)) : 0,
            diskFree: totalDisk > 0 ? parseFloat((freeDisk / 1024 / 1024).toFixed(2)) : 0,
            totalDisk: totalDisk > 0 ? parseFloat((totalDisk / 1024 / 1024).toFixed(2)) : 0,
            uptime: resources.uptime || 'N/A',
            version: resources.version || 'N/A',
            boardName: resources['board-name'] || 'N/A',
            platform: resources['platform'] || 'N/A',
            // Debug info (bisa dihapus nanti)
            rawTotalMem: resources['total-memory'],
            rawFreeMem: resources['free-memory'],
            rawTotalDisk: resources['total-hdd-space'],
            rawFreeDisk: resources['free-hdd-space'],
            parsedTotalMem: totalMem,
            parsedFreeMem: freeMem,
            parsedTotalDisk: totalDisk,
            parsedFreeDisk: freeDisk
        };

        // Log parsed data for debugging (bisa dinonaktifkan nanti)
        // logger.info('Parsed memory data:', {
        //     totalMem: totalMem,
        //     freeMem: freeMem,
        //     usedMem: usedMem,
        //     totalMemMB: data.totalMemory,
        //     freeMemMB: data.memoryFree,
        //     usedMemMB: data.memoryUsed
        // });

        return {
            success: true,
            message: 'Berhasil mengambil info resource router',
            data
        };
    } catch (error) {
        logger.error(`Error getting formatted resource info: ${error.message}`);
        return { success: false, message: `Gagal ambil resource router: ${error.message}`, data: null };
    }
}

// Fungsi untuk mendapatkan daftar user hotspot aktif dari Mikrotik API (Full API Mikrotik)
async function getActiveHotspotUsers(routerObj = null) {
    let conn = null;
    if (routerObj) {
        conn = await getMikrotikConnectionForRouter(routerObj);
    } else {
        conn = await getMikrotikConnection();
    }
    if (!conn) {
        logger.error('No Mikrotik connection available');
        return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
    }
    // Dapatkan daftar user hotspot aktif
    const hotspotUsers = await conn.write('/ip/hotspot/active/print');
    logger.info(`Found ${hotspotUsers.length} active hotspot users`);
    
    return {
        success: true,
        message: `Ditemukan ${hotspotUsers.length} user hotspot aktif`,
        data: hotspotUsers
    };
}

// Fungsi untuk menambahkan user hotspot (Full API Mikrotik)
async function addHotspotUser(username, password, profile, comment = null, customer = null, routerObj = null, validity = null, uptime = null, server = null) {
    let conn = null;
    if (customer) {
      conn = await getMikrotikConnectionForCustomer(customer);
    } else if (routerObj) {
      // Prioritas: gunakan routerObj dari database routers
      conn = await getMikrotikConnectionForRouter(routerObj);
    } else {
      // Fallback: hanya jika tidak ada routerObj dan customer
      // Tapi sebaiknya selalu gunakan routerObj dari database
      throw new Error('Router/NAS harus dipilih dari database. Koneksi tidak bisa menggunakan settings.json');
    }
    if (!conn) {
      throw new Error('Koneksi ke router gagal: Tidak dapat terhubung ke Mikrotik');
    }
    
    // Prepare parameters
    const params = [
        '=name=' + username,
        '=password=' + password,
        '=profile=' + profile
    ];
    
    // Buat comment yang berisi informasi uptime limit untuk monitoring
    // Format: "voucher|uptime:10m" (jika ada uptime) atau "voucher" (jika tidak ada)
    let finalComment = comment || 'voucher';
    if (uptime && uptime.trim() !== '') {
        // Simpan uptime limit di comment dengan format: "voucher|uptime:10m"
        finalComment = finalComment + '|uptime:' + uptime.trim();
    }
    if (finalComment) {
        params.push('=comment=' + finalComment);
    }
    
    // Tambahkan server hotspot jika dipilih (tidak 'all')
    if (server && server.trim() !== '' && server !== 'all') {
        params.push('=server=' + server.trim());
    }
    // Tambahkan limit-uptime (Masa Aktif/Validity) jika ada
    if (validity && validity.trim() !== '') {
        params.push('=limit-uptime=' + validity.trim());
    }
    // Catatan: limit-uptime-total tidak didukung oleh Mikrotik API untuk hotspot user
    // Parameter uptime disimpan di comment dengan format: "voucher|uptime:10m"
    // Monitoring akan membaca dari comment dan memutus koneksi otomatis saat uptime habis
    
    try {
        await conn.write('/ip/hotspot/user/add', params);
        return { success: true, message: 'User hotspot berhasil ditambahkan' };
    } catch (error) {
        logger.error(`Error adding hotspot user ${username}: ${error.message}`);
        throw new Error(`Gagal menambahkan user hotspot: ${error.message}`);
    }
}

// Fungsi untuk menghapus user hotspot
async function deleteHotspotUser(username, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        // Cari user hotspot
        const users = await conn.write('/ip/hotspot/user/print', [
            '?name=' + username
        ]);
        if (users.length === 0) {
            return { success: false, message: 'User hotspot tidak ditemukan' };
        }
        // Hapus user hotspot
        await conn.write('/ip/hotspot/user/remove', [
            '=.id=' + users[0]['.id']
        ]);
        return { success: true, message: 'User hotspot berhasil dihapus' };
    } catch (error) {
        logger.error(`Error deleting hotspot user: ${error.message}`);
        return { success: false, message: `Gagal menghapus user hotspot: ${error.message}` };
    }
}

// Fungsi untuk menambahkan secret PPPoE
async function addPPPoESecret(username, password, profile, localAddress = '', conn, comment = '') {
    try {
        logger.info(`[MIKROTIK] addPPPoESecret called: username=${username}, profile=${profile}, comment=${comment}`);
        
        if (!conn) {
            // Backward compatibility: fallback to global connection if no explicit conn provided
            logger.info(`[MIKROTIK] No connection provided, getting default connection...`);
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('[MIKROTIK] ❌ No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        logger.info(`[MIKROTIK] ✅ Connection obtained, preparing to add PPPoE secret...`);
        
        // Parameter untuk menambahkan secret
        const params = [
            '=name=' + username,
            '=password=' + password,
            '=profile=' + profile,
            '=service=pppoe'
        ];
        if (localAddress) {
            params.push('=local-address=' + localAddress);
        }
        // Tambahkan comment (nama customer) jika ada
        if (comment && String(comment).trim()) {
            params.push('=comment=' + String(comment).trim());
        }
        
        logger.info(`[MIKROTIK] Sending command: /ppp/secret/add with params:`, params);
        
        // Tambahkan secret PPPoE
        const result = await conn.write('/ppp/secret/add', params);
        
        logger.info(`[MIKROTIK] ✅ PPPoE secret added successfully: ${username}`);
        logger.info(`[MIKROTIK] RouterOS response:`, JSON.stringify(result, null, 2));
        
        return { success: true, message: 'Secret PPPoE berhasil ditambahkan', data: result };
    } catch (error) {
        logger.error(`[MIKROTIK] ❌ Error adding PPPoE secret ${username}: ${error.message}`);
        logger.error(`[MIKROTIK] Error stack:`, error.stack);
        return { success: false, message: `Gagal menambah secret PPPoE: ${error.message}`, error: error.message };
    }
}

// Fungsi untuk menghapus secret PPPoE
async function deletePPPoESecret(username) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        // Cari secret PPPoE
        const secrets = await conn.write('/ppp/secret/print', [
            '?name=' + username
        ]);
        if (secrets.length === 0) {
            return { success: false, message: 'Secret PPPoE tidak ditemukan' };
        }
        // Hapus secret PPPoE
        await conn.write('/ppp/secret/remove', [
            '=.id=' + secrets[0]['.id']
        ]);
        return { success: true, message: 'Secret PPPoE berhasil dihapus' };
    } catch (error) {
        logger.error(`Error deleting PPPoE secret: ${error.message}`);
        return { success: false, message: `Gagal menghapus secret PPPoE: ${error.message}` };
    }
}

// Fungsi untuk mengubah profile PPPoE
async function setPPPoEProfile(username, profile) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        // Cari secret PPPoE
        const secrets = await conn.write('/ppp/secret/print', [
            '?name=' + username
        ]);
        if (secrets.length === 0) {
            return { success: false, message: 'Secret PPPoE tidak ditemukan' };
        }
        // Ubah profile PPPoE
        await conn.write('/ppp/secret/set', [
            '=.id=' + secrets[0]['.id'],
            '=profile=' + profile
        ]);

        // Tambahan: Kick user dari sesi aktif PPPoE
        // Cari sesi aktif
        const activeSessions = await conn.write('/ppp/active/print', [
            '?name=' + username
        ]);
        if (activeSessions.length > 0) {
            // Hapus semua sesi aktif user ini
            for (const session of activeSessions) {
                await conn.write('/ppp/active/remove', [
                    '=.id=' + session['.id']
                ]);
            }
            logger.info(`User ${username} di-kick dari sesi aktif PPPoE setelah ganti profile`);
        }

        return { success: true, message: 'Profile PPPoE berhasil diubah dan user di-kick dari sesi aktif' };
    } catch (error) {
        logger.error(`Error setting PPPoE profile: ${error.message}`);
        return { success: false, message: `Gagal mengubah profile PPPoE: ${error.message}` };
    }
}

// Fungsi untuk monitoring koneksi PPPoE
let lastActivePPPoE = [];
async function monitorPPPoEConnections() {
    try {
        // Cek ENV untuk enable/disable monitoring
        const monitorEnableRaw = getSetting('pppoe_monitor_enable', true);
        const monitorEnable = typeof monitorEnableRaw === 'string'
            ? monitorEnableRaw.toLowerCase() === 'true'
            : Boolean(monitorEnableRaw);
        if (!monitorEnable) {
            logger.info('PPPoE monitoring is DISABLED by ENV');
            return;
        }
        // Dapatkan interval monitoring dari konfigurasi dalam menit, konversi ke milidetik
        const intervalMinutes = parseFloat(getSetting('pppoe_monitor_interval_minutes', '1'));
        const interval = intervalMinutes * 60 * 1000; // Convert minutes to milliseconds
        
        console.log(`📋 Starting PPPoE monitoring (interval: ${intervalMinutes} menit / ${interval/1000}s)`);
        
        // Bersihkan interval sebelumnya jika ada
        if (monitorInterval) {
            clearInterval(monitorInterval);
        }
        
        // Set interval untuk monitoring
        monitorInterval = setInterval(async () => {
            try {
                // Dapatkan koneksi PPPoE aktif
                const connections = await getActivePPPoEConnections();
                if (!connections.success) {
                    logger.warn(`Monitoring PPPoE connections failed: ${connections.message}`);
                    return;
                }
                const activeNow = connections.data.map(u => u.name);
                // Deteksi login/logout
                const loginUsers = activeNow.filter(u => !lastActivePPPoE.includes(u));
                const logoutUsers = lastActivePPPoE.filter(u => !activeNow.includes(u));
                if (loginUsers.length > 0) {
                    // Ambil detail user login
                    const loginDetail = connections.data.filter(u => loginUsers.includes(u.name));
                    // Ambil daftar user offline
                    let offlineList = [];
                    try {
                        const conn = await getMikrotikConnection();
                        const pppSecrets = await conn.write('/ppp/secret/print');
                        offlineList = pppSecrets.filter(secret => !activeNow.includes(secret.name)).map(u => u.name);
                    } catch (e) {}
                    // Format pesan WhatsApp
                    let msg = `🔔 *PPPoE LOGIN*\n\n`;
                    loginDetail.forEach((u, i) => {
                        msg += `*${i+1}. ${u.name}*\n• Address: ${u.address || '-'}\n• Uptime: ${u.uptime || '-'}\n\n`;
                    });
                    msg += `🚫 *Pelanggan Offline* (${offlineList.length})\n`;
                    offlineList.forEach((u, i) => {
                        msg += `${i+1}. ${u}\n`;
                    });
                    // Kirim ke group WhatsApp
                    const technicianGroupId = getSetting('technician_group_id', '');
                    if (sock && technicianGroupId) {
                        try {
                            await sock.sendMessage(technicianGroupId, { text: msg });
                            logger.info(`PPPoE login notification sent to group: ${technicianGroupId}`);
                        } catch (e) {
                            logger.error('Gagal kirim notifikasi PPPoE ke WhatsApp group:', e);
                        }
                    } else {
                        logger.warn('No technician group configured for PPPoE notifications');
                    }
                    logger.info('PPPoE LOGIN:', loginUsers);
                }
                if (logoutUsers.length > 0) {
                    // Ambil detail user logout dari lastActivePPPoE (karena sudah tidak ada di connections.data)
                    let logoutDetail = logoutUsers.map(name => ({ name }));
                    // Ambil daftar user offline terbaru
                    let offlineList = [];
                    try {
                        const conn = await getMikrotikConnection();
                        const pppSecrets = await conn.write('/ppp/secret/print');
                        offlineList = pppSecrets.filter(secret => !activeNow.includes(secret.name)).map(u => u.name);
                    } catch (e) {}
                    // Format pesan WhatsApp
                    let msg = `🚪 *PPPoE LOGOUT*\n\n`;
                    logoutDetail.forEach((u, i) => {
                        msg += `*${i+1}. ${u.name}*\n\n`;
                    });
                    msg += `🚫 *Pelanggan Offline* (${offlineList.length})\n`;
                    offlineList.forEach((u, i) => {
                        msg += `${i+1}. ${u}\n`;
                    });
                    // Kirim ke group WhatsApp
                    const technicianGroupId = getSetting('technician_group_id', '');
                    if (sock && technicianGroupId) {
                        try {
                            await sock.sendMessage(technicianGroupId, { text: msg });
                            logger.info(`PPPoE logout notification sent to group: ${technicianGroupId}`);
                        } catch (e) {
                            logger.error('Gagal kirim notifikasi PPPoE LOGOUT ke WhatsApp group:', e);
                        }
                    } else {
                        logger.warn('No technician group configured for PPPoE notifications');
                    }
                    logger.info('PPPoE LOGOUT:', logoutUsers);
                }
                lastActivePPPoE = activeNow;
                logger.info(`Monitoring PPPoE connections: ${connections.data.length} active connections`);
            } catch (error) {
                logger.error(`Error in PPPoE monitoring: ${error.message}`);
            }
        }, interval);
        
        logger.info(`PPPoE monitoring started with interval ${interval}ms`);
    } catch (error) {
        logger.error(`Error starting PPPoE monitoring: ${error.message}`);
    }
}

// Fungsi untuk mendapatkan traffic interface
async function getInterfaceTraffic(interfaceName = 'ether1') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) return { rx: 0, tx: 0 };
        const res = await conn.write('/interface/monitor-traffic', [
            `=interface=${interfaceName}`,
            '=once='
        ]);
        if (!res || !res[0]) return { rx: 0, tx: 0 };
        // RX/TX dalam bps
        return {
            rx: res[0]['rx-bits-per-second'] || 0,
            tx: res[0]['tx-bits-per-second'] || 0
        };
    } catch (error) {
        logger.error('Error getting interface traffic:', error.message, error);
        return { rx: 0, tx: 0 };
    }
}

// Fungsi untuk mendapatkan daftar interface
async function getInterfaces() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const interfaces = await conn.write('/interface/print');
        return {
            success: true,
            message: `Ditemukan ${interfaces.length} interface`,
            data: interfaces
        };
    } catch (error) {
        logger.error(`Error getting interfaces: ${error.message}`);
        return { success: false, message: `Gagal ambil data interface: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan detail interface tertentu
async function getInterfaceDetail(interfaceName) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const interfaces = await conn.write('/interface/print', [
            `?name=${interfaceName}`
        ]);

        if (interfaces.length === 0) {
            return { success: false, message: 'Interface tidak ditemukan', data: null };
        }

        return {
            success: true,
            message: `Detail interface ${interfaceName}`,
            data: interfaces[0]
        };
    } catch (error) {
        logger.error(`Error getting interface detail: ${error.message}`);
        return { success: false, message: `Gagal ambil detail interface: ${error.message}`, data: null };
    }
}

// Fungsi untuk enable/disable interface
async function setInterfaceStatus(interfaceName, enabled) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        // Cari interface
        const interfaces = await conn.write('/interface/print', [
            `?name=${interfaceName}`
        ]);

        if (interfaces.length === 0) {
            return { success: false, message: 'Interface tidak ditemukan' };
        }

        // Set status interface
        const action = enabled ? 'enable' : 'disable';
        await conn.write(`/interface/${action}`, [
            `=.id=${interfaces[0]['.id']}`
        ]);

        return {
            success: true,
            message: `Interface ${interfaceName} berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}`
        };
    } catch (error) {
        logger.error(`Error setting interface status: ${error.message}`);
        return { success: false, message: `Gagal mengubah status interface: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan daftar IP address
async function getIPAddresses() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const addresses = await conn.write('/ip/address/print');
        return {
            success: true,
            message: `Ditemukan ${addresses.length} IP address`,
            data: addresses
        };
    } catch (error) {
        logger.error(`Error getting IP addresses: ${error.message}`);
        return { success: false, message: `Gagal ambil data IP address: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan daftar IP Pool dari MikroTik
async function getIPPools(routerObj = null) {
    let conn = null;
    try {
        if (routerObj) {
            logger.info(`Connecting to router for IP pools: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
            try {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } catch (connError) {
                logger.error(`Connection failed to ${routerObj.name}:`, connError.message);
                return { success: false, message: `Koneksi gagal ke ${routerObj.name}: ${connError.message}`, data: [] };
            }
        } else {
            logger.info('Using default Mikrotik connection for IP pools');
            conn = await getMikrotikConnection();
        }
        
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        logger.info('Fetching IP pools from Mikrotik...');
        const pools = await conn.write('/ip/pool/print');
        logger.info(`Successfully retrieved ${pools ? pools.length : 0} IP pools from ${routerObj ? routerObj.name : 'default'}`);
        
        // Format pools data
        const formattedPools = (pools || []).map(pool => ({
            id: pool['.id'],
            name: pool.name || '',
            ranges: pool.ranges || '',
            next_pool: pool['next-pool'] || '',
            nas_id: routerObj ? routerObj.id : null,
            nas_name: routerObj ? routerObj.name : null,
            nas_ip: routerObj ? routerObj.nas_ip : null
        }));
        
        return {
            success: true,
            message: `Ditemukan ${formattedPools.length} IP pool`,
            data: formattedPools
        };
    } catch (error) {
        logger.error(`Error getting IP pools from ${routerObj ? routerObj.name : 'default'}: ${error.message}`);
        return { success: false, message: `Gagal ambil data IP pool: ${error.message}`, data: [] };
    }
}

// Fungsi untuk menambah IP address
async function addIPAddress(interfaceName, address) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        await conn.write('/ip/address/add', [
            `=interface=${interfaceName}`,
            `=address=${address}`
        ]);

        return { success: true, message: `IP address ${address} berhasil ditambahkan ke ${interfaceName}` };
    } catch (error) {
        logger.error(`Error adding IP address: ${error.message}`);
        return { success: false, message: `Gagal menambah IP address: ${error.message}` };
    }
}

// Fungsi untuk menghapus IP address
async function deleteIPAddress(interfaceName, address) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        // Cari IP address
        const addresses = await conn.write('/ip/address/print', [
            `?interface=${interfaceName}`,
            `?address=${address}`
        ]);

        if (addresses.length === 0) {
            return { success: false, message: 'IP address tidak ditemukan' };
        }

        // Hapus IP address
        await conn.write('/ip/address/remove', [
            `=.id=${addresses[0]['.id']}`
        ]);

        return { success: true, message: `IP address ${address} berhasil dihapus dari ${interfaceName}` };
    } catch (error) {
        logger.error(`Error deleting IP address: ${error.message}`);
        return { success: false, message: `Gagal menghapus IP address: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan routing table
async function getRoutes() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const routes = await conn.write('/ip/route/print');
        return {
            success: true,
            message: `Ditemukan ${routes.length} route`,
            data: routes
        };
    } catch (error) {
        logger.error(`Error getting routes: ${error.message}`);
        return { success: false, message: `Gagal ambil data route: ${error.message}`, data: [] };
    }
}

// Fungsi untuk menambah route
async function addRoute(destination, gateway, distance = '1') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        await conn.write('/ip/route/add', [
            `=dst-address=${destination}`,
            `=gateway=${gateway}`,
            `=distance=${distance}`
        ]);

        return { success: true, message: `Route ${destination} via ${gateway} berhasil ditambahkan` };
    } catch (error) {
        logger.error(`Error adding route: ${error.message}`);
        return { success: false, message: `Gagal menambah route: ${error.message}` };
    }
}

// Fungsi untuk menghapus route
async function deleteRoute(destination) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        // Cari route
        const routes = await conn.write('/ip/route/print', [
            `?dst-address=${destination}`
        ]);

        if (routes.length === 0) {
            return { success: false, message: 'Route tidak ditemukan' };
        }

        // Hapus route
        await conn.write('/ip/route/remove', [
            `=.id=${routes[0]['.id']}`
        ]);

        return { success: true, message: `Route ${destination} berhasil dihapus` };
    } catch (error) {
        logger.error(`Error deleting route: ${error.message}`);
        return { success: false, message: `Gagal menghapus route: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan DHCP leases
async function getDHCPLeases() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const leases = await conn.write('/ip/dhcp-server/lease/print');
        return {
            success: true,
            message: `Ditemukan ${leases.length} DHCP lease`,
            data: leases
        };
    } catch (error) {
        logger.error(`Error getting DHCP leases: ${error.message}`);
        return { success: false, message: `Gagal ambil data DHCP lease: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan DHCP server
async function getDHCPServers() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const servers = await conn.write('/ip/dhcp-server/print');
        return {
            success: true,
            message: `Ditemukan ${servers.length} DHCP server`,
            data: servers
        };
    } catch (error) {
        logger.error(`Error getting DHCP servers: ${error.message}`);
        return { success: false, message: `Gagal ambil data DHCP server: ${error.message}`, data: [] };
    }
}

// Fungsi untuk ping
async function pingHost(host, count = '4') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const result = await conn.write('/ping', [
            `=address=${host}`,
            `=count=${count}`
        ]);

        return {
            success: true,
            message: `Ping ke ${host} selesai`,
            data: result
        };
    } catch (error) {
        logger.error(`Error pinging host: ${error.message}`);
        return { success: false, message: `Gagal ping ke ${host}: ${error.message}`, data: null };
    }
}

// Fungsi untuk mendapatkan system logs
async function getSystemLogs(topics = '', count = '50') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const params = [];
        if (topics) {
            params.push(`?topics~${topics}`);
        }

        const logs = await conn.write('/log/print', params);

        // Batasi jumlah log yang dikembalikan
        const limitedLogs = logs.slice(0, parseInt(count));

        return {
            success: true,
            message: `Ditemukan ${limitedLogs.length} log entries`,
            data: limitedLogs
        };
    } catch (error) {
        logger.error(`Error getting system logs: ${error.message}`);
        return { success: false, message: `Gagal ambil system logs: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan daftar profile PPPoE
async function getPPPoEProfiles(routerObj = null) {
    let conn = null;
    try {
        if (routerObj) {
            logger.info(`Connecting to router for PPPoE profiles: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
            try {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } catch (connError) {
                logger.error(`Connection failed to ${routerObj.name}:`, connError.message);
                return { success: false, message: `Koneksi gagal ke ${routerObj.name}: ${connError.message}`, data: [] };
            }
        } else {
            logger.info('Using default Mikrotik connection for PPPoE profiles');
            conn = await getMikrotikConnection();
        }
        
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        logger.info('Fetching PPPoE profiles from Mikrotik...');
        const profiles = await conn.write('/ppp/profile/print');
        logger.info(`Successfully retrieved ${profiles ? profiles.length : 0} PPPoE profiles from ${routerObj ? routerObj.name : 'default'}`);
        
        // Attach router info to profiles if routerObj is provided
        if (Array.isArray(profiles) && routerObj) {
            profiles.forEach(prof => {
                if (prof) {
                    prof.nas_id = routerObj.id;
                    prof.nas_name = routerObj.name;
                    prof.nas_ip = routerObj.nas_ip;
                }
            });
        }
        
        return {
            success: true,
            message: `Ditemukan ${profiles ? profiles.length : 0} PPPoE profile`,
            data: profiles || []
        };
    } catch (error) {
        logger.error(`Error getting PPPoE profiles from ${routerObj ? routerObj.name : 'default'}: ${error.message}`);
        return { success: false, message: `Gagal ambil data PPPoE profile: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan detail profile PPPoE
async function getPPPoEProfileDetail(id) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const profiles = await conn.write('/ppp/profile/print', [`?.id=${id}`]);
        if (profiles.length === 0) {
            return { success: false, message: 'Profile tidak ditemukan', data: null };
        }

        return {
            success: true,
            message: 'Detail profile berhasil diambil',
            data: profiles[0]
        };
    } catch (error) {
        logger.error(`Error getting PPPoE profile detail: ${error.message}`);
        return { success: false, message: `Gagal ambil detail profile: ${error.message}`, data: null };
    }
}

// Fungsi untuk mendapatkan daftar profile hotspot
async function getHotspotProfiles(routerObj = null) {
    let conn = null;
    try {
        if (routerObj) {
            logger.info(`Connecting to router: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
            try {
                conn = await getMikrotikConnectionForRouter(routerObj);
            } catch (connError) {
                logger.error(`Connection failed to ${routerObj.name}:`, connError.message);
                return { success: false, message: `Koneksi gagal ke ${routerObj.name}: ${connError.message}`, data: [] };
            }
        } else {
            logger.info('Using default Mikrotik connection');
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal: Tidak dapat membuat koneksi', data: [] };
        }
        
        logger.info('Fetching hotspot profiles from Mikrotik...');
        const profiles = await conn.write('/ip/hotspot/user/profile/print');
        logger.info(`Successfully retrieved ${profiles ? profiles.length : 0} profiles from ${routerObj ? routerObj.name : 'default'}`);
        
        // Parse and validate profiles, attach router info if provided
        const validProfiles = [];
        if (Array.isArray(profiles)) {
            profiles.forEach((prof, idx) => {
                if (prof && (prof.name || prof['name'])) {
                    // Attach router info to profile for tracking
                    if (routerObj) {
                        prof.nas_id = routerObj.id;
                        prof.nas_name = routerObj.name;
                        prof.nas_ip = routerObj.nas_ip;
                    }
                    validProfiles.push(prof);
                    logger.debug(`  Profile ${idx + 1}: ${prof.name || prof['name']} (Rate: ${prof['rate-limit'] || 'none'}, Session: ${prof['session-timeout'] || 'none'}, Idle: ${prof['idle-timeout'] || 'none'})`);
                }
            });
        }
        logger.info(`Valid profiles after parsing: ${validProfiles.length}`);
        
        // Don't close connection here - let it be managed by connection pool or caller
        // Connection will be reused or closed automatically
        
        return {
            success: true,
            message: `Ditemukan ${validProfiles.length} profile hotspot`,
            data: validProfiles
        };
    } catch (error) {
        logger.error(`Error getting hotspot profiles from ${routerObj ? routerObj.name : 'default'}:`, error.message);
        logger.error('Error stack:', error.stack);
        
        // Don't close connection on error - might be reused
        // Connection will be managed by connection pool
        
        return { success: false, message: `Gagal ambil data profile hotspot: ${error.message}`, data: [] };
    }
}

// Fungsi untuk mendapatkan detail profile hotspot
async function getHotspotProfileDetail(id, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }
        
        const result = await conn.write('/ip/hotspot/user/profile/print', [
            '?.id=' + id
        ]);
        
        if (result && result.length > 0) {
            return { success: true, data: result[0] };
        } else {
            return { success: false, message: 'Profile tidak ditemukan', data: null };
        }
    } catch (error) {
        logger.error(`Error getting hotspot profile detail: ${error.message}`);
        return { success: false, message: error.message, data: null };
    }
}

// Fungsi untuk mendapatkan daftar server hotspot
async function getHotspotServers(routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }
        
        const result = await conn.write('/ip/hotspot/print');
        
        if (result && Array.isArray(result)) {
            const servers = result.map(server => ({
                id: server['.id'],
                name: server.name,
                interface: server.interface,
                profile: server.profile,
                address: server['address-pool'] || '',
                disabled: server.disabled === 'true',
                nas_id: routerObj ? routerObj.id : null,
                nas_name: routerObj ? routerObj.name : null,
                nas_ip: routerObj ? routerObj.nas_ip : null
            }));
            return { success: true, data: servers };
        } else {
            return { success: false, message: 'Gagal mendapatkan server hotspot', data: [] };
        }
    } catch (error) {
        logger.error(`Error getting hotspot servers: ${error.message}`);
        return { success: false, message: error.message, data: [] };
    }
}

// Fungsi untuk memutus koneksi user hotspot aktif
async function disconnectHotspotUser(username, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        
        // Cari ID koneksi aktif berdasarkan username
        const activeUsers = await conn.write('/ip/hotspot/active/print', [
            '?user=' + username
        ]);
        
        if (!activeUsers || activeUsers.length === 0) {
            return { success: false, message: `User ${username} tidak ditemukan atau tidak aktif` };
        }
        
        // Putus koneksi user dengan ID yang ditemukan
        await conn.write('/ip/hotspot/active/remove', [
            '=.id=' + activeUsers[0]['.id']
        ]);
        
        logger.info(`Disconnected hotspot user: ${username}`);
        return { success: true, message: `User ${username} berhasil diputus` };
    } catch (error) {
        logger.error(`Error disconnecting hotspot user: ${error.message}`);
        return { success: false, message: error.message };
    }
}

// Fungsi untuk menonaktifkan (disable) user hotspot agar tidak bisa login lagi
async function disableHotspotUser(username, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        
        // Cari user hotspot
        const users = await conn.write('/ip/hotspot/user/print', [
            '?name=' + username
        ]);
        
        if (!users || users.length === 0) {
            return { success: false, message: `User ${username} tidak ditemukan` };
        }
        
        // Disable user hotspot
        await conn.write('/ip/hotspot/user/set', [
            '=.id=' + users[0]['.id'],
            '=disabled=yes'
        ]);
        
        logger.info(`Disabled hotspot user: ${username}`);
        return { success: true, message: `User ${username} berhasil dinonaktifkan` };
    } catch (error) {
        logger.error(`Error disabling hotspot user: ${error.message}`);
        return { success: false, message: error.message };
    }
}

// Fungsi untuk menambah profile hotspot
async function addHotspotProfile(profileData, routerObj = null) {
    // Pastikan routerObj ada - koneksi harus dari database routers
    if (!routerObj) {
        logger.error('Router object tidak ditemukan. Koneksi harus dari database routers.');
        return { success: false, message: 'Router/NAS harus dipilih dari database' };
    }
    
    let conn = null;
    try {
        logger.info(`Connecting to router for add profile: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
        try {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } catch (connError) {
            logger.error(`Connection failed to ${routerObj.name}:`, connError.message);
            return { success: false, message: `Koneksi gagal ke router ${routerObj.name}: ${connError.message}` };
        }
        
        if (!conn) {
            logger.error(`Tidak dapat terhubung ke Mikrotik ${routerObj.name}`);
            return { 
                success: false, 
                message: `Tidak dapat terhubung ke Mikrotik ${routerObj.name} (${routerObj.nas_ip})` 
            };
        }
        
        // Extract only valid fields, exclude router_id and id
        const {
            name,
            comment,
            rateLimit,
            rateLimitUnit,
            sessionTimeout,
            sessionTimeoutUnit,
            idleTimeout,
            idleTimeoutUnit,
            localAddress,
            remoteAddress,
            dnsServer,
            parentQueue,
            addressList,
            sharedUsers
        } = profileData;
        
        if (!name || !name.trim()) {
            return { success: false, message: 'Nama profile harus diisi' };
        }
        
        // Build parameters array - ONLY include core parameters that are definitely supported
        // Skip all optional parameters that might cause "unknown parameter" error
        const params = [];
        
        // Name is required
        if (!name || !String(name).trim()) {
            return { success: false, message: 'Nama profile harus diisi' };
        }
        params.push('=name=' + String(name).trim());
        
        // Comment - safe parameter
        if (comment !== undefined && comment !== null && String(comment).trim() !== '') {
            params.push('=comment=' + String(comment).trim());
        }
        
        // Rate limit: only add if both value and unit are valid
        // Format Mikrotik: upload/download (e.g., "10M/10M") or just upload if same
        if (rateLimit && rateLimitUnit && String(rateLimit).trim() !== '' && String(rateLimitUnit).trim() !== '') {
            const rateLimitValue = String(rateLimit).trim();
            let rateLimitUnitValue = String(rateLimitUnit).trim().toLowerCase();
            if (['k', 'm', 'g'].includes(rateLimitUnitValue)) {
                if (rateLimitUnitValue === 'm') rateLimitUnitValue = 'M';
                if (rateLimitUnitValue === 'g') rateLimitUnitValue = 'G';
                if (rateLimitUnitValue === 'k') rateLimitUnitValue = 'K';
                const numValue = parseInt(rateLimitValue);
                if (!isNaN(numValue) && numValue > 0) {
                    // Format: upload/download (same value for both)
                    const rateLimitFormatted = numValue + rateLimitUnitValue + '/' + numValue + rateLimitUnitValue;
                    params.push('=rate-limit=' + rateLimitFormatted);
                    logger.info(`Rate limit formatted: ${rateLimitFormatted}`);
                }
            }
        }
        
        // Session timeout: only add if both value and unit are valid
        // Validasi: nilai harus > 0, jika 0 atau kosong, jangan kirim parameter
        if (sessionTimeout !== undefined && sessionTimeout !== null && sessionTimeout !== '' && 
            sessionTimeoutUnit !== undefined && sessionTimeoutUnit !== null && sessionTimeoutUnit !== '') {
            const sessionTimeoutValue = String(sessionTimeout).trim();
            let sessionTimeoutUnitValue = String(sessionTimeoutUnit).trim().toLowerCase();
            const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
            if (timeoutUnitMap[sessionTimeoutUnitValue]) {
                sessionTimeoutUnitValue = timeoutUnitMap[sessionTimeoutUnitValue];
                const numValue = parseInt(sessionTimeoutValue);
                // Hanya kirim jika nilai > 0 (nilai 0 tidak valid untuk session-timeout)
                if (!isNaN(numValue) && numValue > 0) {
                    params.push('=session-timeout=' + numValue + sessionTimeoutUnitValue);
                }
                // Jika nilai 0, abaikan parameter (tidak kirim) untuk menghindari error
            }
        }
        
        // Idle timeout: only add if both value and unit are valid
        // Validasi: nilai harus > 0, jika 0 atau kosong, jangan kirim parameter
        if (idleTimeout !== undefined && idleTimeout !== null && idleTimeout !== '' && 
            idleTimeoutUnit !== undefined && idleTimeoutUnit !== null && idleTimeoutUnit !== '') {
            const idleTimeoutValue = String(idleTimeout).trim();
            let idleTimeoutUnitValue = String(idleTimeoutUnit).trim().toLowerCase();
            const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
            if (timeoutUnitMap[idleTimeoutUnitValue]) {
                idleTimeoutUnitValue = timeoutUnitMap[idleTimeoutUnitValue];
                const numValue = parseInt(idleTimeoutValue);
                // Hanya kirim jika nilai > 0 (nilai 0 tidak valid untuk idle-timeout)
                if (!isNaN(numValue) && numValue > 0) {
                    params.push('=idle-timeout=' + numValue + idleTimeoutUnitValue);
                }
                // Jika nilai 0, abaikan parameter (tidak kirim) untuk menghindari error
            }
        }
        
        // SKIP: local-address, remote-address, dns-server, parent-queue, address-list
        // These parameters may not be supported or cause "unknown parameter" error
        
        // Shared users: valid field - only if value is valid positive integer
        if (sharedUsers !== undefined && sharedUsers !== null && String(sharedUsers).trim() !== '' && String(sharedUsers).trim() !== '0') {
            const sharedUsersValue = parseInt(String(sharedUsers).trim());
            if (!isNaN(sharedUsersValue) && sharedUsersValue > 0) {
                params.push('=shared-users=' + sharedUsersValue);
            }
        }
        
        // Log parameters for debugging
        logger.info('=== Adding Hotspot Profile ===');
        logger.info('Name:', name);
        logger.info('Router:', routerObj ? `${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})` : 'default');
        logger.info('Total params:', params.length);
        logger.info('Raw params:', JSON.stringify(params));
        params.forEach((p, idx) => {
            logger.info(`  Param ${idx + 1}: ${p}`);
        });
        
        try {
            await conn.write('/ip/hotspot/user/profile/add', params);
            logger.info('✓ Successfully added hotspot profile:', name);
            return { success: true, message: 'Profile hotspot berhasil ditambahkan' };
        } catch (apiError) {
            // Try to identify which parameter is causing the issue
            logger.error('✗ Mikrotik API Error:', apiError.message);
            logger.error('Error stack:', apiError.stack);
            logger.error('Parameters that were sent:', JSON.stringify(params));
            
            // If error mentions "unknown parameter", try with minimal parameters (name only first)
            if (apiError.message && apiError.message.toLowerCase().includes('unknown parameter')) {
                logger.warn('=== Unknown parameter error, trying minimal approach ===');
                
                // Try with name only first
                try {
                    logger.info('Attempt 1: Name only');
                    const nameOnlyParams = ['=name=' + String(name).trim()];
                    await conn.write('/ip/hotspot/user/profile/add', nameOnlyParams);
                    logger.info('✓ Success with name only, now updating with other params');
                    
                    // Get the profile ID we just created
                    const profiles = await conn.write('/ip/hotspot/user/profile/print', ['?name=' + String(name).trim()]);
                    if (!profiles || profiles.length === 0) {
                        throw new Error('Profile created but not found');
                    }
                    const profileId = profiles[0]['.id'];
                    
                    // Now update with other parameters ONE BY ONE to avoid "unknown parameter" error
                    logger.info('Updating profile parameters one by one...');
                    
                    // Update comment
                    if (comment && comment.trim()) {
                        try {
                            await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=comment=' + String(comment).trim()]);
                            logger.info(`✓ Comment updated: ${comment}`);
                        } catch (e) {
                            logger.warn(`✗ Failed to update comment: ${e.message}`);
                        }
                    }
                    
                    // Update rate-limit
                    if (rateLimit && rateLimitUnit && String(rateLimit).trim() !== '' && String(rateLimitUnit).trim() !== '') {
                        const rateLimitValue = String(rateLimit).trim();
                        let rateLimitUnitValue = String(rateLimitUnit).trim().toLowerCase();
                        if (['k', 'm', 'g', 'K', 'M', 'G'].includes(rateLimitUnitValue)) {
                            if (rateLimitUnitValue === 'm' || rateLimitUnitValue === 'M') rateLimitUnitValue = 'M';
                            else if (rateLimitUnitValue === 'g' || rateLimitUnitValue === 'G') rateLimitUnitValue = 'G';
                            else if (rateLimitUnitValue === 'k' || rateLimitUnitValue === 'K') rateLimitUnitValue = 'K';
                            const numValue = parseInt(rateLimitValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                // Format: upload/download (same value for both)
                                const rateLimitFormatted = numValue + rateLimitUnitValue + '/' + numValue + rateLimitUnitValue;
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=rate-limit=' + rateLimitFormatted]);
                                    logger.info(`✓ Rate limit updated: ${rateLimitFormatted}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update rate limit: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update session-timeout
                    if (sessionTimeout && sessionTimeoutUnit && String(sessionTimeout).trim() !== '' && String(sessionTimeoutUnit).trim() !== '') {
                        const sessionTimeoutValue = String(sessionTimeout).trim();
                        let sessionTimeoutUnitValue = String(sessionTimeoutUnit).trim().toLowerCase();
                        const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
                        if (timeoutUnitMap[sessionTimeoutUnitValue]) {
                            sessionTimeoutUnitValue = timeoutUnitMap[sessionTimeoutUnitValue];
                            const numValue = parseInt(sessionTimeoutValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=session-timeout=' + numValue + sessionTimeoutUnitValue]);
                                    logger.info(`✓ Session timeout updated: ${numValue}${sessionTimeoutUnitValue}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update session timeout: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update idle-timeout
                    if (idleTimeout && idleTimeoutUnit && String(idleTimeout).trim() !== '' && String(idleTimeoutUnit).trim() !== '') {
                        const idleTimeoutValue = String(idleTimeout).trim();
                        let idleTimeoutUnitValue = String(idleTimeoutUnit).trim().toLowerCase();
                        const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
                        if (timeoutUnitMap[idleTimeoutUnitValue]) {
                            idleTimeoutUnitValue = timeoutUnitMap[idleTimeoutUnitValue];
                            const numValue = parseInt(idleTimeoutValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=idle-timeout=' + numValue + idleTimeoutUnitValue]);
                                    logger.info(`✓ Idle timeout updated: ${numValue}${idleTimeoutUnitValue}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update idle timeout: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update shared-users
                    if (sharedUsers !== undefined && sharedUsers !== null && String(sharedUsers).trim() !== '' && String(sharedUsers).trim() !== '0') {
                        const sharedUsersValue = parseInt(String(sharedUsers).trim());
                        if (!isNaN(sharedUsersValue) && sharedUsersValue > 0) {
                            try {
                                await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + profileId, '=shared-users=' + sharedUsersValue]);
                                logger.info(`✓ Shared users updated: ${sharedUsersValue}`);
                            } catch (e) {
                                logger.warn(`✗ Failed to update shared users: ${e.message}`);
                            }
                        }
                    }
                    
                    logger.info('✓ Successfully added and updated profile');
                    
                    // Close connection if created for this request
                    if (routerObj && conn && typeof conn.close === 'function') {
                        try {
                            await conn.close();
                        } catch (closeError) {
                            logger.warn('Error closing connection:', closeError.message);
                        }
                    }
                    
                    return { success: true, message: 'Profile hotspot berhasil ditambahkan' };
                } catch (fallbackError) {
                    logger.error(`Fallback approach also failed: ${fallbackError.message}`);
                    
                    // Close connection on error
                    if (routerObj && conn && typeof conn.close === 'function') {
                        try {
                            await conn.close();
                        } catch (closeError) {
                            // Ignore
                        }
                    }
                    
                    return { success: false, message: `Gagal menambah profile: ${fallbackError.message}. Coba dengan nama profile yang berbeda atau pastikan koneksi ke router berhasil.` };
                }
            }
            
            // Close connection before throwing
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore
                }
            }
            
            throw apiError;
        } finally {
            // Ensure connection is closed if it was created for this request
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore close errors
                }
            }
        }
    } catch (error) {
        logger.error(`Error adding hotspot profile: ${error.message}`);
        logger.error(`Error stack:`, error.stack);
        return { success: false, message: `Gagal menambah profile: ${error.message}` };
    }
}

// Fungsi untuk edit profile hotspot
async function editHotspotProfile(profileData, routerObj = null) {
    try {
        // Pastikan routerObj ada - koneksi harus dari database routers
        if (!routerObj) {
            logger.error('Router object tidak ditemukan. Koneksi harus dari database routers.');
            return { success: false, message: 'Router/NAS harus dipilih dari database' };
        }
        
        let conn = null;
        try {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } catch (connError) {
            logger.error(`Gagal koneksi ke Mikrotik ${routerObj.name}: ${connError.message}`);
            return { 
                success: false, 
                message: `Gagal koneksi ke Mikrotik ${routerObj.name} (${routerObj.nas_ip}): ${connError.message}` 
            };
        }
        
        if (!conn) {
            logger.error(`Tidak dapat terhubung ke Mikrotik ${routerObj.name}`);
            return { 
                success: false, 
                message: `Tidak dapat terhubung ke Mikrotik ${routerObj.name} (${routerObj.nas_ip})` 
            };
        }
        
        const {
            id,
            name,
            comment,
            rateLimit,
            rateLimitUnit,
            sessionTimeout,
            sessionTimeoutUnit,
            idleTimeout,
            idleTimeoutUnit,
            localAddress,
            remoteAddress,
            dnsServer,
            parentQueue,
            addressList,
            sharedUsers
        } = profileData;
        
        const params = [
            '=.id=' + id,
            '=name=' + name
        ];
        
        // Comment - safe parameter
        if (comment !== undefined && comment !== null && String(comment).trim() !== '') {
            params.push('=comment=' + String(comment).trim());
        }
        
        // Rate limit: only add if both value and unit are valid, with proper unit mapping
        // Format Mikrotik: upload/download (e.g., "10M/10M") or just upload if same
        if (rateLimit && rateLimitUnit && String(rateLimit).trim() !== '' && String(rateLimitUnit).trim() !== '') {
            const rateLimitValue = String(rateLimit).trim();
            let rateLimitUnitValue = String(rateLimitUnit).trim().toLowerCase();
            // Accept both lowercase and uppercase: k/K, m/M, g/G
            if (['k', 'm', 'g', 'K', 'M', 'G'].includes(rateLimitUnitValue)) {
                // Normalize to uppercase for Mikrotik
                if (rateLimitUnitValue === 'm' || rateLimitUnitValue === 'M') rateLimitUnitValue = 'M';
                else if (rateLimitUnitValue === 'g' || rateLimitUnitValue === 'G') rateLimitUnitValue = 'G';
                else if (rateLimitUnitValue === 'k' || rateLimitUnitValue === 'K') rateLimitUnitValue = 'K';
                const numValue = parseInt(rateLimitValue);
                if (!isNaN(numValue) && numValue > 0) {
                    // Format: upload/download (same value for both)
                    const rateLimitFormatted = numValue + rateLimitUnitValue + '/' + numValue + rateLimitUnitValue;
                    params.push('=rate-limit=' + rateLimitFormatted);
                    logger.info(`Rate limit formatted (edit): ${rateLimitFormatted} (from input: ${rateLimitValue}${rateLimitUnit})`);
                } else {
                    logger.warn(`Invalid rate limit value: ${rateLimitValue} (not a valid number)`);
                }
            } else {
                logger.warn(`Invalid rate limit unit: ${rateLimitUnitValue} (expected k/K, m/M, or g/G)`);
            }
        } else if (rateLimit === '' || rateLimit === null || rateLimit === undefined) {
            // Allow clearing rate limit
            params.push('=rate-limit=');
            logger.info('Rate limit cleared (empty value)');
        }
        
        // Session timeout: only add if both value and unit are valid, with proper unit mapping
        // Validasi: nilai harus > 0, jika 0 atau kosong, jangan kirim parameter
        if (sessionTimeout !== undefined && sessionTimeout !== null && sessionTimeout !== '' && 
            sessionTimeoutUnit !== undefined && sessionTimeoutUnit !== null && sessionTimeoutUnit !== '') {
            const sessionTimeoutValue = String(sessionTimeout).trim();
            let sessionTimeoutUnitValue = String(sessionTimeoutUnit).trim().toLowerCase();
            const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
            if (timeoutUnitMap[sessionTimeoutUnitValue]) {
                sessionTimeoutUnitValue = timeoutUnitMap[sessionTimeoutUnitValue];
                const numValue = parseInt(sessionTimeoutValue);
                // Hanya kirim jika nilai > 0 (nilai 0 tidak valid untuk session-timeout)
                if (!isNaN(numValue) && numValue > 0) {
                    params.push('=session-timeout=' + numValue + sessionTimeoutUnitValue);
                }
                // Jika nilai 0, abaikan parameter (tidak kirim) untuk menghindari error
            }
        }
        // Jika sessionTimeout kosong/null/undefined, jangan kirim parameter (bukan clear dengan empty string)
        
        // Idle timeout: only add if both value and unit are valid, with proper unit mapping
        // Validasi: nilai harus > 0, jika 0 atau kosong, jangan kirim parameter
        if (idleTimeout !== undefined && idleTimeout !== null && idleTimeout !== '' && 
            idleTimeoutUnit !== undefined && idleTimeoutUnit !== null && idleTimeoutUnit !== '') {
            const idleTimeoutValue = String(idleTimeout).trim();
            let idleTimeoutUnitValue = String(idleTimeoutUnit).trim().toLowerCase();
            const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
            if (timeoutUnitMap[idleTimeoutUnitValue]) {
                idleTimeoutUnitValue = timeoutUnitMap[idleTimeoutUnitValue];
                const numValue = parseInt(idleTimeoutValue);
                // Hanya kirim jika nilai > 0 (nilai 0 tidak valid untuk idle-timeout)
                if (!isNaN(numValue) && numValue > 0) {
                    params.push('=idle-timeout=' + numValue + idleTimeoutUnitValue);
                }
                // Jika nilai 0, abaikan parameter (tidak kirim) untuk menghindari error
            }
        }
        // Jika idleTimeout kosong/null/undefined, jangan kirim parameter (bukan clear dengan empty string)
        // SKIP: local-address, remote-address, dns-server, parent-queue, address-list
        // These parameters are NOT supported for hotspot user profile in Mikrotik
        // They may cause "unknown parameter" error
        
        // Shared users: valid field - only if value is valid positive integer
        if (sharedUsers !== undefined && sharedUsers !== null && String(sharedUsers).trim() !== '' && String(sharedUsers).trim() !== '0') {
            const sharedUsersValue = parseInt(String(sharedUsers).trim());
            if (!isNaN(sharedUsersValue) && sharedUsersValue > 0) {
                params.push('=shared-users=' + sharedUsersValue);
            }
        }
        
        // Log parameters for debugging
        logger.info('=== Editing Hotspot Profile ===');
        logger.info('Profile ID:', id);
        logger.info('Name:', name);
        logger.info('Router:', routerObj ? `${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})` : 'default');
        logger.info('Total params:', params.length);
        logger.info('Raw params:', JSON.stringify(params));
        params.forEach((p, idx) => {
            logger.info(`  Param ${idx + 1}: ${p}`);
        });
        
        try {
            await conn.write('/ip/hotspot/user/profile/set', params);
            logger.info('✓ Successfully updated hotspot profile:', name);
            
            // Close connection if created for this request
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    logger.warn('Error closing connection:', closeError.message);
                }
            }
            
            return { success: true, message: 'Profile hotspot berhasil diupdate' };
        } catch (apiError) {
            logger.error('✗ Mikrotik API Error:', apiError.message);
            logger.error('Error stack:', apiError.stack);
            logger.error('Parameters that were sent:', JSON.stringify(params));
            
            // If error mentions "unknown parameter", try updating one by one
            if (apiError.message && apiError.message.toLowerCase().includes('unknown parameter')) {
                logger.warn('=== Unknown parameter error, trying step-by-step update ===');
                
                // Try updating with minimal parameters first (name, comment only)
                try {
                    logger.info('Attempt 1: Name and comment only');
                    const minimalParams = ['=.id=' + id, '=name=' + name];
                    if (comment !== undefined && comment !== null && String(comment).trim() !== '') {
                        minimalParams.push('=comment=' + String(comment).trim());
                    }
                    await conn.write('/ip/hotspot/user/profile/set', minimalParams);
                    logger.info('✓ Success with minimal params, now updating with other params one by one');
                    
                    // Update rate-limit
                    if (rateLimit && rateLimitUnit && String(rateLimit).trim() !== '' && String(rateLimitUnit).trim() !== '') {
                        const rateLimitValue = String(rateLimit).trim();
                        let rateLimitUnitValue = String(rateLimitUnit).trim().toLowerCase();
                        if (['k', 'm', 'g', 'K', 'M', 'G'].includes(rateLimitUnitValue)) {
                            if (rateLimitUnitValue === 'm' || rateLimitUnitValue === 'M') rateLimitUnitValue = 'M';
                            else if (rateLimitUnitValue === 'g' || rateLimitUnitValue === 'G') rateLimitUnitValue = 'G';
                            else if (rateLimitUnitValue === 'k' || rateLimitUnitValue === 'K') rateLimitUnitValue = 'K';
                            const numValue = parseInt(rateLimitValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                const rateLimitFormatted = numValue + rateLimitUnitValue + '/' + numValue + rateLimitUnitValue;
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=rate-limit=' + rateLimitFormatted]);
                                    logger.info(`✓ Rate limit updated: ${rateLimitFormatted}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update rate limit: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update session-timeout
                    if (sessionTimeout && sessionTimeoutUnit && String(sessionTimeout).trim() !== '' && String(sessionTimeoutUnit).trim() !== '') {
                        const sessionTimeoutValue = String(sessionTimeout).trim();
                        let sessionTimeoutUnitValue = String(sessionTimeoutUnit).trim().toLowerCase();
                        const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
                        if (timeoutUnitMap[sessionTimeoutUnitValue]) {
                            sessionTimeoutUnitValue = timeoutUnitMap[sessionTimeoutUnitValue];
                            const numValue = parseInt(sessionTimeoutValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=session-timeout=' + numValue + sessionTimeoutUnitValue]);
                                    logger.info(`✓ Session timeout updated: ${numValue}${sessionTimeoutUnitValue}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update session timeout: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update idle-timeout
                    if (idleTimeout && idleTimeoutUnit && String(idleTimeout).trim() !== '' && String(idleTimeoutUnit).trim() !== '') {
                        const idleTimeoutValue = String(idleTimeout).trim();
                        let idleTimeoutUnitValue = String(idleTimeoutUnit).trim().toLowerCase();
                        const timeoutUnitMap = { 'detik': 's', 's': 's', 'menit': 'm', 'men': 'm', 'm': 'm', 'jam': 'h', 'h': 'h', 'hari': 'd', 'd': 'd' };
                        if (timeoutUnitMap[idleTimeoutUnitValue]) {
                            idleTimeoutUnitValue = timeoutUnitMap[idleTimeoutUnitValue];
                            const numValue = parseInt(idleTimeoutValue);
                            if (!isNaN(numValue) && numValue > 0) {
                                try {
                                    await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=idle-timeout=' + numValue + idleTimeoutUnitValue]);
                                    logger.info(`✓ Idle timeout updated: ${numValue}${idleTimeoutUnitValue}`);
                                } catch (e) {
                                    logger.warn(`✗ Failed to update idle timeout: ${e.message}`);
                                }
                            }
                        }
                    }
                    
                    // Update shared-users
                    if (sharedUsers !== undefined && sharedUsers !== null && String(sharedUsers).trim() !== '' && String(sharedUsers).trim() !== '0') {
                        const sharedUsersValue = parseInt(String(sharedUsers).trim());
                        if (!isNaN(sharedUsersValue) && sharedUsersValue > 0) {
                            try {
                                await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + id, '=shared-users=' + sharedUsersValue]);
                                logger.info(`✓ Shared users updated: ${sharedUsersValue}`);
                            } catch (e) {
                                logger.warn(`✗ Failed to update shared users: ${e.message}`);
                            }
                        }
                    }
                    
                    logger.info('✓ Successfully updated profile step by step');
                    
                    // Close connection if created for this request
                    if (routerObj && conn && typeof conn.close === 'function') {
                        try {
                            await conn.close();
                        } catch (closeError) {
                            logger.warn('Error closing connection:', closeError.message);
                        }
                    }
                    
                    return { success: true, message: 'Profile hotspot berhasil diupdate' };
                } catch (fallbackError) {
                    logger.error(`Fallback approach also failed: ${fallbackError.message}`);
                    
                    // Close connection on error
                    if (routerObj && conn && typeof conn.close === 'function') {
                        try {
                            await conn.close();
                        } catch (closeError) {
                            // Ignore
                        }
                    }
                    
                    return { success: false, message: `Gagal mengupdate profile: ${fallbackError.message}. Coba dengan parameter yang lebih sederhana atau pastikan koneksi ke router berhasil.` };
                }
            }
            
            // Close connection before throwing
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore
                }
            }
            
            throw apiError;
        } finally {
            // Ensure connection is closed if it was created for this request
            if (routerObj && conn && typeof conn.close === 'function') {
                try {
                    await conn.close();
                } catch (closeError) {
                    // Ignore close errors
                }
            }
        }
    } catch (error) {
        logger.error(`Error editing hotspot profile: ${error.message}`);
        logger.error(`Error stack:`, error.stack);
        return { success: false, message: `Gagal mengupdate profile: ${error.message}` };
    }
}

// Fungsi untuk hapus profile hotspot
async function deleteHotspotProfile(id, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }
        
        await conn.write('/ip/hotspot/user/profile/remove', [
            '=.id=' + id
        ]);
        
        return { success: true, message: 'Profile hotspot berhasil dihapus' };
    } catch (error) {
        logger.error(`Error deleting hotspot profile: ${error.message}`);
        return { success: false, message: `Gagal menghapus profile: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan firewall rules
async function getFirewallRules(chain = '') {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: [] };
        }

        const params = [];
        if (chain) {
            params.push(`?chain=${chain}`);
        }

        const rules = await conn.write('/ip/firewall/filter/print', params);
        return {
            success: true,
            message: `Ditemukan ${rules.length} firewall rule${chain ? ` untuk chain ${chain}` : ''}`,
            data: rules
        };
    } catch (error) {
        logger.error(`Error getting firewall rules: ${error.message}`);
        return { success: false, message: `Gagal ambil data firewall rule: ${error.message}`, data: [] };
    }
}

// Fungsi untuk restart router
async function restartRouter() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        await conn.write('/system/reboot');
        return { success: true, message: 'Router akan restart dalam beberapa detik' };
    } catch (error) {
        logger.error(`Error restarting router: ${error.message}`);
        return { success: false, message: `Gagal restart router: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan identity router
async function getRouterIdentity() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const identity = await conn.write('/system/identity/print');
        return {
            success: true,
            message: 'Identity router berhasil diambil',
            data: identity[0]
        };
    } catch (error) {
        logger.error(`Error getting router identity: ${error.message}`);
        return { success: false, message: `Gagal ambil identity router: ${error.message}`, data: null };
    }
}

// Fungsi untuk set identity router
async function setRouterIdentity(name) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal' };
        }

        await conn.write('/system/identity/set', [
            `=name=${name}`
        ]);

        return { success: true, message: `Identity router berhasil diubah menjadi: ${name}` };
    } catch (error) {
        logger.error(`Error setting router identity: ${error.message}`);
        return { success: false, message: `Gagal mengubah identity router: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan clock router
async function getRouterClock() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available');
            return { success: false, message: 'Koneksi ke Mikrotik gagal', data: null };
        }

        const clock = await conn.write('/system/clock/print');
        return {
            success: true,
            message: 'Clock router berhasil diambil',
            data: clock[0]
        };
    } catch (error) {
        logger.error(`Error getting router clock: ${error.message}`);
        return { success: false, message: `Gagal ambil clock router: ${error.message}`, data: null };
    }
}

// Fungsi untuk mendapatkan semua user (hotspot + PPPoE)
async function getAllUsers() {
    try {
        // Ambil user hotspot
        const hotspotResult = await getActiveHotspotUsers();
        const hotspotUsers = hotspotResult.success ? hotspotResult.data : [];

        // Ambil user PPPoE aktif
        const pppoeResult = await getActivePPPoEConnections();
        const pppoeUsers = pppoeResult.success ? pppoeResult.data : [];

        // Ambil user PPPoE offline
        const offlineResult = await getInactivePPPoEUsers();
        const offlineUsers = offlineResult.success ? offlineResult.data : [];

        return {
            success: true,
            message: `Total: ${hotspotUsers.length} hotspot aktif, ${pppoeUsers.length} PPPoE aktif, ${offlineUsers.length} PPPoE offline`,
            data: {
                hotspotActive: hotspotUsers,
                pppoeActive: pppoeUsers,
                pppoeOffline: offlineUsers,
                totalActive: hotspotUsers.length + pppoeUsers.length,
                totalOffline: offlineUsers.length
            }
        };
    } catch (error) {
        logger.error(`Error getting all users: ${error.message}`);
        return { success: false, message: `Gagal ambil data semua user: ${error.message}`, data: null };
    }
}

// ...
// Fungsi tambah user PPPoE (alias addPPPoESecret)
async function addPPPoEUser({ username, password, profile, customer = null, routerObj = null, comment = '' }) {
    logger.info(`[MIKROTIK] addPPPoEUser called: username=${username}, profile=${profile}, comment=${comment}, customer=${customer ? customer.id : 'null'}, routerObj=${routerObj ? routerObj.name : 'null'}`);
    
    const mode = getSetting('user_auth_mode', 'mikrotik');
    if (mode === 'radius') {
        logger.info(`[MIKROTIK] Using RADIUS mode for user ${username}`);
        return await addPPPoEUserRadius({ username, password });
    } else {
        let conn = null;
        try {
            if (customer) {
                logger.info(`[MIKROTIK] Getting connection for customer ID: ${customer.id}`);
                conn = await getMikrotikConnectionForCustomer(customer);
            } else if (routerObj) {
                logger.info(`[MIKROTIK] Getting connection for router: ${routerObj.name}`);
                conn = await getMikrotikConnectionForRouter(routerObj);
            } else {
                logger.info(`[MIKROTIK] Getting default connection (fallback)`);
                conn = await getMikrotikConnection(); // fallback lama ONLY for admin use
            }
            
            if (!conn) {
                const errorMsg = 'Koneksi ke router gagal: Data router/NAS tidak ditemukan';
                logger.error(`[MIKROTIK] ❌ ${errorMsg}`);
                throw new Error(errorMsg);
            }
            
            logger.info(`[MIKROTIK] ✅ Connection obtained, calling addPPPoESecret...`);
            return await addPPPoESecret(username, password, profile, '', conn, comment);
        } catch (error) {
            logger.error(`[MIKROTIK] ❌ Exception in addPPPoEUser: ${error.message}`);
            logger.error(`[MIKROTIK] Stack trace:`, error.stack);
            throw error;
        }
    }
}

// Update user hotspot (password dan profile)
async function updateHotspotUser(username, password, profile) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        // Cari .id user berdasarkan username
        const users = await conn.write('/ip/hotspot/user/print', [
            '?name=' + username
        ]);
        if (!users.length) throw new Error('User tidak ditemukan');
        const id = users[0]['.id'];
        // Update password dan profile
        await conn.write('/ip/hotspot/user/set', [
            '=numbers=' + id,
            '=password=' + password,
            '=profile=' + profile
        ]);
        return true;
    } catch (err) {
        throw err;
    }
}

// Fungsi untuk generate voucher hotspot secara massal (versi lama - dihapus)
// Fungsi ini diganti dengan fungsi generateHotspotVouchers yang lebih lengkap di bawah

// Fungsi untuk menambah profile PPPoE
async function addPPPoEProfile(profileData, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
            logger.info(`Connecting to router for addPPPoEProfile: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        
        const params = [
            '=name=' + profileData.name
        ];
        
        // Tambahkan field opsional jika ada (pastikan tidak kosong dan tidak hanya whitespace)
        if (profileData['rate-limit'] && profileData['rate-limit'].trim() !== '') {
            params.push('=rate-limit=' + profileData['rate-limit'].trim());
        }
        if (profileData['local-address'] && profileData['local-address'].trim() !== '') {
            params.push('=local-address=' + profileData['local-address'].trim());
        }
        if (profileData['remote-address'] && profileData['remote-address'].trim() !== '') {
            params.push('=remote-address=' + profileData['remote-address'].trim());
        }
        if (profileData['dns-server'] && profileData['dns-server'].trim() !== '') {
            params.push('=dns-server=' + profileData['dns-server'].trim());
        }
        if (profileData['parent-queue'] && profileData['parent-queue'].trim() !== '') {
            params.push('=parent-queue=' + profileData['parent-queue'].trim());
        }
        if (profileData['address-list'] && profileData['address-list'].trim() !== '') {
            params.push('=address-list=' + profileData['address-list'].trim());
        }
        if (profileData.comment && profileData.comment.trim() !== '') {
            params.push('=comment=' + profileData.comment.trim());
        }
        if (profileData['bridge-learning'] && profileData['bridge-learning'] !== 'default') params.push('=bridge-learning=' + profileData['bridge-learning']);
        if (profileData['use-mpls'] && profileData['use-mpls'] !== 'default') params.push('=use-mpls=' + profileData['use-mpls']);
        if (profileData['use-compression'] && profileData['use-compression'] !== 'default') params.push('=use-compression=' + profileData['use-compression']);
        if (profileData['use-encryption'] && profileData['use-encryption'] !== 'default') params.push('=use-encryption=' + profileData['use-encryption']);
        if (profileData['only-one'] && profileData['only-one'] !== 'default') params.push('=only-one=' + profileData['only-one']);
        if (profileData['change-tcp-mss'] && profileData['change-tcp-mss'] !== 'default') params.push('=change-tcp-mss=' + profileData['change-tcp-mss']);
        
        await conn.write('/ppp/profile/add', params);
        
        return { success: true };
    } catch (error) {
        logger.error(`Error adding PPPoE profile: ${error.message}`);
        return { success: false, message: error.message };
    }
}

// Fungsi untuk edit profile PPPoE
async function editPPPoEProfile(profileData, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
            logger.info(`Connecting to router for editPPPoEProfile: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        
        const params = [
            '=.id=' + profileData.id
        ];
        
        // Tambahkan field yang akan diupdate (pastikan tidak kosong dan tidak hanya whitespace)
        if (profileData.name && profileData.name.trim() !== '') {
            params.push('=name=' + profileData.name.trim());
        }
        if (profileData['rate-limit'] !== undefined && profileData['rate-limit'] !== null && String(profileData['rate-limit']).trim() !== '') {
            params.push('=rate-limit=' + String(profileData['rate-limit']).trim());
        }
        if (profileData['local-address'] !== undefined && profileData['local-address'] !== null && String(profileData['local-address']).trim() !== '') {
            params.push('=local-address=' + String(profileData['local-address']).trim());
        }
        if (profileData['remote-address'] !== undefined && profileData['remote-address'] !== null && String(profileData['remote-address']).trim() !== '') {
            params.push('=remote-address=' + String(profileData['remote-address']).trim());
        }
        if (profileData['dns-server'] !== undefined && profileData['dns-server'] !== null && String(profileData['dns-server']).trim() !== '') {
            params.push('=dns-server=' + String(profileData['dns-server']).trim());
        }
        if (profileData['parent-queue'] !== undefined && profileData['parent-queue'] !== null && String(profileData['parent-queue']).trim() !== '') {
            params.push('=parent-queue=' + String(profileData['parent-queue']).trim());
        }
        if (profileData['address-list'] !== undefined && profileData['address-list'] !== null && String(profileData['address-list']).trim() !== '') {
            params.push('=address-list=' + String(profileData['address-list']).trim());
        }
        if (profileData.comment !== undefined && profileData.comment !== null && String(profileData.comment).trim() !== '') {
            params.push('=comment=' + String(profileData.comment).trim());
        }
        if (profileData['bridge-learning'] !== undefined) params.push('=bridge-learning=' + profileData['bridge-learning']);
        if (profileData['use-mpls'] !== undefined) params.push('=use-mpls=' + profileData['use-mpls']);
        if (profileData['use-compression'] !== undefined) params.push('=use-compression=' + profileData['use-compression']);
        if (profileData['use-encryption'] !== undefined) params.push('=use-encryption=' + profileData['use-encryption']);
        if (profileData['only-one'] !== undefined) params.push('=only-one=' + profileData['only-one']);
        if (profileData['change-tcp-mss'] !== undefined) params.push('=change-tcp-mss=' + profileData['change-tcp-mss']);
        
        await conn.write('/ppp/profile/set', params);
        
        return { success: true };
    } catch (error) {
        logger.error(`Error editing PPPoE profile: ${error.message}`);
        return { success: false, message: error.message };
    }
}

// Fungsi untuk hapus profile PPPoE
async function deletePPPoEProfile(id, routerObj = null) {
    try {
        let conn = null;
        if (routerObj) {
            conn = await getMikrotikConnectionForRouter(routerObj);
            logger.info(`Connecting to router for deletePPPoEProfile: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728})`);
        } else {
            conn = await getMikrotikConnection();
        }
        if (!conn) throw new Error('Koneksi ke Mikrotik gagal');
        
        await conn.write('/ppp/profile/remove', [ '=.id=' + id ]);
        
        return { success: true };
    } catch (error) {
        logger.error(`Error deleting PPPoE profile: ${error.message}`);
        return { success: false, message: error.message };
    }
}

// Fungsi untuk generate hotspot vouchers
async function generateHotspotVouchers(count, prefix, profile, server, validity, uptime, price, charType = 'alphanumeric', routerObj = null) {
    try {
        // Pastikan routerObj ada - koneksi harus dari database routers
        if (!routerObj) {
            logger.error('Router object tidak ditemukan. Koneksi harus dari database routers.');
            return { success: false, message: 'Router/NAS harus dipilih dari database', vouchers: [] };
        }
        
        // Koneksi ke Mikrotik menggunakan router dari database
        let conn = null;
        try {
            conn = await getMikrotikConnectionForRouter(routerObj);
            logger.info(`Connecting to router: ${routerObj.name} (${routerObj.nas_ip}:${routerObj.port || 8728}) for voucher generation`);
        } catch (connError) {
            logger.error(`Gagal koneksi ke Mikrotik ${routerObj.name}: ${connError.message}`);
            return { 
                success: false, 
                message: `Gagal koneksi ke Mikrotik ${routerObj.name} (${routerObj.nas_ip}): ${connError.message}`, 
                vouchers: [] 
            };
        }
        
        if (!conn) {
            logger.error(`Tidak dapat terhubung ke Mikrotik ${routerObj.name}`);
            return { 
                success: false, 
                message: `Tidak dapat terhubung ke Mikrotik ${routerObj.name} (${routerObj.nas_ip})`, 
                vouchers: [] 
            };
        }
        
        // Get voucher generation settings from database
        const voucherSettings = await getVoucherGenerationSettings();
        
        // Fungsi untuk generate random string berdasarkan jenis karakter
        function randomString(length, charType = 'alphanumeric') {
            let chars;
            switch (charType) {
                case 'numeric':
                    chars = '0123456789';
                    break;
                case 'alphabetic':
                    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
                    break;
                case 'alphanumeric':
                default:
                    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                    break;
            }
            let str = '';
            for (let i = 0; i < length; i++) {
                str += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return str;
        }
        
        const vouchers = [];
        
        // Log untuk debugging
        logger.info(`Generating ${count} vouchers with prefix ${prefix} and profile ${profile}`);
        
        for (let i = 0; i < count; i++) {
            // Generate username and password based on settings
            const usernameLength = parseInt(voucherSettings.username_length || 4);
            const charTypeSetting = voucherSettings.char_type || charType;
            const accountType = voucherSettings.account_type || 'voucher';
            
            const username = prefix + randomString(usernameLength, charTypeSetting);
            
            // Generate password berdasarkan tipe akun
            let password;
            if (accountType === 'voucher') {
                // Voucher: password sama dengan username
                password = username;
            } else {
                // Member: password berbeda dari username
                const passwordLength = parseInt(voucherSettings.password_length_separate || 6);
                password = randomString(passwordLength, 'alphanumeric');
            }
            
            try {
                // Tambahkan user hotspot ke Mikrotik menggunakan addHotspotUser dengan routerObj
                // Sertakan server yang dipilih saat generate voucher
                const addResult = await addHotspotUser(username, password, profile, 'voucher', null, routerObj, validity, uptime, server);
                
                // Cek apakah addHotspotUser berhasil
                if (!addResult || !addResult.success) {
                    logger.error(`Failed to create voucher ${username}: ${addResult ? addResult.message : 'Unknown error'}`);
                    // Lanjutkan ke voucher berikutnya
                    continue;
                }
                
                // Simpan data voucher ke tabel voucher_data
                try {
                    const { createOrUpdateVoucherData } = require('../routes/adminHotspot');
                    // Pastikan fungsi tersedia (jika tidak, skip)
                    if (typeof createOrUpdateVoucherData === 'function') {
                        try {
                            await createOrUpdateVoucherData(
                                username,
                                routerObj.id,
                                routerObj.name,
                                routerObj.nas_ip,
                                profile,
                                uptime || '0',
                                validity || '0',
                                price || 0
                            );
                            logger.info(`Voucher data saved for ${username} with price ${price || 0}`);
                        } catch (voucherDataErr) {
                            // Log error tapi jangan throw - voucher sudah dibuat di Mikrotik
                            logger.error(`Error saving voucher data for ${username}:`, voucherDataErr.message || voucherDataErr);
                            // Lanjutkan meskipun error save voucher data
                        }
                    }
                } catch (requireErr) {
                    logger.error(`Error requiring createOrUpdateVoucherData:`, requireErr.message || requireErr);
                    // Lanjutkan meskipun error require
                }
                
                // Tambahkan ke array vouchers
                vouchers.push({
                    username,
                    password,
                    profile,
                    server: server !== 'all' ? server : 'all',
                    nas_name: routerObj.name,
                    nas_ip: routerObj.nas_ip,
                    createdAt: new Date(),
                    price: price, // Tambahkan harga ke data voucher
                    account_type: accountType // Tambahkan tipe akun
                });
                
                logger.info(`${accountType === 'voucher' ? 'Voucher' : 'Member'} created: ${username} (password: ${password}) on ${routerObj.name}`);
            } catch (err) {
                logger.error(`Failed to create voucher ${username}: ${err.message}`);
                // Lanjutkan ke voucher berikutnya, jangan throw error agar bisa mencoba voucher berikutnya
            }
        }
        
        logger.info(`Successfully generated ${vouchers.length} vouchers`);
        
        return {
            success: true,
            message: `Berhasil membuat ${vouchers.length} voucher`,
            vouchers: vouchers
        };
    } catch (error) {
        logger.error(`Error generating vouchers: ${error.message}`);
        return {
            success: false,
            message: `Gagal generate voucher: ${error.message}`,
            vouchers: []
        };
    }
}

// Fungsi untuk mengambil pengaturan generate voucher dari database
async function getVoucherGenerationSettings() {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');
        
        return new Promise((resolve, reject) => {
            db.all("SELECT setting_key, setting_value FROM voucher_generation_settings", (err, rows) => {
                if (err) {
                    console.log('⚠️ voucher_generation_settings table not found, using defaults');
                    resolve({});
                    return;
                }
                
                const settings = {};
                rows.forEach(row => {
                    settings[row.setting_key] = row.setting_value;
                });
                
                db.close();
                resolve(settings);
            });
        });
    } catch (error) {
        console.error('Error getting voucher generation settings:', error);
        return {};
    }
}

// Fungsi untuk test generate voucher (tanpa menyimpan ke Mikrotik)
async function generateTestVoucher(settings) {
    try {
        // Fungsi untuk generate random string berdasarkan jenis karakter
        function randomString(length, charType = 'alphanumeric') {
            let chars;
            switch (charType) {
                case 'numeric':
                    chars = '0123456789';
                    break;
                case 'alphabetic':
                    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
                    break;
                case 'alphanumeric':
                default:
                    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                    break;
            }
            let str = '';
            for (let i = 0; i < length; i++) {
                str += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return str;
        }

        // Generate username berdasarkan format
        let username;
        const usernameLength = parseInt(settings.username_length || 4);
        const charType = settings.char_type || 'alphanumeric';
        const usernameFormat = settings.username_format || 'V{timestamp}';

        switch (usernameFormat) {
            case 'V{timestamp}':
                const timestamp = Date.now().toString().slice(-6);
                username = 'V' + timestamp + randomString(usernameLength, charType);
                break;
            case 'V{random}':
                username = 'V' + randomString(usernameLength, charType);
                break;
            case '{random}':
                username = randomString(usernameLength, charType);
                break;
            default:
                username = 'V' + randomString(usernameLength, charType);
        }

        // Generate password berdasarkan tipe akun
        let password;
        const accountType = settings.account_type || 'voucher';
        
        if (accountType === 'voucher') {
            // Voucher: password sama dengan username
            password = username;
        } else {
            // Member: password berbeda dari username
            const passwordLength = parseInt(settings.password_length_separate || 6);
            password = randomString(passwordLength, 'alphanumeric');
        }

        return {
            success: true,
            username: username,
            password: password,
            account_type: accountType,
            message: `Test generate ${accountType} berhasil`
        };

    } catch (error) {
        return {
            success: false,
            message: 'Gagal test generate voucher: ' + error.message
        };
    }
}

// --- Watcher settings.json untuk reset koneksi Mikrotik jika setting berubah ---
const settingsPath = path.join(process.cwd(), 'settings.json');
let lastMikrotikConfig = {};

function getCurrentMikrotikConfig() {
    return {
        host: getSetting('mikrotik_host', '192.168.8.1'),
        port: getSetting('mikrotik_port', '8728'),
        user: getSetting('mikrotik_user', 'admin'),
        password: getSetting('mikrotik_password', 'admin')
    };
}

function mikrotikConfigChanged(newConfig, oldConfig) {
    return (
        newConfig.host !== oldConfig.host ||
        newConfig.port !== oldConfig.port ||
        newConfig.user !== oldConfig.user ||
        newConfig.password !== oldConfig.password
    );
}

// Inisialisasi config awal
lastMikrotikConfig = getCurrentMikrotikConfig();

fs.watchFile(settingsPath, { interval: 2000 }, (curr, prev) => {
    try {
        const newConfig = getCurrentMikrotikConfig();
        if (mikrotikConfigChanged(newConfig, lastMikrotikConfig)) {
            logger.info('Konfigurasi Mikrotik di settings.json berubah, reset koneksi Mikrotik...');
            mikrotikConnection = null;
            lastMikrotikConfig = newConfig;
        }
    } catch (e) {
        logger.error('Gagal cek perubahan konfigurasi Mikrotik:', e.message);
    }
});

// Get RADIUS connection (if available)
async function getRadiusConnection() {
    // Prioritaskan ambil dari database (app_settings), fallback ke settings.json
    let radiusConfig;
    try {
        const { getRadiusConfig } = require('./radiusConfig');
        radiusConfig = await getRadiusConfig();
    } catch (e) {
        // Fallback ke settings.json jika database tidak bisa diakses
        logger.warn('Failed to get radius config from database, using settings.json fallback:', e.message);
        radiusConfig = {
            radius_host: getSetting('radius_host', 'localhost'),
            radius_user: getSetting('radius_user', 'radius'),
            radius_password: getSetting('radius_password', 'radius'),
            radius_database: getSetting('radius_database', 'radius')
        };
    }
    
    try {
        const mysql = require('mysql2/promise');
        const host = radiusConfig.radius_host || 'localhost';
        const user = radiusConfig.radius_user || 'radius';
        const password = radiusConfig.radius_password || 'radius';
        const database = radiusConfig.radius_database || 'radius';
        
        return await mysql.createConnection({ host, user, password, database });
    } catch (error) {
        logger.warn(`Failed to create RADIUS connection: ${error.message}`);
        return null;
    }
}

// Get RADIUS statistics
async function getRadiusStatistics() {
    try {
        const conn = await getRadiusConnection();
        if (!conn) {
            return { total: 0, active: 0, offline: 0 };
        }
        
        // Ambil daftar voucher usernames untuk exclude
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = require('path').join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        const voucherUsernames = await new Promise((resolve, reject) => {
            db.all('SELECT DISTINCT username FROM voucher_revenue', [], (err, rows) => {
                if (err) {
                    logger.warn(`Error getting voucher usernames for stats: ${err.message}`);
                    resolve([]);
                } else {
                    resolve(rows.map(r => r.username));
                }
            });
        });
        db.close();
        
        // Total PPPoE users (exclude vouchers)
        let totalQuery = `
            SELECT COUNT(DISTINCT username) as total
            FROM radcheck
            WHERE attribute = 'Cleartext-Password'
        `;
        const params = [];
        if (voucherUsernames.length > 0) {
            const placeholders = voucherUsernames.map(() => '?').join(',');
            totalQuery += ` AND username NOT IN (${placeholders})`;
            params.push(...voucherUsernames);
        }
        
        const [totalRows] = await conn.execute(totalQuery, params);
        const totalUsers = totalRows[0]?.total || 0;
        
        // Active PPPoE connections (dari radacct, exclude vouchers)
        let activeQuery = `
            SELECT COUNT(DISTINCT username) as active
            FROM radacct
            WHERE acctstoptime IS NULL
        `;
        const activeParams = [];
        if (voucherUsernames.length > 0) {
            const placeholders = voucherUsernames.map(() => '?').join(',');
            activeQuery += ` AND username NOT IN (${placeholders})`;
            activeParams.push(...voucherUsernames);
        }
        
        const [activeRows] = await conn.execute(activeQuery, activeParams);
        const activeConnections = activeRows[0]?.active || 0;
        
        // Offline users
        const offlineUsers = Math.max(totalUsers - activeConnections, 0);
        
        await conn.end();
        
        logger.info(`RADIUS Statistics - Total: ${totalUsers}, Active: ${activeConnections}, Offline: ${offlineUsers}`);
        
        return {
            total: totalUsers,
            active: activeConnections,
            offline: offlineUsers
        };
    } catch (error) {
        logger.error(`Error getting RADIUS statistics: ${error.message}`);
        return {
            total: 0,
            active: 0,
            offline: 0
        };
    }
}

// Get user auth mode (RADIUS or Mikrotik API)
async function getUserAuthModeAsync() {
    try {
        const { getRadiusConfigValue } = require('./radiusConfig');
        const mode = await getRadiusConfigValue('user_auth_mode', null);
        if (mode !== null && mode !== undefined) return mode;
    } catch (e) {
        // Fallback ke settings.json jika database tidak bisa diakses
        logger.debug('Failed to get user_auth_mode from database, using settings.json fallback');
    }
    return getSetting('user_auth_mode', 'mikrotik');
}

// Export all functions
module.exports = {
    setSock,
    connectToMikrotik,
    getMikrotikConnection,
    getMikrotikConnectionForRouter,
    getMikrotikConnectionForCustomer,
    getPPPoEUsers,
    addPPPoEUser,
    editPPPoEUser,
    deletePPPoEUser,
    getActivePPPoEConnections,
    formatUptime,
    getInactivePPPoEUsers,
    getRadiusStatistics,
    getUserAuthModeAsync,
    getRouterResources,
    getResourceInfo,
    getResourceInfoForRouter,
    getActiveHotspotUsers,
    addHotspotUser,
    deleteHotspotUser,
    addPPPoESecret,
    deletePPPoESecret,
    setPPPoEProfile,
    monitorPPPoEConnections,
    getInterfaces,
    getInterfaceDetail,
    setInterfaceStatus,
    getIPAddresses,
    addIPAddress,
    deleteIPAddress,
    getIPPools,
    // PPPoE/Hotspot profile helpers (needed by /admin/mikrotik)
    getPPPoEProfiles,
    getPPPoEProfileDetail,
    addPPPoEProfile,
    editPPPoEProfile,
    deletePPPoEProfile,
    getHotspotProfiles,
    getHotspotProfileDetail,
    addHotspotProfile,
    editHotspotProfile,
    deleteHotspotProfile,
    getHotspotServers,
    disconnectHotspotUser,
    disableHotspotUser,
    generateHotspotVouchers,
    getInterfaceTraffic
};
