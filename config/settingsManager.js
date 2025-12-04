const fs = require('fs');
const path = require('path');
const performanceMonitor = require('./performanceMonitor');

const settingsPath = path.join(process.cwd(), 'settings.json');

// In-memory cache untuk performa
let settingsCache = null;
let lastModified = null;
let cacheExpiry = null;
const CACHE_TTL = 5000; // 5 detik cache

function loadSettingsFromFile() {
  const startTime = Date.now();
  let wasCacheHit = false;
  
  try {
    const stats = fs.statSync(settingsPath);
    const fileModified = stats.mtime.getTime();
    
    // Jika file tidak berubah dan cache masih valid, gunakan cache
    if (settingsCache && 
        lastModified === fileModified && 
        cacheExpiry && 
        Date.now() < cacheExpiry) {
      wasCacheHit = true;
      performanceMonitor.recordCall(startTime, wasCacheHit);
      return settingsCache;
    }
    
    // Baca file dan update cache
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    settingsCache = JSON.parse(raw);
    lastModified = fileModified;
    cacheExpiry = Date.now() + CACHE_TTL;
    
    performanceMonitor.recordCall(startTime, wasCacheHit);
    return settingsCache;
  } catch (e) {
    performanceMonitor.recordCall(startTime, wasCacheHit);
    // Jika ada error, return cache lama atau empty object
    return settingsCache || {};
  }
}

function getSettingsWithCache() {
  return loadSettingsFromFile();
}

function getSetting(key, defaultValue) {
  const settings = getSettingsWithCache();
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

function setSetting(key, value, req = null) {
  try {
    const settings = getSettingsWithCache();
    const oldValue = settings[key];
    settings[key] = value;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    
    // Invalidate cache setelah write
    settingsCache = settings;
    lastModified = fs.statSync(settingsPath).mtime.getTime();
    cacheExpiry = Date.now() + CACHE_TTL;
    
    // Log activity - Ubah/Edit/Tambah Settingan
    try {
      const { logActivity } = require('../utils/activityLogger');
      const username = req?.session?.admin?.username || req?.session?.adminUser || 'admin';
      const action = oldValue === undefined ? 'settings_add' : 'settings_update';
      const desc = oldValue === undefined 
        ? `Tambah Settingan: ${key} = ${typeof value === 'object' ? JSON.stringify(value) : value}`
        : `Edit Settingan: ${key} = ${typeof oldValue === 'object' ? JSON.stringify(oldValue) : oldValue} → ${typeof value === 'object' ? JSON.stringify(value) : value}`;
      
      logActivity(
        username,
        'admin',
        action,
        desc,
        req?.ip || null,
        req?.get('User-Agent') || null
      ).catch(err => {
        // Silent fail untuk logging, jangan ganggu operasi utama
        if (process.env.DEBUG) console.error('Failed to log settings change:', err);
      });
    } catch (logErr) {
      // Silent fail untuk logging
      if (process.env.DEBUG) console.error('Error logging settings change:', logErr);
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

// Clear cache function untuk debugging/maintenance
function clearSettingsCache() {
  settingsCache = null;
  lastModified = null;
  cacheExpiry = null;
}

module.exports = { 
  getSettingsWithCache, 
  getSetting, 
  setSetting, 
  clearSettingsCache,
  getPerformanceStats: () => performanceMonitor.getStats(),
  getPerformanceReport: () => performanceMonitor.getPerformanceReport(),
  getQuickStats: () => performanceMonitor.getQuickStats()
};