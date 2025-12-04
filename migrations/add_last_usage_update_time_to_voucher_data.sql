-- Migration: Add last_usage_update_time column to voucher_data table
-- Date: 2025-11-21
-- Description: Add column last_usage_update_time to track when total_usage was last updated

-- Add column if it doesn't exist
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we need to check first
-- This will be handled by the application code

-- For manual execution, run this:
-- ALTER TABLE voucher_data ADD COLUMN last_usage_update_time DATETIME;

