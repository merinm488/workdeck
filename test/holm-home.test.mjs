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
    assert.doesNotMatch(html, /href="\/account"|My account/);
    const appsHTML = readFileSync(join(dir, 'web/apps.html'), 'utf8');
    assert.match(appsHTML, /id="lp-docs-open" href="\/auth\/login\?redirect=%2Fdocs%2F">Open Docs ↗<\/a>/);
    assert.match(readFileSync(join(dir, 'web/landing.js'), 'utf8'), /if \(session\.member\) \{[\s\S]*?getElementById\('lp-docs-open'\)\?\.setAttribute\('href', '\/docs\/'\)/);
    assert.match(appsHTML, /href="\/sheets\/">Open Sheets ↗<\/a>/);
    assert.match(readFileSync(join(dir, 'web/landing.js'), 'utf8'), /link\.href = session\.accountURL/);
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
    assert.match(menuCSS, /bottom:auto!important; height:auto!important;[\s\S]*?max-height:calc\(100dvh/);
    for (const page of ['home.html', 'todo/index.html', 'kanban/index.html', 'calendar/index.html',
      'sheets/index.html', 'sheets/editor.html', 'forms/index.html', 'forms/editor.html',
      'slides/index.html', 'slides/editor.html', 'draw/index.html', 'draw/editor.html',
      'files/index.html', 'blog/index.html']) {
      const built = readFileSync(join(dir, 'web', page), 'utf8');
      assert.match(built, /href="\/settings-menu\.css"/, page);
      assert.match(built, /src="\/js\/settings-menu\.js"/, page);
    }
    assert.match(readFileSync(join(dir, 'web/index.html'), 'utf8'), /id="landingMenuToggle"[^>]*aria-label="Settings"/);
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
    assert.match(readFileSync(join(dir, 'web/landing.js'), 'utf8'), /location\.replace\('\/home'\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Holm root selects the dashboard only for a verified member', async () => {
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
  assert.equal((await app.fetch(request('/'), env(true))).headers.get('location'), 'https://workdeck.test/home');
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
