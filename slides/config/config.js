/**
 * ================================================
 * SLIDES - Configuration File
 * ================================================
 * App-wide constants and small session helpers.
 * Mirrors forms/config/config.js (which mirrors sheets/config/config.js).
 * No editor logic lives here.
 *
 * NOTE: this is the only JS file written for you — it IS the contract the
 * HTML pages, templates/*.json and api/slides.js all reference. Everything
 * else in js/ is a skeleton for you to implement.
 */

const APP_CONFIG = {
    name: 'Slides',
    version: '1.0.0',
    description: 'Slide deck editor for Workdeck',

    // Environment detection (same rule as Sheets/Forms)
    isProduction: window.location.hostname !== 'localhost' &&
                  window.location.hostname !== '127.0.0.1' &&
                  !window.location.hostname.startsWith('192.168.'),

    // API endpoint (serverless function at /api/slides — skeleton in
    // api/slides.js). Dev: local JSON via server/dev-server.js.
    // Prod: textdb.dev via api/_lib/store.js.
    apiEndpoint: '/api/slides',

    // sessionStorage keys — these MUST match what Workdeck writes on login.
    // TODO(you): add `slidesHash: 'slides_user_hash'` / `slidesKey:
    // 'slides_user_key'` to public/js/auth.js WD_AUTH_CONFIG.storageKeys and
    // set them in storeSession(), so Slides is logged in like the other apps.
    sessionKeys: {
        userHash: 'slides_user_hash',
        userKey: 'slides_user_key'
    },

    // Theme
    themes: {
        default: 'light',
        available: ['light', 'dark'],   // 'system' is a preference, not a theme
        storageKey: 'slides_theme'      // localStorage key holding the preference
    },

    // Auto-save configuration
    autoSave: {
        enabled: true,
        interval: 30000   // 30 seconds
    },

    // Slide geometry — the logical coordinate system every deck uses.
    // 960x540 = 16:9; templates/*.json and editor.html's .thumb-img
    // aspect-ratio all assume this size.
    slide: {
        width: 960,
        height: 540,
        defaultBackground: '#ffffff',
        defaultFontFamily: 'Inter'
    }
};

// ================================================
// Session helpers
// ================================================

/**
 * Get the logged-in user's hash from sessionStorage.
 * Workdeck writes this at login; Slides never shows a login page itself.
 * @returns {string|null} User hash
 */
function getSlidesUserHash() {
    return sessionStorage.getItem(APP_CONFIG.sessionKeys.userHash);
}

/**
 * Get the logged-in user's raw access key (for the "View My Key" modal).
 * @returns {string|null} User key
 */
function getSlidesUserKey() {
    return sessionStorage.getItem(APP_CONFIG.sessionKeys.userKey);
}

/**
 * Clear the Slides session keys only (entry-guard use).
 * Logout must use clearUnifiedSession() instead — logging out of one app
 * logs out of the whole unified account (same as Workdeck/Docs).
 */
function clearSlidesSession() {
    sessionStorage.removeItem(APP_CONFIG.sessionKeys.userHash);
    sessionStorage.removeItem(APP_CONFIG.sessionKeys.userKey);
}

/**
 * Clear the WHOLE unified session — every key Workdeck writes at login
 * (public/js/auth.js WD_AUTH_CONFIG.storageKeys). Used by logout, so `/`
 * lands on Workdeck's login page instead of its home page.
 */
function clearUnifiedSession() {
    [
        'wd_hash', 'wd_key',
        'docs_hash', 'docs_key',
        'sheets_user_hash', 'sheets_user_key',
        'forms_user_hash', 'forms_user_key',
        'slides_user_hash', 'slides_user_key'
    ].forEach(name => sessionStorage.removeItem(name));
}

/**
 * Redirect helpers matching the other apps' flows.
 */
function goToWorkdeck() {
    window.location.href = '/';
}

// Expose globally (plain script tags, no modules)
if (typeof window !== 'undefined') {
    window.APP_CONFIG = APP_CONFIG;
    window.getSlidesUserHash = getSlidesUserHash;
    window.getSlidesUserKey = getSlidesUserKey;
    window.clearSlidesSession = clearSlidesSession;
    window.clearUnifiedSession = clearUnifiedSession;
    window.goToWorkdeck = goToWorkdeck;
}
