/**
 * ================================================
 * WORKDECK - Theme Management
 * ================================================
 * Light / Dark / System themes for the Workdeck landing page.
 * Applied via the data-theme attribute + localStorage; the preference is
 * also persisted server-side in the user document (settings.theme) by
 * workdeck.js, so it follows the account across devices.
 */

class WdThemeManager {
    constructor() {
        this.currentTheme = null;
        this.storageKey = 'workdeck_theme';
        this.availableThemes = ['light', 'dark', 'system'];
        this.defaultTheme = 'dark'; // matches Docs default
        this.systemMedia = window.matchMedia('(prefers-color-scheme: dark)');
        this.pendingServerSave = null;
    }

    // ================================================
    // Initialization
    // ================================================

    init(savedTheme) {
        let themeName = savedTheme || localStorage.getItem(this.storageKey) || this.defaultTheme;

        if (!this.isValidTheme(themeName)) {
            themeName = this.defaultTheme;
        }

        this.setTheme(themeName, { skipServerSave: true });
        this.watchSystemTheme();
    }

    /**
     * Called by workdeck.js after user data loads, so a theme saved on
     * another device takes precedence over the local cache.
     */
    applyFromServer(serverTheme) {
        if (serverTheme && this.isValidTheme(serverTheme)) {
            this.setTheme(serverTheme, { skipServerSave: true });
            localStorage.setItem(this.storageKey, serverTheme);
        }
    }

    // ================================================
    // Theme Operations
    // ================================================

    getCurrentTheme() {
        return this.currentTheme;
    }

    getPreference() {
        return localStorage.getItem(this.storageKey) || this.defaultTheme;
    }

    isValidTheme(themeName) {
        return this.availableThemes.includes(themeName);
    }

    setTheme(themeName, options = {}) {
        if (!this.isValidTheme(themeName)) {
            console.error('[THEME] Invalid theme name:', themeName);
            return;
        }

        const effective = themeName === 'system' ? this.getSystemTheme() : themeName;
        this.applyTheme(effective);
        this.currentTheme = effective;
        localStorage.setItem(this.storageKey, themeName);

        if (!options.skipServerSave && window.workdeckApp?.saveSettings) {
            // Debounced server-side persistence of the preference string.
            clearTimeout(this.pendingServerSave);
            this.pendingServerSave = setTimeout(() => {
                window.workdeckApp.saveSettings({ theme: themeName });
            }, 600);
        }
    }

    toggleTheme() {
        this.setTheme(this.getCurrentTheme() === 'dark' ? 'light' : 'dark');
    }

    getSystemTheme() {
        return this.systemMedia.matches ? 'dark' : 'light';
    }

    applyTheme(themeName) {
        document.documentElement.setAttribute('data-theme', themeName);
    }

    watchSystemTheme() {
        this.systemMedia.addEventListener('change', () => {
            if (this.getPreference() === 'system') {
                this.setTheme('system', { skipServerSave: true });
            }
        });
    }
}

// Global instance
const wdThemeManager = new WdThemeManager();

if (typeof window !== 'undefined') {
    window.WdThemeManager = WdThemeManager;
    window.wdThemeManager = wdThemeManager;
}
