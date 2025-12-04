const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { getDevices, setParameterValues } = require('../config/genieacs');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getSettingsWithCache } = require('../config/settingsManager')
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

// Test route untuk verifikasi router
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'AdminGenieacsMonitor router is working!',
    timestamp: new Date().toISOString()
  });
});

// Helper function untuk menentukan status device
function getDeviceStatus(lastInform) {
  if (!lastInform) return 'Unknown';
  
  try {
    const lastInformTime = new Date(lastInform).getTime();
    const now = Date.now();
    const diffMs = now - lastInformTime;
    const diffHours = diffMs / (1000 * 60 * 60);
    
    // Device dianggap online jika last inform < 1 jam
    if (diffHours < 1) {
      return 'Online';
    } else if (diffHours < 24) {
      return 'Offline';
    } else {
      return 'Offline';
    }
  } catch (error) {
    return 'Unknown';
  }
}

// Helper dan parameterPaths dari customerPortal.js
const parameterPaths = {
  pppUsername: [
    'VirtualParameters.pppoeUsername',
    'VirtualParameters.pppUsername',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username'
  ],
  rxPower: [
    'VirtualParameters.RXPower',
    'VirtualParameters.redaman',
    'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower'
  ],
  deviceTags: [
    'Tags',
    '_tags',
    'VirtualParameters.Tags'
  ],
  serialNumber: [
    'DeviceID.SerialNumber',
    'InternetGatewayDevice.DeviceInfo.SerialNumber._value'
  ],
  model: [
    'DeviceID.ProductClass',
    'InternetGatewayDevice.DeviceInfo.ModelName._value'
  ],
  status: [
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Status._value',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Status._value',
    'VirtualParameters.Status'
  ],
  ssid: [
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID._value',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID._value',
    'VirtualParameters.SSID'
  ],
  password: [
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase._value',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase._value',
    'VirtualParameters.Password'
  ],
  userConnected: [
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations'
  ]
};
function getParameterWithPaths(device, paths) {
  for (const path of paths) {
    const parts = path.split('.');
    let value = device;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
        if (value && value._value !== undefined) value = value._value;
      } else {
        value = undefined;
        break;
      }
    }
    
    if (value !== undefined && value !== null && value !== '') {
      // Handle special case for device tags
      if (path.includes('Tags') || path.includes('_tags')) {
        if (Array.isArray(value)) {
          return value.filter(tag => tag && tag !== '').join(', ');
        } else if (typeof value === 'string') {
          return value;
        }
      }
      return value;
    }
  }
  return '-';
}


// GET: List Device GenieACS
router.get('/genieacs-monitor', adminAuth, async (req, res) => {
  try {
    // Ambil data device dari semua GenieACS servers
    const { getAllDevicesFromAllServers, getAllGenieacsServers } = require('../config/genieacs');
    const devicesRaw = await getAllDevicesFromAllServers();
    const servers = await getAllGenieacsServers();
    // Mapping data sesuai kebutuhan tabel dengan info server
    const devices = devicesRaw.map((device, i) => ({
      id: device._id || '-',
      serialNumber: device.DeviceID?.SerialNumber || device._id || '-',
      model: device.DeviceID?.ProductClass || device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || '-',
      lastInform: device._lastInform ? new Date(device._lastInform).toLocaleString('id-ID') : '-',
      pppoeUsername: getParameterWithPaths(device, parameterPaths.pppUsername),
      ssid: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value || device.VirtualParameters?.SSID || '-',
      password: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.KeyPassphrase?._value || '-',
      userKonek: device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.TotalAssociations?._value || '-',
      rxPower: getParameterWithPaths(device, parameterPaths.rxPower),
      genieacsServer: device._genieacs_server_name || 'Default',
      genieacsServerId: device._genieacs_server_id || null,
      tag: (Array.isArray(device.Tags) && device.Tags.length > 0)
        ? device.Tags.join(', ')
        : (typeof device.Tags === 'string' && device.Tags)
          ? device.Tags
          : (Array.isArray(device._tags) && device._tags.length > 0)
            ? device._tags.join(', ')
            : (typeof device._tags === 'string' && device._tags)
              ? device._tags
              : '-'
    }));
    // Tambahkan statistik GenieACS seperti di dashboard
    const genieacsTotal = devicesRaw.length;
    const now = Date.now();
    const genieacsOnline = devicesRaw.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600*1000).length;
    const genieacsOffline = genieacsTotal - genieacsOnline;
    const settings = getSettingsWithCache();
    
    res.render('admin/genieacs-monitor', {
      title: 'Device GenieACS',
      devices,
      servers, // Pass servers for filter dropdown
      genieacsTotal,
      genieacsOnline,
      genieacsOffline,
      settings,
      page: 'genieacs-monitor'
    });
  } catch (err) {
    res.render('admin/genieacs-monitor', { title: 'Device GenieACS', devices: [], error: 'Gagal mengambil data device.' });
  }
});

