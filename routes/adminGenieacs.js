const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { getSettingsWithCache } = require('../config/settingsManager');

// List GenieACS servers page
router.get('/genieacs', adminAuth, async (req, res) => {
  try {
    const billingManager = require('../config/billing');
    if (!billingManager || !billingManager.db) {
      return res.status(500).render('error', { message: 'Database connection tidak tersedia', error: 'BillingManager not initialized' });
    }
    const db = billingManager.db;
    
    // Ensure genieacs_servers table exists
    await new Promise((resolve) => {
      db.run(`CREATE TABLE IF NOT EXISTS genieacs_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(url)
      )`, () => resolve());
    });
    
    // Get GenieACS servers
    const genieacsServers = await new Promise((resolve, reject) => {
      db.all(`SELECT gs.*, 
              COALESCE((SELECT COUNT(*) FROM routers WHERE genieacs_server_id = gs.id), 0) as router_count
              FROM genieacs_servers gs 
              ORDER BY gs.id DESC`, (err, rows) => {
        if (err) {
          console.error('[GenieACS] Error fetching servers:', err);
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
    
    const settings = getSettingsWithCache();
    res.render('admin/genieacs', { 
      title: 'GenieACS Servers', 
      genieacsServers: genieacsServers || [], 
      page: 'genieacs', 
      settings 
    });
  } catch (e) {
    console.error('[GenieACS] Error loading page:', e);
    res.status(500).render('error', { message: 'Gagal memuat GenieACS servers', error: e.message });
  }
});

// Add GenieACS server
router.post('/genieacs', adminAuth, async (req, res) => {
  try {
    const { name, url, username, password, description } = req.body;
    
    if (!name || !url || !username || !password) {
      return res.json({ success: false, message: 'Nama, URL, Username, dan Password wajib diisi' });
    }
    
    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.json({ success: false, message: 'Format URL tidak valid' });
    }
    
    const billingManager = require('../config/billing');
    if (!billingManager || !billingManager.db) {
      return res.json({ success: false, message: 'Database connection tidak tersedia' });
    }
    const db = billingManager.db;
    
    // Ensure table exists
    await new Promise((resolve) => {
      db.run(`CREATE TABLE IF NOT EXISTS genieacs_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(url)
      )`, () => resolve());
    });
    
    // Insert data
    db.run(`INSERT INTO genieacs_servers (name, url, username, password, description) VALUES (?, ?, ?, ?, ?)`, 
      [name.trim(), url.trim(), username.trim(), password.trim(), (description||'').trim()], 
      function(insertErr) {
        if (insertErr) {
          console.error('[GenieACS] INSERT error:', insertErr.message);
          return res.json({ success: false, message: insertErr.message });
        }
        
        const insertedId = this.lastID;
        console.log('[GenieACS] ✅ INSERT completed, ID:', insertedId);
        
        if (!insertedId || insertedId === 0) {
          // Fallback: query by name and url
          db.get(`SELECT id FROM genieacs_servers WHERE name = ? AND url = ? ORDER BY id DESC LIMIT 1`, 
            [name.trim(), url.trim()], (queryErr, row) => {
              if (queryErr || !row || !row.id) {
                return res.json({ success: false, message: 'Insert berhasil tapi gagal mendapatkan ID' });
              }
              res.json({ success: true, id: row.id, message: 'GenieACS server berhasil ditambahkan' });
            });
          return;
        }
        
        res.json({ success: true, id: insertedId, message: 'GenieACS server berhasil ditambahkan' });
      });
  } catch (e) {
    console.error('[GenieACS] Error adding server:', e);
    res.json({ success: false, message: e.message || 'Terjadi kesalahan saat menambahkan server' });
  }
});

// Update GenieACS server
router.put('/genieacs/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, url, username, password, description } = req.body;
    
    if (!name || !url || !username || !password) {
      return res.json({ success: false, message: 'Nama, URL, Username, dan Password wajib diisi' });
    }
    
    const billingManager = require('../config/billing');
    if (!billingManager || !billingManager.db) {
      return res.json({ success: false, message: 'Database connection tidak tersedia' });
    }
    const db = billingManager.db;
    
    db.run(`UPDATE genieacs_servers SET name = ?, url = ?, username = ?, password = ?, description = ? WHERE id = ?`, 
      [name.trim(), url.trim(), username.trim(), password.trim(), (description||'').trim(), id], 
      function(updateErr) {
        if (updateErr) {
          return res.json({ success: false, message: updateErr.message });
        }
        res.json({ success: true, message: 'GenieACS server berhasil diupdate' });
      });
  } catch (e) {
    res.json({ success: false, message: e.message || 'Terjadi kesalahan saat mengupdate server' });
  }
});

// Delete GenieACS server
router.delete('/genieacs/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const billingManager = require('../config/billing');
    if (!billingManager || !billingManager.db) {
      return res.json({ success: false, message: 'Database connection tidak tersedia' });
    }
    const db = billingManager.db;
    
    db.run(`DELETE FROM genieacs_servers WHERE id=?`, [id], function(err) {
      if (err) {
        return res.json({ success: false, message: err.message });
      }
      res.json({ success: true, message: 'GenieACS server berhasil dihapus' });
    });
  } catch (e) {
    res.json({ success: false, message: e.message || 'Terjadi kesalahan saat menghapus server' });
  }
});

