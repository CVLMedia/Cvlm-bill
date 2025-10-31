const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { 
    addPPPoEUser, 
    editPPPoEUser, 
    deletePPPoEUser, 
    getPPPoEProfiles, 
    addPPPoEProfile, 
    editPPPoEProfile, 
    deletePPPoEProfile, 
    getPPPoEProfileDetail,
    getHotspotProfiles,
    addHotspotProfile,
    editHotspotProfile,
    deleteHotspotProfile,
    getHotspotProfileDetail,
    getMikrotikConnectionForRouter
} = require('../config/mikrotik');
const { kickPPPoEUser } = require('../config/mikrotik2');
const fs = require('fs');
const path = require('path');
const { getSettingsWithCache } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

// GET: List User PPPoE
router.get('/mikrotik', adminAuth, async (req, res) => {
  try {
    // Aggregate across all NAS
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || [])));
    db.close();

    let combined = [];
    for (const r of routers) {
      try {
        const conn = await getMikrotikConnectionForRouter(r);
        const [secrets, active] = await Promise.all([
          conn.write('/ppp/secret/print'),
          conn.write('/ppp/active/print')
        ]);
        const activeNames = new Set((active || []).map(a => a.name));
        (secrets || []).forEach(sec => {
          combined.push({
            id: sec['.id'],
            name: sec.name,
            password: sec.password,
            profile: sec.profile,
            active: activeNames.has(sec.name),
            nas_name: r.name,
            nas_ip: r.nas_ip
          });
        });
      } catch (e) {
        // Skip this NAS on error
      }
    }
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', { 
      users: combined, 
      routers,
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  } catch (err) {
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', { 
      users: [], 
      error: 'Gagal mengambil data user PPPoE.', 
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// POST: Tambah User PPPoE
router.post('/mikrotik/add-user', adminAuth, async (req, res) => {
  try {
    const { username, password, profile, router_id } = req.body;
    if (!router_id) return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    // Pass routerObj via lookup to addPPPoEUser
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const router = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => resolve(row || null)));
    db.close();
    if (!router) return res.json({ success: false, message: 'Router tidak ditemukan' });
    await addPPPoEUser({ username, password, profile, routerObj: router });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit User PPPoE
router.post('/mikrotik/edit-user', adminAuth, async (req, res) => {
  try {
    const { id, username, password, profile } = req.body;
    await editPPPoEUser({ id, username, password, profile });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus User PPPoE
router.post('/mikrotik/delete-user', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    await deletePPPoEUser(id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: List Profile PPPoE
router.get('/mikrotik/profiles', adminAuth, async (req, res) => {
  try {
    // Fetch routers from database
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || [])));
    db.close();

    // Aggregate profiles from all NAS
    let profiles = [];
    for (const router of routers) {
      try {
        const result = await getPPPoEProfiles(router);
        if (result.success && Array.isArray(result.data)) {
          result.data.forEach(prof => {
            profiles.push({
              ...prof,
              nas_id: router.id,
              nas_name: router.name,
              nas_ip: router.nas_ip
            });
          });
        }
      } catch (e) {
        console.error(`Error getting profiles from ${router.name}:`, e.message);
      }
    }

    const settings = getSettingsWithCache();
    res.render('adminMikrotikProfiles', { 
      profiles: profiles, 
      routers: routers,
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  } catch (err) {
    console.error('Error loading PPPoE profiles:', err);
    const settings = getSettingsWithCache();
    res.render('adminMikrotikProfiles', { 
      profiles: [], 
      routers: [],
      error: 'Gagal mengambil data profile PPPoE.', 
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API Daftar Profile PPPoE (untuk dropdown)
router.get('/mikrotik/profiles/api', adminAuth, async (req, res) => {
  try {
    const { router_id } = req.query;
    
    // If router_id is provided, only fetch from that router
    if (router_id) {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
      if (!routerObj) {
        return res.json({ success: false, profiles: [], message: 'Router tidak ditemukan' });
      }
      const result = await getPPPoEProfiles(routerObj);
      if (result.success) {
        res.json({ success: true, profiles: result.data });
      } else {
        res.json({ success: false, profiles: [], message: result.message });
      }
    } else {
      // Fetch from all routers (aggregate)
      const result = await getPPPoEProfiles();
      if (result.success) {
        res.json({ success: true, profiles: result.data });
      } else {
        res.json({ success: false, profiles: [], message: result.message });
      }
    }
  } catch (err) {
    res.json({ success: false, profiles: [], message: err.message });
  }
});

// GET: API Detail Profile PPPoE
router.get('/mikrotik/profile/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await getPPPoEProfileDetail(id);
    if (result.success) {
      res.json({ success: true, profile: result.data });
    } else {
      res.json({ success: false, profile: null, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profile: null, message: err.message });
  }
});

// POST: Tambah Profile PPPoE
router.post('/mikrotik/add-profile', adminAuth, async (req, res) => {
  try {
    const { router_id, ...profileData } = req.body;
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    
    const result = await addPPPoEProfile(profileData, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Profile PPPoE
router.post('/mikrotik/edit-profile', adminAuth, async (req, res) => {
  try {
    const { router_id, ...profileData } = req.body;
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    
    const result = await editPPPoEProfile(profileData, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus Profile PPPoE
router.post('/mikrotik/delete-profile', adminAuth, async (req, res) => {
  try {
    const { id, router_id } = req.body;
    let routerObj = null;
    if (router_id) {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
    }
    const result = await deletePPPoEProfile(id, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: List Profile Hotspot
router.get('/mikrotik/hotspot-profiles', adminAuth, async (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
      if (err) {
        console.error('Error fetching routers:', err);
        resolve([]);
      } else {
        resolve(rows || []);
      }
    }));
    db.close();

    if (!routers || routers.length === 0) {
      console.warn('No routers found in database');
      const settings = getSettingsWithCache();
      return res.render('adminMikrotikHotspotProfiles', { 
        profiles: [], 
        routers: [],
        error: 'Tidak ada router/NAS yang dikonfigurasi. Silakan tambahkan router terlebih dahulu di menu NAS (RADIUS).', 
        settings,
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    }

    let combined = [];
    let errorMessages = [];
    for (const r of routers) {
      try {
        console.log(`=== Attempting to get hotspot profiles from router: ${r.name} (${r.nas_ip}:${r.port || 8728}) ===`);
        console.log(`Router data:`, JSON.stringify({
          id: r.id,
          name: r.name,
          nas_ip: r.nas_ip,
          port: r.port,
          user: r.user ? '***' : 'missing',
          password: r.password ? '***' : 'missing'
        }));
        
        const result = await getHotspotProfiles(r);
        console.log(`Result from ${r.name}:`, {
          success: result.success,
          message: result.message,
          dataCount: result.data ? result.data.length : 0
        });
        
        if (result.success && Array.isArray(result.data)) {
          console.log(`✓ Successfully retrieved ${result.data.length} profiles from ${r.name}`);
          if (result.data.length > 0) {
            console.log(`Profile names:`, result.data.map(p => p.name || p['name'] || 'unnamed').join(', '));
          }
          result.data.forEach(prof => {
            const profileObj = {
              ...prof,
              nas_id: r.id,
              nas_name: r.name,
              nas_ip: r.nas_ip
            };
            combined.push(profileObj);
            console.log(`  - Added profile: ${prof.name || prof['name'] || 'unnamed'} from ${r.name}`);
          });
        } else {
          console.warn(`✗ Failed to get profiles from ${r.name}:`, result.message);
          errorMessages.push(`${r.name}: ${result.message}`);
        }
      } catch (e) {
        console.error(`✗ Error getting hotspot profiles from ${r.name} (${r.nas_ip}:${r.port || 8728}):`, e.message);
        console.error('Full error:', e);
        errorMessages.push(`${r.name}: ${e.message}`);
      }
    }
    
    console.log(`=== Total profiles collected: ${combined.length} ===`);
    
    const settings = getSettingsWithCache();
    res.render('adminMikrotikHotspotProfiles', { 
      profiles: combined, 
      routers,
      settings,
      error: errorMessages.length > 0 ? `Beberapa router gagal: ${errorMessages.join('; ')}` : null,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  } catch (err) {
    console.error('Error in hotspot profiles GET route:', err);
    const settings = getSettingsWithCache();
    res.render('adminMikrotikHotspotProfiles', { 
      profiles: [], 
      routers: [],
      error: `Gagal mengambil data profile Hotspot: ${err.message}`, 
      settings,
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API Daftar Profile Hotspot
router.get('/mikrotik/hotspot-profiles/api', adminAuth, async (req, res) => {
  try {
    const { router_id } = req.query;
    
    // If router_id is provided, only fetch from that router
    if (router_id) {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
      if (!routerObj) {
        return res.json({ success: false, profiles: [], message: 'Router tidak ditemukan' });
      }
      const result = await getHotspotProfiles(routerObj);
      if (result.success) {
        // Ensure router info is attached
        const profilesWithRouter = result.data.map(prof => ({
          ...prof,
          nas_id: routerObj.id,
          nas_name: routerObj.name,
          nas_ip: routerObj.nas_ip
        }));
        return res.json({ success: true, profiles: profilesWithRouter });
      } else {
        return res.json({ success: false, profiles: [], message: result.message });
      }
    }
    
    // If no router_id, fetch from ALL routers (same logic as GET route)
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => {
      if (err) {
        console.error('Error fetching routers:', err);
        resolve([]);
      } else {
        resolve(rows || []);
      }
    }));
    db.close();
    
    if (!routers || routers.length === 0) {
      return res.json({ success: false, profiles: [], message: 'Tidak ada router/NAS yang dikonfigurasi' });
    }
    
    let combined = [];
    let errorMessages = [];
    for (const r of routers) {
      try {
        console.log(`=== API: Attempting to get hotspot profiles from router: ${r.name} (${r.nas_ip}:${r.port || 8728}) ===`);
        const result = await getHotspotProfiles(r);
        console.log(`=== API: Result from ${r.name}:`, {
          success: result.success,
          message: result.message,
          dataCount: result.data ? result.data.length : 0
        });
        
        if (result.success && Array.isArray(result.data)) {
          console.log(`✓ API: Successfully retrieved ${result.data.length} profiles from ${r.name}`);
          result.data.forEach(prof => {
            const profileObj = {
              ...prof,
              nas_id: r.id,
              nas_name: r.name,
              nas_ip: r.nas_ip
            };
            combined.push(profileObj);
            console.log(`  - API: Added profile: ${prof.name || prof['name'] || 'unnamed'} from ${r.name} (nas_id: ${r.id}, nas_name: ${r.name}, nas_ip: ${r.nas_ip})`);
          });
        } else {
          console.warn(`✗ API: Failed to get profiles from ${r.name}:`, result.message);
          errorMessages.push(`${r.name}: ${result.message}`);
        }
      } catch (e) {
        console.error(`✗ API: Error getting hotspot profiles from ${r.name} (${r.nas_ip}:${r.port || 8728}):`, e.message);
        errorMessages.push(`${r.name}: ${e.message}`);
      }
    }
    
    console.log(`=== API: Total profiles collected: ${combined.length} ===`);
    
    res.json({ 
      success: true, 
      profiles: combined,
      error: errorMessages.length > 0 ? `Beberapa router gagal: ${errorMessages.join('; ')}` : null
    });
  } catch (err) {
    console.error('Error in hotspot profiles API route:', err);
    res.json({ success: false, profiles: [], message: err.message });
  }
});

// GET: API Detail Profile Hotspot
router.get('/mikrotik/hotspot-profiles/detail/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { router_id } = req.query;
    let routerObj = null;
    if (router_id) {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
        db.close();
        resolve(row || null);
      }));
    }
    const result = await getHotspotProfileDetail(id, routerObj);
    if (result.success) {
      res.json({ success: true, profile: result.data });
    } else {
      res.json({ success: false, profile: null, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profile: null, message: err.message });
  }
});

// POST: Tambah Profile Hotspot
router.post('/mikrotik/hotspot-profiles/add', adminAuth, async (req, res) => {
  try {
    const { router_id, id, ...profileData } = req.body;
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    // Clean profileData: remove undefined, null, empty strings, and unsupported parameters
    // Note: local-address, remote-address, dns-server, parent-queue, address-list
    // are NOT supported for hotspot user profile in Mikrotik
    const cleanProfileData = {};
    const unsupportedParams = ['local-address', 'remote-address', 'dns-server', 'parent-queue', 'address-list'];
    Object.keys(profileData).forEach(key => {
      const value = profileData[key];
      // Skip unsupported parameters and null/undefined values
      // Empty strings are OK for optional fields, they will be filtered in addHotspotProfile
      if (value !== undefined && value !== null && !unsupportedParams.includes(key)) {
        cleanProfileData[key] = value;
      }
    });
    console.log('Cleaned profileData for add:', cleanProfileData);
    const result = await addHotspotProfile(cleanProfileData, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Profile Hotspot
router.post('/mikrotik/hotspot-profiles/edit', adminAuth, async (req, res) => {
  try {
    const { router_id, ...profileData } = req.body;
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    if (!profileData.id) {
      return res.json({ success: false, message: 'ID profile tidak ditemukan' });
    }
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    // Clean profileData: remove undefined, null values, and unsupported parameters
    // Note: local-address, remote-address, dns-server, parent-queue, address-list
    // are NOT supported for hotspot user profile in Mikrotik
    const cleanProfileData = {};
    const unsupportedParams = ['local-address', 'remote-address', 'dns-server', 'parent-queue', 'address-list'];
    Object.keys(profileData).forEach(key => {
      const value = profileData[key];
      // Skip unsupported parameters and null/undefined values
      if (value !== undefined && value !== null && !unsupportedParams.includes(key)) {
        cleanProfileData[key] = value;
      }
    });
    console.log('Cleaned profileData for edit:', cleanProfileData);
    const result = await editHotspotProfile(cleanProfileData, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Hapus Profile Hotspot
router.post('/mikrotik/hotspot-profiles/delete', adminAuth, async (req, res) => {
  try {
    const { id, router_id } = req.body;
    if (!router_id) {
      return res.json({ success: false, message: 'Pilih NAS (router) terlebih dahulu' });
    }
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routerObj = await new Promise((resolve) => db.get('SELECT * FROM routers WHERE id=?', [parseInt(router_id)], (err, row) => {
      db.close();
      resolve(row || null);
    }));
    if (!routerObj) {
      return res.json({ success: false, message: 'Router tidak ditemukan' });
    }
    const result = await deleteHotspotProfile(id, routerObj);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Putuskan sesi PPPoE user
router.post('/mikrotik/disconnect-session', adminAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ success: false, message: 'Username tidak boleh kosong' });
    const result = await kickPPPoEUser(username);
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: Get PPPoE user statistics
router.get('/mikrotik/user-stats', adminAuth, async (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
    const routers = await new Promise((resolve) => db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || [])));
    db.close();
    let totalUsers = 0, activeUsers = 0;
    for (const r of routers) {
      try {
        const conn = await getMikrotikConnectionForRouter(r);
        const [secrets, active] = await Promise.all([
          conn.write('/ppp/secret/print'),
          conn.write('/ppp/active/print')
        ]);
        totalUsers += Array.isArray(secrets) ? secrets.length : 0;
        activeUsers += Array.isArray(active) ? active.length : 0;
      } catch (_) {}
    }
    const offlineUsers = Math.max(totalUsers - activeUsers, 0);
    
    res.json({ 
      success: true, 
      totalUsers, 
      activeUsers, 
      offlineUsers 
    });
  } catch (err) {
    console.error('Error getting PPPoE user stats:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message,
      totalUsers: 0,
      activeUsers: 0,
      offlineUsers: 0
    });
  }
});

// POST: Restart Mikrotik
router.post('/mikrotik/restart', adminAuth, async (req, res) => {
  try {
    const { restartRouter } = require('../config/mikrotik');
    const result = await restartRouter();
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
