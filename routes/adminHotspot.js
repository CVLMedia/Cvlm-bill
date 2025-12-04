const express = require('express');
const router = express.Router();
const { addHotspotUser, getActiveHotspotUsers, getHotspotProfiles, deleteHotspotUser, generateHotspotVouchers, getHotspotServers, disconnectHotspotUser, disableHotspotUser, getMikrotikConnectionForRouter } = require('../config/mikrotik');
const { getMikrotikConnection } = require('../config/mikrotik');
const fs = require('fs');
const path = require('path');
const { getSettingsWithCache } = require('../config/settingsManager')
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const sqlite3 = require('sqlite3').verbose();

// Helper function untuk mengambil setting voucher online
async function getVoucherOnlineSettings() {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');

    return new Promise((resolve, reject) => {
        // Ensure table exists
        db.run(`
            CREATE TABLE IF NOT EXISTS voucher_online_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                package_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL DEFAULT '',
                profile TEXT NOT NULL,
                digits INTEGER NOT NULL DEFAULT 5,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                console.error('Error creating voucher_online_settings table:', err);
                resolve({});
                return;
            }

            // Insert default settings if table is empty
            db.get('SELECT COUNT(*) as count FROM voucher_online_settings', (err, row) => {
                if (err || row.count === 0) {
                    // Get first available profile from Mikrotik as default
                    const { getHotspotProfiles } = require('../config/mikrotik');
                    getHotspotProfiles().then(profilesResult => {
                        const defaultProfile = (profilesResult.success && profilesResult.data && profilesResult.data.length > 0) 
                            ? profilesResult.data[0].name 
                            : 'default';
                        
                        const defaultSettings = [
                            ['3k', '3rb - 1 Hari', defaultProfile, 5, 1],
                            ['5k', '5rb - 2 Hari', defaultProfile, 5, 1],
                            ['10k', '10rb - 5 Hari', defaultProfile, 5, 1],
                            ['15k', '15rb - 8 Hari', defaultProfile, 5, 1],
                            ['25k', '25rb - 15 Hari', defaultProfile, 5, 1],
                            ['50k', '50rb - 30 Hari', defaultProfile, 5, 1]
                        ];

                        const insertPromises = defaultSettings.map(([packageId, name, profile, digits, enabled]) => {
                            return new Promise((resolveInsert, rejectInsert) => {
                                db.run(
                                    'INSERT OR IGNORE INTO voucher_online_settings (package_id, name, profile, digits, enabled) VALUES (?, ?, ?, ?, ?)',
                                    [packageId, name, profile, digits, enabled],
                                    (err) => {
                                        if (err) rejectInsert(err);
                                        else resolveInsert();
                                    }
                                );
                            });
                        });

                        Promise.all(insertPromises).then(() => {
                            // Now get all settings
                            db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                                if (err) {
                                    console.error('Error getting voucher online settings:', err);
                                    resolve({});
                                } else {
                                    const settings = {};
                                    rows.forEach(row => {
                                        settings[row.package_id] = {
                                            name: row.name || `${row.package_id} - Paket`,
                                            profile: row.profile,
                                            digits: row.digits || 5,
                                            enabled: row.enabled === 1
                                        };
                                    });
                                    db.close();
                                    resolve(settings);
                                }
                            });
                        }).catch((err) => {
                            console.error('Error inserting default settings:', err);
                            db.close();
                            resolve({});
                        });
                    }).catch((err) => {
                        console.error('Error getting Mikrotik profiles for default settings:', err);
                        // Fallback to hardcoded defaults
                        const fallbackSettings = [
                            ['3k', '3rb - 1 Hari', 'default', 5, 1],
                            ['5k', '5rb - 2 Hari', 'default', 5, 1],
                            ['10k', '10rb - 5 Hari', 'default', 5, 1],
                            ['15k', '15rb - 8 Hari', 'default', 5, 1],
                            ['25k', '25rb - 15 Hari', 'default', 5, 1],
                            ['50k', '50rb - 30 Hari', 'default', 5, 1]
                        ];
                        
                        const insertPromises = fallbackSettings.map(([packageId, name, profile, digits, enabled]) => {
                            return new Promise((resolveInsert, rejectInsert) => {
                                db.run(
                                    'INSERT OR IGNORE INTO voucher_online_settings (package_id, name, profile, digits, enabled) VALUES (?, ?, ?, ?, ?)',
                                    [packageId, name, profile, digits, enabled],
                                    (err) => {
                                        if (err) rejectInsert(err);
                                        else resolveInsert();
                                    }
                                );
                            });
                        });

                        Promise.all(insertPromises).then(() => {
                            db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                                if (err) {
                                    console.error('Error getting voucher online settings:', err);
                                    resolve({});
                                } else {
                                    const settings = {};
                                    rows.forEach(row => {
                                        settings[row.package_id] = {
                                            name: row.name || `${row.package_id} - Paket`,
                                            profile: row.profile,
                                            digits: row.digits || 5,
                                            enabled: row.enabled === 1
                                        };
                                    });
                                    db.close();
                                    resolve(settings);
                                }
                            });
                        }).catch((err) => {
                            console.error('Error inserting fallback settings:', err);
                            db.close();
                            resolve({});
                        });
                    });
                } else {
                    // Get existing settings
                    db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                        if (err) {
                            console.error('Error getting voucher online settings:', err);
                            resolve({});
                        } else {
                            const settings = {};
                            rows.forEach(row => {
                                settings[row.package_id] = {
                                    name: row.name || `${row.package_id} - Paket`,
                                    profile: row.profile,
                                    digits: row.digits || 5,
                                    enabled: row.enabled === 1
                                };
                            });
                            db.close();
                            resolve(settings);
                        }
                    });
                }
            });
        });
    });
}

// GET: Tampilkan form tambah user hotspot dan daftar user hotspot
router.get('/', async (req, res) => {
    try {
        // Fetch routers from database
        const db = new sqlite3.Database('./data/billing.db');
        const routers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Aggregate active users from all NAS
        const activeUsersList = [];
        for (const router of routers) {
            try {
                const result = await getActiveHotspotUsers(router);
                if (result.success && Array.isArray(result.data)) {
                    result.data.forEach(user => {
                        activeUsersList.push({
                            ...user,
                            nas_name: router.name,
                            nas_ip: router.nas_ip
                        });
                    });
                }
            } catch (e) {
                console.error(`Error getting active users from ${router.name}:`, e.message);
            }
        }

        // Aggregate profiles from all NAS
        let profiles = [];
        for (const router of routers) {
            try {
                const profilesResult = await getHotspotProfiles(router);
                if (profilesResult.success && Array.isArray(profilesResult.data)) {
                    profilesResult.data.forEach(prof => {
                        const existing = profiles.find(p => p.name === prof.name && p.nas_id === router.id);
                        if (!existing) {
                            profiles.push({
                                ...prof,
                                nas_id: router.id,
                                nas_name: router.name,
                                nas_ip: router.nas_ip
                            });
                        }
                    });
                }
            } catch (e) {
                console.error(`Error getting profiles from ${router.name}:`, e.message);
            }
        }

        // Aggregate all hotspot users from all NAS
        let allUsers = [];
        for (const router of routers) {
            try {
                const conn = await getMikrotikConnectionForRouter(router);
                const users = await conn.write('/ip/hotspot/user/print');
                allUsers = allUsers.concat(users.map(u => ({
                    name: u.name || '',
                    password: u.password || '',
                    profile: u.profile || '',
                    nas_id: router.id,
                    nas_name: router.name,
                    nas_ip: router.nas_ip
                })));
            } catch (e) {
                console.error(`Error getting users from ${router.name}:`, e.message);
            }
        }

        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminKontak = settings['admins.0'] || '-';

        // Ambil setting voucher online
        const voucherOnlineSettings = await getVoucherOnlineSettings();

        db.close();

        res.render('adminHotspot', {
            users: activeUsersList,
            profiles,
            allUsers,
            routers,
            voucherOnlineSettings,
            success: req.query.success,
            error: req.query.error,
            company_header,
            adminKontak,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        console.error('Error in hotspot GET route:', error);
        res.render('adminHotspot', { 
            users: [], 
            profiles: [], 
            allUsers: [], 
            routers: [],
            success: null, 
            error: 'Gagal mengambil data user hotspot: ' + error.message 
        });
    }
});

// POST: Hapus user hotspot
router.post('/delete', async (req, res) => {
    const { username, router_id } = req.body;
    try {
        let routerObj = null;
        if (router_id) {
            const db = new sqlite3.Database('./data/billing.db');
            routerObj = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row || null);
                });
            });
        }
        await deleteHotspotUser(username, routerObj);
        
        // Jika request dari AJAX, kirim JSON response
        if (req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
            return res.json({ success: true, message: 'User Hotspot berhasil dihapus' });
        }
        
        res.redirect('/admin/hotspot/list-voucher?success=User+Hotspot+berhasil+dihapus');
    } catch (error) {
        // Jika request dari AJAX, kirim JSON response
        if (req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
            return res.status(500).json({ success: false, message: 'Gagal hapus user: ' + error.message });
        }
        
        res.redirect('/admin/hotspot/list-voucher?error=Gagal+hapus+user:+' + encodeURIComponent(error.message));
    }
});

// POST: Hapus multiple user hotspot
router.post('/delete-multiple', async (req, res) => {
    const { vouchers } = req.body; // Array of {username, router_id}
    
    if (!vouchers || !Array.isArray(vouchers) || vouchers.length === 0) {
        return res.status(400).json({ success: false, message: 'Tidak ada voucher yang dipilih' });
    }
    
    const results = {
        success: [],
        failed: []
    };
    
    for (const voucher of vouchers) {
        const { username, router_id } = voucher;
        if (!username) continue;
        
        try {
            let routerObj = null;
            if (router_id) {
                const db = new sqlite3.Database('./data/billing.db');
                routerObj = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                        db.close();
                        if (err) reject(err);
                        else resolve(row || null);
                    });
                });
            }
            await deleteHotspotUser(username, routerObj);
            results.success.push(username);
        } catch (error) {
            results.failed.push({ username, error: error.message });
        }
    }
    
    if (results.failed.length === 0) {
        res.json({ 
            success: true, 
            message: `Berhasil menghapus ${results.success.length} voucher`,
            deleted: results.success.length
        });
    } else {
        res.json({ 
            success: results.success.length > 0,
            message: `Berhasil menghapus ${results.success.length} voucher, ${results.failed.length} gagal`,
            deleted: results.success.length,
            failed: results.failed.length,
            details: results
        });
    }
});

// POST: Proses penambahan user hotspot
router.post('/', async (req, res) => {
    const { username, password, profile, router_id } = req.body;
    try {
        if (!router_id) {
            return res.redirect('/admin/hotspot/list-voucher?error=Pilih+NAS+(router)+terlebih+dahulu');
        }
        const db = new sqlite3.Database('./data/billing.db');
        const routerObj = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row || null);
            });
        });
        if (!routerObj) {
            return res.redirect('/admin/hotspot/list-voucher?error=Router+tidak+ditemukan');
        }
        await addHotspotUser(username, password, profile, null, null, routerObj);
        // Redirect agar tidak double submit, tampilkan pesan sukses
        res.redirect('/admin/hotspot/list-voucher?success=User+Hotspot+berhasil+ditambahkan');
    } catch (error) {
        res.redirect('/admin/hotspot/list-voucher?error=Gagal+menambah+user:+"'+encodeURIComponent(error.message)+'"');
    }
});

// POST: Edit user hotspot
router.post('/edit', async (req, res) => {
    const { username, password, profile, router_id, originalUsername } = req.body;
    try {
        if (!router_id) {
            return res.redirect('/admin/hotspot/list-voucher?error=Pilih+NAS+(router)+terlebih+dahulu');
        }
        const db = new sqlite3.Database('./data/billing.db');
        const routerObj = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row || null);
            });
        });
        if (!routerObj) {
            return res.redirect('/admin/hotspot/list-voucher?error=Router+tidak+ditemukan');
        }
        // Delete old user and add new one (Mikrotik doesn't have direct edit for hotspot user)
        const { deleteHotspotUser, addHotspotUser } = require('../config/mikrotik');
        await deleteHotspotUser(originalUsername || username, routerObj);
        await addHotspotUser(username, password, profile, null, null, routerObj);
        res.redirect('/admin/hotspot/list-voucher?success=User+Hotspot+berhasil+diupdate');
    } catch (error) {
        res.redirect('/admin/hotspot/list-voucher?error=Gagal+update+user:+' + encodeURIComponent(error.message));
    }
});

// POST: Generate user hotspot voucher
router.post('/generate', async (req, res) => {
    const jumlah = parseInt(req.body.jumlah) || 10;
    const profile = req.body.profile || 'default';
    const panjangPassword = parseInt(req.body.panjangPassword) || 6;
    const generated = [];

    // Ambil nama hotspot dan nomor admin dari settings.json
    const settings = getSettingsWithCache();
    const namaHotspot = settings.company_header || 'HOTSPOT VOUCHER';
    const adminKontak = settings['admins.0'] || '-';

    // Fungsi pembuat string random
    function randomString(length) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let str = '';
        for (let i = 0; i < length; i++) {
            str += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return str;
    }

    // Generate user dan tambahkan ke Mikrotik
    const { addHotspotUser } = require('../config/mikrotik');
    for (let i = 0; i < jumlah; i++) {
        const username = randomString(6) + randomString(2); // 8 karakter unik
        const password = randomString(panjangPassword);
        try {
            await addHotspotUser(username, password, profile);
            generated.push({ username, password, profile });
        } catch (e) {
            // Lewati user gagal
        }
    }

    // Render voucher dalam grid 4 baris per A4
    res.render('voucherHotspot', {
        vouchers: generated,
        namaHotspot,
        adminKontak,
        profile,
    });
});

// POST: Generate user hotspot vouchers (JSON response)
router.post('/generate-vouchers', async (req, res) => {
    const { quantity, length, profile, type, charType, router_id, price, voucherModel } = req.body;

    try {
        // Fetch router object if router_id is provided
        let routerObj = null;
        if (router_id) {
            const db = new sqlite3.Database('./data/billing.db');
            routerObj = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row || null);
                });
            });
            if (!routerObj) {
                return res.status(400).json({
                    success: false,
                    message: 'Router/NAS tidak ditemukan'
                });
            }
        }
        
        // Gunakan fungsi generateHotspotVouchers dengan parameter yang benar
        const count = parseInt(quantity) || parseInt(req.body.count) || 5;
        const prefix = req.body.prefix || 'wifi-'; // Default prefix
        const server = 'all'; // Default server
        const validity = req.body.validity || '';
        const uptime = req.body.uptime || '';
        const voucherPrice = price || req.body.price || '';
        const charTypeValue = charType || req.body.charType || 'alphanumeric';
        
        const result = await generateHotspotVouchers(count, prefix, profile, server, validity, uptime, voucherPrice, charTypeValue, routerObj);
        
        if (result.success) {
            res.json({ 
                success: true, 
                vouchers: result.vouchers,
                router: routerObj ? { name: routerObj.name, ip: routerObj.nas_ip } : null
            });
        } else {
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error in generate-vouchers:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Get active hotspot users count for statistics
router.get('/active-users', async (req, res) => {
    try {
        const result = await getActiveHotspotUsers();
        if (result.success) {
            // Hitung jumlah user yang aktif dari data array
            const activeCount = Array.isArray(result.data) ? result.data.length : 0;
            res.json({ success: true, activeUsers: activeCount, activeUsersList: result.data });
        } else {
            console.error('Failed to get active hotspot users:', result.message);
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error getting active hotspot users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Get active hotspot users detail for table
router.get('/active-users-detail', async (req, res) => {
    try {
        const result = await getActiveHotspotUsers();
        if (result.success) {
            res.json({ success: true, activeUsers: result.data });
        } else {
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error getting active hotspot users detail:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST: Disconnect hotspot user
router.post('/disconnect-user', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username diperlukan' });
    }
    
    try {
        const result = await disconnectHotspotUser(username);
        if (result.success) {
            res.json({ success: true, message: `User ${username} berhasil diputus` });
        } else {
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error disconnecting hotspot user:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Ambil data user hotspot aktif untuk AJAX
router.get('/active-users', async (req, res) => {
    try {
        const result = await getActiveHotspotUsers();
        if (result.success) {
            // Log data untuk debugging
            console.log('Active users data:', JSON.stringify(result.data).substring(0, 200) + '...');
            res.json({ success: true, activeUsersList: result.data });
        } else {
            console.error('Failed to get active users:', result.message);
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error getting active hotspot users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Tampilkan halaman voucher hotspot
router.get('/voucher', async (req, res) => {
    try {
        // Fetch routers from database
        const db = new sqlite3.Database('./data/billing.db');
        const routers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Aggregate profiles from all NAS
        let profiles = [];
        for (const router of routers) {
            try {
                const profilesResult = await getHotspotProfiles(router);
                if (profilesResult.success && Array.isArray(profilesResult.data)) {
                    profilesResult.data.forEach(prof => {
                        const existing = profiles.find(p => p.name === prof.name && p.nas_id === router.id);
                        if (!existing) {
                            profiles.push({
                                ...prof,
                                nas_id: router.id,
                                nas_name: router.name,
                                nas_ip: router.nas_ip
                            });
                        }
                    });
                }
            } catch (e) {
                console.error(`Error getting profiles from ${router.name}:`, e.message);
            }
        }
        
        // Aggregate servers from all NAS
        let servers = [];
        for (const router of routers) {
            try {
                const serversResult = await getHotspotServers(router);
                if (serversResult.success && Array.isArray(serversResult.data)) {
                    servers = servers.concat(serversResult.data);
                }
            } catch (e) {
                console.error(`Error getting servers from ${router.name}:`, e.message);
            }
        }
        
        // Aggregate all hotspot users from all NAS for voucher history
        let allUsers = [];
        const activeUsernames = [];
        
        for (const router of routers) {
            try {
                const conn = await getMikrotikConnectionForRouter(router);
                const users = await conn.write('/ip/hotspot/user/print');
                allUsers = allUsers.concat(users.map(u => ({
                    name: u.name || '',
                    password: u.password || '',
                    profile: u.profile || 'default',
                    server: u.server || 'all',
                    comment: u.comment || '',
                    nas_id: router.id,
                    nas_name: router.name,
                    nas_ip: router.nas_ip
                })));
                
                // Get active users from this router
                const activeResult = await getActiveHotspotUsers(router);
                if (activeResult.success && Array.isArray(activeResult.data)) {
                    activeResult.data.forEach(user => {
                        activeUsernames.push(user.user || user.name || '');
                    });
                }
            } catch (e) {
                console.error(`Error getting users from ${router.name}:`, e.message);
            }
        }
        
        // Filter hanya voucher (berdasarkan prefix atau kriteria lain)
        const voucherHistory = allUsers.filter(user => 
            user.name && (user.name.startsWith('wifi-') || user.comment === 'voucher')
        ).map(user => ({
            username: user.name || '',
            password: user.password || '',
            profile: user.profile || 'default',
            server: user.server || 'all',
            createdAt: new Date(),
            active: activeUsernames.includes(user.name),
            comment: user.comment || '',
            nas_id: user.nas_id,
            nas_name: user.nas_name,
            nas_ip: user.nas_ip
        }));
        
        console.log(`Loaded ${voucherHistory.length} vouchers for history table`);
        
        // Ambil pengaturan dari settings.json
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminKontak = settings['footer_info'] || '-';
        
        db.close();

        res.render('adminVoucher', {
            profiles,
            servers,
            voucherHistory,
            routers,
            success: req.query.success,
            error: req.query.error,
            company_header,
            adminKontak,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        console.error('Error rendering voucher page:', error);
        res.render('adminVoucher', {
            profiles: [],
            servers: [],
            voucherHistory: [],
            routers: [],
            success: null,
            error: 'Gagal memuat halaman voucher: ' + error.message,
            settings: getSettingsWithCache(),
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    }
});

// POST: Generate voucher dengan JSON response
router.post('/generate-voucher', async (req, res) => {
    try {
        // Log request untuk debugging
        console.log('Generate voucher request:', req.body);
        
        const count = parseInt(req.body.count) || 5;
        const prefix = req.body.prefix || 'wifi-';
        const profile = req.body.profile || 'default';
        const router_id = req.body.router_id || req.body.routerId;
        const server = req.body.server || 'all';
        const validity = req.body.validity || '';
        const uptime = req.body.uptime || '';
        const price = req.body.price || '';
        const voucherModel = req.body.voucherModel || 'standard';
        const charType = req.body.charType || 'alphanumeric';
        
        // Validasi router_id harus ada
        if (!router_id) {
            return res.status(400).json({
                success: false,
                message: 'Router/NAS harus dipilih'
            });
        }
        
        // Fetch router object dari database routers
        const db = new sqlite3.Database('./data/billing.db');
        const routerObj = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                db.close();
                if (err) {
                    console.error('Error fetching router:', err);
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
        
        if (!routerObj) {
            return res.status(400).json({
                success: false,
                message: 'Router/NAS tidak ditemukan di database'
            });
        }
        
        console.log('Router selected:', routerObj.name, routerObj.nas_ip);
        console.log('Parsed values:');
        console.log('- Count:', count);
        console.log('- Profile:', profile);
        console.log('- Router:', routerObj.name);
        console.log('- Price:', price);
        console.log('- CharType:', charType);
        
        // Gunakan fungsi generateHotspotVouchers dengan routerObj dari database
        const result = await generateHotspotVouchers(count, prefix, profile, server, validity, uptime, price, charType, routerObj);
        
        // Cek apakah voucher berhasil dibuat
        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: result.message || 'Gagal generate voucher',
                vouchers: []
            });
        }
        
        // Cek apakah ada voucher yang berhasil dibuat
        if (!result.vouchers || result.vouchers.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'Tidak ada voucher yang berhasil dibuat. Periksa koneksi ke Mikrotik atau pastikan profile valid.',
                vouchers: []
            });
        }
        
        // Ambil pengaturan dari settings.json
        const settings = getSettingsWithCache();
        const namaHotspot = settings.company_header || 'HOTSPOT VOUCHER';
        const adminKontak = settings['footer_info'] || '-';
        
        // Log response untuk debugging
        console.log(`Generated ${result.vouchers.length} vouchers successfully`);
        
        const response = {
            success: true,
            vouchers: result.vouchers.map(voucher => ({
                ...voucher,
                profile: profile, // Pastikan profile ada di setiap voucher
                price: price // Pastikan harga ada di setiap voucher
            })),
            server,
            profile,
            validity,
            uptime,
            price,
            voucherModel: voucherModel,
            namaHotspot,
            adminKontak
        };
        
        console.log('Response:', JSON.stringify(response));
        res.json(response);
    } catch (error) {
        console.error('Error generating vouchers:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal generate voucher: ' + error.message
        });
    }
});

// GET: Print vouchers page
router.get('/print-vouchers', async (req, res) => {
    try {
        // Ambil pengaturan dari settings.json
        const settings = getSettingsWithCache();
        const namaHotspot = settings.company_header || 'HOTSPOT VOUCHER';
        const adminKontak = settings['admins.0'] || '-';
        
        res.render('voucherHotspot', {
            vouchers: [], // Voucher akan dikirim via postMessage
            namaHotspot,
            adminKontak
        });
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// POST: Delete voucher
router.post('/delete-voucher', async (req, res) => {
    const { username, router_id } = req.body;
    if (!username) {
        return res.redirect('/admin/hotspot/voucher?error=Username+diperlukan');
    }

    try {
        let routerObj = null;
        if (router_id) {
            const db = new sqlite3.Database('./data/billing.db');
            routerObj = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row || null);
                });
            });
        }
        await deleteHotspotUser(username, routerObj);
        res.redirect('/admin/hotspot/voucher?success=Voucher+berhasil+dihapus');
    } catch (error) {
        console.error('Error deleting voucher:', error);
        res.redirect('/admin/hotspot/voucher?error=' + encodeURIComponent('Gagal menghapus voucher: ' + error.message));
    }
});

// POST: Generate manual voucher for online settings
router.post('/generate-manual-voucher', async (req, res) => {
    try {
        const { username, password, profile, router_id } = req.body;

        if (!username || !password || !profile) {
            return res.status(400).json({
                success: false,
                message: 'Username, password, dan profile harus diisi'
            });
        }

        if (!router_id) {
            return res.status(400).json({
                success: false,
                message: 'Pilih NAS (Router) terlebih dahulu'
            });
        }

        // Fetch router object
        const db = new sqlite3.Database('./data/billing.db');
        const routerObj = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row || null);
            });
        });

        if (!routerObj) {
            return res.status(400).json({
                success: false,
                message: 'Router/NAS tidak ditemukan'
            });
        }

        // Add user to Mikrotik with routerObj
        const result = await addHotspotUser(username, password, profile, 'voucher', null, routerObj);

        if (result.success) {
            res.json({
                success: true,
                message: 'Voucher manual berhasil dibuat',
                voucher: {
                    username,
                    password,
                    profile,
                    nas_name: routerObj.name,
                    nas_ip: routerObj.nas_ip
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Gagal membuat voucher: ' + (result.message || 'Unknown error')
            });
        }

    } catch (error) {
        console.error('Error generating manual voucher:', error);
        res.status(500).json({
            success: false,
            message: 'Error membuat voucher manual: ' + error.message
        });
    }
});

// POST: Generate auto voucher for online settings
router.post('/generate-auto-voucher', async (req, res) => {
    try {
        const { count, profile, router_id, numericOnly } = req.body;
        const numVouchers = parseInt(count) || 1;

        if (numVouchers > 10) {
            return res.status(400).json({
                success: false,
                message: 'Maksimal 10 voucher per generate'
            });
        }

        if (!router_id) {
            return res.status(400).json({
                success: false,
                message: 'Pilih NAS (Router) terlebih dahulu'
            });
        }

        // Fetch router object
        const db = new sqlite3.Database('./data/billing.db');
        const routerObj = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
                db.close();
                if (err) reject(err);
                else resolve(row || null);
            });
        });

        if (!routerObj) {
            return res.status(400).json({
                success: false,
                message: 'Router/NAS tidak ditemukan'
            });
        }

        const generatedVouchers = [];

        // Function to generate random string
        function randomString(length, numeric = false) {
            const chars = numeric ? '0123456789' : 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let str = '';
            for (let i = 0; i < length; i++) {
                str += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return str;
        }

        // Generate vouchers
        for (let i = 0; i < numVouchers; i++) {
            let username, password;

            if (numericOnly) {
                // Username dan password sama, angka saja
                const randomNum = randomString(8, true);
                username = randomNum;
                password = randomNum;
            } else {
                // Username dan password berbeda
                username = randomString(6) + randomString(2);
                password = randomString(8);
            }

            try {
                const result = await addHotspotUser(username, password, profile, 'voucher', null, routerObj);
                if (result.success) {
                    generatedVouchers.push({
                        username,
                        password,
                        profile,
                        nas_name: routerObj.name,
                        nas_ip: routerObj.nas_ip
                    });
                }
            } catch (e) {
                console.error(`Failed to create voucher ${i + 1}:`, e.message);
            }
        }

        res.json({
            success: true,
            message: `${generatedVouchers.length} voucher otomatis berhasil dibuat`,
            vouchers: generatedVouchers
        });

    } catch (error) {
        console.error('Error generating auto voucher:', error);
        res.status(500).json({
            success: false,
            message: 'Error membuat voucher otomatis: ' + error.message
        });
    }
});

// POST: Reset setting voucher online ke profile pertama
router.post('/reset-voucher-online-settings', async (req, res) => {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Get first available profile from Mikrotik
        const { getHotspotProfiles } = require('../config/mikrotik');
        const profilesResult = await getHotspotProfiles();
        const defaultProfile = (profilesResult.success && profilesResult.data && profilesResult.data.length > 0) 
            ? profilesResult.data[0].name 
            : 'default';

        // Update all packages to use first profile
        const packages = ['3k', '5k', '10k', '15k', '25k', '50k'];
        const updatePromises = packages.map(packageId => {
            return new Promise((resolve, reject) => {
                db.run(
                    'UPDATE voucher_online_settings SET profile = ? WHERE package_id = ?',
                    [defaultProfile, packageId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        });

        await Promise.all(updatePromises);
        db.close();

        res.json({
            success: true,
            message: `Setting voucher online berhasil direset ke profile: ${defaultProfile}`,
            defaultProfile: defaultProfile
        });

    } catch (error) {
        console.error('Error resetting voucher online settings:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal reset setting voucher online: ' + error.message
        });
    }
});

// POST: Save voucher online settings
router.post('/save-voucher-online-settings', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data tidak valid'
            });
        }

        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Ensure voucher_online_settings table exists
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS voucher_online_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    package_id TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL DEFAULT '',
                    profile TEXT NOT NULL,
                    digits INTEGER NOT NULL DEFAULT 5,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Update settings for each package
        const promises = Object.keys(settings).map(packageId => {
            const setting = settings[packageId];
            return new Promise((resolve, reject) => {
                const sql = `
                    INSERT OR REPLACE INTO voucher_online_settings
                    (package_id, name, profile, digits, enabled, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                `;
                db.run(sql, [packageId, setting.name || `${packageId} - Paket`, setting.profile, setting.digits || 5, setting.enabled ? 1 : 0], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        await Promise.all(promises);

        db.close();

        res.json({
            success: true,
            message: 'Setting voucher online berhasil disimpan'
        });

    } catch (error) {
        console.error('Error saving voucher online settings:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menyimpan setting voucher online: ' + error.message
        });
    }
});

// POST: Save voucher generation settings
router.post('/save-voucher-generation-settings', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data tidak valid'
            });
        }

        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Ensure voucher_generation_settings table exists
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS voucher_generation_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    setting_key TEXT NOT NULL UNIQUE,
                    setting_value TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Update settings
        const promises = Object.keys(settings).map(key => {
            return new Promise((resolve, reject) => {
                const sql = `
                    INSERT OR REPLACE INTO voucher_generation_settings
                    (setting_key, setting_value, updated_at)
                    VALUES (?, ?, datetime('now'))
                `;
                db.run(sql, [key, settings[key]], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        await Promise.all(promises);
        db.close();

        res.json({
            success: true,
            message: 'Pengaturan generate voucher berhasil disimpan'
        });

    } catch (error) {
        console.error('Error saving voucher generation settings:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menyimpan pengaturan: ' + error.message
        });
    }
});

// POST: Test voucher generation
router.post('/test-voucher-generation', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data tidak valid'
            });
        }

        // Generate test voucher based on settings
        const { generateTestVoucher } = require('../config/mikrotik');
        const result = await generateTestVoucher(settings);

        if (result.success) {
            res.json({
                success: true,
                username: result.username,
                password: result.password,
                message: 'Test generate voucher berhasil'
            });
        } else {
            res.json({
                success: false,
                message: result.message
            });
        }

    } catch (error) {
        console.error('Error testing voucher generation:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal test generate voucher: ' + error.message
        });
    }
});

// ============================================
// FUNGSI HELPER UNTUK VOUCHER DATA MANAGEMENT
// ============================================

// Helper function untuk parse waktu ke detik (format: "10m", "1h", "60m", "0d 00:00:00", dll)
function parseTimeToSeconds(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    
    let totalSeconds = 0;
    const timeStrLower = timeStr.toLowerCase().trim();
    
    // Cek format "0d 00:00:00" atau "0d00:00:00" (format Mikrotik saat validity habis)
    if (timeStrLower === '0d 00:00:00' || timeStrLower === '0d00:00:00' || timeStrLower === '0d' || timeStrLower === '00:00:00') {
        return 0;
    }
    
    // Parse format HH:MM:SS (contoh: "00:00:00", "01:30:45")
    const timeMatch = timeStrLower.match(/(\d+):(\d+):(\d+)/);
    if (timeMatch) {
        const hours = parseInt(timeMatch[1]) || 0;
        const minutes = parseInt(timeMatch[2]) || 0;
        const secs = parseInt(timeMatch[3]) || 0;
        totalSeconds = hours * 3600 + minutes * 60 + secs;
        // Jika ada "d" sebelum waktu, tambahkan hari
        const dayMatch = timeStrLower.match(/(\d+)d/);
        if (dayMatch) {
            totalSeconds += parseInt(dayMatch[1]) * 86400;
        }
        return totalSeconds;
    }
    
    // Parse format: "10m", "1h", "60m", "1d", dll
    const days = timeStrLower.match(/(\d+)d/);
    const hours = timeStrLower.match(/(\d+)h/);
    const minutes = timeStrLower.match(/(\d+)m/);
    const seconds = timeStrLower.match(/(\d+)s/);
    
    if (days) totalSeconds += parseInt(days[1]) * 86400;
    if (hours) totalSeconds += parseInt(hours[1]) * 3600;
    if (minutes) totalSeconds += parseInt(minutes[1]) * 60;
    if (seconds) totalSeconds += parseInt(seconds[1]);
    
    // Jika tidak ada format, coba parse sebagai angka (detik)
    if (totalSeconds === 0) {
        const num = parseInt(timeStr);
        if (!isNaN(num)) totalSeconds = num;
    }
    
    return totalSeconds;
}

// Fungsi untuk inisialisasi tabel voucher_data
function initVoucherDataTable() {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');
    
    db.run(`
        CREATE TABLE IF NOT EXISTS voucher_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            voucher_code TEXT NOT NULL UNIQUE,
            first_login INTEGER,
            total_usage INTEGER DEFAULT 0,
            remaining_time INTEGER DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'used')),
            nas_id INTEGER,
            nas_name TEXT,
            nas_ip TEXT,
            profile TEXT,
            uptime_limit INTEGER,
            validity_limit INTEGER,
            last_usage_update_time DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating voucher_data table:', err);
        } else {
            console.log('Voucher data table ready');
            
            // Cek apakah kolom last_usage_update_time sudah ada
            db.all("PRAGMA table_info(voucher_data)", (pragmaErr, columns) => {
                if (pragmaErr) {
                    console.error('Error checking table info:', pragmaErr);
                    db.close();
                    return;
                }
                
                const hasLastUsageUpdateTime = columns.some(col => col.name === 'last_usage_update_time');
                
                if (!hasLastUsageUpdateTime) {
                    // Tambahkan kolom last_usage_update_time jika belum ada
                    db.run(`
                        ALTER TABLE voucher_data 
                        ADD COLUMN last_usage_update_time DATETIME
                    `, (alterErr) => {
                        if (alterErr) {
                            console.error('Error adding last_usage_update_time column:', alterErr);
                        } else {
                            console.log('✅ Column last_usage_update_time added to voucher_data table');
                        }
                        db.close();
                    });
                } else {
                    console.log('Column last_usage_update_time already exists');
                    db.close();
                }
            });
        }
    });
    
    // Create indexes (dilakukan setelah tabel dibuat)
    setTimeout(() => {
        const dbIndex = new sqlite3.Database('./data/billing.db');
        dbIndex.run(`CREATE INDEX IF NOT EXISTS idx_voucher_data_code ON voucher_data(voucher_code)`, () => {});
        dbIndex.run(`CREATE INDEX IF NOT EXISTS idx_voucher_data_status ON voucher_data(status)`, () => {});
        dbIndex.run(`CREATE INDEX IF NOT EXISTS idx_voucher_data_nas_id ON voucher_data(nas_id)`, () => {});
        dbIndex.run(`CREATE INDEX IF NOT EXISTS idx_voucher_data_first_login ON voucher_data(first_login)`, () => {
            dbIndex.close();
        });
    }, 500);
}

