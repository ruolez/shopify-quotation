/**
 * Orders Page JavaScript
 * Handles order fetching, validation, and transfer to quotations
 */

// State management
const state = {
    stores: [],
    selectedStore: null,
    orders: [],
    selectedOrders: new Set(),
    validatedOrders: new Map(), // order_id -> validation result
    currentTransferOrder: null // {orderId, orderName} for single order transfer
};

// DOM Elements
const elements = {
    storeSelect: document.getElementById('storeSelect'),
    ordersToolbar: document.getElementById('ordersToolbar'),
    ordersContainer: document.getElementById('ordersContainer'),
    ordersTableBody: document.getElementById('ordersTableBody'),
    emptyState: document.getElementById('emptyState'),
    loadingState: document.getElementById('loadingState'),
    selectAll: document.getElementById('selectAll'),
    refreshOrders: document.getElementById('refreshOrders'),
    transferSelected: document.getElementById('transferSelected'),
    selectionSummary: document.getElementById('selectionSummary'),
    selectionCount: document.getElementById('selectionCount'),
    clearSelection: document.getElementById('clearSelection'),
    searchOrders: document.getElementById('searchOrders'),
    clearSearch: document.getElementById('clearSearch'),
    totalOrders: document.getElementById('totalOrders'),
    pendingOrders: document.getElementById('pendingOrders'),
    transferredOrders: document.getElementById('transferredOrders')
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    await loadStores();
    setupEventListeners();
});

async function loadStores() {
    try {
        const response = await fetch('/api/stores');
        const data = await response.json();

        if (data.success && data.stores.length > 0) {
            state.stores = data.stores.filter(s => s.is_active);

            elements.storeSelect.innerHTML = '<option value="">Select a store...</option>' +
                state.stores.map(store =>
                    `<option value="${store.id}">${store.name}</option>`
                ).join('');

            // Restore last selected store from localStorage
            const lastStoreId = localStorage.getItem('lastSelectedStore');
            if (lastStoreId && state.stores.some(s => s.id === parseInt(lastStoreId))) {
                elements.storeSelect.value = lastStoreId;
                // Trigger store change to load orders
                handleStoreChange();
            }
        } else {
            elements.storeSelect.innerHTML = '<option value="">No stores configured</option>';
            showToast('Please configure a Shopify store in Settings', 'warning');
        }
    } catch (error) {
        console.error('Failed to load stores:', error);
        showToast('Failed to load stores: ' + error.message, 'error');
    }
}

function setupEventListeners() {
    elements.storeSelect.addEventListener('change', handleStoreChange);
    elements.refreshOrders.addEventListener('click', () => loadOrders());
    elements.selectAll.addEventListener('change', handleSelectAll);
    elements.transferSelected.addEventListener('click', initiateTransfer);
    elements.clearSelection.addEventListener('click', clearSelection);
    elements.searchOrders.addEventListener('input', handleSearch);
    elements.clearSearch.addEventListener('click', () => {
        elements.searchOrders.value = '';
        handleSearch();
    });

    // Modal listeners
    document.getElementById('closeValidationModal').addEventListener('click', closeValidationModal);
    document.getElementById('proceedTransfer').addEventListener('click', proceedWithTransfer);
    document.getElementById('cancelTransfer').addEventListener('click', closeConfirmModal);
    document.getElementById('confirmTransfer').addEventListener('click', confirmTransfer);
}

// ============================================================================
// ORDER LOADING
// ============================================================================

async function handleStoreChange() {
    const storeId = elements.storeSelect.value;

    if (!storeId) {
        state.selectedStore = null;
        elements.ordersToolbar.style.display = 'none';
        elements.ordersContainer.style.display = 'none';
        elements.emptyState.style.display = 'block';
        localStorage.removeItem('lastSelectedStore');
        return;
    }

    // Save selected store to localStorage
    localStorage.setItem('lastSelectedStore', storeId);

    state.selectedStore = parseInt(storeId);
    state.selectedOrders.clear();
    state.validatedOrders.clear();
    updateSelectionUI();

    await loadOrders();
}

