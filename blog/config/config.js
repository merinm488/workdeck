/**
 * ================================================
 * BLOG - Configuration File
 * ================================================
 * App-wide constants and small session helpers.
 */

const APP_CONFIG = {
    name: 'Blog',
    version: '1.0.0',
    description: 'A publishable blog for Workdeck',

    // API endpoint (serverless function at /api/blog)
    apiEndpoint: '/api/blog',

    // sessionStorage keys — these MUST match what Workdeck writes on login
    // (see public/js/auth.js storageKeys.blogHash / blogKey).
    sessionKeys: {
        userHash: 'blog_user_hash',
        userKey: 'blog_user_key'
    },

    // Theme
    themes: {
        default: 'light',
        available: ['light', 'dark'],   // 'system' is a preference, not a theme
        storageKey: 'workdeck_theme',   // suite-wide key — one theme for all apps
        legacyKey: 'blog_theme'         // pre-unification key, read-only fallback
    }
};

// ================================================
// Session helpers
// ================================================

// localStorage fallback so new tabs opened directly keep their session
// (Workdeck's login seeds both — see public/js/auth.js seedMirrors).
function readBlogSession(name) {
    try {
        return sessionStorage.getItem(name) || localStorage.getItem(name) || null;
    } catch (err) {
        return null;
    }
}

function getBlogUserHash() {
    return readBlogSession(APP_CONFIG.sessionKeys.userHash);
}

function getBlogUserKey() {
    return readBlogSession(APP_CONFIG.sessionKeys.userKey);
}

/**
 * Clear the Blog session keys only (entry-guard use).
 * Logout must use clearUnifiedSession() instead — logging out of one app
 * logs out of the whole unified account.
 */
function clearBlogSession() {
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
        'todo_user_hash', 'todo_user_key',
        'calendar_user_hash', 'calendar_user_key',
        'kanban_user_hash', 'kanban_user_key',
        'blog_user_hash', 'blog_user_key'
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
    window.getBlogUserHash = getBlogUserHash;
    window.getBlogUserKey = getBlogUserKey;
    window.clearBlogSession = clearBlogSession;
    window.clearUnifiedSession = clearUnifiedSession;
    window.goToWorkdeck = goToWorkdeck;
}