const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { getSettingsWithCache, setSetting } = require('../config/settingsManager');

// GET: Halaman Setting RADIUS
router.get('/radius', adminAuth, async (req, res) => {
  try {
    const settings = getSettingsWithCache();
    res.render('adminRadius', {
      settings,
      page: 'setting-radius',
      error: null,
      success: null
    });
  } catch (e) {
    res.render('adminRadius', {
      settings: {},
      page: 'setting-radius',
      error: 'Gagal memuat pengaturan RADIUS',
      success: null
    });
  }
});

// POST: Simpan Setting RADIUS
router.post('/radius', adminAuth, async (req, res) => {
  try {
    const { user_auth_mode, radius_host, radius_user, radius_password, radius_database } = req.body;

    // Simpan nilai
    setSetting('user_auth_mode', user_auth_mode || 'radius');
    if (radius_host !== undefined) setSetting('radius_host', radius_host.trim());
    if (radius_user !== undefined) setSetting('radius_user', radius_user.trim());
    if (radius_password !== undefined) setSetting('radius_password', radius_password);
    if (radius_database !== undefined) setSetting('radius_database', radius_database.trim());

    const settings = getSettingsWithCache();
    res.render('adminRadius', {
      settings,
      page: 'setting-radius',
      error: null,
      success: 'Pengaturan RADIUS berhasil disimpan'
    });
  } catch (e) {
    const settings = getSettingsWithCache();
    res.render('adminRadius', {
      settings,
      page: 'setting-radius',
      error: 'Gagal menyimpan pengaturan RADIUS',
      success: null
    });
  }
});

module.exports = router;