async function loadOrders() {
    if (!state.selectedStore) return;

    showLoading();

    try {
        const response = await fetch(`/api/orders?store_id=${state.selectedStore}&days_back=14`);
        const data = await response.json();

        if (data.success) {
            state.orders = data.orders;
            renderOrders();
            updateSummary();

            elements.ordersToolbar.style.display = 'grid';
            elements.ordersContainer.style.display = 'block';
            elements.emptyState.style.display = 'none';

            if (state.orders.length === 0) {
                elements.emptyState.style.display = 'block';
                elements.ordersContainer.style.display = 'none';
                document.querySelector('#emptyState h3').textContent = 'No Unfulfilled Orders';
                document.querySelector('#emptyState p').textContent = 'All orders from the last 14 days have been fulfilled or transferred';
            }
        } else {
            throw new Error(data.error || 'Failed to load orders');
        }
    } catch (error) {
        console.error('Failed to load orders:', error);
        showToast('Failed to load orders: ' + error.message, 'error');
        hideLoading();
    }

    hideLoading();
}

function renderOrders() {
    const tbody = elements.ordersTableBody;
    tbody.innerHTML = '';

    if (state.orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No orders found</td></tr>';
        return;
    }

    state.orders.forEach(order => {
        const row = createOrderRow(order);
        tbody.appendChild(row);
    });

    updateSelectAllCheckbox();
}

function createOrderRow(order) {
    const row = document.createElement('tr');
    const isSelected = state.selectedOrders.has(order.id);
    const canSelect = !order.transferred;

    row.innerHTML = `
        <td>
            <input type="checkbox"
                   class="order-checkbox"
                   data-order-id="${order.id}"
                   ${isSelected ? 'checked' : ''}
                   ${!canSelect ? 'disabled' : ''}>
        </td>
        <td><strong>${order.name}</strong></td>
        <td>
            ${order.customer.name || 'N/A'}<br>
            <small class="text-secondary">${order.customer.email || ''}</small>
        </td>
        <td>${formatDate(order.created_at)}</td>
        <td class="text-center">${order.line_items_count}</td>
        <td class="text-right data-value">$${order.total_amount.toFixed(2)}</td>
        <td>
            ${order.transferred
                ? '<span class="badge badge-success">Transferred</span>'
                : '<span class="badge badge-warning">Pending</span>'}
        </td>
        <td class="table-actions">
            ${!order.transferred
                ? `<button class="btn btn-small btn-primary transfer-single-order" data-order-id="${order.id}">
                       Transfer
                   </button>`
                : '<span class="text-secondary">Completed</span>'}
        </td>
    `;

    // Add event listeners
    const checkbox = row.querySelector('.order-checkbox');
    if (checkbox && !checkbox.disabled) {
        checkbox.addEventListener('change', (e) => handleOrderSelection(order.id, e.target.checked));
    }

    const transferBtn = row.querySelector('.transfer-single-order');
    if (transferBtn) {
        transferBtn.addEventListener('click', () => transferSingleOrder(order.id, order.name));
    }

    return row;
}

// ============================================================================
// SELECTION MANAGEMENT
// ============================================================================

function handleOrderSelection(orderId, checked) {
    if (checked) {
        state.selectedOrders.add(orderId);
    } else {
        state.selectedOrders.delete(orderId);
    }
    updateSelectionUI();
}

function handleSelectAll() {
    const checked = elements.selectAll.checked;
    const transferableOrders = state.orders.filter(o => !o.transferred);

    if (checked) {
        transferableOrders.forEach(o => state.selectedOrders.add(o.id));
    } else {
        state.selectedOrders.clear();
    }

    // Update checkboxes
    document.querySelectorAll('.order-checkbox').forEach(cb => {
        if (!cb.disabled) {
            cb.checked = checked;
        }
    });

    updateSelectionUI();
}

function updateSelectAllCheckbox() {
    const transferableOrders = state.orders.filter(o => !o.transferred);
    const allSelected = transferableOrders.length > 0 &&
                       transferableOrders.every(o => state.selectedOrders.has(o.id));

    elements.selectAll.checked = allSelected;
}

function clearSelection() {
    state.selectedOrders.clear();
    elements.selectAll.checked = false;
    document.querySelectorAll('.order-checkbox').forEach(cb => cb.checked = false);
    updateSelectionUI();
}

