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
  currentTransferOrder: null, // {orderId, orderName} for single order transfer
  showTransferred: false, // Show/hide transferred orders
  selectedCustomerAccount: null, // {customer_id, account_no, business_name} for custom account
};

// DOM Elements
const elements = {
  storeSelect: document.getElementById("storeSelect"),
  ordersToolbar: document.getElementById("ordersToolbar"),
  ordersContainer: document.getElementById("ordersContainer"),
  ordersTableBody: document.getElementById("ordersTableBody"),
  emptyState: document.getElementById("emptyState"),
  loadingState: document.getElementById("loadingState"),
  selectAll: document.getElementById("selectAll"),
  refreshOrders: document.getElementById("refreshOrders"),
  transferSelected: document.getElementById("transferSelected"),
  selectionSummary: document.getElementById("selectionSummary"),
  selectionCount: document.getElementById("selectionCount"),
  clearSelection: document.getElementById("clearSelection"),
  searchOrders: document.getElementById("searchOrders"),
  clearSearch: document.getElementById("clearSearch"),
  showTransferred: document.getElementById("showTransferred"),
  totalOrders: document.getElementById("totalOrders"),
  pendingOrders: document.getElementById("pendingOrders"),
  transferredOrders: document.getElementById("transferredOrders"),
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  await loadStores();
  setupEventListeners();
});

async function loadStores() {
  try {
    const response = await fetch("/api/stores");
    const data = await response.json();

    if (data.success && data.stores.length > 0) {
      state.stores = data.stores.filter((s) => s.is_active);

      elements.storeSelect.innerHTML =
        '<option value="">Select a store...</option>' +
        state.stores
          .map((store) => `<option value="${store.id}">${store.name}</option>`)
          .join("");

      // Restore last selected store from localStorage
      const lastStoreId = localStorage.getItem("lastSelectedStore");
      if (
        lastStoreId &&
        state.stores.some((s) => s.id === parseInt(lastStoreId))
      ) {
        elements.storeSelect.value = lastStoreId;
        // Trigger store change to load orders
        handleStoreChange();
      }
    } else {
      elements.storeSelect.innerHTML =
        '<option value="">No stores configured</option>';
      showToast("Please configure a Shopify store in Settings", "warning");
    }
  } catch (error) {
    console.error("Failed to load stores:", error);
    showToast("Failed to load stores: " + error.message, "error");
  }
}

function setupEventListeners() {
  elements.storeSelect.addEventListener("change", handleStoreChange);
  elements.refreshOrders.addEventListener("click", () => loadOrders());
  elements.selectAll.addEventListener("change", handleSelectAll);
  elements.transferSelected.addEventListener("click", initiateTransfer);
  elements.clearSelection.addEventListener("click", clearSelection);
  elements.searchOrders.addEventListener("input", handleSearch);
  elements.clearSearch.addEventListener("click", () => {
    elements.searchOrders.value = "";
    handleSearch();
  });
  elements.showTransferred.addEventListener(
    "change",
    handleShowTransferredToggle,
  );

  // Modal listeners
  document
    .getElementById("closeValidationModal")
    .addEventListener("click", closeValidationModal);
  document
    .getElementById("proceedTransfer")
    .addEventListener("click", proceedWithTransfer);
  document
    .getElementById("cancelTransfer")
    .addEventListener("click", closeConfirmModal);
  document
    .getElementById("confirmTransfer")
    .addEventListener("click", confirmTransfer);
}

// ============================================================================
// ORDER LOADING
// ============================================================================

async function handleStoreChange() {
  const storeId = elements.storeSelect.value;

  if (!storeId) {
    state.selectedStore = null;
    elements.ordersToolbar.style.display = "none";
    elements.ordersContainer.style.display = "none";
    elements.emptyState.style.display = "block";
    localStorage.removeItem("lastSelectedStore");
    return;
  }

  // Save selected store to localStorage
  localStorage.setItem("lastSelectedStore", storeId);

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
    const response = await fetch(
      `/api/orders?store_id=${state.selectedStore}&days_back=14`,
    );
    const data = await response.json();

    if (data.success) {
      state.orders = data.orders;
      renderOrders();
      updateSummary();

      elements.ordersToolbar.style.display = "grid";
      elements.ordersContainer.style.display = "block";
      elements.emptyState.style.display = "none";

      if (state.orders.length === 0) {
        elements.emptyState.style.display = "block";
        elements.ordersContainer.style.display = "none";
        document.querySelector("#emptyState h3").textContent =
          "No Unfulfilled Orders";
        document.querySelector("#emptyState p").textContent =
          "All orders from the last 14 days have been fulfilled or transferred";
      }
    } else {
      throw new Error(data.error || "Failed to load orders");
    }
  } catch (error) {
    console.error("Failed to load orders:", error);
    showToast("Failed to load orders: " + error.message, "error");
    hideLoading();
  }

  hideLoading();
}

