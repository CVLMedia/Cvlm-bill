const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const fs = require('fs');
const path = require('path');

const { getAllDevicesFromAllServers } = require('../config/genieacs');
const { getMikrotikConnectionForRouter } = require('../config/mikrotik');
const { getSettingsWithCache } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

// GET: Dashboard admin
router.get('/dashboard', adminAuth, async (req, res) => {
  let genieacsTotal = 0, genieacsOnline = 0, genieacsOffline = 0;
  let mikrotikTotal = 0, mikrotikAktif = 0, mikrotikOffline = 0;
  let settings = {};
  
  try {
    // Baca settings.json
    settings = getSettingsWithCache();
    
    // GenieACS dengan timeout dan fallback - aggregate dari semua server
    try {
      const devices = await Promise.race([
        getAllDevicesFromAllServers(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('GenieACS timeout')), 10000) // Increased timeout untuk multiple servers
        )
      ]);
      genieacsTotal = devices.length;
      // Anggap device online jika ada _lastInform dalam 1 jam terakhir
      const now = Date.now();
      genieacsOnline = devices.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600*1000).length;
      genieacsOffline = genieacsTotal - genieacsOnline;
      console.log(`✅ [DASHBOARD] GenieACS data loaded successfully: ${genieacsTotal} devices from all servers`);
    } catch (genieacsError) {
      console.warn('⚠️ [DASHBOARD] GenieACS tidak dapat diakses - menggunakan data default:', genieacsError.message);
      // Set default values jika GenieACS tidak bisa diakses
      genieacsTotal = 0;
      genieacsOnline = 0;
      genieacsOffline = 0;
      // Dashboard tetap bisa dimuat meskipun GenieACS bermasalah
    }
    
    // Mikrotik agregasi seluruh NAS
    try {
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(path.join(process.cwd(), 'data/billing.db'));
      const routers = await new Promise((resolve) => {
        db.all('SELECT * FROM routers ORDER BY id', (err, rows) => resolve(rows || []));
      });
      db.close();

      let totalSecrets = 0, totalActive = 0;
      await Promise.all((routers || []).map(async (r) => {
        try {
          const conn = await Promise.race([
            getMikrotikConnectionForRouter(r),
            new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 5000))
          ]);
          const [active, secrets] = await Promise.all([
            conn.write('/ppp/active/print'),
            conn.write('/ppp/secret/print')
          ]);
          totalActive += Array.isArray(active) ? active.length : 0;
          totalSecrets += Array.isArray(secrets) ? secrets.length : 0;
        } catch (e) {
          console.warn('⚠️ [DASHBOARD] Skip router', r && r.nas_ip, e.message);
        }
      }));

      mikrotikAktif = totalActive;
      mikrotikTotal = totalSecrets;
      mikrotikOffline = Math.max(totalSecrets - totalActive, 0);
      console.log('✅ [DASHBOARD] Mikrotik aggregated across NAS');
    } catch (mikrotikError) {
      console.warn('⚠️ [DASHBOARD] Mikrotik tidak dapat diakses - menggunakan data default:', mikrotikError.message);
      // Set default values jika Mikrotik tidak bisa diakses
      mikrotikTotal = 0;
      mikrotikAktif = 0;
      mikrotikOffline = 0;
      // Dashboard tetap bisa dimuat meskipun Mikrotik bermasalah
    }
  } catch (e) {
    console.error('❌ [DASHBOARD] Error in dashboard route:', e);
    // Jika error, biarkan value default 0
  }
  
  // Cek apakah perlu menjalankan validasi konfigurasi ulang
  const shouldRevalidate = !req.session.configValidation || 
                          !req.session.configValidation.hasValidationRun ||
                          req.session.configValidation.lastValidationTime < (Date.now() - 30000); // 30 detik cache

  if (shouldRevalidate) {
    console.log('🔍 [DASHBOARD] Menjalankan validasi konfigurasi ulang...');
    
    // Jalankan validasi konfigurasi secara asinkron
    setImmediate(async () => {
      try {
        const { validateConfiguration, getValidationSummary, checkForDefaultSettings } = require('../config/configValidator');
        
        const validationResults = await validateConfiguration();
        const summary = getValidationSummary();
        const defaultSettingsWarnings = checkForDefaultSettings();
        
        // Update session dengan hasil validasi terbaru
        req.session.configValidation = {
          hasValidationRun: true,
          results: validationResults,
          summary: summary,
          defaultSettingsWarnings: defaultSettingsWarnings,
          lastValidationTime: Date.now()
        };
        
        console.log('✅ [DASHBOARD] Validasi konfigurasi ulang selesai');
      } catch (error) {
        console.error('❌ [DASHBOARD] Error saat validasi konfigurasi ulang:', error);
      }
    });
  }

  res.render('adminDashboard', {
    title: 'Dashboard Admin',
    page: 'dashboard',
    genieacsTotal,
    genieacsOnline,
    genieacsOffline,
    mikrotikTotal,
    mikrotikAktif,
    mikrotikOffline,
    settings, // Sertakan settings di sini
    versionInfo: getVersionInfo(),
    versionBadge: getVersionBadge(),
    configValidation: req.session.configValidation || null // Sertakan hasil validasi konfigurasi
  });
});

module.exports = router;
