/**
 * CalendarStorage — data persistence for the Calendar app.
 *
 * All operations go through /api/calendar, which reads/writes the user's
 * unified document (db/users/{hash}.json.
 * Saves are section-merged — only the `calendars` and `events` sections
 * are written (plus settings keys when touched).
 */

class CalendarStorage {
    constructor() {
        this.apiEndpoint = APP_CONFIG.apiEndpoint;
        this._thumbTimer = null;
    }

    /**
     * Load the user's whole unified document. Todo items and the file
     * lists (for event links) come from the same response.
     * @returns {Promise<object|null>} User data or null
     */
    async loadUserData() {
        const hash = getCalendarUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }
        try {
            const response = await fetch(`${this.apiEndpoint}?hash=${encodeURIComponent(hash)}&_t=${Date.now()}`,
                { cache: 'no-store' }
            );
            if (!response.ok) return null;

            const result = await response.json();
            return result.success ? result.data : null;
        } catch (error) {
            console.error('[STORAGE] Load error:', error);
            return null;
        }
    }

    /**
     * PUT an action against the unified document.
     * @returns {Promise<object|null>} result.data on success, null on failure
     */
    async put(action, data) {
        const result = await this.send(action, data);
        if (result && action !== 'updateSettings') this.scheduleThumbnail();
        return result;
    }

    /** Raw PUT without the thumbnail hook. */
    async send(action, data) {
        const hash = getCalendarUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hash, action, data })
            });
            const result = await response.json();
            if (!result.success) {
                console.error(`[STORAGE] ${action} failed:`, result.error);
                return null;
            }
            return result.data || {};
        } catch (error) {
            console.error(`[STORAGE] ${action} error:`, error);
            return null;
        }
    }

    /** Card snapshot: coalesce write bursts, then capture + store. */
    scheduleThumbnail() {
        clearTimeout(this._thumbTimer);
        this._thumbTimer = setTimeout(async () => {
            const thumbnail = await captureCalendarThumbnail();
            if (thumbnail) await this.send('updateSettings', { settings: { calendarThumbnail: thumbnail } });
        }, 1500);
    }

    /** Create a calendar; returns { calendar, data } or null. */
    async createCalendar(name, color, tagId) {
        return this.put('createCalendar', { name: name || '', color: color || null, tagId: tagId || null });
    }

    /** Update name/color/visibility on one calendar. */
    async updateCalendar(calId, updates) {
        return this.put('updateCalendar', { calId, updates });
    }

    /** Delete a calendar and every event in it. */
    async deleteCalendar(calId) {
        return this.put('deleteCalendar', { calId });
    }

    /** Create an event record (recurring shape stored as given). */
    async createEvent(event) {
        return this.put('createEvent', { event });
    }

    /** Upsert a whole event record (exceptions composed by the caller). */
    async updateEvent(eventId, event) {
        return this.put('updateEvent', { eventId, event });
    }

    /** Delete an entire event record (series for recurring events). */
    async deleteEvent(eventId) {
        return this.put('deleteEvent', { eventId });
    }

    /** Merge settings keys (theme etc.). */
    async updateSettings(settings) {
        return this.put('updateSettings', { settings });
    }
}

const calendarStorage = new CalendarStorage();

if (typeof window !== 'undefined') {
    window.CalendarStorage = CalendarStorage;
    window.calendarStorage = calendarStorage;
}