function renderOrders() {
  const tbody = elements.ordersTableBody;
  tbody.innerHTML = "";

  // Filter orders based on showTransferred state
  const filteredOrders = state.showTransferred
    ? state.orders
    : state.orders.filter((order) => !order.transferred);

  if (filteredOrders.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="text-center">No orders found</td></tr>';
    return;
  }

  filteredOrders.forEach((order) => {
    const row = createOrderRow(order);
    tbody.appendChild(row);
  });

  updateSelectAllCheckbox();
}

function createOrderRow(order) {
  const row = document.createElement("tr");
  const isSelected = state.selectedOrders.has(order.id);
  const canSelect = !order.transferred;

  row.innerHTML = `
        <td>
            <input type="checkbox"
                   class="order-checkbox"
                   data-order-id="${order.id}"
                   ${isSelected ? "checked" : ""}
                   ${!canSelect ? "disabled" : ""}>
        </td>
        <td>
            <strong>${order.name}</strong>
            ${
              order.note
                ? `<span class="note-icon" data-note="${escapeHtml(order.note)}">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                    <rect x="5" y="3" width="14" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="8" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="8" y1="16" x2="13" y2="16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </span>`
                : ""
            }
        </td>
        <td>
            ${order.customer.name || "N/A"}<br>
            <small class="text-secondary">${order.customer.email || ""}</small>
        </td>
        <td>${formatDate(order.created_at)}</td>
        <td class="text-center">${order.line_items_count}</td>
        <td class="text-right data-value">$${order.total_amount.toFixed(2)}</td>
        <td>
            ${
              order.transferred
                ? '<span class="badge badge-success">Transferred</span>'
                : '<span class="badge badge-warning">Pending</span>'
            }
        </td>
        <td class="table-actions">
            ${
              !order.transferred
                ? `<button class="btn btn-small btn-primary transfer-single-order" data-order-id="${order.id}">
                       Transfer
                   </button>`
                : '<span class="text-secondary">Completed</span>'
            }
        </td>
    `;

  // Add event listeners
  const checkbox = row.querySelector(".order-checkbox");
  if (checkbox && !checkbox.disabled) {
    checkbox.addEventListener("change", (e) =>
      handleOrderSelection(order.id, e.target.checked),
    );
  }

  const transferBtn = row.querySelector(".transfer-single-order");
  if (transferBtn) {
    transferBtn.addEventListener("click", () =>
      transferSingleOrder(order.id, order.name),
    );
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
  const transferableOrders = state.orders.filter((o) => !o.transferred);

  if (checked) {
    transferableOrders.forEach((o) => state.selectedOrders.add(o.id));
  } else {
    state.selectedOrders.clear();
  }

  // Update checkboxes
  document.querySelectorAll(".order-checkbox").forEach((cb) => {
    if (!cb.disabled) {
      cb.checked = checked;
    }
  });

  updateSelectionUI();
}

function updateSelectAllCheckbox() {
  const transferableOrders = state.orders.filter((o) => !o.transferred);
  const allSelected =
    transferableOrders.length > 0 &&
    transferableOrders.every((o) => state.selectedOrders.has(o.id));

  elements.selectAll.checked = allSelected;
}

function clearSelection() {
  state.selectedOrders.clear();
  elements.selectAll.checked = false;
  document
    .querySelectorAll(".order-checkbox")
    .forEach((cb) => (cb.checked = false));
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selectedOrders.size;

  if (count > 0) {
    elements.selectionSummary.style.display = "flex";
    elements.selectionCount.textContent = `${count} order${count > 1 ? "s" : ""}`;
    elements.transferSelected.disabled = false;
  } else {
    elements.selectionSummary.style.display = "none";
    elements.transferSelected.disabled = true;
  }
}

function updateSummary() {
  const total = state.orders.length;
  const transferred = state.orders.filter((o) => o.transferred).length;
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

  document.querySelectorAll("#ordersTableBody tr").forEach((row) => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(query) ? "" : "none";
  });
}

function handleShowTransferredToggle() {
  state.showTransferred = elements.showTransferred.checked;
  renderOrders();

  // Re-apply search filter if there's an active search
  if (elements.searchOrders.value) {
    handleSearch();
  }
}

// ============================================================================
// PRODUCT VALIDATION
// ============================================================================

function showValidationModalLoading() {
  const modal = document.getElementById("validationModal");
  const content = document.getElementById("validationContent");

  content.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <div class="spinner" style="width: 48px; height: 48px; margin: 0 auto 16px;"></div>
            <h3>Validating Products...</h3>
            <p class="text-secondary">Checking products in BackOffice and Inventory databases</p>
        </div>
    `;

  // Hide proceed button while loading
  document.getElementById("proceedTransfer").style.display = "none";

  modal.classList.add("active");
}

