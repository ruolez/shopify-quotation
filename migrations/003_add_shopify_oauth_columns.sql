-- Migration: Add OAuth (client credentials) columns to shopify_stores
-- Date: 2026-04-16
-- Description: Supports Shopify Dev Dashboard apps alongside legacy shpat_ tokens.
--              Legacy stores continue to use admin_api_token unchanged.
--              New stores use OAuth 2.0 client_credentials grant with Client ID + Secret
--              exchanged for a short-lived access token cached in the DB.

-- Add OAuth columns (idempotent)
ALTER TABLE shopify_stores
    ADD COLUMN IF NOT EXISTS auth_method VARCHAR(30) NOT NULL DEFAULT 'legacy_token',
    ADD COLUMN IF NOT EXISTS oauth_client_id TEXT,
    ADD COLUMN IF NOT EXISTS oauth_client_secret_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS oauth_access_token_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS oauth_token_expires_at TIMESTAMP WITH TIME ZONE;

-- Allow admin_api_token to be NULL for new OAuth stores
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopify_stores'
          AND column_name = 'admin_api_token'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE shopify_stores ALTER COLUMN admin_api_token DROP NOT NULL;
        RAISE NOTICE 'admin_api_token NOT NULL constraint dropped';
    ELSE
        RAISE NOTICE 'admin_api_token already nullable';
    END IF;
END $$;

-- Constrain auth_method to known values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'shopify_stores_auth_method_check'
    ) THEN
        ALTER TABLE shopify_stores
            ADD CONSTRAINT shopify_stores_auth_method_check
            CHECK (auth_method IN ('legacy_token', 'oauth_client_credentials'));
        RAISE NOTICE 'auth_method CHECK constraint added';
    END IF;
END $$;

COMMENT ON COLUMN shopify_stores.auth_method IS 'legacy_token (shpat_) or oauth_client_credentials (Dev Dashboard)';
COMMENT ON COLUMN shopify_stores.oauth_client_id IS 'Client ID from Shopify Dev Dashboard (plaintext, not a secret)';
COMMENT ON COLUMN shopify_stores.oauth_client_secret_encrypted IS 'Fernet-encrypted Client Secret';
COMMENT ON COLUMN shopify_stores.oauth_access_token_encrypted IS 'Fernet-encrypted cached access token (~24h TTL, auto-refreshed)';
COMMENT ON COLUMN shopify_stores.oauth_token_expires_at IS 'Expiry timestamp for oauth_access_token_encrypted';
