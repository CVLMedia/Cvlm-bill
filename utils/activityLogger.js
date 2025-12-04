const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../config/logger');

/**
 * Helper function to log activity to activity_logs table
 * @param {string} userId - User ID (username)
 * @param {string} userType - User type (admin, customer, technician, etc.)
 * @param {string} action - Action type (e.g., 'payment_received', 'customer_create')
 * @param {string} description - Description of the action
 * @param {string|null} ipAddress - IP address (optional)
 * @param {string|null} userAgent - User agent (optional)
 * @returns {Promise<number>} - Returns the last inserted row ID
 */
function logActivity(userId, userType, action, description, ipAddress = null, userAgent = null) {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        db.run(
            `INSERT INTO activity_logs (user_id, user_type, action, description, ip_address, user_agent, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [userId, userType, action, description, ipAddress, userAgent],
            function(err) {
                db.close();
                if (err) {
                    logger.error('Error logging activity:', err);
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            }
        );
    });
}

/**
 * Cleanup old activity logs (older than specified days)
 * @param {number} days - Number of days to keep (default: 30)
 * @returns {Promise<{success: boolean, deleted: number, message: string}>}
 */
function cleanupOldLogs(days = 30) {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        db.run(
            'DELETE FROM activity_logs WHERE created_at < datetime("now", "-" || ? || " days")',
            [days],
            function(err) {
                db.close();
                if (err) {
                    logger.error('Error cleaning up old activity logs:', err);
                    reject(err);
                } else {
                    const deleted = this.changes || 0;
                    logger.info(`🧹 Cleaned up ${deleted} activity logs older than ${days} days`);
                    resolve({
                        success: true,
                        deleted: deleted,
                        message: `Berhasil menghapus ${deleted} activity logs yang lebih dari ${days} hari`
                    });
                }
            }
        );
    });
}

module.exports = { logActivity, cleanupOldLogs };