function showValidationModal(validation, orderName) {
  const modal = document.getElementById("validationModal");
  const content = document.getElementById("validationContent");

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
                        ${validation.products
                          .map(
                            (p) => `
                            <tr>
                                <td class="data-value">${p.ProductUPC || "N/A"}</td>
                                <td>${p.ProductDescription || p.shopify_name || "N/A"}</td>
                                <td class="text-center">${p.shopify_quantity}</td>
                                <td><span class="badge badge-success">Found</span></td>
                            </tr>
                        `,
                          )
                          .join("")}
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
                ${validation.copied
                  .map(
                    (c) => `
                    <li><strong>${c.barcode}</strong> - ${c.name}</li>
                `,
                  )
                  .join("")}
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
                        ${validation.missing
                          .map(
                            (m) => `
                            <tr>
                                <td class="data-value">${m.barcode}</td>
                                <td>${m.name}</td>
                                <td class="text-center">${m.quantity}</td>
                                <td><span class="badge badge-error">${m.reason}</span></td>
                            </tr>
                        `,
                          )
                          .join("")}
                    </tbody>
                </table>
            </div>
            <p class="text-warning mt-2"><strong>⚠️ Transfer blocked:</strong> Please add missing products to your Inventory database first.</p>
        `;

    // Add diagnostics section for debugging
    if (validation.diagnostics) {
      const diag = validation.diagnostics;
      const missingBarcodes = validation.missing
        .map((m) => m.barcode)
        .filter((b) => b !== "NONE")
        .join(",");

      html += `
            <div class="diagnostics-box" style="margin-top: 16px; padding: 12px; background: var(--surface-variant, #f5f5f5); border-radius: 8px; font-size: 13px; border: 1px solid var(--outline, #ddd);">
                <strong>🔍 Debug Info:</strong>
                <ul style="margin: 8px 0 0 0; padding-left: 20px; color: var(--text-secondary, #666);">
                    <li>Barcodes searched: ${diag.barcodes_searched?.length || 0}</li>
                    <li>Found in BackOffice: ${diag.backoffice_found || 0}</li>
                    <li>Inventory queried: ${diag.inventory_queried ? "Yes" : "No"}</li>
                    <li>Found in Inventory: ${diag.inventory_found || 0}</li>
                </ul>
                ${
                  missingBarcodes
                    ? `
                <button class="btn btn-secondary btn-small" style="margin-top: 8px;"
                    onclick="debugProductLookup('${missingBarcodes}')">
                    🔬 Test Product Lookup
                </button>
                `
                    : ""
                }
            </div>
        `;
    }
  }

  content.innerHTML = html;

  // Show/hide account selection section
  const accountSection = document.getElementById("accountSelectionSection");
  if (
    validation.valid &&
    validation.missing.length === 0 &&
    state.currentTransferOrder
  ) {
    accountSection.style.display = "block";
    initializeAccountSearch();
  } else {
    accountSection.style.display = "none";
  }

  // Show/hide proceed button based on validation AND transfer state
  const proceedBtn = document.getElementById("proceedTransfer");
  // Only show "Continue Transfer" if validation passed AND this is a transfer flow
  if (
    validation.valid &&
    validation.missing.length === 0 &&
    state.currentTransferOrder
  ) {
    proceedBtn.style.display = "inline-flex";
  } else {
    proceedBtn.style.display = "none";
  }

  modal.classList.add("active");
}

function closeValidationModal() {
  document.getElementById("validationModal").classList.remove("active");
  clearAccountSelection();
  document.getElementById("accountSelectionSection").style.display = "none";
}

async function proceedWithTransfer() {
  if (!state.currentTransferOrder) return;

  const { orderId, orderName } = state.currentTransferOrder;

  // Save selected account BEFORE closing modal (which clears it)
  const selectedAccount = state.selectedCustomerAccount;

  // Close validation modal
  closeValidationModal();

  // Show toast with loading state
  showToast("Transferring order...", "info");

  try {
    // Build request payload
    const payload = {
      store_id: state.selectedStore,
      order_ids: [orderId],
    };

    // Add custom customer if selected
    if (selectedAccount) {
      payload.custom_customers = {
        [orderId]: selectedAccount.customer_id,
      };
    }

    const response = await fetch("/api/orders/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.success && data.results.length > 0) {
      const result = data.results[0];

      if (result.success) {
        showToast(
          `Order ${orderName} → Quotation #${result.quotation_number}`,
          "success",
        );
        // Update the order row status without reloading
        updateOrderRowStatus(orderId, true);
      } else {
        showToast(`Transfer failed: ${result.error}`, "error");
      }
    } else {
      throw new Error(data.error || "Transfer failed");
    }
  } catch (error) {
    console.error("Transfer error:", error);
    showToast("Transfer failed: " + error.message, "error");
  }

  // Clear current transfer state
  state.currentTransferOrder = null;
}

