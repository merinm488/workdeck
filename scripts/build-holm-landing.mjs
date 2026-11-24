// Build the Holm public landing, signed-in dashboard and migrated app shells.
// The legacy Vercel tree is read-only input; no account key or data is bundled.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operations as extraMcpOperations } from '../holm/auth/mcp-extra-contract.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(process.argv[2] || '/tmp/workdeck-holm-landing');
if (output === root || output.startsWith(root + '/')) {
  throw new Error('Choose an output directory outside the repository.');
}
const web = join(output, 'web');
const source = readFileSync(join(root, 'public/index.html'), 'utf8');
const segment = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Cannot find workspace markup: ${start}`);
  return source.slice(a, b);
};
// Reuse the original dashboard and card templates, not a new approximation.
// Replace legacy account controls; Holm provides the consented MCP endpoint.
const homeView = segment('    <!-- ===== HOME VIEW ===== -->', '    <!-- ===== MODALS ===== -->')
  .replace('class="wd-home-view hidden"', 'class="wd-home-view"')
  .replace(segment('                                <button class="wd-dropdown-item" id="viewKeyBtn">', '                                <button class="wd-dropdown-item" id="logoutBtn">'),
    '                                <a class="wd-dropdown-item" href="/account">My account</a>\n                                <button class="wd-dropdown-item" id="connectAIBtn">Connect AI</button>\n');
const connectAIModal = segment('    <!-- Connect AI modal (MCP) -->', '    <!-- Change key modal -->')
  .replace('Enter your account key only on Workdeck’s authorization page, never in the AI client. Connections expire after 30 days and can be revoked here. Connecting a new client replaces the current connection.',
    'Sign in with your Holm account in the browser and review the requested tools before allowing access. Never enter a Workdeck key in your AI client. See connected clients and revoke access using Manage connections below.')
  .replace('                <p class="wd-modal-text" id="connectAIStatus" role="status">Loading connection…</p>\n                <div class="wd-modal-actions"><button class="wd-danger-btn" id="connectAIRevoke" hidden>Revoke connection</button><button class="wd-secondary-btn" id="connectAICloseBtn">Close</button></div>',
    '                <p class="wd-modal-text">Your connected AI clients (for example, pi) and their revoke buttons are shown on Holm’s secure connections page.</p>\n                <div class="wd-modal-actions"><a class="wd-secondary-btn" id="connectAIManage" href="/_holm/connect/connections" target="_blank" rel="noopener noreferrer">Manage connections</a><button class="wd-secondary-btn" id="connectAICloseBtn">Close</button></div>');
const homeMarkup = homeView
  + segment('    <!-- Rename modal -->', '    <!-- Key modal -->')
  + segment('    <!-- Add tag modal', '    <!-- Loading overlay -->')
  + connectAIModal
  + segment('    <!-- Loading overlay -->', '    <!-- Offscreen fabric frame doc');
const homeHTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Workdeck — Your files</title>
<link rel="stylesheet" href="/workdeck.css"><link rel="stylesheet" href="/js/wd-mentions.css">
<link rel="icon" href="/icons/favicon-32x32.png">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head><body><div class="wd-background"><div class="wd-bg-circle wd-bg-circle-top-right"></div><div class="wd-bg-circle wd-bg-circle-bottom-left"></div></div>
${homeMarkup}
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
<script src="/js/themes.js"></script><script src="/js/wd-links.js"></script>
<script src="/js/wd-mentions.js"></script><script src="/js/previews.js"></script>
<script src="/js/workdeck.js"></script><script src="/js/connect-ai.js"></script></body></html>`;
// Kanban's board UI is unchanged; remove only key-based login/account chrome.
let kanban = readFileSync(join(root, 'kanban/index.html'), 'utf8');
const cut = (start, end) => {
  const a = kanban.indexOf(start), b = kanban.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Kanban marker missing: ${start}`);
  kanban = kanban.slice(0, a) + kanban.slice(b);
};
cut('                    <button class="settings-dropdown-item" id="viewKeyBtn">', '                    <button class="settings-dropdown-item" id="logoutBtn">');
kanban = kanban.replace('                    <button class="settings-dropdown-item" id="logoutBtn">',
  '                    <a class="settings-dropdown-item" href="/account">My account</a>\n                    <button class="settings-dropdown-item" id="logoutBtn">');
cut('    <!-- Key Info Modal -->', '    <!-- Name Modal (new board / rename board) -->');
cut('    <!-- Authentication Check Script -->', '    <!-- Custom JavaScript -->');
let calendar = readFileSync(join(root, 'calendar/index.html'), 'utf8');
const cutCalendar = (start, end) => {
  const a = calendar.indexOf(start), b = calendar.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Calendar marker missing: ${start}`);
  calendar = calendar.slice(0, a) + calendar.slice(b);
};
cutCalendar('                    <button class="settings-dropdown-item" id="viewKeyBtn">', '                    <button class="settings-dropdown-item" id="logoutBtn">');
calendar = calendar.replace('                    <button class="settings-dropdown-item" id="logoutBtn">',
  '                    <a class="settings-dropdown-item" href="/account">My account</a>\n                    <button class="settings-dropdown-item" id="logoutBtn">');
