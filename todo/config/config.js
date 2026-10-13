/**
 * ================================================
 * TODO - Configuration File
 * ================================================
 * App-wide constants and small session helpers.
 */

const APP_CONFIG = {
    name: 'Todo',
    version: '1.0.0',
    description: 'Task lists for Workdeck',

    // API endpoint (serverless function at /api/todo)
    apiEndpoint: '/api/todo',

    // sessionStorage keys — these MUST match what Workdeck writes on login
    // (see public/js/auth.js storageKeys.todoHash / todoKey).
    sessionKeys: {
        userHash: 'todo_user_hash',
        userKey: 'todo_user_key'
    },

    // Theme
    themes: {
        default: 'light',
        available: ['light', 'dark'],   // 'system' is a preference, not a theme
        storageKey: 'todo_theme'        // localStorage key holding the preference
    }
};

// ================================================
// Session helpers
// ================================================

// localStorage fallback so new tabs opened directly keep their session
// (Workdeck's login seeds both — see public/js/auth.js seedMirrors).
function readTodoSession(name) {
    try {
        return sessionStorage.getItem(name) || localStorage.getItem(name) || null;
    } catch (err) {
        return null;
    }
}

function getTodoUserHash() {
    return readTodoSession(APP_CONFIG.sessionKeys.userHash);
}

function getTodoUserKey() {
    return readTodoSession(APP_CONFIG.sessionKeys.userKey);
}

/**
 * Clear the Todo session keys only (entry-guard use).
 * Logout must use clearUnifiedSession() instead — logging out of one app
 * logs out of the whole unified account.
 */
function clearTodoSession() {
    sessionStorage.removeItem(APP_CONFIG.sessionKeys.userHash);
    sessionStorage.removeItem(APP_CONFIG.sessionKeys.userKey);
}

/**
 * Clear the WHOLE unified session — every key Workdeck writes at login
 * (public/js/auth.js WD_AUTH_CONFIG.storageKeys).
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

function goToWorkdeck() {
    window.location.href = '/';
}

// Expose globally (plain script tags, no modules)
if (typeof window !== 'undefined') {
    window.APP_CONFIG = APP_CONFIG;
    window.getTodoUserHash = getTodoUserHash;
    window.getTodoUserKey = getTodoUserKey;
    window.clearTodoSession = clearTodoSession;
    window.clearUnifiedSession = clearUnifiedSession;
    window.goToWorkdeck = goToWorkdeck;
}