function updateSelectionUI() {
    const count = state.selectedOrders.size;

    if (count > 0) {
        elements.selectionSummary.style.display = 'flex';
        elements.selectionCount.textContent = `${count} order${count > 1 ? 's' : ''}`;
        elements.transferSelected.disabled = false;
    } else {
        elements.selectionSummary.style.display = 'none';
        elements.transferSelected.disabled = true;
    }
}

function updateSummary() {
    const total = state.orders.length;
    const transferred = state.orders.filter(o => o.transferred).length;
    const pending = total - transferred;

    elements.totalOrders.textContent = total.toLocaleString();
    elements.pendingOrders.textContent = pending.toLocaleString();
    elements.transferredOrders.textContent = transferred.toLocaleString();
}

// ============================================================================
// SEARCH & FILTER
// ============================================================================

function handleSearch() {
    const query = elements.searchOrders.value.toLowerCase().trim();

    document.querySelectorAll('#ordersTableBody tr').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

// ============================================================================
// PRODUCT VALIDATION
// ============================================================================

function showValidationModalLoading() {
    const modal = document.getElementById('validationModal');
    const content = document.getElementById('validationContent');

    content.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <div class="spinner" style="width: 48px; height: 48px; margin: 0 auto 16px;"></div>
            <h3>Validating Products...</h3>
            <p class="text-secondary">Checking products in BackOffice and Inventory databases</p>
        </div>
    `;

    // Hide proceed button while loading
    document.getElementById('proceedTransfer').style.display = 'none';

    modal.classList.add('active');
}

function showValidationModal(validation, orderName) {
    const modal = document.getElementById('validationModal');
    const content = document.getElementById('validationContent');

    let html = `<h3>Order: ${orderName}</h3>`;

    // Show valid products
    if (validation.products.length > 0) {
        html += `
            <h4 class="mt-3">✓ Valid Products (${validation.products.length})</h4>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Barcode</th>
                            <th>Description</th>
                            <th>Qty</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${validation.products.map(p => `
                            <tr>
                                <td class="data-value">${p.ProductUPC || 'N/A'}</td>
                                <td>${p.ProductDescription || p.shopify_name || 'N/A'}</td>
                                <td class="text-center">${p.shopify_quantity}</td>
                                <td><span class="badge badge-success">Found</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // Show copied products
    if (validation.copied.length > 0) {
        html += `
            <h4 class="mt-3">📋 Copied from Inventory (${validation.copied.length})</h4>
            <p class="text-secondary">These products were not in BackOffice and were copied from Inventory database:</p>
            <ul>
                ${validation.copied.map(c => `
                    <li><strong>${c.barcode}</strong> - ${c.name}</li>
                `).join('')}
            </ul>
        `;
    }

    // Show missing products
    if (validation.missing.length > 0) {
        html += `
            <h4 class="mt-3 text-error">⚠️ Missing Products (${validation.missing.length})</h4>
            <p class="text-secondary">These products were not found in any database:</p>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Barcode</th>
                            <th>Product Name</th>
                            <th>Qty</th>
                            <th>Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${validation.missing.map(m => `
                            <tr>
                                <td class="data-value">${m.barcode}</td>
                                <td>${m.name}</td>
                                <td class="text-center">${m.quantity}</td>
                                <td><span class="badge badge-error">${m.reason}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <p class="text-warning mt-2"><strong>⚠️ Transfer blocked:</strong> Please add missing products to your Inventory database first.</p>
        `;
    }

    content.innerHTML = html;

    // Show/hide proceed button based on validation AND transfer state
    const proceedBtn = document.getElementById('proceedTransfer');
    // Only show "Continue Transfer" if validation passed AND this is a transfer flow
    if (validation.valid && validation.missing.length === 0 && state.currentTransferOrder) {
        proceedBtn.style.display = 'inline-flex';
    } else {
        proceedBtn.style.display = 'none';
    }

    modal.classList.add('active');
}

function closeValidationModal() {
    document.getElementById('validationModal').classList.remove('active');
}

async function proceedWithTransfer() {
    if (!state.currentTransferOrder) return;

    const { orderId, orderName } = state.currentTransferOrder;

    // Close validation modal
    closeValidationModal();

    // Show toast with loading state
    showToast('Transferring order...', 'info');

    try {
        const response = await fetch('/api/orders/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: state.selectedStore,
                order_ids: [orderId]
            })
        });

        const data = await response.json();

        if (data.success && data.results.length > 0) {
            const result = data.results[0];

            if (result.success) {
                showToast(`Order ${orderName} → Quotation #${result.quotation_number}`, 'success');
                // Update the order row status without reloading
                updateOrderRowStatus(orderId, true);
            } else {
                showToast(`Transfer failed: ${result.error}`, 'error');
            }
        } else {
            throw new Error(data.error || 'Transfer failed');
        }
    } catch (error) {
        console.error('Transfer error:', error);
        showToast('Transfer failed: ' + error.message, 'error');
    }

    // Clear current transfer state
    state.currentTransferOrder = null;
}

// ============================================================================
// TRANSFER WORKFLOW
// ============================================================================

function updateOrderRowStatus(orderId, transferred) {
    // Find the row for this order
    const rows = document.querySelectorAll('#ordersTableBody tr');
    rows.forEach(row => {
        const checkbox = row.querySelector('.order-checkbox');
        if (checkbox && checkbox.dataset.orderId === orderId) {
            // Update the status badge
            const statusCell = row.cells[6]; // Status column
            if (statusCell) {
                statusCell.innerHTML = transferred
                    ? '<span class="badge badge-success">Transferred</span>'
                    : '<span class="badge badge-warning">Pending</span>';
            }

            // Update the actions column
            const actionsCell = row.cells[7]; // Actions column
            if (actionsCell && transferred) {
                actionsCell.innerHTML = '<span class="text-secondary">Completed</span>';
            }

            // Disable the checkbox
            checkbox.disabled = transferred;
            if (transferred) {
                checkbox.checked = false;
                state.selectedOrders.delete(orderId);
            }

            // Update selection UI
            updateSelectionUI();
        }
    });
}

async function transferSingleOrder(orderId, orderName) {
    if (!state.selectedStore) return;

    // Store order info for transfer after validation
    state.currentTransferOrder = { orderId, orderName };

    // Show validation modal immediately with loading state
    showValidationModalLoading();

    try {
        const response = await fetch('/api/orders/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: state.selectedStore,
                order_id: orderId
            })
        });

        const data = await response.json();

        if (data.success) {
            state.validatedOrders.set(orderId, data.validation);
            showValidationModal(data.validation, data.order_name);
        } else {
            closeValidationModal();
            throw new Error(data.error || 'Validation failed');
        }
    } catch (error) {
        console.error('Validation error:', error);
        showToast('Validation failed: ' + error.message, 'error');
    }
}

