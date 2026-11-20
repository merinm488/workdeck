// Build the public Holm landing and native email-sign-in account shell.
// No legacy workspace, Vercel API, access key, or user data is included.
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
// Only the Holm build advertises sign-in. The legacy/Vercel landing continues
// to say coming soon until the old app is retired.
const authURL = '/auth/login?redirect=%2Faccount';
const replacements = [
  ['<span class="lp-nav-status"><span class="lp-status-dot"></span> Email sign-in coming soon</span>', `<a class="lp-nav-status lp-signin" href="${authURL}">Sign in with email <span aria-hidden="true">↗</span></a>`],
  ['<span class="lp-hero-note">Email sign-in is on its way</span>', `<a class="lp-button lp-button-outline" href="${authURL}">Sign in with email <span aria-hidden="true">↗</span></a>`],
  ["We're preparing a new way to get in. Email sign-in will be available as the apps make their way to their new home.", 'Sign in with a code sent to your email to create your new Workdeck account. Apps will arrive one by one.'],
  ['<span class="lp-coming-soon" aria-label="Email sign-in coming soon">Email sign-in <span>coming soon ↗</span></span>', `<a class="lp-button lp-button-primary" href="${authURL}">Sign in with email <span aria-hidden="true">↗</span></a>`],
];
for (const [before, after] of replacements) {
  if (!landing.includes(before)) throw new Error(`Missing landing sign-in marker: ${before}`);
  landing = landing.replace(before, after);
}
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
// Only Todo is live so far. Keep every other showcase card informational.
const todoTag = '<span class="lp-app-tag">Focus &amp; finish</span>';
if (!landing.includes(todoTag)) throw new Error('Missing Todo catalogue card.');
landing = landing.replace(todoTag, todoTag + '<a class="lp-app-open" href="/todo/">Open Todo ↗</a>');
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
mkdirSync(join(web, 'todo'), { recursive: true });
mkdirSync(join(output, 'api'), { recursive: true });
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
writeFileSync(join(web, 'sw.js'), `const CACHE = 'workdeck-landing-v4';
const FILES = ['/', '/apps', '/account', '/todo/', '/todo/editor.js', '/todo/storage.js', '/todo/auth.js', '/todo/config.js', '/todo/themes.js', '/todo/styles.css', '/landing.css', '/landing.js', '/account.css', '/account.js', '/manifest.json', '/icons/icon-192x192.png', '/icons/icon-512x512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then(r => r || Response.error())));
});\n`);
cpSync(join(root, 'public/landing.css'), join(web, 'landing.css'));
cpSync(join(root, 'public/icons'), join(web, 'icons'), { recursive: true });
cpSync(join(root, 'public/og-image.jpg'), join(web, 'og-image.jpg'));
cpSync(join(root, 'public/manifest.json'), join(web, 'manifest.json'));
for (const file of ['account.html', 'account.css', 'account.js']) {
  cpSync(join(root, 'holm/auth', file), join(web, file));
}
for (const file of ['index.html', 'styles.css', 'editor.js', 'config.js', 'auth.js', 'storage.js']) {
  cpSync(join(root, 'holm/todo', file), join(web, 'todo', file));
}
// Keep Todo's existing light/dark/system theme implementation unchanged.
cpSync(join(root, 'todo/js/themes.js'), join(web, 'todo/themes.js'));
cpSync(join(root, 'holm/auth/main.js'), join(output, 'api/main.js'));
cpSync(join(root, 'holm/todo/api.js'), join(output, 'api/todo.js'));
console.log(`Holm landing, account and Todo package: ${output}`);
