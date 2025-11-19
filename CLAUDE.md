# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shopify to BackOffice Quotation Transfer system - a Flask web application that converts Shopify orders into MS SQL Server quotations with intelligent product validation and dual-database lookup.

**Key Architecture Pattern:**
- Frontend: Vanilla JavaScript (no framework) with Material Design 3
- Backend: Flask REST API
- Databases: SQLite (app data) + dual MS SQL Server (BackOffice + Inventory)
- Deployment: Docker + Docker Compose

## Development Commands

### Docker Operations

```bash
# Start development server (auto-detects port 5000-5100)
docker-compose up -d --build

# View logs
docker-compose logs -f app

# Restart after code changes
docker-compose restart app

# Stop all containers
docker-compose down

# Force rebuild
docker-compose down && docker-compose up -d --build
```

### Database Access

```bash
# Access SQLite database
docker-compose exec app bash
sqlite3 /app/data/app.db

# Check SQLite schema
sqlite3 /app/data/app.db ".schema"

# Query transfer history
sqlite3 /app/data/app.db "SELECT * FROM transfer_history ORDER BY transferred_at DESC LIMIT 10;"
```

### Production Deployment

```bash
# Install on Ubuntu 24 LTS
curl -fsSL https://raw.githubusercontent.com/ruolez/shopify-quotation/main/install.sh | sudo bash

# Update production deployment
sudo /opt/shopify-quotation/install.sh  # Select option 2
```

## Architecture Patterns

### 2-Database Product Validation Flow

The application uses a dual-database lookup pattern for product validation:

1. **Check BackOffice** first: Query `Items_tbl` by barcode
2. **Check Inventory** if not found: Query Inventory `Items_tbl`
3. **Auto-copy** if found in Inventory: Copy product to BackOffice
4. **Report missing** if not in either database: Block transfer

**Critical:** All validation uses **batch queries** for performance:
- `get_products_by_upc_batch()` - Single query with `IN (barcode1, barcode2, ...)`
- Never query products individually in loops (causes 10-50x slowdown)

**Code locations:**
- `app/validator.py`: `ProductValidator.validate_order_products()` (batch logic)
- `app/database.py`: `SQLServerManager.get_products_by_upc_batch()` (SQL query)

### Quotation Number Generation

Format: `62[YYYY][SEQUENCE]` (e.g., `6202025490`)

**CRITICAL:** Uses `BIGINT` not `INT` to handle large numbers:
```python
# app/database.py SQLServerManager.get_next_quotation_number()
query = """
    SELECT CAST(ISNULL(MAX(CAST(QuotationNumber AS BIGINT)), 620250000) + 1 AS BIGINT)
    FROM Quotations_tbl
    WHERE QuotationNumber LIKE '62025%'
"""
```

### Field Population Strategy

**Quotations_tbl (Header):** 23 fields populated
- Customer data: JOINed from `Customers_tbl`
- Dates: `CurrentDate` (today), `ExpirationDate` (today + expiration_days)
- Calculated: `QuotationTotal` (sum of line items)
- Defaults: From `quotation_defaults` table per store
- **String truncation:** Use `truncate_string(value, max_length)` for VARCHAR fields

**QuotationsDetails_tbl (Line Items):** 21 fields populated
- Product data: Matched from `Items_tbl` by barcode
- `UnitDesc`: JOINed from `Units_tbl` (NOT from product name)
- Quantities/prices: From Shopify line items
- Line totals: `ExtendedPrice = Qty * UnitPrice`

**Code locations:**
- `app/converter.py`: `QuotationConverter.convert_order()`
- `app/converter.py`: `_build_quotation_header()`, `_build_line_items()`

### Database Connection Patterns

**PostgreSQL (App Data):**
- Uses connection pooling: `SimpleConnectionPool(minconn=2, maxconn=10)`
- Context manager pattern: `with postgres.get_connection() as conn:`
- Auto-commit on success, auto-rollback on error

**MS SQL Server (BackOffice/Inventory):**
- No pooling - creates connections on-demand
- Uses pymssql + FreeTDS driver
- Context manager pattern: `with manager.get_connection() as conn:`

**Password Encryption:**
- All SQL Server passwords encrypted with Fernet symmetric encryption
- Encryption key from environment: `ENCRYPTION_KEY`
- Never return passwords in GET API responses

