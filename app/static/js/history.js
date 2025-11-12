/**
 * History Page JavaScript
 * Handles transfer history display, filtering, and deletion
 */

// State management
const state = {
    stores: [],
    history: [],
    selectedRecords: new Set(),
    filters: {
        store_id: null,
        status: 'all',
        start_date: null,
        end_date: null
    },
    confirmCallback: null
};

// DOM Elements
const elements = {
    storeFilter: document.getElementById('storeFilter'),
    statusFilter: document.getElementById('statusFilter'),
    startDate: document.getElementById('startDate'),
    endDate: document.getElementById('endDate'),
    applyFilters: document.getElementById('applyFilters'),
    clearFilters: document.getElementById('clearFilters'),
    historyTableBody: document.getElementById('historyTableBody'),
    emptyState: document.getElementById('emptyState'),
    loadingState: document.getElementById('loadingState'),
    selectAll: document.getElementById('selectAll'),
    deleteSelected: document.getElementById('deleteSelected'),
    deleteAllFailed: document.getElementById('deleteAllFailed'),
    refreshHistory: document.getElementById('refreshHistory'),
    searchHistory: document.getElementById('searchHistory'),
    clearSearch: document.getElementById('clearSearch'),
    selectionSummary: document.getElementById('selectionSummary'),
    selectionCount: document.getElementById('selectionCount'),
    clearSelection: document.getElementById('clearSelection'),
    totalTransfers: document.getElementById('totalTransfers'),
    successCount: document.getElementById('successCount'),
    failedCount: document.getElementById('failedCount')
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    await loadStores();
    await loadHistory();
    setupEventListeners();
});

async function loadStores() {
    try {
        const response = await fetch('/api/stores');
        const data = await response.json();

        if (data.success && data.stores.length > 0) {
            state.stores = data.stores;

            elements.storeFilter.innerHTML = '<option value="">All Stores</option>' +
                state.stores.map(store =>
                    `<option value="${store.id}">${store.name}</option>`
                ).join('');
        }
    } catch (error) {
        console.error('Failed to load stores:', error);
    }
}

