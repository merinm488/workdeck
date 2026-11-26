// Real Home -> New -> editor flows, using real API handlers and synthetic storage.
// Optional live origin tests deployed assets; ALL API calls remain intercepted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { newFileWorkspace } from './fixtures/new-file-workspace.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const server = createServer(async (req, res) => {
  try {
    let file = path.join(root, new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.WORKDECK_UI_ORIGIN || `http://127.0.0.1:${server.address().port}`;
const homeHTML = await readFile(path.join(root, '../api/home.html'), 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
try {
  for (const width of [1280, 390]) for (const app of ['docs', 'sheets']) {
    const workspace = newFileWorkspace();
    const { ds } = workspace;
    const action = app === 'docs' ? 'createDoc' : 'createSheet';
    const collection = app === 'docs' ? 'user_docs' : 'sheet_records';
    const oldId = (await workspace.create(action)).createdFile.id;
    if (app === 'docs') ds.update(collection, { id: oldId }, { $set: { title: 'Existing doc', content: 'Do not change this document' } });
    else {
      const body = ds.find('sheet_bodies', { sheetId: oldId })[0];
      body.data.sheets[body.data.sheetOrder[0]].cellData = { 0: { 0: { v: 'Do not change this cell' } } };
      ds.update('sheet_bodies', { id: body.id }, { $set: { data: body.data } });
    }
    const oldRecord = ds.findOne(collection, oldId);
    const oldBody = app === 'sheets' ? ds.find('sheet_bodies', { sheetId: oldId }) : null;
    const mobile = width < 1024;
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const createdIds = [], writes = [], errors = [];
    // The private shell requires authentication in production. Use the packaged
    // shell with a synthetic session, but fetch its scripts/styles from origin.
    await context.route('**/home', route => route.fulfill({ contentType: 'text/html', body: homeHTML }));
    await context.route('**/api/**', async route => {
      const request = route.request(), body = request.postDataJSON();
      if (body?.action) writes.push(body);
      if (app === 'docs' && new URL(request.url()).pathname === '/api/docs') {
        // Exercise the ID-only loading stub before the document list arrives.
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const response = await workspace.fetch(request.url(), { method: request.method(), ...(request.postData() ? { body: request.postData() } : {}) });
      if (body?.action === action) createdIds.push((await response.clone().json()).createdFile.id);
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    let home = await context.newPage();
    try {
      for (let n = 0; n < 2; n++) {
        await home.goto(origin + '/home');
        await home.locator('#newBtn').click();
        const popup = mobile ? null : home.waitForEvent('popup');
        await home.locator(`#newDropdown [data-app="${app}"] img`).click();
        const editor = popup ? await popup : home;
        await editor.waitForURL(url => url.pathname.startsWith(`/${app}/`));
        const id = createdIds.at(-1);
        assert.ok(id);
        assert.notEqual(id, oldId);
        assert.equal(new URL(editor.url()).searchParams.get(app === 'docs' ? 'doc' : 'id'), id);
        if (app === 'docs') {
          const title = editor.getByPlaceholder('Doc title...');
          await title.waitFor();
          assert.equal(await title.inputValue(), 'Untitled');
          const content = editor.getByPlaceholder('Start writing your doc...');
          assert.equal(await content.inputValue(), '');
          await content.fill(`Fresh document ${n}`);
          await title.fill(`Created from Home ${n}`);
          await editor.getByRole('status').filter({ hasText: 'All changes saved' }).waitFor();
          assert.equal(ds.findOne(collection, id).content, `Fresh document ${n}`);
          assert.equal(ds.findOne(collection, id).title, `Created from Home ${n}`);
          assert.equal(writes.filter(write => write.action === 'createDoc').length, n + 1, 'editing does not create a duplicate');
          // Existing edit deep links hydrate full saved content, never blank it.
          await editor.goto(`${origin}/docs/?doc=${id}&edit=1`);
          await title.waitFor();
          assert.equal(await title.inputValue(), `Created from Home ${n}`);
          assert.equal(await content.inputValue(), `Fresh document ${n}`);
        } else {
          await editor.waitForFunction(() => window.sheetsApp?.isInitialized);
          assert.equal(await editor.evaluate(() => spreadsheetManager.currentSheetId), id);
          assert.ok([null, ''].includes(await editor.evaluate(() => spreadsheetManager.getCurrentSheetData().getRange('A1').getValue())));
          await editor.evaluate(() => spreadsheetManager.getCurrentSheetData().getRange('A1').setValue('Fresh spreadsheet'));
          await editor.locator('[data-save-status=saved]').waitFor();
          const body = ds.find('sheet_bodies', { sheetId: id })[0].data;
          assert.equal(body.sheets[body.sheetOrder[0]].cellData[0][0].v, 'Fresh spreadsheet');
          await editor.reload();
          await editor.waitForFunction(() => window.sheetsApp?.isInitialized);
          assert.equal(await editor.evaluate(() => spreadsheetManager.getCurrentSheetData().getRange('A1').getValue()), 'Fresh spreadsheet');
        }
        assert.deepEqual(ds.findOne(collection, oldId), oldRecord, 'existing file stays untouched');
        if (oldBody) assert.deepEqual(ds.find('sheet_bodies', { sheetId: oldId }), oldBody);
        if (!mobile) await editor.close();
      }
      assert.equal(new Set(createdIds).size, 2);
      assert.deepEqual(errors, []);
      console.log(`PASS New ${app} ${width}px: two distinct blank editors, autosave/reopen, existing file untouched`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
