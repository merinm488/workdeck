// Real packaged pages with isolated synthetic data; never calls production.
// PLAYWRIGHT_PATH=/tmp/workdeck-ui-browser/node_modules/playwright/index.mjs CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/consistency.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pageFixture } from './holm-page-fixtures.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const output = '/tmp/workdeck-consistency-interactions';
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    let file = path.join(root, url.pathname === '/home' ? 'home.html' : url.pathname);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    file = pageFixture(root, file);
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const shared = { id: 'record00000000001', name: 'Planning notes', title: 'Planning notes', version: 1, revision: 1, tagId: 'tag1', updatedAt: new Date().toISOString() };
const taggedApps = ['sheets', 'forms', 'slides', 'draw', 'todo', 'kanban', 'blog', 'minutes'];
try {
  for (const theme of ['dark', 'light']) for (const app of (process.env.CONSISTENCY_APPS || 'home,docs,sheets,forms,slides,draw,todo,kanban,blog,minutes,files,calendar').split(',')) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, serviceWorkers: 'block' });
    await context.addInitScript(value => localStorage.setItem('workdeck_theme', value), theme);
    const data = {
      tags: [{ id: 'tag1', name: 'Planning', color: '#3B82F6' }, { id: 'tag2', name: '<Next> & review', color: '#EF4444' }], settings: { theme },
      docs: [{ ...shared, content: 'Planning', contentType: 'plain-text' }], sheets: [shared], forms: [{ ...shared, components: [] }],
      slides: [{ ...shared, slides: [] }], draws: [{ ...shared, objects: [] }], todo: [{ ...shared, items: [] }],
      kanban: [{ ...shared, columns: [], cards: [] }], posts: [{ ...shared, content: '<p>Planning</p>' }],
      minutes: [{ ...shared, date: '2026-11-26', state: 'draft', agenda: [] }],
      files: [{ ...shared, mimeType: 'text/plain', size: 24, tags: ['tag1'] }], folders: [],
      calendars: [{ ...shared, color: '#0284c7', visible: true }], events: [],
    };
    const mutations = []; let failNext = false;
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), body = route.request().postDataJSON();
      if (url.pathname === '/api/me') return route.fulfill({ json: { member: { name: 'Audit User', theme } } });
      if (body?.action) {
        mutations.push(body);
        if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { success: false, error: 'Test save failed. Please try again.' } }); }
        if (body.action === 'setFileTag') {
          const key = { draw: 'draws', blog: 'posts' }[app] || app;
          data[key] = data[key].map(record => ({ ...record, tagId: body.data.tagId, version: record.version + 1 }));
        }
        if (body.action === 'updateSettings') Object.assign(data.settings, body.data.settings);
      }
      return route.fulfill({ json: url.pathname === '/api/todo/lists' ? { lists: data.todo, tags: data.tags, settings: data.settings } : { success: true, data } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { errors.push(`Unexpected native ${dialog.type()}: ${dialog.message()}`); await dialog.dismiss(); });
    try {
      await page.goto(origin + (app === 'home' ? '/home' : `/${app}/`), { waitUntil: 'networkidle' });
      const trigger = page.getByRole('button', { name: 'Account menu', exact: true });
      await trigger.waitFor();
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme, `${app}: native controls follow theme`);
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(300); // allow the existing responsive sidebar transition to finish
        const closeSidebar = page.getByRole('button', { name: 'Close sidebar', exact: true }).first();
        if (width < 1024 && await closeSidebar.isVisible() && !await closeSidebar.evaluate(el => !!el.closest('[inert]'))) {
          await closeSidebar.click(); await page.waitForTimeout(300);
        }
        await trigger.focus(); await page.keyboard.press('ArrowDown');
        const menu = page.getByRole('group', { name: 'Account menu', exact: true });
        await menu.waitFor();
        assert.equal(await trigger.getAttribute('aria-expanded'), 'true', `${app}: expanded`);
        assert.equal(await menu.evaluate(el => el.contains(document.activeElement)), true, `${app}: keyboard enters menu`);
        const bounds = await menu.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `${app}: account menu fits ${width}px`);
        await page.keyboard.press('End');
        assert.equal(await menu.getByRole('button', { name: 'Logout', exact: true }).evaluate(el => el === document.activeElement), true, `${app}: End reaches Logout`);
        await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(await trigger.evaluate(el => el === document.activeElement), true, `${app}: Escape restores focus`);
        await page.keyboard.press('ArrowUp'); await menu.waitFor();
        assert.equal(await menu.getByRole('button', { name: 'Logout', exact: true }).evaluate(el => el === document.activeElement), true, `${app}: ArrowUp opens at the last action`);
        await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${app}: ${width}px overflow`);
      }
      // Search has the same explicit clear action and Escape behavior.
      const search = page.locator('.wd-home-search input, #searchInput').first();
      if (await search.count()) {
        await search.fill('no matching item');
        const clear = page.getByRole('button', { name: 'Clear search', exact: true });
        await clear.waitFor(); await clear.click(); assert.equal(await search.inputValue(), '');
        await search.fill('again'); await search.press('Escape'); assert.equal(await search.inputValue(), '');
        assert.equal(await search.evaluate(el => el === document.activeElement), true);
      }
      const sidebar = page.locator('.wd-sidebar,.wd-app-sidebar,.wd-docs-sidebar,.fb-sidebar,.cal-sidebar').first();
      assert.equal(await sidebar.evaluate(el => el.inert), true, `${app}: collapsed sidebar is outside the keyboard tree`);
      const sidebarToggle = page.getByRole('button', { name: 'Open sidebar', exact: true });
      await sidebarToggle.click();
      await sidebar.locator('a,button').first().focus();
      await page.keyboard.press('Escape');
      assert.equal(await sidebar.evaluate(el => el.inert), true, `${app}: Escape closes drawer`);
      assert.equal(await sidebarToggle.evaluate(el => el === document.activeElement), true, `${app}: drawer restores focus`);
      if (taggedApps.includes(app)) {
        // Collapsed sidebars cannot steal Tab focus; Escape restores the opener.
        const toggle = page.getByRole('button', { name: 'Open sidebar', exact: true });
        const sidebar = page.locator('.wd-app-sidebar');
        assert.equal(await sidebar.evaluate(el => el.inert), true);
        await toggle.click();
        await sidebar.getByRole('button', { name: 'All items', exact: true }).focus();
        await page.keyboard.press('Escape');
        assert.equal(await sidebar.evaluate(el => el.inert), true);
        assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
        const more = page.locator('.wd-card-more:visible').first();
        const openTags = async () => {
          await more.click(); await page.getByRole('menuitem', { name: 'Edit Tags', exact: true }).click();
          await page.getByRole('dialog', { name: 'Edit Tags', exact: true }).waitFor();
        };
        await openTags();
        const dialog = page.getByRole('dialog', { name: 'Edit Tags', exact: true });
        assert.equal(await dialog.getByLabel('Tag', { exact: true }).inputValue(), 'tag1');
        const before = mutations.length;
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        assert.equal(mutations.length, before, 'Cancel does not write');
        assert.equal(await more.evaluate(el => el === document.activeElement), true);
        await openTags(); failNext = true;
        await dialog.getByLabel('Tag', { exact: true }).selectOption('tag2');
        await dialog.getByRole('alert').waitFor();
        assert.match(await dialog.getByRole('alert').textContent(), /Test save failed/);
        assert.equal(await dialog.getByLabel('Tag', { exact: true }).inputValue(), 'tag2', 'Failed selection retained');
        await page.screenshot({ path: `${output}/${theme}-${app}-tag-error.png` });
        await dialog.getByRole('button', { name: 'Done', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        await more.waitFor();
        assert.equal(mutations.filter(change => change.action === 'setFileTag').length, 2, 'One failed write and one retry');
        await openTags(); assert.equal(await dialog.getByLabel('Tag', { exact: true }).inputValue(), 'tag2');
        await dialog.getByLabel('Tag', { exact: true }).selectOption('');
        await dialog.getByRole('status').getByText('All changes saved').waitFor();
        await page.screenshot({ path: `${output}/${theme}-${app}-tag-saved.png` });
        await dialog.getByRole('button', { name: 'Done', exact: true }).click();
        await dialog.waitFor({ state: 'detached' }); await more.waitFor();
        // Long user text must not cause horizontal overflow or inject markup.
        if (['blog', 'minutes'].includes(app)) {
          await more.click(); await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
          const confirm = page.getByRole('dialog', { name: app === 'blog' ? 'Delete post' : 'Delete meeting' });
          await confirm.waitFor();
          assert.equal(await confirm.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => el === document.activeElement), true, 'Safe initial focus');
          await page.keyboard.press('Escape'); await confirm.waitFor({ state: 'detached' });
        }
      }
      if (app === 'minutes') {
        await trigger.click();
        const system = page.getByRole('button', { name: 'System theme', exact: true });
        await system.click(); assert.equal(await system.getAttribute('aria-pressed'), 'true');
        await page.emulateMedia({ colorScheme: 'light' });
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
        await page.keyboard.press('Escape');
      }
      if (app === 'home' && theme === 'dark') {
        // Shared dialogs validate before writing and cannot dismiss mid-save.
        await page.evaluate(() => {
          window.__dialogWrites = 0;
          WDDialog.open({ title: 'Dialog contract', message: '<b>Literal text</b>', confirmLabel: 'Rename',
            field: { label: 'Name', value: 'Original', maxLength: 200 },
            onSubmit: () => { window.__dialogWrites++; return new Promise(resolve => { window.__finishDialogSave = resolve; }); },
          });
        });
        const contract = page.getByRole('dialog', { name: 'Dialog contract' });
        assert.equal(await contract.locator('b').count(), 0, 'Message is text, not markup');
        await contract.getByLabel('Name', { exact: true }).fill('   ');
        await contract.getByRole('button', { name: 'Rename', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__dialogWrites), 0, 'Whitespace is rejected before storage');
        await contract.getByLabel('Name', { exact: true }).fill('Updated');
        await contract.getByRole('button', { name: 'Rename', exact: true }).click();
        assert.equal(await contract.getAttribute('aria-busy'), 'true');
        await page.keyboard.press('Escape');
        assert.equal(await contract.isVisible(), true, 'Escape cannot hide an in-flight write');
        assert.equal(await contract.getByRole('button', { name: 'Rename', exact: true }).isDisabled(), true);
        await page.evaluate(() => window.__finishDialogSave());
        await contract.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => window.__dialogWrites), 1);
        await search.focus();
        await page.evaluate(() => {
          const dialog = WDDialog.open({ title: 'Focus handoff', onSubmit() {} });
          dialog.close(); document.getElementById('settingsBtn').focus();
        });
        await page.getByRole('dialog', { name: 'Focus handoff' }).waitFor({ state: 'detached' });
        assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Dialog close does not steal a newer focus target');
      }
      if (app === 'docs') {
        await page.goto(`${origin}/docs/?doc=${shared.id}`, { waitUntil: 'networkidle' });
        const edit = page.getByRole('button', { name: 'Edit', exact: true });
        if (await edit.count()) await edit.click();
        await trigger.waitFor(); await trigger.focus(); await page.keyboard.press('ArrowDown');
        await page.waitForFunction(() => document.activeElement !== document.querySelector('.wd-account-trigger'));
        assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Docs editor returns keyboard focus');
      }
      assert.deepEqual(errors, [], `${app}: runtime/native dialog errors`);
      console.log(`PASS ${theme} ${app}: account keyboard, 4 widths, search${taggedApps.includes(app) ? ', mobile sidebar, tag persistence/retry' : ''}`);
    } catch (error) {
      await page.screenshot({ path: `${output}/FAIL-${theme}-${app}.png` });
      console.error({ app, theme, errors, mutations, overflow: await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
        const r = el.getBoundingClientRect(); return r.width && r.left < innerWidth && r.right > innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden';
      }).slice(0, 12).map(el => ({ tag: el.tagName, id: el.id, cls: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right }))) }); throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); server.close(); }
