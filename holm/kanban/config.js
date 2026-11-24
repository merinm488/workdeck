// Same palette and UI settings as the legacy Kanban app. Holm provides auth.
const APP_CONFIG = {
  name: 'Kanban', version: '1.0.0', description: 'Kanban boards for Workdeck',
  apiEndpoint: '/api/kanban',
  themes: { default: 'dark', available: ['light', 'dark'],
    storageKey: 'workdeck_theme', legacyKey: 'kanban_theme' },
  priorities: [
    { id: 'high', color: '#dc2626', label: 'High' },
    { id: 'medium', color: '#b45309', label: 'Medium' },
    { id: 'low', color: '#15803d', label: 'Low' },
  ],
  currentUser: { id: 'me', label: 'Me', avatar: '' },
};
function goToWorkdeck() { location.assign('/home'); }
