"""
Product Validator
Validates Shopify order products against BackOffice and Inventory databases
Handles 2-database lookup and product copying
"""

import logging
from typing import Dict, List
from app.database import SQLServerManager

logger = logging.getLogger(__name__)


class ProductValidator:
    """Validates products and copies from Inventory to BackOffice if needed"""

    def __init__(self, backoffice_manager: SQLServerManager,
                 inventory_manager: SQLServerManager):
        """
        Initialize validator with database managers

        Args:
            backoffice_manager: BackOffice SQL Server manager
            inventory_manager: Inventory SQL Server manager
        """
        self.backoffice = backoffice_manager
        self.inventory = inventory_manager

    def validate_order_products(self, line_items: List[Dict]) -> Dict:
        """
        Validate all products in order using batch queries

        Process:
        1. Extract all barcodes from line items
        2. Batch query BackOffice for all barcodes (1 query)
        3. Batch query Inventory for missing barcodes (1 query)
        4. Copy missing products from Inventory to BackOffice
        5. Match products back to line items

        Args:
            line_items: List of Shopify line items with barcode, quantity, etc.

        Returns:
            Dict with validation results:
            {
                'valid': bool,
                'products': List[Dict],  # Validated products with database IDs
                'missing': List[Dict],   # Products not found in any database
                'copied': List[Dict],    # Products copied from Inventory
                'errors': List[str]
            }
        """
        result = {
            'valid': True,
            'products': [],
            'missing': [],
            'copied': [],
            'errors': []
        }

        # Build mapping of barcode -> line item(s)
        barcode_to_items = {}
        items_without_barcode = []

        for item in line_items:
            barcode = item.get('barcode', '').strip()

            if not barcode:
                items_without_barcode.append(item)
                continue

            if barcode not in barcode_to_items:
                barcode_to_items[barcode] = []
            barcode_to_items[barcode].append(item)

        # Handle items without barcodes
        for item in items_without_barcode:
            result['valid'] = False
            result['missing'].append({
                'barcode': 'NONE',
                'name': item.get('name', 'Unknown'),
                'sku': item.get('sku', ''),
                'quantity': item.get('quantity', 0),
                'reason': 'No barcode provided by Shopify'
            })
            result['errors'].append(
                f"Product '{item.get('name')}' has no barcode"
            )

        if not barcode_to_items:
            return result

        all_barcodes = list(barcode_to_items.keys())

        try:
            # BATCH QUERY #1: Check all barcodes in BackOffice (1 query instead of N)
            logger.info(f"Batch querying BackOffice for {len(all_barcodes)} products...")
            backoffice_products = self.backoffice.get_products_by_upc_batch(all_barcodes)
            logger.info(f"Found {len(backoffice_products)} products in BackOffice")

            # Identify missing barcodes
            missing_barcodes = [b for b in all_barcodes if b not in backoffice_products]

            # BATCH QUERY #2: Check missing barcodes in Inventory (1 query instead of N)
            inventory_products = {}
            if missing_barcodes:
                logger.info(f"Batch querying Inventory for {len(missing_barcodes)} missing products...")
                inventory_products = self.inventory.get_products_by_upc_batch(missing_barcodes)
                logger.info(f"Found {len(inventory_products)} products in Inventory")

            # Copy products from Inventory to BackOffice
            for barcode, inventory_product in inventory_products.items():
                try:
                    logger.info(f"Copying product {barcode} from Inventory to BackOffice...")
                    copied_product = self.backoffice.copy_product_from_inventory(inventory_product)

                    # Add to backoffice_products dict (no re-fetch needed!)
                    backoffice_products[barcode] = copied_product

                    result['copied'].append({
                        'barcode': barcode,
                        'name': inventory_product.get('ProductDescription', ''),
                        'product_id': copied_product.get('ProductID')
                    })
                    logger.info(f"Successfully copied product {barcode}")

                except Exception as copy_error:
                    logger.error(f"Failed to copy product {barcode}: {str(copy_error)}")
                    result['valid'] = False
                    result['errors'].append(
                        f"Failed to copy product {barcode} from Inventory: {str(copy_error)}"
                    )
                    # Will be marked as missing below

            # Match products back to line items
            for barcode, items in barcode_to_items.items():
                product = backoffice_products.get(barcode)

                if product:
                    # Product found (either in BackOffice or copied from Inventory)
                    for item in items:
                        result['products'].append({
                            **product,
                            'shopify_quantity': item.get('quantity', 1),
                            'shopify_price': item.get('price', 0)
                        })
                else:
                    # Product not found in either database
                    result['valid'] = False
                    for item in items:
                        result['missing'].append({
                            'barcode': barcode,
                            'name': item.get('name', 'Unknown'),
                            'sku': item.get('sku', ''),
                            'quantity': item.get('quantity', 0),
                            'reason': 'Not found in Inventory database'
                        })
                        result['errors'].append(
                            f"Product '{item.get('name')}' (barcode: {barcode}) not found in any database"
                        )

        except Exception as e:
            logger.error(f"Error during batch validation: {str(e)}")
            result['valid'] = False
            result['errors'].append(f"Batch validation error: {str(e)}")

        # Summary logging
        logger.info(f"Validation complete: {len(result['products'])} valid, "
                   f"{len(result['missing'])} missing, {len(result['copied'])} copied")

        return result

    def validate_single_product(self, barcode: str) -> Dict:
        """
        Validate single product by barcode

        Args:
            barcode: Product barcode/UPC

        Returns:
            Dict with validation result for single product
        """
        result = {
            'found': False,
            'location': None,  # 'backoffice', 'inventory', or None
            'product': None,
            'needs_copy': False,
            'error': None
        }

        if not barcode:
            result['error'] = 'No barcode provided'
            return result

        try:
            # Check BackOffice first
            product = self.backoffice.get_product_by_upc(barcode)

            if product:
                result['found'] = True
                result['location'] = 'backoffice'
                result['product'] = product
                return result

            # Check Inventory
            inventory_product = self.inventory.get_product_by_upc(barcode)

            if inventory_product:
                result['found'] = True
                result['location'] = 'inventory'
                result['product'] = inventory_product
                result['needs_copy'] = True
                return result

            # Not found anywhere
            result['error'] = 'Product not found in any database'
            return result

        except Exception as e:
            logger.error(f"Error validating product {barcode}: {str(e)}")
            result['error'] = str(e)
            return result