// Fungsi untuk membuat atau update voucher data saat generate
async function createOrUpdateVoucherData(voucherCode, nasId, nasName, nasIp, profile, uptimeLimit, validityLimit, price = 0) {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');
    
    return new Promise((resolve, reject) => {
        // Parse uptime dan validity ke detik
        const uptimeSeconds = parseTimeToSeconds(uptimeLimit || '0');
        const validitySeconds = parseTimeToSeconds(validityLimit || '0');
        const voucherPrice = parseFloat(price) || 0;
        
        // Helper function untuk menutup database dengan aman
        const closeDb = () => {
            try {
                if (db && typeof db.close === 'function') {
                    db.close((closeErr) => {
                        if (closeErr) {
                            console.error('Error closing database:', closeErr);
                        }
                    });
                }
            } catch (e) {
                console.error('Error in closeDb:', e);
            }
        };
        
        // Cek apakah kolom last_usage_update_time dan price ada, jika tidak tambahkan
        db.all("PRAGMA table_info(voucher_data)", (pragmaErr, columns) => {
            if (pragmaErr) {
                console.error('Error checking table info:', pragmaErr);
                closeDb();
                reject(pragmaErr);
                return;
            }
            
            const hasLastUsageUpdateTime = columns.some(col => col.name === 'last_usage_update_time');
            const hasPrice = columns.some(col => col.name === 'price');
            
            // Fungsi untuk melakukan INSERT setelah semua alter selesai
            const performInsert = () => {
                db.run(`
                    INSERT OR REPLACE INTO voucher_data 
                    (voucher_code, nas_id, nas_name, nas_ip, profile, uptime_limit, validity_limit, 
                     remaining_time, status, first_login, total_usage, last_usage_update_time, price, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, 0, NULL, ?, CURRENT_TIMESTAMP)
                `, [
                    voucherCode,
                    nasId,
                    nasName,
                    nasIp,
                    profile,
                    uptimeSeconds,
                    validitySeconds,
                    uptimeSeconds, // remaining_time awal = uptime_limit
                    voucherPrice
                ], function(err) {
                    if (err) {
                        console.error('Error creating/updating voucher data:', err);
                        closeDb();
                        reject(err);
                    } else {
                        closeDb();
                        resolve({ success: true, id: this.lastID });
                    }
                });
            };
            
            // Jika semua kolom sudah ada, langsung INSERT
            if (hasLastUsageUpdateTime && hasPrice) {
                performInsert();
                return;
            }
            
            // Lakukan ALTER TABLE secara sequential untuk menghindari race condition
            const alterOperations = [];
            
            if (!hasLastUsageUpdateTime) {
                alterOperations.push(() => {
                    return new Promise((resolveAlter, rejectAlter) => {
                        db.run(`
                            ALTER TABLE voucher_data 
                            ADD COLUMN last_usage_update_time DATETIME
                        `, (alterErr) => {
                            if (alterErr && !alterErr.message.includes('duplicate column') && !alterErr.message.includes('already exists')) {
                                console.error('Error adding last_usage_update_time column:', alterErr);
                                rejectAlter(alterErr);
                            } else {
                                if (!alterErr) console.log('✅ Column last_usage_update_time added to voucher_data table');
                                resolveAlter();
                            }
                        });
                    });
                });
            }
            
            if (!hasPrice) {
                alterOperations.push(() => {
                    return new Promise((resolveAlter, rejectAlter) => {
                        db.run(`
                            ALTER TABLE voucher_data 
                            ADD COLUMN price DECIMAL(10,2) DEFAULT 0.00
                        `, (alterErr) => {
                            if (alterErr && !alterErr.message.includes('duplicate column') && !alterErr.message.includes('already exists')) {
                                console.error('Error adding price column:', alterErr);
                                rejectAlter(alterErr);
                            } else {
                                if (!alterErr) console.log('✅ Column price added to voucher_data table');
                                resolveAlter();
                            }
                        });
                    });
                });
            }
            
            // Jalankan alter operations secara sequential
            let alterPromise = Promise.resolve();
            alterOperations.forEach(alterOp => {
                alterPromise = alterPromise.then(() => alterOp());
            });
            
            alterPromise
                .then(() => {
                    performInsert();
                })
                .catch((alterErr) => {
                    console.error('Error in alter operations:', alterErr);
                    closeDb();
                    reject(alterErr);
                });
        });
    });
}