function setupEventListeners() {
    elements.applyFilters.addEventListener('click', applyFilters);
    elements.clearFilters.addEventListener('click', clearFilters);
    elements.refreshHistory.addEventListener('click', () => loadHistory());
    elements.selectAll.addEventListener('change', handleSelectAll);
    elements.deleteSelected.addEventListener('click', deleteSelected);
    elements.deleteAllFailed.addEventListener('click', deleteAllFailedRecords);
    elements.clearSelection.addEventListener('click', clearSelection);
    elements.searchHistory.addEventListener('input', handleSearch);
    elements.clearSearch.addEventListener('click', () => {
        elements.searchHistory.value = '';
        handleSearch();
    });

    // Modal listeners
    document.getElementById('closeErrorModal').addEventListener('click', closeErrorModal);
    document.getElementById('cancelConfirm').addEventListener('click', closeConfirmModal);
    document.getElementById('confirmAction').addEventListener('click', () => {
        if (state.confirmCallback) {
            state.confirmCallback();
        }
        closeConfirmModal();
    });
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadHistory() {
    showLoading();

    try {
        const params = new URLSearchParams();
        if (state.filters.store_id) params.append('store_id', state.filters.store_id);
        if (state.filters.status && state.filters.status !== 'all') params.append('status', state.filters.status);
        if (state.filters.start_date) params.append('start_date', state.filters.start_date);
        if (state.filters.end_date) params.append('end_date', state.filters.end_date);

        const response = await fetch(`/api/history?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
            state.history = data.history;
            renderHistory();
            updateStatistics();

            if (state.history.length === 0) {
                elements.emptyState.style.display = 'block';
            } else {
                elements.emptyState.style.display = 'none';
            }
        } else {
            throw new Error(data.error || 'Failed to load history');
        }
    } catch (error) {
        console.error('Failed to load history:', error);
        showToast('Failed to load history: ' + error.message, 'error');
    }

    hideLoading();
}

function renderHistory() {
    const tbody = elements.historyTableBody;
    tbody.innerHTML = '';

    if (state.history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No history records found</td></tr>';
        return;
    }

    state.history.forEach(record => {
        const row = createHistoryRow(record);
        tbody.appendChild(row);
    });

    updateSelectAllCheckbox();
}

function createHistoryRow(record) {
    const row = document.createElement('tr');
    const isSelected = state.selectedRecords.has(record.id);
    const statusClass = record.status === 'success' ? 'badge-success' : 'badge-error';

    row.innerHTML = `
        <td>
            <input type="checkbox"
                   class="record-checkbox"
                   data-record-id="${record.id}"
                   ${isSelected ? 'checked' : ''}>
        </td>
        <td>
            <strong>${record.shopify_order_name}</strong><br>
            <small class="text-secondary">ID: ${record.shopify_order_id}</small>
        </td>
        <td class="data-value">
            ${record.quotation_number
                ? `<strong>${record.quotation_number}</strong>`
                : '<span class="text-secondary">N/A</span>'}
        </td>
        <td>${record.store_name}</td>
        <td class="text-center">${record.line_items_count}</td>
        <td class="text-right data-value">
            ${record.total_amount ? '$' + parseFloat(record.total_amount).toFixed(2) : 'N/A'}
        </td>
        <td>
            <span class="badge ${statusClass}">${record.status}</span>
        </td>
        <td>${formatDate(record.transferred_at)}</td>
        <td class="table-actions">
            ${record.status === 'failed'
                ? `<button class="btn btn-small btn-secondary view-error" data-record-id="${record.id}">
                       👁️ View Error
                   </button>`
                : ''}
            <button class="btn btn-small btn-error delete-record" data-record-id="${record.id}">
                🗑️ Delete
            </button>
        </td>
    `;

    // Add event listeners
    const checkbox = row.querySelector('.record-checkbox');
    checkbox.addEventListener('change', (e) => handleRecordSelection(record.id, e.target.checked));

    const viewErrorBtn = row.querySelector('.view-error');
    if (viewErrorBtn) {
        viewErrorBtn.addEventListener('click', () => showErrorDetails(record));
    }

    const deleteBtn = row.querySelector('.delete-record');
    deleteBtn.addEventListener('click', () => deleteRecord(record.id, record.shopify_order_name));

    return row;
}

// ============================================================================
// FILTERS
// ============================================================================

function applyFilters() {
    state.filters.store_id = elements.storeFilter.value ? parseInt(elements.storeFilter.value) : null;
    state.filters.status = elements.statusFilter.value;
    state.filters.start_date = elements.startDate.value || null;
    state.filters.end_date = elements.endDate.value || null;

    loadHistory();
}

function clearFilters() {
    state.filters = {
        store_id: null,
        status: 'all',
        start_date: null,
        end_date: null
    };

    elements.storeFilter.value = '';
    elements.statusFilter.value = 'all';
    elements.startDate.value = '';
    elements.endDate.value = '';

    loadHistory();
}

// ============================================================================
// SELECTION MANAGEMENT
// ============================================================================

function handleRecordSelection(recordId, checked) {
    if (checked) {
        state.selectedRecords.add(recordId);
    } else {
        state.selectedRecords.delete(recordId);
    }
    updateSelectionUI();
}

function handleSelectAll() {
    const checked = elements.selectAll.checked;

    if (checked) {
        state.history.forEach(r => state.selectedRecords.add(r.id));
    } else {
        state.selectedRecords.clear();
    }

    // Update checkboxes
    document.querySelectorAll('.record-checkbox').forEach(cb => {
        cb.checked = checked;
    });

    updateSelectionUI();
}

function updateSelectAllCheckbox() {
    const allSelected = state.history.length > 0 &&
                       state.history.every(r => state.selectedRecords.has(r.id));
    elements.selectAll.checked = allSelected;
}

function clearSelection() {
    state.selectedRecords.clear();
    elements.selectAll.checked = false;
    document.querySelectorAll('.record-checkbox').forEach(cb => cb.checked = false);
    updateSelectionUI();
}

function updateSelectionUI() {
    const count = state.selectedRecords.size;

    if (count > 0) {
        elements.selectionSummary.style.display = 'flex';
        elements.selectionCount.textContent = `${count} record${count > 1 ? 's' : ''}`;
        elements.deleteSelected.disabled = false;
    } else {
        elements.selectionSummary.style.display = 'none';
        elements.deleteSelected.disabled = true;
    }
}

// ============================================================================
// SEARCH
// ============================================================================

function handleSearch() {
    const query = elements.searchHistory.value.toLowerCase().trim();

    document.querySelectorAll('#historyTableBody tr').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

// ============================================================================
// DELETION
// ============================================================================

async function deleteRecord(recordId, orderName) {
    showConfirmModal(
        `Delete transfer record for order ${orderName}?`,
        async () => {
            try {
                const response = await fetch(`/api/history/${recordId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    showToast('Record deleted successfully', 'success');
                    state.selectedRecords.delete(recordId);
                    await loadHistory();
                } else {
                    throw new Error(data.error || 'Failed to delete record');
                }
            } catch (error) {
                console.error('Failed to delete record:', error);
                showToast('Failed to delete record: ' + error.message, 'error');
            }
        }
    );
}

