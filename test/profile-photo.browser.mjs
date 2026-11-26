// Synthetic users and in-memory storage only; exercise the built API + UI.
import assert from 'node:assert/strict';
import { checkBorderlessAvatar } from './avatar-assertions.browser.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pageFixture } from './holm-page-fixtures.mjs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const build = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release');
const { default: app } = await import(pathToFileURL(path.join(build, 'api/main.js')));
const root = path.join(build, 'web');
let signedIn = true, brokenPhoto = false, writes = 0;
const values = new Map();
const doc = { id: 'profiletestdoc001', title: 'Photo test', content: 'Do not change this document.', contentType: 'plain-text', version: 1, updatedAt: '2026-07-01T12:00:00Z', createdAt: '2026-07-01T12:00:00Z' };
const data = { docs: [doc], tags: [], settings: { theme: 'dark' }, sheets: [], forms: [], slides: [], draws: [], todo: [],
  kanban: [], minutes: [], files: [], folders: [], calendars: [], events: [], posts: [] };
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, origin);
    if (url.pathname === '/api/me' || url.pathname === '/api/profile') {
      const env = { holm: { auth: {
        getMember: () => signedIn ? { id: 'photo-test', name: 'Photo Tester', picture: origin + '/_holm/members/photo-test/avatar?v=google' } : null,
        getLoginURL: () => '/auth/login', getLogoutURL: () => '/auth/logout', getAccountURL: () => '/auth/account',
      }, app: { member: { kv: { get: key => values.get(key), set: (key, value) => values.set(key, value) } } } } };
      if (url.pathname === '/api/profile') writes++;
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const response = await app.fetch(new Request(url, { method: req.method, headers: req.headers, body }), env);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (url.pathname.startsWith('/_holm/members/')) {
      res.writeHead(brokenPhoto ? 404 : 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      res.end(brokenPhoto ? 'Missing' : '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#3978b6"/><circle cx="50" cy="40" r="22" fill="#ffe5c1"/></svg>'); return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data, lists: [], tags: [], settings: data.settings })); return;
    }
    let file = path.join(root, url.pathname === '/home' ? 'home.html' : url.pathname === '/apps' ? 'apps.html' : url.pathname);
    if (file !== root && !file.startsWith(root + '/')) throw Error('Invalid path');
    file = pageFixture(root, file);
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(await readFile(file));
  } catch (error) { res.statusCode = 500; res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const avatar = () => page.getByRole('button', { name: 'Account menu', exact: true }).last();
  async function checkMenu() {
    await page.mouse.move(0, 0);
    await checkBorderlessAvatar(avatar());
    await avatar().hover();
    await checkBorderlessAvatar(avatar());
    await avatar().click();
    await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label="Account menu"]')].some(el => el.getAttribute('aria-expanded') === 'true'));
    await checkBorderlessAvatar(avatar());
    assert.equal(await page.getByRole('button', { name: 'Profile photo', exact: true, includeHidden: true }).count(), 0);
    assert.equal(await page.locator('.wd-profile-action, .wd-profile-dialog').count(), 0, 'no photo editing controls are injected');
    await avatar().click();
  }
  // Real packaged entrypoint projects Holm's picture; all app shells render it
  // without adding a Profile photo action to their existing account menus.
  for (const route of ['/', '/apps', '/home', '/docs/', '/todo/', '/kanban/', '/minutes/', '/calendar/', '/files/', '/blog/', '/sheets/', '/forms/', '/slides/', '/draw/']) {
    await page.goto(origin + route);
    await page.locator('.wd-photo-loaded > .wd-profile-image').first().waitFor();
    assert.match(await avatar().locator('img').getAttribute('src'), /\/_holm\/members\/photo-test\/avatar\?v=google$/);
    await checkMenu();
  }
  // React editor menus mount/unmount, unlike the static menus.
  await page.goto(origin + '/docs/?doc=' + doc.id);
  await page.getByTitle('Edit doc (Cmd/Ctrl+E)', { exact: true }).waitFor();
  await page.locator('.wd-photo-loaded > .wd-profile-image').first().waitFor();
  for (let n = 0; n < 2; n++) await checkMenu();
  await page.getByTitle('Edit doc (Cmd/Ctrl+E)', { exact: true }).click();
  await page.getByPlaceholder('Doc title...').waitFor();
  await checkMenu();
  // Previously saved custom photos are retained, not removed with the button.
  const custom = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ce7243'; ctx.fillRect(0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', .85);
  });
  values.set('workdeck_profile_photo', custom);
  await page.goto(origin + '/home'); await page.locator('.wd-photo-loaded').first().waitFor();
  assert.equal(await avatar().locator('img').getAttribute('src'), custom);
  await checkMenu();
  await page.reload(); await page.locator('.wd-photo-loaded').first().waitFor();
  assert.equal(await avatar().locator('img').getAttribute('src'), custom, 'existing photo survives reload');
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => /photo|avatar|profile/.test(key))), []);
  await page.setViewportSize({ width: 390, height: 740 });
  await page.keyboard.press('Escape'); // Close the responsive sidebar after shrinking.
  await checkMenu();
  assert.equal(await avatar().locator('img').isVisible(), true, 'photo remains visible on mobile');
  values.delete('workdeck_profile_photo'); brokenPhoto = true;
  await page.reload(); await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.wd-account-trigger .wd-profile-image'));
  assert.equal(await avatar().locator('svg').isVisible(), true, 'broken picture keeps fallback icon');
  await checkBorderlessAvatar(avatar());
  signedIn = false; await page.goto(origin + '/'); await page.waitForLoadState('networkidle');
  await checkMenu();
  assert.equal(await avatar().locator('img').count(), 0, 'no previous member photo leaks');
  // Removing decorative rings must not remove the keyboard focus indicator.
  await page.keyboard.press('Tab'); await avatar().focus();
  assert.equal(await avatar().evaluate(el => el.matches(':focus-visible') && parseFloat(getComputedStyle(el).outlineWidth) > 0), true);
  assert.equal(writes, 0, 'account menus never modify saved photos');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('Borderless avatars: all 14 page shells, React editor and mobile menus (normal, hover and open); sign-in/custom photos, guest/broken-image fallbacks and keyboard focus preserved.');
  await context.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
