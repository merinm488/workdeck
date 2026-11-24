// Original Slides editor geometry and theme; Holm owns sessions.
const APP_CONFIG = {
  name: 'Slides', version: '1.0.0', description: 'Slide deck editor for Workdeck',
  apiEndpoint: '/api/slides',
  themes: { default: 'light', available: ['light', 'dark'],
    storageKey: 'workdeck_theme', legacyKey: 'slides_theme' },
  autoSave: { enabled: true, interval: 30000 },
  slide: { width: 960, height: 540, defaultBackground: '#ffffff', defaultFontFamily: 'Inter' },
};
function goToWorkdeck() { location.assign('/home'); }
