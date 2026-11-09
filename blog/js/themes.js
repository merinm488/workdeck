/**
 * ================================================
 * BLOG - Theme Module
 * ================================================
 *
 * Light/dark/system. Preference in localStorage under 'workdeck_theme'
 * (shared suite-wide). Applies <html data-theme>. The server-side
 * settings.theme copy is shared with the rest of the suite via
 * blogStorage.saveSettings.
 */

class BlogThemeManager {
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

    applyTheme(name) {
        document.documentElement.setAttribute('data-theme', name);
        this.currentTheme = name;

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

    setTheme(pref) {
        if (pref === 'system') {
            this.applyTheme(this.getSystemTheme());
        } else if (this.isValidTheme(pref)) {
            this.applyTheme(pref);
        } else return;
        this.setPreference(pref);

        if (typeof blogStorage !== 'undefined') {
            blogStorage.saveSettings({ theme: pref }).catch(console.error);
        }
    }

    applyFromServer(serverTheme) {
        if (!this.isValidTheme(serverTheme) || this.getPreference()) return;
        this.setPreference(serverTheme);
        this.applyTheme(serverTheme);
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

const blogThemeManager = new BlogThemeManager();

if (typeof window !== 'undefined') {
    window.BlogThemeManager = BlogThemeManager;
    window.blogThemeManager = blogThemeManager;
}