/**
 * Settings Page JavaScript
 * Handles all configuration: Shopify stores, SQL connections, customer mappings, defaults
 */

// State management
const state = {
    stores: [],
    sqlConnections: {},
    customers: [],
    confirmCallback: null
};

// DOM Elements
const elements = {
    storesContainer: document.getElementById('storesContainer'),
    customerMappingsContainer: document.getElementById('customerMappingsContainer'),
    quotationDefaultsContainer: document.getElementById('quotationDefaultsContainer')
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadStores(),
        loadSQLConnections(),
        loadCustomers()
    ]);

    await renderCustomerMappings();
    await renderQuotationDefaults();

    setupEventListeners();
});

function setupEventListeners() {
    // Store management
    document.getElementById('addStoreBtn').addEventListener('click', () => openStoreModal());
    document.getElementById('saveStore').addEventListener('click', saveStore);
    document.getElementById('cancelStoreModal').addEventListener('click', closeStoreModal);

    // SQL connections
    document.getElementById('backofficeForm').addEventListener('submit', (e) => {
        e.preventDefault();
        saveSQLConnection('backoffice');
    });
    document.getElementById('inventoryForm').addEventListener('submit', (e) => {
        e.preventDefault();
        saveSQLConnection('inventory');
    });
    document.getElementById('testBackofficeBtn').addEventListener('click', () => testSQLConnection('backoffice'));
    document.getElementById('testInventoryBtn').addEventListener('click', () => testSQLConnection('inventory'));

    // Confirmation modal
    document.getElementById('cancelConfirm').addEventListener('click', closeConfirmModal);
    document.getElementById('confirmAction').addEventListener('click', () => {
        if (state.confirmCallback) {
            state.confirmCallback();
        }
        closeConfirmModal();
    });
}

// ============================================================================
// SHOPIFY STORES
// ============================================================================

async function loadStores() {
    try {
        const response = await fetch('/api/stores');
        const data = await response.json();

        if (data.success) {
            state.stores = data.stores;
            renderStores();
        }
    } catch (error) {
        console.error('Failed to load stores:', error);
        showToast('Failed to load stores: ' + error.message, 'error');
    }
}

function renderStores() {
    const container = elements.storesContainer;

    if (state.stores.length === 0) {
        container.innerHTML = '<p class="text-secondary">No stores configured yet</p>';
        return;
    }

    container.innerHTML = state.stores.map(store => `
        <div class="card mt-2" style="padding: 16px; background: var(--background-alt);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4>${store.name}</h4>
                    <p class="text-secondary" style="margin: 4px 0;">
                        ${store.shop_url}
                    </p>
                    <span class="badge ${store.is_active ? 'badge-success' : 'badge-error'}">
                        ${store.is_active ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div class="table-actions">
                    <button class="btn btn-small btn-secondary" onclick="testStoreConnection(${store.id})">
                        🔌 Test
                    </button>
                    <button class="btn btn-small btn-secondary" onclick="openStoreModal(${store.id})">
                        ✏️ Edit
                    </button>
                    <button class="btn btn-small btn-error" onclick="deleteStore(${store.id})">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function openStoreModal(storeId = null) {
    const modal = document.getElementById('storeModal');
    const title = document.getElementById('storeModalTitle');

    if (storeId) {
        const store = state.stores.find(s => s.id === storeId);
        if (store) {
            title.textContent = 'Edit Shopify Store';
            document.getElementById('store_id').value = store.id;
            document.getElementById('store_name').value = store.name;
            document.getElementById('shop_url').value = store.shop_url;
            document.getElementById('api_token').value = store.admin_api_token;
        }
    } else {
        title.textContent = 'Add Shopify Store';
        document.getElementById('storeForm').reset();
        document.getElementById('store_id').value = '';
    }

    modal.classList.add('active');
}

function closeStoreModal() {
    document.getElementById('storeModal').classList.remove('active');
}

async function saveStore() {
    const storeId = document.getElementById('store_id').value;
    const name = document.getElementById('store_name').value.trim();
    const shopUrl = document.getElementById('shop_url').value.trim();
    const apiToken = document.getElementById('api_token').value.trim();

    if (!name || !shopUrl || !apiToken) {
        showToast('Please fill all fields', 'warning');
        return;
    }

    try {
        const url = storeId ? `/api/stores/${storeId}` : '/api/stores';
        const method = storeId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, shop_url: shopUrl, api_token: apiToken })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`Store ${storeId ? 'updated' : 'added'} successfully`, 'success');
            closeStoreModal();
            await loadStores();
            await renderCustomerMappings();
            await renderQuotationDefaults();
        } else {
            throw new Error(data.error || 'Failed to save store');
        }
    } catch (error) {
        console.error('Failed to save store:', error);
        showToast('Failed to save store: ' + error.message, 'error');
    }
}

async function testStoreConnection(storeId) {
    try {
        const response = await fetch(`/api/stores/${storeId}/test`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showToast('✓ ' + data.message, 'success');
        } else {
            showToast('✗ ' + data.message, 'error');
        }
    } catch (error) {
        console.error('Connection test failed:', error);
        showToast('Connection test failed: ' + error.message, 'error');
    }
}

function deleteStore(storeId) {
    const store = state.stores.find(s => s.id === storeId);
    if (!store) return;

    showConfirmModal(
        `Are you sure you want to delete "${store.name}"? This will also delete all associated settings and history.`,
        async () => {
            try {
                const response = await fetch(`/api/stores/${storeId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    showToast('Store deleted successfully', 'success');
                    await loadStores();
                    await renderCustomerMappings();
                    await renderQuotationDefaults();
                } else {
                    throw new Error(data.error || 'Failed to delete store');
                }
            } catch (error) {
                console.error('Failed to delete store:', error);
                showToast('Failed to delete store: ' + error.message, 'error');
            }
        }
    );
}

