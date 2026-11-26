// Build the Holm public landing, signed-in dashboard and migrated app shells.
// The legacy Vercel tree is read-only input; no account key or data is bundled.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operations as extraMcpOperations } from '../holm/auth/mcp-extra-contract.js';
import { buildThemeTokens, withSuiteTheme } from '../holm/auth/theme-build.mjs';
import { withSheetEditorTheme, withSharedSheetTheme } from '../holm/sheets/theme-build.mjs';
import { withSheetAutosave } from '../holm/sheets/autosave-build.mjs';
import { withSheetEditorChrome } from '../holm/sheets/editor-build.mjs';
import { homeComponentCSS, homeIconsJS, withHomeUI } from '../holm/auth/home-ui-build.mjs';
import { withoutDocPins } from '../holm/docs-src/pin-free-build.mjs';
import { accountAvatar, withAccountAvatars, withDocsAccountAvatar } from '../holm/auth/account-build.mjs';

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
const themeChoices = [
  ['light', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'],
  ['dark', '<path d="M20.5 15.5A9 9 0 0 1 8.5 3.5a9 9 0 1 0 12 12Z"/>'],
  ['system', '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8m-4-3v3"/>'],
].map(([theme, icon]) => `<button type="button" class="wd-theme-choice" data-theme="${theme}" aria-label="${theme[0].toUpperCase() + theme.slice(1)} theme" aria-pressed="false" title="${theme[0].toUpperCase() + theme.slice(1)} theme"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`).join('');
// Render the dashboard account menu in the HTML itself. Keep the old theme
// controls hidden for the dashboard's existing theme persistence handlers, but
// never depend on a second script to replace visible legacy controls at runtime.
const legacyTheme = segment('                                <div class="wd-theme-container">', '                                <button class="wd-dropdown-item" id="viewKeyBtn">');
const homeView = segment('    <!-- ===== HOME VIEW ===== -->', '    <!-- ===== MODALS ===== -->')
  .replace('class="wd-home-view hidden"', 'class="wd-home-view"')
  .replace('id="settingsBtn" class="wd-icon-btn"', 'id="settingsBtn" class="wd-icon-btn wd-account-trigger"')
  .replace('id="settingsDropdown" class="wd-dropdown wd-dropdown-right"', 'id="settingsDropdown" class="wd-dropdown wd-dropdown-right wd-account-panel"')
  .replace(legacyTheme, `                                <div class="wd-theme-setting" aria-label="Theme"><span>Theme</span><div class="wd-theme-options" role="group" aria-label="Theme preference">${themeChoices}</div></div>\n                                <div class="wd-theme-container wd-legacy-theme" style="display:none">${legacyTheme.slice('                                <div class="wd-theme-container">'.length)}`)
  .replace(segment('                                <button class="wd-dropdown-item" id="viewKeyBtn">', '                                <button class="wd-dropdown-item" id="logoutBtn">'),
    '                                <a class="wd-dropdown-item wd-account-item" href="/auth/account?redirect=%2Fhome">Your sign-ins</a>\n                                <button class="wd-dropdown-item" id="connectAIBtn">Connect AI</button>\n')
  .replace(/(<button class="wd-dropdown-item" id="logoutBtn">)[\s\S]*?(<span class="wd-item-text">Logout<\/span>)/, '$1$2');
const connectAIModal = segment('    <!-- Connect AI modal (MCP) -->', '    <!-- Change key modal -->')
  .replace('                <button class="wd-modal-close" id="connectAIClose" aria-label="Close">&times;</button>\n', '')
  .replace('Enter your account key only on Workdeck’s authorization page, never in the AI client. Connections expire after 30 days and can be revoked here. Connecting a new client replaces the current connection.',
    'Sign in with your Holm account in the browser and review the requested tools before allowing access.')
  .replace('                <p class="wd-modal-text" id="connectAIStatus" role="status">Loading connection…</p>\n                <div class="wd-modal-actions"><button class="wd-danger-btn" id="connectAIRevoke" hidden>Revoke connection</button><button class="wd-secondary-btn" id="connectAICloseBtn">Close</button></div>',
    '                <div class="wd-modal-actions"><a class="wd-secondary-btn" id="connectAIManage" href="/_holm/connect/connections" target="_blank" rel="noopener noreferrer">Manage Connections</a><button class="wd-secondary-btn" id="connectAICloseBtn">Close</button></div>');
const homeMarkup = homeView
  + segment('    <!-- Rename modal -->', '    <!-- Key modal -->')
  + segment('    <!-- Add tag modal', '    <!-- Loading overlay -->')
  + connectAIModal
  + segment('    <!-- Loading overlay -->', '    <!-- Offscreen fabric frame doc')
  // The card renderer reads this template to render Slides and Draw in sandboxed
  // iframes. Keep it alongside the card templates when assembling Holm's home.
  + segment('    <!-- Offscreen fabric frame doc', '    <!-- Scripts -->');
const homeHTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Workdeck — Your files</title>
<link rel="stylesheet" href="/workdeck.css"><link rel="stylesheet" href="/js/wd-mentions.css">
<style>${readFileSync(join(root, 'holm/auth/settings-menu.css'), 'utf8')}</style>
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
    page = page.replace('<html lang="en">', '<html lang="en" data-wd-sheets-home="4">');
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
    page = page.replace('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', '/sheets/js/vendor-xlsx.js')
      .replace('<script src="js/spreadsheet.js"></script>', '<script src="js/snapshot.js"></script><script src="js/spreadsheet.js"></script>');
    page = withSheetEditorChrome(page);
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
  return filename === 'editor.html'
    ? page.replace('</head>', '<link rel="stylesheet" href="/forms/editor-dark.css"></head>')
    : page;
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
// Keep the header toggle and mobile scrim, without a second sidebar close control.
cutFiles('            <button id="fbSidebarClose"', '            <a href="/" class="fb-brand">');
cutFiles('                                <button class="fb-dropdown-item" id="fbViewKeyBtn">',
  '                                <div class="fb-dropdown-divider"></div>');
filePage = filePage.replace('                                <div class="fb-dropdown-divider"></div>',
  '                                <a class="fb-dropdown-item" href="/account">My account</a>\n                                <div class="fb-dropdown-divider"></div>');
cutFiles('    <!-- Access key -->', '    <!-- Entry guard —');
cutFiles('    <!-- Entry guard —', '    <!-- ===== TEMPLATES');
filePage = filePage
  .replace('<!-- Edit tags (multi-select over the shared suite tag pool) -->', '<!-- Edit one tag from the shared suite tag pool -->')
  .replace('<h3>Edit tags</h3>', '<h3>Edit tag</h3>')
  .replace('Tags for "<span id="fbTagsItemName"', 'Tag for "<span id="fbTagsItemName"')
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
const authURL = '/auth/login?redirect=%2Fhome';
const accountMenu = `<div class="lp-account-menu">
                    <button type="button" id="landingMenuToggle" class="lp-account-toggle" aria-label="Account menu" title="Account menu" aria-haspopup="true" aria-expanded="false" aria-controls="landingMenu">
                        ${accountAvatar}
                    </button>
                    <div id="landingMenu" class="lp-account-panel" hidden>
                        <div class="lp-theme-setting" aria-label="Theme">
                            <span>Theme</span>
                            <div class="lp-theme-options" role="group" aria-label="Theme preference">
                                <button type="button" class="lp-theme-option" data-theme-choice="light" aria-label="Light theme" aria-pressed="false" title="Light theme"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg></button>
                                <button type="button" class="lp-theme-option" data-theme-choice="dark" aria-label="Dark theme" aria-pressed="false" title="Dark theme"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.5A9 9 0 0 1 8.5 3.5a9 9 0 1 0 12 12Z"/></svg></button>
                                <button type="button" class="lp-theme-option" data-theme-choice="system" aria-label="System theme" aria-pressed="false" title="System theme"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8m-4-3v3"/></svg></button>
                            </div>
                        </div>
                        <a id="landingAccountLink" class="lp-menu-item" href="${authURL}">Sign in</a>
                        <button type="button" id="landingSignOut" class="lp-menu-item" hidden>Sign out</button>
                    </div>
                </div>`;
const replacements = [
  ['<a href="/apps">Explore apps</a>', '<a href="/apps">Apps</a><a id="landingWorkspaceLink" class="lp-workspace-link" href="/home" hidden>Open Workdeck</a>'],
  ['<a href="/#about">The idea</a>', ''],
  ['<button type="button" id="landingThemeToggle" class="lp-theme-toggle" aria-label="Switch colour theme" title="Switch colour theme">◐</button>\n                <span class="lp-nav-status"><span class="lp-status-dot"></span> Email sign-in coming soon</span>', accountMenu],
  ['<p class="lp-hero-lead">The ideas you write down. The plans you put in motion. The everyday details that keep things moving. Workdeck brings them together, without getting in your way.</p>', ''],
  ['<div class="lp-hero-actions">\n                        <a class="lp-button lp-button-primary" href="/apps">Explore the apps <span aria-hidden="true">↗</span></a>\n                        <span class="lp-hero-note">Email sign-in is on its way</span>\n                    </div>', ''],
  ['<small>App migration will happen one by one.</small>', ''],
  ['<i>✳</i><span>One workspace</span></div></div>', '</div></div>'],
  ['02 / THE TOOLKIT', '01 / THE TOOLKIT'],
  ['<footer class="lp-footer"><div class="lp-wrap lp-footer-inner"><a class="lp-brand" href="/" aria-label="Workdeck home"><img src="/icons/icon-192x192.png" width="32" height="32" alt=""><span>workdeck<span class="lp-brand-dot">.</span></span></a><span>A little more room to do great work.</span><a href="#lp-main">Back to top ↑</a></div></footer>', ''],
];
for (const [before, after] of replacements) {
  if (!landing.includes(before)) throw new Error(`Missing landing sign-in marker: ${before}`);
  landing = landing.replace(before, after);
}
for (const [start, end] of [
  ['            <section id="about"', '            <section id="apps"'],
  ['            <section class="lp-outro lp-wrap"', '        </main>'],
]) {
  const from = landing.indexOf(start);
  const to = landing.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Missing landing section: ${start}`);
  landing = landing.slice(0, from) + landing.slice(to);
}
// The home ribbon occupies the old footer slot, after the main content.
const ribbon = landing.match(/^            <div class="lp-marquee"[^\n]+/m)?.[0];
if (!ribbon) throw new Error('Missing landing ribbon.');
landing = landing.replace(ribbon, '').replace('        </main>', `        </main>\n${ribbon}`);
const pwaIcons = {
  docs: '/docs/icon-192.png',
  sheets: '/icons/sheets512.png',
  filebox: '/icons/files512.png',
  forms: '/icons/forms512.png',
  slides: '/icons/slides512.png',
  draw: '/icons/draw512.png',
  todo: '/icons/todo512.png',
  calendar: '/icons/cal512.png',
  kanban: '/icons/kanban512.png',
  blog: '/icons/blog512.png',
  minutes: '/icons/minutes512.png',
};
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
  const pwaIcon = pwaIcons[match[1]];
  const icon = pwaIcon
    ? `<span class="lp-app-icon lp-app-icon--pwa" data-icon="${match[1]}"><img src="${pwaIcon}" width="192" height="192" alt="" loading="lazy" decoding="async"></span>`
    : `<span class="lp-app-icon" data-icon="${match[1]}">${template ? template[1].trim() : fallback}</span>`;
  landing = landing.replace(match[0], icon);
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
  // Docs must keep /docs/ public for tokenized shared documents. Point the
  // catalogue's guest link straight at Holm sign-in instead of showing Docs'
  // intermediate React sign-in screen; landing.js restores /docs/ for members.
  const openHref = title === 'Docs' ? '/auth/login?redirect=%2Fdocs%2F' : href;
  const openId = title === 'Docs' ? ' id="lp-docs-open"' : '';
  landing = landing.replace(marker, marker + `<a class="lp-app-open"${openId} href="${openHref}">Open ${title} ↗</a>`);
}
const appsHeading = `<div class="lp-apps-heading"><div><div class="lp-section-index">01 / THE TOOLKIT</div><h2 id="lp-apps-title">Meet your <em>workspace.</em></h2><p>Different tools for different moments. Explore what belongs in your deck.</p></div><span class="lp-apps-count">11 tools · one home</span></div>`;
const appsToolbar = `<div class="lp-catalog-toolbar">
                        <h1 id="lp-apps-title">All apps <span id="lp-apps-count">11</span></h1>
                        <div class="lp-catalog-controls">
                            <label class="lp-catalog-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><span class="lp-sr-only">Search apps</span><input id="lp-app-search" type="search" placeholder="Search apps" autocomplete="off"></label>
                            <div class="lp-view-switch" role="group" aria-label="App display">
                                <button type="button" data-app-view="grid" aria-label="Grid view" aria-pressed="true" title="Grid view"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button>
                                <button type="button" data-app-view="list" aria-label="List view" aria-pressed="false" title="List view"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h12M9 12h12M9 19h12M3 5h2M3 12h2M3 19h2"/></svg></button>
                            </div>
                        </div>
                    </div>`;
if (!landing.includes(appsHeading)) throw new Error('Missing app catalogue heading.');
const appsLanding = landing.replace('class="lp"', 'class="lp lp--apps"')
  .replace(appsHeading, appsToolbar)
  .replace('<div class="lp-app-grid">', '<div class="lp-app-grid" id="lp-app-grid" data-view="grid">')
  .replace(/\s*<div class="lp-app-end">[^\n]*<\/div>/, '')
  .replace('                    </div>\n                </div>\n            </section>', '                    </div>\n                    <p id="lp-app-empty" class="lp-app-empty" hidden>No apps match your search.</p>\n                </div>\n            </section>');
const homeLanding = (() => {
  const start = landing.indexOf('            <section id="apps"');
  const end = landing.indexOf('        </main>', start);
  if (start < 0 || end < 0) throw new Error('Missing home toolkit section.');
  return landing.slice(0, start) + landing.slice(end);
})();
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
${apps ? appsLanding : homeLanding}
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
// The legacy account screen is retired. Keep sign-in management in each
// settings menu and send Holm back to the dashboard afterwards.
// Apply the same account controls to every migrated signed-in page, without
// altering the legacy/Vercel HTML used as build input.
const appPwa = {
  todo: { icon: 'todo', color: '#188038' },
  calendar: { icon: 'cal', color: '#0284c7' },
  kanban: { icon: 'kanban', color: '#a21caf' },
  minutes: { icon: 'minutes', color: '#276b53' },
  forms: { icon: 'forms', color: '#7248b9' },
  slides: { icon: 'slides', color: '#ea580c' },
  draw: { icon: 'draw', color: '#e11d48' },
  blog: { icon: 'blog', color: '#0d9488' },
  sheets: { icon: 'sheets', color: '#22c55e' },
  files: { icon: 'files', color: '#0d9488' },
};
// Manifest and worker URLs are scoped to each app, not the dashboard or the
// other apps. Only static assets are cached; authenticated pages and API data
// must always come from the network.
const withAppPwa = (page, app) => {
  const { icon, color } = appPwa[app];
  const head = `<link rel="manifest" href="/${app}/manifest.json"><link rel="icon" type="image/png" sizes="32x32" href="/icons/${icon}32.png"><link rel="icon" type="image/png" sizes="192x192" href="/icons/${icon}192.png"><link rel="apple-touch-icon" href="/icons/${icon}192.png"><meta name="theme-color" content="${color}">`;
  // Remove the original Workdeck favicon (or the app's old SVG) on every
  // page. Otherwise browsers can pick it instead of the matching tab icon.
  page = page.replace(/<link rel="(?:manifest|icon|apple-touch-icon)"[^>]*>/g, '');
  page = page.replace(/<meta name="theme-color"[^>]*>/g, '');
  page = page.replace('</head>', `${head}</head>`);
  if (app !== 'sheets' && app !== 'files') {
    page = page.replace('</body>', `<script src="/${app}/pwa.js" defer></script></body>`);
  }
  return withHomeUI(withSuiteTheme(page, app));
};
const withSignIns = html => {
  const page = withAccountAvatars(html).replaceAll('href="/account">My account</a>',
    'href="/auth/account?redirect=%2Fhome">Your sign-ins</a>');
  const styled = page.replace('</head>', '<link rel="stylesheet" href="/settings-menu.css"></head>');
  // Home embeds a complete preview document in a textarea. Wire the real
  // outer page, not the inert preview template's closing body.
  const end = styled.lastIndexOf('</body>');
  if (end < 0) throw new Error('Missing outer body for account controls');
  return styled.slice(0, end) + '<script src="/js/settings-menu.js"></script>' + styled.slice(end);
};
const withSidebar = (html, app) => html
  .replace('</head>', '<link rel="stylesheet" href="/app-sidebar.css"></head>')
  .replace('</body>', `<script src="/js/app-sidebar.js" data-app="${app}"></script></body>`);
writeFileSync(join(web, 'index.html'), html());
writeFileSync(join(web, 'home.html'), withHomeUI(withSuiteTheme(withSignIns(homeHTML), 'home')));
kanban = kanban.replace('<div id="boardsView">', '<div id="boardsView" class="hidden">')
  .replace('id="loadingOverlay" class="loading-overlay hidden"', 'id="loadingOverlay" class="loading-overlay"');
writeFileSync(join(web, 'kanban/index.html'), withAppPwa(withSidebar(withSignIns(kanban), 'kanban'), 'kanban'));
writeFileSync(join(web, 'calendar/index.html'), withAppPwa(withSignIns(calendar), 'calendar'));
writeFileSync(join(web, 'sheets/index.html'), withAppPwa(withSidebar(withSignIns(sheetPage('index.html')), 'sheets'), 'sheets'));
writeFileSync(join(web, 'sheets/editor.html'), withAppPwa(withSignIns(sheetPage('editor.html')), 'sheets'));
writeFileSync(join(web, 'sheets/shared.html'), withAppPwa(sheetPage('shared.html'), 'sheets'));
for (const file of ['index.html', 'editor.html', 'shared.html'])
  writeFileSync(join(web, 'forms', file), withAppPwa(file === 'index.html' ? withSidebar(withSignIns(formPage(file)), 'forms') : withSignIns(formPage(file)), 'forms'));
for (const file of ['index.html', 'editor.html', 'shared.html'])
  writeFileSync(join(web, 'slides', file), withAppPwa(file === 'index.html' ? withSidebar(withSignIns(slidePage(file)), 'slides') : withSignIns(slidePage(file)), 'slides'));
for (const file of ['index.html', 'editor.html', 'shared.html'])
  writeFileSync(join(web, 'draw', file), withAppPwa(file === 'index.html' ? withSidebar(withSignIns(drawPage(file)), 'draw') : withSignIns(drawPage(file)), 'draw'));
writeFileSync(join(web, 'files/index.html'), withAppPwa(withSignIns(filePage), 'files'));
writeFileSync(join(web, 'blog/index.html'), withAppPwa(withSidebar(withSignIns(blogPage), 'blog'), 'blog'));
cpSync(join(root, 'holm/blog/public.html'), join(web, 'blog-public.html'));
cpSync(join(root, 'public/blog.css'), join(web, 'blog.css'));
writeFileSync(join(web, 'apps.html'), html(true));
writeFileSync(join(web, 'landing.js'), `(() => {
  let themePreference = 'dark';
  const systemTheme = () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const applyTheme = () => document.documentElement.setAttribute('data-theme', themePreference === 'system' ? systemTheme() : themePreference);
  try {
    const pref = localStorage.getItem('workdeck_theme');
    themePreference = ['light', 'dark', 'system'].includes(pref) ? pref : 'dark';
  } catch (_) {}
  applyTheme();
  addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('lp-app-grid');
    if (grid) {
      const cards = [...grid.querySelectorAll('.lp-app-card')];
      const search = document.getElementById('lp-app-search');
      const count = document.getElementById('lp-apps-count');
      const empty = document.getElementById('lp-app-empty');
      const viewButtons = document.querySelectorAll('[data-app-view]');
      let savedView;
      try { savedView = localStorage.getItem('workdeck_apps_view'); } catch (_) {}
      const setView = view => {
        grid.dataset.view = view;
        viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.appView === view)));
        try { localStorage.setItem('workdeck_apps_view', view); } catch (_) {}
      };
      setView(savedView === 'list' ? 'list' : 'grid');
      viewButtons.forEach(button => button.addEventListener('click', () => setView(button.dataset.appView)));
      search.addEventListener('input', () => {
        const query = search.value.trim().toLocaleLowerCase();
        let visible = 0;
        cards.forEach(card => {
          card.hidden = !card.textContent.toLocaleLowerCase().includes(query);
          if (!card.hidden) visible++;
        });
        count.textContent = String(visible);
        empty.hidden = visible !== 0;
      });
    }
    const menuToggle = document.getElementById('landingMenuToggle');
    const menu = document.getElementById('landingMenu');
    const closeMenu = () => { menu.hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); };
    menuToggle?.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      menuToggle.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', event => {
      if (menuToggle && !menuToggle.parentElement.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu && !menu.hidden) { closeMenu(); menuToggle.focus(); }
    });
    const themeOptions = document.querySelectorAll('[data-theme-choice]');
    const syncThemeOptions = () => themeOptions.forEach(option => option.setAttribute('aria-pressed', String(option.dataset.themeChoice === themePreference)));
    syncThemeOptions();
    themeOptions.forEach(option => option.addEventListener('click', () => {
      themePreference = option.dataset.themeChoice;
      applyTheme();
      syncThemeOptions();
      try { localStorage.setItem('workdeck_theme', themePreference); } catch (_) {}
    }));
    // The separate account page still uses the original standalone toggle.
    document.getElementById('landingThemeToggle')?.addEventListener('click', () => {
      themePreference = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme();
      try { localStorage.setItem('workdeck_theme', themePreference); } catch (_) {}
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themePreference === 'system') applyTheme();
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const link = document.getElementById('landingAccountLink');
    if (!link) return; // Account page handles its own signed-in view.
    const signOut = document.getElementById('landingSignOut');
    const workspaceLink = document.getElementById('landingWorkspaceLink');
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Session check failed');
      const session = await response.json();
      if (session.member) {
        // The public catalogue needs a direct login link for guests, but a
        // signed-in member should open Docs rather than revisit Holm login.
        document.getElementById('lp-docs-open')?.setAttribute('href', '/docs/');
        // Keep the landing public, but give members a visible route back to
        // their workspace without having to open an app or type its URL.
        if (workspaceLink) workspaceLink.hidden = false;
        link.hidden = true;
        signOut.hidden = false;
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
      }
    } catch (_) { /* The sign-in link remains available if the session check fails. */ }
  });
})();\n`);
writeFileSync(join(web, 'sw.js'), `const CACHE = 'workdeck-landing-v28';
const FILES = ['/', '/apps', '/landing.css', '/landing-nav.css', '/landing.js', '/manifest.json', '/icons/icon-192x192.png', '/icons/icon-512x512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('workdeck-landing-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Nested apps own their own service workers and caches. Never intercept
  // their navigations or assets from the site-wide landing worker.
  if (url.origin !== self.location.origin || e.request.method !== 'GET' ||
      ['/docs/', '/sheets/', '/files/', '/todo/', '/calendar/', '/kanban/', '/minutes/', '/forms/', '/slides/', '/draw/', '/blog/'].some(path => url.pathname.startsWith(path)) ||
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
  ['holm/auth/autosave.js', 'autosave.js'],
]) cpSync(join(root, from), join(web, 'js', to));
writeFileSync(join(web, 'suite-tokens.css'), buildThemeTokens(readFileSync(join(root, 'public/workdeck.css'), 'utf8')));
cpSync(join(root, 'holm/auth/suite-theme.css'), join(web, 'suite-theme.css'));
cpSync(join(root, 'holm/auth/suite-theme.js'), join(web, 'js/suite-theme.js'));
// Pinned Inter 4.1 (OFL) removes a cross-origin, render-blocking font stylesheet.
cpSync(join(root, 'holm/fonts'), join(web, 'fonts'), { recursive: true });
cpSync(join(root, 'holm/auth/settings-menu.css'), join(web, 'settings-menu.css'));
cpSync(join(root, 'holm/auth/settings-menu.js'), join(web, 'js/settings-menu.js'));
cpSync(join(root, 'holm/auth/app-sidebar.css'), join(web, 'app-sidebar.css'));
cpSync(join(root, 'holm/auth/app-sidebar.js'), join(web, 'js/app-sidebar.js'));
writeFileSync(join(web, 'home-components.css'), homeComponentCSS(readFileSync(join(root, 'public/workdeck.css'), 'utf8')));
cpSync(join(root, 'holm/auth/home-ui.css'), join(web, 'home-ui.css'));
cpSync(join(root, 'holm/auth/dialogs.js'), join(web, 'js/dialogs.js'));
cpSync(join(root, 'holm/auth/home-ui.js'), join(web, 'js/home-ui.js'));
writeFileSync(join(web, 'js/home-icons.js'), homeIconsJS(source));
cpSync(join(root, 'holm/auth/tag-ui.js'), join(web, 'js/tag-ui.js'));
cpSync(join(root, 'holm/auth/action-menu.js'), join(web, 'js/action-menu.js'));
cpSync(join(root, 'holm/auth/action-menu.css'), join(web, 'action-menu.css'));
cpSync(join(root, 'holm/auth/landing-nav.css'), join(web, 'landing-nav.css'));
cpSync(join(root, 'holm/auth/connect-ai.js'), join(web, 'js/connect-ai.js'));
cpSync(join(root, 'public/icons'), join(web, 'icons'), { recursive: true });
for (const [app, { icon, color }] of Object.entries(appPwa)) {
  for (const size of [32, 192]) {
    cpSync(join(root, 'holm/icons', `${icon}${size}.png`), join(web, 'icons', `${icon}${size}.png`));
  }
  const icon512 = icon === 'minutes' ? 'minutes 1.png' : icon === 'kanban' ? 'kanban-square512.png' : `${icon}512.png`;
  cpSync(join(root, 'holm/icons', icon512), join(web, 'icons', `${icon}pwa512.png`));
  writeFileSync(join(web, app, 'manifest.json'), JSON.stringify({
    name: `Workdeck ${app[0].toUpperCase() + app.slice(1)}`,
    short_name: app[0].toUpperCase() + app.slice(1),
    start_url: `/${app}/`, scope: `/${app}/`, display: 'standalone',
    background_color: '#ffffff', theme_color: color,
    icons: [192, 512].map(size => ({
      src: `/icons/${icon}${size === 192 ? '192' : 'pwa512'}.png`,
      sizes: `${size}x${size}`, type: 'image/png', purpose: 'any',
    })),
  }, null, 2) + '\n');
  if (app === 'sheets' || app === 'files') continue;
  writeFileSync(join(web, app, 'pwa.js'), `if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/${app}/service-worker.js', { scope: '/${app}/' }).catch(console.error);
}\n`);
  writeFileSync(join(web, app, 'service-worker.js'), `const CACHE = 'workdeck-${app}-static-v1';
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('workdeck-${app}-static-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/${app}/') ||
      request.mode === 'navigate' || !/\\.(?:js|css|png|svg|webp|woff2?)$/.test(url.pathname)) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  }).catch(() => caches.match(request)));
});\n`);
}
cpSync(join(root, 'holm/icons/forms512.png'), join(web, 'icons/forms512.png'));
cpSync(join(root, 'holm/icons/slides512.png'), join(web, 'icons/slides512.png'));
cpSync(join(root, 'holm/icons/draw512.png'), join(web, 'icons/draw512.png'));
cpSync(join(root, 'holm/icons/files512.png'), join(web, 'icons/files512.png'));
cpSync(join(root, 'holm/icons/todo512.png'), join(web, 'icons/todo512.png'));
cpSync(join(root, 'holm/icons/cal512.png'), join(web, 'icons/cal512.png'));
cpSync(join(root, 'holm/icons/kanban512.png'), join(web, 'icons/kanban512.png'));
cpSync(join(root, 'holm/icons/blog512.png'), join(web, 'icons/blog512.png'));
cpSync(join(root, 'holm/icons/minutes 1.png'), join(web, 'icons/minutes512.png'));
cpSync(join(root, 'holm/icons/sheets512.png'), join(web, 'icons/sheets512.png'));
cpSync(join(root, 'public/og-image.jpg'), join(web, 'og-image.jpg'));
cpSync(join(root, 'public/manifest.json'), join(web, 'manifest.json'));
for (const file of ['account.html', 'account.css', 'account.js']) {
  cpSync(join(root, 'holm/auth', file), join(web, file));
}
for (const file of ['index.html', 'styles.css', 'editor.js', 'config.js', 'auth.js', 'storage.js']) {
  if (file === 'index.html') writeFileSync(join(web, 'todo', file), withAppPwa(withSidebar(withSignIns(readFileSync(join(root, 'holm/todo', file), 'utf8')), 'todo'), 'todo'));
  else cpSync(join(root, 'holm/todo', file), join(web, 'todo', file));
}
// Keep Todo's existing light/dark/system theme implementation unchanged.
cpSync(join(root, 'todo/js/themes.js'), join(web, 'todo/themes.js'));
for (const file of ['auth.js', 'storage.js', 'app.js', 'board.js']) {
  cpSync(join(root, 'holm/kanban', file), join(web, 'kanban/js', file));
}
cpSync(join(root, 'kanban/js/themes.js'), join(web, 'kanban/js/themes.js'));
cpSync(join(root, 'kanban/styles.css'), join(web, 'kanban/styles.css'));
cpSync(join(root, 'holm/kanban/config.js'), join(web, 'kanban/config/config.js'));
const minutesPage = readFileSync(join(root, 'minutes/index.html'), 'utf8').replace(
  '<button id="themeBtn" class="icon-button" title="Switch theme" aria-label="Switch theme">◐</button>',
  '<div class="wd-minutes-account"><button id="settingsBtn" type="button" aria-expanded="false">Account menu</button><div id="settingsDropdown" class="hidden"><div class="theme-dropdown-container"><button data-theme="light">Light</button><button data-theme="dark">Dark</button><button data-theme="system">System</button></div><p id="accountError" class="wd-dialog-error" role="alert" hidden></p><button id="logoutBtn" class="wd-account-item">Logout</button></div></div>'
);
if (!minutesPage.includes('id="settingsBtn"')) throw new Error('Minutes account header no longer matches');
writeFileSync(join(web, 'minutes/index.html'), withAppPwa(withSidebar(withSignIns(minutesPage), 'minutes'), 'minutes'));
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
for (const file of ['styles.css', 'home.css'])
  cpSync(join(root, 'sheets', file), join(web, 'sheets', file));
