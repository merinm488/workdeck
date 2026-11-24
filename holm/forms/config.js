// Forms UI constants from the original app; Holm handles identity.
const APP_CONFIG = {
  name: 'Forms', version: '1.0.0',
  description: 'Form builder and response collection for Workdeck',
  apiEndpoint: '/api/forms',
  themes: { default: 'light', available: ['light', 'dark'],
    storageKey: 'workdeck_theme', legacyKey: 'forms_theme' },
  autoSave: { enabled: true, interval: 30000 },
};
function goToWorkdeck() { location.assign('/home'); }
