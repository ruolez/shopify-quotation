#!/bin/bash

# Shopify Quotation Transfer - Production Installer for Ubuntu 24 LTS
# Supports: Install, Update, Remove
# Port: 80 (Production)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="shopify-quotation"
APP_DIR="/opt/shopify-quotation"
GITHUB_REPO="https://github.com/ruolez/shopify-quotation.git"
DOCKER_COMPOSE_FILE="docker-compose.yml"
DATA_DIR="$APP_DIR/data"
BACKUP_DIR="/opt/shopify-quotation-backups"
APP_PORT=80

# Function to print colored messages
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root or with sudo"
        exit 1
    fi
}

# Function to detect network IP address
detect_ip() {
    print_info "Detecting network IP address..."

    # Try multiple methods to get IP
    IP_ADDRESS=$(hostname -I | awk '{print $1}')

    if [ -z "$IP_ADDRESS" ]; then
        IP_ADDRESS=$(ip route get 8.8.8.8 | awk -F"src " 'NR==1{split($2,a," ");print a[1]}')
    fi

    if [ -z "$IP_ADDRESS" ]; then
        IP_ADDRESS="localhost"
        print_warning "Could not detect IP address, using localhost"
    else
        print_success "Detected IP address: $IP_ADDRESS"
    fi
}

# Function to check and install Docker
install_docker() {
    if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
        print_success "Docker and Docker Compose are already installed"
        return
    fi

    print_info "Installing Docker and Docker Compose..."

    # Update package index
    apt-get update

    # Install prerequisites
    apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Set up Docker repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker Engine
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start and enable Docker
    systemctl start docker
    systemctl enable docker

    print_success "Docker and Docker Compose installed successfully"
}

# Function to check if port 80 is available
check_port() {
    if netstat -tuln | grep -q ":$APP_PORT "; then
        print_error "Port $APP_PORT is already in use"
        print_info "Please free up port $APP_PORT or edit the script to use a different port"
        exit 1
    fi
}

# Function to backup data
backup_data() {
    if [ -d "$DATA_DIR" ]; then
        print_info "Backing up application data..."
        mkdir -p "$BACKUP_DIR"
        BACKUP_FILE="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).tar.gz"
        tar -czf "$BACKUP_FILE" -C "$APP_DIR" data
        print_success "Backup created: $BACKUP_FILE"
    fi
}

# Function to install application
install_application() {
    print_info "Starting installation of Shopify Quotation Transfer..."

    # Check if already installed
    if [ -d "$APP_DIR" ]; then
        print_error "Application is already installed at $APP_DIR"
        print_info "Use the Update option to update the application"
        exit 1
    fi

    # Check and install Docker
    install_docker

    # Check if port is available
    check_port

    # Clone repository
    print_info "Cloning repository from GitHub..."
    git clone "$GITHUB_REPO" "$APP_DIR"

    # Create data directory
    mkdir -p "$DATA_DIR"

    # Update docker-compose.yml to use port 80
    print_info "Configuring application for port $APP_PORT..."
    cd "$APP_DIR"

    # Backup original docker-compose.yml
    cp "$DOCKER_COMPOSE_FILE" "$DOCKER_COMPOSE_FILE.original"

    # Update port mapping in docker-compose.yml
    sed -i "s/- \"[0-9]*:5000\"/- \"$APP_PORT:5000\"/g" "$DOCKER_COMPOSE_FILE"

    # Build and start containers
    print_info "Building and starting Docker containers..."
    docker compose up -d --build

    # Wait for application to start
    print_info "Waiting for application to start..."
    sleep 10

    # Detect IP address
    detect_ip

    # Success message
    echo ""
    print_success "═══════════════════════════════════════════════════════════"
    print_success "  Shopify Quotation Transfer installed successfully!"
    print_success "═══════════════════════════════════════════════════════════"
    echo ""
    print_info "Application is running at:"
    echo -e "  ${GREEN}http://$IP_ADDRESS${NC}"
    echo ""
    print_info "To view logs:"
    echo "  cd $APP_DIR && docker compose logs -f"
    echo ""
    print_info "To stop the application:"
    echo "  cd $APP_DIR && docker compose down"
    echo ""
    print_info "To restart the application:"
    echo "  cd $APP_DIR && docker compose restart"
    echo ""
}

