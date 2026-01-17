-- Shopify Quotation Transfer Application - PostgreSQL Schema
-- Database: shopify_quotation

-- Enable UUID extension for secure IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Table: shopify_stores
-- Purpose: Store Shopify store configurations
-- ============================================================================
CREATE TABLE IF NOT EXISTS shopify_stores (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    shop_url VARCHAR(255) NOT NULL,
    admin_api_token TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shopify_stores_active ON shopify_stores(is_active);

-- ============================================================================
-- Table: sql_connections
-- Purpose: Store MS SQL Server connection details
-- ============================================================================
CREATE TABLE IF NOT EXISTS sql_connections (
    id SERIAL PRIMARY KEY,
    connection_type VARCHAR(20) NOT NULL CHECK (connection_type IN ('backoffice', 'inventory')),
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 1433,
    database_name VARCHAR(100) NOT NULL,
    username VARCHAR(100) NOT NULL,
    password_encrypted TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(connection_type)
);

-- ============================================================================
-- Table: customer_mappings
-- Purpose: Map Shopify stores to BackOffice CustomerID
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_mappings (
    id SERIAL PRIMARY KEY,
    shopify_store_id INTEGER NOT NULL REFERENCES shopify_stores(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL,
    business_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(shopify_store_id)
);

CREATE INDEX idx_customer_mappings_store ON customer_mappings(shopify_store_id);

-- ============================================================================
-- Table: quotation_defaults
-- Purpose: Default values for quotation creation per Shopify store
-- ============================================================================
CREATE TABLE IF NOT EXISTS quotation_defaults (
    id SERIAL PRIMARY KEY,
    shopify_store_id INTEGER NOT NULL REFERENCES shopify_stores(id) ON DELETE CASCADE,
    status INTEGER DEFAULT 1,
    shipper_id INTEGER,
    sales_rep_id INTEGER,
    term_id INTEGER,
    quotation_title_prefix VARCHAR(50) DEFAULT 'Shopify Order',
    expiration_days INTEGER DEFAULT 365,
    db_id VARCHAR(1) DEFAULT '1',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(shopify_store_id)
);

CREATE INDEX idx_quotation_defaults_store ON quotation_defaults(shopify_store_id);

-- ============================================================================
-- Table: transfer_history
-- Purpose: Track all order transfer attempts (success and failed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfer_history (
    id SERIAL PRIMARY KEY,
    shopify_store_id INTEGER NOT NULL REFERENCES shopify_stores(id) ON DELETE CASCADE,
    shopify_order_id VARCHAR(50) NOT NULL,
    shopify_order_name VARCHAR(50) NOT NULL,
    quotation_number VARCHAR(20),
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
    error_message TEXT,
    line_items_count INTEGER DEFAULT 0,
    total_amount DECIMAL(10, 2),
    transferred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transfer_history_store ON transfer_history(shopify_store_id);
CREATE INDEX idx_transfer_history_status ON transfer_history(status);
CREATE INDEX idx_transfer_history_order_id ON transfer_history(shopify_order_id);
CREATE INDEX idx_transfer_history_date ON transfer_history(transferred_at DESC);

-- Prevent duplicate transfers
CREATE UNIQUE INDEX idx_transfer_history_unique_success
ON transfer_history(shopify_order_id, shopify_store_id)
WHERE status = 'success';

-- ============================================================================
-- Trigger: Update updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_shopify_stores_updated_at
    BEFORE UPDATE ON shopify_stores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sql_connections_updated_at
    BEFORE UPDATE ON sql_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_mappings_updated_at
    BEFORE UPDATE ON customer_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quotation_defaults_updated_at
    BEFORE UPDATE ON quotation_defaults
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Initial Comments
-- ============================================================================
COMMENT ON TABLE shopify_stores IS 'Shopify store configurations with API credentials';
COMMENT ON TABLE sql_connections IS 'MS SQL Server connection details for BackOffice and Inventory databases';
COMMENT ON TABLE customer_mappings IS 'Maps each Shopify store to a specific CustomerID in BackOffice Customers_tbl';
COMMENT ON TABLE quotation_defaults IS 'Default values used when creating quotations from Shopify orders';
COMMENT ON TABLE transfer_history IS 'Tracks all order transfer attempts with success/failure status';