// Endpoint edit SSID/Password - Optimized like WhatsApp (Fast Response)
router.post('/genieacs-monitor/edit', adminAuth, async (req, res) => {
  try {
    const { id, ssid, password, server_id } = req.body;
    console.log('Edit request received:', { id, ssid, password, server_id });

    // Get GenieACS server berdasarkan server_id
    let genieacsServer = null;
    if (server_id && server_id !== 'default' && server_id !== 'null') {
      try {
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        genieacsServer = await new Promise((resolve, reject) => {
          db.get(`SELECT * FROM genieacs_servers WHERE id = ?`, [server_id], (err, row) => {
            db.close();
            if (err) reject(err);
            else resolve(row || null);
          });
        });
      } catch (e) {
        console.error('Error getting GenieACS server:', e);
      }
    }
    
    // Fallback ke default jika tidak ada server
    const genieacsUrl = genieacsServer ? genieacsServer.url : (require('../config/settingsManager').getSetting('genieacs_url', 'http://localhost:7557'));
    const genieacsUsername = genieacsServer ? genieacsServer.username : (require('../config/settingsManager').getSetting('genieacs_username', 'admin'));
    const genieacsPassword = genieacsServer ? genieacsServer.password : (require('../config/settingsManager').getSetting('genieacs_password', 'password'));

    // Encode deviceId untuk URL
    const encodedDeviceId = encodeURIComponent(id);

    // Kirim response cepat ke frontend
    if (typeof ssid !== 'undefined') {
      res.json({ 
        success: true, 
        field: 'ssid', 
        message: 'SSID berhasil diupdate!',
        newSSID: ssid
      });
      
      // Proses update di background (non-blocking)
      updateSSIDOptimized(id, ssid, genieacsUrl, genieacsUsername, genieacsPassword).then(result => {
        if (result.success) {
          console.log(`✅ Admin SSID update completed for device: ${id} to: ${ssid}`);
        } else {
          console.error(`❌ Admin SSID update failed for device: ${id}: ${result.message}`);
        }
      }).catch(error => {
        console.error('Error in background admin SSID update:', error);
      });
      
    } else if (typeof password !== 'undefined') {
      res.json({ 
        success: true, 
        field: 'password', 
        message: 'Password berhasil diupdate!'
      });
      
      // Proses update di background (non-blocking)
      updatePasswordOptimized(id, password, genieacsUrl, genieacsUsername, genieacsPassword).then(result => {
        if (result.success) {
          console.log(`✅ Admin password update completed for device: ${id}`);
        } else {
          console.error(`❌ Admin password update failed for device: ${id}: ${result.message}`);
        }
      }).catch(error => {
        console.error('Error in background admin password update:', error);
      });
      
    } else {
      res.status(400).json({ success: false, message: 'Tidak ada perubahan' });
    }
    
  } catch (err) {
    console.error('General error in edit endpoint:', err);
    res.status(500).json({ success: false, message: 'Gagal update SSID/Password: ' + err.message });
  }
});

