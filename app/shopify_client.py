"""
Shopify GraphQL API Client
Fetches orders from Shopify stores using Admin API
"""

import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import requests

logger = logging.getLogger(__name__)


class ShopifyClient:
    """Shopify Admin API GraphQL client"""

    def __init__(self, shop_url: str, api_token: str):
        """
        Initialize Shopify client

        Args:
            shop_url: Shopify store URL (e.g., 'mystore.myshopify.com')
            api_token: Admin API access token
        """
        self.shop_url = shop_url.replace('https://', '').replace('http://', '')
        if not self.shop_url.endswith('.myshopify.com'):
            if '.' not in self.shop_url:
                self.shop_url = f"{self.shop_url}.myshopify.com"

        self.api_token = api_token
        self.graphql_url = f"https://{self.shop_url}/admin/api/2024-01/graphql.json"
        self.headers = {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': self.api_token
        }

    def _execute_query(self, query: str, variables: Dict = None) -> Dict:
        """Execute GraphQL query"""
        try:
            payload = {'query': query}
            if variables:
                payload['variables'] = variables

            response = requests.post(
                self.graphql_url,
                json=payload,
                headers=self.headers,
                timeout=30
            )

            response.raise_for_status()
            result = response.json()

            if 'errors' in result:
                error_messages = [err.get('message', 'Unknown error') for err in result['errors']]
                raise Exception(f"GraphQL errors: {', '.join(error_messages)}")

            return result.get('data', {})

        except requests.exceptions.RequestException as e:
            logger.error(f"Shopify API request failed: {str(e)}")
            raise Exception(f"Failed to connect to Shopify: {str(e)}")
        except Exception as e:
            logger.error(f"Shopify GraphQL error: {str(e)}")
            raise

    def _fetch_all_line_items(self, order_gid: str) -> List[Dict]:
        """Fetch all line items for an order using cursor pagination"""
        all_items = []
        cursor = None
        has_next = True

        while has_next:
            after_clause = f', after: "{cursor}"' if cursor else ''
            query = f"""
            {{
                order(id: "{order_gid}") {{
                    lineItems(first: 250{after_clause}) {{
                        pageInfo {{
                            hasNextPage
                            endCursor
                        }}
                        edges {{
                            node {{
                                id
                                name
                                quantity
                                variant {{
                                    id
                                    barcode
                                    sku
                                    price
                                    title
                                    product {{
                                        id
                                        title
                                    }}
                                }}
                            }}
                        }}
                    }}
                }}
            }}
            """
            data = self._execute_query(query)
            line_items_data = data.get('order', {}).get('lineItems', {})

            for edge in line_items_data.get('edges', []):
                all_items.append(edge.get('node', {}))

            page_info = line_items_data.get('pageInfo', {})
            has_next = page_info.get('hasNextPage', False)
            cursor = page_info.get('endCursor')

        return all_items

    def test_connection(self) -> tuple[bool, str]:
        """Test Shopify API connection"""
        try:
            query = """
            {
                shop {
                    name
                    email
                    currencyCode
                }
            }
            """
            data = self._execute_query(query)
            shop = data.get('shop', {})

            if shop:
                return True, f"Connected to {shop.get('name', 'Unknown')} ({shop.get('email', 'No email')})"
            else:
                return False, "No shop data returned"

        except Exception as e:
            return False, str(e)

    def get_unfulfilled_orders(self, days_back: int = 14, cursor: str = None,
                              limit: int = 50) -> Dict:
        """
        Fetch unfulfilled orders from last N days

        Args:
            days_back: Number of days to look back (default: 14)
            cursor: Pagination cursor for next page
            limit: Number of orders per page (max 250)

        Returns:
            Dict with orders list and pagination info
        """
        try:
            # Calculate date range
            end_date = datetime.utcnow()
            start_date = end_date - timedelta(days=days_back)
            date_filter = start_date.strftime('%Y-%m-%dT%H:%M:%SZ')

            # Build query
            after_clause = f', after: "{cursor}"' if cursor else ''

            query = f"""
            {{
                orders(
                    first: {limit},
                    query: "created_at:>'{date_filter}' AND fulfillment_status:unfulfilled"
                    {after_clause}
                ) {{
                    pageInfo {{
                        hasNextPage
                        hasPreviousPage
                        endCursor
                    }}
                    edges {{
                        node {{
                            id
                            name
                            createdAt
                            displayFulfillmentStatus
                            note
                            totalPriceSet {{
                                shopMoney {{
                                    amount
                                    currencyCode
                                }}
                            }}
                            customer {{
                                id
                                firstName
                                lastName
                                email
                            }}
                            shippingAddress {{
                                firstName
                                lastName
                                company
                                address1
                                address2
                                city
                                province
                                provinceCode
                                zip
                                country
                                countryCodeV2
                                phone
                            }}
                            lineItems(first: 250) {{
                                pageInfo {{
                                    hasNextPage
                                    endCursor
                                }}
                                edges {{
                                    node {{
                                        id
                                        name
                                        quantity
                                        variant {{
                                            id
                                            barcode
                                            sku
                                            price
                                            title
                                            product {{
                                                id
                                                title
                                            }}
                                        }}
                                    }}
                                }}
                            }}
                        }}
                    }}
                }}
            }}
            """

            data = self._execute_query(query)
            orders_data = data.get('orders', {})

            # Parse orders
            orders = []
            for edge in orders_data.get('edges', []):
                node = edge.get('node', {})
                order_gid = node.get('id', '')

                # Check if order has more line items to fetch
                line_items_data = node.get('lineItems') or {}
                line_items_page_info = line_items_data.get('pageInfo', {})

                if line_items_page_info.get('hasNextPage', False):
                    # Fetch all line items with pagination
                    all_line_items = self._fetch_all_line_items(order_gid)
                    orders.append(self._parse_order(node, all_line_items))
                else:
                    orders.append(self._parse_order(node))

            return {
                'orders': orders,
                'page_info': orders_data.get('pageInfo', {}),
                'total_fetched': len(orders)
            }

        except Exception as e:
            logger.error(f"Failed to fetch orders: {str(e)}")
            raise

    def _parse_order(self, order_node: Dict, all_line_items: List[Dict] = None) -> Dict:
        """Parse Shopify order node into simplified structure

        Args:
            order_node: Raw order data from GraphQL
            all_line_items: Optional pre-fetched line items (for pagination)
        """
        # Extract customer info (handle null values from Shopify API)
        customer = order_node.get('customer') or {}
        customer_name = f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip()

        # Extract shipping address (handle null values from Shopify API)
        ship_addr = order_node.get('shippingAddress') or {}

        # Extract line items - use pre-fetched if provided, otherwise from order_node
        line_items = []
        if all_line_items is not None:
            # Use pre-fetched line items (from pagination)
            for item_node in all_line_items:
                variant = item_node.get('variant') or {}
                product = variant.get('product') or {}

                line_items.append({
                    'id': item_node.get('id', ''),
                    'name': item_node.get('name', ''),
                    'quantity': item_node.get('quantity', 1),
                    'barcode': variant.get('barcode', ''),
                    'sku': variant.get('sku', ''),
                    'price': float(variant.get('price') or 0),
                    'variant_title': variant.get('title', ''),
                    'product_id': product.get('id', ''),
                    'product_title': product.get('title', '')
                })
        else:
            # Extract from order_node
            line_items_data = order_node.get('lineItems') or {}
            for item_edge in line_items_data.get('edges') or []:
                item_node = item_edge.get('node') or {}
                variant = item_node.get('variant') or {}
                product = variant.get('product') or {}

                line_items.append({
                    'id': item_node.get('id', ''),
                    'name': item_node.get('name', ''),
                    'quantity': item_node.get('quantity', 1),
                    'barcode': variant.get('barcode', ''),
                    'sku': variant.get('sku', ''),
                    'price': float(variant.get('price') or 0),
                    'variant_title': variant.get('title', ''),
                    'product_id': product.get('id', ''),
                    'product_title': product.get('title', '')
                })

        # Extract total (handle null values from Shopify API)
        total_price_data = order_node.get('totalPriceSet') or {}
        total_price_set = total_price_data.get('shopMoney') or {}
        total_amount = float(total_price_set.get('amount') or 0)
        currency = total_price_set.get('currencyCode') or 'USD'

        return {
            'id': order_node.get('id', '').split('/')[-1],  # Extract numeric ID
            'gid': order_node.get('id', ''),  # Full GraphQL ID
            'name': order_node.get('name', ''),
            'created_at': order_node.get('createdAt', ''),
            'fulfillment_status': order_node.get('displayFulfillmentStatus', ''),
            'note': order_node.get('note'),  # Staff note - can be None
            'total_amount': total_amount,
            'currency': currency,
            'customer': {
                'id': customer.get('id', '').split('/')[-1] if customer.get('id') else None,
                'name': customer_name,
                'email': customer.get('email', ''),
                'first_name': customer.get('firstName', ''),
                'last_name': customer.get('lastName', '')
            },
            'shipping_address': {
                'first_name': ship_addr.get('firstName', ''),
                'last_name': ship_addr.get('lastName', ''),
                'company': ship_addr.get('company', ''),
                'address1': ship_addr.get('address1', ''),
                'address2': ship_addr.get('address2', ''),
                'city': ship_addr.get('city', ''),
                'province': ship_addr.get('province', ''),
                'province_code': ship_addr.get('provinceCode', ''),
                'zip': ship_addr.get('zip', ''),
                'country': ship_addr.get('country', ''),
                'country_code': ship_addr.get('countryCodeV2', ''),
                'phone': ship_addr.get('phone', '')
            },
            'line_items': line_items,
            'line_items_count': len(line_items)
        }

    def get_order_by_id(self, order_id: str) -> Optional[Dict]:
        """
        Get single order by ID

        Args:
            order_id: Shopify order ID (numeric or GID format)

        Returns:
            Parsed order dict or None if not found
        """
        try:
            # Convert to GID format if needed
            if not order_id.startswith('gid://'):
                order_gid = f"gid://shopify/Order/{order_id}"
            else:
                order_gid = order_id

            query = f"""
            {{
                order(id: "{order_gid}") {{
                    id
                    name
                    createdAt
                    displayFulfillmentStatus
                    note
                    totalPriceSet {{
                        shopMoney {{
                            amount
                            currencyCode
                        }}
                    }}
                    customer {{
                        id
                        firstName
                        lastName
                        email
                    }}
                    shippingAddress {{
                        firstName
                        lastName
                        company
                        address1
                        address2
                        city
                        province
                        provinceCode
                        zip
                        country
                        countryCodeV2
                        phone
                    }}
                    lineItems(first: 250) {{
                        pageInfo {{
                            hasNextPage
                            endCursor
                        }}
                        edges {{
                            node {{
                                id
                                name
                                quantity
                                variant {{
                                    id
                                    barcode
                                    sku
                                    price
                                    title
                                    product {{
                                        id
                                        title
                                    }}
                                }}
                            }}
                        }}
                    }}
                }}
            }}
            """

            data = self._execute_query(query)
            order_node = data.get('order')

            if not order_node:
                return None

            # Check if order has more line items to fetch
            line_items_data = order_node.get('lineItems') or {}
            line_items_page_info = line_items_data.get('pageInfo', {})

            if line_items_page_info.get('hasNextPage', False):
                # Fetch all line items with pagination
                all_line_items = self._fetch_all_line_items(order_gid)
                return self._parse_order(order_node, all_line_items)

            return self._parse_order(order_node)

        except Exception as e:
            logger.error(f"Failed to fetch order {order_id}: {str(e)}")
            raise
