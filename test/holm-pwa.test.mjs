import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const colors = { todo: '#188038', calendar: '#0284c7', kanban: '#a21caf', minutes: '#276b53',
  forms: '#7248b9', slides: '#ea580c', draw: '#e11d48', blog: '#0d9488', sheets: '#22c55e', files: '#0d9488' };

const apps = {
  todo: 'todo', calendar: 'cal', kanban: 'kanban', minutes: 'minutes',
  forms: 'forms', slides: 'slides', draw: 'draw', blog: 'blog',
  sheets: 'sheets', files: 'files',
};

test('Holm installs each app independently using its catalogue artwork', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-app-pwa-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir],
      { timeout: 150_000, maxBuffer: 500_000 });
    for (const [app, icon] of Object.entries(apps)) {
      const manifest = JSON.parse(readFileSync(join(dir, 'web', app, 'manifest.json'), 'utf8'));
      assert.equal(manifest.start_url, `/${app}/`);
      assert.equal(manifest.scope, `/${app}/`);
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.theme_color, colors[app], `${app}: installation matches the app accent`);
      assert.deepEqual(manifest.icons.map(({ src, sizes }) => [src, sizes]), [
        [`/icons/${icon}192.png`, '192x192'], [`/icons/${icon}pwa512.png`, '512x512'],
      ]);
      for (const { src, sizes } of manifest.icons) {
        const png = readFileSync(join(dir, 'web', src));
        const size = Number.parseInt(sizes, 10);
        assert.equal(png.readUInt32BE(16), size);
        assert.equal(png.readUInt32BE(20), size);
      }
      const page = readFileSync(join(dir, 'web', app, 'index.html'), 'utf8');
      assert.ok(page.includes(`<meta name="theme-color" content="${colors[app]}">`));
      assert.match(page, /src="\/js\/dialogs\.js"/);
      if (app === 'minutes') {
        assert.match(page, /id="settingsBtn"/);
        assert.match(page, /src="\/js\/settings-menu\.js"/);
        assert.doesNotMatch(page, /id="themeBtn"/);
      }
      assert.match(page, new RegExp(`href="/${app}/manifest\\.json"`));
      assert.match(page, new RegExp(`rel="icon"[^>]+sizes="32x32" href="/icons/${icon}32\\.png"`));
      assert.match(page, new RegExp(`rel="icon"[^>]+sizes="192x192" href="/icons/${icon}192\\.png"`));
      assert.equal((page.match(/rel="icon"/g) || []).length, 2);
      assert.doesNotMatch(page, /href="\/icons\/(?:favicon-32x32|icon-192x192)\.png"/);
      const favicon = readFileSync(join(dir, 'web/icons', `${icon}32.png`));
      assert.equal(favicon.readUInt32BE(16), 32);
      assert.equal(favicon.readUInt32BE(20), 32);
      if (app === 'sheets' || app === 'files') continue;
      assert.match(page, new RegExp(`src="/${app}/pwa\\.js"`));
      const registration = readFileSync(join(dir, 'web', app, 'pwa.js'), 'utf8');
      assert.match(registration, new RegExp(`scope: '/${app}/'`));
      const worker = readFileSync(join(dir, 'web', app, 'service-worker.js'), 'utf8');
      assert.match(worker, /request.mode === 'navigate'/);
      assert.match(worker, new RegExp(`url.pathname.startsWith\\('/${app}/'\\)`));
    }
    const home = readFileSync(join(dir, 'web/home.html'), 'utf8');
    assert.ok(home.indexOf('src="/js/settings-menu.js"') > home.lastIndexOf('</textarea>'), 'Account behavior is in the real page, not the preview document');
    for (const app of ['forms', 'slides', 'draw', 'sheets']) {
      for (const page of ['editor.html', 'shared.html']) {
        const html = readFileSync(join(dir, 'web', app, page), 'utf8');
        assert.match(html, new RegExp(`href="/${app}/manifest\\.json"`));
        assert.match(html, new RegExp(`rel="icon"[^>]+sizes="32x32" href="/icons/${apps[app]}32\\.png"`));
        assert.equal((html.match(/rel="icon"/g) || []).length, 2);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
