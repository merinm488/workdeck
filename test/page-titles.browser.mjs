// Check real app homes/editors/shared viewers with synthetic member data only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { appNames } from '../holm/auth/page-title-build.mjs';
import { newFileWorkspace } from './fixtures/new-file-workspace.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const server = createServer(async (req, res) => {
  try {
    let file = path.join(root, new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.WORKDECK_UI_ORIGIN || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const initial = 'test <plan> & v1.0', renamed = 'Renamed 日本語 & v2.0';
const config = {
  docs: ['createDoc', 'user_docs', '?doc=', 'title'],
  sheets: ['createSheet', 'sheet_records', 'editor.html?id=', 'name'],
  forms: ['createForm', 'user_forms', 'editor.html?id=', 'name'],
  slides: ['createDeck', 'slide_decks', 'editor.html?id=', 'name'],
  draw: ['createDrawing', 'canvas_drawings', 'editor.html?id=', 'name'],
  todo: ['createTodo', 'todo_lists', '?list=', 'name'],
  kanban: ['createKanban', 'kanban_boards', '?board=', 'name'],
  minutes: ['createMinutes', 'meeting_minutes', '?meeting=', 'title'],
  blog: ['createPost', 'blog_posts', '?post=', 'title'],
};
const titleIs = async (page, title) => {
  await page.waitForFunction(expected => document.title === expected, title);
  assert.equal(await page.title(), title);
};
try {
  for (const [app, name] of Object.entries(appNames).filter(([app]) => !process.env.TITLE_APPS || process.env.TITLE_APPS.split(',').includes(app))) {
    const workspace = newFileWorkspace(), { ds } = workspace;
    let id;
    if (config[app]) {
      id = (await workspace.create(config[app][0])).createdFile.id;
      const result = await workspace.create('renameFile', { app, fileId: id, name: initial });
      assert.equal(result.success, true);
    } else if (app === 'files') {
      id = ds.insert('file_records', { name: initial + '.txt', mimeType: 'text/plain', size: 12, tags: [], updatedAt: new Date().toISOString() });
    } else ds.insert('user_calendars', { name: 'Personal', color: '#4285f4', visible: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const errors = [];
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/api/filebox') return route.fulfill({ contentType: 'text/plain', body: 'Test content' });
      if (url.searchParams.has('shared')) {
        const record = ds.findOne(config[app][1], id);
        const field = { docs: 'doc', sheets: 'sheet', forms: 'form', slides: 'deck', draw: 'drawing' }[app];
        if (app === 'sheets') record.data = ds.find('sheet_bodies', { sheetId: id })[0].data;
        return route.fulfill({ json: { success: true, [field]: record, sharedAt: record.updatedAt } });
      }
      const response = await workspace.fetch(request.url(), { method: request.method(), ...(request.postData() ? { body: request.postData() } : {}) });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${origin}/${app}/`, { waitUntil: 'networkidle' });
      await titleIs(page, name);
      if (config[app]) {
        const route = `${origin}/${app}/${config[app][2]}${id}${app === 'docs' ? '&edit=1' : ''}`;
        await page.goto(route);
        await titleIs(page, initial);
        if (app === 'docs') await page.getByPlaceholder('Doc title...').fill(renamed);
        else if (app === 'blog') await page.locator('#postTitleInput').fill(renamed);
        else if (['sheets', 'forms', 'todo'].includes(app)) {
          const heading = { sheets: '#spreadsheetTitle', forms: '#formTitle', todo: '#pageTitle' }[app];
          const input = { sheets: '.spreadsheet-title-input', forms: '.form-title-input', todo: '.page-title-input' }[app];
          await page.locator(heading).click();
          await page.locator(input).fill(renamed);
          await page.locator(input).press('Enter');
        } else if (['slides', 'draw'].includes(app)) {
          await page.locator(app === 'slides' ? '#deckTitle' : '#drawingTitle').click();
          await page.locator('#renameInput').fill(renamed);
          await page.locator('#renameConfirmBtn').click();
        } else if (app === 'kanban') {
          await page.locator('#pageTitle').click();
          await page.locator('#nameModalInput').fill(renamed);
          await page.locator('#confirmNameModal').click();
        } else if (app === 'minutes') {
          await page.locator('#documentName').click();
          const dialog = page.getByRole('dialog', { name: 'Rename meeting', exact: true });
          await dialog.getByRole('textbox').fill(renamed);
          await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
        }
        await titleIs(page, renamed);
        // Let debounced autosave persist before reloading the editor.
        const deadline = Date.now() + 10000;
        while (ds.findOne(config[app][1], id)?.[config[app][3]] !== renamed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(ds.findOne(config[app][1], id)?.[config[app][3]], renamed);
        await page.reload();
        await titleIs(page, renamed);
        const back = { docs: '[aria-label="Go back"]', blog: '#backToPosts', minutes: '#backBtn' }[app] || '#homeBtn';
        await page.locator(back).click();
        await titleIs(page, name);
        // SPA history must restore file/home titles without relying on a reload.
        if (['kanban', 'minutes', 'docs'].includes(app)) {
          await page.goBack();
          await titleIs(page, renamed);
          await page.goForward();
          await titleIs(page, name);
        }
        if (['docs', 'sheets', 'forms', 'slides', 'draw'].includes(app)) {
          await page.goto(`${origin}/${app}/${app === 'docs' ? '' : 'shared.html'}?shared=${'a'.repeat(48)}`);
          await titleIs(page, renamed);
        }
      } else if (app === 'files') {
        await page.goto(`${origin}/files/?id=${id}`);
        await titleIs(page, `${initial}.txt`);
        await page.locator('#fbViewerClose').click();
        await titleIs(page, 'Files');
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${name}: app-only home${id ? ', filename-only title, return home' : ''}${config[app] ? ', rename and reload' : ''}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