// Fungsi untuk mendapatkan voucher data
async function getVoucherData(voucherCode) {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');
    
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM voucher_data WHERE voucher_code = ?', [voucherCode], (err, row) => {
            db.close();
            if (err) {
                reject(err);
            } else {
                resolve(row || null);
            }
        });
    });
}

// Fungsi untuk mengecek validity dari Mikrotik user
async function checkMikrotikValidity(username, routerObj) {
    try {
        const conn = await getMikrotikConnectionForRouter(routerObj);
        const users = await conn.write('/ip/hotspot/user/print', [
            '?name=' + username
        ]);
        
        if (!users || users.length === 0) {
            return { valid: false, message: 'User tidak ditemukan di Mikrotik' };
        }
        
        const user = users[0];
        const limitUptime = user['limit-uptime'] || '';
        
        // Jika tidak ada limit-uptime, voucher tidak memiliki validity
        if (!limitUptime || limitUptime === '' || limitUptime === 'Unlimited') {
            return { valid: true, message: 'Voucher tidak memiliki validity limit' };
        }
        
        // Parse limit-uptime ke detik
        const limitSeconds = parseTimeToSeconds(limitUptime);
        
        // Cek apakah limit-uptime sudah habis (0 detik)
        if (limitSeconds <= 0) {
            return { valid: false, message: 'Validity sudah habis (0d 00:00:00)' };
        }
        
        // Cek apakah user sudah disabled
        const isDisabled = user.disabled === 'true' || user.disabled === true;
        if (isDisabled) {
            return { valid: false, message: 'User sudah dinonaktifkan' };
        }
        
        return { valid: true, limitSeconds: limitSeconds, limitUptime: limitUptime };
    } catch (error) {
        console.error(`Error checking Mikrotik validity for ${username}:`, error);
        return { valid: true, message: 'Error checking validity, allow login' }; // Default allow jika error
    }
}

// Fungsi untuk menangani login voucher (cek masa aktif dan set uptime-limit)
async function handleVoucherLogin(voucherCode, routerObj) {
    try {
        // Cek validity dari Mikrotik terlebih dahulu
        const mikrotikValidity = await checkMikrotikValidity(voucherCode, routerObj);
        if (!mikrotikValidity.valid) {
            // Validity sudah habis di Mikrotik, nonaktifkan user
            try {
                const { disableHotspotUser } = require('../config/mikrotik');
                await disableHotspotUser(voucherCode, routerObj);
                console.log(`[Voucher Login] Validity habis untuk ${voucherCode}, user dinonaktifkan`);
            } catch (e) {
                console.error('Error disabling voucher user:', e);
            }
            return { success: false, allow: false, message: mikrotikValidity.message || 'Validity sudah habis' };
        }
        
        const voucherData = await getVoucherData(voucherCode);
        
        if (!voucherData) {
            // Voucher tidak ada di database, cek dari Mikrotik saja
            // Jika limit-uptime sudah habis, tolak login
            if (mikrotikValidity.limitSeconds !== undefined && mikrotikValidity.limitSeconds <= 0) {
                return { success: false, allow: false, message: 'Validity sudah habis' };
            }
            return { success: true, allow: true, message: 'Voucher tidak terdaftar di sistem' };
        }
        
        const now = Math.floor(Date.now() / 1000); // Unix timestamp
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');
        
        // Jika status expired atau used, tolak login
        if (voucherData.status === 'expired' || voucherData.status === 'used') {
            db.close();
            return { success: false, allow: false, message: 'Voucher sudah expired atau digunakan' };
        }
        
        // Cek masa aktif 60 menit (validity_limit)
        if (voucherData.first_login) {
            const elapsedSinceFirstLogin = now - voucherData.first_login;
            
            if (elapsedSinceFirstLogin > voucherData.validity_limit) {
                // Masa aktif lewat, expire voucher
                db.run(`
                    UPDATE voucher_data 
                    SET status = 'expired', updated_at = CURRENT_TIMESTAMP 
                    WHERE voucher_code = ?
                `, [voucherCode], () => {
                    db.close();
                });
                
                // Disable user di Mikrotik
                try {
                    const { disableHotspotUser } = require('../config/mikrotik');
                    await disableHotspotUser(voucherCode, routerObj);
                } catch (e) {
                    console.error('Error disabling voucher user:', e);
                }
                
                return { success: false, allow: false, message: 'Voucher sudah expired (masa aktif lewat)' };
            }
        }
        
        // Cek sisa waktu
        if (voucherData.remaining_time <= 0) {
            db.run(`
                UPDATE voucher_data 
                SET status = 'used', updated_at = CURRENT_TIMESTAMP 
                WHERE voucher_code = ?
            `, [voucherCode], () => {
                db.close();
            });
            
            return { success: false, allow: false, message: 'Waktu pemakaian sudah habis' };
        }
        
        // Jika login pertama, simpan first_login
        if (!voucherData.first_login) {
            db.run(`
                UPDATE voucher_data 
                SET first_login = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE voucher_code = ?
            `, [now, voucherCode], () => {
                db.close();
            });
        } else {
            db.close();
        }
        
        // Set uptime-limit di Mikrotik sesuai sisa waktu
        try {
            const conn = await getMikrotikConnectionForRouter(routerObj);
            const remainingTimeStr = voucherData.remaining_time + 's';
            
            // Cari user hotspot dulu untuk mendapatkan .id
            const users = await conn.write('/ip/hotspot/user/print', [
                '?name=' + voucherCode
            ]);
            
            if (users && users.length > 0) {
                await conn.write('/ip/hotspot/user/set', [
                    '=.id=' + users[0]['.id'],
                    '=uptime-limit=' + remainingTimeStr
                ]);
                
                console.log(`[Voucher Login] Set uptime-limit untuk ${voucherCode}: ${remainingTimeStr}`);
            } else {
                console.error(`[Voucher Login] User ${voucherCode} tidak ditemukan di Mikrotik`);
            }
        } catch (e) {
            console.error('Error setting uptime-limit:', e);
        }
        
        return { success: true, allow: true, message: 'Login diizinkan', remaining_time: voucherData.remaining_time };
    } catch (error) {
        console.error('Error in handleVoucherLogin:', error);
        return { success: false, allow: false, message: 'Error: ' + error.message };
    }
}

// Fungsi untuk update total pemakaian dan remaining_time
// CATATAN: Fungsi ini sekarang tidak digunakan langsung, 
// karena perhitungan dilakukan langsung di monitorVoucherLoginLogout
// untuk menghindari double-count. Fungsi ini tetap ada untuk backward compatibility.
async function updateVoucherUsage(voucherCode, sessionUptimeSeconds) {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');
    
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM voucher_data WHERE voucher_code = ?', [voucherCode], (err, voucherData) => {
            if (err) {
                db.close();
                reject(err);
                return;
            }
            
            if (!voucherData) {
                db.close();
                resolve({ success: false, message: 'Voucher tidak ditemukan' });
                return;
            }
            
            // Hitung total pemakaian baru (akumulatif)
            const newTotalUsage = voucherData.total_usage + sessionUptimeSeconds;
            const newRemainingTime = Math.max(0, voucherData.uptime_limit - newTotalUsage);
            
            // Update database
            db.run(`
                UPDATE voucher_data 
                SET total_usage = ?, 
                    remaining_time = ?,
                    status = CASE 
                        WHEN ? <= 0 THEN 'used'
                        ELSE status
                    END,
                    updated_at = CURRENT_TIMESTAMP 
                WHERE voucher_code = ?
            `, [newTotalUsage, newRemainingTime, newRemainingTime, voucherCode], function(updateErr) {
                if (updateErr) {
                    db.close();
                    reject(updateErr);
                } else {
                    db.close();
                    resolve({ 
                        success: true, 
                        total_usage: newTotalUsage, 
                        remaining_time: newRemainingTime 
                    });
                }
            });
        });
    });
}