// ============================================================================
// SQL SERVER CONNECTIONS
// ============================================================================

async function loadSQLConnections() {
    try {
        const response = await fetch('/api/sql-connections');
        const data = await response.json();

        if (data.success) {
            data.connections.forEach(conn => {
                state.sqlConnections[conn.connection_type] = conn;
                populateSQLForm(conn.connection_type, conn);
            });
        }
    } catch (error) {
        console.error('Failed to load SQL connections:', error);
        showToast('Failed to load SQL connections: ' + error.message, 'error');
    }
}

function populateSQLForm(type, conn) {
    const prefix = type === 'backoffice' ? 'backoffice' : 'inventory';

    document.getElementById(`${prefix}_host`).value = conn.host || '';
    document.getElementById(`${prefix}_port`).value = conn.port || 1433;
    document.getElementById(`${prefix}_database`).value = conn.database_name || '';
    document.getElementById(`${prefix}_username`).value = conn.username || '';
    // Don't populate password for security
}

async function saveSQLConnection(type) {
    const prefix = type === 'backoffice' ? 'backoffice' : 'inventory';

    const host = document.getElementById(`${prefix}_host`).value.trim();
    const port = parseInt(document.getElementById(`${prefix}_port`).value) || 1433;
    const database = document.getElementById(`${prefix}_database`).value.trim();
    const username = document.getElementById(`${prefix}_username`).value.trim();
    const password = document.getElementById(`${prefix}_password`).value;

    if (!host || !database || !username || !password) {
        showToast('Please fill all fields', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/sql-connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                connection_type: type,
                host,
                port,
                database_name: database,
                username,
                password
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`${type === 'backoffice' ? 'BackOffice' : 'Inventory'} connection saved successfully`, 'success');
            // Clear password field
            document.getElementById(`${prefix}_password`).value = '';
            await loadSQLConnections();
        } else {
            throw new Error(data.error || 'Failed to save connection');
        }
    } catch (error) {
        console.error('Failed to save SQL connection:', error);
        showToast('Failed to save connection: ' + error.message, 'error');
    }
}

async function testSQLConnection(type) {
    try {
        const response = await fetch(`/api/sql-connections/${type}/test`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showToast('✓ ' + data.message, 'success');
        } else {
            showToast('✗ ' + data.message, 'error');
        }
    } catch (error) {
        console.error('Connection test failed:', error);
        showToast('Connection test failed: ' + error.message, 'error');
    }
}

// ============================================================================
// CUSTOMER MAPPINGS
// ============================================================================

async function loadCustomers() {
    try {
        const response = await fetch('/api/customers');
        const data = await response.json();

        if (data.success) {
            state.customers = data.customers;
        }
    } catch (error) {
        console.error('Failed to load customers:', error);
        // Don't show error toast here as SQL connection might not be configured yet
    }
}

async function renderCustomerMappings() {
    const container = elements.customerMappingsContainer;

    if (state.stores.length === 0) {
        container.innerHTML = '<p class="text-secondary">Add a Shopify store first</p>';
        return;
    }

    if (state.customers.length === 0) {
        container.innerHTML = '<p class="text-warning">⚠️ Configure BackOffice SQL connection first to load customers</p>';
        return;
    }

    const html = await Promise.all(state.stores.map(async store => {
        // Get current mapping
        const response = await fetch(`/api/customer-mappings/${store.id}`);
        const data = await response.json();
        const mapping = data.mapping;

        return `
            <div class="form-group">
                <label for="customer_${store.id}">
                    <strong>Shopify Store:</strong> ${store.name} → <strong>BackOffice Customer:</strong>
                </label>
                <select id="customer_${store.id}" class="form-control customer-select" data-store-id="${store.id}">
                    <option value="">Select BackOffice customer for "${store.name}"...</option>
                    ${state.customers.map(c => `
                        <option value="${c.CustomerID}" ${mapping && mapping.customer_id === c.CustomerID ? 'selected' : ''}>
                            ${c.BusinessName} (${c.AccountNo || 'N/A'})
                        </option>
                    `).join('')}
                </select>
            </div>
        `;
    }));

    container.innerHTML = html.join('');

    // Add change listeners
    document.querySelectorAll('.customer-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const storeId = parseInt(e.target.dataset.storeId);
            const customerId = parseInt(e.target.value);

            if (!customerId) return;

            await saveCustomerMapping(storeId, customerId);
        });
    });
}

