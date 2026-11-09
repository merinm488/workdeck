/**
 * CalendarThemeManager — light/dark/system theme handling for the Calendar
 * app. Preference lives in localStorage under 'workdeck_theme' (shared
 * suite-wide); values: 'light' | 'dark' | 'system'.
 */

class CalendarThemeManager {
    constructor() {
        this.storageKey = APP_CONFIG.themes.storageKey;
        this.legacyKey = APP_CONFIG.themes.legacyKey;
        this.availableThemes = APP_CONFIG.themes.available;
        this.currentTheme = null;
    }

    init() {
        const pref = this.getPreference();
        let resolvedTheme;
        if (pref === 'system') {
            resolvedTheme = this.getSystemTheme();
        } else if (this.isValidTheme(pref)) {
            resolvedTheme = pref;
        } else {
            resolvedTheme = APP_CONFIG.themes.default;
        }
        this.applyTheme(resolvedTheme);
        this.watchSystemTheme();
        this.watchSharedTheme();
    }

    getPreference() {
        return localStorage.getItem(this.storageKey) || localStorage.getItem(this.legacyKey);
    }

    setPreference(pref) {
        localStorage.setItem(this.storageKey, pref);
    }

    getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    }

    isValidTheme(name) {
        return this.availableThemes.includes(name);
    }

    /**
     * Apply a resolved theme ('light' or 'dark') to <html data-theme>.
     * @param {string} name
     */
    applyTheme(name) {
        document.documentElement.setAttribute('data-theme', name);
        this.currentTheme = name;

        // Keep the dropdown label + check marks in sync.
        const label = document.getElementById('themeText');
        if (label) {
            label.textContent = 'Theme: ' + (this.getDisplayLabel());
        }
        document.querySelectorAll('.theme-option').forEach(btn => {
            const pref = btn.dataset.theme;
            const active = pref === this.getPreference() ||
                (!this.getPreference() && pref === APP_CONFIG.themes.default);
            btn.classList.toggle('active', active);
        });
    }

    /**
     * Set theme from the dropdown. Accepts 'light' | 'dark' | 'system'.
     * @param {string} pref
     */
    setTheme(pref) {
        if (pref === 'system') {
            this.applyTheme(this.getSystemTheme());
        } else if (this.isValidTheme(pref)) {
            this.applyTheme(pref);
        } else return;
        this.setPreference(pref);

        if (typeof calendarStorage !== 'undefined') {
            calendarStorage.updateSettings({ theme: pref }).catch(console.error);
        }
    }

    /**
     * Adopt a theme persisted on the account (first visit on a device).
     * @param {string} serverTheme - e.g. 'dark'
     */
    applyFromServer(serverTheme) {
        if (this.isValidTheme(serverTheme) && !this.getPreference()) {
            this.setPreference(serverTheme);
            this.applyTheme(serverTheme);
        }
    }

    watchSystemTheme() {
        const mediaQuery = window.matchMedia('(prefers-color-scheme:dark)');
        mediaQuery.addEventListener('change', (e) => {
            if (this.getPreference() === 'system') {
                this.applyTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    // Follow theme changes made in other Workdeck tabs.
    watchSharedTheme() {
        window.addEventListener('storage', (e) => {
            if (e.key !== this.storageKey) return;
            const pref = e.newValue;
            if (pref !== 'system' && !this.isValidTheme(pref)) return;
            this.applyTheme(pref === 'system' ? this.getSystemTheme() : pref);
        });
    }

    getDisplayLabel() {
        const pref = this.getPreference();
        if (pref === 'system') return 'System';
        const theme = this.currentTheme || APP_CONFIG.themes.default;
        return theme.charAt(0).toUpperCase() + theme.slice(1);
    }
}

const calendarThemeManager = new CalendarThemeManager();

if (typeof window !== 'undefined') {
    window.CalendarThemeManager = CalendarThemeManager;
    window.calendarThemeManager = calendarThemeManager;
}