// Fungsi untuk menyimpan waktu login voucher ke database
async function saveVoucherLogin(username, nasId, nasName, nasIp, loginTime, sessionData = {}) {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');
    
    return new Promise((resolve, reject) => {
        // Pastikan tabel ada
        db.run(`
            CREATE TABLE IF NOT EXISTS voucher_login_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                nas_id INTEGER,
                nas_name TEXT,
                nas_ip TEXT,
                login_time DATETIME NOT NULL,
                logout_time DATETIME,
                is_active INTEGER NOT NULL DEFAULT 1,
                session_uptime TEXT,
                bytes_in INTEGER DEFAULT 0,
                bytes_out INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                console.error('Error creating voucher_login_history table:', err);
                db.close();
                reject(err);
                return;
            }
            
            // Cek apakah ada session aktif untuk user ini
            db.get(`
                SELECT id FROM voucher_login_history 
                WHERE username = ? AND nas_id = ? AND is_active = 1
            `, [username, nasId], (err, row) => {
                if (err) {
                    console.error('Error checking active session:', err);
                    db.close();
                    reject(err);
                    return;
                }
                
                if (row) {
                    // Update session yang sudah ada (jika login lagi)
                    db.run(`
                        UPDATE voucher_login_history 
                        SET login_time = ?, 
                            session_uptime = ?,
                            bytes_in = ?,
                            bytes_out = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `, [
                        loginTime,
                        sessionData.uptime || '',
                        sessionData.bytes_in || 0,
                        sessionData.bytes_out || 0,
                        row.id
                    ], (err) => {
                        if (err) {
                            console.error('Error updating login history:', err);
                            db.close();
                            reject(err);
                        } else {
                            db.close();
                            resolve({ success: true, action: 'updated', id: row.id });
                        }
                    });
                } else {
                    // Insert session baru
                    db.run(`
                        INSERT INTO voucher_login_history 
                        (username, nas_id, nas_name, nas_ip, login_time, is_active, session_uptime, bytes_in, bytes_out)
                        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
                    `, [
                        username,
                        nasId,
                        nasName,
                        nasIp,
                        loginTime,
                        sessionData.uptime || '',
                        sessionData.bytes_in || 0,
                        sessionData.bytes_out || 0
                    ], function(err) {
                        if (err) {
                            console.error('Error inserting login history:', err);
                            db.close();
                            reject(err);
                        } else {
                            db.close();
                            resolve({ success: true, action: 'inserted', id: this.lastID });
                        }
                    });
                }
            });
        });
    });
}

// Fungsi untuk menyimpan waktu logout voucher ke database
async function saveVoucherLogout(username, nasId, logoutTime) {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');
    
    return new Promise(async (resolve, reject) => {
        // Ambil session aktif untuk menghitung pemakaian
        db.get(`
            SELECT * FROM voucher_login_history 
            WHERE username = ? AND nas_id = ? AND is_active = 1
        `, [username, nasId], async (err, session) => {
            if (err) {
                console.error('Error getting session for logout:', err);
                db.close();
                reject(err);
                return;
            }
            
            if (!session) {
                // Tidak ada session aktif, langsung update logout
                db.run(`
                    UPDATE voucher_login_history 
                    SET logout_time = ?, 
                        is_active = 0,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE username = ? AND nas_id = ? AND is_active = 1
                `, [logoutTime, username, nasId], function(updateErr) {
                    if (updateErr) {
                        console.error('Error updating logout history:', updateErr);
                        db.close();
                        reject(updateErr);
                    } else {
                        db.close();
                        resolve({ success: true, affectedRows: this.changes });
                    }
                });
                return;
            }
            
            // Hitung durasi session dalam detik
            const loginTime = new Date(session.login_time).getTime();
            const logoutTimeMs = new Date(logoutTime).getTime();
            const sessionDurationSeconds = Math.floor((logoutTimeMs - loginTime) / 1000);
            
            // Update voucher_data dengan total pemakaian
            try {
                const voucherData = await getVoucherData(username);
                if (voucherData) {
                    // Hitung pemakaian tambahan sejak last_usage_update_time
                    let additionalUsage = sessionDurationSeconds;
                    
                    if (voucherData.last_usage_update_time) {
                        const lastUpdateMs = new Date(voucherData.last_usage_update_time).getTime();
                        additionalUsage = Math.floor((logoutTimeMs - lastUpdateMs) / 1000);
                    }
                    
                    const newTotalUsage = voucherData.total_usage + Math.max(0, additionalUsage);
                    const newRemainingTime = Math.max(0, voucherData.uptime_limit - newTotalUsage);
                    
                    // Update database
                    const sqlite3 = require('sqlite3').verbose();
                    const updateDb = new sqlite3.Database('./data/billing.db');
                    updateDb.run(`
                        UPDATE voucher_data 
                        SET total_usage = ?, 
                            remaining_time = ?,
                            last_usage_update_time = ?,
                            status = CASE 
                                WHEN ? <= 0 THEN 'used'
                                ELSE status
                            END,
                            updated_at = CURRENT_TIMESTAMP 
                        WHERE voucher_code = ?
                    `, [newTotalUsage, newRemainingTime, logoutTime, newRemainingTime, username], (updateErr) => {
                        updateDb.close();
                        if (updateErr) {
                            console.error('Error updating voucher usage on logout:', updateErr);
                        }
                    });
                }
            } catch (usageErr) {
                console.error('Error updating voucher usage:', usageErr);
                // Lanjutkan proses logout meskipun error update usage
            }
            
            // Update logout history
            db.run(`
                UPDATE voucher_login_history 
                SET logout_time = ?, 
                    is_active = 0,
                    session_uptime = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [logoutTime, sessionDurationSeconds + 's', session.id], function(updateErr) {
                if (updateErr) {
                    console.error('Error updating logout history:', updateErr);
                    db.close();
                    reject(updateErr);
                } else {
                    db.close();
                    resolve({ success: true, affectedRows: this.changes, session_duration: sessionDurationSeconds });
                }
            });
        });
    });
}

// Fungsi untuk mendapatkan history login/logout voucher dari database
async function getVoucherLoginHistory(username, nasId = null) {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');
    
    return new Promise((resolve, reject) => {
        let sql = `
            SELECT * FROM voucher_login_history 
            WHERE username = ?
        `;
        let params = [username];
        
        if (nasId) {
            sql += ` AND nas_id = ?`;
            params.push(nasId);
        }
        
        sql += ` ORDER BY login_time DESC LIMIT 1`;
        
        db.get(sql, params, (err, row) => {
            if (err) {
                console.error('Error getting login history:', err);
                db.close();
                reject(err);
            } else {
                db.close();
                resolve(row || null);
            }
        });
    });
}

// Fungsi untuk mendapatkan waktu dari Mikrotik router (lebih akurat)
async function getMikrotikTime(conn) {
    try {
        const clock = await conn.write('/system/clock/print');
        if (clock && clock.length > 0) {
            const clockData = clock[0];
            const date = clockData.date || '';
            const time = clockData.time || '';
            
            // Format: date = "2025-11-20", time = "14:30:00"
            // Gabungkan menjadi format DATETIME SQLite: "2025-11-20 14:30:00"
            if (date && time) {
                return `${date} ${time}`;
            }
        }
    } catch (e) {
        console.error('Error getting Mikrotik time:', e.message);
    }
    
    // Fallback ke waktu server billing jika tidak bisa ambil dari Mikrotik
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Fungsi untuk menghitung waktu login dari uptime (jika ada)
function calculateLoginTimeFromUptime(uptimeStr, currentTime) {
    if (!uptimeStr || !currentTime) return null;
    
    // Parse uptime ke detik (format: "1d2h3m4s" atau "2h3m4s" atau "3m4s" atau "4s")
    let totalSeconds = 0;
    const days = uptimeStr.match(/(\d+)d/);
    const hoursMatch = uptimeStr.match(/(\d+)h/);
    const minutesMatch = uptimeStr.match(/(\d+)m/);
    const secondsMatch = uptimeStr.match(/(\d+)s/);
    if (days) totalSeconds += parseInt(days[1]) * 86400;
    if (hoursMatch) totalSeconds += parseInt(hoursMatch[1]) * 3600;
    if (minutesMatch) totalSeconds += parseInt(minutesMatch[1]) * 60;
    if (secondsMatch) totalSeconds += parseInt(secondsMatch[1]);
    
    if (totalSeconds === 0) return null;
    
    // Hitung waktu login = waktu sekarang - uptime
    const currentDate = new Date(currentTime);
    const loginDate = new Date(currentDate.getTime() - (totalSeconds * 1000));
    
    // Format ke DATETIME SQLite
    const year = loginDate.getFullYear();
    const month = String(loginDate.getMonth() + 1).padStart(2, '0');
    const day = String(loginDate.getDate()).padStart(2, '0');
    const hours = String(loginDate.getHours()).padStart(2, '0');
    const minutes = String(loginDate.getMinutes()).padStart(2, '0');
    const secs = String(loginDate.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${secs}`;
}

// Fungsi untuk monitoring dan update history login/logout
async function monitorVoucherLoginLogout() {
    const startTime = Date.now();
    console.log(`[Voucher Monitoring] 🚀 Memulai monitoring voucher login/logout...`);
    
    try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');
        
        // Ambil semua router
        const routers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        console.log(`[Voucher Monitoring] 📡 Ditemukan ${routers.length} router untuk dimonitor`);
        
        // Untuk setiap router, cek user aktif dan update history
        for (const router of routers) {
            try {
                // Dapatkan user aktif dari router ini
                const activeUsersResult = await getActiveHotspotUsers(router);
                const activeUsers = activeUsersResult.success ? activeUsersResult.data : [];
                const activeUsernames = activeUsers.map(u => u.user || u.name).filter(Boolean);
                
                // Dapatkan koneksi Mikrotik untuk ambil waktu
                const conn = await getMikrotikConnectionForRouter(router);
                
                // Dapatkan waktu dari Mikrotik router (lebih akurat)
                const mikrotikTime = await getMikrotikTime(conn);
                
                // Dapatkan semua user hotspot dari router ini
                const allUsers = await conn.write('/ip/hotspot/user/print');
                
                // Dapatkan history aktif dari database
                const activeHistory = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT username FROM voucher_login_history 
                        WHERE nas_id = ? AND is_active = 1
                    `, [router.id], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows.map(r => r.username));
                    });
                });
                
                // Deteksi user yang baru login (ada di activeUsers tapi tidak di activeHistory)
                const newLogins = activeUsernames.filter(u => !activeHistory.includes(u));
                for (const username of newLogins) {
                    const activeUser = activeUsers.find(au => (au.user || au.name) === username);
                    if (activeUser) {
                        // Handle voucher login (cek masa aktif dan set uptime-limit)
                        const loginResult = await handleVoucherLogin(username, router);
                        
                        if (!loginResult.allow) {
                            // Login ditolak, disconnect user
                            console.log(`[Voucher Login] Login ditolak untuk ${username}: ${loginResult.message}`);
                            try {
                                await disconnectHotspotUser(username, router);
                            } catch (e) {
                                console.error(`Error disconnecting ${username}:`, e);
                            }
                            continue;
                        }
                        
                        // Coba hitung waktu login dari uptime (lebih akurat)
                        let loginTime = calculateLoginTimeFromUptime(activeUser.uptime || activeUser['uptime'] || '', mikrotikTime);
                        
                        // Jika tidak bisa hitung dari uptime, gunakan waktu Mikrotik sekarang
                        if (!loginTime) {
                            loginTime = mikrotikTime;
                        }
                        
                        await saveVoucherLogin(
                            username,
                            router.id,
                            router.name,
                            router.nas_ip,
                            loginTime,
                            {
                                uptime: activeUser.uptime || activeUser['uptime'] || '',
                                bytes_in: activeUser['bytes-in'] || 0,
                                bytes_out: activeUser['bytes-out'] || 0
                            }
                        );
                        console.log(`[Voucher History] Login detected: ${username} on ${router.name} at ${loginTime}`);
                    }
                }
                
                // Deteksi user yang logout (ada di activeHistory tapi tidak di activeUsers)
                const newLogouts = activeHistory.filter(u => !activeUsernames.includes(u));
                for (const username of newLogouts) {
                    // Gunakan waktu Mikrotik untuk logout
                    const logoutTime = mikrotikTime;
                    await saveVoucherLogout(username, router.id, logoutTime);
                    console.log(`[Voucher History] Logout detected: ${username} on ${router.name} at ${logoutTime}`);
                }
                
                // Cek semua user hotspot untuk validity yang sudah habis
                // Cek setting untuk log Voucher Validity
                const settings = getSettingsWithCache();
                const voucherValidityLogEnabled = settings.voucher_validity_log_enabled !== false; // Default true
                
                if (voucherValidityLogEnabled) {
                    console.log(`[Voucher Validity] 🔍 Memeriksa ${allUsers.length} user hotspot pada router ${router.name}...`);
                }
                
                for (const userConfig of allUsers) {
                    const username = userConfig.name;
                    if (!username) continue;
                    
                    // Skip jika user sudah disabled
                    const isDisabled = userConfig.disabled === 'true' || userConfig.disabled === true;
                    if (isDisabled) {
                        if (voucherValidityLogEnabled) {
                            console.log(`[Voucher Validity] ⏭️ User ${username} sudah disabled, skip`);
                        }
                        continue;
                    }
                    
                    // Cek limit-uptime (validity) dari Mikrotik
                    const limitUptime = userConfig['limit-uptime'] || '';
                    
                    // Jika tidak ada limit-uptime, skip
                    if (!limitUptime || limitUptime === '' || limitUptime === 'Unlimited') {
                        continue;
                    }
                    
                    // Log untuk debugging (hanya jika enabled)
                    if (voucherValidityLogEnabled) {
                        console.log(`[Voucher Validity] 🔎 Memeriksa ${username}: limit-uptime="${limitUptime}"`);
                    }
                    
                    // Cek format "0d 00:00:00" atau "0d00:00:00" (format Mikrotik saat validity habis)
                    const limitUptimeTrimmed = limitUptime.trim();
                    const isZeroValidity = limitUptimeTrimmed === '0d 00:00:00' || 
                                         limitUptimeTrimmed === '0d00:00:00' ||
                                         limitUptimeTrimmed === '0d' ||
                                         limitUptimeTrimmed === '00:00:00' ||
                                         limitUptimeTrimmed === '0s' ||
                                         limitUptimeTrimmed === '0';
                    
                    // Parse limit-uptime ke detik
                    const limitSeconds = parseTimeToSeconds(limitUptime);
                    
                    // Cek juga dari database voucher_data (lebih akurat)
                    let isExpiredFromDatabase = false;
                    const voucherData = await getVoucherData(username);
                    if (voucherData && voucherData.first_login && voucherData.validity_limit) {
                        const now = Math.floor(Date.now() / 1000);
                        const elapsedSinceFirstLogin = now - voucherData.first_login;
                        if (elapsedSinceFirstLogin > voucherData.validity_limit) {
                            isExpiredFromDatabase = true;
                            if (voucherValidityLogEnabled) {
                                console.log(`[Voucher Validity] ⏰ ${username}: Validity habis berdasarkan database (first_login: ${voucherData.first_login}, validity_limit: ${voucherData.validity_limit}, elapsed: ${elapsedSinceFirstLogin}s)`);
                            }
                        }
                    }
                    
                    if (voucherValidityLogEnabled) {
                        console.log(`[Voucher Validity] 📊 ${username}: isZeroValidity=${isZeroValidity}, limitSeconds=${limitSeconds}, isExpiredFromDatabase=${isExpiredFromDatabase}`);
                    }
                    
                    // Jika limit-uptime sudah habis (0 detik atau negatif) ATAU validity habis berdasarkan database, hapus voucher dari Mikrotik
                    if (isZeroValidity || limitSeconds <= 0 || isExpiredFromDatabase) {
                        if (voucherValidityLogEnabled) {
                            console.log(`[Voucher Validity] ⚠️ Validity habis untuk ${username} pada router ${router.name}`);
                            console.log(`[Voucher Validity]   - limit-uptime: "${limitUptime}"`);
                            console.log(`[Voucher Validity]   - isZeroValidity: ${isZeroValidity}`);
                            console.log(`[Voucher Validity]   - limitSeconds: ${limitSeconds}`);
                            console.log(`[Voucher Validity]   - Menghapus voucher dari Mikrotik...`);
                        }
                        
                        try {
                            // Disconnect user jika sedang aktif (harus dilakukan sebelum delete)
                            try {
                                const disconnectResult = await disconnectHotspotUser(username, router);
                                if (disconnectResult && disconnectResult.success) {
                                    if (voucherValidityLogEnabled) {
                                        console.log(`[Voucher Validity] ✅ User ${username} berhasil di-disconnect`);
                                    }
                                }
                            } catch (disconnectErr) {
                                if (voucherValidityLogEnabled) {
                                    console.log(`[Voucher Validity] ℹ️ User ${username} tidak aktif atau sudah terputus: ${disconnectErr.message}`);
                                }
                            }
                            
                            // Hapus voucher dari Mikrotik
                            const deleteResult = await deleteHotspotUser(username, router);
                            
                            if (deleteResult && deleteResult.success) {
                                if (voucherValidityLogEnabled) {
                                    console.log(`[Voucher Validity] ✅ Voucher ${username} berhasil dihapus dari Mikrotik`);
                                }
                            } else {
                                if (voucherValidityLogEnabled) {
                                    console.error(`[Voucher Validity] ❌ Gagal menghapus voucher ${username}:`, deleteResult ? deleteResult.message : 'Unknown error');
                                }
                            }
                            
                            // Update voucher_data jika ada
                            const voucherData = await getVoucherData(username);
                            if (voucherData) {
                                const sqlite3 = require('sqlite3').verbose();
                                const db = new sqlite3.Database('./data/billing.db');
                                db.run(`
                                    UPDATE voucher_data 
                                    SET status = 'expired', updated_at = CURRENT_TIMESTAMP 
                                    WHERE voucher_code = ?
                                `, [username], (err) => {
                                    if (err) {
                                        if (voucherValidityLogEnabled) {
                                            console.error(`[Voucher Validity] ❌ Error updating voucher_data for ${username}:`, err);
                                        }
                                    } else {
                                        if (voucherValidityLogEnabled) {
                                            console.log(`[Voucher Validity] ✅ Status voucher_data untuk ${username} diupdate ke expired`);
                                        }
                                    }
                                    db.close();
                                });
                            } else {
                                if (voucherValidityLogEnabled) {
                                    console.log(`[Voucher Validity] ℹ️ Voucher ${username} tidak ada di tabel voucher_data`);
                                }
                            }
                        } catch (e) {
                            if (voucherValidityLogEnabled) {
                                console.error(`[Voucher Validity] ❌ Error deleting voucher ${username}:`, e);
                                console.error(`[Voucher Validity]   Stack:`, e.stack);
                            }
                        }
                    }
                }
                
                // Update session aktif yang masih online dan hitung pemakaian waktu
                for (const username of activeUsernames) {
                    const activeUser = activeUsers.find(au => (au.user || au.name) === username);
                    if (activeUser) {
                        // Cek apakah ada session aktif di database
                        const activeSession = await new Promise((resolve, reject) => {
                            db.get(`
                                SELECT * FROM voucher_login_history 
                                WHERE username = ? AND nas_id = ? AND is_active = 1
                            `, [username, router.id], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });
                        
                        if (activeSession) {
                            // Hitung durasi session dari waktu login terakhir
                            const loginTimeMs = new Date(activeSession.login_time).getTime();
                            const nowMs = new Date(mikrotikTime).getTime();
                            const sessionDurationSeconds = Math.floor((nowMs - loginTimeMs) / 1000);
                            
                            // Update pemakaian waktu voucher (hanya jika ada perubahan)
                            if (sessionDurationSeconds > 0) {
                                try {
                                    // Ambil voucher data untuk cek total_usage sebelumnya
                                    const voucherData = await getVoucherData(username);
                                    if (voucherData) {
                                        // Hitung pemakaian baru sejak login terakhir
                                        // Gunakan last_usage_update_time untuk menghindari double-count
                                        let additionalUsage = sessionDurationSeconds;
                                        
                                        if (voucherData.last_usage_update_time) {
                                            // Hitung durasi dari last_usage_update_time, bukan dari login_time
                                            const lastUpdateMs = new Date(voucherData.last_usage_update_time).getTime();
                                            additionalUsage = Math.floor((nowMs - lastUpdateMs) / 1000);
                                        }
                                        
                                        // Total pemakaian = total_usage sebelumnya + durasi tambahan
                                        const newTotalUsage = voucherData.total_usage + Math.max(0, additionalUsage);
                                        const newRemainingTime = Math.max(0, voucherData.uptime_limit - newTotalUsage);
                                        
                                        // Update database
                                        const sqlite3 = require('sqlite3').verbose();
                                        const updateDb = new sqlite3.Database('./data/billing.db');
                                        updateDb.run(`
                                            UPDATE voucher_data 
                                            SET total_usage = ?, 
                                                remaining_time = ?,
                                                last_usage_update_time = ?,
                                                status = CASE 
                                                    WHEN ? <= 0 THEN 'used'
                                                    ELSE status
                                                END,
                                                updated_at = CURRENT_TIMESTAMP 
                                            WHERE voucher_code = ?
                                        `, [newTotalUsage, newRemainingTime, mikrotikTime, newRemainingTime, username], (updateErr) => {
                                            updateDb.close();
                                            if (updateErr) {
                                                console.error(`Error updating voucher usage for ${username}:`, updateErr);
                                            }
                                        });
                                        
                                        // Cek apakah waktu sudah habis atau masa aktif lewat
                                        const now = Math.floor(Date.now() / 1000);
                                        
                                        // Cek masa aktif
                                        if (voucherData.first_login) {
                                            const elapsedSinceFirstLogin = now - voucherData.first_login;
                                            if (elapsedSinceFirstLogin > voucherData.validity_limit) {
                                                // Masa aktif lewat, disconnect
                                                console.log(`[Voucher] Masa aktif lewat untuk ${username}, disconnecting...`);
                                                try {
                                                    await disconnectHotspotUser(username, router);
                                                    // Update status ke expired
                                                    const sqlite3 = require('sqlite3').verbose();
                                                    const dbExpire = new sqlite3.Database('./data/billing.db');
                                                    dbExpire.run(`UPDATE voucher_data SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE voucher_code = ?`, [username], () => {
                                                        dbExpire.close();
                                                    });
                                                } catch (e) {
                                                    console.error(`Error disconnecting ${username}:`, e);
                                                }
                                                continue;
                                            }
                                        }
                                        
                                        // Cek sisa waktu
                                        if (newRemainingTime <= 0) {
                                            // Waktu habis, disconnect
                                            console.log(`[Voucher] Waktu habis untuk ${username}, disconnecting...`);
                                            try {
                                                await disconnectHotspotUser(username, router);
                                                // Update status ke used
                                                const sqlite3 = require('sqlite3').verbose();
                                                const dbUsed = new sqlite3.Database('./data/billing.db');
                                                dbUsed.run(`UPDATE voucher_data SET status = 'used', updated_at = CURRENT_TIMESTAMP WHERE voucher_code = ?`, [username], () => {
                                                    dbUsed.close();
                                                });
                                            } catch (e) {
                                                console.error(`Error disconnecting ${username}:`, e);
                                            }
                                            continue;
                                        }
                                    }
                                } catch (usageErr) {
                                    console.error(`Error updating usage for ${username}:`, usageErr);
                                }
                            }
                        }
                        
                        // Parse uptime session ke detik
                        const sessionUptimeStr = activeUser.uptime || activeUser['uptime'] || '';
                        
                        // Coba hitung waktu login dari uptime (lebih akurat)
                        let loginTime = calculateLoginTimeFromUptime(sessionUptimeStr, mikrotikTime);
                        
                        // Jika tidak bisa hitung dari uptime, gunakan waktu Mikrotik sekarang
                        if (!loginTime) {
                            loginTime = mikrotikTime;
                        }
                        
                        await saveVoucherLogin(
                            username,
                            router.id,
                            router.name,
                            router.nas_ip,
                            loginTime,
                            {
                                uptime: sessionUptimeStr,
                                bytes_in: activeUser['bytes-in'] || 0,
                                bytes_out: activeUser['bytes-out'] || 0
                            }
                        );
                    }
                }
            } catch (e) {
                console.error(`[Voucher Monitoring] ❌ Error monitoring router ${router.name}:`, e.message);
                console.error(`[Voucher Monitoring] Stack:`, e.stack);
            }
        }
        
        db.close();
        
        const duration = Date.now() - startTime;
        console.log(`[Voucher Monitoring] ✅ Monitoring selesai dalam ${duration}ms`);
    } catch (error) {
        console.error('[Voucher Monitoring] ❌ Error in monitorVoucherLoginLogout:', error);
        console.error('[Voucher Monitoring] Stack:', error.stack);
    }
}