### Frontend State Management

**No framework** - vanilla JavaScript with modern patterns:

```javascript
// Each page has a state object
const state = {
    stores: [],
    selectedStore: null,
    orders: [],
    selectedOrders: new Set(),
    validatedOrders: new Map(),
    showTransferred: false
};

// Event delegation for dynamic content
tbody.addEventListener('click', (e) => {
    if (e.target.matches('.validate-btn')) { ... }
});
```

**No caching:** All responses use `Cache-Control: no-store, no-cache, must-revalidate`

**Code locations:**
- `app/static/js/orders.js`: Orders page state and logic
- `app/static/js/history.js`: History page state and logic
- `app/static/js/settings.js`: Settings page state and logic
- `app/static/js/theme.js`: Dark/light theme manager

## File Organization

### Backend (Python)

```
app/
├── main.py           # Flask app + 22 API endpoints
├── database.py       # PostgreSQL + MS SQL managers
├── shopify_client.py # Shopify GraphQL client
├── validator.py      # Product validation (2-database lookup)
├── converter.py      # Order to quotation converter
└── schema.sql        # PostgreSQL schema
```

### Frontend (JavaScript)

```
app/static/js/
├── orders.js    # Orders page (fetch, validate, transfer)
├── history.js   # History page (filters, search, delete)
├── settings.js  # Settings page (stores, SQL, mappings, defaults)
└── theme.js     # Dark/light theme toggle
```

### Templates (HTML)

```
app/templates/
├── orders.html   # Main landing page - order management
├── history.html  # Transfer history with filters
└── settings.html # Configuration page
```

## Database Schema Reference

### SQLite Tables (app.db)

**shopify_stores** - Shopify API credentials (encrypted tokens)
**sql_connections** - BackOffice/Inventory connection details
**customer_mappings** - Maps store_id to BackOffice CustomerID
**quotation_defaults** - Default values per store (Status, ShipperID, SalesRepID, TermID, title_prefix, expiration_days)
**transfer_history** - All conversion attempts with success/failure tracking

### MS SQL Server Tables (BackOffice)

**Quotations_tbl** - Quotation headers (23 fields used)
**QuotationsDetails_tbl** - Line items (21 fields used)
**Items_tbl** - Product master (matched by ProductUPC)
**Customers_tbl** - Customer data (joined for quotation header)
**Units_tbl** - Unit descriptions (joined for UnitDesc)

### MS SQL Server Tables (Inventory)

**Items_tbl** - Product verification and copy source

See `dbschema.MD` for complete field definitions.

## Critical Implementation Notes

### String Truncation for VARCHAR Fields

BackOffice has strict VARCHAR length limits. Always truncate:

```python
def truncate_string(value: str, max_length: int) -> str:
    """Truncate string to max length, handling None"""
    if not value:
        return ""
    return str(value)[:max_length]

# Example usage
quotation_header['BusinessName'] = truncate_string(customer['BusinessName'], 50)
```

### UnitDesc Must Come from Units_tbl

**WRONG:**
```python
line_item['UnitDesc'] = product_name  # From Shopify or product description
```

**CORRECT:**
```python
# Join with Units_tbl to get proper UnitDesc
query = """
    SELECT i.*, u.UnitDesc
    FROM Items_tbl i
    LEFT JOIN Units_tbl u ON i.UnitID = u.UnitID
    WHERE i.ProductUPC IN (...)
"""
```

### Central Time Timestamps

All timestamps use `America/Chicago` timezone:

```python
from zoneinfo import ZoneInfo

CENTRAL_TZ = ZoneInfo("America/Chicago")
now = datetime.now(CENTRAL_TZ)
```

Format: `YYYY-MM-DD HH:MM:SS-05:00` (CDT) or `-06:00` (CST)

### Show/Hide Transferred Orders

Orders page hides already-transferred orders by default:

```javascript
// Filter in renderOrders()
const filteredOrders = state.showTransferred
    ? state.orders
    : state.orders.filter(order => !order.transferred);
```

Checkbox: `<input type="checkbox" id="showTransferred">`

## API Endpoint Patterns

### Response Format

```json
{
  "success": true,
  "data": { ... }  // or "stores", "orders", etc.
}

// On error
{
  "success": false,
  "error": "Error message"
}
```

### Store Selection Pattern

