import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;

test('Holm serves the original signed-in dashboard markup without legacy access keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-workdeck-'));
  try {
    execFileSync(process.execPath, [join(root, 'scripts/build-holm-landing.mjs'), dir]);
    const html = readFileSync(join(dir, 'web/home.html'), 'utf8');
    const script = readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8');
    const previewDoc = html.match(/<textarea id="wdPreviewFrameDoc" hidden>([\s\S]*?)<\/textarea>/)?.[1];
    assert.ok(previewDoc, 'Slides/Draw card preview iframe template must ship in Holm home');
    assert.match(previewDoc, /<script src="__FABRIC_SRC__"><\/script>/);
    assert.match(previewDoc, /job\.kind === "slides"/);
    assert.match(previewDoc, /canvas\.loadFromJSON\(\{ objects: job\.objects \|\| \[\] \}\)/);
    assert.match(previewDoc, /previewReady: true, kind: "__KIND__"/);
    assert.ok(html.indexOf('id="wdPreviewFrameDoc"') < html.indexOf('src="/js/previews.js"'));
    assert.match(readFileSync(join(dir, 'web/js/previews.js'), 'utf8'), /template \? template\.value : window\.WDPreviewFrameDoc/);
    const header = html.split('class="wd-actions"')[1]?.split('<!-- Settings -->')[0];
    assert.ok(header, 'Missing header actions');
    assert.match(header, /id="viewToggle"[\s\S]*?id="newBtn"/);
    assert.equal((html.match(/id="viewToggle"/g) || []).length, 1);
    assert.doesNotMatch(html, /class="wd-view-btn"|class="wd-filter-bar"/);
    assert.match(header, /wd-layout-icon-list[\s\S]*?wd-layout-icon-cards hidden/);
    assert.match(script, /state\.viewMode = state\.viewMode === 'list' \? 'grid' : 'list'/);
    assert.match(script, /'Switch to card view' : 'Switch to list view'/);
    for (const id of ['homeView', 'filesGrid', 'filesList', 'projectList', 'projectForm',
      'wdFileCardTemplate', 'wdFileRowTemplate', 'newDropdown', 'settingsDropdown']) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    for (const id of ['wdFileCardTemplate', 'wdFolderCardTemplate', 'wdFileRowTemplate', 'wdFolderRowTemplate']) {
      const template = html.split(`<template id="${id}">`)[1]?.split('</template>')[0];
      assert.ok(template, `Missing ${id}`);
      assert.match(template, /class="wd-file-action-btn move"[\s\S]*?<path d="M20 12 12 20 2 10V2h8l10 10Z"\/><circle cx="7" cy="7" r="1"\/>/, id);
    }
    assert.match(readFileSync(join(dir, 'web/js/app-sidebar.js'), 'utf8'), /<path d="M20 12 12 20 2 10V2h8l10 10Z"\/><circle cx="7" cy="7" r="1"\/>/);
    assert.doesNotMatch(html, /Access Key|View My Key|Change My Key|Delete Account|loginForm/);
    assert.match(html, /href="\/auth\/account\?redirect=%2Fhome">Your sign-ins<\/a>/);
    const settings = html.split('id="settingsDropdown"')[1]?.split('<!-- Settings -->')[0];
    assert.ok(settings, 'Missing settings menu');
    assert.match(settings, /class="wd-dropdown wd-dropdown-right wd-account-panel"/);
    assert.match(settings, /class="wd-theme-setting"[^>]*>[\s\S]*?class="wd-theme-options"/);
    assert.match(settings, /class="wd-theme-container wd-legacy-theme" style="display:none"/);
    assert.match(settings, /id="logoutBtn"><span class="wd-item-text">Logout<\/span>/);
    assert.doesNotMatch(settings, /id="logoutBtn">\s*<svg/);
    assert.match(html, /<style>[\s\S]*?text-decoration:none!important;[\s\S]*?<\/style>/);
    assert.match(script, /#settingsDropdown > \.wd-theme-setting \.wd-theme-choice/);
    assert.doesNotMatch(html, /href="\/account"|My account/);
    const appsHTML = readFileSync(join(dir, 'web/apps.html'), 'utf8');
    assert.match(appsHTML, /data-icon="forms"><img src="\/icons\/forms512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/forms512.png')),
      readFileSync(join(root, 'holm/icons/forms512.png')));
    assert.match(appsHTML, /data-icon="slides"><img src="\/icons\/slides512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/slides512.png')),
      readFileSync(join(root, 'holm/icons/slides512.png')));
    assert.match(appsHTML, /data-icon="draw"><img src="\/icons\/draw512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/draw512.png')),
      readFileSync(join(root, 'holm/icons/draw512.png')));
    assert.match(appsHTML, /--lp-color:#0d9488;--lp-tint:rgba\(13,148,136,\.12\)[^>]*><span class="lp-app-icon lp-app-icon--pwa" data-icon="filebox"><img src="\/icons\/files512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/files512.png')),
      readFileSync(join(root, 'holm/icons/files512.png')));
    assert.match(appsHTML, /data-icon="todo"><img src="\/icons\/todo512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/todo512.png')),
      readFileSync(join(root, 'holm/icons/todo512.png')));
    assert.match(appsHTML, /data-icon="calendar"><img src="\/icons\/cal512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/cal512.png')),
      readFileSync(join(root, 'holm/icons/cal512.png')));
    assert.match(appsHTML, /data-icon="kanban"><img src="\/icons\/kanban512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/kanban512.png')),
      readFileSync(join(root, 'holm/icons/kanban512.png')));
    assert.match(appsHTML, /--lp-color:#0d9488;--lp-tint:rgba\(13,148,136,\.12\)[^>]*><span class="lp-app-icon lp-app-icon--pwa" data-icon="blog"><img src="\/icons\/blog512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/blog512.png')),
      readFileSync(join(root, 'holm/icons/blog512.png')));
    assert.match(appsHTML, /--lp-color:#276b53;--lp-tint:rgba\(39,107,83,\.12\)[^>]*><span class="lp-app-icon lp-app-icon--pwa" data-icon="minutes"><img src="\/icons\/minutes512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/minutes512.png')),
      readFileSync(join(root, 'holm/icons/minutes 1.png')));
    assert.match(appsHTML, /data-icon="sheets"><img src="\/icons\/sheets512\.png"[^>]*alt=""/);
    assert.deepEqual(readFileSync(join(dir, 'web/icons/sheets512.png')),
      readFileSync(join(root, 'holm/icons/sheets512.png')));
    assert.match(readFileSync(join(dir, 'web/landing.css'), 'utf8'), /\.lp-app-icon--pwa img \{[^}]*width:100%; height:100%/);
    assert.match(appsHTML, /id="lp-docs-open" href="\/auth\/login\?redirect=%2Fdocs%2F">Open Docs ↗<\/a>/);
    assert.match(readFileSync(join(dir, 'web/landing.js'), 'utf8'), /if \(session\.member\) \{[\s\S]*?getElementById\('lp-docs-open'\)\?\.setAttribute\('href', '\/docs\/'\)/);
    assert.match(appsHTML, /href="\/sheets\/">Open Sheets ↗<\/a>/);
    assert.match(readFileSync(join(dir, 'web/landing.js'), 'utf8'), /link\.hidden = true;[\s\S]*?signOut\.hidden = false/);
    assert.match(readFileSync(join(dir, 'web/account.js'), 'utf8'), /location\.replace\('\/home'\)/);
    assert.doesNotMatch(readFileSync(join(dir, 'web/sw.js'), 'utf8'), /'\/account'/);
    assert.match(html, /id="connectAIModal"/);
    const menuScript = readFileSync(join(dir, 'web/js/settings-menu.js'), 'utf8');
    const menuCSS = readFileSync(join(dir, 'web/settings-menu.css'), 'utf8');
    assert.match(menuScript, /legacy\.querySelector\(`\[data-theme=/);
    assert.doesNotMatch(menuScript, /trigger\.innerHTML/);
    assert.match(menuCSS, /\.wd-theme-setting \{[^}]*padding:8px 12px 12px/);
    assert.match(menuCSS, /\.wd-legacy-theme \{ display:none!important; \}/);
    assert.match(menuCSS, /\.wd-files-grid \{ grid-template-columns:repeat\(auto-fill,minmax\(min\(260px,100%\),1fr\)\)/);
    assert.match(menuCSS, /\.fb-header-content \{ flex-wrap:wrap; \}/);
    const homeCSS = readFileSync(join(dir, 'web/workdeck.css'), 'utf8');
    assert.match(homeCSS, /\.wd-preview-doc,\s*\.wd-preview-form,\s*\.wd-preview-todo,\s*\.wd-preview-kanban\s*\{[^}]*background: #ffffff;[^}]*color: #24292f;/);
    assert.match(homeCSS, /@media \(max-width: 360px\) \{\s*\.wd-logo-text \{\s*display: none;/);
    assert.match(homeCSS, /@media \(max-width: 768px\) \{[\s\S]*?\.wd-search-container \{\s*order: 3;/);
    assert.match(homeCSS, /\.wd-todo-row\.wd-todo-done \.wd-todo-text\s*\{[^}]*color: #9aa0a8;/);
    assert.match(menuCSS, /bottom:auto!important; height:auto!important;[\s\S]*?max-height:calc\(100dvh/);
    for (const page of ['home.html', 'todo/index.html', 'kanban/index.html', 'calendar/index.html',
      'sheets/index.html', 'sheets/editor.html', 'forms/index.html', 'forms/editor.html',
      'slides/index.html', 'slides/editor.html', 'draw/index.html', 'draw/editor.html',
      'files/index.html', 'blog/index.html']) {
      const built = readFileSync(join(dir, 'web', page), 'utf8');
      assert.match(built, /href="\/settings-menu\.css"/, page);
      assert.match(built, /src="\/js\/settings-menu\.js"/, page);
    }
    assert.match(readFileSync(join(dir, 'web/index.html'), 'utf8'), /id="landingMenuToggle"[^>]*aria-label="Account menu"/);
    for (const page of ['index.html', 'apps.html']) {
      assert.match(readFileSync(join(dir, 'web', page), 'utf8'), /id="landingWorkspaceLink"[^>]*href="\/home"[^>]*hidden>Open Workdeck<\/a>/);
    }
    assert.match(readFileSync(join(dir, 'web/landing.js'), 'utf8'), /if \(workspaceLink\) workspaceLink\.hidden = false/);
    assert.match(readFileSync(join(dir, 'web/landing-nav.css'), 'utf8'), /\.lp-theme-setting \{[^}]*padding:8px 12px 12px/);
    assert.match(readFileSync(join(dir, 'web/landing-nav.css'), 'utf8'), /@media\(max-width:750px\) \{[\s\S]*?\.lp-hero-art \{ height:auto; min-height:0; display:flex;/);
    assert.match(readFileSync(join(dir, 'web/landing-nav.css'), 'utf8'), /\.lp-art-label \{ position:static; align-self:flex-start; \}/);
    assert.match(readFileSync(join(dir, 'web/docs/index.html'), 'utf8'), /href="\/settings-menu\.css"/);
    assert.match(html, /id="connectAIBtn"/);
    assert.match(html, /id="connectAIManage" href="\/_holm\/connect\/connections" target="_blank" rel="noopener noreferrer">Manage Connections<\/a>/);
    assert.doesNotMatch(html, /id="connectAIClose"|Never enter a Workdeck key|Your connected AI clients/);
    assert.match(readFileSync(join(dir, 'web/settings-menu.css'), 'utf8'), /#connectAIManage[^\n]*text-decoration:none/);
    assert.doesNotMatch(html, /id="connectAIRevoke"|\/api\/mcp-connections/);
    assert.match(readFileSync(join(dir, 'web/js/connect-ai.js'), 'utf8'), /\/_holm\/mcp/);
    assert.ok(readFileSync(join(dir, 'api/contract.json'), 'utf8').includes('workspace.list'));
    assert.doesNotMatch(script, /wdAuth|sessionStorage|\{ hash: state\.userHash/);
    assert.ok(readFileSync(join(dir, 'api/workspace.js'), 'utf8').includes('workspace_tags'));
    assert.doesNotMatch(readFileSync(join(dir, 'web/landing.js'), 'utf8'), /location\.(?:replace|assign)\('\/home'\)/);
    assert.match(html, /href="\/" class="wd-logo" aria-label="Workdeck landing page"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Holm landing stays public for members while the dashboard requires sign-in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-workdeck-'));
  try {
    execFileSync(process.execPath, [join(root, 'scripts/build-holm-landing.mjs'), dir]);
    const { default: app } = await import(pathToFileURL(join(dir, 'api/main.js')).href);
    const urls = [];
  const env = signedIn => ({ holm: {
    app: { member: { kv: { get: () => null } } },
    auth: { getMember: () => signedIn ? { id: 'member-1' } : null,
      getLoginURL: path => `/auth/login?redirect=${encodeURIComponent(path)}`,
      getLogoutURL: () => '/auth/logout',
      getAccountURL: path => `/auth/account?redirect=${encodeURIComponent(path)}` },
    web: { fetch: req => { urls.push(new URL(req.url).pathname); return new Response('public', { status: 200 }); } },
  } });
  const request = path => new Request('https://workdeck.test' + path);
  assert.equal((await app.fetch(request('/'), env(false))).status, 200);
  assert.equal(urls[0], '/');
  const signedInLanding = await app.fetch(request('/'), env(true));
  assert.equal(signedInLanding.status, 200);
  assert.equal(signedInLanding.headers.get('location'), null);
  assert.equal(urls.at(-1), '/');
  assert.equal((await app.fetch(request('/account'), env(true))).headers.get('location'), 'https://workdeck.test/home');
  assert.equal((await app.fetch(request('/home'), env(false))).headers.get('location'), 'https://workdeck.test/auth/login?redirect=%2Fhome');
  const session = await (await app.fetch(request('/api/me'), env(true))).json();
  assert.equal(session.loginURL, '/auth/login?redirect=%2Fhome');
  assert.equal(session.accountURL, '/auth/account?redirect=%2Fhome');
  assert.equal((await app.fetch(request('/home'), env(true))).status, 200);
  assert.equal(urls.at(-1), '/home.html');
  assert.equal((await app.fetch(request('/kanban/rec_123456789'), env(true))).status, 200);
  assert.equal(urls.at(-1), '/kanban/index.html');
  assert.equal((await app.fetch(request('/kanban/config/config.js'), env(true))).status, 200);
  assert.equal(urls.at(-1), '/kanban/config/config.js');
  assert.equal((await app.fetch(request('/minutes/record_abcdef123'), env(true))).status, 200);
  assert.equal(urls.at(-1), '/minutes/index.html');
  assert.equal((await app.fetch(request('/calendar/record_abcdef123'), env(true))).status, 200);
  assert.equal(urls.at(-1), '/calendar/index.html');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
