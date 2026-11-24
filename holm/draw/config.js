// Original Draw canvas defaults and tools. Holm owns the session cookie.
const APP_CONFIG = {
  name: 'Draw', version: '1.0.0', description: 'Drawing app for Workdeck',
  apiEndpoint: '/api/draw',
  themes: { default: 'light', available: ['light', 'dark'],
    storageKey: 'workdeck_theme', legacyKey: 'draw_theme' },
  autoSave: { enabled: true, interval: 30000 },
  canvas: { defaultBackground: '#ffffff', minZoom: 0.05, maxZoom: 8,
    zoomStep: 1.2, wheelZoomFactor: 1.0015 },
  tools: { strokeColor: '#1f2937', fillColor: 'transparent', strokeWidth: 2,
    fontSize: 20, fontFamily: 'Inter', arrowHeadLength: 16 },
};
function goToWorkdeck() { location.assign('/home'); }