// ============================================================================
// ACCOUNT AUTOCOMPLETE
// ============================================================================

function initializeAccountSearch() {
  const input = document.getElementById("accountSearch");
  const dropdown = document.getElementById("accountDropdown");
  const clearBtn = document.getElementById("clearAccountBtn");

  let searchTimeout;

  // Remove any existing event listeners by cloning and replacing
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);

  const newClearBtn = clearBtn.cloneNode(true);
  clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);

  // Add input event listener
  newInput.addEventListener("input", (e) => {
    const query = e.target.value.trim();

    clearTimeout(searchTimeout);

    if (query.length < 2) {
      dropdown.style.display = "none";
      return;
    }

    // Debounce: wait 150ms after user stops typing (faster response)
    searchTimeout = setTimeout(() => {
      searchAccounts(query);
    }, 150);
  });

  // Add clear button event listener
  newClearBtn.addEventListener("click", () => {
    clearAccountSelection();
  });

  // Hide dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrapper")) {
      dropdown.style.display = "none";
    }
  });
}

async function searchAccounts(query) {
  const dropdown = document.getElementById("accountDropdown");

  try {
    const response = await fetch(
      `/api/customers/search?query=${encodeURIComponent(query)}&store_id=${state.selectedStore}`,
    );
    const data = await response.json();

    if (data.success && data.customers.length > 0) {
      renderAccountDropdown(data.customers);
    } else {
      dropdown.innerHTML =
        '<div class="autocomplete-item">No accounts found</div>';
      dropdown.style.display = "block";
    }
  } catch (error) {
    console.error("Account search error:", error);
    dropdown.innerHTML = '<div class="autocomplete-item">Search failed</div>';
    dropdown.style.display = "block";
  }
}

function renderAccountDropdown(customers) {
  const dropdown = document.getElementById("accountDropdown");

  dropdown.innerHTML = customers
    .map(
      (c) => `
        <div class="autocomplete-item" data-customer-id="${c.CustomerID}" data-account-no="${c.AccountNo}" data-business-name="${c.BusinessName}">
            <strong>${c.AccountNo}</strong> - ${c.BusinessName}
        </div>
    `,
    )
    .join("");

  dropdown.style.display = "block";

  // Add click handlers
  dropdown.querySelectorAll(".autocomplete-item").forEach((item) => {
    item.addEventListener("click", () => {
      if (item.dataset.customerId) {
        selectAccount({
          customer_id: parseInt(item.dataset.customerId),
          account_no: item.dataset.accountNo,
          business_name: item.dataset.businessName,
        });
      }
    });
  });
}

function selectAccount(account) {
  state.selectedCustomerAccount = account;

  document.getElementById("accountSearch").value = account.account_no;
  document.getElementById("accountDropdown").style.display = "none";
  document.getElementById("clearAccountBtn").style.display = "block";
  document.getElementById("selectedAccount").style.display = "block";
  document.getElementById("selectedAccountText").textContent =
    `${account.account_no} - ${account.business_name}`;
}

function clearAccountSelection() {
  state.selectedCustomerAccount = null;
  document.getElementById("accountSearch").value = "";
  document.getElementById("clearAccountBtn").style.display = "none";
  document.getElementById("selectedAccount").style.display = "none";
  document.getElementById("accountDropdown").style.display = "none";
}

// ============================================================================
// TRANSFER WORKFLOW
// ============================================================================

