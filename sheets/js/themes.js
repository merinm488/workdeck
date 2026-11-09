/**
 * ================================================
 * SHEETS - Theme Management Module
 * ================================================
 * Handles light/dark theme switching with:
 * - Black primary + Green accent (dark theme)
 * - White primary + Green accent (light theme)
 *
 * Implement all theme-related functionality
 */

// ================================================
// Theme Manager Class
// ================================================

class ThemeManager {
    constructor() {
        // Initialize theme manager
        this.currentTheme = null;
        this.storageKey = APP_CONFIG.themes.storageKey;
        this.legacyKey = APP_CONFIG.themes.legacyKey;
        this.availableThemes = APP_CONFIG.themes.available;
        this.defaultTheme = APP_CONFIG.themes.default;

        // Theme colors
        this.themes = {
            light: {
                name: 'Light',
                primary: '#ffffff',
                accent: '#22c55e',
            },
            dark: {
                name: 'Dark',
                primary: '#0a0a0a',
                accent: '#22c55e',
            },
        };
    }

    // ================================================
    // Initialization
    // ================================================

    /**
     * Initialize theme manager
     * Set up theme on page load
     */
    init() {
        // Load saved theme or use default
        // Apply theme to document
        // Set up event listeners for theme toggle
        let themeName = this.loadSavedTheme();

        // If theme is 'system', get the system preference
        if (themeName === 'system') {
            themeName = this.getSystemTheme();
        } else if (!themeName) {
            themeName = this.defaultTheme;
        }

        // Apply without saving — keeps the stored 'system' preference intact
        this.applyResolved(themeName);

        // Only setup toggle button if it exists (for login page)
        const toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn && !document.getElementById('settingsBtn')) {
            this.setupToggleButton();
        }

        // Listen for system theme changes if 'system' is selected
        this.watchSystemTheme();

