#!/bin/bash

# Run database migrations for Shopify Quotation Transfer
# This script is called during updates to apply any pending migrations

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_info "Running database migrations..."

# Run all SQL migration files in order
for migration in "$SCRIPT_DIR"/*.sql; do
    if [ -f "$migration" ]; then
        migration_name=$(basename "$migration")
        print_info "Applying migration: $migration_name"

        # Run migration using docker compose exec
        docker compose exec -T postgres psql -U admin -d shopify_quotation -f "/migrations/$migration_name"

        print_success "Migration $migration_name applied"
    fi
done

print_success "All migrations completed"
