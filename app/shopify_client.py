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
                            lineItems(first: 100) {{
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
                orders.append(self._parse_order(node))

            return {
                'orders': orders,
                'page_info': orders_data.get('pageInfo', {}),
                'total_fetched': len(orders)
            }

        except Exception as e:
            logger.error(f"Failed to fetch orders: {str(e)}")
            raise

    def _parse_order(self, order_node: Dict) -> Dict:
        """Parse Shopify order node into simplified structure"""
        # Extract customer info
        customer = order_node.get('customer', {})
        customer_name = f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip()

        # Extract shipping address
        ship_addr = order_node.get('shippingAddress', {})

        # Extract line items
        line_items = []
        for item_edge in order_node.get('lineItems', {}).get('edges', []):
            item_node = item_edge.get('node', {})
            variant = item_node.get('variant', {})

            line_items.append({
                'id': item_node.get('id', ''),
                'name': item_node.get('name', ''),
                'quantity': item_node.get('quantity', 1),
                'barcode': variant.get('barcode', ''),
                'sku': variant.get('sku', ''),
                'price': float(variant.get('price', 0)),
                'variant_title': variant.get('title', ''),
                'product_id': variant.get('product', {}).get('id', ''),
                'product_title': variant.get('product', {}).get('title', '')
            })

        # Extract total
        total_price_set = order_node.get('totalPriceSet', {}).get('shopMoney', {})
        total_amount = float(total_price_set.get('amount', 0))
        currency = total_price_set.get('currencyCode', 'USD')

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
                    lineItems(first: 100) {{
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

            return self._parse_order(order_node)

        except Exception as e:
            logger.error(f"Failed to fetch order {order_id}: {str(e)}")
            raise
