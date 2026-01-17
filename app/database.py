"""
Database managers for PostgreSQL and MS SQL Server
Handles all database operations with connection pooling and error handling
"""

import os
import logging
from typing import Optional, Dict, List, Any, Tuple
from contextlib import contextmanager
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool
import pymssql
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)


class EncryptionManager:
    """Handles encryption/decryption of sensitive data like passwords"""

    def __init__(self):
        # Generate or load encryption key
        self.key = os.getenv('ENCRYPTION_KEY', Fernet.generate_key())
        if isinstance(self.key, str):
            self.key = self.key.encode()
        self.cipher = Fernet(self.key)

    def encrypt(self, text: str) -> str:
        """Encrypt text and return base64 encoded string"""
        if not text:
            return ""
        return self.cipher.encrypt(text.encode()).decode()

    def decrypt(self, encrypted_text: str) -> str:
        """Decrypt base64 encoded string"""
        if not encrypted_text:
            return ""
        return self.cipher.decrypt(encrypted_text.encode()).decode()


class PostgreSQLManager:
    """Manages PostgreSQL connection pool and operations"""

    def __init__(self):
        self.host = os.getenv('POSTGRES_HOST', 'localhost')
        self.port = int(os.getenv('POSTGRES_PORT', 5432))
        self.database = os.getenv('POSTGRES_DB', 'shopify_quotation')
        self.user = os.getenv('POSTGRES_USER', 'admin')
        self.password = os.getenv('POSTGRES_PASSWORD', 'admin123')
        self.pool: Optional[SimpleConnectionPool] = None
        self.encryption = EncryptionManager()
        self._initialize_pool()

    def _initialize_pool(self):
        """Initialize connection pool"""
        try:
            self.pool = SimpleConnectionPool(
                minconn=2,
                maxconn=10,
                host=self.host,
                port=self.port,
                database=self.database,
                user=self.user,
                password=self.password
            )
            logger.info("PostgreSQL connection pool initialized")
        except Exception as e:
            logger.error(f"Failed to initialize PostgreSQL pool: {str(e)}")
            raise

    @contextmanager
    def get_connection(self):
        """Context manager for database connections"""
        conn = None
        try:
            conn = self.pool.getconn()
            yield conn
            conn.commit()
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error: {str(e)}")
            raise
        finally:
            if conn:
                self.pool.putconn(conn)

    def execute_query(self, query: str, params: tuple = None) -> List[Dict]:
        """Execute SELECT query and return results as list of dicts"""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params or ())
                return [dict(row) for row in cursor.fetchall()]

    def execute_insert(self, query: str, params: tuple = None) -> int:
        """Execute INSERT query and return inserted ID"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params or ())
                return cursor.fetchone()[0] if cursor.rowcount > 0 else None

    def execute_update(self, query: str, params: tuple = None) -> int:
        """Execute UPDATE/DELETE query and return affected rows"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params or ())
                return cursor.rowcount

    # ========================================================================
    # Shopify Stores CRUD
    # ========================================================================

    def get_shopify_stores(self, active_only: bool = True) -> List[Dict]:
        """Get all Shopify stores"""
        query = """
            SELECT id, name, shop_url, admin_api_token, is_active,
                   created_at, updated_at
            FROM shopify_stores
        """
        if active_only:
            query += " WHERE is_active = TRUE"
        query += " ORDER BY name"
        return self.execute_query(query)

    def get_shopify_store(self, store_id: int) -> Optional[Dict]:
        """Get single Shopify store by ID"""
        query = """
            SELECT id, name, shop_url, admin_api_token, is_active,
                   created_at, updated_at
            FROM shopify_stores
            WHERE id = %s
        """
        results = self.execute_query(query, (store_id,))
        return results[0] if results else None

    def create_shopify_store(self, name: str, shop_url: str, api_token: str) -> int:
        """Create new Shopify store"""
        query = """
            INSERT INTO shopify_stores (name, shop_url, admin_api_token)
            VALUES (%s, %s, %s)
            RETURNING id
        """
        return self.execute_insert(query, (name, shop_url, api_token))

    def update_shopify_store(self, store_id: int, name: str = None,
                            shop_url: str = None, api_token: str = None) -> int:
        """Update Shopify store"""
        updates = []
        params = []

        if name is not None:
            updates.append("name = %s")
            params.append(name)
        if shop_url is not None:
            updates.append("shop_url = %s")
            params.append(shop_url)
        if api_token is not None:
            updates.append("admin_api_token = %s")
            params.append(api_token)

        if not updates:
            return 0

        params.append(store_id)
        query = f"""
            UPDATE shopify_stores
            SET {', '.join(updates)}
            WHERE id = %s
        """
        return self.execute_update(query, tuple(params))

    def delete_shopify_store(self, store_id: int) -> int:
        """Delete Shopify store"""
        query = "DELETE FROM shopify_stores WHERE id = %s"
        return self.execute_update(query, (store_id,))

    # ========================================================================
    # SQL Connections CRUD
    # ========================================================================

    def get_sql_connections(self) -> List[Dict]:
        """Get all SQL connections (passwords decrypted)"""
        query = """
            SELECT id, connection_type, host, port, database_name,
                   username, password_encrypted, is_active,
                   created_at, updated_at
            FROM sql_connections
            ORDER BY connection_type
        """
        results = self.execute_query(query)

        # Decrypt passwords
        for row in results:
            row['password'] = self.encryption.decrypt(row['password_encrypted'])
            del row['password_encrypted']

        return results

    def get_sql_connection(self, connection_type: str) -> Optional[Dict]:
        """Get SQL connection by type (backoffice or inventory)"""
        query = """
            SELECT id, connection_type, host, port, database_name,
                   username, password_encrypted, is_active,
                   created_at, updated_at
            FROM sql_connections
            WHERE connection_type = %s
        """
        results = self.execute_query(query, (connection_type,))
        if results:
            result = results[0]
            result['password'] = self.encryption.decrypt(result['password_encrypted'])
            del result['password_encrypted']
            return result
        return None

    def upsert_sql_connection(self, connection_type: str, host: str, port: int,
                             database_name: str, username: str, password: str) -> int:
        """Create or update SQL connection"""
        encrypted_password = self.encryption.encrypt(password)

        query = """
            INSERT INTO sql_connections
                (connection_type, host, port, database_name, username, password_encrypted)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (connection_type)
            DO UPDATE SET
                host = EXCLUDED.host,
                port = EXCLUDED.port,
                database_name = EXCLUDED.database_name,
                username = EXCLUDED.username,
                password_encrypted = EXCLUDED.password_encrypted,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id
        """
        return self.execute_insert(query, (
            connection_type, host, port, database_name, username, encrypted_password
        ))

    # ========================================================================
    # Customer Mappings CRUD
    # ========================================================================

    def get_customer_mapping(self, store_id: int) -> Optional[Dict]:
        """Get customer mapping for store"""
        query = """
            SELECT id, shopify_store_id, customer_id, business_name,
                   created_at, updated_at
            FROM customer_mappings
            WHERE shopify_store_id = %s
        """
        results = self.execute_query(query, (store_id,))
        return results[0] if results else None

    def upsert_customer_mapping(self, store_id: int, customer_id: int,
                                business_name: str = None) -> int:
        """Create or update customer mapping"""
        query = """
            INSERT INTO customer_mappings
                (shopify_store_id, customer_id, business_name)
            VALUES (%s, %s, %s)
            ON CONFLICT (shopify_store_id)
            DO UPDATE SET
                customer_id = EXCLUDED.customer_id,
                business_name = EXCLUDED.business_name,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id
        """
        return self.execute_insert(query, (store_id, customer_id, business_name))

    # ========================================================================
    # Quotation Defaults CRUD
    # ========================================================================

    def get_quotation_defaults(self, store_id: int) -> Optional[Dict]:
        """Get quotation defaults for store"""
        query = """
            SELECT id, shopify_store_id, status, shipper_id, sales_rep_id,
                   term_id, quotation_title_prefix, expiration_days, db_id,
                   created_at, updated_at
            FROM quotation_defaults
            WHERE shopify_store_id = %s
        """
        results = self.execute_query(query, (store_id,))
        return results[0] if results else None

    def upsert_quotation_defaults(self, store_id: int, status: int = None,
                                  shipper_id: int = None, sales_rep_id: int = None,
                                  term_id: int = None, quotation_title_prefix: str = None,
                                  expiration_days: int = 365, db_id: str = '1') -> int:
        """Create or update quotation defaults"""
        query = """
            INSERT INTO quotation_defaults
                (shopify_store_id, status, shipper_id, sales_rep_id, term_id,
                 quotation_title_prefix, expiration_days, db_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (shopify_store_id)
            DO UPDATE SET
                status = EXCLUDED.status,
                shipper_id = EXCLUDED.shipper_id,
                sales_rep_id = EXCLUDED.sales_rep_id,
                term_id = EXCLUDED.term_id,
                quotation_title_prefix = EXCLUDED.quotation_title_prefix,
                expiration_days = EXCLUDED.expiration_days,
                db_id = EXCLUDED.db_id,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id
        """
        return self.execute_insert(query, (
            store_id, status, shipper_id, sales_rep_id, term_id,
            quotation_title_prefix, expiration_days, db_id
        ))

    # ========================================================================
    # Transfer History CRUD
    # ========================================================================

    def create_transfer_record(self, store_id: int, order_id: str, order_name: str,
                              quotation_number: str = None, status: str = 'pending',
                              error_message: str = None, line_items_count: int = 0,
                              total_amount: float = 0.0) -> int:
        """Create transfer history record"""
        query = """
            INSERT INTO transfer_history
                (shopify_store_id, shopify_order_id, shopify_order_name,
                 quotation_number, status, error_message, line_items_count, total_amount)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        return self.execute_insert(query, (
            store_id, order_id, order_name, quotation_number, status,
            error_message, line_items_count, total_amount
        ))

    def update_transfer_record(self, transfer_id: int, quotation_number: str = None,
                              status: str = None, error_message: str = None) -> int:
        """Update transfer history record"""
        updates = []
        params = []

        if quotation_number is not None:
            updates.append("quotation_number = %s")
            params.append(quotation_number)
        if status is not None:
            updates.append("status = %s")
            params.append(status)
        if error_message is not None:
            updates.append("error_message = %s")
            params.append(error_message)

        if not updates:
            return 0

        params.append(transfer_id)
        query = f"""
            UPDATE transfer_history
            SET {', '.join(updates)}
            WHERE id = %s
        """
        return self.execute_update(query, tuple(params))

    def get_transfer_history(self, store_id: int = None, status: str = None,
                            start_date: str = None, end_date: str = None,
                            limit: int = 100, offset: int = 0) -> List[Dict]:
        """Get transfer history with filters"""
        conditions = []
        params = []

        if store_id is not None:
            conditions.append("shopify_store_id = %s")
            params.append(store_id)
        if status is not None and status != 'all':
            conditions.append("status = %s")
            params.append(status)
        if start_date is not None:
            conditions.append("transferred_at >= %s")
            params.append(start_date)
        if end_date is not None:
            conditions.append("transferred_at <= %s")
            params.append(end_date)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        query = f"""
            SELECT h.id, h.shopify_order_id, h.shopify_order_name, h.quotation_number,
                   h.status, h.error_message, h.line_items_count, h.total_amount,
                   h.transferred_at, s.name as store_name
            FROM transfer_history h
            JOIN shopify_stores s ON h.shopify_store_id = s.id
            {where_clause}
            ORDER BY h.transferred_at DESC
            LIMIT %s OFFSET %s
        """
        params.extend([limit, offset])
        return self.execute_query(query, tuple(params))

    def delete_transfer_record(self, transfer_id: int) -> int:
        """Delete single transfer record"""
        query = "DELETE FROM transfer_history WHERE id = %s"
        return self.execute_update(query, (transfer_id,))

    def delete_failed_transfers(self, store_id: int = None) -> int:
        """Delete all failed transfer records"""
        query = "DELETE FROM transfer_history WHERE status = 'failed'"
        params = ()

        if store_id is not None:
            query += " AND shopify_store_id = %s"
            params = (store_id,)

        return self.execute_update(query, params)

    def check_order_transferred(self, store_id: int, order_id: str) -> bool:
        """Check if order has been successfully transferred"""
        query = """
            SELECT COUNT(*) FROM transfer_history
            WHERE shopify_store_id = %s
            AND shopify_order_id = %s
            AND status = 'success'
        """
        result = self.execute_query(query, (store_id, order_id))
        return result[0]['count'] > 0 if result else False


class SQLServerManager:
    """Manages MS SQL Server connections to BackOffice and Inventory databases"""

    def __init__(self, connection_config: Dict):
        self.host = connection_config['host']
        self.port = connection_config['port']
        self.database = connection_config['database_name']
        self.username = connection_config['username']
        self.password = connection_config['password']
        self.connection_type = connection_config['connection_type']

    @contextmanager
    def get_connection(self):
        """Context manager for SQL Server connections"""
        conn = None
        try:
            conn = pymssql.connect(
                server=self.host,
                port=self.port,
                user=self.username,
                password=self.password,
                database=self.database,
                timeout=10,
                login_timeout=10
            )
            yield conn
            conn.commit()
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"SQL Server error ({self.connection_type}): {str(e)}")
            raise
        finally:
            if conn:
                conn.close()

    def execute_query(self, query: str, params: tuple = None) -> List[Dict]:
        """Execute SELECT query and return results as list of dicts"""
        with self.get_connection() as conn:
            cursor = conn.cursor(as_dict=True)
            cursor.execute(query, params or ())
            return cursor.fetchall()

    def execute_insert(self, query: str, params: tuple = None) -> Optional[int]:
        """Execute INSERT query and return inserted ID"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params or ())
            # Get SCOPE_IDENTITY() for last inserted ID
            cursor.execute("SELECT SCOPE_IDENTITY() as id")
            result = cursor.fetchone()
            return int(result[0]) if result and result[0] else None

    def execute_update(self, query: str, params: tuple = None) -> int:
        """Execute UPDATE/DELETE query and return affected rows"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params or ())
            return cursor.rowcount

    def test_connection(self) -> Tuple[bool, str]:
        """Test database connection"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT @@VERSION as version")
                result = cursor.fetchone()
                return True, f"Connected successfully. SQL Server version: {result[0][:50]}..."
        except Exception as e:
            return False, str(e)

    def verify_items_table_exists(self) -> Dict:
        """
        Verify Items_tbl exists and return diagnostic info for debugging.
        Useful for confirming database connectivity and data presence.
        """
        try:
            # Check total count
            query_count = "SELECT COUNT(*) as total FROM dbo.Items_tbl"
            count_result = self.execute_query(query_count)
            total = count_result[0]['total'] if count_result else 0

            # Get sample barcodes for verification
            query_sample = """
                SELECT TOP 5 ProductUPC, ProductDescription
                FROM dbo.Items_tbl
                WHERE ProductUPC IS NOT NULL AND ProductUPC != ''
                ORDER BY ProductID DESC
            """
            sample_result = self.execute_query(query_sample)

            logger.info(f"[{self.connection_type}] Items_tbl verified: {total} total products")

            return {
                'table_exists': True,
                'total_products': total,
                'sample_products': sample_result,
                'connection_type': self.connection_type,
                'database': self.database,
                'host': self.host
            }
        except Exception as e:
            logger.error(f"[{self.connection_type}] Failed to verify Items_tbl: {str(e)}")
            return {
                'table_exists': False,
                'error': str(e),
                'connection_type': self.connection_type,
                'database': self.database,
                'host': self.host
            }

    # ========================================================================
    # BackOffice Specific Queries
    # ========================================================================

    def get_next_quotation_number(self, db_id: str = '1') -> str:
        """
        Generate next quotation number using format: [Month][Day][Year][DB_ID][Counter]

        Args:
            db_id: Single character database identifier (e.g., '1', '6')

        Returns:
            Next quotation number as string
        """
        from datetime import datetime

        today = datetime.now()

        # Build today's prefix: MDYYYY + db_id
        date_prefix = f"{today.month}{today.day}{today.year}"
        full_prefix = f"{date_prefix}{db_id}"

        # Find max counter for today
        prefix_len = len(full_prefix)
        pattern = f"{full_prefix}%"

        query_counter = """
            SELECT ISNULL(
                MAX(CAST(SUBSTRING(QuotationNumber, %s, LEN(QuotationNumber) - %s + 1) AS INT)),
                0
            ) + 1 as next_counter
            FROM dbo.Quotations_tbl
            WHERE QuotationNumber LIKE %s
              AND ISNUMERIC(QuotationNumber) = 1
        """

        result = self.execute_query(query_counter, (prefix_len + 1, prefix_len, pattern))
        next_counter = result[0]['next_counter'] if result else 1

        return f"{full_prefix}{next_counter}"

    def get_customer_by_id(self, customer_id: int) -> Optional[Dict]:
        """Get customer details by CustomerID"""
        query = """
            SELECT CustomerID, AccountNo, BusinessName, Contactname,
                   ShipTo, ShipContact, ShipAddress1, ShipAddress2,
                   ShipCity, ShipState, ShipZipCode, ShipPhone_Number,
                   PriceLevel, TermID, SalesRepID
            FROM dbo.Customers_tbl
            WHERE CustomerID = %s
        """
        results = self.execute_query(query, (customer_id,))
        return results[0] if results else None

    def get_customers_list(self, limit: int = 100) -> List[Dict]:
        """Get list of customers for dropdown"""
        query = f"""
            SELECT TOP {limit} CustomerID, BusinessName, AccountNo
            FROM dbo.Customers_tbl
            WHERE Discontinued = 0 OR Discontinued IS NULL
            ORDER BY BusinessName
        """
        return self.execute_query(query)

    def search_customers_by_account(self, query: str, limit: int = 10) -> List[Dict]:
        """
        Search Customers_tbl by AccountNo (partial match)

        Args:
            query: Search string for AccountNo
            limit: Maximum number of results to return

        Returns:
            List of dicts with CustomerID, AccountNo, BusinessName
        """
        # Search with case-insensitive matching
        sql_query = f"""
            SELECT TOP {limit} CustomerID, AccountNo, BusinessName, Discontinued
            FROM dbo.Customers_tbl
            WHERE UPPER(AccountNo) LIKE UPPER(%s)
                AND (Discontinued = 0 OR Discontinued IS NULL)
            ORDER BY AccountNo
        """
        search_pattern = f"%{query}%"  # Search anywhere in AccountNo
        results = self.execute_query(sql_query, (search_pattern,))
        logger.info(f"Customer search '{query}' returned {len(results)} results")
        return results

    def get_product_by_upc(self, upc: str) -> Optional[Dict]:
        """Get product details by UPC/barcode"""
        query = """
            SELECT ProductID, CateID, SubCateID, ProductSKU, ProductUPC,
                   ProductDescription, UnitPrice, UnitCost, ItemSize, ItemWeight,
                   UnitID, ItemTaxID
            FROM dbo.Items_tbl
            WHERE ProductUPC = %s
        """
        results = self.execute_query(query, (upc,))
        return results[0] if results else None

    def get_products_by_upc_batch(self, upc_list: List[str]) -> Dict[str, Dict]:
        """
        Get multiple products by UPC/barcode in a single query

        Args:
            upc_list: List of UPC/barcode strings

        Returns:
            Dict mapping barcode -> product details
        """
        if not upc_list:
            logger.warning(f"[{self.connection_type}] get_products_by_upc_batch called with empty list")
            return {}

        # Log input barcodes for debugging
        logger.info(f"[{self.connection_type}] Batch lookup for {len(upc_list)} barcodes: {upc_list[:5]}{'...' if len(upc_list) > 5 else ''}")

        # Create placeholders for IN clause
        placeholders = ','.join(['%s'] * len(upc_list))

        query = f"""
            SELECT ProductID, CateID, SubCateID, ProductSKU, ProductUPC,
                   ProductDescription, UnitPrice, UnitCost, ItemSize, ItemWeight,
                   UnitID, ItemTaxID
            FROM dbo.Items_tbl
            WHERE ProductUPC IN ({placeholders})
        """

        try:
            results = self.execute_query(query, tuple(upc_list))
            logger.info(f"[{self.connection_type}] Query returned {len(results)} products")

            # Build dict mapping barcode -> product
            products_dict = {}
            for product in results:
                barcode = product.get('ProductUPC')
                if barcode:
                    products_dict[barcode] = product

            # Log which barcodes were NOT found (critical for debugging)
            found_barcodes = set(products_dict.keys())
            missing = set(upc_list) - found_barcodes
            if missing:
                logger.warning(f"[{self.connection_type}] Barcodes NOT found in DB: {list(missing)}")
            else:
                logger.info(f"[{self.connection_type}] All {len(upc_list)} barcodes found")

            return products_dict

        except Exception as e:
            logger.error(f"[{self.connection_type}] Batch query FAILED: {str(e)}")
            raise

    def copy_product_from_inventory(self, inventory_product: Dict) -> Dict:
        """
        Copy product from Inventory database to BackOffice Items_tbl

        Args:
            inventory_product: Product dict from Inventory database

        Returns:
            Full product dict with new ProductID
        """
        query = """
            INSERT INTO dbo.Items_tbl (
                CateID, SubCateID, ProductSKU, ProductUPC, ProductDescription,
                UnitPrice, UnitCost, ItemSize, ItemWeight, UnitID, ItemTaxID,
                SPPromoted
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
        """
        product_id = self.execute_insert(query, (
            inventory_product.get('CateID'),
            inventory_product.get('SubCateID'),
            inventory_product.get('ProductSKU'),
            inventory_product.get('ProductUPC'),
            inventory_product.get('ProductDescription'),
            inventory_product.get('UnitPrice'),
            inventory_product.get('UnitCost'),
            inventory_product.get('ItemSize'),
            inventory_product.get('ItemWeight'),
            inventory_product.get('UnitID'),
            inventory_product.get('ItemTaxID'),
            inventory_product.get('SPPromoted', 0)  # Default to 0 if not in Inventory
        ))

        # Return full product dict with new ProductID
        copied_product = dict(inventory_product)
        copied_product['ProductID'] = product_id
        return copied_product

    def get_unit_description(self, unit_id: int) -> Optional[str]:
        """Get unit description from Units_tbl"""
        if not unit_id:
            return None
        query = "SELECT UnitDesc FROM dbo.Units_tbl WHERE UnitID = %s"
        results = self.execute_query(query, (unit_id,))
        return results[0]['UnitDesc'] if results else None

    def create_quotation_header(self, quotation_data: Dict) -> int:
        """Create quotation header and return QuotationID"""
        query = """
            INSERT INTO dbo.Quotations_tbl (
                QuotationNumber, QuotationDate, QuotationTitle, PoNumber, AutoOrderNo,
                ExpirationDate, CustomerID, BusinessName, AccountNo,
                Shipto, ShipAddress1, ShipAddress2, ShipContact,
                ShipCity, ShipState, ShipZipCode, ShipPhoneNo,
                Status, ShipperID, SalesRepID, TermID, TotalTaxes, QuotationTotal,
                Header, Footer, Notes, Memo, flaged
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
        """
        return self.execute_insert(query, (
            quotation_data['QuotationNumber'],
            quotation_data['QuotationDate'],
            quotation_data['QuotationTitle'],
            quotation_data.get('PoNumber'),
            quotation_data.get('AutoOrderNo'),
            quotation_data['ExpirationDate'],
            quotation_data['CustomerID'],
            quotation_data['BusinessName'],
            quotation_data.get('AccountNo'),
            quotation_data.get('Shipto'),
            quotation_data.get('ShipAddress1'),
            quotation_data.get('ShipAddress2', ''),
            quotation_data.get('ShipContact'),
            quotation_data.get('ShipCity'),
            quotation_data.get('ShipState'),
            quotation_data.get('ShipZipCode'),
            quotation_data.get('ShipPhoneNo', ''),
            quotation_data.get('Status'),
            quotation_data.get('ShipperID'),
            quotation_data.get('SalesRepID'),
            quotation_data.get('TermID'),
            quotation_data.get('TotalTaxes', 0),
            quotation_data.get('QuotationTotal', 0),
            quotation_data.get('Header', ''),
            quotation_data.get('Footer', ''),
            quotation_data.get('Notes', ''),
            quotation_data.get('Memo', ''),
            quotation_data.get('flaged', 0)
        ))

    def create_quotation_line(self, quotation_id: int, line_data: Dict) -> int:
        """Create quotation detail line"""
        query = """
            INSERT INTO dbo.QuotationsDetails_tbl (
                QuotationID, CateID, SubCateID, UnitDesc, UnitQty,
                ProductID, ProductSKU, ProductUPC, ProductDescription, ItemSize,
                ExpDate, ReasonID, LineMessage,
                UnitPrice, OriginalPrice, RememberPrice, UnitCost,
                Discount, ds_Percent, Qty, ItemWeight,
                ExtendedPrice, ExtendedDisc, ExtendedCost,
                PromotionID, PromotionLine, PromotionDescription, PromotionAmount,
                ActExtendedPrice, SPPromoted, SPPromotionDescription,
                Taxable, ItemTaxID, Catch, Comments, Flag
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
        """
        return self.execute_insert(query, (
            quotation_id,
            line_data.get('CateID'),
            line_data.get('SubCateID'),
            line_data.get('UnitDesc'),
            line_data.get('UnitQty', 1),
            line_data.get('ProductID'),
            line_data.get('ProductSKU'),
            line_data.get('ProductUPC'),
            line_data.get('ProductDescription'),
            line_data.get('ItemSize', ''),
            line_data.get('ExpDate'),
            line_data.get('ReasonID'),
            line_data.get('LineMessage', ''),
            line_data.get('UnitPrice'),
            line_data.get('OriginalPrice'),
            line_data.get('RememberPrice', 0),
            line_data.get('UnitCost'),
            line_data.get('Discount', 0),
            line_data.get('ds_Percent', 0),
            line_data.get('Qty'),
            line_data.get('ItemWeight'),
            line_data.get('ExtendedPrice'),
            line_data.get('ExtendedDisc', 0),
            line_data.get('ExtendedCost'),
            line_data.get('PromotionID'),
            line_data.get('PromotionLine', 0),
            line_data.get('PromotionDescription', ''),
            line_data.get('PromotionAmount', 0),
            line_data.get('ActExtendedPrice', 0),
            line_data.get('SPPromoted', 0),
            line_data.get('SPPromotionDescription', ''),
            line_data.get('Taxable', 0),
            line_data.get('ItemTaxID'),
            line_data.get('Catch'),
            line_data.get('Comments', ''),
            line_data.get('Flag', 0)
        ))