        // Follow theme changes made in other Workdeck tabs
        this.watchSharedTheme();
    }

    /**
     * Set up theme toggle button
     * Configure toggle button behavior
     */
    setupToggleButton() {
        // Get theme toggle button element
        // Add click event listener
        // Update button state based on current theme
        const toggleBtn = document.getElementById('themeToggle');
        if (!toggleBtn) {
            console.warn('Theme toggle button not found');
            return;
        }

        const sunIcon = toggleBtn.querySelector('.sun-icon');
        const moonIcon = toggleBtn.querySelector('.moon-icon');

        if (!sunIcon || !moonIcon) {
            console.warn('Theme icons not found');
            return;
        }

        // Remove existing event listeners to prevent duplicates
        const newBtn = toggleBtn.cloneNode(true);
        toggleBtn.parentNode.replaceChild(newBtn, toggleBtn);

        const updatedBtn = document.getElementById('themeToggle');
        updatedBtn.addEventListener('click', () => this.toggleTheme());

        // Set initial state
        this.updateToggleButtonState();
    }

    /**
     * Update toggle button state
     * Update icon visibility based on current theme
     */
    updateToggleButtonState() {
        const toggleBtn = document.getElementById('themeToggle');
        if (!toggleBtn) return;

        const sunIcon = toggleBtn.querySelector('.sun-icon');
        const moonIcon = toggleBtn.querySelector('.moon-icon');

        if (!sunIcon || !moonIcon) return;

        // CSS handles visibility through opacity - no inline styles needed
        // Just ensure icons are in the DOM
    }

    // ================================================
    // Theme Operations
    // ================================================

    /**
     * Get current theme
     * @returns {string} Current theme name
     */
    getCurrentTheme() {
        // Return current theme from localStorage or DOM
        if(this.currentTheme){
            return this.currentTheme;
        }
        else {
            return document.documentElement.getAttribute('data-theme');
        }
    }

    /**
     * Set theme
     * Apply theme to application
     * @param {string} themeName - Theme name ('light' or 'dark')
     */
    setTheme(themeName) {
        // Validate theme name
        // Update DOM with theme attribute
        // Save to localStorage
        // Update spreadsheet editor theme if loaded
        // Update toggle button state

        if (this.isValidTheme(themeName)){
            this.applyResolved(themeName);
            this.saveTheme(themeName);
        }
        else {
            console.error('[THEME] Invalid theme name:', themeName);
            return;
        }
    }

    /**
     * Toggle between light and dark themes
     * Implement theme switching logic
     */
    toggleTheme() {
        // Get current theme
        // Switch to opposite theme
        // Call setTheme() with new theme
        const currentTheme = this.getCurrentTheme();
        if (currentTheme === 'dark')
            this.setTheme('light');
        else if (currentTheme === 'light') 
            this.setTheme('dark');
    }

    /**
     * Save theme preference
     * Save to localStorage
     * @param {string} themeName - Theme to save
     */
    saveTheme(themeName) {
        // Save theme preference to localStorage
        localStorage.setItem(this.storageKey, themeName);
    }

    /**
     * Load saved theme
     * Load from localStorage
     * @returns {string|null} Saved theme or null
     */
    loadSavedTheme() {
        return localStorage.getItem(this.storageKey) || localStorage.getItem(this.legacyKey);
    }

    // ================================================
    // Theme Application
    // ================================================

    /**
     * Apply theme to document
     * Add/remove data-theme attribute
     * @param {string} themeName - Theme to apply
     */
    applyTheme(themeName) {
        // Set data-theme attribute on document
        document.documentElement.setAttribute('data-theme',themeName);
        this.currentTheme = themeName;
    }

    /**
     * Remove theme from document
     * Remove data-theme attribute
     */
    removeTheme() {
        // Remove data-theme attribute
        document.documentElement.removeAttribute('data-theme');
        this.currentTheme = null;
    }

    /**
     * Update the spreadsheet editor theme (if the engine is present)
     * Applies dark/light mode to the Univer instance
     * @param {string} themeName - Current theme
     */
    updateSpreadsheetTheme(themeName) {
        // Sync Univer's own dark mode with the app theme
        if (window.spreadsheetManager && typeof spreadsheetManager.applyTheme === 'function') {
            spreadsheetManager.applyTheme(themeName);
        }
    }

    // ================================================
    // Utility Methods
    // ================================================

    /**
     * Check if theme is valid
     * @param {string} themeName - Theme to validate
     * @returns {boolean} Valid or not
     */
    isValidTheme(themeName) {
        // Check if theme exists in available themes
        return this.availableThemes.includes(themeName);
    }

    /**
     * Get theme info
     * @param {string} themeName - Theme name
     * @returns {object|null} Theme information
     */
    getThemeInfo(themeName) {
        // Return theme configuration object
        if (this.isValidTheme(themeName)){
            return this.themes[themeName];
        }
        else
            return null;
    }

    /**
     * Get system preferred theme
     * @returns {string} System theme preference
     */
    getSystemTheme() {
        // Check window.matchMedia for dark mode preference
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            
    }

    /**
     * Apply a resolved theme without saving
     * Keeps the stored preference ('system' included) intact
     * @param {string} themeName - Theme name ('light' or 'dark')
     */
    applyResolved(themeName) {
        if (!this.isValidTheme(themeName)) return;
        this.applyTheme(themeName);
        this.updateSpreadsheetTheme(themeName);
        this.updateToggleButtonState();
    }

    /**
     * Listen for system theme changes
     * Set up MediaQuery listener
     */
    watchSystemTheme() {
        // Listen for prefers-color-scheme changes
        // Only auto-switch if user selected 'system' preference
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (e) => {
            const savedPreference = localStorage.getItem(this.storageKey);
            if (savedPreference === 'system') {
                const newTheme = e.matches ? 'dark' : 'light';
                this.applyResolved(newTheme);
            }
        });
    }

    /**
     * Follow theme changes made in other Workdeck tabs
     * The 'storage' event fires only in tabs other than the writer's
     */
    watchSharedTheme() {
        window.addEventListener('storage', (e) => {
            if (e.key !== this.storageKey) return;
            const pref = e.newValue;
            if (pref !== 'system' && !this.isValidTheme(pref)) return;
            this.applyResolved(pref === 'system' ? this.getSystemTheme() : pref);
        });
    }
}

// ================================================
// Export
// ================================================

// Initialize global theme manager instance
// Create theme manager instance when DOM is ready
const themeManager = new ThemeManager();
