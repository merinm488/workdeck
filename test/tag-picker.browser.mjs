// Shared picker parity and Files/home persistence using only synthetic API data.
// WORKDECK_UI_BUILD=/tmp/workdeck-holm-release PLAYWRIGHT_PATH=/tmp/workdeck-ui-browser/node_modules/playwright/index.mjs CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/tag-picker.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pageFixture } from './holm-page-fixtures.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const output = '/tmp/workdeck-tag-picker';
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    let file = pageFixture(root, path.join(root, pathname === '/home' ? 'home.html' : pathname));
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const apps = ['home', 'docs', 'sheets', 'forms', 'slides', 'draw', 'todo', 'kanban', 'blog', 'minutes', 'files'];
try {
  for (const theme of ['light', 'dark']) {
    const reference = {};
    for (const app of apps) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      await context.addInitScript(theme => localStorage.setItem('workdeck_theme', theme), theme);
      const record = { id: 'record00000000001', name: 'Planning notes', title: 'Planning notes', tagId: 'tag1', version: 1, revision: 1, updatedAt: new Date().toISOString() };
      const data = {
        tags: [{ id: 'tag1', name: 'Planning', color: '#3B82F6' }, { id: 'tag2', name: '<Next> & review', color: '#EF4444' }], settings: { theme },
        docs: [{ ...record, content: 'Plan', contentType: 'plain-text' }], sheets: [record], forms: [{ ...record, components: [] }],
        slides: [{ ...record, slides: [] }], draws: [{ ...record, objects: [] }], todo: [{ ...record, items: [] }],
        kanban: [{ ...record, cards: [], columns: [] }], posts: [{ ...record, content: '<p>Plan</p>' }],
        minutes: [{ ...record, state: 'draft', agenda: [], date: '2026-11-26' }],
        files: [{ ...record, id: 'file000000000001', tags: ['tag1'], mimeType: 'text/plain', size: 4 }],
        folders: [{ ...record, id: 'folder0000000001', tags: ['tag1'] }], calendars: [], events: [],
      };
      let failNext = false, holdNext = false, release;
      let failNextTag = false, holdNextTag = false, releaseTag;
      const writes = [];
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url()), body = route.request().postDataJSON();
        if (url.pathname === '/api/me') return route.fulfill({ json: { member: { name: 'Test' } } });
        if (['setFileTags', 'setFolderTags'].includes(body?.action)) {
          writes.push(body);
          if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { success: false, error: 'Offline' } }); }
          if (holdNext) { holdNext = false; await new Promise(resolve => { release = resolve; }); }
          const rows = body.action === 'setFileTags' ? data.files : data.folders;
          rows[0].tags = body.data.tagIds;
        }
        if (body?.action === 'updateTag') {
          if (failNextTag) { failNextTag = false; return route.fulfill({ status: 503, json: { success: false, error: 'Offline' } }); }
          if (holdNextTag) { holdNextTag = false; await new Promise(resolve => { releaseTag = resolve; }); }
          data.tags = data.tags.map(tag => tag.id === body.data.tagId ? { ...tag, ...body.data.updates } : tag);
        }
        return route.fulfill({ json: url.pathname === '/api/todo/lists' ? { lists: data.todo, tags: data.tags, settings: data.settings } : { success: true, data } });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(origin + (app === 'home' ? '/home' : `/${app}/`));
        const more = (id = 'file000000000001') => ['home', 'files'].includes(app)
          ? page.locator(`[data-id="${id}"]:visible .wd-card-more`).first()
          : page.locator('.wd-card-more:visible').first();
        const dialog = page.getByRole('dialog', { name: 'Edit tags', exact: true });
        const open = async id => {
          if (page.viewportSize().width < 1024) {
            const closeSidebar = page.getByRole('button', { name: 'Close sidebar', exact: true }).first();
            if (await closeSidebar.isVisible() && !await closeSidebar.evaluate(el => !!el.closest('[inert]'))) {
              await closeSidebar.click(); await page.waitForTimeout(300);
            }
          }
          await more(id).scrollIntoViewIfNeeded();
          await more(id).focus();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await more(id).click();
          assert.equal(await page.getByRole('menuitem', { name: /^Add tags?$/i }).count(), 0);
          await page.getByRole('menuitem', { name: 'Edit tags', exact: true }).click();
          await dialog.waitFor();
        };
        const choose = async name => {
          await dialog.locator('.wd-move-select-trigger').click();
          await dialog.getByRole('option', { name, exact: true }).click();
        };
        for (const width of [1280, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(300);
          await open();
          const metrics = await dialog.evaluate(el => Object.fromEntries(['', '.wd-modal-title', '.wd-move-select-trigger', '.wd-secondary-btn', '.wd-primary-btn'].map(selector => {
            const node = selector ? el.querySelector(selector) : el, css = getComputedStyle(node);
            return [selector, Object.fromEntries(['width', 'height', 'padding', 'borderRadius', 'fontSize', 'fontWeight', 'lineHeight'].map(key => [key, css[key]]))];
          })));
          if (app === 'home') reference[width] = metrics;
          else assert.deepEqual(metrics, reference[width], `${app} ${theme} ${width}: identical geometry and typography to Workdeck home`);
          assert.equal(await dialog.locator('.wd-move-select-value').textContent(), 'Planning');
          await dialog.locator('.wd-move-select-trigger').press('ArrowDown');
          assert.equal(await dialog.getByRole('option').count(), 3, 'one shared pool, no duplicate options');
          assert.equal(await dialog.getByRole('option', { selected: true }).count(), 1);
          await page.keyboard.press('End'); await page.keyboard.press('Enter');
          assert.equal(await dialog.locator('.wd-move-select-value').textContent(), '<Next> & review');
          assert.equal(await dialog.locator('next').count(), 0, 'names are text, never markup');
          await dialog.locator('.wd-move-select-trigger').click();
          await page.keyboard.press('Escape');
          assert.equal(await dialog.isVisible(), true, 'first Escape only closes the dropdown');
          assert.equal(await dialog.locator('.wd-move-select-trigger').getAttribute('aria-expanded'), 'false');
          await page.screenshot({ path: `${output}/${theme}-${app}-${width}.png` });
          const bounds = await dialog.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'modal fits narrow viewport');
          await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
          await dialog.waitFor({ state: 'detached' });
          assert.equal(writes.length, 0, 'drafts never persist on Cancel');
        }
        if (['home', 'files'].includes(app)) {
          for (const [id, rows, action] of [['file000000000001', data.files, 'setFileTags'], ['folder0000000001', data.folders, 'setFolderTags']]) {
            await open(id); await choose('<Next> & review'); failNext = true;
            await dialog.getByRole('button', { name: 'Save', exact: true }).click();
            await dialog.getByRole('alert').waitFor();
            assert.deepEqual(rows[0].tags, ['tag1'], 'failed write rolls back data');
            assert.equal(await dialog.locator('.wd-move-select-value').textContent(), '<Next> & review');
            holdNext = true;
            await dialog.getByRole('button', { name: 'Save', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('.wd-tag-picker')?.getAttribute('aria-busy') === 'true');
            await page.keyboard.press('Escape');
            assert.equal(await dialog.isVisible(), true, 'cannot dismiss an in-flight save');
            assert.equal(await dialog.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
            while (!release) await new Promise(resolve => setTimeout(resolve, 10));
            release(); release = null;
            await dialog.waitFor({ state: 'detached' });
            assert.deepEqual(rows[0].tags, ['tag2']);
            assert.equal(writes.at(-1).action, action);
            await page.reload(); await open(id);
            assert.equal(await dialog.locator('.wd-move-select-value').textContent(), '<Next> & review');
            await choose('No tags');
            await dialog.getByRole('button', { name: 'Save', exact: true }).click();
            await dialog.waitFor({ state: 'detached' });
            assert.deepEqual(rows[0].tags, []);
          }
        }
        // Sidebar name/color edits autosave without showing a saved confirmation.
        const tagForm = page.locator('.wd-tag-ui .wd-project-form').first();
        const tagStatus = tagForm.locator('.wd-save-status');
        const openTagEditor = async () => {
          const row = page.locator('.wd-project-row[data-tag="tag1"]');
          await row.waitFor({ state: 'attached' });
          const opener = page.getByRole('button', { name: 'Open sidebar', exact: true });
          if (await opener.isVisible()) await opener.click();
          await row.hover(); await row.locator('button.edit').click();
          await tagForm.waitFor();
          assert.equal(await tagStatus.isVisible(), false, 'no saved label when the tag editor opens');
          assert.equal(await tagStatus.textContent(), '');
        };
        const silentlySaved = async () => {
          await tagForm.locator('[data-save-status="saved"]').waitFor({ state: 'attached' });
          assert.equal(await tagStatus.isVisible(), false, 'saved status takes no space');
          assert.equal(await tagStatus.textContent(), '', 'no saved confirmation remains in the DOM');
          assert.equal(await tagForm.getByText('All changes saved', { exact: true }).count(), 0);
        };
        for (const width of [1280, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(350); // let responsive sidebar state and transitions settle
          await openTagEditor();
          holdNextTag = true;
          await tagForm.getByRole('textbox', { name: 'Tag name' }).fill(`Updated tag ${width}`);
          await tagStatus.waitFor();
          assert.equal(await tagStatus.textContent(), 'Saving…');
          while (!releaseTag) await new Promise(resolve => setTimeout(resolve, 10));
          releaseTag(); releaseTag = null;
          await silentlySaved();
          assert.equal(data.tags[0].name, `Updated tag ${width}`, 'tag name still autosaves');
          const color = width === 1280 ? '#EF4444' : '#3B82F6';
          await tagForm.getByRole('button', { name: `Pick color ${color}`, exact: true }).click();
          await silentlySaved();
          assert.equal(data.tags[0].color, color, 'tag color still autosaves');
          if (width === 320) {
            failNextTag = true;
            await tagForm.getByRole('textbox', { name: 'Tag name' }).fill('Recovered tag');
            await tagForm.locator('[data-save-status="error"]').waitFor();
            assert.match(await tagStatus.textContent(), /Not saved/);
            await page.evaluate(() => window.dispatchEvent(new Event('online')));
            await silentlySaved();
            assert.equal(data.tags[0].name, 'Recovered tag', 'failed edits still retry');
          }
          await page.screenshot({ path: `${output}/${theme}-${app}-${width}-sidebar-edit.png` });
          await tagForm.getByRole('button', { name: 'Done', exact: true }).click();
          await tagForm.waitFor({ state: 'hidden' });
        }
        await page.reload(); await openTagEditor();
        assert.equal(await tagForm.getByRole('textbox', { name: 'Tag name' }).inputValue(), 'Recovered tag', 'saved tag survives reload without a confirmation label');
        await tagForm.getByRole('button', { name: 'Done', exact: true }).click();
        assert.deepEqual(errors, []);
        console.log(`PASS ${theme} ${app}: silent sidebar tag saves, pending/error feedback and retry, home modal parity, labels, keyboard, draft cancel${['home', 'files'].includes(app) ? ', file/folder save, rollback, retry and reload' : ''}`);
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
