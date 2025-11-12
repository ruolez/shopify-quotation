# Shopify to BackOffice Quotation Transfer

Modern web application for transferring Shopify orders to MS SQL Server quotations with intelligent product validation and dual-database lookup.

## Production Deployment

**Quick Install on Ubuntu 24 LTS:**

```bash
curl -fsSL https://raw.githubusercontent.com/ruolez/shopify-quotation/main/install.sh | sudo bash
```

The installer provides:
- ✅ **Install** - Fresh installation with auto Docker setup
- 🔄 **Update** - Pull latest changes from GitHub with data backup
- 🗑️ **Remove** - Clean uninstall with data preservation

Runs on **port 80** for production use. See [PRODUCTION.md](PRODUCTION.md) for complete deployment guide.

## Overview

This application automates the process of converting Shopify orders into BackOffice quotations by:
- Fetching unfulfilled orders from multiple Shopify stores
- Validating products against BackOffice and Inventory databases
- Automatically copying missing products from Inventory to BackOffice
- Creating quotations with proper customer mapping and defaults
- Tracking transfer history with success/failure logging

## Technology Stack

- **Backend:** Python 3.11 + Flask
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Databases:**
  - SQLite: Application settings and transfer history (embedded)
  - MS SQL Server (BackOffice): Quotation system and product master
  - MS SQL Server (Inventory): Product verification database
- **Deployment:** Docker + Docker Compose
- **UI Design:** Material Design 3 with dark/light theme support
- **Port:**
  - Production: Port 80 (via install.sh)
  - Development: Auto-detects available port 5000-5100

## Features

### Order Management
- View unfulfilled orders from the last 14 days
- Multi-select orders for batch transfer
- Real-time product validation before transfer
- Automatic quotation number generation
- Transfer status tracking

### Product Validation (2-Database Lookup)
1. Check BackOffice Items_tbl by barcode
2. If not found, check Inventory Items_tbl
3. If found in Inventory, automatically copy to BackOffice
4. If not found in either, warn user and block transfer

### Settings Configuration
- **Shopify Stores:** Manage multiple store connections with API tokens
- **SQL Connections:** Configure BackOffice and Inventory databases
- **Customer Mappings:** Map each Shopify store to a BackOffice customer
- **Quotation Defaults:** Set default values per store (Status, ShipperID, SalesRepID, TermID, title prefix, expiration days)

### Transfer History
- Filter by store, status, and date range
- View error details for failed transfers
- Bulk deletion support
- Statistics dashboard (total, successful, failed)
- Search functionality

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- Network access to:
  - Shopify stores (HTTPS)
  - MS SQL Server (BackOffice database)
  - MS SQL Server (Inventory database)

## Quick Start

### Production Installation (Ubuntu 24 LTS)

Use the automated installer for production deployments:

```bash
# One-line install
curl -fsSL https://raw.githubusercontent.com/ruolez/shopify-quotation/main/install.sh | sudo bash

# Or download and run manually
wget https://raw.githubusercontent.com/ruolez/shopify-quotation/main/install.sh
chmod +x install.sh
sudo ./install.sh
```

See [PRODUCTION.md](PRODUCTION.md) for complete production deployment guide.

### Local Development

### 1. Clone and Build

```bash
cd /path/to/shopify\ quotation
docker-compose up -d --build
```

The application will:
- Start Flask app on first available port (5000-5100)
- Initialize SQLite database with schema
- Create data directory for persistent storage

### 2. Access the Application

```bash
# Check which port was assigned
docker-compose logs app | grep "Running on"

# Access at http://localhost:PORT
```

Default: http://localhost:5000

### 3. Initial Configuration

Navigate to **Settings** page and configure in order:

#### A. SQL Server Connections

**BackOffice Database:**
- Host: Your BackOffice SQL Server IP/hostname
- Port: 1433 (default)
- Database: BackOffice database name
- Username: SQL Server username
- Password: SQL Server password

Click **Test Connection** to verify before saving.

**Inventory Database:**
- Host: Your Inventory SQL Server IP/hostname
- Port: 1433 (default)
- Database: Inventory database name
- Username: SQL Server username
- Password: SQL Server password

Click **Test Connection** to verify before saving.

#### B. Shopify Stores

Click **Add Store** and provide:
- **Store Name:** Friendly name (e.g., "Main Store")
- **Shop URL:** Your shop domain (e.g., `mystore.myshopify.com`)
- **Admin API Access Token:**
  1. Go to Shopify Admin → Settings → Apps and sales channels
  2. Click "Develop apps"
  3. Create custom app with scopes: `read_orders`, `read_products`, `read_customers`
  4. Install app and copy Admin API access token (starts with `shpat_`)

Click **Test Connection** to verify before saving.

#### C. Customer Mappings

