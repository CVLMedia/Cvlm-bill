const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const multer = require('multer');
const logger = require('../config/logger');
const sqlite3 = require('sqlite3').verbose();

const backupUpload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const backupDir = path.join(__dirname, '../data/backup');
            fs.mkdirSync(backupDir, { recursive: true });
            cb(null, backupDir);
        },
        filename: function (req, file, cb) {
            cb(null, file.originalname);
        }
    })
});

// Import logActivity from utils
const { logActivity } = require('../utils/activityLogger');

// GET: Render halaman Backup & Logs
router.get('/', (req, res) => {
    // Log access to backup logs page
    if (req.session && req.session.admin) {
        logActivity(
            req.session.admin.username || 'admin',
            'admin',
            'backup_logs_access',
            'Mengakses halaman Backup & Logs',
            req.ip,
            req.get('User-Agent')
        ).catch(err => logger.error('Failed to log activity:', err));
    }
    
    res.render('adminBackupLogs', { page: 'backup-logs' });
});

// Backup database
router.post('/backup', async (req, res) => {
    try {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const backupPath = path.join(__dirname, '../data/backup');
        
        // Buat direktori backup jika belum ada
        if (!fs.existsSync(backupPath)) {
            fs.mkdirSync(backupPath, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupPath, `billing_backup_${timestamp}.db`);
        
        // Copy database file
        fs.copyFileSync(dbPath, backupFile);
        
        logger.info(`Database backup created: ${backupFile}`);
        
        // Log activity
        if (req.session && req.session.admin) {
            logActivity(
                req.session.admin.username || 'admin',
                'admin',
                'database_backup',
                `Membuat backup database: ${path.basename(backupFile)}`,
                req.ip,
                req.get('User-Agent')
            ).catch(err => logger.error('Failed to log activity:', err));
        }
        
        res.json({
            success: true,
            message: 'Database backup berhasil dibuat',
            backup_file: path.basename(backupFile)
        });
    } catch (error) {
        logger.error('Error creating backup:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating backup',
            error: error.message
        });
    }
});

// Restore database
router.post('/restore', backupUpload.single('backup_file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'File backup tidak ditemukan'
            });
        }
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const backupPath = path.join(__dirname, '../data/backup', req.file.filename);
        
        // Backup database saat ini sebelum restore
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const currentBackup = path.join(__dirname, '../data/backup', `pre_restore_${timestamp}.db`);
        fs.copyFileSync(dbPath, currentBackup);
        
        // Restore database
        fs.copyFileSync(backupPath, dbPath);
        
        logger.info(`Database restored from: ${req.file.filename}`);
        
        // Log activity
        if (req.session && req.session.admin) {
            logActivity(
                req.session.admin.username || 'admin',
                'admin',
                'database_restore',
                `Restore database dari: ${req.file.filename}`,
                req.ip,
                req.get('User-Agent')
            ).catch(err => logger.error('Failed to log activity:', err));
        }
        
        res.json({
            success: true,
            message: 'Database berhasil di-restore',
            restored_file: req.file.filename
        });
    } catch (error) {
        logger.error('Error restoring database:', error);
        res.status(500).json({
            success: false,
            message: 'Error restoring database',
            error: error.message
        });
    }
});

// Get backup files list
router.get('/backups', async (req, res) => {
    try {
        const backupPath = path.join(__dirname, '../data/backup');
        
        if (!fs.existsSync(backupPath)) {
            return res.json({
                success: true,
                backups: []
            });
        }
        
        const files = fs.readdirSync(backupPath)
            .filter(file => file.endsWith('.db'))
            .map(file => {
                const filePath = path.join(backupPath, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: stats.size,
                    created: stats.birthtime
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created));
        
        res.json({
            success: true,
            backups: files
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error getting backup files',
            error: error.message
        });
    }
});

// Get activity logs
router.get('/activity-logs', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        
        logger.info(`Fetching activity logs - page: ${page}, limit: ${limit}, offset: ${offset}`);
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        
        // Check if database exists
        if (!fs.existsSync(dbPath)) {
            logger.error('Database file not found:', dbPath);
            return res.status(500).json({
                success: false,
                message: 'Database file not found',
                logs: []
            });
        }
        
        const db = new sqlite3.Database(dbPath);
        
        // Get total count
        const countResult = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as total FROM activity_logs', (err, row) => {
                if (err) {
                    logger.error('Error counting activity logs:', err);
                    reject(err);
                } else {
                    logger.info(`Total activity logs: ${row.total}`);
                    resolve(row);
                }
            });
        });
        
        // Get logs with pagination
        const logs = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
                [limit, offset],
                (err, rows) => {
                    if (err) {
                        logger.error('Error fetching activity logs:', err);
                        reject(err);
                    } else {
                        logger.info(`Fetched ${rows.length} activity logs`);
                        resolve(rows || []);
                    }
                }
            );
        });
        
        db.close();
        
        res.json({
            success: true,
            logs: logs,
            total: countResult.total,
            page: page,
            limit: limit
        });
    } catch (error) {
        logger.error('Error getting activity logs:', error);
        logger.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Error getting activity logs: ' + error.message,
            error: error.message,
            logs: []
        });
    }
});

