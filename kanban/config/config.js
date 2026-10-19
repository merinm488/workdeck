/**
 * ================================================
 * KANBAN - Configuration File
 * ================================================
 */

const APP_CONFIG = {
    name: 'Kanban',
    version: '1.0.0',
    description: 'Kanban boards for Workdeck',

    apiEndpoint: '/api/kanban',

    // Must match what Workdeck writes on login (public/js/auth.js)
    sessionKeys: {
        userHash: 'kanban_user_hash',
        userKey: 'kanban_user_key'
    },

    themes: {
        default: 'dark',
        available: ['light', 'dark'],
        storageKey: 'kanban_theme'
    },

    // Card priority values (colors mirror Todo's palette)
    priorities: [
        { id: 'high', color: '#dc2626', label: 'High' },
        { id: 'medium', color: '#b45309', label: 'Medium' },
        { id: 'low', color: '#15803d', label: 'Low' }
    ],

    // Single-user suite: one pseudo-user drives avatars/votes/comments
    currentUser: { id: 'me', label: 'Me', avatar: '' }
};

// ================================================
// Session helpers
// ================================================

function readKanbanSession(name) {
    try {
        return sessionStorage.getItem(name) || localStorage.getItem(name) || null;
    } catch (err) {
        return null;
    }
}

function getKanbanUserHash() {
    return readKanbanSession(APP_CONFIG.sessionKeys.userHash);
}

function getKanbanUserKey() {
    return readKanbanSession(APP_CONFIG.sessionKeys.userKey);
}

function clearKanbanSession() {
    sessionStorage.removeItem(APP_CONFIG.sessionKeys.userHash);
    sessionStorage.removeItem(APP_CONFIG.sessionKeys.userKey);
}

// Every key Workdeck writes at login (public/js/auth.js WD_AUTH_CONFIG)
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
        'kanban_user_hash', 'kanban_user_key'
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
    window.getKanbanUserHash = getKanbanUserHash;
    window.getKanbanUserKey = getKanbanUserKey;
    window.clearKanbanSession = clearKanbanSession;
    window.clearUnifiedSession = clearUnifiedSession;
    window.goToWorkdeck = goToWorkdeck;
}