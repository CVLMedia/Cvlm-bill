-- Migration: Create voucher_login_history table for tracking voucher login/logout times
-- Date: 2025-11-20
-- Description: Create table for storing voucher login and logout history

CREATE TABLE IF NOT EXISTS voucher_login_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    nas_id INTEGER,
    nas_name TEXT,
    nas_ip TEXT,
    login_time DATETIME NOT NULL,
    logout_time DATETIME,
    is_active INTEGER NOT NULL DEFAULT 1, -- 1 = masih login, 0 = sudah logout
    session_uptime TEXT, -- Uptime session ini
    bytes_in INTEGER DEFAULT 0,
    bytes_out INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_voucher_login_history_username ON voucher_login_history(username);
CREATE INDEX IF NOT EXISTS idx_voucher_login_history_nas_id ON voucher_login_history(nas_id);
CREATE INDEX IF NOT EXISTS idx_voucher_login_history_is_active ON voucher_login_history(is_active);
CREATE INDEX IF NOT EXISTS idx_voucher_login_history_login_time ON voucher_login_history(login_time);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_voucher_login_history_updated_at
    AFTER UPDATE ON voucher_login_history
    FOR EACH ROW
BEGIN
    UPDATE voucher_login_history SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