// GET: List Voucher (Daftar User Hotspot)
router.get('/list-voucher', async (req, res) => {
    try {
        // Jalankan monitoring untuk update history
        monitorVoucherLoginLogout().catch(err => {
            console.error('Error in background monitoring:', err);
        });
        
        // Fetch routers from database
        const db = new sqlite3.Database('./data/billing.db');
        const routers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Aggregate active users from all NAS
        const activeUsersList = [];
        for (const router of routers) {
            try {
                const result = await getActiveHotspotUsers(router);
                if (result.success && Array.isArray(result.data)) {
                    result.data.forEach(user => {
                        activeUsersList.push({
                            ...user,
                            nas_id: router.id,
                            nas_name: router.name,
                            nas_ip: router.nas_ip
                        });
                    });
                }
            } catch (e) {
                console.error(`Error getting active users from ${router.name}:`, e.message);
            }
        }

        // Aggregate profiles from all NAS
        let profiles = [];
        for (const router of routers) {
            try {
                const profilesResult = await getHotspotProfiles(router);
                if (profilesResult.success && Array.isArray(profilesResult.data)) {
                    profilesResult.data.forEach(prof => {
                        const existing = profiles.find(p => p.name === prof.name && p.nas_id === router.id);
                        if (!existing) {
                            profiles.push({
                                ...prof,
                                nas_id: router.id,
                                nas_name: router.name,
                                nas_ip: router.nas_ip
                            });
                        }
                    });
                }
            } catch (e) {
                console.error(`Error getting profiles from ${router.name}:`, e.message);
            }
        }

        // Aggregate all hotspot users from all NAS dengan informasi lengkap
        let allUsers = [];
        for (const router of routers) {
            try {
                const conn = await getMikrotikConnectionForRouter(router);
                if (!conn) {
                    console.error(`[List Voucher] Tidak dapat terhubung ke router ${router.name} (${router.nas_ip})`);
                    continue;
                }
                const users = await conn.write('/ip/hotspot/user/print');
                
                if (!users || users.length === 0) {
                    console.log(`[List Voucher] Tidak ada user hotspot di router ${router.name}`);
                    continue;
                }
                
                console.log(`[List Voucher] Ditemukan ${users.length} user di router ${router.name}`);
                
                // Dapatkan server hotspot untuk router ini
                // Command yang benar: /ip/hotspot/print untuk mendapatkan list server hotspot
                let servers = [];
                try {
                    servers = await conn.write('/ip/hotspot/print');
                } catch (e) {
                    console.error(`Error getting servers from ${router.name}:`, e.message);
                }
                
                // Dapatkan log login dan logout dari Mikrotik untuk semua user
                // Baca log untuk setiap user secara terpisah agar waktu login/logout masing-masing berbeda
                let loginLogs = {}; // Log login pertama untuk Start Time
                let logoutLogs = {}; // Log logout terakhir untuk Last Update
                let allLogs = []; // Simpan semua log untuk digunakan di map function
                try {
                    // Ambil semua log dengan topics hotspot (login dan logout)
                    allLogs = await conn.write('/log/print', ['?topics~hotspot']) || [];
                    const logs = allLogs;
                    
                    // Buat daftar username yang perlu dicek (semua user yang ada)
                    const usernames = users.map(u => u.name);
                    
                    // Untuk setiap username, cari log login pertama dan logout terakhir
                    usernames.forEach(username => {
                        // Cari log login untuk username ini
                        const loginEntries = logs.filter(log => {
                            if (!log.message || !log.time) return false;
                            // Format log login bisa: "username (IP): logged in" atau variasi lain
                            // Cek apakah message mengandung username dan "logged in"
                            const hasUsername = log.message.includes(username);
                            const hasLoggedIn = log.message.toLowerCase().includes('logged in');
                            return hasUsername && hasLoggedIn;
                        });
                        
                        // Cari log logout untuk username ini
                        const logoutEntries = logs.filter(log => {
                            if (!log.message || !log.time) return false;
                            // Format log logout bisa: "username (IP): logged out: reason" atau variasi lain
                            // Cek apakah message mengandung username dan "logged out"
                            const hasUsername = log.message.includes(username);
                            const hasLoggedOut = log.message.toLowerCase().includes('logged out');
                            return hasUsername && hasLoggedOut;
                        });
                        
                        // Ambil login pertama (yang paling lama) untuk username ini
                        if (loginEntries.length > 0) {
                            // Urutkan berdasarkan waktu (terlama dulu untuk login pertama)
                            loginEntries.sort((a, b) => {
                                const timeA = new Date(a.time).getTime();
                                const timeB = new Date(b.time).getTime();
                                return timeA - timeB; // Ascending (terlama dulu)
                            });
                            
                            // Simpan waktu login pertama untuk user ini (Start Time)
                            loginLogs[username] = {
                                time: loginEntries[0].time,
                                message: loginEntries[0].message
                            };
                        }
                        
                        // Ambil logout terakhir (yang paling baru) untuk username ini
                        if (logoutEntries.length > 0) {
                            // Urutkan berdasarkan waktu (terbaru dulu untuk logout terakhir)
                            logoutEntries.sort((a, b) => {
                                const timeA = new Date(a.time).getTime();
                                const timeB = new Date(b.time).getTime();
                                return timeB - timeA; // Descending (terbaru dulu)
                            });
                            
                            // Simpan waktu logout terakhir untuk user ini (Last Update)
                            logoutLogs[username] = {
                                time: logoutEntries[0].time,
                                message: logoutEntries[0].message
                            };
                        }
                    });
                    
                    // Debug: log login/logout time untuk voucher tertentu
                    if (loginLogs['14604'] || loginLogs['16341'] || loginLogs['10346'] || loginLogs['13858'] ||
                        logoutLogs['14604'] || logoutLogs['16341'] || logoutLogs['10346'] || logoutLogs['13858']) {
                        console.log('=== Login/Logout Logs Debug ===');
                        ['14604', '16341', '10346', '13858'].forEach(u => {
                            if (loginLogs[u]) {
                                console.log(`${u}: first login at ${loginLogs[u].time}`);
                            }
                            if (logoutLogs[u]) {
                                console.log(`${u}: last logout at ${logoutLogs[u].time}`);
                            }
                        });
                    }
                } catch (e) {
                    console.error(`Error getting login/logout logs from ${router.name}:`, e.message);
                    // Pastikan allLogs tetap terdefinisi sebagai array kosong jika terjadi error
                    allLogs = allLogs || [];
                }
                
                // Ambil semua history dari database sekaligus untuk performa lebih baik
                const historyMap = {};
                try {
                    const sqlite3 = require('sqlite3').verbose();
                    const historyDb = new sqlite3.Database('./data/billing.db');
                    const historyRows = await new Promise((resolve, reject) => {
                        historyDb.all(`
                            SELECT username, nas_id, login_time, logout_time, is_active
                            FROM voucher_login_history
                            WHERE nas_id = ?
                            ORDER BY login_time DESC
                        `, [router.id], (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows || []);
                        });
                    });
                    historyDb.close();
                    
                    // Buat map untuk akses cepat
                    historyRows.forEach(row => {
                        const key = `${row.username}_${row.nas_id}`;
                        if (!historyMap[key] || new Date(row.login_time) > new Date(historyMap[key].login_time)) {
                            historyMap[key] = row;
                        }
                    });
                } catch (e) {
                    console.error(`Error getting history for router ${router.id}:`, e.message);
                }
                
                // Pass loginLogs dan logoutLogs ke dalam map function
                allUsers = allUsers.concat(users.map(u => {
                    try {
                        // Debug: log server field dan login/logout data untuk debugging
                        if (u.name === '11309' || u.name === '14604' || u.name === '16341' || u.name === '10346') {
                            console.log(`=== Debug Voucher ${u.name} ===`);
                            console.log('last-logged-in:', u['last-logged-in']);
                            console.log('last-logged-out:', u['last-logged-out']);
                            console.log('bytes-in:', u['bytes-in']);
                            console.log('bytes-out:', u['bytes-out']);
                            console.log('uptime-used:', u['uptime-used']);
                            console.log('Full user data:', JSON.stringify(u, null, 2));
                        }
                    
                    // Cari user aktif untuk mendapatkan informasi real-time
                    const activeUser = activeUsersList.find(au => 
                        (au.user === u.name || au.name === u.name) && 
                        au.nas_id === router.id
                    );
                    
                    // Tentukan status voucher berdasarkan kategori:
                    // 1. BARU (Ungu) - Voucher yang belum digunakan
                    // 2. EXPIRED (Merah) - Voucher yang habis uptime/habis masa aktif
                    // 3. STAND BY (Kuning) - Voucher yang sudah dipakai tetapi offline DAN masih ada masa pakai (UpTime)
                    // 4. ONLINE (Hijau) - Voucher yang aktif
                    
                    let voucherStatus = 'BARU'; // Default: BARU (Ungu)
                    const isActive = !!activeUser;
                    
                    // Deteksi apakah voucher sudah pernah digunakan dengan berbagai cara:
                    // 1. Cek last-logged-in/out (jika ada)
                    // 2. Cek bytes-in/bytes-out (jika ada dan > 0)
                    // 3. Cek uptime-used (jika ada)
                    // 4. Cek apakah pernah ada di activeUsersList (sudah pernah aktif)
                    const hasLastLoggedIn = !!(u['last-logged-in'] && u['last-logged-in'] !== '');
                    const hasLastLoggedOut = !!(u['last-logged-out'] && u['last-logged-out'] !== '');
                    const hasBytesIn = !!(u['bytes-in'] && parseInt(u['bytes-in']) > 0);
                    const hasBytesOut = !!(u['bytes-out'] && parseInt(u['bytes-out']) > 0);
                    // uptime-used bisa dari field 'uptime-used' atau 'uptime' di user config
                    const hasUptimeUsed = !!(u['uptime-used'] && u['uptime-used'] !== '') || !!(u.uptime && u.uptime !== '' && u.uptime !== '0s');
                    const hasBeenActive = !!activeUsersList.find(au => 
                        (au.user === u.name || au.name === u.name) && au.nas_id === router.id
                    );
                    
                    // Voucher dianggap sudah digunakan jika salah satu kondisi terpenuhi
                    const hasLoggedIn = hasLastLoggedIn || hasLastLoggedOut || hasBytesIn || hasBytesOut || hasUptimeUsed || hasBeenActive;
                    
                    // Cek limit uptime dari user config atau comment
                    let limitUptimeTotal = u['limit-uptime-total'] || '';
                    // Jika tidak ada di user config, coba ambil dari comment (format: "voucher|uptime:10m")
                    if (!limitUptimeTotal && u.comment) {
                        const commentMatch = u.comment.match(/uptime:([^\|]+)/);
                        if (commentMatch && commentMatch[1]) {
                            limitUptimeTotal = commentMatch[1].trim();
                        }
                    }
                    const hasUptimeLimit = !!(u['limit-uptime'] || limitUptimeTotal);
                    const isDisabled = u.disabled === 'true' || u.disabled === true;
                    
                    // Cek validity (limit-uptime) - jika habis, voucher EXPIRED
                    // CATATAN: Hanya cek validity jika limit-uptime ada dan tidak unlimited
                    // Jangan anggap voucher expired jika tidak ada limit-uptime
                    let isValidityExpired = false;
                    const limitUptimeValidity = u['limit-uptime'] || '';
                    if (limitUptimeValidity && limitUptimeValidity !== '' && limitUptimeValidity !== 'Unlimited' && limitUptimeValidity.trim() !== '') {
                        try {
                            // Cek format "0d 00:00:00" atau format lain yang menunjukkan 0
                            const isZeroValidity = limitUptimeValidity.trim() === '0d 00:00:00' || 
                                                 limitUptimeValidity.trim() === '0d00:00:00' ||
                                                 limitUptimeValidity.trim() === '0d' ||
                                                 limitUptimeValidity.trim() === '00:00:00' ||
                                                 limitUptimeValidity.trim() === '0s' ||
                                                 limitUptimeValidity.trim() === '0';
                            
                            // Parse limit-uptime ke detik
                            const limitSeconds = parseTimeToSeconds(limitUptimeValidity);
                            
                            if (isZeroValidity || limitSeconds <= 0) {
                                isValidityExpired = true;
                            }
                        } catch (parseErr) {
                            // Jika error parsing, jangan anggap expired
                            console.error(`[List Voucher] Error parsing limit-uptime untuk ${u.name}: ${limitUptimeValidity}`, parseErr);
                            isValidityExpired = false;
                        }
                    }
                    
                    // Cek apakah uptime sudah habis (untuk menentukan EXPIRED)
                    let isUptimeExpired = false;
                    if (hasLoggedIn && limitUptimeTotal && limitUptimeTotal !== 'Unlimited') {
                        // Parse limit uptime ke detik
                        function parseUptimeToSecondsForStatus(uptimeStr) {
                            if (!uptimeStr) return 0;
                            let totalSeconds = 0;
                            const days = uptimeStr.match(/(\d+)d/);
                            const hours = uptimeStr.match(/(\d+)h/);
                            const minutes = uptimeStr.match(/(\d+)m/);
                            const seconds = uptimeStr.match(/(\d+)s/);
                            if (days) totalSeconds += parseInt(days[1]) * 86400;
                            if (hours) totalSeconds += parseInt(hours[1]) * 3600;
                            if (minutes) totalSeconds += parseInt(minutes[1]) * 60;
                            if (seconds) totalSeconds += parseInt(seconds[1]);
                            return totalSeconds;
                        }
                        
                        const limitSeconds = parseUptimeToSecondsForStatus(limitUptimeTotal);
                        if (limitSeconds > 0) {
                            // Cek uptime yang sudah digunakan
                            const uptimeUsed = u['uptime-used'] || '0s';
                            const uptimeUsedSeconds = parseUptimeToSecondsForStatus(uptimeUsed);
                            
                            // Jika user aktif, tambahkan uptime session aktif saat ini
                            let currentUptimeSeconds = 0;
                            if (isActive && activeUser && activeUser.uptime) {
                                currentUptimeSeconds = parseUptimeToSecondsForStatus(activeUser.uptime || activeUser['uptime'] || '0s');
                            }
                            
                            // Total uptime = uptime yang sudah digunakan + uptime session aktif saat ini
                            const totalUptimeSeconds = uptimeUsedSeconds + currentUptimeSeconds;
                            
                            // Jika total uptime >= limit, uptime sudah habis
                            if (totalUptimeSeconds >= limitSeconds) {
                                isUptimeExpired = true;
                            }
                        }
                    }
                    
                    // Prioritas: Cek validity (limit-uptime) terlebih dahulu
                    if (isValidityExpired) {
                        // Validity sudah habis (0d 00:00:00), voucher EXPIRED
                        voucherStatus = 'EXPIRED'; // Merah
                    } else if (isActive) {
                        // Voucher yang aktif
                        // Tapi jika uptime sudah habis, tetap EXPIRED meskipun masih aktif
                        if (isUptimeExpired) {
                            voucherStatus = 'EXPIRED'; // Merah (uptime habis meskipun masih aktif)
                        } else {
                            voucherStatus = 'ONLINE'; // Hijau
                        }
                    } else if (hasLoggedIn && (isDisabled || isUptimeExpired) && hasUptimeLimit) {
                        // Voucher yang habis uptime/habis masa aktif
                        // User pernah login, disabled ATAU uptime habis, dan ada limit uptime
                        voucherStatus = 'EXPIRED'; // Merah
                    } else if (hasLoggedIn && !isActive && !isDisabled && !isUptimeExpired && hasUptimeLimit) {
                        // Voucher yang sudah dipakai tetapi offline DAN masih ada masa pakai (UpTime)
                        // User pernah login, offline, tidak disabled, uptime belum habis, dan ada limit uptime
                        voucherStatus = 'STAND BY'; // Kuning
                    } else if (hasLoggedIn && !isActive && !isDisabled && !isUptimeExpired) {
                        // Voucher yang sudah dipakai tetapi offline (tanpa limit uptime, tetap dianggap STAND BY)
                        voucherStatus = 'STAND BY'; // Kuning
                    } else if (!hasLoggedIn) {
                        // Voucher yang belum digunakan
                        voucherStatus = 'BARU'; // Ungu
                    } else {
                        // Fallback: jika sudah login tapi tidak memenuhi kriteria di atas
                        voucherStatus = 'STAND BY'; // Kuning (default ke STAND BY jika sudah digunakan)
                    }
                    
                    // Helper function untuk format tanggal dd/mm/yyyy HH:mm:ss
                    function formatDateTime(date) {
                        if (!date) return null;
                        const d = date instanceof Date ? date : new Date(date);
                        if (isNaN(d.getTime())) return null;
                        const day = String(d.getDate()).padStart(2, '0');
                        const month = String(d.getMonth() + 1).padStart(2, '0');
                        const year = d.getFullYear();
                        const hours = String(d.getHours()).padStart(2, '0');
                        const minutes = String(d.getMinutes()).padStart(2, '0');
                        const seconds = String(d.getSeconds()).padStart(2, '0');
                        return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
                    }
                    
                    // Helper function untuk parse Mikrotik date/time
                    function parseMikrotikDateTime(dateStr) {
                        if (!dateStr || dateStr === '' || dateStr === 'N/A') return null;
                        // Format Mikrotik bisa berbagai macam:
                        // 1. "jan/01/2024 12:00:00" (format dengan nama bulan)
                        // 2. "2024-01-01 12:00:00" (format ISO)
                        // 3. "01/01/2024 12:00:00" (format DD/MM/YYYY)
                        try {
                            // Coba langsung parse sebagai Date
                            let date = new Date(dateStr);
                            if (!isNaN(date.getTime())) {
                                return date;
                            }
                            // Jika gagal, coba parse format Mikrotik dengan nama bulan
                            // Contoh: "jan/01/2024 12:00:00"
                            const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                            const parts = dateStr.split(' ');
                            if (parts.length >= 2) {
                                const datePart = parts[0];
                                const timePart = parts[1] || '00:00:00';
                                const dateParts = datePart.split('/');
                                if (dateParts.length === 3) {
                                    const monthName = dateParts[0].toLowerCase();
                                    const monthIndex = monthNames.indexOf(monthName);
                                    if (monthIndex !== -1) {
                                        const day = parseInt(dateParts[1]);
                                        const year = parseInt(dateParts[2]);
                                        date = new Date(year, monthIndex, day);
                                        const timeParts = timePart.split(':');
                                        if (timeParts.length >= 2) {
                                            date.setHours(parseInt(timeParts[0]) || 0);
                                            date.setMinutes(parseInt(timeParts[1]) || 0);
                                            date.setSeconds(parseInt(timeParts[2]) || 0);
                                        }
                                        if (!isNaN(date.getTime())) {
                                            return date;
                                        }
                                    }
                                }
                            }
                            return null;
                        } catch (e) {
                            console.error(`Error parsing Mikrotik date: ${dateStr}`, e.message);
                            return null;
                        }
                    }
                    
                    // Helper function untuk format waktu 00:00:00 (HH:mm:ss)
                    function formatTimeOnly(seconds) {
                        if (!seconds || seconds === 0) return '00:00:00';
                        const hours = Math.floor(seconds / 3600);
                        const minutes = Math.floor((seconds % 3600) / 60);
                        const secs = seconds % 60;
                        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                    }
                    
                    // Helper function untuk parse Mikrotik uptime ke detik
                    function parseUptimeToSeconds(uptimeStr) {
                        if (!uptimeStr) return 0;
                        // Format: "1d2h3m4s" atau "2h3m4s" atau "3m4s" atau "4s"
                        let totalSeconds = 0;
                        const days = uptimeStr.match(/(\d+)d/);
                        const hours = uptimeStr.match(/(\d+)h/);
                        const minutes = uptimeStr.match(/(\d+)m/);
                        const seconds = uptimeStr.match(/(\d+)s/);
                        if (days) totalSeconds += parseInt(days[1]) * 86400;
                        if (hours) totalSeconds += parseInt(hours[1]) * 3600;
                        if (minutes) totalSeconds += parseInt(minutes[1]) * 60;
                        if (seconds) totalSeconds += parseInt(seconds[1]);
                        return totalSeconds;
                    }
                    
                    // Helper function untuk format validity countdown
                    // Logika: Validity mulai berjalan dari waktu login pertama dan terus berkurang 24 jam non-stop
                    // Tidak peduli user online/offline, logout/disconnect, pakai sedikit/banyak
                    function formatValidityCountdown(limitUptime, startDateTime) {
                        if (!limitUptime || limitUptime === 'Unlimited') {
                            return 'Unlimited';
                        }
                        
                        // Jika belum pernah login (startDateTime null), validity belum berjalan
                        // Tampilkan limit-uptime tanpa countdown
                        if (!startDateTime) {
                            return limitUptime;
                        }
                        
                        // Parse limit-uptime ke detik (format: "1d", "2h", "3m", dll)
                        // Gunakan fungsi lokal parseUptimeToSeconds yang sudah didefinisikan di scope ini
                        const limitSeconds = parseUptimeToSeconds(limitUptime);
                        if (limitSeconds === 0) return 'Unlimited';
                        
                        // Hitung waktu akhir (start time + limit)
                        // Validity mulai berjalan dari waktu login pertama
                        const startTime = startDateTime instanceof Date ? startDateTime : new Date(startDateTime);
                        if (isNaN(startTime.getTime())) return limitUptime; // Fallback ke original format
                        
                        const endTime = new Date(startTime.getTime() + (limitSeconds * 1000));
                        const now = new Date();
                        
                        // Hitung sisa waktu (countdown terus berjalan dari waktu login pertama)
                        let remainingSeconds = Math.floor((endTime.getTime() - now.getTime()) / 1000);
                        
                        // Jika waktu sudah habis, tampilkan "0d 00:00:00" atau "Habis"
                        if (remainingSeconds <= 0) {
                            return '0d 00:00:00';
                        }
                        
                        // Format ke "1d 00:00:00"
                        const days = Math.floor(remainingSeconds / 86400);
                        const hours = Math.floor((remainingSeconds % 86400) / 3600);
                        const minutes = Math.floor((remainingSeconds % 3600) / 60);
                        const secs = remainingSeconds % 60;
                        
                        if (days > 0) {
                            return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                        } else {
                            return `0d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                        }
                    }
                    
                    // Start Time: Waktu pertama kali voucher login (format: dd/mm/yyyy 00:00:00)
                    // Prioritas: 1. Database history (paling akurat), 2. last-logged-in dari user config, 3. Log login pertama dari Mikrotik, 4. Hitung dari uptime (untuk user aktif)
                    let startTime = 'N/A';
                    let startDateTime = null;
                    
                    // Prioritas 1: Cek database history terlebih dahulu
                    const historyKey = `${u.name}_${router.id}`;
                    const history = historyMap[historyKey];
                    if (history && history.login_time) {
                        startDateTime = new Date(history.login_time);
                        startTime = formatDateTime(startDateTime);
                    }
                    
                    // Jika tidak ada di database, coba sumber lain
                    if (startTime === 'N/A') {
                        if (u['last-logged-in'] && u['last-logged-in'] !== '') {
                            // Prioritas 2: Waktu pertama login dari user config
                            startDateTime = parseMikrotikDateTime(u['last-logged-in']);
                            startTime = startDateTime ? formatDateTime(startDateTime) : u['last-logged-in'];
                        } else if (loginLogs[u.name] && loginLogs[u.name].time) {
                            // Prioritas 3: Gunakan waktu login pertama dari log Mikrotik
                            startDateTime = parseMikrotikDateTime(loginLogs[u.name].time);
                            startTime = startDateTime ? formatDateTime(startDateTime) : loginLogs[u.name].time;
                        } else if (isActive && activeUser && activeUser.uptime) {
                            // Prioritas 4: Untuk user online, hitung waktu login dari uptime
                            // Waktu login = waktu server sekarang - uptime
                            const serverTime = new Date(); // Waktu server billing (hanya untuk user aktif)
                            const uptimeSeconds = parseUptimeToSeconds(activeUser.uptime || activeUser['uptime'] || '0s');
                            const loginTime = new Date(serverTime.getTime() - (uptimeSeconds * 1000));
                            startDateTime = loginTime;
                            startTime = formatDateTime(loginTime);
                        } else if (hasLoggedIn && (hasBytesIn || hasBytesOut || hasUptimeUsed)) {
                            // Prioritas 5: Untuk user yang sudah pernah login tapi tidak ada data waktu
                            // Coba cari dari log
                            if (allLogs && allLogs.length > 0) {
                                const userLoginLogs = allLogs.filter(log => {
                                    if (!log.message || !log.time) return false;
                                    return log.message.includes(u.name) && log.message.toLowerCase().includes('logged in');
                                });
                                if (userLoginLogs.length > 0) {
                                    // Ambil login pertama (terlama)
                                    userLoginLogs.sort((a, b) => {
                                        const timeA = new Date(a.time).getTime();
                                        const timeB = new Date(b.time).getTime();
                                        return timeA - timeB; // Ascending (terlama dulu)
                                    });
                                    startDateTime = parseMikrotikDateTime(userLoginLogs[0].time);
                                    startTime = startDateTime ? formatDateTime(startDateTime) : userLoginLogs[0].time;
                                } else if (u['last-logged-out'] && u['last-logged-out'] !== '') {
                                    // Jika tidak ada log login tapi ada last-logged-out, gunakan itu sebagai estimasi
                                    startDateTime = parseMikrotikDateTime(u['last-logged-out']);
                                    startTime = startDateTime ? formatDateTime(startDateTime) : u['last-logged-out'];
                                }
                            } else if (u['last-logged-out'] && u['last-logged-out'] !== '') {
                                // Jika tidak ada log sama sekali tapi ada last-logged-out, gunakan itu sebagai estimasi
                                startDateTime = parseMikrotikDateTime(u['last-logged-out']);
                                startTime = startDateTime ? formatDateTime(startDateTime) : u['last-logged-out'];
                            }
                        }
                    }
                    // Jika belum ada data sama sekali (belum pernah login), tetap 'N/A'
                    
                    // Last Update: Kapan terakhir voucher logout (format: dd/mm/yyyy 00:00:00)
                    // Prioritas: 1. Untuk user online: "Belum logout", 2. Database history (paling akurat), 3. Log logout dari Mikrotik, 4. last-logged-out
                    let lastUpdate = 'N/A';
                    
                    // Jika user masih online, Last Update harus menampilkan "Belum logout"
                    if (isActive) {
                        // User masih online, belum logout
                        lastUpdate = 'Belum logout';
                    } else {
                        // Prioritas 1: Cek database history terlebih dahulu
                        if (history && history.logout_time) {
                            const logoutTime = new Date(history.logout_time);
                            lastUpdate = formatDateTime(logoutTime);
                        }
                        
                        // Jika tidak ada di database, coba sumber lain
                        if (lastUpdate === 'N/A') {
                            if (logoutLogs[u.name] && logoutLogs[u.name].time) {
                                // Prioritas 2: Cek log logout dari Mikrotik untuk waktu logout sebenarnya
                                const logoutTime = parseMikrotikDateTime(logoutLogs[u.name].time);
                                lastUpdate = logoutTime ? formatDateTime(logoutTime) : logoutLogs[u.name].time;
                            } else if (u['last-logged-out'] && u['last-logged-out'] !== '') {
                                // Prioritas 3: Jika sudah logout, waktu terakhir logout = last-logged-out
                                const lastLogoutDate = parseMikrotikDateTime(u['last-logged-out']);
                                lastUpdate = lastLogoutDate ? formatDateTime(lastLogoutDate) : u['last-logged-out'];
                            } else if (hasLoggedIn && (hasBytesIn || hasBytesOut || hasUptimeUsed)) {
                                // Prioritas 4: Untuk user yang sudah pernah login tapi tidak ada data logout
                                // Coba cari dari log atau estimasi waktu logout
                                if (allLogs && allLogs.length > 0) {
                                    const userLogoutLogs = allLogs.filter(log => {
                                        if (!log.message || !log.time) return false;
                                        return log.message.includes(u.name) && log.message.toLowerCase().includes('logged out');
                                    });
                                    if (userLogoutLogs.length > 0) {
                                        // Ambil logout terakhir (terbaru)
                                        userLogoutLogs.sort((a, b) => {
                                            const timeA = new Date(a.time).getTime();
                                            const timeB = new Date(b.time).getTime();
                                            return timeB - timeA; // Descending (terbaru dulu)
                                        });
                                        const logoutTime = parseMikrotikDateTime(userLogoutLogs[0].time);
                                        lastUpdate = logoutTime ? formatDateTime(logoutTime) : userLogoutLogs[0].time;
                                    } else if (startDateTime && u['uptime-used']) {
                                        // Jika tidak ada log logout, estimasi waktu logout = Start Time + uptime-used
                                        const uptimeSeconds = parseUptimeToSeconds(u['uptime-used']);
                                        const estimatedLogoutTime = new Date(startDateTime.getTime() + (uptimeSeconds * 1000));
                                        lastUpdate = formatDateTime(estimatedLogoutTime);
                                    }
                                } else if (startDateTime && u['uptime-used']) {
                                    // Jika tidak ada log sama sekali, estimasi waktu logout = Start Time + uptime-used
                                    const uptimeSeconds = parseUptimeToSeconds(u['uptime-used']);
                                    const estimatedLogoutTime = new Date(startDateTime.getTime() + (uptimeSeconds * 1000));
                                    lastUpdate = formatDateTime(estimatedLogoutTime);
                                }
                            }
                        }
                    }
                    // Jika belum ada data sama sekali (belum pernah login), tetap 'N/A'
                    
                    // Up Time: Berapa lama sudah terpakai (format: 00:00:00)
                    // Untuk countdown real-time, kita perlu menyimpan data:
                    // - uptime_current: uptime session aktif saat ini (dalam detik)
                    // - uptime_used: total uptime yang sudah digunakan sebelumnya (dalam detik)
                    // - start_time_for_uptime: waktu login untuk menghitung uptime real-time
                    let upTime = '00:00:00';
                    let uptimeCurrentSeconds = 0; // Uptime session aktif saat ini
                    let uptimeUsedSeconds = 0; // Total uptime yang sudah digunakan sebelumnya
                    let startTimeForUptime = null; // Waktu login untuk menghitung uptime real-time
                    
                    if (isActive && activeUser) {
                        // Jika aktif, gunakan uptime dari session aktif
                        uptimeCurrentSeconds = parseUptimeToSecondsForStatus(activeUser.uptime || activeUser['uptime'] || '0s');
                        // Tambahkan dengan total uptime sebelumnya jika ada
                        if (u['uptime-used']) {
                            uptimeUsedSeconds = parseUptimeToSecondsForStatus(u['uptime-used']);
                            upTime = formatTimeOnly(uptimeCurrentSeconds + uptimeUsedSeconds);
                        } else {
                            upTime = formatTimeOnly(uptimeCurrentSeconds);
                        }
                        // Untuk user aktif, gunakan waktu login dari session aktif untuk menghitung uptime real-time
                        if (startDateTime) {
                            startTimeForUptime = startDateTime;
                        } else if (activeUser.uptime) {
                            // Hitung waktu login dari uptime
                            const serverTime = new Date();
                            const uptimeSeconds = parseUptimeToSecondsForStatus(activeUser.uptime || activeUser['uptime'] || '0s');
                            startTimeForUptime = new Date(serverTime.getTime() - (uptimeSeconds * 1000));
                        }
                    } else if (hasLoggedIn) {
                        // Total uptime yang sudah digunakan (user offline)
                        if (u['uptime-used'] && u['uptime-used'] !== '') {
                            uptimeUsedSeconds = parseUptimeToSecondsForStatus(u['uptime-used']);
                            upTime = formatTimeOnly(uptimeUsedSeconds);
                        } else if (hasBytesIn || hasBytesOut) {
                            // Estimasi uptime dari bytes transfer (100MB = 1 jam)
                            const totalBytes = (parseInt(u['bytes-in'] || '0') + parseInt(u['bytes-out'] || '0'));
                            const totalMB = totalBytes / (1024 * 1024);
                            const estimatedHours = totalMB / 100;
                            const estimatedSeconds = Math.round(estimatedHours * 3600);
                            uptimeUsedSeconds = estimatedSeconds;
                            upTime = formatTimeOnly(estimatedSeconds);
                        }
                        // Untuk user offline, uptime tidak berubah (statis)
                        uptimeCurrentSeconds = 0;
                    }
                    
                    // Validity: Countdown dari saat pertama login (format: 1d 00:00:00)
                    // Logika:
                    // 1. Voucher dibuat → validity belum berjalan (tampilkan limit-uptime tanpa countdown)
                    // 2. User login pertama kali → validity mulai berjalan (countdown dari Start Time)
                    // 3. Waktu validity berkurang terus 24 jam non-stop dari waktu login pertama
                    // 4. Tidak peduli user online/offline, logout/disconnect, pakai sedikit/banyak
                    let validity = 'Unlimited';
                    let validityEndTime = null; // Waktu akhir validity untuk countdown real-time
                    const limitUptimeForValidity = u['limit-uptime'] || u['limit-uptime-total'] || '';
                    
                    if (limitUptimeForValidity && limitUptimeForValidity !== 'Unlimited') {
                        // Jika sudah pernah login (startDateTime ada), validity mulai berjalan
                        if (startDateTime) {
                            // Hitung waktu akhir validity untuk countdown real-time
                            const limitSeconds = parseTimeToSeconds(limitUptimeForValidity);
                            if (limitSeconds > 0) {
                                const startTime = startDateTime instanceof Date ? startDateTime : new Date(startDateTime);
                                if (!isNaN(startTime.getTime())) {
                                    validityEndTime = new Date(startTime.getTime() + (limitSeconds * 1000));
                                    // Format untuk data attribute (ISO string)
                                    validityEndTime = validityEndTime.toISOString();
                                }
                            }
                            // Countdown dari waktu login pertama
                            validity = formatValidityCountdown(limitUptimeForValidity, startDateTime);
                        } else {
                            // Jika belum pernah login, validity belum berjalan
                            // Tampilkan limit-uptime tanpa countdown
                            validity = limitUptimeForValidity;
                        }
                    }
                    
                    // Upload (bytes_out): Data yang di-upload
                    // Prioritas: Jika aktif, ambil dari active session (real-time), 
                    // Jika tidak aktif tapi sudah login, ambil dari user config (total yang sudah di-upload)
                    let bytesOut = '0';
                    if (isActive && activeUser) {
                        // Untuk session aktif, ambil dari active session
                        bytesOut = String(activeUser['bytes-out'] || activeUser['bytes-out'] || '0');
                    } else if (hasLoggedIn) {
                        // Untuk user yang sudah login, coba ambil dari berbagai sumber
                        if (u['bytes-out'] && parseInt(u['bytes-out']) > 0) {
                            bytesOut = String(u['bytes-out']);
                        } else if (u['bytes-out'] && u['bytes-out'] !== '0') {
                            bytesOut = String(u['bytes-out']);
                        } else {
                            // Jika tidak ada data bytes-out, tapi sudah login, set minimal 1 untuk indikasi sudah digunakan
                            bytesOut = hasBytesOut ? '1' : '0';
                        }
                    } else {
                        // Voucher baru yang belum digunakan
                        bytesOut = '0';
                    }
                    
                    // Download (bytes_in): Data yang di-download
                    // Prioritas: Jika aktif, ambil dari active session (real-time),
                    // Jika tidak aktif tapi sudah login, ambil dari user config (total yang sudah di-download)
                    let bytesIn = '0';
                    if (isActive && activeUser) {
                        // Untuk session aktif, ambil dari active session
                        bytesIn = String(activeUser['bytes-in'] || activeUser['bytes-in'] || '0');
                    } else if (hasLoggedIn) {
                        // Untuk user yang sudah login, coba ambil dari berbagai sumber
                        if (u['bytes-in'] && parseInt(u['bytes-in']) > 0) {
                            bytesIn = String(u['bytes-in']);
                        } else if (u['bytes-in'] && u['bytes-in'] !== '0') {
                            bytesIn = String(u['bytes-in']);
                        } else {
                            // Jika tidak ada data bytes-in, tapi sudah login, set minimal 1 untuk indikasi sudah digunakan
                            bytesIn = hasBytesIn ? '1' : '0';
                        }
                    } else {
                        // Voucher baru yang belum digunakan
                        bytesIn = '0';
                    }
                    
                    // Server Hotspot: Langsung tampilkan berdasarkan pilihan saat voucher dibuat
                    // Sama seperti Username, Password, dan Profile - langsung dari user config
                    // Mikrotik menyimpan server di field 'server' di user config
                    // Prioritas: u.server (field langsung dari Mikrotik) -> u['server-name'] -> server pertama -> 'all'
                    let serverHotspot = 'all';
                    if (u.server && u.server !== '' && u.server !== 'all') {
                        // Jika ada server di user config dan bukan 'all', gunakan itu
                        serverHotspot = String(u.server);
                    } else if (u['server-name'] && u['server-name'] !== '' && u['server-name'] !== 'all') {
                        // Cek field server-name jika ada
                        serverHotspot = String(u['server-name']);
                    } else if (servers && servers.length > 0) {
                        // Jika tidak ada server di user config, gunakan server pertama dari list
                        serverHotspot = String(servers[0].name || servers[0]['name'] || 'all');
                    }
                    
                    // Debug: log server untuk voucher 11309
                    if (u.name === '11309') {
                        console.log('=== Server Hotspot untuk 11309 ===');
                        console.log('u.server:', u.server);
                        console.log('u["server-name"]:', u['server-name']);
                        console.log('servers list:', servers.map(s => s.name));
                        console.log('Final server_hotspot:', serverHotspot);
                    }
                    
                    return {
                        name: u.name || '',
                        password: u.password || '',
                        profile: u.profile || '',
                        nas_id: router.id,
                        nas_name: router.name,
                        nas_ip: router.nas_ip,
                        // Data dari user config
                        'limit-uptime': u['limit-uptime'] || '',
                        'limit-uptime-total': u['limit-uptime-total'] || '',
                        'limit-bytes-in': u['limit-bytes-in'] || '',
                        'limit-bytes-out': u['limit-bytes-out'] || '',
                        'limit-bytes-total': u['limit-bytes-total'] || '',
                        disabled: u.disabled || false,
                        server: u.server || (servers.length > 0 ? servers[0].name : 'all'),
                        // Data dari active user (jika sedang aktif) atau user config (jika sudah login)
                        ip_address: activeUser ? (activeUser.address || activeUser['address'] || 'N/A') : 'N/A',
                        // Server Hotspot: Langsung tampilkan berdasarkan pilihan saat voucher dibuat
                        server_hotspot: serverHotspot,
                        // Start Time: Waktu mulai login (last-logged-in atau session start)
                        start_time: startTime,
                        // Last Update: Waktu terakhir update (last-logged-out atau last-logged-in)
                        last_update: lastUpdate,
                        last_logged_in: u['last-logged-in'] || '',
                        last_logged_out: u['last-logged-out'] || '',
                        // Up Time: Total waktu yang sudah digunakan
                        up_time: upTime,
                        // Data untuk countdown real-time
                        uptime_current_seconds: uptimeCurrentSeconds,
                        uptime_used_seconds: uptimeUsedSeconds,
                        start_time_for_uptime: startTimeForUptime ? (startTimeForUptime instanceof Date ? startTimeForUptime.toISOString() : startTimeForUptime) : null,
                        is_active_for_uptime: isActive,
                        // Validity: Masa aktif dari limit-uptime
                        validity: validity,
                        // Waktu akhir validity untuk countdown real-time (ISO string)
                        validity_end_time: validityEndTime,
                        // Upload (bytes_out): Data yang di-upload
                        bytes_out: bytesOut,
                        // Download (bytes_in): Data yang di-download
                        bytes_in: bytesIn,
                        is_active: isActive,
                        voucher_status: voucherStatus
                    };
                    } catch (userErr) {
                        // Jika ada error saat memproses user, log dan skip user ini
                        console.error(`[List Voucher] Error processing user ${u.name || 'unknown'}:`, userErr);
                        console.error(`[List Voucher] Error stack:`, userErr.stack);
                        // Return null untuk user ini, akan di-filter nanti
                        return null;
                    }
                }).filter(u => u !== null)); // Filter out null values
                
                console.log(`[List Voucher] Router ${router.name}: ${users.length} user diproses, ${allUsers.length} total user setelah router ini`);
            } catch (e) {
                console.error(`[List Voucher] Error getting users from ${router.name}:`, e.message);
                console.error(`[List Voucher] Error stack:`, e.stack);
                // Lanjutkan ke router berikutnya meskipun ada error
            }
        }

        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminKontak = settings['admins.0'] || '-';

        db.close();
        
        // Log untuk debugging
        console.log(`[List Voucher] ===== SUMMARY =====`);
        console.log(`[List Voucher] Total routers: ${routers.length}`);
        console.log(`[List Voucher] Total users ditemukan: ${allUsers.length}`);
        console.log(`[List Voucher] Total active users: ${activeUsersList.length}`);
        console.log(`[List Voucher] Total profiles: ${profiles.length}`);
        
        if (allUsers.length === 0) {
            console.warn(`[List Voucher] ⚠️ PERINGATAN: Tidak ada user hotspot ditemukan!`);
            console.warn(`[List Voucher]   - Pastikan router sudah dikonfigurasi di database`);
            console.warn(`[List Voucher]   - Pastikan koneksi ke Mikrotik berhasil`);
            console.warn(`[List Voucher]   - Pastikan ada user hotspot di Mikrotik`);
        }

        res.render('adminHotspotListVoucher', {
            users: activeUsersList,
            allUsers: allUsers || [],
            profiles: profiles || [],
            routers: routers || [],
            success: req.query.success,
            error: req.query.error,
            company_header,
            adminKontak,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        console.error('Error in list-voucher GET route:', error);
        console.error('Error stack:', error.stack);
        
        // Pastikan semua variabel terdefinisi untuk menghindari error di view
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminKontak = settings['admins.0'] || '-';
        
        res.render('adminHotspotListVoucher', { 
            users: [], 
            allUsers: [], 
            profiles: [],
            routers: [],
            success: null, 
            error: 'Gagal mengambil data user hotspot: ' + error.message,
            company_header,
            adminKontak,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    }
});

// Endpoint untuk menjalankan monitoring login/logout (bisa dipanggil secara manual atau otomatis)
router.post('/monitor-voucher-history', async (req, res) => {
    try {
        await monitorVoucherLoginLogout();
        res.json({ success: true, message: 'Monitoring selesai' });
    } catch (error) {
        console.error('Error in monitor-voucher-history:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Pastikan tabel dibuat saat aplikasi start
const initVoucherHistoryTable = () => {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');
    
    db.run(`
        CREATE TABLE IF NOT EXISTS voucher_login_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            nas_id INTEGER,
            nas_name TEXT,
            nas_ip TEXT,
            login_time DATETIME NOT NULL,
            logout_time DATETIME,
            is_active INTEGER NOT NULL DEFAULT 1,
            session_uptime TEXT,
            bytes_in INTEGER DEFAULT 0,
            bytes_out INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating voucher_login_history table:', err);
        } else {
            console.log('Voucher login history table ready');
        }
        db.close();
    });
    
    // Buat index jika belum ada
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_voucher_login_history_username 
        ON voucher_login_history(username)
    `, () => {});
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_voucher_login_history_nas_id 
        ON voucher_login_history(nas_id)
    `, () => {});
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_voucher_login_history_is_active 
        ON voucher_login_history(is_active)
    `, () => {});
};

// Inisialisasi tabel saat module dimuat
initVoucherHistoryTable();
initVoucherDataTable();

// Helper function untuk parse uptime ke detik (digunakan di monitorAndDisconnectExpiredUptime)
function parseUptimeToSecondsForMonitor(uptimeStr) {
    if (!uptimeStr) return 0;
    let totalSeconds = 0;
    const days = uptimeStr.match(/(\d+)d/);
    const hours = uptimeStr.match(/(\d+)h/);
    const minutes = uptimeStr.match(/(\d+)m/);
    const seconds = uptimeStr.match(/(\d+)s/);
    if (days) totalSeconds += parseInt(days[1]) * 86400;
    if (hours) totalSeconds += parseInt(hours[1]) * 3600;
    if (minutes) totalSeconds += parseInt(minutes[1]) * 60;
    if (seconds) totalSeconds += parseInt(seconds[1]);
    return totalSeconds;
}

// Fungsi untuk monitoring dan memutus koneksi saat uptime habis
async function monitorAndDisconnectExpiredUptime() {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');
        
        // Ambil semua router
        const routers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        // Untuk setiap router, cek semua user (aktif dan tidak aktif) dan putus/disable jika uptime habis
        for (const router of routers) {
            try {
                // Dapatkan user aktif dari router ini
                const activeUsersResult = await getActiveHotspotUsers(router);
                const activeUsers = activeUsersResult.success ? activeUsersResult.data : [];
                
                // Dapatkan semua user hotspot dari router ini
                const conn = await getMikrotikConnectionForRouter(router);
                const allUsers = await conn.write('/ip/hotspot/user/print');
                
                // Untuk setiap user (tidak hanya yang aktif), cek apakah uptime sudah habis
                for (const userConfig of allUsers) {
                    const username = userConfig.name;
                    if (!username) continue;
                    
                    // Skip jika user sudah disabled (tidak perlu cek lagi)
                    const isDisabled = userConfig.disabled === 'true' || userConfig.disabled === true;
                    
                    // Cek limit-uptime-total dari user config (jika ada)
                    let limitUptimeTotal = userConfig['limit-uptime-total'] || '';
                    
                    // Jika tidak ada di user config, coba ambil dari comment (format: "voucher|uptime:10m")
                    if (!limitUptimeTotal && userConfig.comment) {
                        const commentMatch = userConfig.comment.match(/uptime:([^\|]+)/);
                        if (commentMatch && commentMatch[1]) {
                            limitUptimeTotal = commentMatch[1].trim();
                        }
                    }
                    
                    if (!limitUptimeTotal || limitUptimeTotal === 'Unlimited' || limitUptimeTotal === '') continue;
                    
                    // Parse limit-uptime-total ke detik
                    const limitSeconds = parseUptimeToSecondsForMonitor(limitUptimeTotal);
                    if (limitSeconds === 0) continue;
                    
                    // Cek uptime yang sudah digunakan
                    const uptimeUsed = userConfig['uptime-used'] || '0s';
                    const uptimeUsedSeconds = parseUptimeToSecondsForMonitor(uptimeUsed);
                    
                    // Cari user aktif untuk mendapatkan uptime session aktif saat ini
                    const activeUser = activeUsers.find(au => (au.user === username || au.name === username));
                    let currentUptimeSeconds = 0;
                    if (activeUser) {
                        const currentUptime = activeUser.uptime || activeUser['uptime'] || '0s';
                        currentUptimeSeconds = parseUptimeToSecondsForMonitor(currentUptime);
                    }
                    
                    // Total uptime = uptime yang sudah digunakan + uptime session aktif saat ini
                    const totalUptimeSeconds = uptimeUsedSeconds + currentUptimeSeconds;
                    
                    // Jika total uptime sudah melebihi atau sama dengan limit, putus koneksi dan disable user
                    if (totalUptimeSeconds >= limitSeconds) {
                        // Jika user sudah disabled, skip (tidak perlu disable lagi)
                        if (isDisabled) {
                            continue;
                        }
                        
                        console.log(`[Uptime Monitor] Uptime habis untuk ${username} (${totalUptimeSeconds}s >= ${limitSeconds}s), memutus koneksi dan menonaktifkan user...`);
                        try {
                            // 1. Putus koneksi aktif terlebih dahulu (jika ada)
                            if (activeUser) {
                                const disconnectResult = await disconnectHotspotUser(username, router);
                                if (disconnectResult.success) {
                                    console.log(`[Uptime Monitor] Koneksi ${username} berhasil diputus karena uptime habis`);
                                }
                            }
                            
                            // 2. Disable user agar tidak bisa login lagi
                            const disableResult = await disableHotspotUser(username, router);
                            if (disableResult.success) {
                                console.log(`[Uptime Monitor] User ${username} berhasil dinonaktifkan karena uptime habis`);
                            } else {
                                console.error(`[Uptime Monitor] Gagal menonaktifkan user ${username}: ${disableResult.message}`);
                            }
                            
                            // 3. Update logout time di database
                            const logoutTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
                            await saveVoucherLogout(username, router.id, logoutTime);
                        } catch (e) {
                            console.error(`[Uptime Monitor] Error memutus koneksi/disable user ${username}:`, e.message);
                        }
                    }
                }
            } catch (e) {
                console.error(`Error monitoring uptime for router ${router.name}:`, e.message);
            }
        }
        
        db.close();
    } catch (error) {
        console.error('Error in monitorAndDisconnectExpiredUptime:', error);
    }
}

// POST: Manual check dan disable voucher yang validity-nya sudah habis
router.post('/check-expired-vouchers', async (req, res) => {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');
        
        // Ambil semua router
        const routers = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        let totalChecked = 0;
        let totalDisabled = 0;
        const disabledUsers = [];
        
        for (const router of routers) {
            try {
                const conn = await getMikrotikConnectionForRouter(router);
                const allUsers = await conn.write('/ip/hotspot/user/print');
                
                for (const userConfig of allUsers) {
                    const username = userConfig.name;
                    if (!username) continue;
                    
                    totalChecked++;
                    
                    // Skip jika user sudah disabled
                    const isDisabled = userConfig.disabled === 'true' || userConfig.disabled === true;
                    if (isDisabled) continue;
                    
                    // Cek limit-uptime (validity) dari Mikrotik
                    const limitUptime = userConfig['limit-uptime'] || '';
                    
                    // Jika tidak ada limit-uptime, skip
                    if (!limitUptime || limitUptime === '' || limitUptime === 'Unlimited') continue;
                    
                    // Cek format "0d 00:00:00" atau format lain yang menunjukkan 0
                    const limitUptimeTrimmed = limitUptime.trim();
                    const isZeroValidity = limitUptimeTrimmed === '0d 00:00:00' || 
                                         limitUptimeTrimmed === '0d00:00:00' ||
                                         limitUptimeTrimmed === '0d' ||
                                         limitUptimeTrimmed === '00:00:00' ||
                                         limitUptimeTrimmed === '0s' ||
                                         limitUptimeTrimmed === '0';
                    
                    // Parse limit-uptime ke detik
                    const limitSeconds = parseTimeToSeconds(limitUptime);
                    
                    // Cek juga dari database voucher_data (lebih akurat)
                    let isExpiredFromDatabase = false;
                    const voucherData = await getVoucherData(username);
                    if (voucherData && voucherData.first_login && voucherData.validity_limit) {
                        const now = Math.floor(Date.now() / 1000);
                        const elapsedSinceFirstLogin = now - voucherData.first_login;
                        if (elapsedSinceFirstLogin > voucherData.validity_limit) {
                            isExpiredFromDatabase = true;
                            console.log(`[Check Expired] ⏰ ${username}: Validity habis berdasarkan database (elapsed: ${elapsedSinceFirstLogin}s > limit: ${voucherData.validity_limit}s)`);
                        }
                    }
                    
                    // Jika limit-uptime sudah habis ATAU validity habis berdasarkan database, hapus user
                    if (isZeroValidity || limitSeconds <= 0 || isExpiredFromDatabase) {
                        try {
                            // Disconnect user jika sedang aktif
                            try {
                                await disconnectHotspotUser(username, router);
                            } catch (e) {
                                // User mungkin tidak aktif
                            }
                            
                            // Hapus voucher dari Mikrotik
                            const deleteResult = await deleteHotspotUser(username, router);
                            
                            if (deleteResult && deleteResult.success) {
                                totalDisabled++;
                                disabledUsers.push({
                                    username: username,
                                    router: router.name,
                                    limit_uptime: limitUptime
                                });
                                
                                // Update voucher_data jika ada
                                const voucherData = await getVoucherData(username);
                                if (voucherData) {
                                    const updateDb = new sqlite3.Database('./data/billing.db');
                                    updateDb.run(`
                                        UPDATE voucher_data 
                                        SET status = 'expired', updated_at = CURRENT_TIMESTAMP 
                                        WHERE voucher_code = ?
                                    `, [username], () => {
                                        updateDb.close();
                                    });
                                }
                            }
                        } catch (e) {
                            console.error(`Error deleting user ${username}:`, e);
                        }
                    }
                }
            } catch (e) {
                console.error(`Error checking router ${router.name}:`, e);
            }
        }
        
        db.close();
        
        res.json({
            success: true,
            message: `Pengecekan selesai. ${totalDisabled} voucher dihapus dari Mikrotik dari ${totalChecked} voucher yang dicek.`,
            total_checked: totalChecked,
            total_deleted: totalDisabled,
            deleted_users: disabledUsers
        });
    } catch (error) {
        console.error('Error in check-expired-vouchers:', error);
        res.status(500).json({
            success: false,
            message: 'Error: ' + error.message
        });
    }
});

// Jalankan monitoring setiap 30 detik
setInterval(() => {
    console.log('[Voucher Monitoring] 🔄 Memulai monitoring voucher (scheduled)...');
    monitorVoucherLoginLogout().catch(err => {
        console.error('[Voucher Monitoring] ❌ Error in scheduled monitoring:', err);
        console.error('[Voucher Monitoring] Stack:', err.stack);
    });
}, 30000); // 30 detik

// Jalankan monitoring sekali saat aplikasi start
console.log('[Voucher Monitoring] 🚀 Memulai monitoring voucher pertama kali...');
setTimeout(() => {
    monitorVoucherLoginLogout().catch(err => {
        console.error('[Voucher Monitoring] ❌ Error in initial monitoring:', err);
    });
}, 5000); // Tunggu 5 detik setelah aplikasi start

// Jalankan monitoring uptime setiap 10 detik untuk memutus koneksi yang habis
setInterval(() => {
    monitorAndDisconnectExpiredUptime().catch(err => {
        console.error('Error in uptime monitoring:', err);
    });
}, 10000); // 10 detik

// Export fungsi helper untuk digunakan di modul lain
module.exports = router;
module.exports.createOrUpdateVoucherData = createOrUpdateVoucherData;
module.exports.getVoucherData = getVoucherData;
module.exports.handleVoucherLogin = handleVoucherLogin;
module.exports.updateVoucherUsage = updateVoucherUsage;
module.exports.parseTimeToSeconds = parseTimeToSeconds;