cutCalendar('    <!-- Key Info Modal -->', '    <!-- Confirmation Modal (generic) -->');
cutCalendar('    <!-- Authentication Check Script -->', '    <!-- Custom JavaScript -->');
const sheetPage = (filename) => {
  let page = readFileSync(join(root, 'sheets', filename), 'utf8');
  const cutPart = (start, end) => {
    const a = page.indexOf(start), b = page.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Sheets ${filename} marker missing: ${start}`);
    page = page.slice(0, a) + page.slice(b);
  };
  if (filename === 'index.html') {
    cutPart('                                <button class="settings-dropdown-item" id="viewKeyBtn">',
      '                                <button class="settings-dropdown-item" id="logoutBtn">');
    page = page.replace('                                <button class="settings-dropdown-item" id="logoutBtn">',
      '                                <a class="settings-dropdown-item" href="/account">My account</a>\n                                <button class="settings-dropdown-item" id="logoutBtn">');
    cutPart('    <!-- Key Info Modal -->', '    <!-- Delete Confirmation Modal -->');
    cutPart('    <!-- Delete Account Confirmation Modal -->', '    <!-- Loading Overlay -->');
    cutPart('    <!-- Authentication Check Script -->', '    <!-- Scripts -->');
  } else if (filename === 'editor.html') {
    cutPart('                    <button class="settings-dropdown-item" id="viewKeyBtn">',
      '                    <button class="settings-dropdown-item" id="shareBtn">');
    cutPart('                    <button class="settings-dropdown-item text-red-600 dark:text-red-400" id="deleteAccountBtn">',
      '                    <button class="settings-dropdown-item" id="logoutBtn">');
    page = page.replace('                    <button class="settings-dropdown-item" id="logoutBtn">',
      '                    <a class="settings-dropdown-item" href="/account">My account</a>\n                    <button class="settings-dropdown-item" id="logoutBtn">');
    cutPart('    <!-- Key Info Modal -->', '    <!-- Rename Reminder Modal -->');
    cutPart('    <!-- Authentication Check Script -->', '    <!-- Univer JS is loaded in <head>');
    page = page.replace('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', '/sheets/js/vendor-xlsx.js');
  }
  return page.replaceAll('https://workdeck-amber-tau.vercel.app/', 'https://mer-workdeck.fazt.sh/');
};
const formPage = (filename) => {
  let page = readFileSync(join(root, 'forms', filename), 'utf8');
  const cutPart = (start, end) => {
    const a = page.indexOf(start), b = page.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Forms ${filename} marker missing: ${start}`);
    page = page.slice(0, a) + page.slice(b);
  };
  if (filename === 'index.html') {
    cutPart('                    <button class="settings-dropdown-item" id="viewKeyBtn">',
      '                    <button class="settings-dropdown-item" id="logoutBtn">');
    page = page.replace('                    <button class="settings-dropdown-item" id="logoutBtn">',
      '                    <a class="settings-dropdown-item" href="/account">My account</a>\n                    <button class="settings-dropdown-item" id="logoutBtn">');
    cutPart('    <!-- Key Info Modal -->', '    <!-- Rename Form Modal -->');
    cutPart('    <!-- Authentication Check Script -->', '    <!-- Custom JavaScript -->');
  } else if (filename === 'editor.html') {
    cutPart('                    <button class="settings-dropdown-item" id="viewKeyBtn">',
      '                    <button class="settings-dropdown-item" id="shareBtn">');
    cutPart('                    <button class="settings-dropdown-item text-red-600" id="deleteAccountBtn">',
      '                    <button class="settings-dropdown-item" id="logoutBtn">');
    page = page.replace('                    <button class="settings-dropdown-item" id="logoutBtn">',
      '                    <a class="settings-dropdown-item" href="/account">My account</a>\n                    <button class="settings-dropdown-item" id="logoutBtn">');
    cutPart('    <!-- Key Info Modal -->', '    <!-- Clear Responses Confirmation Modal -->');
    cutPart('    <!-- Authentication Check Script -->', '    <!-- Fatal: form library failed to load');
  }
  return page;
};
const slidePage = (filename) => {
  let page = readFileSync(join(root, 'slides', filename), 'utf8');
  const cutPart = (start, end) => {
    const a = page.indexOf(start), b = page.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Slides ${filename} marker missing: ${start}`);
    page = page.slice(0, a) + page.slice(b);
  };
  if (filename === 'index.html') {
    cutPart('                    <button class="settings-dropdown-item" id="viewKeyBtn">',
      '                    <button class="settings-dropdown-item" id="logoutBtn">');
    page = page.replace('                    <button class="settings-dropdown-item" id="logoutBtn">',
      '                    <a class="settings-dropdown-item" href="/account">My account</a>\n                    <button class="settings-dropdown-item" id="logoutBtn">');
    cutPart('    <!-- Key Info Modal -->', '    <!-- Rename Deck Modal -->');
    cutPart('    <!-- Authentication Check Script -->', '    <!-- Custom JavaScript -->');
  } else if (filename === 'editor.html') {
    cutPart('                    <button class="settings-dropdown-item" id="viewKeyBtn">',
      '                    <button class="settings-dropdown-item" id="shareBtn">');
    cutPart('                    <button class="settings-dropdown-item text-red-600" id="deleteAccountBtn">',
      '                    <button class="settings-dropdown-item" id="logoutBtn">');
    page = page.replace('                    <button class="settings-dropdown-item" id="logoutBtn">',
      '                    <a class="settings-dropdown-item" href="/account">My account</a>\n                    <button class="settings-dropdown-item" id="logoutBtn">');
    cutPart('    <!-- Key Info Modal -->', '    <!-- Rename Modal (click the deck title to open) -->');
    cutPart('    <!-- Authentication Check —', '    <!-- Slide sorter thumbnail');
  }
  return page;
};
const drawPage = (filename) => {
  let page = readFileSync(join(root, 'draw', filename), 'utf8');
  const cutPart = (start, end) => {
    const a = page.indexOf(start), b = page.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Draw ${filename} marker missing: ${start}`);
    page = page.slice(0, a) + page.slice(b);
  };
  if (filename === 'index.html') {
    cutPart('                    <button class="settings-dropdown-item" id="viewKeyBtn">',
      '                    <button class="settings-dropdown-item" id="logoutBtn">');
    page = page.replace('                    <button class="settings-dropdown-item" id="logoutBtn">',
      '                    <a class="settings-dropdown-item" href="/account">My account</a>\n                    <button class="settings-dropdown-item" id="logoutBtn">');
    cutPart('    <!-- Key Info Modal -->', '    <!-- Rename Drawing Modal -->');
    cutPart('    <!-- Authentication Check Script -->', '    <!-- Custom JavaScript -->');
  } else if (filename === 'editor.html') {
    cutPart('                    <button class="settings-dropdown-item" id="viewKeyBtn">',
      '                    <button class="settings-dropdown-item" id="shareBtn">');
    cutPart('                    <button class="settings-dropdown-item text-red-600" id="deleteAccountBtn">',
      '                    <button class="settings-dropdown-item" id="logoutBtn">');
    page = page.replace('                    <button class="settings-dropdown-item" id="logoutBtn">',
      '                    <a class="settings-dropdown-item" href="/account">My account</a>\n                    <button class="settings-dropdown-item" id="logoutBtn">');
    cutPart('    <!-- Key Info Modal -->', '    <!-- Rename Modal (click the drawing title to open) -->');
    cutPart('    <!-- Authentication Check —', '    <!-- Custom JavaScript (plain script tags');
  }
  return page;
};
let filePage = readFileSync(join(root, 'files/index.html'), 'utf8');
const cutFiles = (start, end) => {
  const a = filePage.indexOf(start), b = filePage.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Files markup missing: ${start}`);
  filePage = filePage.slice(0, a) + filePage.slice(b);
};
cutFiles('                                <button class="fb-dropdown-item" id="fbViewKeyBtn">',
  '                                <div class="fb-dropdown-divider"></div>');
filePage = filePage.replace('                                <div class="fb-dropdown-divider"></div>',
  '                                <a class="fb-dropdown-item" href="/account">My account</a>\n                                <div class="fb-dropdown-divider"></div>');
cutFiles('    <!-- Access key -->', '    <!-- Entry guard —');
cutFiles('    <!-- Entry guard —', '    <!-- ===== TEMPLATES');
filePage = filePage
  .replaceAll('https://releases.transloadit.com/uppy/v4.18.3/uppy.min.css', '/files/vendor-uppy.min.css')
  .replaceAll('https://releases.transloadit.com/uppy/v4.18.3/uppy.min.js', '/files/js/vendor-uppy.min.js')
  .replaceAll('[a-z0-9]{14,}', '[A-Za-z0-9_-]{8,128}');
let blogPage = readFileSync(join(root, 'blog/index.html'), 'utf8');
const cutBlog = (start, end) => {
  const a = blogPage.indexOf(start), b = blogPage.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Blog markup missing: ${start}`);
  blogPage = blogPage.slice(0, a) + blogPage.slice(b);
};
cutBlog('                    <button type="button" id="viewKeyBtn"',
  '                    <button type="button" id="deleteAccountBtn"');
