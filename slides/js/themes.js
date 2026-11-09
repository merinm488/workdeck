/**
 * ================================================
 * SLIDES - Theme Manager
 * ================================================
 *
 * SlidesThemeManager — light/dark/system theme handling. 

 */

class SlidesThemeManager {
    constructor() {
        this.storageKey = APP_CONFIG.themes.storageKey;
        this.legacyKey = APP_CONFIG.themes.legacyKey;
        this.availableThemes = APP_CONFIG.themes.available;
        this.currentTheme = null;   // resolved theme actually applied
    }

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
        return this.availableThemes.includes(name)
    }

    applyTheme(name) {
        document.documentElement.setAttribute('data-theme', name);
        this.currentTheme = name;
        document.dispatchEvent(new CustomEvent('slidesthemechange'));
    }

    setTheme(pref) {
        if (pref === 'system'){
            this.applyTheme(this.getSystemTheme());
        } else if (this.isValidTheme(pref)){
            this.applyTheme(pref);
        } else return;
        this.setPreference(pref);

        if(typeof slidesStorage !== 'undefined'){
            slidesStorage.saveSettings({theme:pref}).catch(console.error);
        }        
    }

    applyFromServer(serverTheme) {
        if(this.isValidTheme(serverTheme)){
            this.setPreference(serverTheme);
            this.applyTheme(serverTheme);
        }
    }

    watchSystemTheme() {
        const mediaQuery = window.matchMedia('(prefers-color-scheme:dark)');
        mediaQuery.addEventListener('change', (e) => {
            if(this.getPreference() === 'system'){
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
        if(pref === 'system') return 'System';
        const theme = this.currentTheme || APP_CONFIG.themes.default;
        return theme.charAt(0).toUpperCase() + theme.slice(1);
    }
}

// ================================================
// Export
// ================================================

const slidesThemeManager = new SlidesThemeManager();

if (typeof window !== 'undefined') {
    window.SlidesThemeManager = SlidesThemeManager;
    window.slidesThemeManager = slidesThemeManager;
}