async function deleteSelected() {
    if (state.selectedRecords.size === 0) return;

    showConfirmModal(
        `Delete ${state.selectedRecords.size} selected record(s)?`,
        async () => {
            const recordIds = Array.from(state.selectedRecords);
            let successCount = 0;
            let failCount = 0;

            for (const id of recordIds) {
                try {
                    const response = await fetch(`/api/history/${id}`, {
                        method: 'DELETE'
                    });

                    const data = await response.json();

                    if (data.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (error) {
                    failCount++;
                }
            }

            if (successCount > 0) {
                showToast(`Deleted ${successCount} record(s)`, 'success');
            }

            if (failCount > 0) {
                showToast(`Failed to delete ${failCount} record(s)`, 'error');
            }

            clearSelection();
            await loadHistory();
        }
    );
}

async function deleteAllFailedRecords() {
    const failedCount = state.history.filter(r => r.status === 'failed').length;

    if (failedCount === 0) {
        showToast('No failed records to delete', 'info');
        return;
    }

    showConfirmModal(
        `Delete all ${failedCount} failed record(s)?`,
        async () => {
            try {
                const storeId = state.filters.store_id || null;

                const response = await fetch('/api/history/delete-failed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ store_id: storeId })
                });

                const data = await response.json();

                if (data.success) {
                    showToast(`Deleted ${data.affected_rows} failed record(s)`, 'success');
                    clearSelection();
                    await loadHistory();
                } else {
                    throw new Error(data.error || 'Failed to delete records');
                }
            } catch (error) {
                console.error('Failed to delete failed records:', error);
                showToast('Failed to delete records: ' + error.message, 'error');
            }
        }
    );
}

// ============================================================================
// ERROR DETAILS
// ============================================================================

function showErrorDetails(record) {
    const modal = document.getElementById('errorModal');
    const content = document.getElementById('errorContent');

    content.innerHTML = `
        <h3>Order: ${record.shopify_order_name}</h3>
        <p class="text-secondary">Shopify Order ID: ${record.shopify_order_id}</p>
        <p class="text-secondary">Store: ${record.store_name}</p>
        <p class="text-secondary">Date: ${formatDate(record.transferred_at)}</p>

        <h4 class="mt-3 text-error">Error Message:</h4>
        <div style="padding: 16px; background: var(--error-light); border-left: 4px solid var(--error); border-radius: 8px;">
            <p style="color: var(--error); font-family: monospace; font-size: 13px; white-space: pre-wrap;">
                ${record.error_message || 'No error message available'}
            </p>
        </div>

        <h4 class="mt-3">Order Details:</h4>
        <ul>
            <li>Line Items: ${record.line_items_count}</li>
            <li>Total Amount: $${record.total_amount ? parseFloat(record.total_amount).toFixed(2) : '0.00'}</li>
        </ul>
    `;

    modal.classList.add('active');
}

function closeErrorModal() {
    document.getElementById('errorModal').classList.remove('active');
}

// ============================================================================
// STATISTICS
// ============================================================================

function updateStatistics() {
    const total = state.history.length;
    const success = state.history.filter(r => r.status === 'success').length;
    const failed = state.history.filter(r => r.status === 'failed').length;

    elements.totalTransfers.textContent = total.toLocaleString();
    elements.successCount.textContent = success.toLocaleString();
    elements.failedCount.textContent = failed.toLocaleString();
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showLoading() {
    elements.loadingState.style.display = 'block';
    document.querySelector('.card').style.display = 'none';
}

function hideLoading() {
    elements.loadingState.style.display = 'none';
    document.querySelector('.card').style.display = 'block';
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