async function initiateTransfer() {
    if (state.selectedOrders.size === 0) return;

    // Show confirmation modal
    document.getElementById('confirmCount').textContent = state.selectedOrders.size;
    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

async function confirmTransfer() {
    closeConfirmModal();

    if (state.selectedOrders.size === 0) return;

    const orderIds = Array.from(state.selectedOrders);
    showLoading();

    try {
        const response = await fetch('/api/orders/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: state.selectedStore,
                order_ids: orderIds
            })
        });

        const data = await response.json();

        if (data.success) {
            const { success, failed } = data.summary;

            if (success > 0) {
                showToast(`Successfully transferred ${success} order${success > 1 ? 's' : ''}!`, 'success');
            }

            if (failed > 0) {
                showToast(`${failed} order${failed > 1 ? 's' : ''} failed to transfer. Check History for details.`, 'error');
            }

            // Show detailed results and update order rows
            data.results.forEach(result => {
                if (result.success) {
                    showToast(`Order ${result.order_name} → Quotation #${result.quotation_number}`, 'success');
                    // Update the order row status without reloading
                    updateOrderRowStatus(result.order_id, true);
                } else {
                    showToast(`Order ${result.order_name || result.order_id}: ${result.error}`, 'error');
                }
            });

            // Clear selection (no reload needed)
            clearSelection();
        } else {
            throw new Error(data.error || 'Transfer failed');
        }
    } catch (error) {
        console.error('Transfer error:', error);
        showToast('Transfer failed: ' + error.message, 'error');
    }

    hideLoading();
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showLoading() {
    elements.loadingState.style.display = 'block';
    elements.ordersContainer.style.display = 'none';
    elements.emptyState.style.display = 'none';
}

function hideLoading() {
    elements.loadingState.style.display = 'none';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
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