Most API endpoints accept `store_id` parameter:
- `/api/orders?store_id=1&days_back=14`
- `/api/history?store_id=1&status=success`
- `/api/customer-mappings/<store_id>`

### Validation Endpoint

```
POST /api/orders/validate
{
  "order_id": "gid://shopify/Order/123",
  "line_items": [...]
}

Response:
{
  "success": true,
  "validation": {
    "valid": bool,
    "products": [...],   // Valid products with DB IDs
    "missing": [...],    // Not found in any DB
    "copied": [...],     // Copied from Inventory
    "errors": [...]
  }
}
```

### Transfer Endpoint

```
POST /api/orders/transfer
{
  "store_id": 1,
  "order_ids": ["gid://shopify/Order/123", ...]
}

Response:
{
  "success": true,
  "results": [
    {
      "order_id": "...",
      "success": true,
      "quotation_number": "6202025490"
    },
    ...
  ]
}
```

## Common Development Tasks

### Adding a New API Endpoint

1. Add route decorator in `app/main.py`
2. Implement handler function with try/except
3. Return standardized JSON response
4. Add frontend fetch call in appropriate `.js` file
5. Update UI based on response

### Adding a New Database Query

1. Add method to appropriate manager class in `app/database.py`
2. Use context manager: `with self.get_connection() as conn:`
3. Use parameterized queries to prevent SQL injection
4. Return `List[Dict]` for SELECT queries
5. For batch queries, use `IN (?)` with comma-separated values

### Modifying Quotation Field Mapping

1. Update `_build_quotation_header()` or `_build_line_items()` in `app/converter.py`
2. Check `dbschema.MD` for field name and type
3. Add truncation if VARCHAR field: `truncate_string(value, max_length)`
4. Test with actual Shopify order to verify data types match

### UI Changes (No Build Step Required)

1. Edit HTML in `app/templates/*.html`
2. Edit CSS in `app/static/css/style.css`
3. Edit JS in `app/static/js/*.js`
4. Restart container: `docker-compose restart app`
5. Hard refresh browser: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)

## Environment Variables

**Development (docker-compose.yml):**
- `FLASK_ENV=development`
- `POSTGRES_HOST=postgres`
- `ENCRYPTION_KEY=p3C56Fb0GL65El4Uw8ZAGcNNjFi0Y9kfG-876Jh82vs=`

**Production (install.sh sets these):**
- Port 80 instead of 5000-5100
- Data directory: `/opt/shopify-quotation/data/`
- Backup directory: `/opt/shopify-quotation-backups/`

## Troubleshooting Patterns

### "Product not found" errors
→ Check if barcode exists in Inventory `Items_tbl` first
→ Add product to Inventory, then validation will auto-copy to BackOffice

### "QuotationNumber overflow" errors
→ Verify query uses `BIGINT` not `INT`
→ Check `app/database.py:get_next_quotation_number()`

### "Transfer history not recording"
→ Check SQLite database exists: `ls -la ./data/app.db`
→ Verify schema: `sqlite3 ./data/app.db ".schema transfer_history"`

### Frontend changes not appearing
→ Hard refresh browser (bypass cache)
→ Check `Cache-Control` headers in responses
→ Verify container restarted: `docker-compose restart app`

### SQL Server connection failures
→ Test connectivity: `docker-compose exec app bash` then `ping <sql-server-host>`
→ Verify port 1433 open and SQL Server accepts remote connections
→ Check credentials in Settings page → Test Connection

## Production vs Development

**Development:**
- Port auto-detection (5000-5100)
- Live code reload with volume mount
- Debug mode enabled
- Access: `http://localhost:PORT`

**Production (Ubuntu 24 LTS):**
- Port 80 (HTTP)
- Application in `/opt/shopify-quotation`
- Automatic backups during updates
- Managed via `install.sh` script
- Access: `http://SERVER_IP`

See `PRODUCTION.md` for complete deployment guide.

## Material Design 3 Color Scheme

```css
--primary: #1a73e8;           /* Google Blue */
--primary-hover: #1557b0;
--error: #d93025;             /* Google Red */
--success: #1e8e3e;           /* Google Green */
--warning: #f9ab00;           /* Yellow */
--surface: #ffffff;
--background: #f8f9fa;
```

Dark theme variants in `app/static/js/theme.js`.