cutBlog('                    <button type="button" id="deleteAccountBtn"',
  '                    <button type="button" id="logoutBtn"');
blogPage = blogPage.replace('                    <button type="button" id="logoutBtn"',
  '                    <a class="blog-menu-item" href="/account">My account</a>\n                    <button type="button" id="logoutBtn"');
cutBlog('    <!-- ===== VIEW KEY MODAL', '    <!-- ===== TOAST');
blogPage = blogPage.replaceAll('https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css', '/blog/vendor-quill.snow.css')
  .replaceAll('https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js', '/blog/js/vendor-quill.js');

const open = source.indexOf('<div id="landingView"');
const close = source.indexOf('<!-- ===== LEGACY LOGIN VIEW', open);
if (open < 0 || close < 0) throw new Error('Cannot find public landing section.');
let landing = source.slice(open, close).trim()
  .replace('class="lp hidden"', 'class="lp"');
// Only the Holm build advertises sign-in. The legacy/Vercel landing continues
// to say coming soon until the old app is retired.
const authURL = '/auth/login?redirect=%2Faccount';
const replacements = [
  ['<span class="lp-nav-status"><span class="lp-status-dot"></span> Email sign-in coming soon</span>', '<div class="lp-auth-nav"><a id="landingAccountLink" class="lp-nav-status lp-signin" href="/account">Account</a><button type="button" id="landingSignOut" class="lp-nav-status lp-signout" hidden>Sign out</button></div>'],
  ['<span class="lp-hero-note">Email sign-in is on its way</span>', `<a id="landingHeroSignIn" class="lp-button lp-button-outline" href="${authURL}">Sign in <span aria-hidden="true">↗</span></a>`],
  ["We're preparing a new way to get in. Email sign-in will be available as the apps make their way to their new home.", 'Sign in to create your Workdeck account. All the Workdeck apps, including Blog, are available on Holm now.'],
  ['<span class="lp-coming-soon" aria-label="Email sign-in coming soon">Email sign-in <span>coming soon ↗</span></span>', `<a id="landingOutroSignIn" class="lp-button lp-button-primary" href="${authURL}">Sign in <span aria-hidden="true">↗</span></a>`],
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
// Only migrated apps link to an editor. Other showcase cards stay informational.
for (const [tag, href, title] of [
  ['Focus &amp; finish', '/todo/', 'Todo'],
  ['Track &amp; move', '/kanban/', 'Kanban'],
  ['Meet &amp; remember', '/minutes/', 'Minutes'],
  ['Schedule &amp; see', '/calendar/', 'Calendar'],
  ['Write &amp; think', '/docs/', 'Docs'],
  ['Plan &amp; calculate', '/sheets/', 'Sheets'],
  ['Ask &amp; collect', '/forms/', 'Forms'],
  ['Present &amp; share', '/slides/', 'Slides'],
  ['Sketch &amp; explore', '/draw/', 'Draw'],
  ['Store &amp; find', '/files/', 'Files'],
  ['Publish &amp; express', '/blog/', 'Blog'],
]) {
  const marker = `<span class="lp-app-tag">${tag}</span>`;
  if (!landing.includes(marker)) throw new Error(`Missing ${title} catalogue card.`);
  landing = landing.replace(marker, marker + `<a class="lp-app-open" href="${href}">Open ${title} ↗</a>`);
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
  <link rel="stylesheet" href="/landing-nav.css">
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
mkdirSync(join(web, 'kanban/config'), { recursive: true });
mkdirSync(join(web, 'kanban/js'), { recursive: true });
mkdirSync(join(web, 'minutes'), { recursive: true });
mkdirSync(join(web, 'calendar/config'), { recursive: true });
mkdirSync(join(web, 'calendar/js'), { recursive: true });
mkdirSync(join(web, 'docs'), { recursive: true });
mkdirSync(join(web, 'sheets/config'), { recursive: true });
mkdirSync(join(web, 'sheets/js'), { recursive: true });
mkdirSync(join(web, 'forms/config'), { recursive: true });
mkdirSync(join(web, 'forms/js'), { recursive: true });
mkdirSync(join(web, 'slides/config'), { recursive: true });
mkdirSync(join(web, 'slides/js'), { recursive: true });
mkdirSync(join(web, 'draw/config'), { recursive: true });
mkdirSync(join(web, 'draw/js'), { recursive: true });
mkdirSync(join(web, 'files/config'), { recursive: true });
mkdirSync(join(web, 'files/js'), { recursive: true });
mkdirSync(join(web, 'blog/config'), { recursive: true });
mkdirSync(join(web, 'blog/js'), { recursive: true });
mkdirSync(join(web, 'js'), { recursive: true });
mkdirSync(join(output, 'api'), { recursive: true });
writeFileSync(join(output, 'holm.json'), JSON.stringify({
  name: 'workdeck', title: 'Workdeck',
  description: 'Your work, in one place.', themeColor: '#facc15',
  web: { spa: false },
  surfaces: { web: { renderer: 'off' } },
}, null, 2) + '\n');
writeFileSync(join(web, 'index.html'), html());
writeFileSync(join(web, 'home.html'), homeHTML);
writeFileSync(join(web, 'kanban/index.html'), kanban);
writeFileSync(join(web, 'calendar/index.html'), calendar);
writeFileSync(join(web, 'sheets/index.html'), sheetPage('index.html'));
writeFileSync(join(web, 'sheets/editor.html'), sheetPage('editor.html'));
writeFileSync(join(web, 'sheets/shared.html'), sheetPage('shared.html'));
for (const file of ['index.html', 'editor.html', 'shared.html'])
  writeFileSync(join(web, 'forms', file), formPage(file));
for (const file of ['index.html', 'editor.html', 'shared.html'])
  writeFileSync(join(web, 'slides', file), slidePage(file));
for (const file of ['index.html', 'editor.html', 'shared.html'])
  writeFileSync(join(web, 'draw', file), drawPage(file));
writeFileSync(join(web, 'files/index.html'), filePage);
writeFileSync(join(web, 'blog/index.html'), blogPage);
cpSync(join(root, 'holm/blog/public.html'), join(web, 'blog-public.html'));
cpSync(join(root, 'public/blog.css'), join(web, 'blog.css'));
writeFileSync(join(web, 'apps.html'), html(true));
writeFileSync(join(web, 'landing.js'), `(() => {
  try {
    const pref = localStorage.getItem('workdeck_theme');
    const theme = pref === 'light' || pref === 'dark' ? pref : pref === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) { document.documentElement.setAttribute('data-theme', 'dark'); }
  addEventListener('DOMContentLoaded', async () => {
    document.getElementById('landingThemeToggle')?.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('workdeck_theme', next); } catch (_) {}
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const link = document.getElementById('landingAccountLink');
    if (!link) return; // Account page handles its own signed-in view.
    const signOut = document.getElementById('landingSignOut');
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Session check failed');
      const session = await response.json();
      if (session.member) {
        // Holm serves web/index.html directly before api/main.js, so the
        // signed-in landing must navigate to the dashboard client-side.
        if (location.pathname === '/') { location.replace('/home'); return; }
        link.textContent = 'My account';
        link.href = '/account';
        signOut.hidden = false;
        for (const id of ['landingHeroSignIn', 'landingOutroSignIn']) {
          const action = document.getElementById(id);
          if (action) { action.href = '/home'; action.firstChild.textContent = 'Open Workdeck '; }
        }
        signOut.addEventListener('click', async () => {
          signOut.disabled = true;
          try {
            const result = await fetch(session.logoutURL, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!result.ok) throw new Error('Sign out failed');
            location.reload();
          } catch (_) {
            signOut.disabled = false;
            alert('Could not sign out. Please try again.');
          }
        });
      } else {
        link.textContent = 'Sign in';
        link.href = session.loginURL;
        for (const id of ['landingHeroSignIn', 'landingOutroSignIn']) {
          const action = document.getElementById(id);
          if (action) action.href = session.loginURL;
        }
      }
    } catch (_) { /* Account link remains available if the session check fails. */ }
  });
})();\n`);
writeFileSync(join(web, 'sw.js'), `const CACHE = 'workdeck-landing-v15';
const FILES = ['/', '/apps', '/account', '/todo/', '/todo/editor.js', '/todo/storage.js', '/todo/auth.js', '/todo/config.js', '/todo/themes.js', '/todo/styles.css', '/landing.css', '/landing-nav.css', '/landing.js', '/account.css', '/account.js', '/manifest.json', '/icons/icon-192x192.png', '/icons/icon-512x512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('workdeck-landing-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Nested apps own their own service workers and caches. Never intercept
  // their navigations or assets from the site-wide landing worker.
  if (url.origin !== self.location.origin || e.request.method !== 'GET' ||
      ['/docs/', '/sheets/', '/files/'].some(path => url.pathname.startsWith(path)) ||
      url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then(r => r || Response.error())));
});\n`);
cpSync(join(root, 'public/landing.css'), join(web, 'landing.css'));
cpSync(join(root, 'public/workdeck.css'), join(web, 'workdeck.css'));
for (const [from, to] of [
  ['public/js/themes.js', 'themes.js'],
  ['holm/auth/previews.js', 'previews.js'],
  ['public/js/wd-mentions.css', 'wd-mentions.css'],
  ['holm/auth/links.js', 'wd-links.js'],
  ['holm/auth/mentions.js', 'wd-mentions.js'],
  ['holm/auth/dashboard.js', 'workdeck.js'],
]) cpSync(join(root, from), join(web, 'js', to));
cpSync(join(root, 'holm/auth/landing-nav.css'), join(web, 'landing-nav.css'));
cpSync(join(root, 'holm/auth/connect-ai.js'), join(web, 'js/connect-ai.js'));
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
for (const file of ['auth.js', 'storage.js', 'app.js', 'board.js']) {
  cpSync(join(root, 'holm/kanban', file), join(web, 'kanban/js', file));
}
cpSync(join(root, 'kanban/js/themes.js'), join(web, 'kanban/js/themes.js'));
cpSync(join(root, 'kanban/styles.css'), join(web, 'kanban/styles.css'));
cpSync(join(root, 'holm/kanban/config.js'), join(web, 'kanban/config/config.js'));
cpSync(join(root, 'minutes/index.html'), join(web, 'minutes/index.html'));
cpSync(join(root, 'minutes/styles.css'), join(web, 'minutes/styles.css'));
cpSync(join(root, 'holm/minutes/app.js'), join(web, 'minutes/app.js'));
for (const file of ['auth.js', 'storage.js', 'config.js', 'editor.js']) {
  const dest = file === 'config.js' ? join(web, 'calendar/config', file) : join(web, 'calendar/js', file);
  cpSync(join(root, 'holm/calendar', file), dest);
}
for (const file of ['themes.js', 'snapshot.js', 'vendor-ical.js']) {
  cpSync(join(root, 'calendar/js', file), join(web, 'calendar/js', file));
}
cpSync(join(root, 'calendar/styles.css'), join(web, 'calendar/styles.css'));
for (const file of ['styles.css', 'home.css', 'manifest.json'])
  cpSync(join(root, 'sheets', file), join(web, 'sheets', file));
cpSync(join(root, 'sheets/icons'), join(web, 'sheets/icons'), { recursive: true });
cpSync(join(root, 'sheets/config/config.js'), join(web, 'sheets/config/config.js'));
for (const file of ['app.js', 'home.js', 'auth.js', 'storage.js'])
  cpSync(join(root, 'holm/sheets', file), join(web, 'sheets/js', file));
for (const file of ['themes.js', 'spreadsheet.js', 'shared.js', 'pwa.js'])
  cpSync(join(root, 'sheets/js', file), join(web, 'sheets/js', file));
cpSync(join(root, 'holm/sheets/vendor-xlsx.js'), join(web, 'sheets/js/vendor-xlsx.js'));
cpSync(join(root, 'holm/sheets/SHEETJS-LICENSE.txt'), join(web, 'sheets/SHEETJS-LICENSE.txt'));
cpSync(join(root, 'holm/sheets/service-worker.js'), join(web, 'sheets/service-worker.js'));
cpSync(join(root, 'forms/styles.css'), join(web, 'forms/styles.css'));
for (const file of ['config.js']) cpSync(join(root, 'holm/forms', file), join(web, 'forms/config', file));
for (const file of ['home.js', 'editor.js', 'auth.js', 'storage.js'])
  cpSync(join(root, 'holm/forms', file), join(web, 'forms/js', file));
for (const file of ['themes.js', 'responses.js', 'shared.js'])
  cpSync(join(root, 'forms/js', file), join(web, 'forms/js', file));
cpSync(join(root, 'slides/styles.css'), join(web, 'slides/styles.css'));
cpSync(join(root, 'slides/icons'), join(web, 'slides/icons'), { recursive: true });
cpSync(join(root, 'slides/templates'), join(web, 'slides/templates'), { recursive: true });
cpSync(join(root, 'holm/slides/config.js'), join(web, 'slides/config/config.js'));
for (const file of ['home.js', 'editor.js', 'auth.js', 'storage.js'])
  cpSync(join(root, 'holm/slides', file), join(web, 'slides/js', file));
for (const file of ['themes.js', 'shared.js'])
  cpSync(join(root, 'slides/js', file), join(web, 'slides/js', file));
cpSync(join(root, 'draw/styles.css'), join(web, 'draw/styles.css'));
cpSync(join(root, 'draw/icons'), join(web, 'draw/icons'), { recursive: true });
cpSync(join(root, 'holm/draw/config.js'), join(web, 'draw/config/config.js'));
for (const file of ['home.js', 'editor.js', 'auth.js', 'storage.js'])
  cpSync(join(root, 'holm/draw', file), join(web, 'draw/js', file));
for (const file of ['themes.js', 'shared.js'])
  cpSync(join(root, 'draw/js', file), join(web, 'draw/js', file));
for (const file of ['styles.css', 'manifest.json'])
  cpSync(join(root, 'files', file), join(web, 'files', file));
cpSync(join(root, 'files/icons'), join(web, 'files/icons'), { recursive: true });
cpSync(join(root, 'holm/files/config.js'), join(web, 'files/config/config.js'));
for (const file of ['auth.js', 'storage.js', 'main.js', 'viewer.js', 'uploads.js', 'vendor-esm.js'])
  cpSync(join(root, 'holm/files', file), join(web, 'files/js', file));
for (const file of ['themes.js', 'thumbs.js', 'pwa.js'])
  cpSync(join(root, 'files/js', file), join(web, 'files/js', file));
for (const file of ['vendor-uppy.min.js', 'pdf.min.mjs', 'pdf.worker.min.mjs'])
  cpSync(join(root, 'holm/files', file), join(web, 'files/js', file));
for (const file of ['vendor-uppy.min.css', 'UPPY-LICENSE.txt', 'PDFJS-LICENSE.txt'])
  cpSync(join(root, 'holm/files', file), join(web, 'files', file));
cpSync(join(root, 'holm/files/service-worker.js'), join(web, 'files/service-worker.js'));
cpSync(join(root, 'blog/styles.css'), join(web, 'blog/styles.css'));
cpSync(join(root, 'blog/js/themes.js'), join(web, 'blog/js/themes.js'));
cpSync(join(root, 'holm/blog/config.js'), join(web, 'blog/config/config.js'));
for (const file of ['app.js', 'auth.js', 'storage.js', 'editor.js', 'vendor-quill.js'])
  cpSync(join(root, 'holm/blog', file), join(web, 'blog/js', file));
cpSync(join(root, 'holm/blog/vendor-quill.snow.css'), join(web, 'blog/vendor-quill.snow.css'));
cpSync(join(root, 'holm/blog/QUILL-LICENSE.txt'), join(web, 'blog/QUILL-LICENSE.txt'));
cpSync(join(root, 'holm/blog/public-reader.js'), join(web, 'js/blog.js'));
// Compile a Holm-only React variant in a temporary tree. Never overwrite the
// legacy docs-src source or its existing build output and never ship node_modules.
const docsBuild = mkdtempSync(join(tmpdir(), 'workdeck-holm-docs-'));
try {
  cpSync(join(root, 'docs-src/src'), join(docsBuild, 'src'), { recursive: true });
  cpSync(join(root, 'docs-src/public'), join(docsBuild, 'public'), { recursive: true });
  for (const file of ['vite.config.js', 'postcss.config.js', 'tailwind.config.js', 'package.json'])
    cpSync(join(root, 'docs-src', file), join(docsBuild, file));
  symlinkSync(join(root, 'docs-src/node_modules'), join(docsBuild, 'node_modules'), 'dir');
  for (const file of ['App.jsx', 'main.jsx', 'hooks/useAuth.js', 'hooks/useDocs.js',
    'hooks/useTheme.js', 'lib/db.js', 'components/Login.jsx', 'components/UserDisplay.jsx']) {
    cpSync(join(root, 'holm/docs-src/src', file), join(docsBuild, 'src', file));
  }
  const index = readFileSync(join(root, 'docs-src/index.html'), 'utf8')
    .replaceAll('https://docs-ecru-one.vercel.app/', 'https://mer-workdeck.fazt.sh/docs/')
    .replaceAll('passwordless authentication using custom keys', 'Holm sign-in')
    .replace('href="/node_modules/@uiw/react-md-editor/markdown-editor.css"', 'href="/docs/assets/markdown-editor.css"')
    .replaceAll('href="/icon-192.png"', 'href="/docs/icon-192.png"');
  // CSS is imported by the Holm main.jsx and bundled by Vite; never link a
  // non-existent /node_modules route in the packaged site.
  // Changing the Docs HTML also changes Workbox's precache revision. On
  // upgrade, clients whose Docs cache was erased by the old root worker get
  // a fresh copy of the navigation shell.
  writeFileSync(join(docsBuild, 'index.html'), index.replace('    <link rel="stylesheet" href="/docs/assets/markdown-editor.css" />\n', '')
    .replace('  <body>', '  <body>\n    <!-- Holm Docs: refreshed navigation precache -->'));
  execFileSync(join(root, 'docs-src/node_modules/.bin/vite'), ['build'], {
    cwd: docsBuild, timeout: 120_000, maxBuffer: 10_000_000,
  });
  cpSync(join(docsBuild, 'dist'), join(web, 'docs'), { recursive: true });
} finally {
  rmSync(docsBuild, { recursive: true, force: true });
}
cpSync(join(root, 'holm/auth/main.js'), join(output, 'api/main.js'));
cpSync(join(root, 'holm/auth/mcp.js'), join(output, 'api/mcp.js'));
cpSync(join(root, 'holm/auth/mcp-extra.js'), join(output, 'api/mcp-extra.js'));
const mcpContract = JSON.parse(readFileSync(join(root, 'holm/auth/mcp-contract.json'), 'utf8'));
for (const [key, operation] of Object.entries(extraMcpOperations)) {
  if (key in mcpContract.operations) throw new Error(`Duplicate MCP operation: ${key}`);
  mcpContract.operations[key] = operation;
}
writeFileSync(join(output, 'api/contract.json'), JSON.stringify(mcpContract, null, 2) + '\n');
cpSync(join(root, 'holm/auth/workspace.js'), join(output, 'api/workspace.js'));
cpSync(join(root, 'holm/todo/api.js'), join(output, 'api/todo.js'));
cpSync(join(root, 'holm/kanban/api.js'), join(output, 'api/kanban.js'));
cpSync(join(root, 'holm/minutes/api.js'), join(output, 'api/minutes.js'));
cpSync(join(root, 'holm/calendar/api.js'), join(output, 'api/calendar.js'));
cpSync(join(root, 'holm/docs/api.js'), join(output, 'api/docs.js'));
cpSync(join(root, 'holm/sheets/api.js'), join(output, 'api/sheets.js'));
cpSync(join(root, 'holm/forms/api.js'), join(output, 'api/forms.js'));
cpSync(join(root, 'holm/slides/api.js'), join(output, 'api/slides.js'));
cpSync(join(root, 'holm/draw/api.js'), join(output, 'api/draw.js'));
cpSync(join(root, 'holm/files/api.js'), join(output, 'api/filebox.js'));
cpSync(join(root, 'holm/blog/api.js'), join(output, 'api/blog.js'));
cpSync(join(root, 'holm/blog/posts.js'), join(output, 'api/posts.js'));
console.log(`Holm landing, account, Todo, Kanban, Minutes, Calendar, Docs, Sheets, Forms, Slides, Draw, Files and Blog package: ${output}`);