For each Shopify store:
1. Select store from dropdown
2. Choose corresponding BackOffice customer
3. Click **Save Mapping**

This determines which CustomerID will be used in quotations.

#### D. Quotation Defaults

For each Shopify store, configure:
- **Status:** Default quotation status (e.g., "Pending")
- **Shipper ID:** Default shipping method ID
- **Sales Rep ID:** Default sales representative ID
- **Term ID:** Default payment terms ID
- **Title Prefix:** Text prepended to quotation title (e.g., "Shopify Order")
- **Expiration Days:** Days until quotation expires (default: 365)

## Usage Guide

### Transferring Orders

1. **Select Store:** Choose Shopify store from dropdown on Orders page
2. **View Orders:** Unfulfilled orders from last 14 days will load
3. **Validate Products (Optional):** Click **Validate** button on individual orders to check product availability
   - ✓ Green badge: Product found in BackOffice
   - 📋 Yellow badge: Product copied from Inventory to BackOffice
   - ⚠️ Red badge: Product not found in either database (transfer blocked)
4. **Select Orders:** Check boxes next to orders to transfer
5. **Transfer:** Click **Transfer Selected** button
6. **Review Results:** Toast notifications show success/failure for each order

### Validation Results

**Valid Products:**
- Found in BackOffice Items_tbl
- Ready for transfer

**Copied Products:**
- Not found in BackOffice
- Found in Inventory Items_tbl
- Automatically copied to BackOffice
- Now ready for transfer

**Missing Products:**
- Not found in either database
- Transfer blocked until product added to Inventory
- Shows product name, barcode, and quantity needed

### Viewing History

Navigate to **History** page to:
- View all transfer attempts
- Filter by store, status, or date range
- Search by order name or quotation number
- Delete individual records
- Bulk delete selected records
- Delete all failed records

Click **View Error** on failed transfers to see detailed error messages.

## Database Schema

### SQLite Tables (app.db)

**shopify_stores:**
- Stores Shopify API credentials (encrypted)
- Fields: id, name, shop_url, api_token, is_active

**sql_connections:**
- BackOffice and Inventory connection details
- Fields: id, connection_type, host, port, database, username, encrypted_password

**customer_mappings:**
- Maps Shopify store to BackOffice CustomerID
- Fields: id, store_id, customer_id

**quotation_defaults:**
- Default values for quotation creation
- Fields: store_id, status, shipper_id, sales_rep_id, term_id, title_prefix, expiration_days

**transfer_history:**
- Tracks all transfer attempts
- Fields: id, store_id, shopify_order_id, shopify_order_name, quotation_number, status, error_message, line_items_count, total_amount, transferred_at

**Database Location:**
- Development: `./data/app.db`
- Production: `/opt/shopify-quotation/data/app.db`

### MS SQL Server Tables Used

**BackOffice Database:**
- `Quotations_tbl` - Quotation headers
- `QuotationsDetails_tbl` - Quotation line items
- `Items_tbl` - Product master data
- `Customers_tbl` - Customer data

**Inventory Database:**
- `Items_tbl` - Product verification and copying source

## API Endpoints

### Pages
- `GET /` - Orders page
- `GET /history` - History page
- `GET /settings` - Settings page

### Shopify Stores
- `GET /api/stores` - List all stores
- `POST /api/stores` - Create store
- `PUT /api/stores/<id>` - Update store
- `DELETE /api/stores/<id>` - Delete store
- `POST /api/stores/<id>/test` - Test connection

### SQL Connections
- `GET /api/sql-connections` - Get connections (without passwords)
- `POST /api/sql-connections` - Save connection
- `POST /api/sql-connections/test` - Test connection

### Customer Mappings
- `GET /api/customer-mappings/<store_id>` - Get mapping
- `POST /api/customer-mappings` - Save mapping
- `GET /api/customers` - List BackOffice customers

### Quotation Defaults
- `GET /api/quotation-defaults/<store_id>` - Get defaults
- `POST /api/quotation-defaults` - Save defaults

### Orders
- `GET /api/orders?store_id=<id>&days_back=<days>` - Fetch orders
- `POST /api/orders/validate` - Validate products
- `POST /api/orders/transfer` - Transfer orders

### History
- `GET /api/history?store_id=<id>&status=<status>&start_date=<date>&end_date=<date>` - Get history
- `DELETE /api/history/<id>` - Delete record
- `POST /api/history/delete-failed` - Delete all failed records

### Health
- `GET /health` - Health check

## Troubleshooting

### Port Already in Use

The application auto-detects ports 5000-5100. If all are taken:

```bash
# Edit docker-compose.yml
ports:
  - "6000:5000"  # Change to different port range
```

### SQL Server Connection Fails

**Check network connectivity:**
```bash
docker-compose exec app bash
ping <sql-server-host>
```

