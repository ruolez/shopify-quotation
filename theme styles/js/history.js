// ============================================================================
// History Page
// ============================================================================

let historyRecords = [];
let filteredRecords = [];

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    loadStatistics();
    loadHistory();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('applyFiltersBtn').addEventListener('click', applyFilters);
    document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);
    document.getElementById('refreshHistoryBtn').addEventListener('click', () => {
        loadStatistics();
        loadHistory();
    });

    // Column visibility toggle
    const showNotesCheckbox = document.getElementById('showNotesColumn');
    showNotesCheckbox.addEventListener('change', toggleNotesColumn);

    // Load saved preference from localStorage
    const showNotes = localStorage.getItem('showNotesColumn') === 'true';
    showNotesCheckbox.checked = showNotes;

    // Always call toggle to ensure proper initial state
    toggleNotesColumn();
}

// ============================================================================
// Load Functions
// ============================================================================

async function loadStatistics() {
    try {
        const response = await fetch('/api/history/stats');
        if (handleAuthError(response)) return;

        const result = await response.json();

        if (result.success && result.data) {
            renderStatistics(result.data);
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

async function loadHistory() {
    showLoading();

    try {
        // Build query params
        const params = new URLSearchParams();
        const operation = document.getElementById('filterOperation').value;
        const startDate = document.getElementById('filterStartDate').value;
        const endDate = document.getElementById('filterEndDate').value;

        if (operation && operation !== 'ALL') params.append('operation_type', operation);
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);

        const queryString = params.toString();
        const url = `/api/history${queryString ? '?' + queryString : ''}`;

        const response = await fetch(url);
        if (handleAuthError(response)) return;

        const result = await response.json();

        if (result.success) {
            historyRecords = result.data || [];
            filteredRecords = historyRecords;
            renderTable();
        } else {
            showError(result.message);
        }
    } catch (error) {
        console.error('Error loading history:', error);
        showError('Failed to load history records');
    } finally {
        hideLoading();
    }
}

// ============================================================================
// Render Functions
// ============================================================================

function renderStatistics(stats) {
    const container = document.getElementById('statsContainer');

    if (!stats || stats.total_operations === 0) {
        container.style.display = 'none';
        return;
    }

    container.innerHTML = `
        <div class="stat-card">
            <span class="stat-value">${stats.total_operations || 0}</span>
            <span class="stat-label">Total Operations</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">${stats.creates || 0}</span>
            <span class="stat-label">Creates</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">${stats.updates || 0}</span>
            <span class="stat-label">Updates</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">${stats.adjustments || 0}</span>
            <span class="stat-label">Adjustments</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">${stats.deletes || 0}</span>
            <span class="stat-label">Deletes</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">${stats.unique_users || 0}</span>
            <span class="stat-label">Active Users</span>
        </div>
    `;

    container.style.display = 'flex';
}

function renderTable() {
    const tbody = document.getElementById('historyTableBody');
    const resultsInfo = document.getElementById('resultsInfo');
    const emptyState = document.getElementById('emptyState');

    if (!filteredRecords || filteredRecords.length === 0) {
        tbody.innerHTML = '';
        resultsInfo.textContent = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    resultsInfo.textContent = `Showing ${filteredRecords.length} record${filteredRecords.length === 1 ? '' : 's'}`;

    tbody.innerHTML = filteredRecords.map(record => {
        const timestamp = formatTimestamp(record.Timestamp);
        const operationBadge = getOperationBadge(record.OperationType);
        const changes = formatChanges(record);
        const notes = record.Notes ? escapeHtml(record.Notes) : '-';

        return `
            <tr>
                <td>${timestamp}</td>
                <td>${operationBadge}</td>
                <td>${escapeHtml(record.Username)}</td>
                <td>${escapeHtml(record.NewProductUPC || record.PreviousProductUPC || '-')}</td>
                <td>${escapeHtml(record.NewProductDescription || record.PreviousProductDescription || '-')}</td>
                <td>${escapeHtml(record.NewBinLocation || record.PreviousBinLocation || '-')}</td>
                <td>${changes}</td>
                <td class="notes-column notes-cell">${notes}</td>
            </tr>
        `;
    }).join('');
}

// ============================================================================
// Formatting Functions
// ============================================================================

function formatTimestamp(timestamp) {
    if (!timestamp) return '-';

    // The timestamp from API is in HTTP date format: "Mon, 03 Nov 2025 18:58:07 GMT"
    // But it's already in Central Time (not actually GMT), so we parse it directly
    // Format: "DayName, DD Mon YYYY HH:MM:SS GMT"
    const parts = timestamp.split(/[\s:,]+/);

    // parts[0] = day name (e.g., "Mon")
    // parts[1] = day (e.g., "03")
    // parts[2] = month name (e.g., "Nov")
    // parts[3] = year (e.g., "2025")
    // parts[4] = hour (e.g., "18")
    // parts[5] = minute (e.g., "58")
    // parts[6] = second (e.g., "07")
    // parts[7] = "GMT" (ignore - it's actually Central Time)

    const monthNames = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };

    const day = String(parts[1]).padStart(2, '0');
    const month = monthNames[parts[2]] || '01';
    const year = String(parts[3]).slice(-2); // Last 2 digits
    const hours = parseInt(parts[4]);
    const minutes = String(parts[5]).padStart(2, '0');

    // Format time with AM/PM (no seconds)
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;

    return `${month}/${day}/${year} ${displayHours}:${minutes} ${period}`;
}

function getOperationBadge(operation) {
    const badges = {
        'CREATE': '<span class="change-badge create">CREATE</span>',
        'UPDATE': '<span class="change-badge update">UPDATE</span>',
        'ADJUST': '<span class="change-badge adjust">ADJUST</span>',
        'DELETE': '<span class="change-badge delete">DELETE</span>'
    };
    return badges[operation] || operation;
}

function formatChanges(record) {
    const operation = record.OperationType;

    if (operation === 'CREATE') {
        return `
            <div class="change-details">
                Cases: <strong>${record.NewQty_Cases || 0}</strong><br>
                Qty/Case: <strong>${record.NewUnitQty2 || 0}</strong>
            </div>
        `;
    }

    if (operation === 'DELETE') {
        return `
            <div class="change-details">
                Cases: <del>${record.PreviousQty_Cases || 0}</del><br>
                Qty/Case: <del>${record.PreviousUnitQty2 || 0}</del>
            </div>
        `;
    }

    if (operation === 'ADJUST') {
        const sign = record.AdjustmentAmount >= 0 ? '+' : '';
        const color = record.AdjustmentAmount >= 0 ? 'var(--success)' : 'var(--error)';
        return `
            <div class="change-details">
                Cases: ${record.PreviousQty_Cases || 0}
                <span class="change-arrow">→</span>
                <strong>${record.NewQty_Cases || 0}</strong>
                <span style="color: ${color}; font-weight: bold;">(${sign}${record.AdjustmentAmount})</span>
            </div>
        `;
    }

    if (operation === 'UPDATE') {
        const changes = [];

        // Check each field for changes
        if (record.PreviousQty_Cases !== record.NewQty_Cases) {
            changes.push(`Cases: ${record.PreviousQty_Cases || 0} → <strong>${record.NewQty_Cases || 0}</strong>`);
        }

        if (record.PreviousUnitQty2 !== record.NewUnitQty2) {
            changes.push(`Qty/Case: ${record.PreviousUnitQty2 || 0} → <strong>${record.NewUnitQty2 || 0}</strong>`);
        }

        if (record.PreviousBinLocation !== record.NewBinLocation) {
            changes.push(`Bin: ${escapeHtml(record.PreviousBinLocation || '-')} → <strong>${escapeHtml(record.NewBinLocation || '-')}</strong>`);
        }

        if (record.PreviousProductUPC !== record.NewProductUPC) {
            changes.push(`UPC: ${escapeHtml(record.PreviousProductUPC || '-')} → <strong>${escapeHtml(record.NewProductUPC || '-')}</strong>`);
        }

        return `<div class="change-details">${changes.join('<br>')}</div>`;
    }

    return '-';
}

// ============================================================================
// Filter Functions
// ============================================================================

function applyFilters() {
    loadHistory();
}

function clearFilters() {
    document.getElementById('filterOperation').value = 'ALL';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    loadHistory();
}

// ============================================================================
// Column Visibility Functions
// ============================================================================

function toggleNotesColumn() {
    const checkbox = document.getElementById('showNotesColumn');
    const notesColumns = document.querySelectorAll('.notes-column');
    const display = checkbox.checked ? 'table-cell' : 'none';

    notesColumns.forEach(col => {
        col.style.display = display;
    });

    // Save preference to localStorage
    localStorage.setItem('showNotesColumn', checkbox.checked);
}

// ============================================================================
// UI Helper Functions
// ============================================================================

function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
}

function hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
}

function showError(message) {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = `
        <tr>
            <td colspan="8" style="text-align: center; padding: 40px; color: var(--error);">
                ${escapeHtml(message)}
            </td>
        </tr>
    `;
}

function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ============================================================================
// Authentication Functions
// ============================================================================

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

function handleAuthError(response) {
    if (response.status === 401) {
        window.location.href = '/login';
        return true;
    }
    return false;
}
