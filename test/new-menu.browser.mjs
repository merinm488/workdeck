// Verify the built app dropdowns against /apps, with synthetic APIs and intercepted navigation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pageFixture } from './holm-page-fixtures.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const output = '/tmp/workdeck-new-menu';
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let file = path.join(root, new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    file = pageFixture(root, file);
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.WORKDECK_UI_ORIGIN || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
try {
  const catalogue = await browser.newPage();
  await catalogue.goto(`${origin}/apps.html`);
  const artwork = await catalogue.locator('.lp-app-icon[data-icon] img').evaluateAll(images =>
    Object.fromEntries(images.map(image => [image.parentElement.dataset.icon, image.getAttribute('src')])));
  assert.equal(Object.keys(artwork).length, 11, 'catalogue has artwork for all apps');
  await catalogue.close();
  for (const theme of ['dark', 'light']) for (const viewport of [{width:1280,height:900}, {width:390,height:844}, {width:320,height:480}]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await context.addInitScript(theme => localStorage.setItem('workdeck_theme', theme), theme);
    const writes = [], errors = [];
    const data = { settings: {theme}, tags: [], docs: [], sheets: [], forms: [], slides: [], draws: [], todo: [], minutes: [], kanban: [], posts: [], files: [], folders: [], calendars: [], events: [] };
    await context.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/me') return route.fulfill({json:{member:{name:'Menu test',theme}}});
      const body = route.request().postDataJSON();
      if (body?.action) writes.push(body);
      return route.fulfill({json:{success:true,data}});
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${origin}/home.html`, {waitUntil:'networkidle'});
      const homeURL = page.url(); // Holm canonicalizes /home.html to /home.
      await page.evaluate(() => { window.openedFiles = []; window.openInNewTab = href => window.openedFiles.push(href); });
      const assertArtwork = async (item, app, size) => {
        await item.scrollIntoViewIfNeeded();
        const image = item.locator('.wd-app-icon img');
        assert.equal(await item.locator('.wd-app-icon svg').count(), 0, `${app}: artwork replaces the line icon`);
        await image.evaluate(el => el.decode());
        assert.equal(await image.getAttribute('src'), artwork[app], `${app}: same icon as /apps`);
        assert.equal(await image.getAttribute('alt'), '');
        assert.ok(await image.evaluate(el => el.naturalWidth > 0));
        const box = await image.boundingBox();
        assert.equal(box.width, size); assert.equal(box.height, size);
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height, `${app}: visible artwork at ${viewport.width}px: ${JSON.stringify(box)}`);
      };
      for (const [trigger, menuId] of [['#newBtn','#newDropdown'], ['#emptyNewBtn','#emptyNewDropdown']]) {
        await page.locator(trigger).click();
        const menu = page.locator(menuId);
        await menu.waitFor({state:'visible'});
        const items = menu.locator('[data-app]');
        assert.equal(await items.count(), 11);
        for (const item of await items.all()) await assertArtwork(item, await item.getAttribute('data-app'), 48);
        const minutes = menu.getByRole('button', {name:'Minutes',exact:true});
        assert.equal(await minutes.count(), 1);
        await minutes.scrollIntoViewIfNeeded();
        const image = minutes.locator('.wd-app-icon img');
        assert.equal(await image.evaluate(el => el.naturalWidth), 512);
        await page.screenshot({path:`${output}/${theme}-${viewport.width}-${menuId.slice(1)}.png`});
        const before = writes.length;
        const opened = await page.evaluate(() => window.openedFiles.length);
        await image.click(); // Clicking the artwork must activate the enclosing app entry.
        await page.waitForFunction(count => window.openedFiles.length === count, opened + 1);
        await page.waitForLoadState('networkidle');
        assert.equal(writes.length, before, 'opening the app-owned modal creates no file');
        assert.equal(await page.evaluate(() => window.openedFiles.at(-1)), '/minutes/?new=1');
        assert.equal(page.url(), homeURL);
      }
      if (!await page.locator('#filterChooserBtn').isVisible()) await page.getByRole('button', {name:'Open sidebar', exact:true}).click();
      await page.locator('#filterChooserBtn').click();
      const filter = page.locator('#filterDropdown');
      await filter.waitFor({state:'visible'});
      assert.equal(await filter.locator('[data-app]').count(), 11);
      for (const item of await filter.locator('[data-app]').all()) await assertArtwork(item, await item.getAttribute('data-app'), 34);
      await filter.locator('[data-app="minutes"] img').click();
      await filter.waitFor({state:'hidden'});
      assert.equal(await page.locator('#filterChooserLabel').textContent(), 'Minutes');
      const selected = page.locator('#filterChooserIcon img');
      assert.equal(await selected.getAttribute('src'), artwork.minutes);
      assert.equal((await selected.boundingBox()).width, 20);
      await page.locator('#filterChooserBtn').click();
      assert.equal(await filter.locator('[data-app="minutes"]').getAttribute('data-selected'), 'true');
      assert.equal(await filter.locator('[data-app="minutes"] .wd-filter-check-slot svg').count(), 1);
      await page.screenshot({path:`${output}/${theme}-${viewport.width}-filter.png`});
      assert.deepEqual(errors, []);
      console.log(`PASS ${theme} ${viewport.width}px: all 11 catalogue icons in both New menus and the filter, selected filter artwork, Minutes modal route without eager creation`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); server.close(); }
