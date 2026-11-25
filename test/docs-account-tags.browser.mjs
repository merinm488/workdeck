// Built-package regression with synthetic API data only. No production account.
// WORKDECK_UI_BUILD=/tmp/workdeck-holm-release PLAYWRIGHT_PATH=/tmp/workdeck-ui-browser/node_modules/playwright/index.mjs CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/docs-account-tags.browser.mjs
import assert from 'node:assert/strict';
import { checkAccountAvatars } from './avatar-assertions.browser.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let file = path.join(root, new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
try {
  for (const theme of ['dark', 'light']) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', colorScheme: theme });
    await context.addInitScript(theme => localStorage.setItem('workdeck_theme', theme), theme);
    let doc = { id: 'record_docs_test', title: 'Tag editing test', content: 'Keep this content unchanged.', contentType: 'plain-text', tagId: null, version: 1, updatedAt: '2026-07-01T12:00:00Z' };
    let tags = [{ id: 'tag1', name: 'Planning', color: '#3b82f6' }], preference = theme;
    let failUpdate = false, creates = 0, docCreates = 0, updates = 0, checkingEditor = false;
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/me') return route.fulfill({ json: { member: { id: 'synthetic-member' } } });
      const body = route.request().postDataJSON();
      if (body?.action === 'updateSettings') preference = body.data.settings.theme;
      if (body?.action === 'createTag') tags.unshift({ id: 'tag' + ++creates + '-new', ...body.data });
      if (body?.action === 'createDoc') {
        docCreates++;
        doc = { ...doc, ...body.data, id: 'newdoc0000000001', version: 1 };
        return route.fulfill({ json: { success: true, doc, data: { docs: [doc], tags, settings: { theme: preference } } } });
      }
      if (body?.action === 'updateDoc') {
        updates++;
        assert.equal(body.data.docId, doc.id);
        assert.equal(body.data.version, doc.version, 'uses current document version');
        if (!checkingEditor) assert.deepEqual(Object.keys(body.data.updates), ['tagId'], 'tag dialog does not overwrite doc contents');
        if (failUpdate) { failUpdate = false; return route.fulfill({ status: 503, json: { success: false, error: 'Could not save tags. Try again.' } }); }
        doc = { ...doc, ...body.data.updates, version: doc.version + 1 };
      }
      return route.fulfill({ json: { success: true, data: { docs: [doc], tags, settings: { theme: preference } } } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const dialog = page.getByRole('dialog', { name: 'Edit tags', exact: true });
    const avatar = () => page.getByRole('button', { name: 'Account menu', exact: true }).last();
    const more = () => page.locator('.wd-doc-card .wd-card-more, .docs-list-grid [aria-label="More options"]').first();
    const openTags = async (trigger = more()) => {
      const url = page.url();
      await trigger.click();
      await page.getByRole('menuitem', { name: 'Edit Tags', exact: true }).click();
      await dialog.waitFor();
      assert.equal(page.url(), url, 'menu action does not open the doc');
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'focus enters modal');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    };
    const checkBlue = async locator => {
      assert.equal(await locator.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(66, 133, 244)');
    };
    try {
      await page.goto(origin + '/docs/');
      await more().waitFor();
      await checkAccountAvatars(page);
      const allItems = page.locator('#docsSidebar').getByRole('button', { name: 'All items', exact: true, includeHidden: true });
      assert.equal(await allItems.getAttribute('aria-current'), 'true');
      assert.equal(await allItems.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(66, 133, 244, 0.15)', 'All items preserves the Docs blue selection');
      assert.equal(await allItems.evaluate(el => getComputedStyle(el).fontWeight), '700');
      assert.equal(await avatar().locator('circle[cy="8"][r="4"]').count(), 1);
      await checkBlue(page.locator('.wd-docs-actions .btn-primary'));
      await avatar().click();
      await page.getByRole('button', { name: 'System theme', exact: true }).click();
      await page.keyboard.press('Escape');
      for (const mode of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: mode });
        await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
        await checkBlue(page.locator('.wd-docs-actions .btn-primary'));
      }
      await avatar().click();
      await page.getByRole('button', { name: theme === 'dark' ? 'Dark theme' : 'Light theme', exact: true }).click();
      await page.keyboard.press('Escape');

      // Opening and closing without changes never writes; focus returns.
      await openTags();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(updates, 0);
      assert.equal(await more().evaluate(el => el === document.activeElement), true);

      // Card assignment updates the badge and survives a full reload.
      await openTags();
      await dialog.getByLabel('Tag', { exact: true }).selectOption('tag1');
      await dialog.getByRole('status').filter({ hasText: 'All changes saved' }).waitFor();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.locator('.wd-doc-card .wd-file-project-name').getByText('Planning', { exact: true }).waitFor();
      await page.reload();
      await openTags();
      assert.equal(await dialog.getByLabel('Tag', { exact: true }).inputValue(), 'tag1');
      await page.keyboard.press('Escape');

      // Selecting a tag deselects All items; All items restores the full list.
      const openSidebar = async () => {
        const toggle = page.locator('header button[aria-controls="docsSidebar"]:visible');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      };
      await openSidebar();
      await page.locator('.wd-project-row[aria-label="Planning"]').click();
      assert.equal(await allItems.getAttribute('aria-current'), 'false');
      assert.equal(await allItems.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
      await openSidebar();
      await allItems.click();
      assert.equal(await allItems.getAttribute('aria-current'), 'true');

      // List menu clears a tag via null, not a made-up tag ID.
      await page.getByRole('button', { name: 'Switch to list view', exact: true }).click();
      await openTags();
      await dialog.getByLabel('Tag', { exact: true }).selectOption('');
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(doc.tagId, null);

      // Empty tag pool: create + assign. Failed assignment stays open and a
      // retry reuses the new tag instead of creating a duplicate.
      tags = [];
      await page.reload();
      await openTags();
      assert.match(await dialog.textContent(), /No tags yet/);
      await dialog.getByRole('button', { name: 'Create new tag', exact: true }).click();
      await dialog.getByLabel('Tag name', { exact: true }).fill('New project');
      failUpdate = true;
      await checkBlue(dialog.getByRole('button', { name: 'Create tag', exact: true }));
      await dialog.getByRole('button', { name: 'Create tag', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(creates, 1);
      assert.equal(doc.tagId, null);
      assert.equal(await dialog.getByLabel('Tag', { exact: true }).inputValue(), tags[0].id);
      await page.evaluate(() => dispatchEvent(new Event('online')));
      await dialog.getByRole('status').filter({ hasText: 'All changes saved' }).waitFor();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(creates, 1);
      assert.equal(doc.tagId, tags[0].id);
      assert.equal(doc.content, 'Keep this content unchanged.');

      // Sidebar uses exactly the same editor; on phones keep the drawer open.
      const toggle = page.locator('header button[aria-controls="docsSidebar"]:visible');
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      await page.locator('.wd-project-row[aria-label="New project"]').click();
      if (width < 1024) await toggle.click();
      const sidebarMore = page.locator('#docsSidebar [aria-label="More options"]');
      await openTags(sidebarMore);
      await dialog.getByLabel('Tag', { exact: true }).selectOption('');
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await sidebarMore.waitFor({ state: 'detached' });
      assert.equal(doc.tagId, null);

      // The editor's separately inherited gear also becomes an avatar.
      checkingEditor = true; // Editor autosaves use their normal title/content/tag payload.
      await page.goto(origin + '/docs/?doc=' + doc.id);
      await page.getByTitle('Edit doc (Cmd/Ctrl+E)', { exact: true }).waitFor();
      await avatar().waitFor();
      await checkAccountAvatars(page);
      assert.equal(await avatar().locator('circle[cy="8"][r="4"]').count(), 1);
      await avatar().click();
      await page.getByRole('button', { name: /^Theme:/ }).waitFor();
      await checkAccountAvatars(page);
      await avatar().click();
      await page.getByTitle('Edit doc (Cmd/Ctrl+E)', { exact: true }).click();
      const titleInput = page.getByPlaceholder('Doc title...');
      await titleInput.waitFor();
      await checkAccountAvatars(page);
      assert.equal(await page.getByRole('button', { name: 'Save Changes', exact: true }).count(), 0);
      await titleInput.fill('Automatically saved title');
      await page.getByRole('status').filter({ hasText: 'All changes saved' }).waitFor();
      assert.equal(doc.title, 'Automatically saved title');
      await page.reload();
      await page.getByTitle('Edit doc (Cmd/Ctrl+E)', { exact: true }).click();
      await titleInput.waitFor();
      assert.equal(await titleInput.inputValue(), 'Automatically saved title');
      await page.getByRole('button', { name: 'Go back', exact: true }).click();
      await titleInput.waitFor({ state: 'hidden' });
      await page.locator('.wd-docs-actions .btn-primary').click();
      await titleInput.waitFor();
      const content = '  Keep markdown whitespace  \n\n';
      await page.getByPlaceholder('Start writing your doc...').fill(content);
      await titleInput.fill('New autosaved document');
      await page.getByRole('status').filter({ hasText: 'All changes saved' }).waitFor();
      assert.equal(docCreates, 1, 'first edit creates exactly one doc automatically');
      assert.equal(doc.content, content);
      await titleInput.fill('Continue editing the new document');
      await page.getByRole('status').filter({ hasText: 'All changes saved' }).waitFor();
      assert.equal(docCreates, 1, 'further edits reuse the created document id');
      assert.equal(doc.title, 'Continue editing the new document');
      assert.deepEqual(errors, []);
      console.log(`PASS Docs ${theme} ${width}px: avatars, blue/system theme, card/list/sidebar tags, persistence, cancel and retry`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