function updateOrderRowStatus(orderId, transferred) {
  // Find the row for this order
  const rows = document.querySelectorAll("#ordersTableBody tr");
  rows.forEach((row) => {
    const checkbox = row.querySelector(".order-checkbox");
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
    const response = await fetch("/api/orders/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_id: state.selectedStore,
        order_id: orderId,
      }),
    });

    const data = await response.json();

    if (data.success) {
      state.validatedOrders.set(orderId, data.validation);
      showValidationModal(data.validation, data.order_name);
    } else {
      closeValidationModal();
      throw new Error(data.error || "Validation failed");
    }
  } catch (error) {
    console.error("Validation error:", error);
    showToast("Validation failed: " + error.message, "error");
  }
}

async function initiateTransfer() {
  if (state.selectedOrders.size === 0) return;

  // Show confirmation modal
  document.getElementById("confirmCount").textContent =
    state.selectedOrders.size;
  document.getElementById("confirmModal").classList.add("active");
}

function closeConfirmModal() {
  document.getElementById("confirmModal").classList.remove("active");
}

async function confirmTransfer() {
  closeConfirmModal();

  if (state.selectedOrders.size === 0) return;

  const orderIds = Array.from(state.selectedOrders);
  showLoading();

  try {
    const response = await fetch("/api/orders/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_id: state.selectedStore,
        order_ids: orderIds,
      }),
    });

    const data = await response.json();

    if (data.success) {
      const { success, failed } = data.summary;

      if (success > 0) {
        showToast(
          `Successfully transferred ${success} order${success > 1 ? "s" : ""}!`,
          "success",
        );
      }

      if (failed > 0) {
        showToast(
          `${failed} order${failed > 1 ? "s" : ""} failed to transfer. Check History for details.`,
          "error",
        );
      }

      // Show detailed results and update order rows
      data.results.forEach((result) => {
        if (result.success) {
          showToast(
            `Order ${result.order_name} → Quotation #${result.quotation_number}`,
            "success",
          );
          // Update the order row status without reloading
          updateOrderRowStatus(result.order_id, true);
        } else {
          showToast(
            `Order ${result.order_name || result.order_id}: ${result.error}`,
            "error",
          );
        }
      });

      // Clear selection (no reload needed)
      clearSelection();
    } else {
      throw new Error(data.error || "Transfer failed");
    }
  } catch (error) {
    console.error("Transfer error:", error);
    showToast("Transfer failed: " + error.message, "error");
  }

  hideLoading();
}

// ============================================================================
// DEBUG FUNCTIONS
// ============================================================================

async function debugProductLookup(barcodesCsv) {
  if (!barcodesCsv) {
    showToast("No barcodes to test", "warning");
    return;
  }

  showToast("Testing product lookup...", "info");

  try {
    const response = await fetch("/api/debug/product-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcodes: barcodesCsv.split(",") }),
    });
    const data = await response.json();

    console.log("=== Product Lookup Debug Results ===");
    console.log("Input barcodes:", data.input_barcodes);
    console.log("BackOffice:", data.backoffice);
    console.log("Inventory:", data.inventory);
    console.log("=====================================");

    if (data.success) {
      const bo = data.backoffice;
      const inv = data.inventory;

      let msg = `PRODUCT LOOKUP RESULTS\n\n`;
      msg += `BackOffice (${bo.host}/${bo.database}):\n`;
      msg += `  Found: ${bo.found_count} / ${data.input_barcodes.length}\n`;
      if (bo.not_found.length > 0) {
        msg += `  Not found: ${bo.not_found.join(", ")}\n`;
      }
      msg += `\nInventory (${inv.host}/${inv.database}):\n`;
      msg += `  Found: ${inv.found_count} / ${data.input_barcodes.length}\n`;
      if (inv.not_found.length > 0) {
        msg += `  Not found: ${inv.not_found.join(", ")}\n`;
      }
      msg += `\n(Full details in browser console - press F12)`;

      alert(msg);

      if (inv.found_count > 0) {
        showToast(
          `Found ${inv.found_count} in Inventory - copy should work!`,
          "success",
        );
      } else {
        showToast(
          `Products not found in Inventory - check barcode format`,
          "warning",
        );
      }
    } else {
      showToast("Debug failed: " + data.error, "error");
      alert("Debug lookup failed:\n\n" + data.error);
    }
  } catch (error) {
    console.error("Debug lookup error:", error);
    showToast("Debug error: " + error.message, "error");
  }
}

// Make debug function globally accessible for onclick
window.debugProductLookup = debugProductLookup;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showLoading() {
  elements.loadingState.style.display = "block";
  elements.ordersContainer.style.display = "none";
  elements.emptyState.style.display = "none";
}

function hideLoading() {
  elements.loadingState.style.display = "none";
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  toast.innerHTML = `
        <div class="toast-icon"></div>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
    `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}
