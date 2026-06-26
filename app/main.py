"""
Shopify Quotation Transfer Application - Main Flask App
Handles API endpoints for orders, settings, and history management
"""

import os
import logging
from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
from datetime import datetime
from zoneinfo import ZoneInfo

from app.database import PostgreSQLManager, SQLServerManager
from app.shopify_client import ShopifyClient
from app.validator import ProductValidator
from app.converter import QuotationConverter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False
CORS(app)

# Initialize PostgreSQL manager
postgres = PostgreSQLManager()

# Central Time timezone
CENTRAL_TZ = ZoneInfo("America/Chicago")


def get_sqlserver_managers():
    """Get BackOffice and Inventory SQL Server managers"""
    backoffice_config = postgres.get_sql_connection('backoffice')
    inventory_config = postgres.get_sql_connection('inventory')

    if not backoffice_config:
        raise Exception("BackOffice database not configured")
    if not inventory_config:
        raise Exception("Inventory database not configured")

    backoffice = SQLServerManager(backoffice_config)
    inventory = SQLServerManager(inventory_config)

    return backoffice, inventory


# ============================================================================
# PAGE ROUTES
# ============================================================================

@app.route('/')
def index():
    """Orders page (landing)"""
    return render_template('orders.html')


@app.route('/history')
def history():
    """History page"""
    return render_template('history.html')


@app.route('/settings')
def settings():
    """Settings page"""
    return render_template('settings.html')


# ============================================================================
# SHOPIFY STORES API
# ============================================================================

_STORE_SECRET_KEYS = ('oauth_client_secret', 'oauth_access_token', 'admin_api_token')


def _strip_store_secrets(store: dict) -> dict:
    """Remove secret fields from a store dict before returning it to clients.
    admin_api_token is also stripped to avoid exposing legacy shpat_ values."""
    return {k: v for k, v in store.items() if k not in _STORE_SECRET_KEYS}