// Helper: Update SSID Optimized (seperti WhatsApp command) - Fast Response
async function updateSSIDOptimized(deviceId, newSSID, genieacsUrl, username, password) {
  try {
    console.log(`🔄 Optimized SSID update for device: ${deviceId} to: ${newSSID}`);
    
    const encodedDeviceId = encodeURIComponent(deviceId);
    
    // Buat nama SSID 5G berdasarkan SSID 2.4G (seperti di WhatsApp)
    const newSSID5G = `${newSSID}-5G`;
    
    // Concurrent API calls untuk speed up
    const axiosConfig = {
      auth: { username, password },
      timeout: 10000 // 10 second timeout
    };
    
    // Update SSID 2.4GHz dan 5GHz secara concurrent
    const tasks = [];
    
    // Task 1: Update SSID 2.4GHz
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "setParameterValues",
          parameterValues: [
            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
          ]
        },
        axiosConfig
      )
    );
    
    // Task 2: Update SSID 5GHz (coba index 5 dulu, yang paling umum)
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "setParameterValues",
          parameterValues: [
            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID", newSSID5G, "xsd:string"]
          ]
        },
        axiosConfig
      ).catch(() => null) // Ignore error jika index 5 tidak ada
    );
    
    // Task 3: Refresh object
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "refreshObject",
          objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
        },
        axiosConfig
      ).catch(() => null) // Ignore error jika refresh gagal
    );
    
    // Jalankan semua tasks secara concurrent
    const results = await Promise.allSettled(tasks);
    
    // Check results
    const mainTaskSuccess = results[0].status === 'fulfilled';
    const wifi5GFound = results[1].status === 'fulfilled';
    
    if (mainTaskSuccess) {
      console.log(`✅ SSID update completed for device: ${deviceId}: ${newSSID}`);
      
      // Invalidate GenieACS cache after successful update
      try {
        const cacheManager = require('../config/cacheManager');
        cacheManager.invalidatePattern('genieacs:*');
        console.log('🔄 GenieACS cache invalidated after SSID update');
      } catch (cacheError) {
        console.warn('⚠️ Failed to invalidate cache:', cacheError.message);
      }
      
      return { success: true, wifi5GFound };
    } else {
      console.error(`❌ SSID update failed for device: ${deviceId}: ${results[0].reason?.message || 'Unknown error'}`);
      return { success: false, message: 'Gagal update SSID' };
    }
    
  } catch (error) {
    console.error('Error in updateSSIDOptimized:', error);
    return { success: false, message: error.message };
  }
}

