// UI constants from the original Calendar config; Holm manages sessions.
const APP_CONFIG = {
  name: 'Calendar', version: '1.0.0', description: 'Calendars and events for Workdeck',
  apiEndpoint: '/api/calendar',
  themes: { default: 'light', available: ['light', 'dark'],
    storageKey: 'workdeck_theme', legacyKey: 'calendar_theme' },
  view: { defaultView: 'dayGridMonth', storageKey: 'calendar_view' },
  todo: { storageKey: 'calendar_show_todo', color: '#188038' },
  reminders: { tickMs: 30 * 1000, firedLogKey: 'calendar_fired_reminders',
    options: [5, 10, 15, 30, 60, 1440] },
  colors: ['#0284c7', '#FACC15', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#F97316'],
};
function goToWorkdeck() { location.assign('/home'); }
