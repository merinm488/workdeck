/**
 * ================================================
 * DRAW - Configuration File
 * ================================================
 * App-wide constants and small session helpers.
 */

const APP_CONFIG = {
    name: 'Draw',
    version: '1.0.0',
    description: 'Drawing app for Workdeck',

    // Environment detection
    isProduction: window.location.hostname !== 'localhost' &&
                  window.location.hostname !== '127.0.0.1' &&
                  !window.location.hostname.startsWith('192.168.'),

    // API endpoint. Dev: local JSON via server/dev-server.js.
    // Prod: textdb.dev via api/_lib/store.js.
    apiEndpoint: '/api/draw',

    // sessionStorage keys — these MUST match what Workdeck writes on login.
    sessionKeys: {
        userHash: 'draw_user_hash',
        userKey: 'draw_user_key'
    },

    // Theme
    themes: {
        default: 'light',
        available: ['light', 'dark'],   // 'system' is a preference, not a theme
        storageKey: 'draw_theme'        // localStorage key holding the preference
    },

    // Auto-save configuration
    autoSave: {
        enabled: true,
        interval: 30000   // 30 seconds
    },

    // Canvas defaults. The board is INFINITE — there is no fixed logical
    // size; pan/zoom live in the drawing record's `viewport`. These values
    // seed new drawings and defaults for shared/legacy records.
    canvas: {
        defaultBackground: '#ffffff',
        minZoom: 0.05,
        maxZoom: 8,
        zoomStep: 1.2,            // multiplicative step for the zoom buttons
        wheelZoomFactor: 1.0015   // ctrl/trackpad-pinch wheel -> zoom curve
    },

    // Tool defaults — seeded into the toolbar and applied to new objects.
    tools: {
        strokeColor: '#1f2937',
        fillColor: 'transparent',   // shapes start unfilled
        strokeWidth: 2,
        fontSize: 20,
        fontFamily: 'Inter',
        arrowHeadLength: 16         // px, scaled by stroke width when drawing
    }
};

// ================================================
// Session helpers
// ================================================

/**
 * Read a session value: sessionStorage first, then Workdeck's persistent
 * localStorage seed.
 */
function readDrawSession(name) {
    try {
        return sessionStorage.getItem(name) || localStorage.getItem(name) || null;
    } catch (err) {
        return null;   // storage blocked -> treat as logged out
    }
}

/**
 * Get the logged-in user's hash from the session.
 * Workdeck writes this at login; Draw never shows a login page itself.
 * @returns {string|null} User hash
 */
function getDrawUserHash() {
    return readDrawSession(APP_CONFIG.sessionKeys.userHash);
}

/**
 * Get the logged-in user's raw access key (for the "View My Key" modal).
 * @returns {string|null} User key
 */
function getDrawUserKey() {
    return readDrawSession(APP_CONFIG.sessionKeys.userKey);
}

/**
 * Clear the Draw session keys only (entry-guard use).
 * Logout must use clearUnifiedSession() instead — logging out of one app
 * logs out of the whole unified account.
 */
function clearDrawSession() {
    [sessionStorage, localStorage].forEach(store => {
        store.removeItem(APP_CONFIG.sessionKeys.userHash);
        store.removeItem(APP_CONFIG.sessionKeys.userKey);
    });
}

/**
 * Clear the WHOLE unified session
 */
function clearUnifiedSession() {
    [
        'wd_hash', 'wd_key',
        'docs_hash', 'docs_key',
        'sheets_user_hash', 'sheets_user_key',
        'forms_user_hash', 'forms_user_key',
        'slides_user_hash', 'slides_user_key',
        'draw_user_hash', 'draw_user_key'
    ].forEach(name => {
        sessionStorage.removeItem(name);
        localStorage.removeItem(name);
    });
}

/**
 * Redirect to the Workdeck home page.
 */
function goToWorkdeck() {
    window.location.href = '/';
}

// Expose globally (plain script tags, no modules)
if (typeof window !== 'undefined') {
    window.APP_CONFIG = APP_CONFIG;
    window.getDrawUserHash = getDrawUserHash;
    window.getDrawUserKey = getDrawUserKey;
    window.clearDrawSession = clearDrawSession;
    window.clearUnifiedSession = clearUnifiedSession;
    window.goToWorkdeck = goToWorkdeck;
}