// Helper: Update Password Optimized (seperti WhatsApp command) - Fast Response
async function updatePasswordOptimized(deviceId, newPassword, genieacsUrl, username, password) {
  try {
    console.log(`🔄 Optimized password update for device: ${deviceId}`);
    
    const encodedDeviceId = encodeURIComponent(deviceId);
    
    // Concurrent API calls untuk speed up
    const axiosConfig = {
      auth: { username, password },
      timeout: 10000 // 10 second timeout
    };
    
    // Update password 2.4GHz dan 5GHz secara concurrent
    const tasks = [];
    
    // Task 1: Update password 2.4GHz
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "setParameterValues",
          parameterValues: [
            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"]
          ]
        },
        axiosConfig
      )
    );
    
    // Task 2: Update password 5GHz (coba index 5 dulu)
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "setParameterValues",
          parameterValues: [
            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", newPassword, "xsd:string"]
          ]
        },
        axiosConfig
      ).catch(() => null) // Ignore error jika index 5 tidak ada
    );
    
    // Task 3: Refresh object
    tasks.push(
      axios.post(
        `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
        {
          name: "refreshObject",
          objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
        },
        axiosConfig
      ).catch(() => null) // Ignore error jika refresh gagal
    );
    
    // Jalankan semua tasks secara concurrent
    const results = await Promise.allSettled(tasks);
    
    // Check results
    const mainTaskSuccess = results[0].status === 'fulfilled';
    
    if (mainTaskSuccess) {
      console.log(`✅ Password update completed for device: ${deviceId}`);
      return { success: true };
    } else {
      console.error(`❌ Password update failed for device: ${deviceId}: ${results[0].reason?.message || 'Unknown error'}`);
      return { success: false, message: 'Gagal update password' };
    }
    
  } catch (error) {
    console.error('Error in updatePasswordOptimized:', error);
    return { success: false, message: error.message };
  }
}

// Endpoint edit tag (nomor pelanggan)
router.post('/genieacs-monitor/edit-tag', adminAuth, async (req, res) => {
  try {
    const { id, tag, server_id } = req.body;
    if (!id || typeof tag === 'undefined') {
      return res.status(400).json({ success: false, message: 'ID dan tag wajib diisi' });
    }
    
    // Get GenieACS server berdasarkan server_id
    let genieacsServer = null;
    if (server_id && server_id !== 'default' && server_id !== 'null') {
      try {
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        genieacsServer = await new Promise((resolve, reject) => {
          db.get(`SELECT * FROM genieacs_servers WHERE id = ?`, [server_id], (err, row) => {
            db.close();
            if (err) reject(err);
            else resolve(row || null);
          });
        });
      } catch (e) {
        console.error('Error getting GenieACS server:', e);
      }
    }
    
    const genieacsUrl = genieacsServer ? genieacsServer.url : (require('../config/settingsManager').getSetting('genieacs_url', 'http://localhost:7557'));
    const genieacsUsername = genieacsServer ? genieacsServer.username : (require('../config/settingsManager').getSetting('genieacs_username', 'admin'));
    const genieacsPassword = genieacsServer ? genieacsServer.password : (require('../config/settingsManager').getSetting('genieacs_password', 'password'));
    // 1. Ambil tag lama perangkat
    let oldTags = [];
    try {
      const deviceResp = await axios.get(`${genieacsUrl}/devices/${encodeURIComponent(id)}`, {
        auth: { username: genieacsUsername, password: genieacsPassword }
      });
      oldTags = deviceResp.data._tags || deviceResp.data.Tags || [];
      if (typeof oldTags === 'string') oldTags = [oldTags];
    } catch (e) {
      oldTags = [];
    }
    // 2. Hapus semua tag lama (tanpa kecuali)
    for (const oldTag of oldTags) {
      if (oldTag) {
        try {
          await axios.delete(`${genieacsUrl}/devices/${encodeURIComponent(id)}/tags/${encodeURIComponent(oldTag)}`, {
            auth: { username: genieacsUsername, password: genieacsPassword }
          });
        } catch (e) {
          // lanjutkan saja
        }
      }
    }
    // 3. Tambahkan tag baru
    await axios.post(`${genieacsUrl}/devices/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`, {}, {
      auth: { username: genieacsUsername, password: genieacsPassword }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal update tag' });
  }
});

// Endpoint restart ONU
router.post('/genieacs-monitor/restart-onu', adminAuth, async (req, res) => {
  try {
    const { id, server_id } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Device ID wajib diisi' });
    }

    // Get GenieACS server berdasarkan server_id
    let genieacsServer = null;
    if (server_id && server_id !== 'default' && server_id !== 'null') {
      try {
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        genieacsServer = await new Promise((resolve, reject) => {
          db.get(`SELECT * FROM genieacs_servers WHERE id = ?`, [server_id], (err, row) => {
            db.close();
            if (err) reject(err);
            else resolve(row || null);
          });
        });
      } catch (e) {
        console.error('Error getting GenieACS server:', e);
      }
    }
    
    const genieacsUrl = genieacsServer ? genieacsServer.url : (require('../config/settingsManager').getSetting('genieacs_url', 'http://localhost:7557'));
    const genieacsUsername = genieacsServer ? genieacsServer.username : (require('../config/settingsManager').getSetting('genieacs_username', 'admin'));
    const genieacsPassword = genieacsServer ? genieacsServer.password : (require('../config/settingsManager').getSetting('genieacs_password', 'password'));

    // Kirim perintah restart ke GenieACS menggunakan endpoint yang benar
    const taskData = {
      name: 'reboot'
    };

    // Pastikan device ID di-encode dengan benar untuk menghindari masalah karakter khusus
    const encodedDeviceId = encodeURIComponent(id);
    console.log(`🔧 Admin restart - Device ID: ${id}`);
    console.log(`🔧 Admin restart - Encoded Device ID: ${encodedDeviceId}`);

    await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks?connection_request`, taskData, {
      auth: { username: genieacsUsername, password: genieacsPassword },
      headers: { 'Content-Type': 'application/json' }
    });

    res.json({ success: true, message: 'Perintah restart berhasil dikirim' });
  } catch (err) {
    console.error('Error restart:', err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengirim perintah restart: ' + (err.response?.data?.message || err.message)
    });
  }
});

module.exports = router;

