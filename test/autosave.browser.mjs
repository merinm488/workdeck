// Real built editors with synthetic API records. Never uses a production account.
import assert from 'node:assert/strict';
import { checkSheetsEditorHeader } from './sheets-editor-header.browser.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
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
// Optional live-asset check still intercepts EVERY API request below with
// synthetic records; it never signs in or reads/writes a production account.
const origin = process.env.AUTOSAVE_ORIGIN || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
try {
  for (const app of (process.env.AUTOSAVE_APPS || 'draw,slides,forms,sheets,todo,calendar,blog').split(',')) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, serviceWorkers: 'block' });
    const base = { id: 'record00000000001', name: 'Autosave test', title: 'Autosave test', version: 1, updatedAt: new Date().toISOString() };
    const workbook = { id: base.id, name: base.name, appVersion: '0.10.0', locale: 'enUS', sheetOrder: ['sheet1'], sheets: { sheet1: { id: 'sheet1', name: 'Sheet1', rowCount: 100, columnCount: 20, cellData: {} } }, styles: {} };
    const data = { settings: { theme: 'dark' }, tags: [],
      docs: [{ id: 'record00000000002', title: 'Linked reference', name: 'Linked reference', content: 'Reference document', updatedAt: base.updatedAt }],
      draws: [{ ...base, objects: [], background: '#ffffff' }],
      slides: [{ ...base, slides: [{ id: 'slide1', background: '#ffffff', objects: [] }] }],
      forms: [{ ...base, components: [{ id: 'Field_1', key: 'name', type: 'textfield', label: 'Name' }, { id: 'submit', type: 'button', action: 'submit', label: 'Submit' }] }],
      sheets: [{ ...base, data: workbook, formatVersion: 2 }],
      todo: [{ ...base, items: [{ id: 'task1', title: 'Original task', completed: false, priority: 'medium' }] }],
      posts: [{ ...base, html: '<p>Original post</p>', slug: 'autosave-test' }],
      calendars: [{ id: 'cal1', name: 'Personal', color: '#3b82f6' }],
      events: [{ ...base, calId: 'cal1', start: '2026-07-10T10:00:00.000Z', end: '2026-07-10T11:00:00.000Z', allDay: false, reminders: [], links: [], exdates: [] }]
    };
    const writes = [], previewWrites = []; let failNext = false;
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), body = route.request().postDataJSON();
      if (url.pathname === '/api/me') return route.fulfill({ json: { member: { id: 'synthetic', name: 'Test User', theme: 'dark' } } });
      if (url.pathname === '/api/todo/lists' && !body) return route.fulfill({ json: { lists: data.todo, settings: data.settings } });
      if (url.pathname.startsWith('/api/todo/lists/') && body) {
        writes.push(structuredClone(body)); data.todo[0] = { ...data.todo[0], ...body, version: data.todo[0].version + 1 };
        return route.fulfill({ json: { list: data.todo[0] } });
      }
      if (body?.action === 'updateSheetPreview') {
        assert.equal(body.data.version, data.sheets[0].version);
        previewWrites.push(structuredClone(body));
        Object.assign(data.sheets[0], { thumbnail: body.data.thumbnail, thumbnailStyle: 'univer-light-v1',
          thumbnailRevision: (data.sheets[0].thumbnailRevision || 0) + 1, thumbnailContentVersion: body.data.version });
      }
      if (body?.action && ['updateDrawing', 'updateDeck', 'updateForm', 'updateSheet', 'updateEvent', 'createEvent', 'updatePost'].includes(body.action)) {
        writes.push(structuredClone(body));
        if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { success: false, error: 'Synthetic temporary failure' } }); }
        const mapping = { updateDrawing: ['draws', 'drawingData'], updateDeck: ['slides', 'deckData'], updateForm: ['forms', 'formData'], updateSheet: ['sheets', 'sheetData'], updateEvent: ['events', 'event'] };
        if (body.action === 'updatePost') data.posts[0] = { ...data.posts[0], ...body.data };
        else if (body.action === 'createEvent') data.events.push(body.data.event || body.data);
        else {
          const [key, field] = mapping[body.action];
          const index = key === 'events' ? data.events.findIndex(event => event.id === body.data.eventId) : 0;
          data[key][index] = { ...data[key][index], ...body.data[field], version: data[key][index].version + 1 };
          if (key === 'sheets' && body.data[field].thumbnail) {
            data.sheets[0].thumbnailRevision = (data.sheets[0].thumbnailRevision || 0) + 1;
            data.sheets[0].thumbnailContentVersion = data.sheets[0].version;
          }
        }
      }
      if (url.searchParams.has('thumbnail')) {
        const image = data.sheets[0].thumbnail;
        assert.ok(image, 'saved checkpoint exists before card loads');
        return route.fulfill({ contentType: image.split(';')[0].slice(5), body: Buffer.from(image.split(',')[1], 'base64') });
      }
      if (url.searchParams.has('sheet')) return route.fulfill({ json: { success: true, data: data.sheets[0].data } });
      const listed = structuredClone(data);
      if (listed.sheets[0].thumbnail) { listed.sheets[0].thumbRef = 1; delete listed.sheets[0].thumbnail; }
      return route.fulfill({ json: { success: true, data: listed, responses: [] } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.dismiss());
    try {
      const url = `${origin}/${app}/${['todo', 'calendar', 'blog'].includes(app) ? '' : 'editor.html'}?${app === 'todo' ? 'list' : app === 'blog' ? 'post' : 'id'}=${base.id}`;
      const initialPreview = app === 'sheets' ? page.waitForResponse(response => response.request().method() === 'PUT' &&
        response.request().postDataJSON()?.action === 'updateSheetPreview') : null;
      await page.goto(url);
      assert.equal(await page.locator('#saveBtn').count(), 0);
      if (app === 'draw' || app === 'slides') {
        await page.waitForFunction(() => typeof editorState !== 'undefined' && editorState.autosave && editorState.canvas);
        failNext = true;
        await page.evaluate(() => editorState.canvas.add(new fabric.Rect({ left: 40, top: 40, width: 60, height: 60, fill: '#ff0000' })));
        await page.locator('[data-save-status=error]').waitFor();
        assert.equal(writes.length, 1, `${app}: write failed but content remains dirty`);
        await page.evaluate(() => { editorState.canvas.add(new fabric.Rect({ left: 120, top: 40, width: 80, height: 60, fill: '#0000ff' })); dispatchEvent(new Event('online')); });
        await page.locator('[data-save-status=saved]').waitFor();
        const objects = app === 'draw' ? data.draws[0].objects : data.slides[0].slides[0].objects;
        assert.equal(objects.length, 2, `${app}: retries preserve newer edits`);
        await page.reload();
        await page.waitForFunction(() => typeof editorState !== 'undefined' && editorState.autosave && editorState.canvas.getObjects().length === 2);
      } else if (app === 'forms') {
        await page.waitForFunction(() => window.formsEditorApp?.isInitialized);
        await page.locator('#formTitle').click();
        await page.locator('.form-title-input').fill('Automatically saved form');
        await page.locator('.form-title-input').press('Enter');
        await page.locator('[data-save-status=saved]').waitFor();
        assert.equal(data.forms[0].name, 'Automatically saved form');
        failNext = true;
        await page.evaluate(() => {
          const builder = formsEditorApp.builderInstance;
          builder.get('modeling').editFormField(builder._getState().schema.components[0], 'label', 'Automatically saved question');
        });
        await page.locator('[data-save-status=error]').waitFor();
        await page.evaluate(() => dispatchEvent(new Event('online')));
        await page.locator('[data-save-status=saved]').waitFor();
        assert.equal(data.forms[0].components[0].label, 'Automatically saved question');
        await page.reload(); await page.locator('#formTitle').filter({ hasText: 'Automatically saved form' }).waitFor();
      } else if (app === 'sheets') {
        await page.waitForFunction(() => window.sheetsApp?.isInitialized);
        await initialPreview;
        assert.equal(previewWrites.length, 1, 'old preview upgrades on open, without an edit');
        assert.equal(writes.length, 0, 'preview migration does not save workbook contents');
        assert.equal(data.sheets[0].version, 1);
        assert.equal(data.sheets[0].updatedAt, base.updatedAt);
        await checkSheetsEditorHeader(page, () => data.sheets[0]);
        failNext = true;
        await page.evaluate(() => {
          const sheet = spreadsheetManager.getCurrentSheetData();
          sheet.getRange('A1').setValue('Autosaved cell');
          sheet.getRange('B2:D4').setBackgroundColor('#22cc66');
        });
        await page.locator('[data-save-status=error]').waitFor();
        await page.evaluate(() => dispatchEvent(new Event('online')));
        await page.locator('[data-save-status=saved]').waitFor();
        assert.equal(data.sheets[0].data.sheets.sheet1.cellData[0][0].v, 'Autosaved cell');
        await page.goto(url); await page.waitForFunction(() => window.sheetsApp?.isInitialized);
        assert.equal(await page.evaluate(() => spreadsheetManager.getCurrentSheetData().getRange('A1').getValue()), 'Autosaved cell');
        assert.match(data.sheets[0].thumbnail, /^data:image\/(png|jpeg);base64,/);
        const checkpoint = data.sheets[0].thumbnail, writeCount = writes.length;
        const imageStats = await page.evaluate(async src => {
          const image = new Image(); image.src = src; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let green = 0, white = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] < 65 && pixels[i + 1] > 175 && pixels[i + 2] > 70 && pixels[i + 2] < 140) green++;
            if (pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245) white++;
          }
          return { width: image.width, height: image.height, green, whiteRatio: white / (image.width * image.height) };
        }, checkpoint);
        assert.ok(imageStats.width >= 320 && imageStats.height > 100 && imageStats.green > 100, 'snapshot contains authored formatting from the real grid: ' + JSON.stringify(imageStats));
        assert.equal(imageStats.width, 640, 'pre-migration snapshot dimensions retained');
        assert.ok(imageStats.whiteRatio > .7, 'saved sheet is light even while editing in dark mode: ' + JSON.stringify(imageStats));
        assert.deepEqual(await page.evaluate(() => ({ page: document.documentElement.dataset.theme,
          engine: spreadsheetManager.univerAPI._injector.get(UniverCore.ThemeService).darkMode,
          tracked: spreadsheetManager.darkModeOn, darkClass: document.documentElement.classList.contains('univer-dark') })),
          { page: 'dark', engine: true, tracked: true, darkClass: true }, 'capture preserves the actual editor theme');
        const equivalence = await page.evaluate(() => {
          const manager = spreadsheetManager, api = manager.univerAPI;
          const beforeBody = JSON.stringify(manager.getData());
          const beforePixels = manager.captureCanvasThumbnail();
          const fromDark = manager.captureThumbnail();
          const restoredPixels = manager.captureCanvasThumbnail();
          api.toggleDarkMode(false);
          const fromLight = manager.captureThumbnail();
          const realLightCanvas = manager.captureCanvasThumbnail();
          api.toggleDarkMode(true);
          manager.captureThumbnail(); // Synchronous repaint/restore for comparison.
          WDSheetSnapshots.capture(manager, () => { throw new Error('Synthetic failed screenshot'); });
          return { sameInBothThemes: fromDark === fromLight, copiesActualLightCanvas: fromLight === realLightCanvas,
            darkPixelsRestored: beforePixels === restoredPixels,
            failedCaptureRestored: manager.captureCanvasThumbnail() === beforePixels,
            noContentChange: beforeBody === JSON.stringify(manager.getData()) };
        });
        assert.deepEqual(equivalence, { sameInBothThemes: true, copiesActualLightCanvas: true,
          darkPixelsRestored: true, failedCaptureRestored: true, noContentChange: true });
        await page.evaluate(() => {
          spreadsheetManager.getCurrentSheetData().getRange('C7').activate();
          window.dispatchEvent(new Event('resize'));
          window.dispatchEvent(new Event('pagehide'));
        });
        await page.waitForTimeout(1300);
        assert.equal(writes.length, writeCount, 'view-only changes do not save a checkpoint');
        assert.equal(previewWrites.length, 1, 'light previews are not regenerated on reload or view changes');
        assert.equal(data.sheets[0].thumbnail, checkpoint);
        // A failed save must leave the prior image visible, not publish the
        // unsaved canvas. Retry later replaces body and image together.
        failNext = true;
        await page.evaluate(() => spreadsheetManager.getCurrentSheetData().getRange('A1').setValue('New checkpoint'));
        await page.locator('[data-save-status=error]').waitFor();
        assert.equal(data.sheets[0].thumbnail, checkpoint);
        await page.evaluate(() => dispatchEvent(new Event('online')));
        await page.locator('[data-save-status=saved]').waitFor();
        assert.notEqual(data.sheets[0].thumbnail, checkpoint);
        const latest = data.sheets[0].thumbnail;
        console.log('Sheets saved snapshot:', imageStats, checkpoint.length, 'bytes');
        await page.goto(origin + '/sheets/');
        const preview = page.locator('.wd-home-card-face .wd-file-preview img').first();
        await preview.waitFor();
        await page.waitForFunction(() => document.querySelector('.wd-home-card-face .wd-file-preview img')?.naturalWidth > 0);
        assert.ok((await preview.getAttribute('src')).includes('/api/users?thumbnail='), 'direct checkpoint image');
        assert.equal(await page.locator('.wd-file-preview canvas, .home-view-indicator').count(), 0);
        assert.equal(await page.evaluate(() => typeof window.UniverPresets), 'undefined', 'home never boots the spreadsheet engine');
        assert.equal(data.sheets[0].thumbnail, latest);
        await page.screenshot({ path: '/tmp/workdeck-sheets-saved-preview.png' });
      } else if (app === 'todo') {
        await page.waitForFunction(() => typeof currentList !== 'undefined' && currentList?.items?.length);
        await page.evaluate(() => openEditModal('task1'));
        await page.locator('#editTitle').fill('Automatically saved task');
        await page.locator('#taskSaveState[data-save-status=saved]').waitFor();
        assert.equal(data.todo[0].items[0].title, 'Automatically saved task');
        assert.equal(await page.getByRole('button', { name: 'Save Changes', exact: true }).count(), 0);
        await page.locator('#cancelEdit').click(); await page.locator('#editTaskModal.active').waitFor({ state: 'hidden' }); await page.reload();
        await page.waitForFunction(() => typeof currentList !== 'undefined' && currentList?.items?.[0]?.title === 'Automatically saved task');
      } else if (app === 'blog') {
        await page.locator('#postTitleInput').waitFor();
        failNext = true;
        await page.locator('#postTitleInput').fill('Automatically saved blog post');
        await page.locator('[data-save-status=error]').waitFor();
        await page.locator('.ql-editor[contenteditable=true]').fill('Keep the newest blog text');
        await page.evaluate(() => dispatchEvent(new Event('online')));
        await page.locator('[data-save-status=saved]').waitFor();
        assert.equal(data.posts[0].title, 'Automatically saved blog post');
        assert.match(data.posts[0].html, /Keep the newest blog text/);
        await page.reload();
        await page.locator('#postTitleInput').waitFor();
        assert.equal(await page.locator('#postTitleInput').inputValue(), 'Automatically saved blog post');
      } else {
        await page.waitForFunction(() => typeof calendar !== 'undefined' && calendar && userData?.events?.length);
        await page.evaluate(id => openEditorForRecord(id), base.id);
        await page.locator('#evTitle').fill('Automatically saved event');
        await page.locator('#eventSaveState[data-save-status=saved]').waitFor();
        assert.equal(data.events[0].title, 'Automatically saved event');
        assert.equal(await page.locator('#evSaveBtn').isVisible(), false);
        await page.locator('#evCancelBtn').click(); await page.locator('#eventModal.active').waitFor({ state: 'hidden' }); await page.reload();
        await page.waitForFunction(() => typeof userData !== 'undefined' && userData?.events?.[0]?.title === 'Automatically saved event');
        data.events[0].rrule = 'FREQ=DAILY';
        await page.reload();
        await page.waitForFunction(() => typeof userData !== 'undefined' && userData?.events?.[0]?.rrule);
        await page.evaluate(id => openEditorForRecord(id, '2026-07-11T10:00:00.000Z'), base.id);
        await page.locator('#scopeModal.active').waitFor();
        const beforeScope = writes.length;
        await page.evaluate(() => applyScope('this'));
        assert.equal(writes.length, beforeScope, 'choosing recurrence scope alone never changes data');
        await page.locator('#evTitle').fill('Only this occurrence');
        await page.locator('#eventSaveState[data-save-status=saved]').waitFor();
        const exceptions = () => data.events.filter(event => event.parentEventId === base.id);
        assert.equal(exceptions().length, 1);
        await page.locator('#evTitle').fill('Keep editing this occurrence');
        await page.locator('#eventSaveState[data-save-status=saved]').waitFor();
        assert.equal(exceptions().length, 1, 'further autosaves update the exception rather than duplicate it');
        assert.equal(exceptions()[0].title, 'Keep editing this occurrence');
      }
      assert.deepEqual(errors, [], app);
      console.log(`PASS ${app}: automatic saving, passive status, reload persistence${['draw','slides','sheets'].includes(app) ? ', failure recovery' : ''}`);
    } catch (error) {
      console.error({ app, errors, writes, url: page.url(), state: await page.evaluate(() => ({ status: document.querySelector('#eventSaveState')?.textContent, dirty: typeof eventAutosave !== 'undefined' ? eventAutosave?.dirty() : null, editing: typeof editing !== 'undefined' ? editing : null })) });
      await page.screenshot({ path: `/tmp/workdeck-autosave-${app}-failure.png` });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
