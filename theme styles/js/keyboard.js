/**
 * Keyboard Shortcuts Manager
 * Handles global keyboard shortcuts and modal navigation
 */

class KeyboardManager {
  constructor() {
    this.shortcuts = new Map();
    this.modalStack = [];
    this.isEnabled = true;
    this.init();
  }

  /**
   * Initialize keyboard manager
   */
  init() {
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  /**
   * Register a keyboard shortcut
   * @param {string} key - Key combination (e.g., 'ctrl+n', 'esc', '/')
   * @param {function} handler - Function to call when shortcut is triggered
   * @param {object} options - Additional options (description, preventDefault)
   */
  register(key, handler, options = {}) {
    this.shortcuts.set(key.toLowerCase(), {
      handler,
      description: options.description || '',
      preventDefault: options.preventDefault !== false,
    });
  }

  /**
   * Unregister a keyboard shortcut
   * @param {string} key - Key combination to remove
   */
  unregister(key) {
    this.shortcuts.delete(key.toLowerCase());
  }

  /**
   * Handle keydown events
   * @param {KeyboardEvent} event
   */
  handleKeyDown(event) {
    if (!this.isEnabled) return;

    // Build key string from event
    const keyString = this.buildKeyString(event);

    // Check if we have a registered shortcut
    const shortcut = this.shortcuts.get(keyString);

    if (shortcut) {
      // Don't trigger if user is typing in an input/textarea (unless it's ESC)
      if (this.isTypingContext(event.target) && event.key !== 'Escape') {
        return;
      }

      if (shortcut.preventDefault) {
        event.preventDefault();
      }

      shortcut.handler(event);
    }

    // Handle special modal keys
    this.handleModalKeys(event, keyString);
  }

  /**
   * Handle keyup events
   * @param {KeyboardEvent} event
   */
  handleKeyUp(event) {
    // Can be used for future enhancements
  }

  /**
   * Build key string from keyboard event
   * @param {KeyboardEvent} event
   * @returns {string} - e.g., 'ctrl+shift+k'
   */
  buildKeyString(event) {
    const parts = [];

    // Add modifiers (in consistent order)
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');

    // Add the main key
    const key = event.key.toLowerCase();

    // Special key mappings
    const keyMap = {
      'escape': 'esc',
      'arrowup': 'up',
      'arrowdown': 'down',
      'arrowleft': 'left',
      'arrowright': 'right',
      ' ': 'space',
    };

    parts.push(keyMap[key] || key);

    return parts.join('+');
  }

  /**
   * Check if user is typing in an input/textarea
   * @param {HTMLElement} target
   * @returns {boolean}
   */
  isTypingContext(target) {
    return (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    );
  }

  /**
   * Handle modal-specific keyboard events
   * @param {KeyboardEvent} event
   * @param {string} keyString
   */
  handleModalKeys(event, keyString) {
    const activeModal = this.getActiveModal();

    if (!activeModal) return;

    switch (keyString) {
      case 'esc':
        // Close modal on ESC
        event.preventDefault();
        this.closeActiveModal();
        break;

      case 'enter':
        // Submit form on Enter (if not in textarea)
        if (!this.isTextarea(event.target)) {
          event.preventDefault();
          this.submitActiveModal();
        }
        break;

      case 'tab':
        // Trap focus within modal
        this.trapFocus(event, activeModal);
        break;
    }
  }

  /**
   * Check if element is a textarea
   * @param {HTMLElement} element
   * @returns {boolean}
   */
  isTextarea(element) {
    return element.tagName === 'TEXTAREA';
  }

  /**
   * Get currently active modal
   * @returns {HTMLElement|null}
   */
  getActiveModal() {
    const modals = document.querySelectorAll('.modal-overlay.active');
    return modals.length > 0 ? modals[modals.length - 1] : null;
  }

  /**
   * Close the active modal
   */
  closeActiveModal() {
    const activeModal = this.getActiveModal();
    if (!activeModal) return;

    // Look for close button or use global close function
    const closeBtn = activeModal.querySelector('[data-modal-close]');
    if (closeBtn) {
      closeBtn.click();
    } else {
      // Trigger click on overlay to close
      if (activeModal.classList.contains('modal-overlay')) {
        const rect = activeModal.getBoundingClientRect();
        // Click outside the modal content
        const clickEvent = new MouseEvent('click', {
          clientX: rect.left + 10,
          clientY: rect.top + 10,
          bubbles: true,
        });
        activeModal.dispatchEvent(clickEvent);
      }
    }
  }

  /**
   * Submit the active modal form
   */
  submitActiveModal() {
    const activeModal = this.getActiveModal();
    if (!activeModal) return;

    // Look for primary button or submit button
    const submitBtn =
      activeModal.querySelector('.btn-primary:not([type="button"])') ||
      activeModal.querySelector('[type="submit"]') ||
      activeModal.querySelector('.btn-success');

    if (submitBtn && !submitBtn.disabled) {
      submitBtn.click();
    }
  }

  /**
   * Trap focus within modal (for Tab key)
   * @param {KeyboardEvent} event
   * @param {HTMLElement} modal
   */
  trapFocus(event, modal) {
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const focusableArray = Array.from(focusableElements);
    const firstFocusable = focusableArray[0];
    const lastFocusable = focusableArray[focusableArray.length - 1];

    if (event.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  /**
   * Enable keyboard shortcuts
   */
  enable() {
    this.isEnabled = true;
  }

  /**
   * Disable keyboard shortcuts
   */
  disable() {
    this.isEnabled = false;
  }

  /**
   * Get all registered shortcuts (for help modal)
   * @returns {Array} - Array of {key, description}
   */
  getShortcuts() {
    const shortcuts = [];
    this.shortcuts.forEach((value, key) => {
      if (value.description) {
        shortcuts.push({
          key: this.formatKeyString(key),
          description: value.description,
        });
      }
    });
    return shortcuts;
  }

  /**
   * Format key string for display
   * @param {string} keyString - e.g., 'ctrl+shift+k'
   * @returns {string} - e.g., 'Ctrl + Shift + K'
   */
  formatKeyString(keyString) {
    return keyString
      .split('+')
      .map(part => {
        // Capitalize first letter
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' + ');
  }
}

// Create global instance
const keyboardManager = new KeyboardManager();

// Register common shortcuts (will be extended in page-specific scripts)
keyboardManager.register('?', () => {
  // Show keyboard shortcuts help modal
  if (typeof showKeyboardShortcuts === 'function') {
    showKeyboardShortcuts();
  }
}, { description: 'Show keyboard shortcuts' });

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KeyboardManager;
}
