"""
Quotation Converter
Converts Shopify orders into BackOffice SQL quotations
Handles header and line item creation with proper field mapping
"""

import logging
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from app.database import SQLServerManager, PostgreSQLManager

logger = logging.getLogger(__name__)


class QuotationConverter:
    """Converts Shopify orders to BackOffice quotations"""

    def __init__(self, backoffice_manager: SQLServerManager,
                 postgres_manager: PostgreSQLManager):
        """
        Initialize converter

        Args:
            backoffice_manager: BackOffice SQL Server manager
            postgres_manager: PostgreSQL manager for settings
        """
        self.backoffice = backoffice_manager
        self.postgres = postgres_manager

    def convert_order(self, shopify_order: Dict, store_id: int,
                     validated_products: List[Dict],
                     customer_id_override: Optional[int] = None) -> Dict:
        """
        Convert Shopify order to quotation

        Args:
            shopify_order: Parsed Shopify order dict
            store_id: Shopify store ID
            validated_products: List of validated products from validator
            customer_id_override: Optional custom customer ID to use instead of default mapping

        Returns:
            Dict with quotation details:
            {
                'quotation_id': int,
                'quotation_number': str,
                'line_items_created': int,
                'total_amount': float
            }
        """
        try:
            # Get store settings
            defaults = self.postgres.get_quotation_defaults(store_id)
            if not defaults:
                raise Exception("No quotation defaults configured for this store")

            # Determine which customer_id to use
            if customer_id_override:
                # Use custom customer ID if provided
                customer_id = customer_id_override
                logger.info(f"Using custom customer ID: {customer_id}")
            else:
                # Use default customer mapping
                customer_mapping = self.postgres.get_customer_mapping(store_id)
                if not customer_mapping:
                    raise Exception("No customer mapping configured for this store")
                customer_id = customer_mapping['customer_id']
                logger.info(f"Using default customer ID from mapping: {customer_id}")

            # Get customer details from BackOffice
            customer = self.backoffice.get_customer_by_id(customer_id)
            if not customer:
                raise Exception(f"Customer ID {customer_id} not found in BackOffice")

            # Generate quotation number
            db_id = defaults.get('db_id') or '1'
            quotation_number = str(self.backoffice.get_next_quotation_number(db_id))

            # Build quotation header
            quotation_header = self._build_quotation_header(
                shopify_order, customer, defaults, quotation_number
            )

            # Calculate total from validated products
            quotation_total = sum(
                (p.get('shopify_quantity') or 1) * (p.get('shopify_price') or p.get('UnitPrice') or 0)
                for p in validated_products
            )
            quotation_header['QuotationTotal'] = quotation_total

            # Create quotation header
            logger.info(f"Creating quotation header with number: {quotation_number}")
            quotation_id = self.backoffice.create_quotation_header(quotation_header)

            if not quotation_id:
                raise Exception("Failed to create quotation header")

            logger.info(f"Created quotation ID: {quotation_id}")

            # Create quotation line items
            line_items_created = 0
            for product in validated_products:
                line_data = self._build_quotation_line(product, customer)

                try:
                    line_id = self.backoffice.create_quotation_line(
                        quotation_id, line_data
                    )
                    if line_id:
                        line_items_created += 1
                        logger.debug(f"Created line item {line_id} for product {product.get('ProductUPC')}")
                    else:
                        logger.warning(f"Failed to create line for product {product.get('ProductUPC')}")

                except Exception as line_error:
                    logger.error(f"Error creating line for product {product.get('ProductUPC')}: {str(line_error)}")
                    # Continue with other lines even if one fails

            if line_items_created == 0:
                raise Exception("Failed to create any quotation line items")

            logger.info(f"Created {line_items_created} line items for quotation {quotation_number}")

            return {
                'quotation_id': quotation_id,
                'quotation_number': quotation_number,
                'line_items_created': line_items_created,
                'total_amount': quotation_total
            }

        except Exception as e:
            logger.error(f"Failed to convert order to quotation: {str(e)}")
            raise

    def _build_quotation_header(self, shopify_order: Dict, customer: Dict,
                                defaults: Dict, quotation_number: str) -> Dict:
        """Build quotation header dict from Shopify order and settings"""

        # Get Shopify shipping address
        ship_addr = shopify_order.get('shipping_address', {})

        # Build quotation title
        title_prefix = defaults.get('quotation_title_prefix', 'Shopify Order')
        quotation_title = f"{title_prefix} {shopify_order.get('name', '')}"
        quotation_title = quotation_title[:50]  # Max length 50

        # Calculate dates
        quotation_date = datetime.now()
        expiration_days = defaults.get('expiration_days', 365)
        expiration_date = quotation_date + timedelta(days=expiration_days)

        # Truncate string fields to max length
        def truncate(text, max_len):
            return str(text or '')[:max_len] if text else None

        return {
            'QuotationNumber': quotation_number,
            'QuotationDate': quotation_date,
            'QuotationTitle': quotation_title,
            'PoNumber': truncate(shopify_order.get('name'), 20),  # Use Shopify order name as PO
            'ExpirationDate': expiration_date,

            # Customer data from BackOffice
            'CustomerID': customer.get('CustomerID'),
            'BusinessName': truncate(customer.get('BusinessName'), 50),
            'AccountNo': truncate(customer.get('AccountNo'), 13),

            # Shipping address from Shopify
            'Shipto': truncate(ship_addr.get('company') or
                             f"{ship_addr.get('first_name', '')} {ship_addr.get('last_name', '')}".strip(),
                             50),
            'ShipAddress1': truncate(ship_addr.get('address1'), 50),
            'ShipAddress2': '',  # Default to empty string
            'ShipContact': truncate(
                f"{ship_addr.get('first_name', '')} {ship_addr.get('last_name', '')}".strip(),
                50
            ),
            'ShipCity': truncate(ship_addr.get('city'), 20),
            'ShipState': truncate(ship_addr.get('province_code'), 3),
            'ShipZipCode': truncate(ship_addr.get('zip'), 10),
            'ShipPhoneNo': '',  # Default to empty string

            # Defaults from settings (with customer overrides where applicable)
            'Status': defaults.get('status', 1),
            'ShipperID': defaults.get('shipper_id'),
            'SalesRepID': customer.get('SalesRepID') or defaults.get('sales_rep_id'),  # Use customer's rep, fallback to default
            'TermID': customer.get('TermID') or defaults.get('term_id'),  # Use customer's terms, fallback to default

            # Will be updated with calculated total
            'QuotationTotal': 0,

            # Additional default fields
            'Header': '',
            'Footer': '',
            'Notes': '',
            'Memo': '',
            'flaged': 0
        }

    def _build_quotation_line(self, product: Dict, customer: Dict) -> Dict:
        """Build quotation detail line from validated product"""

        # Get unit description
        unit_desc = None
        if product.get('UnitID'):
            unit_desc = self.backoffice.get_unit_description(product['UnitID'])

        # Calculate prices - handle None values explicitly
        quantity = product.get('shopify_quantity') or 1
        unit_price = product.get('shopify_price') or product.get('UnitPrice') or 0
        original_price = product.get('UnitPrice') or unit_price
        unit_cost = product.get('UnitCost') or 0

        extended_price = quantity * unit_price
        extended_cost = quantity * unit_cost

        # Calculate expiration date (today + 1 year)
        exp_date = datetime.now() + timedelta(days=365)

        # Truncate string fields
        def truncate(text, max_len):
            return str(text or '')[:max_len] if text else None

        return {
            'CateID': product.get('CateID'),
            'SubCateID': product.get('SubCateID'),
            'UnitDesc': truncate(unit_desc, 50),
            'UnitQty': 1,  # Default unit quantity

            # Product identification
            'ProductID': product.get('ProductID'),
            'ProductSKU': truncate(product.get('ProductSKU'), 20),
            'ProductUPC': truncate(product.get('ProductUPC'), 20),
            'ProductDescription': truncate(
                product.get('ProductDescription'),
                50
            ),
            'ItemSize': '',  # Default to empty string

            # Pricing
            'UnitPrice': unit_price,
            'OriginalPrice': original_price,
            'UnitCost': unit_cost,
            'Qty': quantity,

            # Calculated
            'ExtendedPrice': extended_price,
            'ExtendedCost': extended_cost,

            # Weight and tax
            'ItemWeight': truncate(product.get('ItemWeight'), 10),
            'Taxable': 0,  # Default to non-taxable
            'ItemTaxID': product.get('ItemTaxID'),

            # Additional fields
            'ExpDate': exp_date,
            'ReasonID': None,
            'LineMessage': '',
            'RememberPrice': 0,
            'Discount': 0,
            'ds_Percent': 0,
            'ExtendedDisc': 0,
            'PromotionID': None,
            'PromotionLine': 0,
            'PromotionDescription': '',
            'PromotionAmount': 0,
            'ActExtendedPrice': 0,
            'SPPromoted': 0,
            'SPPromotionDescription': '',
            'Catch': None,
            'Comments': '',
            'Flag': 0
        }

    def create_quotation_with_transaction(self, shopify_order: Dict, store_id: int,
                                        validated_products: List[Dict],
                                        customer_id_override: Optional[int] = None) -> Dict:
        """
        Convert order to quotation with full error handling and transaction support

        This is the main entry point for quotation creation

        Args:
            shopify_order: Parsed Shopify order
            store_id: Shopify store ID
            validated_products: List of validated products
            customer_id_override: Optional custom customer ID to use instead of default mapping

        Returns:
            Dict with success status and quotation details

        Raises:
            Exception: If quotation creation fails
        """
        try:
            result = self.convert_order(shopify_order, store_id, validated_products, customer_id_override)

            logger.info(
                f"Successfully created quotation {result['quotation_number']} "
                f"with {result['line_items_created']} line items"
            )

            return {
                'success': True,
                'quotation_id': result['quotation_id'],
                'quotation_number': result['quotation_number'],
                'line_items': result['line_items_created'],
                'total_amount': result['total_amount'],
                'error': None
            }

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Quotation creation failed: {error_msg}")

            return {
                'success': False,
                'quotation_id': None,
                'quotation_number': None,
                'line_items': 0,
                'total_amount': 0,
                'error': error_msg
            }