// Test GenieACS connection
router.post('/genieacs/:id/test', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const billingManager = require('../config/billing');
    if (!billingManager || !billingManager.db) {
      return res.json({ success: false, message: 'Database connection tidak tersedia' });
    }
    const db = billingManager.db;
    
    db.get(`SELECT * FROM genieacs_servers WHERE id=?`, [id], async (err, row) => {
      if (err || !row) {
        return res.json({ success: false, message: 'Server tidak ditemukan' });
      }
      
      // Test GenieACS connection
      try {
        const axios = require('axios');
        const testUrl = row.url.endsWith('/') ? row.url.slice(0, -1) : row.url;
        
        console.log(`[GenieACS] Testing connection to: ${testUrl}`);
        console.log(`[GenieACS] Using credentials: ${row.username} / ${row.password ? '***' : '(empty)'}`);
        
        // GenieACS API endpoint is /devices (not /api/devices)
        // Try multiple endpoints in order of preference
        let testEndpoints = [
          `${testUrl}/devices`,  // Standard GenieACS API endpoint
          `${testUrl}/api/devices`,  // Alternative
          `${testUrl}/`,  // Root - will return 404 but confirms server is up
          testUrl  // Base URL
        ];
        
        let lastError = null;
        let lastResponse = null;
        
        for (const endpoint of testEndpoints) {
          try {
            console.log(`[GenieACS] Testing endpoint: ${endpoint}`);
            const response = await axios.get(endpoint, { 
              timeout: 10000, // 10 seconds timeout
              auth: {
                username: row.username || '',
                password: row.password || ''
              },
              headers: {
                'Accept': 'application/json'
              },
              validateStatus: function (status) {
                // Accept any status code (even 401/403/404 means server is reachable)
                return status >= 200 && status < 600;
              }
            });
            
            lastResponse = response;
            
            // If we get 200, connection is successful
            if (response.status === 200) {
              const deviceCount = response.data && Array.isArray(response.data) ? response.data.length : 0;
              return res.json({ 
                success: true,
                message: `Koneksi berhasil! Status: ${response.status}, Devices: ${deviceCount}`, 
                status: response.status,
                endpoint: endpoint,
                deviceCount: deviceCount
              });
            }
            
            // If we get 401/403, server is reachable but auth failed
            if (response.status === 401 || response.status === 403) {
              return res.json({ 
                success: false,
                message: `Server dapat diakses tapi autentikasi gagal (Status: ${response.status}). Periksa username dan password.`, 
                status: response.status,
                endpoint: endpoint
              });
            }
            
            // If we get 404, server is reachable but endpoint not found
            if (response.status === 404) {
              // Check if it's GenieACS server by looking for GenieACS-Version header
              const genieacsVersion = response.headers['genieacs-version'] || response.headers['GenieACS-Version'];
              if (genieacsVersion) {
                return res.json({ 
                  success: true,
                  message: `Server GenieACS aktif (Version: ${genieacsVersion}). Endpoint ${endpoint} tidak ditemukan, tapi server dapat diakses.`, 
                  status: response.status,
                  endpoint: endpoint,
                  version: genieacsVersion
                });
              }
              // Continue to next endpoint
            }
          } catch (endpointError) {
            console.error(`[GenieACS] Error testing ${endpoint}:`, endpointError.message);
            lastError = endpointError;
            // Continue to next endpoint
          }
        }
        
        // If all endpoints failed
        if (lastError) {
          if (lastError.code === 'ECONNREFUSED') {
            return res.json({ success: false, message: 'Koneksi ditolak. Pastikan server GenieACS sedang berjalan dan URL benar.' });
          } else if (lastError.code === 'ETIMEDOUT' || lastError.code === 'ECONNABORTED') {
            return res.json({ success: false, message: 'Timeout. Server tidak merespons dalam 10 detik.' });
          } else if (lastError.code === 'ENOTFOUND' || lastError.code === 'EAI_AGAIN') {
            return res.json({ success: false, message: 'Host tidak ditemukan. Periksa URL server.' });
          } else if (lastError.response) {
            // Got response but with error status
            const status = lastError.response.status;
            const genieacsVersion = lastError.response.headers['genieacs-version'] || lastError.response.headers['GenieACS-Version'];
            if (genieacsVersion) {
              return res.json({ 
                success: true,
                message: `Server GenieACS aktif (Version: ${genieacsVersion}). Status: ${status}`, 
                status: status,
                version: genieacsVersion
              });
            }
            return res.json({ 
              success: false,
              message: `Server merespons dengan status ${status}. ${status === 404 ? 'Endpoint tidak ditemukan, tapi server mungkin aktif.' : ''}`,
              status: status
            });
          } else {
            return res.json({ success: false, message: 'Koneksi gagal: ' + (lastError.message || 'Unknown error') });
          }
        }
        
        // If we got a response but didn't return yet
        if (lastResponse) {
          const genieacsVersion = lastResponse.headers['genieacs-version'] || lastResponse.headers['GenieACS-Version'];
          if (genieacsVersion) {
            return res.json({ 
              success: true,
              message: `Server GenieACS aktif (Version: ${genieacsVersion})`, 
              status: lastResponse.status,
              version: genieacsVersion
            });
          }
        }
        
        return res.json({ success: false, message: 'Tidak dapat terhubung ke server' });
      } catch (error) {
        console.error('[GenieACS] Test connection error:', error);
        return res.json({ success: false, message: 'Koneksi gagal: ' + (error.message || 'Unknown error') });
      }
    });
  } catch (e) {
    console.error('[GenieACS] Test connection exception:', e);
    res.json({ success: false, message: e.message || 'Terjadi kesalahan saat test koneksi' });
  }
});

module.exports = router;
