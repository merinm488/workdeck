// Original Files theme, upload and folder palette; Holm provides identity.
const APP_CONFIG = {
  name: 'Files', version: '1.0.0', description: 'File manager for Workdeck',
  apiEndpoint: '/api/filebox', workdeckEndpoint: '/api/workdeck',
  themes: { default: 'light', available: ['light', 'dark'],
    storageKey: 'workdeck_theme', legacyKey: 'filebox_theme' },
  maxFileSize: 300 * 1024,
  pollInterval: 30000,
  folderColors: ['#FACC15', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4', '#F97316'],
};
function goToWorkdeck() { location.assign('/home'); }