async function saveCustomerMapping(storeId, customerId) {
    const customer = state.customers.find(c => c.CustomerID === customerId);

    try {
        const response = await fetch('/api/customer-mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: storeId,
                customer_id: customerId,
                business_name: customer?.BusinessName
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Customer mapping saved successfully', 'success');
        } else {
            throw new Error(data.error || 'Failed to save mapping');
        }
    } catch (error) {
        console.error('Failed to save customer mapping:', error);
        showToast('Failed to save mapping: ' + error.message, 'error');
    }
}

// ============================================================================
// QUOTATION DEFAULTS
// ============================================================================

async function renderQuotationDefaults() {
    const container = elements.quotationDefaultsContainer;

    if (state.stores.length === 0) {
        container.innerHTML = '<p class="text-secondary">Add a Shopify store first</p>';
        return;
    }

    const html = await Promise.all(state.stores.map(async store => {
        // Get current defaults
        const response = await fetch(`/api/quotation-defaults/${store.id}`);
        const data = await response.json();
        const defaults = data.defaults || {};

        return `
            <div class="card mt-2" style="padding: 16px; background: var(--background-alt);">
                <h4>${store.name}</h4>
                <div class="form-group">
                    <label for="status_${store.id}">Status</label>
                    <input type="number" id="status_${store.id}" placeholder="1" value="${defaults.status || 1}">
                </div>
                <div class="form-group">
                    <label for="shipper_id_${store.id}">Shipper ID <span class="optional-label">(optional)</span></label>
                    <input type="number" id="shipper_id_${store.id}" placeholder="Shipper ID" value="${defaults.shipper_id || ''}">
                </div>
                <div class="form-group">
                    <label for="sales_rep_id_${store.id}">Sales Rep ID <span class="optional-label">(optional)</span></label>
                    <input type="number" id="sales_rep_id_${store.id}" placeholder="Sales Rep ID" value="${defaults.sales_rep_id || ''}">
                </div>
                <div class="form-group">
                    <label for="term_id_${store.id}">Term ID <span class="optional-label">(optional)</span></label>
                    <input type="number" id="term_id_${store.id}" placeholder="Term ID" value="${defaults.term_id || ''}">
                </div>
                <div class="form-group">
                    <label for="title_prefix_${store.id}">Quotation Title Prefix</label>
                    <input type="text" id="title_prefix_${store.id}" placeholder="Shopify Order" value="${defaults.quotation_title_prefix || 'Shopify Order'}">
                </div>
                <div class="form-group">
                    <label for="expiration_days_${store.id}">Expiration Days</label>
                    <input type="number" id="expiration_days_${store.id}" placeholder="365" value="${defaults.expiration_days || 365}">
                </div>
                <div class="form-group">
                    <label for="db_id_${store.id}">Database ID (Quotation Number)</label>
                    <input type="text" id="db_id_${store.id}" maxlength="1" placeholder="1" value="${defaults.db_id || '1'}">
                    <small class="text-secondary">Single digit used in quotation number format</small>
                </div>
                <button class="btn btn-primary" onclick="saveQuotationDefaults(${store.id})">
                    💾 Save Defaults
                </button>
            </div>
        `;
    }));

    container.innerHTML = html.join('');
}

async function saveQuotationDefaults(storeId) {
    const getValue = (id) => {
        const val = document.getElementById(id).value.trim();
        return val === '' ? null : (isNaN(val) ? val : parseInt(val));
    };

    const status = getValue(`status_${storeId}`);
    const shipperId = getValue(`shipper_id_${storeId}`);
    const salesRepId = getValue(`sales_rep_id_${storeId}`);
    const termId = getValue(`term_id_${storeId}`);
    const titlePrefix = document.getElementById(`title_prefix_${storeId}`).value.trim();
    const expirationDays = getValue(`expiration_days_${storeId}`) || 365;
    const dbId = document.getElementById(`db_id_${storeId}`).value.trim() || '1';

    try {
        const response = await fetch('/api/quotation-defaults', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: storeId,
                status,
                shipper_id: shipperId,
                sales_rep_id: salesRepId,
                term_id: termId,
                quotation_title_prefix: titlePrefix,
                expiration_days: expirationDays,
                db_id: dbId
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Quotation defaults saved successfully', 'success');
        } else {
            throw new Error(data.error || 'Failed to save defaults');
        }
    } catch (error) {
        console.error('Failed to save quotation defaults:', error);
        showToast('Failed to save defaults: ' + error.message, 'error');
    }
}

// Make this function global so it can be called from inline onclick
window.saveQuotationDefaults = saveQuotationDefaults;
window.testStoreConnection = testStoreConnection;
window.openStoreModal = openStoreModal;
window.deleteStore = deleteStore;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showConfirmModal(message, callback) {
    document.getElementById('confirmMessage').textContent = message;
    state.confirmCallback = callback;
    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
    state.confirmCallback = null;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    toast.innerHTML = `
        <div class="toast-icon"></div>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}
