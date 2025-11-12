// Global state
let allRecords = [];
let currentEditId = null;
let productSearchTimeout = null;
let binSearchTimeout = null;
let toolbarBinSearchTimeout = null;
let autocompleteHighlightedIndex = -1;
let autocompleteItems = [];

// Initialize app on page load
document.addEventListener("DOMContentLoaded", () => {
  loadBinLocations();
  setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
  document
    .getElementById("refreshBtn")
    .addEventListener("click", loadBinLocations);
  document.getElementById("addNewBtn").addEventListener("click", openAddModal);
  document.getElementById("exportBtn").addEventListener("click", exportToExcel);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);

  // Setup toolbar bin search with autocomplete
  const toolbarBinSearch = document.getElementById("binSearch");
  toolbarBinSearch.addEventListener("input", handleToolbarBinSearch);
  toolbarBinSearch.addEventListener("focus", handleToolbarBinSearch);

  // Setup product and UPC search inputs (no autocomplete)
  document
    .getElementById("productSearch")
    .addEventListener("input", handleSearch);
  document.getElementById("upcSearch").addEventListener("input", handleSearch);

  // Dark mode toggle
  document.getElementById("themeToggle").addEventListener("click", () => {
    themeManager.toggle();
  });

  // Setup 3 clear buttons
  document.getElementById("binClear").addEventListener("click", () => {
    clearSearchField("binSearch");
  });
  document.getElementById("productClear").addEventListener("click", () => {
    clearSearchField("productSearch");
  });
  document.getElementById("upcClear").addEventListener("click", () => {
    clearSearchField("upcSearch");
  });

  // Clear all filters
  document
    .getElementById("clearAllFiltersBtn")
    .addEventListener("click", clearAllFilters);

  // Bin location search autocomplete (modal)
  const binLocationSearch = document.getElementById("modalBinLocationSearch");
  binLocationSearch.addEventListener("input", handleBinLocationSearch);
  binLocationSearch.addEventListener("focus", handleBinLocationSearch);
  binLocationSearch.addEventListener("keydown", handleAutocompleteKeydown);

  // Product search autocomplete (modal)
  const productSearch = document.getElementById("modalProductSearch");
  productSearch.addEventListener("input", handleProductSearch);
  productSearch.addEventListener("focus", handleProductSearch);
  productSearch.addEventListener("keydown", handleAutocompleteKeydown);

  // Search field selector dropdown - trigger new search when changed
  const searchFieldSelector = document.getElementById("modalSearchField");
  searchFieldSelector.addEventListener("change", () => {
    const query = productSearch.value.trim();
    if (query.length >= 2 || query === "%") {
      // Clear dropdown first
      document.getElementById("modalProductDropdown").classList.remove("active");
      // Trigger new search with current query
      handleProductSearch({ target: productSearch });
    }
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrapper")) {
      document.getElementById("modalProductDropdown").classList.remove("active");
      document.getElementById("modalBinLocationDropdown").classList.remove("active");
      document.getElementById("binDropdown").classList.remove("active");
    }
  });

  // Modal close on overlay click - DISABLED for recordModal to prevent accidental closes
  // document.getElementById("recordModal").addEventListener("click", (e) => {
  //   if (e.target.id === "recordModal") {
  //     closeModal();
  //   }
  // });

  document.getElementById("adjustModal").addEventListener("click", (e) => {
    if (e.target.id === "adjustModal") {
      closeAdjustModal();
    }
  });

  document.getElementById("deleteModal").addEventListener("click", (e) => {
    if (e.target.id === "deleteModal") {
      closeDeleteModal();
    }
  });

  // Form submit handlers
  document.getElementById("recordForm").addEventListener("submit", (e) => {
    e.preventDefault();
    saveRecord();
  });

  document.getElementById("adjustForm").addEventListener("submit", (e) => {
    e.preventDefault();
    saveAdjustment();
  });

  // Register keyboard shortcuts
  registerKeyboardShortcuts();
}

// Load bin locations data
async function loadBinLocations() {
  showLoading();
  try {
    const response = await fetch("/api/bin-locations");
    if (handleAuthError(response)) return;
    const result = await response.json();

    if (result.success) {
      allRecords = result.data || [];
      renderTable(allRecords);
    } else {
      if (result.needs_config) {
        showToast(
          "Please configure database connection in Settings",
          "warning",
        );
        setTimeout(() => {
          window.location.href = "/settings";
        }, 2000);
      } else {
        showToast(result.message || "Failed to load data", "error");
      }
      allRecords = [];
      renderTable([]);
    }
  } catch (error) {
    showToast("Error connecting to server: " + error.message, "error");
    allRecords = [];
    renderTable([]);
  } finally {
    hideLoading();
  }
}

