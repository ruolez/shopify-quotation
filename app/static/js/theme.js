/**
 * Theme Manager - Dark Mode Toggle with localStorage Persistence
 * Handles theme switching and system preference detection
 */

class ThemeManager {
  constructor() {
    this.theme = this.getInitialTheme();
    this.init();
  }

  /**
   * Get initial theme from localStorage or system preference
   */
  getInitialTheme() {
    // Check localStorage first
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      return savedTheme;
    }

    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  }

  /**
   * Initialize theme manager
   */
  init() {
    // Apply initial theme immediately (before page render)
    this.applyTheme(this.theme, false);

    // Listen for system theme changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only auto-switch if user hasn't manually set a preference
        if (!localStorage.getItem('theme')) {
          this.setTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  }

  /**
   * Apply theme to document
   * @param {string} theme - 'light' or 'dark'
   * @param {boolean} animate - Whether to animate the transition
   */
  applyTheme(theme, animate = true) {
    // Add transition class for smooth theme change
    if (animate) {
      document.documentElement.classList.add('theme-transitioning');

      // Remove transition class after animation completes
      setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
      }, 300);
    }

    // Set data-theme attribute on document
    document.documentElement.setAttribute('data-theme', theme);

    // Update meta theme-color for mobile browsers
    this.updateMetaThemeColor(theme);
  }

  /**
   * Update mobile browser theme color
   * @param {string} theme - 'light' or 'dark'
   */
  updateMetaThemeColor(theme) {
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#1a1f2e' : '#ffffff');
    } else {
      // Create meta tag if it doesn't exist
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = theme === 'dark' ? '#1a1f2e' : '#ffffff';
      document.head.appendChild(meta);
    }
  }

  /**
   * Set theme and save to localStorage
   * @param {string} theme - 'light' or 'dark'
   */
  setTheme(theme) {
    this.theme = theme;
    this.applyTheme(theme);
    localStorage.setItem('theme', theme);

    // Dispatch custom event for other components
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  /**
   * Toggle between light and dark themes
   */
  toggle() {
    const newTheme = this.theme === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
  }

  /**
   * Get current theme
   * @returns {string} - 'light' or 'dark'
   */
  getTheme() {
    return this.theme;
  }
}

// Create global instance
const themeManager = new ThemeManager();

// Wire up theme toggle button
document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      themeManager.toggle();
    });
  }
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeManager;
}