cpSync(join(root, 'sheets/icons'), join(web, 'sheets/icons'), { recursive: true });
cpSync(join(root, 'sheets/config/config.js'), join(web, 'sheets/config/config.js'));
for (const file of ['app.js', 'home.js', 'auth.js', 'storage.js'])
  cpSync(join(root, 'holm/sheets', file), join(web, 'sheets/js', file));
for (const file of ['themes.js', 'pwa.js'])
  cpSync(join(root, 'sheets/js', file), join(web, 'sheets/js', file));
writeFileSync(join(web, 'sheets/js/spreadsheet.js'), withSheetEditorTheme(withSheetAutosave(readFileSync(join(root, 'sheets/js/spreadsheet.js'), 'utf8'))));
writeFileSync(join(web, 'sheets/js/shared.js'), withSharedSheetTheme(readFileSync(join(root, 'sheets/js/shared.js'), 'utf8')));
cpSync(join(root, 'holm/sheets/vendor-xlsx.js'), join(web, 'sheets/js/vendor-xlsx.js'));
cpSync(join(root, 'holm/sheets/SHEETJS-LICENSE.txt'), join(web, 'sheets/SHEETJS-LICENSE.txt'));
cpSync(join(root, 'holm/sheets/service-worker.js'), join(web, 'sheets/service-worker.js'));
cpSync(join(root, 'holm/sheets/snapshot.js'), join(web, 'sheets/js/snapshot.js'));
cpSync(join(root, 'holm/sheets/editor-header.css'), join(web, 'sheets/editor-header.css'));
// Old installed shells fetch this CSS network-first: hide the retired ribbon
// even before their upgraded home script replaces the obsolete markup.
writeFileSync(join(web, 'sheets/home.css'), readFileSync(join(root, 'sheets/home.css'), 'utf8') + '\n.home-view-indicator { display: none !important; }\n');
cpSync(join(root, 'forms/styles.css'), join(web, 'forms/styles.css'));
cpSync(join(root, 'holm/forms/editor-dark.css'), join(web, 'forms/editor-dark.css'));
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
cpSync(join(root, 'files/styles.css'), join(web, 'files/styles.css'));
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
  // The legacy "192"/"512" files are both 1254px, 1.3MB images. Use actual
  // icon sizes so PWA installation doesn't compete with page navigation.
  for (const size of [192, 512]) cpSync(join(root, 'holm/icons', `docs${size}.png`), join(docsBuild, 'public', `icon-${size}.png`));
  for (const file of ['vite.config.js', 'postcss.config.js', 'tailwind.config.js', 'package.json'])
    cpSync(join(root, 'docs-src', file), join(docsBuild, file));
  // Docs must never serve yesterday's home shell for a new deep link. Only
  // content-hashed assets use cache-first; no HTML or private API is cached.
  const vitePath = join(docsBuild, 'vite.config.js');
  writeFileSync(vitePath, readFileSync(vitePath, 'utf8')
    .replace("globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],", "navigateFallback: null,\n        globPatterns: ['**/*.{css,ico,png,svg,woff2}'],")
    .replace('urlPattern: /^(?!.*\\/api\\/).*\\.(?:js|css|html|ico|png|svg|woff2)$/i,',
      'urlPattern: /\\/docs\\/assets\\/[^/]+-[\\w-]{8,}\\.(?:js|css)$/i,')
    .replace("cacheName: 'static-assets-cache'", "cacheName: 'workdeck-docs-hashed-v1'"));
  // Neutral Tailwind utilities in Docs must match the Home palette too. Keep
  // the legacy config untouched; these are Holm-only compiled utility colors.
  const tailwind = readFileSync(join(docsBuild, 'tailwind.config.js'), 'utf8');
  const neutralUtilities = Object.fromEntries([50,100,200,300,400,500,600,700,800,900,950]
    .map(step => [step, `rgb(var(--wd-ui-neutral-${step}-rgb) / <alpha-value>)`]));
  writeFileSync(join(docsBuild, 'tailwind.config.js'), tailwind.replace('colors: {',
    `colors: { gray: ${JSON.stringify(neutralUtilities)},`));
  symlinkSync(join(root, 'docs-src/node_modules'), join(docsBuild, 'node_modules'), 'dir');
  for (const file of ['App.jsx', 'main.jsx', 'docs-ui.css', 'components/DocTags.jsx', 'hooks/useAuth.js', 'hooks/useDocs.js',
    'hooks/useTheme.js', 'hooks/useAccountMenu.js', 'lib/db.js', 'components/Login.jsx', 'components/UserDisplay.jsx',
    'components/TagList.jsx', 'components/DocCard.jsx', 'components/SearchBar.jsx', 'components/DocActions.jsx', 'components/DocDetailView.jsx']) {
    cpSync(join(root, 'holm/docs-src/src', file), join(docsBuild, 'src', file));
  }
  for (const component of ['DocListView', 'DocDetailView']) {
    const path = join(docsBuild, 'src/components', component + '.jsx');
    writeFileSync(path, withoutDocPins(readFileSync(path, 'utf8'), component));
  }
  const settingsPath = join(docsBuild, 'src/components/SettingsDropdown.jsx');
  const settingsSource = withDocsAccountAvatar(readFileSync(settingsPath, 'utf8'));
  const menuHookAnchor = '  const buttonRef = useRef(null);';
  if (!settingsSource.includes(menuHookAnchor)) throw new Error('Docs account keyboard hook no longer matches');
  writeFileSync(settingsPath, "import { useAccountMenu } from '../hooks/useAccountMenu';\n" +
    settingsSource.replace(menuHookAnchor, menuHookAnchor + '\n  useAccountMenu(isOpen, setIsOpen, buttonRef, dropdownRef);'));
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
  writeFileSync(join(docsBuild, 'index.html'), withHomeUI(withSuiteTheme(index.replace('    <link rel="stylesheet" href="/docs/assets/markdown-editor.css" />\n', '')
    .replace('</head>', '<link rel="stylesheet" href="/settings-menu.css"></head>')
    .replace('  <body>', '  <body>\n    <!-- Holm Docs: refreshed navigation precache -->'), 'docs')));
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