// Render table
function renderTable(records) {
  const tbody = document.getElementById("tableBody");
  const emptyState = document.getElementById("emptyState");
  const tableContainer = document.querySelector(".table-container");
  const topSummary = document.getElementById("topSummary");
  const tableFoot = document.getElementById("tableFoot");
  const binTable = document.getElementById("binLocationsTable");

  if (records.length === 0) {
    tbody.innerHTML = "";
    tableContainer.style.display = "none";
    emptyState.style.display = "block";
    topSummary.style.display = "none";
    tableFoot.style.display = "none";
    return;
  }

  // Restore table if it was replaced by card grid
  if (!document.getElementById("binLocationsTable")) {
    tableContainer.innerHTML = `
            <table id="binLocationsTable">
                <thead>
                    <tr>
                        <th>Bin Location</th>
                        <th>Product Name</th>
                        <th>Case Quantity</th>
                        <th>Qty per Case</th>
                        <th>Total Quantity</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="tableBody">
                    <!-- Data will be populated by JavaScript -->
                </tbody>
                <tfoot id="tableFoot" style="display: none;">
                    <tr class="totals-row">
                        <td colspan="2" style="text-align: right;"><strong>Totals:</strong></td>
                        <td><strong id="footTotalCases">0</strong></td>
                        <td></td>
                        <td><strong id="footTotalItems">0</strong></td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        `;
  }

  tableContainer.style.display = "block";
  emptyState.style.display = "none";
  topSummary.style.display = "flex";

  // Re-get tbody reference after potential DOM recreation
  const newTbody = document.getElementById("tableBody");
  const newTableFoot = document.getElementById("tableFoot");
  newTableFoot.style.display = "table-footer-group";

  // Calculate totals
  let totalCases = 0;
  let totalItems = 0;

  records.forEach((record) => {
    totalCases += record.Qty_Cases || 0;
    totalItems += record.TotalQuantity || 0;
  });

  // Update top summary
  document.getElementById("topTotalCases").textContent =
    totalCases.toLocaleString();
  document.getElementById("topTotalItems").textContent =
    totalItems.toLocaleString();
  document.getElementById("topRecordCount").textContent =
    records.length.toLocaleString();

  // Update footer totals
  document.getElementById("footTotalCases").textContent =
    totalCases.toLocaleString();
  document.getElementById("footTotalItems").textContent =
    totalItems.toLocaleString();

  newTbody.innerHTML = records
    .map((record) => {
      const binLocation = record.BinLocation || "N/A";
      const productName = record.ProductDescription || "N/A";
      const caseQty = record.Qty_Cases || 0;
      const qtyPerCase = record.UnitQty2 || 0;
      const totalQty = record.TotalQuantity || 0;

      // Display qty per case with indicator if not set
      const qtyPerCaseDisplay =
        qtyPerCase > 0
          ? qtyPerCase
          : '<span style="color: var(--text-secondary);">Not Set</span>';

      // Display total quantity
      const totalQtyDisplay =
        qtyPerCase > 0
          ? totalQty.toLocaleString()
          : '<span style="color: var(--text-secondary);">—</span>';

      return `
            <tr>
                <td><strong>${escapeHtml(binLocation)}</strong></td>
                <td>${escapeHtml(productName)}</td>
                <td>${caseQty.toLocaleString()}</td>
                <td>${qtyPerCaseDisplay}</td>
                <td>${totalQtyDisplay}</td>
                <td>
                    <div class="table-actions">
                        <button class="btn btn-secondary btn-small" onclick="openEditModal(${record.id})" title="Edit">
                            Edit
                        </button>
                        <button class="btn btn-primary btn-small" onclick="openAdjustModal(${record.id})" title="Adjust Case Quantity (Add or Remove)">
                            Adjust
                        </button>
                        <button class="btn btn-error btn-small" onclick="openDeleteModal(${record.id})" title="Delete Record">
                            Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    })
    .join("");
}

// Handle search/filter with 3 separate fields (AND logic)
function handleSearch() {
  const binTerm = document.getElementById("binSearch").value.trim();
  const productTerm = document.getElementById("productSearch").value.trim();
  const upcTerm = document.getElementById("upcSearch").value.trim();

  // Update active filters display
  updateActiveFilters({ bin: binTerm, product: productTerm, upc: upcTerm });

  // If all empty, show all records
  if (!binTerm && !productTerm && !upcTerm) {
    renderTable(allRecords);
    return;
  }

  // AND logic: all filled fields must match
  const filtered = allRecords.filter((record) => {
    let matches = true;

    // 1. Bin Location - smart matching (prefix if no numbers, exact if has numbers)
    if (binTerm) {
      const binLocation = (record.BinLocation || "").toLowerCase();
      const binSearchLower = binTerm.toLowerCase();

      // Check if search term contains any digit
      const hasNumber = /\d/.test(binSearchLower);

      if (hasNumber) {
        // Exact match when search contains numbers
        matches = matches && binLocation === binSearchLower;
      } else {
        // Prefix match when search has no numbers
        matches = matches && binLocation.startsWith(binSearchLower);
      }
    }

    // 2. Product Description - wildcard support
    if (productTerm && matches) {
      const productName = (record.ProductDescription || "").toLowerCase();
      if (productTerm.includes("%")) {
        matches =
          matches && matchesWildcard(productName, productTerm.toLowerCase());
      } else {
        matches = matches && productName.includes(productTerm.toLowerCase());
      }
    }

    // 3. UPC - exact match (case-insensitive)
    if (upcTerm && matches) {
      const upc = (record.ProductUPC || "").toLowerCase();
      const upcSearchLower = upcTerm.toLowerCase();
      matches = matches && upc === upcSearchLower;
    }

    return matches;
  });

  renderTable(filtered);
}

// Wildcard pattern matching helper (converts SQL LIKE pattern to regex)
function matchesWildcard(text, pattern) {
  // If pattern is just %, match everything
  if (pattern === "%") {
    return true;
  }

  // Split pattern by % to get individual terms
  const terms = pattern.split("%").filter((term) => term.length > 0);

  // If no terms (pattern was all %), match everything
  if (terms.length === 0) {
    return true;
  }

  // Build regex pattern - always add .* between ALL terms
  let regexPattern = "";

  // If pattern doesn't start with %, anchor to start
  if (!pattern.startsWith("%")) {
    regexPattern = "^";
  }

  // Add each term with .* between them
  terms.forEach((term, index) => {
    // Escape special regex characters in the term
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regexPattern += escapedTerm;

    // ALWAYS add .* after each term (for "contains" behavior)
    if (index < terms.length - 1) {
      regexPattern += ".*";
    }
  });

  // NEVER add end anchor - allow matching anywhere
  // This makes term1%term2 mean "starts with term1, contains term2 somewhere"
  // not "starts with term1, ends with term2"

  const regex = new RegExp(regexPattern, "i");
  return regex.test(text);
}

// Open add modal
function openAddModal() {
  currentEditId = null;
  document.getElementById("modalTitle").textContent = "Add New Record";
  document.getElementById("recordForm").reset();
  document.getElementById("recordId").value = "";
  document.getElementById("modalBinLocationId").value = "";
  document.getElementById("modalProductUPC").value = "";
  document.getElementById("modalProductDescription").value = "";
  document.getElementById("modalProductDropdown").classList.remove("active");
  document.getElementById("modalBinLocationDropdown").classList.remove("active");
  document.getElementById("recordModal").classList.add("active");
}

// Open edit modal
async function openEditModal(recordId) {
  const record = allRecords.find((r) => r.id === recordId);
  if (!record) {
    showToast("Record not found", "error");
    return;
  }

  currentEditId = recordId;
  document.getElementById("modalTitle").textContent = "Edit Record";
  document.getElementById("recordId").value = recordId;
  document.getElementById("modalBinLocationSearch").value = record.BinLocation || "";
  document.getElementById("modalBinLocationId").value = record.BinLocationID || "";
  document.getElementById("modalProductSearch").value =
    record.ProductDescription || "";
  document.getElementById("modalProductUPC").value = record.ProductUPC || "";
  document.getElementById("modalProductDescription").value =
    record.ProductDescription || "";
  document.getElementById("qtyPerCase").value = record.UnitQty2 || "";
  document.getElementById("caseQuantity").value = record.Qty_Cases || 0;
  document.getElementById("recordModal").classList.add("active");
}

// Close modal
function closeModal() {
  document.getElementById("recordModal").classList.remove("active");
  document.getElementById("recordForm").reset();
  document.getElementById("modalProductDropdown").classList.remove("active");
  document.getElementById("modalBinLocationDropdown").classList.remove("active");
  currentEditId = null;
}

// Save record (create or update)
async function saveRecord() {
  const binLocationId = document.getElementById("modalBinLocationId").value;
  const productUPC = document.getElementById("modalProductUPC").value;
  const productDescription =
    document.getElementById("modalProductDescription").value;
  const qtyPerCase = document.getElementById("qtyPerCase").value;
  const caseQuantity = document.getElementById("caseQuantity").value;

  if (!binLocationId) {
    showToast("Please select a bin location", "error");
    return;
  }

  if (!productUPC) {
    showToast("Please select a product", "error");
    return;
  }

  if (!caseQuantity) {
    showToast("Please enter case quantity", "error");
    return;
  }

  const data = {
    bin_location_id: parseInt(binLocationId),
    product_upc: productUPC,
    product_description: productDescription,
    qty_per_case: qtyPerCase ? parseFloat(qtyPerCase) : null,
    qty_cases: parseInt(caseQuantity),
  };

  showLoading();

  try {
    const url = currentEditId
      ? `/api/bin-locations/${currentEditId}`
      : "/api/bin-locations";
    const method = currentEditId ? "PUT" : "POST";

    const response = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (result.success) {
      showToast(result.message, "success");
      closeModal();
      await loadBinLocations();
    } else {
      showToast(result.message || "Failed to save record", "error");
    }
  } catch (error) {
    showToast("Error saving record: " + error.message, "error");
  } finally {
    hideLoading();
  }
}

// Handle bin location search
async function handleBinLocationSearch(e) {
  const query = e.target.value.trim();

  clearTimeout(binSearchTimeout);

  // Require at least 1 character (including % wildcard)
  if (query.length < 1) {
    document.getElementById("modalBinLocationDropdown").classList.remove("active");
    return;
  }

  binSearchTimeout = setTimeout(async () => {
    try {
      const response = await fetch(
        `/api/bins/search?q=${encodeURIComponent(query)}`,
      );
      if (handleAuthError(response)) return;
      const result = await response.json();

      if (result.success) {
        displayBinLocationResults(result.data || []);
      }
    } catch (error) {
      console.error("Error searching bin locations:", error);
    }
  }, 200);
}

// Display bin location search results
function displayBinLocationResults(bins) {
  const dropdown = document.getElementById("modalBinLocationDropdown");
  autocompleteHighlightedIndex = -1; // Reset highlight

  if (bins.length === 0) {
    dropdown.innerHTML =
      '<div class="autocomplete-item">No bin locations found</div>';
    dropdown.classList.add("active");
    return;
  }

  dropdown.innerHTML = bins
    .map((bin) => {
      const binName = bin.BinLocation || "Unnamed Bin";
      const binId = bin.BinLocationID;

      return `
            <div class="autocomplete-item bin-location-item" data-bin-id="${binId}" data-bin-name="${escapeHtml(binName)}">
                <div>${escapeHtml(binName)}</div>
            </div>
        `;
    })
    .join("");

  dropdown.classList.add("active");

  // Attach event listeners to all bin location items
  dropdown.querySelectorAll(".bin-location-item").forEach((item) => {
    item.addEventListener("click", function () {
      const binId = this.dataset.binId;
      const binName = this.dataset.binName;
      selectBinLocation(binId, binName);
    });
  });
}

// Select bin location from dropdown
function selectBinLocation(binId, binName) {
  document.getElementById("modalBinLocationSearch").value = binName;
  document.getElementById("modalBinLocationId").value = binId;
  document.getElementById("modalBinLocationDropdown").classList.remove("active");
}

// Handle toolbar bin search with autocomplete
async function handleToolbarBinSearch(e) {
  const query = e.target.value.trim();

  clearTimeout(toolbarBinSearchTimeout);

  // Require at least 1 character
  if (query.length < 1) {
    document.getElementById("binDropdown").classList.remove("active");
    // Trigger filter update for empty query
    handleSearch(e);
    return;
  }

  toolbarBinSearchTimeout = setTimeout(async () => {
    try {
      const response = await fetch(
        `/api/bins/search?q=${encodeURIComponent(query)}`,
      );
      if (handleAuthError(response)) return;
      const result = await response.json();

      if (result.success) {
        displayToolbarBinResults(result.data || [], query);
      }
    } catch (error) {
      console.error("Error searching bin locations:", error);
    }
  }, 200);

  // Also trigger the filter update
  handleSearch(e);
}

// Display toolbar bin search results with smart filtering
function displayToolbarBinResults(bins, query) {
  const dropdown = document.getElementById("binDropdown");

  const queryLower = query.toLowerCase();
  const hasNumber = /\d/.test(queryLower);

  // Filter results based on whether query contains numbers
  const filteredBins = bins.filter((bin) => {
    const binName = (bin.BinLocation || "").toLowerCase();
    if (hasNumber) {
      // Exact match when query contains numbers
      return binName === queryLower;
    } else {
      // Prefix match when query has no numbers
      return binName.startsWith(queryLower);
    }
  });

  if (filteredBins.length === 0) {
    dropdown.innerHTML =
      '<div class="autocomplete-item">No matching bin locations</div>';
    dropdown.classList.add("active");
    return;
  }

  dropdown.innerHTML = filteredBins
    .map((bin) => {
      const binName = bin.BinLocation || "Unnamed Bin";
      return `
            <div class="autocomplete-item toolbar-bin-item" data-bin-name="${escapeHtml(binName)}">
                <div>${escapeHtml(binName)}</div>
            </div>
        `;
    })
    .join("");

  dropdown.classList.add("active");

  // Attach event listeners to all bin items
  dropdown.querySelectorAll(".toolbar-bin-item").forEach((item) => {
    item.addEventListener("click", function () {
      const binName = this.dataset.binName;
      selectToolbarBin(binName);
    });
  });
}

// Select bin from toolbar dropdown and apply filter immediately
function selectToolbarBin(binName) {
  const binSearchInput = document.getElementById("binSearch");
  binSearchInput.value = binName;
  document.getElementById("binDropdown").classList.remove("active");

  // Immediately apply the filter
  applyFilters();
}

// Handle product search
async function handleProductSearch(e) {
  const query = e.target.value.trim();

  clearTimeout(productSearchTimeout);

  // Allow single % wildcard, otherwise require 2+ characters
  if (query.length < 2 && query !== "%") {
    document.getElementById("modalProductDropdown").classList.remove("active");
    return;
  }

  productSearchTimeout = setTimeout(async () => {
    try {
      const searchField = document.getElementById("modalSearchField").value;
      const response = await fetch(
        `/api/products/search?q=${encodeURIComponent(query)}&field=${encodeURIComponent(searchField)}`,
      );
      const result = await response.json();

      if (result.success) {
        displayProductResults(result.data || []);
      }
    } catch (error) {
      console.error("Error searching products:", error);
    }
  }, 300);
}

// Display product search results
function displayProductResults(products) {
  const dropdown = document.getElementById("modalProductDropdown");
  autocompleteHighlightedIndex = -1; // Reset highlight

  if (products.length === 0) {
    dropdown.innerHTML =
      '<div class="autocomplete-item">No products found</div>';
    dropdown.classList.add("active");
    return;
  }

  dropdown.innerHTML = products
    .map((product) => {
      const upc = product.ProductUPC || "N/A";
      const sku = product.ProductSKU || "N/A";
      const description = product.ProductDescription || "Unnamed Product";
      const qtyPerCase = product.UnitQty2 || 0;

      return `
            <div class="autocomplete-item product-item" data-upc="${escapeHtml(upc)}" data-sku="${escapeHtml(sku)}" data-description="${escapeHtml(description)}" data-qty-per-case="${qtyPerCase}">
                <div><strong>${escapeHtml(description)}</strong></div>
                <small>UPC: ${escapeHtml(upc)} | SKU: ${escapeHtml(sku)} | Qty per Case: ${qtyPerCase > 0 ? qtyPerCase : "Not Set"}</small>
            </div>
        `;
    })
    .join("");

  dropdown.classList.add("active");

  // Attach event listeners to all product items
  dropdown.querySelectorAll(".product-item").forEach((item) => {
    item.addEventListener("click", function () {
      const upc = this.dataset.upc;
      const description = this.dataset.description;
      const qtyPerCase = parseFloat(this.dataset.qtyPerCase) || 0;
      selectProduct(upc, description, qtyPerCase);
    });
  });
}

// Select product from dropdown
function selectProduct(upc, description, qtyPerCase) {
  document.getElementById("modalProductSearch").value = description;
  document.getElementById("modalProductUPC").value = upc;
  document.getElementById("modalProductDescription").value = description;
  document.getElementById("qtyPerCase").value = qtyPerCase || "";
  document.getElementById("modalProductDropdown").classList.remove("active");
}

// Open adjust modal
function openAdjustModal(recordId) {
  const record = allRecords.find((r) => r.id === recordId);
  if (!record) {
    showToast("Record not found", "error");
    return;
  }

  document.getElementById("adjustRecordId").value = recordId;
  document.getElementById("currentQuantity").value = record.Qty_Cases || 0;
  document.getElementById("adjustAmount").value = "";
  document.getElementById("adjustNotes").value = "";
  document.getElementById("notesCharCount").textContent = "0";
  document.getElementById("adjustModalTitle").textContent =
    "Adjust Case Quantity";

  // Add character counter listener
  const notesField = document.getElementById("adjustNotes");
  notesField.addEventListener("input", () => {
    document.getElementById("notesCharCount").textContent =
      notesField.value.length;
  });

  document.getElementById("adjustModal").classList.add("active");
}

// Close adjust modal
function closeAdjustModal() {
  document.getElementById("adjustModal").classList.remove("active");
  document.getElementById("adjustForm").reset();
  document.getElementById("notesCharCount").textContent = "0";
}

// Save adjustment
async function saveAdjustment() {
  const recordId = document.getElementById("adjustRecordId").value;
  const adjustment = parseInt(document.getElementById("adjustAmount").value);
  const notes = document.getElementById("adjustNotes").value.trim();

  if (!adjustment || adjustment === 0) {
    showToast("Please enter a valid adjustment amount", "error");
    return;
  }

  showLoading();

  try {
    const response = await fetch(`/api/bin-locations/${recordId}/adjust`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adjustment: adjustment,
        notes: notes || null,
      }),
    });

    if (handleAuthError(response)) return;
    const result = await response.json();

    if (result.success) {
      showToast(result.message, "success");
      closeAdjustModal();
      await loadBinLocations();
    } else {
      showToast(result.message || "Failed to adjust quantity", "error");
    }
  } catch (error) {
    showToast("Error adjusting quantity: " + error.message, "error");
  } finally {
    hideLoading();
  }
}

// Open delete confirmation modal
function openDeleteModal(recordId) {
  const record = allRecords.find((r) => r.id === recordId);
  if (!record) {
    showToast("Record not found", "error");
    return;
  }

  document.getElementById("deleteRecordId").value = recordId;
  document.getElementById("deleteBinLocation").textContent =
    record.BinLocation || "N/A";
  document.getElementById("deleteProductName").textContent =
    record.ProductDescription || "N/A";
  document.getElementById("deleteCaseQty").textContent = (
    record.Qty_Cases || 0
  ).toLocaleString();

  document.getElementById("deleteModal").classList.add("active");
}

// Close delete modal
function closeDeleteModal() {
  document.getElementById("deleteModal").classList.remove("active");
}

// Confirm delete
async function confirmDelete() {
  const recordId = document.getElementById("deleteRecordId").value;

  if (!recordId) {
    showToast("No record selected", "error");
    return;
  }

  showLoading();

  try {
    const response = await fetch(`/api/bin-locations/${recordId}`, {
      method: "DELETE",
    });

    const result = await response.json();

    if (result.success) {
      showToast(result.message, "success");
      closeDeleteModal();
      await loadBinLocations();
    } else {
      showToast(result.message || "Failed to delete record", "error");
    }
  } catch (error) {
    showToast("Error deleting record: " + error.message, "error");
  } finally {
    hideLoading();
  }
}

// Utility functions
function showLoading() {
  document.getElementById("loadingOverlay").style.display = "flex";
}

function hideLoading() {
  document.getElementById("loadingOverlay").style.display = "none";
}

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  toast.innerHTML = `
        <div class="toast-message">${escapeHtml(message)}</div>
    `;

  container.appendChild(toast);

  // Start fade out after 4.5 seconds, then remove after animation completes
  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => {
      toast.remove();
    }, 300); // Match fadeOut animation duration
  }, 4500);
}

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================================
// ACTIVE FILTERS DISPLAY - 2025 PROFESSIONAL DESIGN
// ============================================================================

function updateActiveFilters(filters) {
  const activeFiltersBar = document.getElementById("activeFiltersBar");
  const activeFiltersList = document.getElementById("activeFiltersList");

  const activeFilters = [];

  if (filters.bin) {
    activeFilters.push({ label: "Bin", value: filters.bin, field: "binSearch" });
  }
  if (filters.product) {
    activeFilters.push({
      label: "Product",
      value: filters.product,
      field: "productSearch",
    });
  }
  if (filters.upc) {
    activeFilters.push({ label: "UPC", value: filters.upc, field: "upcSearch" });
  }

  if (activeFilters.length === 0) {
    activeFiltersBar.style.display = "none";
    return;
  }

  activeFiltersBar.style.display = "flex";
  activeFiltersList.innerHTML = activeFilters
    .map(
      (filter) => `
    <div class="filter-badge">
      <span class="filter-badge-label">${escapeHtml(filter.label)}:</span>
      <span class="filter-badge-value">${escapeHtml(filter.value.toString())}</span>
      <button class="filter-badge-remove" onclick="removeFilter('${filter.field}')" aria-label="Remove ${filter.label} filter">×</button>
    </div>
  `
    )
    .join("");
}

function removeFilter(fieldId) {
  const element = document.getElementById(fieldId);
  if (element) {
    element.value = "";
    // Re-run search
    handleSearch();
  }
}

function clearAllFilters() {
  // Clear search fields
  document.getElementById("binSearch").value = "";
  document.getElementById("productSearch").value = "";
  document.getElementById("upcSearch").value = "";

  // Close bin dropdown
  document.getElementById("binDropdown").classList.remove("active");

  // Re-run search to show all records
  handleSearch();

  showToast("All filters cleared", "info");
}

// Card view removed - table-only interface for warehouse efficiency

// ============================================================================
// Search Functions
// ============================================================================

function clearSearchField(fieldId) {
  const field = document.getElementById(fieldId);
  field.value = "";

  // Close bin dropdown if clearing bin search
  if (fieldId === "binSearch") {
    document.getElementById("binDropdown").classList.remove("active");
  }

  field.focus();
  handleSearch();
}

// ============================================================================
// Autocomplete Keyboard Navigation
// ============================================================================

function handleAutocompleteKeydown(event) {
  const dropdown = event.target.nextElementSibling;
  if (!dropdown || !dropdown.classList.contains("active")) return;

  const items = dropdown.querySelectorAll(".autocomplete-item");
  if (items.length === 0) return;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      autocompleteHighlightedIndex = Math.min(
        autocompleteHighlightedIndex + 1,
        items.length - 1,
      );
      updateAutocompleteHighlight(items);
      break;

    case "ArrowUp":
      event.preventDefault();
      autocompleteHighlightedIndex = Math.max(
        autocompleteHighlightedIndex - 1,
        0,
      );
      updateAutocompleteHighlight(items);
      break;

    case "Enter":
      event.preventDefault();
      if (
        autocompleteHighlightedIndex >= 0 &&
        autocompleteHighlightedIndex < items.length
      ) {
        items[autocompleteHighlightedIndex].click();
      }
      break;

    case "Escape":
      event.preventDefault();
      dropdown.classList.remove("active");
      autocompleteHighlightedIndex = -1;
      break;

    case "Tab":
      // Select highlighted item and move to next field
      if (
        autocompleteHighlightedIndex >= 0 &&
        autocompleteHighlightedIndex < items.length
      ) {
        event.preventDefault();
        items[autocompleteHighlightedIndex].click();
      }
      break;
  }
}

function updateAutocompleteHighlight(items) {
  items.forEach((item, index) => {
    if (index === autocompleteHighlightedIndex) {
      item.classList.add("highlighted");
      item.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      item.classList.remove("highlighted");
    }
  });
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

function registerKeyboardShortcuts() {
  // Ctrl+N - Add new record
  keyboardManager.register(
    "ctrl+n",
    () => {
      openAddModal();
    },
    { description: "Add new record" },
  );

  // Ctrl+R - Refresh data
  keyboardManager.register(
    "ctrl+r",
    () => {
      loadBinLocations();
    },
    { description: "Refresh data" },
  );

  // / - Focus Product Search (industry standard)
  keyboardManager.register(
    "/",
    () => {
      const productSearch = document.getElementById("productSearch");
      productSearch.focus();
      productSearch.select();
    },
    { description: "Focus product search" },
  );

  // Ctrl+, - Open settings
  keyboardManager.register(
    "ctrl+,",
    () => {
      window.location.href = "/settings";
    },
    { description: "Open settings" },
  );

  // Ctrl+H - View history
  keyboardManager.register(
    "ctrl+h",
    () => {
      window.location.href = "/history";
    },
    { description: "View history" },
  );
}

// ============================================================================
// Export Functions
// ============================================================================

async function exportToExcel() {
  showLoading();

  try {
    // Get currently filtered records
    const filteredRecords = getFilteredRecords();

    if (filteredRecords.length === 0) {
      showToast("No records to export", "warning");
      hideLoading();
      return;
    }

    const response = await fetch("/api/export-excel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        records: filteredRecords,
      }),
    });

    if (handleAuthError(response)) {
      hideLoading();
      return;
    }

    if (!response.ok) {
      const result = await response.json();
      showToast(result.message || "Export failed", "error");
      hideLoading();
      return;
    }

    // Download the file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Extract filename from Content-Disposition header or use default
    const contentDisposition = response.headers.get("Content-Disposition");
    let filename = "bin_locations_export.xlsx";
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
      if (filenameMatch) {
        filename = filenameMatch[1];
      }
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    showToast(
      `Exported ${filteredRecords.length} record(s) successfully`,
      "success"
    );
  } catch (error) {
    console.error("Export error:", error);
    showToast("Failed to export records", "error");
  } finally {
    hideLoading();
  }
}

function getFilteredRecords() {
  const binSearchValue = document
    .getElementById("binSearch")
    .value.trim()
    .toLowerCase();
  const productSearchValue = document
    .getElementById("productSearch")
    .value.trim()
    .toLowerCase();
  const upcSearchValue = document
    .getElementById("upcSearch")
    .value.trim()
    .toLowerCase();

  return allRecords.filter((record) => {
    const binLocation = (record.BinLocation || "").toLowerCase();
    const productDescription = (record.ProductDescription || "").toLowerCase();
    const productUPC = (record.ProductUPC || "").toLowerCase();

    // Bin search: exact match (case-insensitive)
    const binMatch =
      !binSearchValue || binLocation === binSearchValue;

    // Product search: contains match with wildcard support
    let productMatch = true;
    if (productSearchValue) {
      if (productSearchValue.includes("%")) {
        // SQL-style wildcard: convert % to regex .*
        const regexPattern = productSearchValue.replace(/%/g, ".*");
        const regex = new RegExp(regexPattern, "i");
        productMatch = regex.test(productDescription);
      } else {
        productMatch = productDescription.includes(productSearchValue);
      }
    }

    // UPC search: exact match (case-insensitive)
    const upcMatch =
      !upcSearchValue || productUPC === upcSearchValue;

    return binMatch && productMatch && upcMatch;
  });
}

// ============================================================================
// Authentication Functions
// ============================================================================

async function handleLogout() {
  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      window.location.href = "/login";
    }
  } catch (error) {
    console.error("Logout error:", error);
    // Redirect anyway
    window.location.href = "/login";
  }
}

function handleAuthError(response) {
  if (response.status === 401) {
    window.location.href = "/login";
    return true;
  }
  return false;
}

// ============================================================================
// Unused Bins Modal
// ============================================================================

async function showUnusedBins() {
  const modal = document.getElementById("unusedBinsModal");
  const content = document.getElementById("unusedBinsContent");
  const title = document.getElementById("unusedBinsTitle");

  // Show modal with loading state
  modal.classList.add("active");
  content.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <div class="spinner"></div>
      <div>Loading unused bins...</div>
    </div>
  `;

  try {
    const response = await fetch("/api/bin-locations/unused");

    if (handleAuthError(response)) return;

    const result = await response.json();

    if (result.success) {
      const bins = result.data;

      if (bins.length === 0) {
        // No unused bins
        title.textContent = "All Bins Are In Use";
        content.innerHTML = `
          <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
            <div style="font-size: 48px; margin-bottom: 16px;">✓</div>
            <div style="font-size: 16px;">All bin locations are currently assigned to inventory.</div>
          </div>
        `;
      } else {
        // Display unused bins in table
        title.textContent = `Unused Bin Locations (${bins.length} found)`;
        content.innerHTML = `
          <table class="data-table">
            <thead>
              <tr>
                <th>Bin Location</th>
              </tr>
            </thead>
            <tbody>
              ${bins
                .map(
                  (bin) => `
                <tr>
                  <td>${bin.BinLocation || "N/A"}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        `;
      }
    } else {
      showToast(result.message || "Failed to load unused bins", "error");
      closeUnusedBinsModal();
    }
  } catch (error) {
    console.error("Error loading unused bins:", error);
    showToast("Error loading unused bins", "error");
    closeUnusedBinsModal();
  }
}

function closeUnusedBinsModal() {
  document.getElementById("unusedBinsModal").classList.remove("active");
}

// Add event listener for show unused bins button
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("showUnusedBinsBtn")
    .addEventListener("click", showUnusedBins);

  // Modal close on overlay click
  document.getElementById("unusedBinsModal").addEventListener("click", (e) => {
    if (e.target.id === "unusedBinsModal") {
      closeUnusedBinsModal();
    }
  });

  // ESC key to close
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      document.getElementById("unusedBinsModal").classList.contains("active")
    ) {
      closeUnusedBinsModal();
    }
  });

  // Close button handler
  const closeButtons = document.querySelectorAll('[data-modal-close]');
  closeButtons.forEach(btn => {
    if (btn.onclick && btn.onclick.toString().includes('closeUnusedBinsModal')) {
      // Already has onclick handler from HTML
    }
  });
});
