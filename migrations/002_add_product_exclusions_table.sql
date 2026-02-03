-- Migration: Add product_exclusions table
-- Date: 2026-02-03
-- Description: Global prefix-based rules to exclude products from transfer

-- Create product_exclusions table if it doesn't exist
CREATE TABLE IF NOT EXISTS product_exclusions (
    id SERIAL PRIMARY KEY,
    prefix VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index on prefix for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_exclusions_prefix ON product_exclusions(prefix);

-- Add comment
COMMENT ON TABLE product_exclusions IS 'Global prefix-based rules to exclude products from transfer';

DO $$
BEGIN
    RAISE NOTICE 'product_exclusions table created or already exists';
END $$;
