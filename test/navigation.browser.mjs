// Slow-network regression checks. Uses only synthetic accounts/data.
// WORKDECK_UI_BUILD=/tmp/workdeck-holm-release PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROME=/path/to/chrome node test/navigation.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const server = createServer(async (req, res) => {
  try {
    let file = path.join(root, new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const viewport = { width: Number(process.env.UI_WIDTH || 1440), height: 980 };
const record = { id: 'record00000000001', name: 'Planning', title: 'Planning', tagId: 'tag1', version: 1, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' };
const board = { ...record, columns: [{ id: 'column0000000001', label: 'Todo' }], rows: [], cards: [], links: [] };
function fixture() {
  return structuredClone({ tags: [{ id: 'tag1', name: 'Team', color: '#3B82F6' }], settings: { theme: 'dark' },
    docs: [{ ...record, pinned: true, content: 'Old pinned doc', contentType: 'plain-text' },
      { ...record, id: 'record00000000002', title: 'Newest doc', pinned: false, content: '', contentType: 'plain-text', updatedAt: '2026-07-02T00:00:00Z' }],
    kanban: [board], sheets: [{ ...record, rows: 20, cols: 5 }], todo: [{ ...record, items: [] }], forms: [{ ...record, components: [] }],
    slides: [{ ...record, slides: [] }], draws: [{ ...record, canvas: { objects: [] } }], posts: [{ ...record, excerpt: '' }], minutes: [{ ...record, date: '2026-07-01', state: 'draft', agenda: [] }],
  });
}
const layoutKeys = { sheets: 'sheets_home_layout', forms: 'forms_home_layout', slides: 'slides_home_layout', draw: 'draw_home_layout', todo: 'todo_lists_layout', kanban: 'wd_kanban_layout', blog: 'wd_blog_layout', minutes: 'wd_minutes_layout', docs: 'docs_view_mode' };
async function monitor(context, app, mode = 'list') {
  await context.addInitScript(({ key, mode }) => {
    localStorage.setItem('workdeck_theme', 'dark'); localStorage.setItem(key, mode);
    window.testInstance = Math.random(); window.framesSeen = [];
    function sample() {
      const grid = document.querySelector('#boardsGrid,#listsGrid,#homeGrid,#spreadsheetsContainer,#postsList,#meetingList');
      if (grid?.querySelector('[data-id]') && !grid.closest('.hidden') && getComputedStyle(grid).visibility === 'visible') {
        window.framesSeen.push({ list: grid.classList.contains('as-list'), display: getComputedStyle(grid).display });
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }, { key: layoutKeys[app], mode });
}
async function checkFrames(page, label) {
  const frames = await page.evaluate(() => window.framesSeen);
  assert.ok(frames.length, `${label}: sampled visible results`);
  assert.ok(frames.every(frame => frame.list && frame.display === 'flex'), `${label}: no frame shows cards before saved list layout`);
}
try {
  // Each independently loaded app can finish before the tag/sidebar request.
  // A slow workspace response must never expose the native cards first.
  for (const app of Object.keys(layoutKeys).filter(app => app !== 'docs')) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    try {
      await monitor(context, app);
      const data = fixture();
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/workdeck' || url.pathname === '/api/kanban') await sleep(650);
        return route.fulfill({ json: url.pathname === '/api/me' ? { member: { name: 'Test User', theme: 'dark' } }
          : url.pathname === '/api/todo/lists' ? { lists: data.todo, tags: data.tags, settings: data.settings } : { success: true, data } });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/${app}/`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-wd-home-pending'));
      await sleep(100);
      await checkFrames(page, app);
      const toggle = page.getByRole('button', { name: 'Switch to card view', exact: true });
      assert.ok(await toggle.isVisible(), `${app}: toggle matches saved preference`);
      await page.reload({ waitUntil: 'networkidle' });
      await checkFrames(page, `${app} reload`);
      assert.deepEqual(errors, []);
      console.log(`PASS ${app}: slow initial load/reload never paints cards for a list preference`);
    } finally { await context.close(); }
  }

  // Failed initial loads show Retry, not a false empty home or a stuck overlay.
  for (const app of ['kanban', 'forms']) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    try {
      await monitor(context, app);
      let failing = true;
      const data = fixture();
      await context.route('**/api/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (failing && pathname === (app === 'kanban' ? '/api/kanban' : '/api/forms')) {
          return route.fulfill({ status: 503, json: { error: 'Test failure' } });
        }
        return route.fulfill({ json: pathname === '/api/me' ? { member: { name: 'Test User', theme: 'dark' } } : { success: true, data } });
      });
      const page = await context.newPage();
      await page.goto(`${origin}/${app}/`, { waitUntil: 'networkidle' });
      const retry = page.getByRole('button', { name: 'Retry', exact: true });
      assert.equal(await retry.isVisible(), true, `${app}: persistent retry state`);
      if (app === 'kanban') assert.equal(await page.locator('#newBoardBtn').isDisabled(), true);
      failing = false;
      await retry.click();
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-wd-home-pending'));
      await sleep(150);
      await checkFrames(page, `${app} retry`);
      console.log(`PASS ${app}: initial failure and retry keep the saved layout`);
    } finally { await context.close(); }
  }

  // Kanban navigation reuses the verified data and persists edits before leaving.
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  try {
    await monitor(context, 'kanban');
    const data = fixture(), requests = [];
    let failSave = false, failCreate = false, holdSave, saveStarted, releaseCreate;
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), body = request.postDataJSON();
      requests.push({ path: url.pathname, method: request.method(), action: body?.action });
      if (url.pathname === '/api/me') return route.fulfill({ json: { member: { name: 'Test User', theme: 'dark' } } });
      if (body?.action === 'createBoard') {
        await new Promise(resolve => { releaseCreate = resolve; });
        if (failCreate) return route.fulfill({ status: 503, json: { error: 'Test failure' } });
        const created = { ...structuredClone(board), id: 'created000000001', name: body.data.name, tagId: null };
        data.kanban.unshift(created);
        return route.fulfill({ json: { success: true, board: created } });
      }
      if (body?.action === 'updateBoard') {
        saveStarted?.();
        if (holdSave) await holdSave;
        if (failSave) return route.fulfill({ status: 409, json: { error: 'Stale board' } });
        const old = data.kanban.find(board => board.id === body.data.boardId);
        assert.equal(body.data.version, old.version, 'save uses the latest acknowledged version');
        Object.assign(old, body.data.board, { version: old.version + 1, updatedAt: new Date().toISOString() });
        return route.fulfill({ json: { success: true, board: old } });
      }
      if (!body) await sleep(300);
      return route.fulfill({ json: { success: true, data } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/kanban/`, { waitUntil: 'networkidle' });
    const instance = await page.evaluate(() => window.testInstance);
    const getCount = () => requests.filter(r => r.method === 'GET' && ['/api/kanban', '/api/workdeck'].includes(r.path)).length;
    assert.equal(getCount(), 1, 'one initial data request, no whole-workspace duplication');
    await page.locator('#newBoardBtn').click();
    await page.locator('#nameModalInput').fill('Fast board');
    await page.locator('#confirmNameModal').click();
    await page.evaluate(() => createBoard('Duplicate'));
    await page.waitForFunction(() => !document.querySelector('#loadingOverlay').classList.contains('hidden'));
    while (!releaseCreate) await sleep(10);
    assert.equal(requests.filter(r => r.action === 'createBoard').length, 1, 'duplicate creation is blocked');
    releaseCreate();
    await page.locator('#boardView').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pageTitle').textContent(), 'Fast board');
    assert.equal(await page.evaluate(() => window.testInstance), instance, 'creation does not reload the document');
    assert.equal(getCount(), 1, 'creation response opens directly without refetch');

    await page.locator('.kb-col-add').first().click();
    await page.locator('.kb-composer-input').first().fill('Save before leaving');
    await page.locator('.kb-composer-input').first().press('Enter');
    let releaseSave;
    holdSave = new Promise(resolve => { releaseSave = resolve; });
    const saving = new Promise(resolve => { saveStarted = resolve; });
    await page.locator('#homeBtn').click();
    await saving;
    assert.equal(await page.locator('#boardView').isVisible(), true, 'board stays visible while edits save');
    releaseSave(); holdSave = null;
    await page.locator('#boardsView').waitFor({ state: 'visible' });
    assert.equal(data.kanban[0].cards[0].label, 'Save before leaving');
    assert.equal(await page.locator('#boardsGrid').getAttribute('class').then(c => c.includes('as-list')), true);
    assert.equal(await page.evaluate(() => window.testInstance), instance, 'app Back does not reload');
    await page.goBack();
    await page.locator('#boardView').waitFor({ state: 'visible' });
    await page.goForward();
    await page.locator('#boardsView').waitFor({ state: 'visible' });
    assert.equal(getCount(), 1, 'back/forward reuse loaded data');
    await checkFrames(page, 'Kanban back/forward');
    await page.locator('#boardsGrid > [data-id="record00000000001"]').click();
    await page.locator('#boardSearchInput').fill('A filter from another board');
    await page.locator('#homeBtn').click();
    await page.locator('#boardsView').waitFor({ state: 'visible' });

    await page.locator('#boardsGrid > [data-id="created000000001"]').click();
    assert.equal(await page.locator('#boardSearchInput').inputValue(), '', 'another board never inherits the previous card filter');
    await page.evaluate(() => { KanbanBoard.board.name = 'Unsaved title'; KanbanBoard.scheduleSave(); });
    failSave = true;
    await page.locator('#homeBtn').click();
    await page.waitForFunction(() => document.querySelector('#notification').textContent.includes('changes kept here'));
    assert.ok(page.url().includes('board=created000000001'));
    assert.equal(await page.locator('#boardView').isVisible(), true);
    assert.equal(await page.evaluate(() => KanbanBoard.dirty), true);
    failSave = false;
    await page.locator('#homeBtn').click();
    await page.locator('#boardsView').waitFor({ state: 'visible' });
    assert.equal(data.kanban[0].name, 'Unsaved title');

    failCreate = true; releaseCreate = null;
    await page.locator('#newBoardBtn').click();
    await page.locator('#nameModalInput').fill('Fails safely');
    await page.locator('#confirmNameModal').click();
    while (!releaseCreate) await sleep(10);
    releaseCreate();
    await page.waitForFunction(() => document.querySelector('#notification').textContent.includes('Failed to create board'));
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.locator('#boardsView').isVisible(), true);
    assert.equal(data.kanban.length, 2);

    // A direct board reload must not show the home first, even during slow auth/data.
    await page.goto(`${origin}/kanban/?board=created000000001`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#boardsView').isVisible(), false);
    await page.locator('#boardView').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pageTitle').textContent(), 'Unsaved title');
    assert.deepEqual(errors, []);
    console.log('PASS Kanban: create/open/back/forward without reloads, single data load, delayed saves, conflict/retry, creation failure, direct links');
  } finally { await context.close(); }

  // Old pin data may exist, but must have no visible behavior anywhere in Docs.
  const docsContext = await browser.newContext({ viewport, serviceWorkers: 'block' });
  try {
    await monitor(docsContext, 'docs', 'card');
    const data = fixture();
    let failDocs = true;
    await docsContext.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/docs') {
        await sleep(500);
        if (failDocs) return route.fulfill({ status: 503, json: { error: 'Test failure' } });
      }
      return route.fulfill({ json: pathname === '/api/me' ? { member: { name: 'Test User', theme: 'dark' } } : { success: true, data } });
    });
    const page = await docsContext.newPage();
    await page.goto(`${origin}/docs/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('status').filter({ hasText: 'Loading docs' }).waitFor();
    assert.equal(await page.getByText('No docs yet', { exact: true }).count(), 0);
    await page.getByRole('alert').filter({ hasText: 'Could not load docs' }).waitFor();
    failDocs = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.locator('.wd-doc-card').first().waitFor();
    assert.equal(await page.locator('.wd-doc-card .wd-file-title').first().textContent(), 'Newest doc');
    await page.locator('.wd-doc-card .wd-card-more').first().click();
    assert.equal(await page.getByRole('menuitem', { name: /pin/i }).count(), 0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Switch to list view', exact: true }).click();
    assert.equal(await page.locator('[title="Pin doc"],[title="Unpin doc"]').count(), 0);
    await page.getByText('Planning', { exact: true }).last().click();
    assert.equal(await page.getByText('Pinned', { exact: true }).count(), 0);
    console.log('PASS Docs: no pin controls/badges/priority, no false empty state, loading failure and retry');
  } finally { await docsContext.close(); }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