# Function to update application
update_application() {
    print_info "Starting update of Shopify Quotation Transfer..."

    # Check if installed
    if [ ! -d "$APP_DIR" ]; then
        print_error "Application is not installed at $APP_DIR"
        print_info "Use the Install option to install the application"
        exit 1
    fi

    # Backup data
    backup_data

    # Stop running containers
    print_info "Stopping running containers..."
    cd "$APP_DIR"
    docker compose down

    # Pull latest changes
    print_info "Pulling latest changes from GitHub..."
    git fetch origin
    git reset --hard origin/main

    # Update docker-compose.yml to use port 80 (in case it was reset)
    print_info "Ensuring port configuration..."
    sed -i "s/- \"[0-9]*:5000\"/- \"$APP_PORT:5000\"/g" "$DOCKER_COMPOSE_FILE"

    # Rebuild and start containers
    print_info "Rebuilding and starting Docker containers..."
    docker compose up -d --build

    # Wait for application to start
    print_info "Waiting for application to start..."
    sleep 10

    # Detect IP address
    detect_ip

    # Success message
    echo ""
    print_success "═══════════════════════════════════════════════════════════"
    print_success "  Shopify Quotation Transfer updated successfully!"
    print_success "═══════════════════════════════════════════════════════════"
    echo ""
    print_info "Application is running at:"
    echo -e "  ${GREEN}http://$IP_ADDRESS${NC}"
    echo ""
    print_info "Data has been preserved from previous installation"
    print_info "Backup location: $BACKUP_DIR"
    echo ""
}

# Function to remove application
remove_application() {
    print_warning "This will completely remove the Shopify Quotation Transfer application"
    print_warning "All data will be backed up to $BACKUP_DIR before removal"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        print_info "Removal cancelled"
        exit 0
    fi

    # Check if installed
    if [ ! -d "$APP_DIR" ]; then
        print_error "Application is not installed at $APP_DIR"
        exit 1
    fi

    # Final backup
    backup_data

    # Stop and remove containers
    print_info "Stopping and removing Docker containers..."
    cd "$APP_DIR"
    docker compose down -v

    # Remove application directory
    print_info "Removing application directory..."
    cd /
    rm -rf "$APP_DIR"

    # Success message
    echo ""
    print_success "═══════════════════════════════════════════════════════════"
    print_success "  Shopify Quotation Transfer removed successfully!"
    print_success "═══════════════════════════════════════════════════════════"
    echo ""
    print_info "Data backup location: $BACKUP_DIR"
    print_info "To restore data in the future, copy the data directory back to $APP_DIR"
    echo ""
}

# Function to show menu
show_menu() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  Shopify Quotation Transfer - Production Installer"
    echo "  Ubuntu 24 LTS - Port $APP_PORT"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "Please select an option:"
    echo ""
    echo "  1) Install - Fresh installation"
    echo "  2) Update - Pull latest changes from GitHub"
    echo "  3) Remove - Completely remove the application"
    echo "  4) Exit"
    echo ""
}

# Main script
main() {
    check_root

    while true; do
        show_menu
        read -p "Enter your choice (1-4): " choice

        case $choice in
            1)
                install_application
                break
                ;;
            2)
                update_application
                break
                ;;
            3)
                remove_application
                break
                ;;
            4)
                print_info "Exiting installer"
                exit 0
                ;;
            *)
                print_error "Invalid option. Please select 1-4"
                sleep 2
                ;;
        esac
    done
}

# Run main function
main
