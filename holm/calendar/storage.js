// Holm Calendar persistence adapter. Only the signed-in member's cookie is
// sent; user-supplied hashes, keys and account IDs never enter requests.
class CalendarStorage {
  constructor() {
    this._thumbTimer = null;
    this.calendarVersions = new Map();
    this.eventVersions = new Map();
  }

  remember(data) {
    this.calendarVersions = new Map((data.calendars || []).map(c => [c.id, c.version]));
    this.eventVersions = new Map((data.events || []).map(e => [e.id, e.version]));
    return data;
  }

  async loadUserData() {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/calendar', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { location.assign('/auth/login?redirect=%2Fcalendar%2F'); return null; }
      const result = await response.json();
      return response.ok && result.success ? this.remember(result.data) : null;
    } catch (error) { console.error('[CALENDAR] Load failed:', error); return null; }
  }

  async send(action, data) {
    try {
      const payload = { ...data };
      if (['updateCalendar', 'deleteCalendar'].includes(action)) payload.version = this.calendarVersions.get(data.calId);
      if (['updateEvent', 'deleteEvent'].includes(action)) payload.version = this.eventVersions.get(data.eventId);
      const response = await (window.WDBoot?.fetch || fetch)('/api/calendar', { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: payload }) });
      if (response.status === 401) { location.assign('/auth/login?redirect=%2Fcalendar%2F'); return null; }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        console.error('[CALENDAR] ' + action + ' failed:', result.error || response.status);
        if (response.status === 409 && typeof showNotification === 'function')
          showNotification('Changed in another tab. Reload before saving.', 'error');
        return null;
      }
      return this.remember(result.data);
    } catch (error) { console.error('[CALENDAR] ' + action + ' failed:', error); return null; }
  }

  async put(action, data) {
    const result = await this.send(action, data);
    if (result && action !== 'updateSettings') this.scheduleThumbnail();
    return result;
  }
  scheduleThumbnail() {
    clearTimeout(this._thumbTimer);
    this._thumbTimer = setTimeout(async () => {
      const thumbnail = await captureCalendarThumbnail();
      if (thumbnail) await this.send('updateSettings', { settings: { calendarThumbnail: thumbnail } });
    }, 1500);
  }
  createCalendar(name, color, tagId) {
    return this.put('createCalendar', { name: name || '', color: color || null, tagId: tagId || null });
  }
  updateCalendar(calId, updates) { return this.put('updateCalendar', { calId, updates }); }
  deleteCalendar(calId) { return this.put('deleteCalendar', { calId }); }
  createEvent(event) { return this.put('createEvent', { event }); }
  updateEvent(eventId, event) { return this.put('updateEvent', { eventId, event }); }
  deleteEvent(eventId) { return this.put('deleteEvent', { eventId }); }
  updateSettings(settings) { return this.put('updateSettings', { settings }); }
}
const calendarStorage = new CalendarStorage();
