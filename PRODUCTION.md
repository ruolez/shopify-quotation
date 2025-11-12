# Production Deployment Guide

## Overview

This guide covers deploying the Shopify Quotation Transfer application on a production Ubuntu 24 LTS server using the automated installer script.

## Requirements

- Ubuntu 24 LTS (clean installation)
- Root or sudo access
- Network connectivity
- Port 80 available

## Quick Installation

### One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/ruolez/shopify-quotation/main/install.sh | sudo bash
```

### Manual Installation

```bash
# Download the installer
wget https://raw.githubusercontent.com/ruolez/shopify-quotation/main/install.sh

# Make it executable
chmod +x install.sh

# Run the installer
sudo ./install.sh
```

## Installer Features

The `install.sh` script provides three main operations:

### 1. Install (Fresh Installation)

- Checks and installs Docker + Docker Compose if needed
- Clones repository from GitHub
- Configures application for port 80
- Builds and starts Docker containers
- Auto-detects server IP address
- Displays access URL

**What it does:**
- Installs Docker CE and Docker Compose plugin
- Clones repository to `/opt/shopify-quotation`
- Creates data directory for SQLite databases
- Modifies docker-compose.yml to use port 80
- Starts application containers

### 2. Update (Pull Latest Changes)

- Backs up current data to `/opt/shopify-quotation-backups`
- Stops running containers
- Pulls latest code from GitHub
- Rebuilds containers with new code
- Preserves existing database and configuration

**What it does:**
- Creates timestamped backup: `backup-YYYYMMDD-HHMMSS.tar.gz`
- Performs `git reset --hard origin/main`
- Rebuilds Docker images
- Restarts application with preserved data

### 3. Remove (Clean Uninstall)

- Backs up data before removal
- Stops and removes Docker containers
- Removes application directory
- Preserves backup in `/opt/shopify-quotation-backups`

**What it does:**
- Prompts for confirmation
- Creates final backup
- Runs `docker compose down -v`
- Removes `/opt/shopify-quotation`

## Post-Installation

### Access the Application

After installation, access the application at:
```
http://YOUR_SERVER_IP
```

The installer will display the correct URL.

### Configure the Application

1. Navigate to **Settings** page
2. Configure **Shopify Stores**:
   - Add store name
   - Enter shop URL (e.g., `mystore.myshopify.com`)
   - Provide Admin API access token
3. Configure **SQL Server Connections**:
   - BackOffice database credentials
   - Inventory database credentials
   - Test connections before saving
4. Set **Customer Mappings**:
   - Map each Shopify store to BackOffice customer
5. Configure **Quotation Defaults**:
   - Set default values per store

### First Transfer

1. Go to **Orders** page
2. Select a Shopify store from dropdown
3. Review unfulfilled orders
4. Select orders to transfer
5. Click "Transfer Selected"
6. Review validation results
7. Confirm transfer

## Docker Commands

### View Logs
```bash
cd /opt/shopify-quotation
docker compose logs -f
```

### Stop Application
```bash
cd /opt/shopify-quotation
docker compose down
```

### Start Application
```bash
cd /opt/shopify-quotation
docker compose up -d
```

### Restart Application
```bash
cd /opt/shopify-quotation
docker compose restart
```

### Rebuild After Code Changes
```bash
cd /opt/shopify-quotation
docker compose down
docker compose up -d --build
```

## Data Persistence

### Database Location
```
/opt/shopify-quotation/data/app.db
```

This SQLite database contains:
- Shopify store configurations
- SQL Server connection settings
- Customer mappings
- Quotation defaults
- Transfer history

### Backup Strategy

**Automatic Backups:**
- Created before every update operation
- Stored in `/opt/shopify-quotation-backups`
- Timestamped for easy identification

**Manual Backup:**
```bash
cd /opt/shopify-quotation
tar -czf ~/shopify-quotation-backup-$(date +%Y%m%d).tar.gz data/
```

**Restore from Backup:**
```bash
cd /opt/shopify-quotation
docker compose down
tar -xzf ~/shopify-quotation-backup-YYYYMMDD.tar.gz
docker compose up -d
```

## Firewall Configuration

### Allow HTTP Traffic

**UFW (Ubuntu Firewall):**
```bash
sudo ufw allow 80/tcp
sudo ufw enable
sudo ufw status
```

**iptables:**
```bash
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables-save > /etc/iptables/rules.v4
```

### Restrict Access (Optional)

To restrict access to specific IP ranges:
```bash
# Allow only internal network (example: 192.168.1.0/24)
sudo ufw delete allow 80/tcp
sudo ufw allow from 192.168.1.0/24 to any port 80 proto tcp
```

## Reverse Proxy (Optional)

For HTTPS and additional features, use nginx as reverse proxy:

### Install nginx
```bash
sudo apt-get install nginx certbot python3-certbot-nginx
```

### Configure nginx
```nginx
# /etc/nginx/sites-available/shopify-quotation
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Note:** If using reverse proxy, change `APP_PORT=8000` in install.sh

