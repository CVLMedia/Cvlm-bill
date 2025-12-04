-- Migration: Create voucher_data table for tracking voucher usage
-- Date: 2025-01-27
-- Description: Create table for storing voucher data with first_login, total_usage, remaining_time, status

CREATE TABLE IF NOT EXISTS voucher_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_code TEXT NOT NULL UNIQUE,
    first_login INTEGER, -- Timestamp login pertama (Unix timestamp)
    total_usage INTEGER DEFAULT 0, -- Akumulasi total detik pemakaian
    remaining_time INTEGER DEFAULT 0, -- Waktu tersisa dalam detik
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'used')),
    nas_id INTEGER, -- Router/NAS ID
    nas_name TEXT,
    nas_ip TEXT,
    profile TEXT, -- Profile yang digunakan
    uptime_limit INTEGER, -- Total waktu pemakaian dalam detik (dari profile/uptime)
    validity_limit INTEGER, -- Masa aktif dalam detik (dari validity)
    last_usage_update_time DATETIME, -- Waktu terakhir total_usage diupdate (untuk menghindari double-count)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_voucher_data_code ON voucher_data(voucher_code);
CREATE INDEX IF NOT EXISTS idx_voucher_data_status ON voucher_data(status);
CREATE INDEX IF NOT EXISTS idx_voucher_data_nas_id ON voucher_data(nas_id);
CREATE INDEX IF NOT EXISTS idx_voucher_data_first_login ON voucher_data(first_login);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_voucher_data_updated_at
    AFTER UPDATE ON voucher_data
    FOR EACH ROW
BEGIN
    UPDATE voucher_data SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

