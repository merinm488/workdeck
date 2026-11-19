// Build a static-only Holm preview from the public Workdeck landing view.
// No workspace, API, legacy sign-in, or user data is included in this package.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(process.argv[2] || '/tmp/workdeck-holm-landing');
if (output === root || output.startsWith(root + '/')) {
  throw new Error('Choose an output directory outside the repository.');
}
const web = join(output, 'web');
const source = readFileSync(join(root, 'public/index.html'), 'utf8');
const open = source.indexOf('<div id="landingView"');
const close = source.indexOf('<!-- ===== LEGACY LOGIN VIEW', open);
if (open < 0 || close < 0) throw new Error('Cannot find public landing section.');
let landing = source.slice(open, close).trim()
  .replace('class="lp hidden"', 'class="lp"');
const icons = [...landing.matchAll(/<span class="lp-app-icon" data-icon="([a-z]+)">[^<]*<\/span>/g)];
if (icons.length !== 11) throw new Error(`Expected 11 app cards; found ${icons.length}.`);
for (const match of icons) {
  const template = new RegExp(`<template id="wd-icon-${match[1]}">([\\s\\S]*?)<\\/template>`).exec(source);
  // Minutes is still an uncommitted app in the legacy tree. The public
  // catalogue can show its icon without committing that unrelated work.
  const fallback = match[1] === 'minutes'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8m-8 4h5"/></svg>'
    : null;
  if (!template && !fallback) throw new Error(`Missing icon for ${match[1]}`);
  landing = landing.replace(match[0], `<span class="lp-app-icon" data-icon="${match[1]}">${template ? template[1].trim() : fallback}</span>`);
}
const html = (apps = false) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#101622">
  <title>${apps ? 'Explore the apps — Workdeck' : 'Workdeck — Your work, in one place'}</title>
  <meta name="description" content="Meet Workdeck: a thoughtful home for your documents, ideas, plans and everyday tools. Explore all the apps before you sign in.">
  <link rel="canonical" href="https://mer-workdeck.fazt.sh/${apps ? 'apps' : ''}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Workdeck — Your work, in one place">
  <meta property="og:description" content="A thoughtful home for your documents, ideas, plans and everyday tools.">
  <meta property="og:url" content="https://mer-workdeck.fazt.sh/${apps ? 'apps' : ''}">
  <meta property="og:image" content="https://mer-workdeck.fazt.sh/og-image.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/landing.css">
  <script src="/landing.js"></script>
  <style>body{margin:0}html{scroll-behavior:smooth}</style>
</head>
<body>
${apps ? landing.replace('class="lp"', 'class="lp lp--apps"') : landing}
</body>
</html>
`;
rmSync(output, { recursive: true, force: true });
mkdirSync(join(web, 'icons'), { recursive: true });
writeFileSync(join(output, 'holm.json'), JSON.stringify({
  name: 'workdeck', title: 'Workdeck',
  description: 'Your work, in one place.', themeColor: '#facc15',
  web: { spa: false },
}, null, 2) + '\n');
writeFileSync(join(web, 'index.html'), html());
writeFileSync(join(web, 'apps.html'), html(true));
writeFileSync(join(web, 'landing.js'), `(() => {
  try {
    const pref = localStorage.getItem('workdeck_theme');
    const theme = pref === 'light' || pref === 'dark' ? pref : pref === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) { document.documentElement.setAttribute('data-theme', 'dark'); }
  addEventListener('DOMContentLoaded', () => {
    document.getElementById('landingThemeToggle')?.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('workdeck_theme', next); } catch (_) {}
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
})();\n`);
writeFileSync(join(web, 'sw.js'), `const CACHE = 'workdeck-landing-v1';
const FILES = ['/', '/apps', '/landing.css', '/landing.js', '/manifest.json', '/icons/icon-192x192.png', '/icons/icon-512x512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).origin !== self.location.origin || e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then(r => r || Response.error())));
});\n`);
cpSync(join(root, 'public/landing.css'), join(web, 'landing.css'));
cpSync(join(root, 'public/icons'), join(web, 'icons'), { recursive: true });
cpSync(join(root, 'public/og-image.jpg'), join(web, 'og-image.jpg'));
cpSync(join(root, 'public/manifest.json'), join(web, 'manifest.json'));
console.log(`Static Holm landing package: ${output}`);