### Enable HTTPS
```bash
sudo certbot --nginx -d your-domain.com
```

## Monitoring

### Check Application Status
```bash
cd /opt/shopify-quotation
docker compose ps
```

### Check Resource Usage
```bash
docker stats shopify-quotation
```

### View Application Logs
```bash
cd /opt/shopify-quotation
docker compose logs --tail=100 -f
```

## Troubleshooting

### Application Not Accessible

1. **Check if container is running:**
   ```bash
   docker compose ps
   ```

2. **Check logs for errors:**
   ```bash
   docker compose logs
   ```

3. **Verify port is listening:**
   ```bash
   netstat -tuln | grep :80
   ```

4. **Check firewall:**
   ```bash
   sudo ufw status
   ```

### Port 80 Already in Use

1. **Find what's using port 80:**
   ```bash
   sudo lsof -i :80
   ```

2. **Stop conflicting service:**
   ```bash
   # If Apache is running
   sudo systemctl stop apache2
   sudo systemctl disable apache2

   # If nginx is running
   sudo systemctl stop nginx
   sudo systemctl disable nginx
   ```

3. **Or edit install.sh to use different port:**
   ```bash
   # Change APP_PORT=80 to APP_PORT=8080
   nano install.sh
   ```

### Database Connection Issues

1. **Check SQL Server connectivity from container:**
   ```bash
   docker compose exec web ping YOUR_SQL_SERVER
   ```

2. **Verify SQL Server accepts remote connections**

3. **Check firewall on SQL Server (port 1433)**

4. **Test connection from Settings page**

### After System Reboot

Application should auto-start. If not:
```bash
cd /opt/shopify-quotation
docker compose up -d
```

To enable auto-start on boot:
```bash
sudo systemctl enable docker
```

## Updates

### Check for Updates

Visit the GitHub repository:
```
https://github.com/ruolez/shopify-quotation
```

### Apply Updates

Run the installer and select "Update":
```bash
sudo ./install.sh
# Select option 2) Update
```

This will:
1. Backup your data
2. Pull latest code
3. Rebuild containers
4. Preserve all settings and history

## Security Recommendations

1. **Change Default Ports:**
   - Don't expose on port 80 if not needed
   - Use reverse proxy with HTTPS

2. **Restrict Access:**
   - Use firewall rules to limit IP ranges
   - Consider VPN for remote access

3. **Regular Backups:**
   - Schedule automated backups
   - Store backups off-server

4. **SQL Server Security:**
   - Use strong passwords
   - Limit SQL Server network access
   - Use SQL Server authentication

5. **Keep Updated:**
   - Regularly run updates via installer
   - Monitor GitHub for security patches

6. **API Token Security:**
   - Use Shopify custom apps with minimal scopes
   - Rotate tokens periodically
   - Never commit tokens to version control

## Support

For issues, questions, or contributions:
- GitHub Issues: https://github.com/ruolez/shopify-quotation/issues
- Documentation: See README.md in repository

## License

[Add your license information here]
