import path from 'node:path';

// Static UI-only fixtures use synthetic sessions. Production serves these two
// private templates through api/main.js; landing-sidebar.browser.mjs exercises
// that real router and Holm's static-first precedence instead of this adapter.
export function pageFixture(root, file) {
  if (file === path.join(root, 'home.html')) return path.join(root, '../api/home.html');
  if (file === path.join(root, 'index.html')) return path.join(root, '../api/landing.html');
  return file;
}