**Verify SQL Server accepts remote connections:**
- SQL Server Configuration Manager → SQL Server Network Configuration → Protocols → TCP/IP → Enabled
- SQL Server Configuration Manager → SQL Server Services → Restart SQL Server

**Check firewall:**
- Port 1433 must be open
- Windows Firewall → Inbound Rules → New Rule → Port 1433

### Shopify API Token Invalid

**Verify token scopes:**
- `read_orders` - Required for fetching orders
- `read_products` - Required for product details
- `read_customers` - Required for customer information

**Regenerate token:**
1. Shopify Admin → Settings → Apps and sales channels
2. Develop apps → Click your app
3. API credentials → Regenerate token

### Products Not Found

**Add to Inventory database first:**
1. Validation shows which barcodes are missing
2. Add products to Inventory Items_tbl
3. Re-run validation
4. Products will auto-copy to BackOffice

### Transfer History Not Recording

**Check SQLite database:**
```bash
# Development
docker-compose exec app bash
sqlite3 /app/data/app.db "SELECT * FROM transfer_history LIMIT 5;"

# Production
sqlite3 /opt/shopify-quotation/data/app.db "SELECT * FROM transfer_history LIMIT 5;"
```

## Development

### Local Development Mode

```bash
# Run with live reload
docker-compose up --build

# View logs
docker-compose logs -f app

# Access SQLite database
docker-compose exec app bash
sqlite3 /app/data/app.db

# Access Flask shell
docker-compose exec app bash
```

### Environment Variables

Create `.env` file (optional):

```env
FLASK_ENV=development
FLASK_DEBUG=1
SECRET_KEY=your-secret-key-here
```

### Rebuilding After Code Changes

```bash
docker-compose down
docker-compose up -d --build
```

## Security Notes

- SQL Server passwords are encrypted using Fernet symmetric encryption
- Passwords never returned in API responses (GET requests)
- Shopify API tokens stored encrypted in SQLite
- No authentication layer (intended for internal network use)
- Run behind reverse proxy (nginx) for production with HTTPS
- Restrict network access to trusted IPs
- Regular backups recommended (automated in production installer)

## Backup and Maintenance

### Backup SQLite Data

**Development:**
```bash
cp ./data/app.db ./data/app.db.backup-$(date +%Y%m%d)
```

**Production:**
```bash
# Automatic backups created during updates
# Manual backup:
sudo tar -czf ~/shopify-quotation-backup-$(date +%Y%m%d).tar.gz /opt/shopify-quotation/data/
```

### Restore SQLite Data

**Development:**
```bash
cp ./data/app.db.backup-YYYYMMDD ./data/app.db
docker-compose restart app
```

**Production:**
```bash
# Restore from backup
sudo tar -xzf ~/shopify-quotation-backup-YYYYMMDD.tar.gz -C /
cd /opt/shopify-quotation
sudo docker compose restart
```

### Clear Transfer History

Use the History page UI to delete records, or manually:

**Development:**
```bash
docker-compose exec app bash
sqlite3 /app/data/app.db "DELETE FROM transfer_history WHERE status = 'failed';"
```

**Production:**
```bash
sqlite3 /opt/shopify-quotation/data/app.db "DELETE FROM transfer_history WHERE status = 'failed';"
```

### View Application Logs

```bash
# All logs
docker-compose logs

# Follow logs
docker-compose logs -f app

# Last 100 lines
docker-compose logs --tail=100 app
```

## Project Structure

```
shopify quotation/
├── docker-compose.yml        # Docker orchestration
├── Dockerfile               # Python 3.11 + FreeTDS
├── requirements.txt         # Python dependencies
├── install.sh              # Production installer (Ubuntu 24)
├── README.md               # This file
├── PRODUCTION.md          # Production deployment guide
├── app/
│   ├── __init__.py
│   ├── main.py             # Flask app + 22 API endpoints
│   ├── database.py         # SQLite + MS SQL managers
│   ├── shopify_client.py   # Shopify GraphQL client
│   ├── validator.py        # Product validation logic
│   ├── converter.py        # Order to quotation converter
│   ├── schema.sql          # PostgreSQL schema
│   ├── static/
│   │   ├── css/
│   │   │   └── style.css           # Material Design 3 styles
│   │   └── js/
│   │       ├── theme.js            # Dark/light theme manager
│   │       ├── orders.js           # Orders page logic
│   │       ├── settings.js         # Settings page logic
│   │       └── history.js          # History page logic
│   └── templates/
│       ├── orders.html             # Orders page
│       ├── settings.html           # Settings page
│       └── history.html            # History page
└── data/                           # SQLite database (gitignored)
    └── app.db                      # Application database
```

## License

Proprietary - Internal use only

## Support

For issues or questions, contact your system administrator.
