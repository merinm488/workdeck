// The original Todo editor uses these app settings. Session/hash settings
// are intentionally absent: Holm authenticates with its own cookie.
const APP_CONFIG = {
  name: 'Todo',
  layout: { default: 'cards', storageKey: 'todo_lists_layout' },
  themes: {
    default: 'light', available: ['light', 'dark'],
    storageKey: 'workdeck_theme', legacyKey: 'todo_theme',
  },
};
