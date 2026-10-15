/**
 * ================================================
 * FILEBOX - Configuration File
 * ================================================
 * App-wide constants and small session helpers.
 */

const APP_CONFIG = {
    name: 'Files',
    version: '1.0.0',
    description: 'File manager for Workdeck',

    // Environment detection
    isProduction: window.location.hostname !== 'localhost' &&
                  window.location.hostname !== '127.0.0.1' &&
                  !window.location.hostname.startsWith('192.168.'),

    // File bytes go here (upload/download). Dev: local JSON via
    // server/dev-server.js. Prod: textdb.dev via api/_lib/store.js.
    apiEndpoint: '/api/filebox',

    // Metadata (files/folders/tags records, moves, renames, recency) goes
    // through the unified Workdeck API with app:'filebox' — same as the
    // landing page uses, so both stay in sync.
    workdeckEndpoint: '/api/workdeck',

    // sessionStorage keys — these MUST match what Workdeck writes on login
    // (public/js/auth.js storageKeys.fileboxHash / fileboxKey).
    sessionKeys: {
        userHash: 'filebox_user_hash',
        userKey: 'filebox_user_key'
    },

    // Theme
    themes: {
        default: 'light',
        available: ['light', 'dark'],   // 'system' is a preference, not a theme
        storageKey: 'filebox_theme'
    },

    // Client-side fallback only — the server's value (FILES_MAX_FILE_SIZE
    // env var, reported via GET /api/filebox?limits=1) overrides it.
    maxFileSize: 300 * 1024,

    // Poll the unified doc while the tab is visible (plus visibilitychange).
    pollInterval: 30000,

    folderColors: ['#FACC15', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4', '#F97316']
};

// ================================================
// Session helpers
// ================================================


function readFileboxSession(name) {
    try {
        return sessionStorage.getItem(name) || localStorage.getItem(name) || null;
    } catch (err) {
        return null;   // storage blocked -> treat as logged out
    }
}

/**
 * Get the logged-in user's hash from the session.
 * Workdeck writes this at login; Filebox never shows a login page itself.
 * @returns {string|null} User hash
 */
function getFileboxUserHash() {
    return readFileboxSession(APP_CONFIG.sessionKeys.userHash);
}

/**
 * Get the logged-in user's raw access key (for the "View My Key" modal).
 * @returns {string|null} User key
 */
function getFileboxUserKey() {
    return readFileboxSession(APP_CONFIG.sessionKeys.userKey);
}

/**
 * Clear the Filebox session keys only (entry-guard use).
 * Logout must use clearUnifiedSession() instead — logging out of one app
 * logs out of the whole unified account.
 */
function clearFileboxSession() {
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
        'draw_user_hash', 'draw_user_key',
        'filebox_user_hash', 'filebox_user_key',
        'todo_user_hash', 'todo_user_key'
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
    window.getFileboxUserHash = getFileboxUserHash;
    window.getFileboxUserKey = getFileboxUserKey;
    window.clearFileboxSession = clearFileboxSession;
    window.clearUnifiedSession = clearUnifiedSession;
    window.goToWorkdeck = goToWorkdeck;
}