// Delete backup file
router.post('/delete', async (req, res) => {
    try {
        const filename = req.body.filename;
        
        logger.info(`Delete backup request - filename: ${filename}`);
        
        if (!filename) {
            logger.warn('Delete backup: filename is missing');
            return res.status(400).json({
                success: false,
                message: 'Nama file tidak ditemukan'
            });
        }
        
        // Validasi bahwa file adalah file backup (untuk keamanan)
        if (!filename.endsWith('.db') || !filename.startsWith('billing_backup_')) {
            logger.warn(`Delete backup: Invalid filename format - ${filename}`);
            return res.status(400).json({
                success: false,
                message: 'File tidak valid. Hanya file backup yang diizinkan.'
            });
        }
        
        const backupDir = path.join(__dirname, '../data/backup');
        const backupPath = path.join(backupDir, filename);
        
        // Pastikan direktori backup ada
        if (!fs.existsSync(backupDir)) {
            logger.error(`Delete backup: Backup directory does not exist - ${backupDir}`);
            return res.status(500).json({
                success: false,
                message: 'Direktori backup tidak ditemukan'
            });
        }
        
        // Cek apakah file ada
        if (!fs.existsSync(backupPath)) {
            logger.warn(`Delete backup: File not found - ${backupPath}`);
            return res.status(404).json({
                success: false,
                message: `File backup "${filename}" tidak ditemukan`
            });
        }
        
        // Hapus file
        try {
            fs.unlinkSync(backupPath);
            logger.info(`Backup file deleted successfully: ${filename}`);
        } catch (unlinkError) {
            logger.error(`Error deleting file: ${unlinkError.message}`);
            throw unlinkError;
        }
        
        // Log activity
        if (req.session && req.session.admin) {
            logActivity(
                req.session.admin.username || 'admin',
                'admin',
                'backup_file_delete',
                `Menghapus file backup: ${filename}`,
                req.ip,
                req.get('User-Agent')
            ).catch(err => logger.error('Failed to log activity:', err));
        }
        
        res.json({
            success: true,
            message: `File backup "${filename}" berhasil dihapus`
        });
    } catch (error) {
        logger.error('Error deleting backup file:', error);
        logger.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: `Terjadi kesalahan saat menghapus file backup: ${error.message}`
        });
    }
});

// Clear old activity logs
router.post('/clear-logs', async (req, res) => {
    try {
        const days = parseInt(req.body.days) || 30;
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        // Delete logs older than specified days
        const result = await new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM activity_logs WHERE created_at < datetime("now", "-" || ? || " days")',
                [days],
                function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                }
            );
        });
        
        db.close();
        
        logger.info(`Cleared ${result.changes} activity logs older than ${days} days`);
        
        // Log activity
        if (req.session && req.session.admin) {
            logActivity(
                req.session.admin.username || 'admin',
                'admin',
                'clear_activity_logs',
                `Menghapus ${result.changes} activity logs yang lebih dari ${days} hari`,
                req.ip,
                req.get('User-Agent')
            ).catch(err => logger.error('Failed to log activity:', err));
        }
        
        res.json({
            success: true,
            message: `Berhasil menghapus ${result.changes} activity logs yang lebih dari ${days} hari`,
            deleted: result.changes
        });
    } catch (error) {
        logger.error('Error clearing activity logs:', error);
        res.status(500).json({
            success: false,
            message: 'Error clearing activity logs',
            error: error.message
        });
    }
});

module.exports = router;

