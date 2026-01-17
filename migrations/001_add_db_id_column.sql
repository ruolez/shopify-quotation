-- Migration: Add db_id column to quotation_defaults table
-- Date: 2026-01-16
-- Description: Makes DB_ID configurable via Settings page instead of extracting from existing quotations

-- Add db_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'quotation_defaults' AND column_name = 'db_id'
    ) THEN
        ALTER TABLE quotation_defaults ADD COLUMN db_id VARCHAR(2) DEFAULT '1';
        RAISE NOTICE 'Column db_id added to quotation_defaults table';
    ELSE
        -- Ensure column is VARCHAR(2) in case it was created as VARCHAR(1)
        ALTER TABLE quotation_defaults ALTER COLUMN db_id TYPE VARCHAR(2);
        RAISE NOTICE 'Column db_id already exists, ensured VARCHAR(2) type';
    END IF;
END $$;
