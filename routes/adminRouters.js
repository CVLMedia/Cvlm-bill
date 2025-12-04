const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const axios = require('axios');
const { getSettingsWithCache } = require('../config/settingsManager');

// List routers page (includes GenieACS servers management)
router.get('/routers', adminAuth, async (req, res) => {
  try {
    const billingManager = require('../config/billing');
    if (!billingManager || !billingManager.db) {
      return res.status(500).render('error', { message: 'Database connection tidak tersedia', error: 'BillingManager not initialized' });
    }
    const db = billingManager.db;
    
    await new Promise((resolve) => db.run(`CREATE TABLE IF NOT EXISTS routers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, nas_ip TEXT NOT NULL, nas_identifier TEXT, secret TEXT, location TEXT, pop TEXT, port INTEGER, user TEXT, password TEXT, genieacs_server_id INTEGER, UNIQUE(nas_ip))`, () => resolve()));
    // Best-effort schema extension for existing installs
    db.run(`ALTER TABLE routers ADD COLUMN location TEXT`, () => {});
    db.run(`ALTER TABLE routers ADD COLUMN pop TEXT`, () => {});
    db.run(`ALTER TABLE routers ADD COLUMN port INTEGER DEFAULT 8728`, () => {});
    db.run(`ALTER TABLE routers ADD COLUMN user TEXT`, () => {});
    db.run(`ALTER TABLE routers ADD COLUMN password TEXT`, () => {});
    db.run(`ALTER TABLE routers ADD COLUMN genieacs_server_id INTEGER`, () => {});
    // Create genieacs_servers table
    await new Promise((resolve) => db.run(`CREATE TABLE IF NOT EXISTS genieacs_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(url)
    )`, () => resolve()));
    
    // Get GenieACS servers for dropdown and list
    console.log('[GenieACS] Starting to fetch servers from database...');
    console.log('[GenieACS] Database connection:', db ? 'OK' : 'NULL');
    
    const genieacsServers = await new Promise((resolve, reject) => {
      // Direct query - no nested callbacks
      db.all(`SELECT gs.*, 
              COALESCE((SELECT COUNT(*) FROM routers WHERE genieacs_server_id = gs.id), 0) as router_count
              FROM genieacs_servers gs 
              ORDER BY gs.id DESC`, (err, rows) => {
        if (err) {
          console.error('[GenieACS] ❌ Error fetching servers:', err);
          console.error('[GenieACS] Error details:', err.message, err.code);
          reject(err);
        } else {
          console.log('[GenieACS] ✅ Query executed successfully');
          console.log('[GenieACS] Fetched', rows ? rows.length : 0, 'servers from database');
          if (rows && rows.length > 0) {
            console.log('[GenieACS] Server data sample:', rows[0]);
          } else {
            console.log('[GenieACS] ⚠️ No servers found in database');
            // Double check with a simple count query
            db.get(`SELECT COUNT(*) as count FROM genieacs_servers`, (countErr, countRow) => {
              if (!countErr && countRow) {
                console.log('[GenieACS] Count query result:', countRow.count);
              }
            });
          }
          resolve(rows || []);
        }
      });
    });
    
    // Get routers
    const routers = await new Promise((resolve, reject) => {
      db.all(`SELECT r.*, g.name as genieacs_server_name, g.url as genieacs_server_url 
              FROM routers r 
              LEFT JOIN genieacs_servers g ON r.genieacs_server_id = g.id 
              ORDER BY r.id`, (err, rows) => {
        if (err) {
          console.error('[Routers] Error fetching routers:', err);
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
    
    // Debug: Log data before rendering
    console.log('[Routers] Rendering page with:');
    console.log('  - Routers count:', routers ? routers.length : 0);
    console.log('  - GenieACS Servers count:', genieacsServers ? genieacsServers.length : 0);
    if (genieacsServers && genieacsServers.length > 0) {
      console.log('  - GenieACS Servers data:', genieacsServers);
    }
    
    const settings = getSettingsWithCache();
    res.render('admin/routers', { 
      title: 'Set Koneksi', 
      routers: routers || [], 
      genieacsServers: genieacsServers || [], 
      page: 'routers', 
      settings 
    });
  } catch (e) {
    console.error('[Routers] Error loading page:', e);
    res.status(500).render('error', { message: 'Gagal memuat koneksi', error: e.message });
  }
});

// Add router
router.post('/routers', adminAuth, async (req, res) => {
  try {
    const { name, nas_ip, nas_identifier, location, pop, port, user, password, genieacs_server_id } = req.body;
    if (!name || !nas_ip || !user || !password) return res.json({ success: false, message: 'Nama, NAS IP, user, dan password wajib diisi' });
    const portToUse = parseInt(port || 8728);
    const genieacsServerId = genieacs_server_id ? parseInt(genieacs_server_id) : null;
    const db = require('../config/billing').db;
    db.run(`INSERT INTO routers (name, nas_ip, nas_identifier, location, pop, port, user, password, genieacs_server_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [name.trim(), nas_ip.trim(), (nas_identifier||'').trim(), (location||'').trim(), (pop||'').trim(), portToUse, user, password, genieacsServerId], function(err){
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true, id: this.lastID });
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Edit router
router.post('/routers/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, nas_ip, nas_identifier, location, pop, port, user, password, genieacs_server_id } = req.body;
    const portToUse2 = parseInt(port || 8728);
    const genieacsServerId = genieacs_server_id ? parseInt(genieacs_server_id) : null;
    const db = require('../config/billing').db;
    db.run(`UPDATE routers SET name=?, nas_ip=?, nas_identifier=?, location=?, pop=?, port=?, user=?, password=?, genieacs_server_id=? WHERE id=?`, [name, nas_ip, nas_identifier, location, pop, portToUse2, user, password, genieacsServerId, id], function(err){
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true });
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Delete router
router.post('/routers/:id/delete', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const db = require('../config/billing').db;
    db.run(`DELETE FROM routers WHERE id=?`, [id], function(err){
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true });
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Tambah endpoint test koneksi Mikrotik per NAS
router.post('/routers/:id/test', adminAuth, async (req, res) => {
  try {
    const db = require('../config/billing').db;
    db.get(`SELECT * FROM routers WHERE id=?`, [req.params.id], async (err, row) => {
      if (err) return res.json({ success: false, message: err.message });
      if (!row) return res.json({ success: false, message: 'Router tidak ditemukan' });
      try {
        const { getMikrotikConnectionForRouter, getRouterIdentity } = require('../config/mikrotik');
        const conn = await getMikrotikConnectionForRouter(row);
        const identity = await conn.write('/system/identity/print');
        
        // Log activity - Connect Mikrotik
        try {
          const { logActivity } = require('../utils/activityLogger');
          const username = req.session?.admin?.username || req.session?.adminUser || 'admin';
          logActivity(
            username,
            'admin',
            'mikrotik_connect',
            `Connect Mikrotik: ${row.name || row.nas_ip} (${row.nas_ip}:${row.port || 8728}) - Status: Connected`,
            req.ip,
            req.get('User-Agent')
          ).catch(err => console.error('Failed to log activity:', err));
        } catch (logErr) {
          console.error('Error logging Mikrotik connection:', logErr);
        }
        
        res.json({ success: true, identity: identity && identity[0] ? identity[0].name || identity[0]['name'] : 'connected', host: row.nas_ip, port: row.port || 8728 });
      } catch (e) {
        // Log activity - Disconnect/Failed Mikrotik
        try {
          const { logActivity } = require('../utils/activityLogger');
          const username = req.session?.admin?.username || req.session?.adminUser || 'admin';
          logActivity(
            username,
            'admin',
            'mikrotik_disconnect',
            `Disconnect/Failed Mikrotik: ${row.name || row.nas_ip} (${row.nas_ip}:${row.port || 8728}) - Error: ${e.message}`,
            req.ip,
            req.get('User-Agent')
          ).catch(err => console.error('Failed to log activity:', err));
        } catch (logErr) {
          console.error('Error logging Mikrotik disconnection:', logErr);
        }
        
        res.json({ success: false, message: e.message });
      }
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ========== GenieACS Servers Management ==========

// Add GenieACS server
router.post('/routers/genieacs-servers', adminAuth, async (req, res) => {
  try {
    const { name, url, username, password, description } = req.body;
    
    // Log received data for debugging
    console.log('[GenieACS] Add server request:', { name, url, username, password: password ? '***' : 'empty', description });
    
    if (!name || !url || !username || !password) {
      console.log('[GenieACS] Validation failed: missing required fields');
      return res.json({ success: false, message: 'Nama, URL, Username, dan Password wajib diisi' });
    }
    
    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      console.log('[GenieACS] Validation failed: invalid URL format');
      return res.json({ success: false, message: 'Format URL tidak valid' });
    }
    
    // Get database connection from billing manager
    const billingManager = require('../config/billing');
    if (!billingManager || !billingManager.db) {
      console.error('[GenieACS] BillingManager or database not available');
      return res.json({ success: false, message: 'Database connection tidak tersedia' });
    }
    const db = billingManager.db;
    
    // Verify table exists first
    db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='genieacs_servers'`, (tableErr, tableRow) => {
      if (tableErr) {
        console.error('[GenieACS] Error checking table:', tableErr);
        return res.json({ success: false, message: 'Error checking database table: ' + tableErr.message });
      }
      
      if (!tableRow) {
        console.error('[GenieACS] Table genieacs_servers does not exist');
        return res.json({ success: false, message: 'Table genieacs_servers tidak ditemukan' });
      }
      
      console.log('[GenieACS] Table exists, inserting data...');
      console.log('[GenieACS] Inserting:', { name: name.trim(), url: url.trim(), username: username.trim(), password: '***', description: (description||'').trim() });
      
      // Use the same simple approach as router insert
      db.run(`INSERT INTO genieacs_servers (name, url, username, password, description) VALUES (?, ?, ?, ?, ?)`, 
        [name.trim(), url.trim(), username.trim(), password.trim(), (description||'').trim()], 
        function(insertErr) {
          if (insertErr) {
            console.error('[GenieACS] ❌ INSERT error:', insertErr.message);
            console.error('[GenieACS] Error code:', insertErr.code);
            return res.json({ success: false, message: insertErr.message });
          }
          
          const insertedId = this.lastID;
          const rowsAffected = this.changes;
          
          console.log('[GenieACS] ✅ INSERT completed');
          console.log('[GenieACS] this.lastID:', insertedId);
          console.log('[GenieACS] Rows affected:', rowsAffected);
          
          if (!insertedId || insertedId === 0) {
            console.error('[GenieACS] ❌ lastID is 0 or undefined!');
            // Fallback: query by name and url
            db.get(`SELECT id FROM genieacs_servers WHERE name = ? AND url = ? ORDER BY id DESC LIMIT 1`, 
              [name.trim(), url.trim()], (queryErr, row) => {
                if (queryErr || !row || !row.id) {
                  console.error('[GenieACS] ❌ Fallback query also failed:', queryErr);
                  return res.json({ success: false, message: 'Insert berhasil tapi gagal mendapatkan ID' });
                }
                console.log('[GenieACS] ✅ Found with fallback query, ID:', row.id);
                res.json({ success: true, id: row.id, message: 'GenieACS server berhasil ditambahkan' });
              });
            return;
          }
          
          // Verify data exists
          db.get(`SELECT * FROM genieacs_servers WHERE id = ?`, [insertedId], (verifyErr, verifyRow) => {
            if (verifyErr || !verifyRow) {
              console.error('[GenieACS] ❌ Verification failed, trying fallback...');
              // Fallback: query by name and url
              db.get(`SELECT id FROM genieacs_servers WHERE name = ? AND url = ? ORDER BY id DESC LIMIT 1`, 
                [name.trim(), url.trim()], (fallbackErr, fallbackRow) => {
                  if (fallbackErr || !fallbackRow || !fallbackRow.id) {
                    console.error('[GenieACS] ❌ All methods failed');
                    return res.json({ success: false, message: 'Insert berhasil tapi data tidak ditemukan' });
                  }
                  console.log('[GenieACS] ✅ Found with fallback, ID:', fallbackRow.id);
                  res.json({ success: true, id: fallbackRow.id, message: 'GenieACS server berhasil ditambahkan' });
                });
              return;
            }
            
            console.log('[GenieACS] ✅ Data verified, ID:', insertedId);
            res.json({ success: true, id: insertedId, message: 'GenieACS server berhasil ditambahkan' });
          });
        });
    });
  } catch (e) {
    console.error('[GenieACS] Error adding server:', e);
    res.json({ success: false, message: e.message || 'Terjadi kesalahan saat menambahkan server' }); 
  }
});

// Edit GenieACS server
router.post('/routers/genieacs-servers/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, url, username, password, description } = req.body;
    if (!name || !url || !username) {
      return res.json({ success: false, message: 'Nama, URL, dan Username wajib diisi' });
    }
    
    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.json({ success: false, message: 'Format URL tidak valid' });
    }
    
    const billingManager = require('../config/billing');
    if (!billingManager || !billingManager.db) {
      console.error('[GenieACS] BillingManager or database not available');
      return res.json({ success: false, message: 'Database connection tidak tersedia' });
    }
    const db = billingManager.db;
    
    // Jika password kosong/undefined, tidak update password
    if (password && password.trim() !== '') {
      db.run(`UPDATE genieacs_servers SET name=?, url=?, username=?, password=?, description=? WHERE id=?`, 
        [name.trim(), url.trim(), username.trim(), password.trim(), (description||'').trim(), id], 
        function(err) {
          if (err) {
            console.error('[GenieACS] Database error updating server:', err.message);
            return res.json({ success: false, message: err.message });
          }
          console.log('[GenieACS] Server updated successfully:', id);
          res.json({ success: true, message: 'GenieACS server berhasil diupdate' });
        });
    } else {
      // Update tanpa password
      db.run(`UPDATE genieacs_servers SET name=?, url=?, username=?, description=? WHERE id=?`, 
        [name.trim(), url.trim(), username.trim(), (description||'').trim(), id], 
        function(err) {
          if (err) {
            console.error('[GenieACS] Database error updating server:', err.message);
            return res.json({ success: false, message: err.message });
          }
          console.log('[GenieACS] Server updated successfully (without password):', id);
          res.json({ success: true, message: 'GenieACS server berhasil diupdate' });
        });
    }
  } catch (e) {
    console.error('[GenieACS] Error updating server:', e);
    res.json({ success: false, message: e.message || 'Terjadi kesalahan saat mengupdate server' }); 
  }
});

// Test endpoint to check database
router.get('/routers/genieacs-servers/test', adminAuth, async (req, res) => {
  try {
    const billingManager = require('../config/billing');
    if (!billingManager || !billingManager.db) {
      return res.json({ success: false, message: 'Database connection tidak tersedia' });
    }
    const db = billingManager.db;
    
    db.get(`SELECT COUNT(*) as count FROM genieacs_servers`, (err, row) => {
      if (err) {
        return res.json({ success: false, message: err.message, error: err });
      }
      res.json({ success: true, count: row ? row.count : 0, message: 'Database connection OK' });
    });
  } catch (e) {
    res.json({ success: false, message: e.message, error: e });
  }
});

// Delete GenieACS server
router.post('/routers/genieacs-servers/:id/delete', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const db = require('../config/billing').db;
    
    // Check if any routers are using this server
    db.get(`SELECT COUNT(*) as count FROM routers WHERE genieacs_server_id = ?`, [id], (err, row) => {
      if (err) return res.json({ success: false, message: err.message });
      if (row && row.count > 0) {
        return res.json({ success: false, message: `Tidak bisa menghapus server karena masih digunakan oleh ${row.count} router(s)` });
      }
      
      db.run(`DELETE FROM genieacs_servers WHERE id=?`, [id], function(err) {
        if (err) return res.json({ success: false, message: err.message });
        res.json({ success: true });
      });
    });
  } catch (e) { 
    res.json({ success: false, message: e.message }); 
  }
});

// Test GenieACS server connection
router.post('/routers/genieacs-servers/:id/test', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const db = require('../config/billing').db;
    db.get(`SELECT * FROM genieacs_servers WHERE id=?`, [id], async (err, row) => {
      if (err) return res.json({ success: false, message: err.message });
      if (!row) return res.json({ success: false, message: 'GenieACS server tidak ditemukan' });
      
      try {
        const response = await axios.get(`${row.url}/devices`, {
          auth: {
            username: row.username,
            password: row.password
          },
          timeout: 5000,
          headers: {
            'Accept': 'application/json'
          }
        });
        
        res.json({ 
          success: true, 
          message: 'Koneksi berhasil',
          details: `Status: ${response.status}, Devices: ${response.data ? response.data.length || 0 : 0}`
        });
      } catch (e) {
        res.json({ 
          success: false, 
          message: 'Gagal koneksi ke GenieACS server',
          details: e.response ? `${e.response.status}: ${e.response.statusText}` : e.message
        });
      }
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

module.exports = router;
