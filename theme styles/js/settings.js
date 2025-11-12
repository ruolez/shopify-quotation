// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    document.getElementById('configForm').addEventListener('submit', saveConfig);
    document.getElementById('testConnectionBtn').addEventListener('click', testConnection);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
}

// Load existing configuration
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        const result = await response.json();

        if (result.success && result.config) {
            const config = result.config;
            document.getElementById('server').value = config.server || '';
            document.getElementById('port').value = config.port || 1433;
            document.getElementById('database').value = config.database || '';
            document.getElementById('username').value = config.username || '';
            // Password is not returned for security
        }
    } catch (error) {
        console.error('Error loading config:', error);
        showToast('Error loading configuration', 'error');
    }
}

// Save configuration
async function saveConfig(e) {
    e.preventDefault();

    const config = {
        server: document.getElementById('server').value.trim(),
        port: parseInt(document.getElementById('port').value),
        database: document.getElementById('database').value.trim(),
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
    };

    // Validate
    if (!config.server || !config.database || !config.username || !config.password) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    showLoading('Saving configuration...');

    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (result.success) {
            showToast('Configuration saved successfully', 'success');
            hideConnectionStatus();
        } else {
            showToast(result.message || 'Failed to save configuration', 'error');
        }
    } catch (error) {
        showToast('Error saving configuration: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Test database connection
async function testConnection() {
    const config = {
        server: document.getElementById('server').value.trim(),
        port: parseInt(document.getElementById('port').value),
        database: document.getElementById('database').value.trim(),
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
    };

    // Validate
    if (!config.server || !config.database || !config.username || !config.password) {
        showToast('Please fill in all required fields before testing', 'error');
        return;
    }

    showLoading('Testing connection...');
    hideConnectionStatus();

    try {
        const response = await fetch('/api/config/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (result.success) {
            showConnectionStatus(true, 'Connection successful! Database is accessible.');
            showToast('Connection test successful', 'success');
        } else {
            showConnectionStatus(false, result.message || 'Connection failed');
            showToast('Connection test failed', 'error');
        }
    } catch (error) {
        showConnectionStatus(false, 'Error: ' + error.message);
        showToast('Error testing connection: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Show connection status
function showConnectionStatus(success, message) {
    const statusDiv = document.getElementById('connectionStatus');
    const badge = document.getElementById('statusBadge');
    const text = document.getElementById('statusText');

    badge.className = success ? 'badge badge-success' : 'badge badge-error';
    text.textContent = message;
    statusDiv.style.display = 'block';
}

// Hide connection status
function hideConnectionStatus() {
    document.getElementById('connectionStatus').style.display = 'none';
}

// Show loading overlay
function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    const text = overlay.querySelector('div:last-child');
    text.textContent = message;
    overlay.style.display = 'flex';
}

// Hide loading overlay
function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// Show toast notification
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️'
    };

    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.success}</div>
        <div class="toast-message">${escapeHtml(message)}</div>
    `;

    container.appendChild(toast);

    // Start fade out after 4.5 seconds, then remove after animation completes
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            toast.remove();
        }, 300); // Match fadeOut animation duration
    }, 4500);
}

// Escape HTML to prevent XSS
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Logout handler
async function handleLogout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login';
    }
}
