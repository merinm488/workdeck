/**
 * ================================================
 * FORMS - Configuration File
 * ================================================
 * App-wide constants and small session helpers.
 * No editor logic lives here.
 */

const APP_CONFIG = {
    name: 'Forms',
    version: '1.0.0',
    description: 'Form builder and response collection for Workdeck',

    // Environment detection
    isProduction: window.location.hostname !== 'localhost' &&
                  window.location.hostname !== '127.0.0.1' &&
                  !window.location.hostname.startsWith('192.168.'),

    // API endpoint (serverless function at /api/forms)
    apiEndpoint: '/api/forms',

    // sessionStorage keys — these MUST match what Workdeck writes on login
    // (see public/js/auth.js storageKeys.formsHash / formsKey), which is how
    // Forms is already logged in without its own login page.
    sessionKeys: {
        userHash: 'forms_user_hash',
        userKey: 'forms_user_key'
    },

    // Theme
    themes: {
        default: 'light',
        available: ['light', 'dark'],   // 'system' is a preference, not a theme
        storageKey: 'forms_theme'       // localStorage key holding the preference
    },

    // Auto-save configuration
    autoSave: {
        enabled: true,
        interval: 30000   // 30 seconds
    }
};

// ================================================
// Session helpers
// ================================================

/**
 * Get the logged-in user's hash from sessionStorage.
 * Workdeck writes this at login; Forms never shows a login page itself.
 * @returns {string|null} User hash
 */
function getFormsUserHash() {
    return sessionStorage.getItem(APP_CONFIG.sessionKeys.userHash);
}

/**
 * Get the logged-in user's raw access key (for the "View My Key" modal).
 * @returns {string|null} User key
 */
function getFormsUserKey() {
    return sessionStorage.getItem(APP_CONFIG.sessionKeys.userKey);
}

/**
 * Clear the Forms session keys only (entry-guard use).
 * Logout must use clearUnifiedSession() instead — logging out of one app
 * logs out of the whole unified account.
 */
function clearFormsSession() {
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
    window.getFormsUserHash = getFormsUserHash;
    window.getFormsUserKey = getFormsUserKey;
    window.clearFormsSession = clearFormsSession;
    window.clearUnifiedSession = clearUnifiedSession;
    window.goToWorkdeck = goToWorkdeck;
}
