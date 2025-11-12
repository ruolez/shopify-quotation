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

@app.route('/api/stores', methods=['GET'])
def get_stores():
    """Get all Shopify stores"""
    try:
        stores = postgres.get_shopify_stores(active_only=False)
        return jsonify({'success': True, 'stores': stores})
    except Exception as e:
        logger.error(f"Failed to get stores: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stores', methods=['POST'])
def create_store():
    """Create new Shopify store"""
    try:
        data = request.get_json()
        name = data.get('name')
        shop_url = data.get('shop_url')
        api_token = data.get('api_token')

        if not all([name, shop_url, api_token]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        store_id = postgres.create_shopify_store(name, shop_url, api_token)
        return jsonify({'success': True, 'store_id': store_id})
    except Exception as e:
        logger.error(f"Failed to create store: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stores/<int:store_id>', methods=['PUT'])
def update_store(store_id):
    """Update Shopify store"""
    try:
        data = request.get_json()
        name = data.get('name')
        shop_url = data.get('shop_url')
        api_token = data.get('api_token')

        affected = postgres.update_shopify_store(store_id, name, shop_url, api_token)
        return jsonify({'success': True, 'affected_rows': affected})
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
    """Test Shopify store connection"""
    try:
        store = postgres.get_shopify_store(store_id)
        if not store:
            return jsonify({'success': False, 'error': 'Store not found'}), 404

        client = ShopifyClient(store['shop_url'], store['admin_api_token'])
        success, message = client.test_connection()

        return jsonify({'success': success, 'message': message})
    except Exception as e:
        logger.error(f"Connection test failed: {str(e)}")
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

        if not store_id:
            return jsonify({'success': False, 'error': 'Missing store_id'}), 400

        defaults_id = postgres.upsert_quotation_defaults(
            store_id, status, shipper_id, sales_rep_id, term_id,
            quotation_title_prefix, expiration_days
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
        client = ShopifyClient(store['shop_url'], store['admin_api_token'])
        result = client.get_unfulfilled_orders(days_back=days_back)

        orders = result['orders']

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

        client = ShopifyClient(store['shop_url'], store['admin_api_token'])
        order = client.get_order_by_id(order_id)

        if not order:
            return jsonify({'success': False, 'error': 'Order not found'}), 404

        # Validate products
        backoffice, inventory = get_sqlserver_managers()
        validator = ProductValidator(backoffice, inventory)

        validation_result = validator.validate_order_products(order['line_items'])

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

        if not all([store_id, order_ids]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        store = postgres.get_shopify_store(store_id)
        if not store:
            return jsonify({'success': False, 'error': 'Store not found'}), 404

        # Initialize managers
        client = ShopifyClient(store['shop_url'], store['admin_api_token'])
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

                # Validate products
                validation = validator.validate_order_products(order['line_items'])

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

                # Create quotation
                conv_result = converter.create_quotation_with_transaction(
                    order, store_id, validation['products']
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