@app.route('/api/stores', methods=['GET'])
def get_stores():
    """Get all Shopify stores (secrets stripped)."""
    try:
        stores = postgres.get_shopify_stores(active_only=False)
        stores = [_strip_store_secrets(s) for s in stores]
        return jsonify({'success': True, 'stores': stores})
    except Exception as e:
        logger.error(f"Failed to get stores: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _validate_store_payload(data: dict, require_credentials: bool):
    """Returns (auth_method, kwargs_for_manager) or raises ValueError."""
    auth_method = data.get('auth_method') or 'legacy_token'
    if auth_method not in ('legacy_token', 'oauth_client_credentials'):
        raise ValueError(f"Invalid auth_method: {auth_method}")

    kwargs = {
        'name': data.get('name'),
        'shop_url': data.get('shop_url'),
        'auth_method': auth_method,
    }

    if auth_method == 'legacy_token':
        api_token = data.get('api_token')
        if require_credentials and not api_token:
            raise ValueError("Legacy auth requires api_token")
        if api_token:
            kwargs['api_token'] = api_token
    else:  # oauth_client_credentials
        client_id = data.get('oauth_client_id')
        client_secret = data.get('oauth_client_secret')
        if require_credentials and not (client_id and client_secret):
            raise ValueError("OAuth auth requires oauth_client_id and oauth_client_secret")
        if client_id:
            kwargs['oauth_client_id'] = client_id
        if client_secret:
            kwargs['oauth_client_secret'] = client_secret

    return kwargs


@app.route('/api/stores', methods=['POST'])
def create_store():
    """Create new Shopify store (legacy token OR OAuth client credentials)."""
    try:
        data = request.get_json() or {}
        if not data.get('name') or not data.get('shop_url'):
            return jsonify({'success': False, 'error': 'Missing name or shop_url'}), 400

        kwargs = _validate_store_payload(data, require_credentials=True)
        store_id = postgres.create_shopify_store(**kwargs)
        return jsonify({'success': True, 'store_id': store_id})
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        logger.error(f"Failed to create store: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stores/<int:store_id>', methods=['PUT'])
def update_store(store_id):
    """Update Shopify store. Credentials are only touched if supplied."""
    try:
        data = request.get_json() or {}
        kwargs = _validate_store_payload(data, require_credentials=False)
        # Drop None name/shop_url so they don't clobber existing values
        kwargs = {k: v for k, v in kwargs.items() if v is not None}
        affected = postgres.update_shopify_store(store_id, **kwargs)
        return jsonify({'success': True, 'affected_rows': affected})
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        logger.error(f"Failed to update store: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stores/<int:store_id>', methods=['DELETE'])
def delete_store(store_id):
    """Delete Shopify store"""
    try:
        affected = postgres.delete_shopify_store(store_id)
        return jsonify({'success': True, 'affected_rows': affected})
    except Exception as e:
        logger.error(f"Failed to delete store: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stores/<int:store_id>/test', methods=['POST'])
def test_store_connection(store_id):
    """Test a saved Shopify store's connection (legacy or OAuth)."""
    try:
        store = postgres.get_shopify_store(store_id)
        if not store:
            return jsonify({'success': False, 'error': 'Store not found'}), 404

        client = ShopifyClient(store, postgres_mgr=postgres)
        success, message = client.test_connection()

        return jsonify({'success': success, 'message': message})
    except Exception as e:
        logger.error(f"Connection test failed: {str(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/stores/oauth/test', methods=['POST'])
def test_oauth_credentials():
    """Test OAuth Client ID + Secret BEFORE saving a store.
    Performs a one-shot client_credentials exchange plus a shop query."""
    try:
        data = request.get_json() or {}
        shop_url = data.get('shop_url')
        client_id = data.get('oauth_client_id')
        client_secret = data.get('oauth_client_secret')

        if not all([shop_url, client_id, client_secret]):
            return jsonify({
                'success': False,
                'message': 'shop_url, oauth_client_id, and oauth_client_secret are required',
            }), 400

        ephemeral_store = {
            'id': None,
            'shop_url': shop_url,
            'auth_method': 'oauth_client_credentials',
            'oauth_client_id': client_id,
            'oauth_client_secret': client_secret,
        }
        # No postgres_mgr: we don't want to persist a token for an unsaved store
        client = ShopifyClient(ephemeral_store)
        success, message = client.test_connection()
        return jsonify({'success': success, 'message': message})
    except Exception as e:
        logger.error(f"OAuth credential test failed: {str(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500


# ============================================================================
# SQL CONNECTIONS API
# ============================================================================

@app.route('/api/sql-connections', methods=['GET'])
def get_sql_connections():
    """Get SQL Server connection configs (passwords excluded from response)"""
    try:
        connections = postgres.get_sql_connections()

        # Remove passwords from response
        for conn in connections:
            if 'password' in conn:
                del conn['password']

        return jsonify({'success': True, 'connections': connections})
    except Exception as e:
        logger.error(f"Failed to get SQL connections: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sql-connections', methods=['POST'])
def save_sql_connection():
    """Save/update SQL Server connection"""
    try:
        data = request.get_json()
        connection_type = data.get('connection_type')  # 'backoffice' or 'inventory'
        host = data.get('host')
        port = data.get('port', 1433)
        database_name = data.get('database_name')
        username = data.get('username')
        password = data.get('password')

        if not all([connection_type, host, database_name, username, password]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        if connection_type not in ['backoffice', 'inventory']:
            return jsonify({'success': False, 'error': 'Invalid connection type'}), 400

        conn_id = postgres.upsert_sql_connection(
            connection_type, host, port, database_name, username, password
        )

        return jsonify({'success': True, 'connection_id': conn_id})
    except Exception as e:
        logger.error(f"Failed to save SQL connection: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sql-connections/<connection_type>/test', methods=['POST'])
def test_sql_connection(connection_type):
    """Test SQL Server connection"""
    try:
        config = postgres.get_sql_connection(connection_type)
        if not config:
            return jsonify({'success': False, 'message': 'Connection not configured'}), 404

        manager = SQLServerManager(config)
        success, message = manager.test_connection()

        return jsonify({'success': success, 'message': message})
    except Exception as e:
        logger.error(f"SQL connection test failed: {str(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500


# ============================================================================
# CUSTOMER MAPPINGS API
# ============================================================================

@app.route('/api/customer-mappings/<int:store_id>', methods=['GET'])
def get_customer_mapping(store_id):
    """Get customer mapping for store"""
    try:
        mapping = postgres.get_customer_mapping(store_id)
        return jsonify({'success': True, 'mapping': mapping})
    except Exception as e:
        logger.error(f"Failed to get customer mapping: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/customer-mappings', methods=['POST'])
def save_customer_mapping():
    """Save/update customer mapping"""
    try:
        data = request.get_json()
        store_id = data.get('store_id')
        customer_id = data.get('customer_id')
        business_name = data.get('business_name')

        if not all([store_id, customer_id]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        mapping_id = postgres.upsert_customer_mapping(store_id, customer_id, business_name)
        return jsonify({'success': True, 'mapping_id': mapping_id})
    except Exception as e:
        logger.error(f"Failed to save customer mapping: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/customers', methods=['GET'])
def get_customers_list():
    """Get list of customers from BackOffice for dropdown"""
    try:
        backoffice, _ = get_sqlserver_managers()
        customers = backoffice.get_customers_list(limit=500)
        return jsonify({'success': True, 'customers': customers})
    except Exception as e:
        logger.error(f"Failed to get customers list: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/customers/search', methods=['GET'])
def search_customers():
    """Search customers by AccountNo for autocomplete"""
    try:
        query = request.args.get('query', '').strip()
        store_id = request.args.get('store_id', type=int)

        if not query or len(query) < 2:
            return jsonify({'success': False, 'error': 'Query must be at least 2 characters'}), 400

        if not store_id:
            return jsonify({'success': False, 'error': 'store_id is required'}), 400

        backoffice, _ = get_sqlserver_managers()
        customers = backoffice.search_customers_by_account(query, limit=10)
        return jsonify({'success': True, 'customers': customers})
    except Exception as e:
        logger.error(f"Failed to search customers: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# QUOTATION DEFAULTS API
# ============================================================================

@app.route('/api/quotation-defaults/<int:store_id>', methods=['GET'])
def get_quotation_defaults(store_id):
    """Get quotation defaults for store"""
    try:
        defaults = postgres.get_quotation_defaults(store_id)
        return jsonify({'success': True, 'defaults': defaults})
    except Exception as e:
        logger.error(f"Failed to get quotation defaults: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/quotation-defaults', methods=['POST'])
def save_quotation_defaults():
    """Save/update quotation defaults"""
    try:
        data = request.get_json()
        store_id = data.get('store_id')
        status = data.get('status')
        shipper_id = data.get('shipper_id')
        sales_rep_id = data.get('sales_rep_id')
        term_id = data.get('term_id')
        quotation_title_prefix = data.get('quotation_title_prefix')
        expiration_days = data.get('expiration_days', 365)
        db_id = data.get('db_id', '1')

        if not store_id:
            return jsonify({'success': False, 'error': 'Missing store_id'}), 400

        defaults_id = postgres.upsert_quotation_defaults(
            store_id, status, shipper_id, sales_rep_id, term_id,
            quotation_title_prefix, expiration_days, db_id
        )

        return jsonify({'success': True, 'defaults_id': defaults_id})
    except Exception as e:
        logger.error(f"Failed to save quotation defaults: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# ORDERS API
# ============================================================================

@app.route('/api/orders', methods=['GET'])
def get_orders():
    """Get unfulfilled orders from Shopify store"""
    try:
        store_id = request.args.get('store_id', type=int)
        days_back = request.args.get('days_back', default=14, type=int)

        if not store_id:
            return jsonify({'success': False, 'error': 'Missing store_id'}), 400

        store = postgres.get_shopify_store(store_id)
        if not store:
            return jsonify({'success': False, 'error': 'Store not found'}), 404

        # Check if already transferred
        client = ShopifyClient(store, postgres_mgr=postgres)
        result = client.get_unfulfilled_orders(days_back=days_back)

        # Defensively drop cancelled orders (the Shopify query already filters
        # by status:open, this guarantees they never reach the frontend)
        orders = [o for o in result['orders'] if not o.get('cancelled')]

        # Mark orders that have been transferred
        for order in orders:
            order['transferred'] = postgres.check_order_transferred(
                store_id, order['id']
            )

        return jsonify({
            'success': True,
            'orders': orders,
            'page_info': result['page_info'],
            'total_fetched': result['total_fetched']
        })
    except Exception as e:
        logger.error(f"Failed to fetch orders: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/orders/validate', methods=['POST'])
def validate_order_products():
    """Validate order products (2-database lookup)"""
    try:
        data = request.get_json()
        store_id = data.get('store_id')
        order_id = data.get('order_id')

        if not all([store_id, order_id]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        # Get order from Shopify
        store = postgres.get_shopify_store(store_id)
        if not store:
            return jsonify({'success': False, 'error': 'Store not found'}), 404

        client = ShopifyClient(store, postgres_mgr=postgres)
        order = client.get_order_by_id(order_id)

        if not order:
            return jsonify({'success': False, 'error': 'Order not found'}), 404

        # Get exclusion prefixes
        exclusions = postgres.get_product_exclusions()
        exclusion_prefixes = [e['prefix'] for e in exclusions]

        # Validate products
        backoffice, inventory = get_sqlserver_managers()
        validator = ProductValidator(backoffice, inventory)

        validation_result = validator.validate_order_products(
            order['line_items'],
            exclusion_prefixes=exclusion_prefixes
        )

        return jsonify({
            'success': True,
            'validation': validation_result,
            'order_name': order['name']
        })
    except Exception as e:
        import traceback
        error_msg = str(e) if str(e) else repr(e)
        logger.error(f"Product validation failed: {error_msg}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'success': False, 'error': error_msg}), 500


@app.route('/api/orders/transfer', methods=['POST'])
def transfer_orders():
    """Transfer selected orders to quotations"""
    try:
        data = request.get_json()
        store_id = data.get('store_id')
        order_ids = data.get('order_ids', [])
        custom_customers = data.get('custom_customers', {})  # Optional: order_id -> customer_id mapping

        if not all([store_id, order_ids]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        store = postgres.get_shopify_store(store_id)
        if not store:
            return jsonify({'success': False, 'error': 'Store not found'}), 404

        # Get exclusion prefixes
        exclusions = postgres.get_product_exclusions()
        exclusion_prefixes = [e['prefix'] for e in exclusions]

        # Initialize managers
        client = ShopifyClient(store, postgres_mgr=postgres)
        backoffice, inventory = get_sqlserver_managers()
        validator = ProductValidator(backoffice, inventory)
        converter = QuotationConverter(backoffice, postgres)

        results = []

        for order_id in order_ids:
            try:
                # Check if already transferred
                if postgres.check_order_transferred(store_id, order_id):
                    results.append({
                        'order_id': order_id,
                        'success': False,
                        'error': 'Order already transferred',
                        'quotation_number': None
                    })
                    continue

                # Fetch order
                order = client.get_order_by_id(order_id)
                if not order:
                    results.append({
                        'order_id': order_id,
                        'success': False,
                        'error': 'Order not found',
                        'quotation_number': None
                    })
                    continue

                # Validate products (with exclusion prefixes)
                validation = validator.validate_order_products(
                    order['line_items'],
                    exclusion_prefixes=exclusion_prefixes
                )

                if not validation['valid']:
                    error_msg = f"Missing products: {', '.join([m['barcode'] for m in validation['missing']])}"
                    results.append({
                        'order_id': order_id,
                        'order_name': order['name'],
                        'success': False,
                        'error': error_msg,
                        'quotation_number': None,
                        'validation': validation
                    })

                    # Record failed attempt
                    postgres.create_transfer_record(
                        store_id, order['id'], order['name'], None, 'failed',
                        error_msg, len(order['line_items']), order['total_amount']
                    )
                    continue

                # Get custom customer_id if provided
                custom_customer_id = custom_customers.get(order_id)

                # Create quotation
                conv_result = converter.create_quotation_with_transaction(
                    order, store_id, validation['products'], customer_id_override=custom_customer_id
                )

                if conv_result['success']:
                    # Record successful transfer
                    postgres.create_transfer_record(
                        store_id, order['id'], order['name'],
                        conv_result['quotation_number'], 'success',
                        None, conv_result['line_items'], conv_result['total_amount']
                    )

                    results.append({
                        'order_id': order_id,
                        'order_name': order['name'],
                        'success': True,
                        'quotation_number': conv_result['quotation_number'],
                        'line_items': conv_result['line_items'],
                        'total_amount': conv_result['total_amount']
                    })
                else:
                    # Record failed attempt
                    postgres.create_transfer_record(
                        store_id, order['id'], order['name'], None, 'failed',
                        conv_result['error'], len(order['line_items']), order['total_amount']
                    )

                    results.append({
                        'order_id': order_id,
                        'order_name': order['name'],
                        'success': False,
                        'error': conv_result['error'],
                        'quotation_number': None
                    })

            except Exception as order_error:
                logger.error(f"Failed to transfer order {order_id}: {str(order_error)}")
                results.append({
                    'order_id': order_id,
                    'success': False,
                    'error': str(order_error),
                    'quotation_number': None
                })

        success_count = sum(1 for r in results if r['success'])
        failed_count = len(results) - success_count

        return jsonify({
            'success': True,
            'results': results,
            'summary': {
                'total': len(results),
                'success': success_count,
                'failed': failed_count
            }
        })

    except Exception as e:
        logger.error(f"Transfer operation failed: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# HISTORY API
# ============================================================================

@app.route('/api/history', methods=['GET'])
def get_history():
    """Get transfer history with filters"""
    try:
        store_id = request.args.get('store_id', type=int)
        status = request.args.get('status', 'all')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        limit = request.args.get('limit', default=100, type=int)
        offset = request.args.get('offset', default=0, type=int)

        history = postgres.get_transfer_history(
            store_id, status, start_date, end_date, limit, offset
        )

        return jsonify({
            'success': True,
            'history': history,
            'total_returned': len(history)
        })
    except Exception as e:
        logger.error(f"Failed to get history: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/history/<int:transfer_id>', methods=['DELETE'])
def delete_history_record(transfer_id):
    """Delete single history record"""
    try:
        affected = postgres.delete_transfer_record(transfer_id)
        return jsonify({'success': True, 'affected_rows': affected})
    except Exception as e:
        logger.error(f"Failed to delete history record: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/history/delete-failed', methods=['POST'])
def delete_failed_transfers():
    """Delete all failed transfer records"""
    try:
        data = request.get_json()
        store_id = data.get('store_id')

        affected = postgres.delete_failed_transfers(store_id)
        return jsonify({'success': True, 'affected_rows': affected})
    except Exception as e:
        logger.error(f"Failed to delete failed records: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# PRODUCT EXCLUSIONS API
# ============================================================================

@app.route('/api/product-exclusions', methods=['GET'])
def get_product_exclusions():
    """Get all product exclusion prefixes"""
    try:
        exclusions = postgres.get_product_exclusions()
        return jsonify({'success': True, 'exclusions': exclusions})
    except Exception as e:
        logger.error(f"Failed to get product exclusions: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/product-exclusions', methods=['POST'])
def add_product_exclusion():
    """Add new product exclusion prefix"""
    try:
        data = request.get_json()
        prefix = data.get('prefix', '').strip()

        if not prefix:
            return jsonify({'success': False, 'error': 'Prefix cannot be empty'}), 400

        if len(prefix) > 100:
            return jsonify({'success': False, 'error': 'Prefix cannot exceed 100 characters'}), 400

        exclusion_id = postgres.add_product_exclusion(prefix)
        return jsonify({'success': True, 'exclusion_id': exclusion_id})
    except Exception as e:
        error_msg = str(e)
        if 'duplicate key' in error_msg.lower() or 'unique constraint' in error_msg.lower():
            return jsonify({'success': False, 'error': 'This prefix already exists'}), 400
        logger.error(f"Failed to add product exclusion: {error_msg}")
        return jsonify({'success': False, 'error': error_msg}), 500


@app.route('/api/product-exclusions/<int:exclusion_id>', methods=['DELETE'])
def delete_product_exclusion(exclusion_id):
    """Delete product exclusion by ID"""
    try:
        affected = postgres.delete_product_exclusion(exclusion_id)
        return jsonify({'success': True, 'affected_rows': affected})
    except Exception as e:
        logger.error(f"Failed to delete product exclusion: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# DEBUG ENDPOINTS
# ============================================================================

@app.route('/api/debug/verify-databases', methods=['GET'])
def verify_databases():
    """
    Verify both SQL Server databases are properly connected.
    Returns detailed info about each database including Items_tbl status.
    """
    try:
        backoffice_config = postgres.get_sql_connection('backoffice')
        inventory_config = postgres.get_sql_connection('inventory')

        result = {
            'backoffice': {'configured': backoffice_config is not None},
            'inventory': {'configured': inventory_config is not None}
        }

        # Test BackOffice connection
        if backoffice_config:
            result['backoffice']['host'] = backoffice_config.get('host')
            result['backoffice']['database'] = backoffice_config.get('database_name')
            backoffice = SQLServerManager(backoffice_config)
            success, msg = backoffice.test_connection()
            result['backoffice']['connection_ok'] = success
            result['backoffice']['message'] = msg
            if success:
                result['backoffice']['table_info'] = backoffice.verify_items_table_exists()

        # Test Inventory connection
        if inventory_config:
            result['inventory']['host'] = inventory_config.get('host')
            result['inventory']['database'] = inventory_config.get('database_name')
            inventory = SQLServerManager(inventory_config)
            success, msg = inventory.test_connection()
            result['inventory']['connection_ok'] = success
            result['inventory']['message'] = msg
            if success:
                result['inventory']['table_info'] = inventory.verify_items_table_exists()

        return jsonify({'success': True, 'databases': result})

    except Exception as e:
        logger.error(f"Database verification failed: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/debug/product-lookup', methods=['POST'])
def debug_product_lookup():
    """
    Debug endpoint to test product lookup in both databases.
    Useful for diagnosing why products aren't found during validation.
    """
    try:
        data = request.get_json()
        barcodes = data.get('barcodes', [])

        if not barcodes:
            return jsonify({'success': False, 'error': 'No barcodes provided'}), 400

        # Handle string input (comma-separated)
        if isinstance(barcodes, str):
            barcodes = [b.strip() for b in barcodes.split(',') if b.strip()]

        logger.info(f"Debug product lookup for barcodes: {barcodes}")

        backoffice, inventory = get_sqlserver_managers()

        # Lookup in both databases
        backoffice_results = backoffice.get_products_by_upc_batch(barcodes)
        inventory_results = inventory.get_products_by_upc_batch(barcodes)

        return jsonify({
            'success': True,
            'input_barcodes': barcodes,
            'backoffice': {
                'host': backoffice.host,
                'database': backoffice.database,
                'found_count': len(backoffice_results),
                'found_barcodes': list(backoffice_results.keys()),
                'not_found': [b for b in barcodes if b not in backoffice_results],
                'products': {k: {'ProductID': v.get('ProductID'), 'ProductDescription': v.get('ProductDescription')}
                            for k, v in backoffice_results.items()}
            },
            'inventory': {
                'host': inventory.host,
                'database': inventory.database,
                'found_count': len(inventory_results),
                'found_barcodes': list(inventory_results.keys()),
                'not_found': [b for b in barcodes if b not in inventory_results],
                'products': {k: {'ProductID': v.get('ProductID'), 'ProductDescription': v.get('ProductDescription')}
                            for k, v in inventory_results.items()}
            }
        })

    except Exception as e:
        import traceback
        logger.error(f"Debug product lookup failed: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now(CENTRAL_TZ).isoformat(),
        'service': 'shopify-quotation-transfer'
    })


# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.errorhandler(404)
def not_found(e):
    """404 error handler"""
    return jsonify({'success': False, 'error': 'Resource not found'}), 404


@app.errorhandler(500)
def internal_error(e):
    """500 error handler"""
    logger.error(f"Internal server error: {str(e)}")
    return jsonify({'success': False, 'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
