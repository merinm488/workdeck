/**
 * ================================================
 * CALENDAR - Configuration File
 * ================================================
 * App-wide constants and small session helpers.
 */

const APP_CONFIG = {
    name: 'Calendar',
    version: '1.0.0',
    description: 'Calendars and events for Workdeck',

    // API endpoint (serverless function at /api/calendar)
    apiEndpoint: '/api/calendar',

    // sessionStorage keys — these MUST match what Workdeck writes on login
    // (see public/js/auth.js storageKeys.calendarHash / calendarKey).
    sessionKeys: {
        userHash: 'calendar_user_hash',
        userKey: 'calendar_user_key'
    },

    // Theme
    themes: {
        default: 'light',
        available: ['light', 'dark'],   // 'system' is a preference, not a theme
        storageKey: 'calendar_theme'    // localStorage key holding the preference
    },

    // Calendar view + display preferences (localStorage)
    view: {
        defaultView: 'dayGridMonth',
        storageKey: 'calendar_view'
    },

    // Whether Todo tasks with due dates render as all-day items
    todo: {
        storageKey: 'calendar_show_todo',
        color: '#188038'
    },

    // Reminder tick + which minutes-before options the editor offers
    reminders: {
        tickMs: 30 * 1000,
        firedLogKey: 'calendar_fired_reminders',
        options: [5, 10, 15, 30, 60, 1440]   // minutes before
    },

    // Palette for new calendars (matches the suite's tag palette)
    colors: ['#0284c7', '#FACC15', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#F97316']
};

// ================================================
// Session helpers
// ================================================

// localStorage fallback so new tabs opened directly keep their session
// (Workdeck's login seeds both — see public/js/auth.js seedMirrors).
function readCalendarSession(name) {
    try {
        return sessionStorage.getItem(name) || localStorage.getItem(name) || null;
    } catch (err) {
        return null;
    }
}

function getCalendarUserHash() {
    return readCalendarSession(APP_CONFIG.sessionKeys.userHash);
}

function getCalendarUserKey() {
    return readCalendarSession(APP_CONFIG.sessionKeys.userKey);
}

/**
 * Clear the Calendar session keys only (entry-guard use).
 * Logout must use clearUnifiedSession() instead — logging out of one app
 * logs out of the whole unified account.
 */
function clearCalendarSession() {
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
        'calendar_user_hash', 'calendar_user_key'
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
    window.getCalendarUserHash = getCalendarUserHash;
    window.getCalendarUserKey = getCalendarUserKey;
    window.clearCalendarSession = clearCalendarSession;
    window.clearUnifiedSession = clearUnifiedSession;
    window.goToWorkdeck = goToWorkdeck;
}