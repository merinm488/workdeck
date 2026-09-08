/**
 * FormsThemeManager — light/dark/system theme handling for the Forms app.
 *
 * Theme preference lives in localStorage under APP_CONFIG.themes.storageKey
 * ('forms_theme'); values: 'light' | 'dark' | 'system'.
 *
 */

class FormsThemeManager {
    constructor() {
        this.storageKey = APP_CONFIG.themes.storageKey;
        this.availableThemes = APP_CONFIG.themes.available;   // ['light', 'dark']
        this.currentTheme = null;                             // resolved theme actually applied
    }

    // ================================================
    // Initialization
    // ================================================

    init() {
        const pref = this.getPreference();
        let resolvedTheme;
        if(pref === 'system'){
            resolvedTheme = this.getSystemTheme();
        } 
        else if (this.isValidTheme(pref)){
            resolvedTheme = pref;
        } else {
            resolvedTheme = APP_CONFIG.themes.default;
        }
        this.applyTheme(resolvedTheme);
        this.watchSystemTheme();
    }

    // ================================================
    // Preference (localStorage)
    // ================================================

    /**
     * Read the saved preference from localStorage.
     * @returns {string|null} 'light' | 'dark' | 'system' | null
     */
    getPreference() {
        return localStorage.getItem(this.storageKey);
    }

    /**
     * Write the preference.
     * @param {string} pref 'light' | 'dark' | 'system'
     */
    setPreference(pref) {
        localStorage.setItem(this.storageKey, pref);
    }

    /**
     * Resolve the OS preference to a concrete theme.
     * @returns {string} 'light' or 'dark'
     */
    getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';

    }

    /**
     * Validate a theme name against this.availableThemes.
     * @param {string} name
     * @returns {boolean}
     */
    isValidTheme(name) {
        return this.availableThemes.includes(name);

    }

    // ================================================
    // Theme operations
    // ================================================

    /**
     * Apply a resolved theme ('light' or 'dark') to <html data-theme>.
     * @param {string} name
     */
    applyTheme(name) {
        document.documentElement.setAttribute('data-theme', name);
        this.currentTheme = name;
    }

    /**
     * Set theme from the dropdown. Accepts 'light' | 'dark' | 'system'
     * ('system' resolves via getSystemTheme() but stores 'system').
     *
     *
     * @param {string} pref 'light' | 'dark' | 'system'
     */
    setTheme(pref) {

        if (pref === 'system'){
            this.applyTheme(this.getSystemTheme());
        } else if (this.isValidTheme(pref)){
            this.applyTheme(pref);
        } else return;
        this.setPreference(pref);

        if(typeof formsStorage !== 'undefined'){
            formsStorage.saveSettings({theme:pref}).catch(console.error);
        }
    }

    /**
  
     * @param {string} serverTheme - e.g. 'dark'
     */
    applyFromServer(serverTheme) {

        if(this.isValidTheme(serverTheme)){
            this.setPreference(serverTheme);
            this.applyTheme(serverTheme);
        }
    }

    /**
     * React to OS theme changes while the preference is 'system'.
     */
    watchSystemTheme() {
        
        const mediaQuery = window.matchMedia('(prefers-color-scheme:dark)');
        mediaQuery.addEventListener('change', (e) => {
            if(this.getPreference() === 'system'){
                this.applyTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    // ================================================
    // Utility
    // ================================================

    /**
     * Label for the settings dropdown: 'Light' / 'Dark' / 'System'.
     * @returns {string}
     */
    getDisplayLabel() {
        const pref = this.getPreference();
        if(pref === 'system') return 'System';
        const theme = this.currentTheme || APP_CONFIG.themes.default;
        return theme.charAt(0).toUpperCase() + theme.slice(1);
    }
}

// ================================================
// Export
// ================================================

const formsThemeManager = new FormsThemeManager();

if (typeof window !== 'undefined') {
    window.FormsThemeManager = FormsThemeManager;
    window.formsThemeManager = formsThemeManager;
}
