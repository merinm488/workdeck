// Synthetic-only slow-network checks across every Workdeck app and editor shell.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pageFixture } from './holm-page-fixtures.mjs';
import { defaultWorkbook } from '../holm/sheets/api.js';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    let file = path.join(root, url.pathname === '/home' ? '/home.html' : url.pathname);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    file = pageFixture(root, file);
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.WORKDECK_UI_ORIGIN || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = { id: 'record00000000001', name: 'Planning', title: 'Planning', tagId: 'tag1', version: 1, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' };
const data = { settings: { theme: 'dark', viewMode: 'list' }, tags: [{ id: 'tag1', name: 'Team', color: '#3B82F6' }],
  docs: [{ ...record, content: 'A planning document', contentType: 'plain-text' }],
  sheets: [{ ...record, formatVersion: 2, rows: 20, cols: 5 }], forms: [{ ...record, components: [] }],
  slides: [{ ...record, width: 1280, height: 720, slides: [{ id: 'slide00000000001', background: '#ffffff', objects: [] }] }], draws: [{ ...record, objects: [] }],
  todo: [{ ...record, items: [] }], kanban: [{ ...record, columns: [], rows: [], cards: [], links: [] }],
  posts: [{ ...record, excerpt: 'Planning', html: '<p>Planning</p>' }],
  minutes: [{ ...record, date: '2026-07-01', state: 'draft', agenda: [], revision: 1 }],
  calendars: [], events: [], files: [], folders: [] };
const endpoints = { home: '/api/workdeck', docs: '/api/docs', sheets: '/api/users', forms: '/api/forms',
  slides: '/api/slides', draw: '/api/draw', todo: '/api/todo/lists', kanban: '/api/kanban',
  blog: '/api/blog', minutes: '/api/minutes', files: '/api/workdeck', calendar: '/api/calendar' };
async function setup() {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: Number(process.env.UI_WIDTH || 1440), height: 980 } });
  const requests = [], errors = [];
  await context.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('workdeck_theme', 'dark');
    window.framesSeen = [];
    function sample() {
      const home = document.querySelector('#listsView,#postsView,#home');
      if (home && getComputedStyle(home).display !== 'none' && getComputedStyle(home).visibility !== 'hidden') window.framesSeen.push(home.id);
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ path: url.pathname, query: url.search, method: request.method(), time: Date.now() });
    await sleep(url.pathname === '/api/me' ? 700 : 450);
    await route.fulfill({ json: url.pathname === '/api/users' && url.searchParams.has('sheet') ? { success: true, data: defaultWorkbook(record.id) }
      : url.pathname === '/api/me' ? { member: { name: 'Test User', theme: 'dark' } }
      : url.pathname === '/api/todo/lists' ? { lists: data.todo, settings: data.settings, tags: data.tags }
      : { success: true, data } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, requests, errors };
}
try {
  for (const [app, endpoint] of Object.entries(endpoints)) {
    const { context, page, requests, errors } = await setup();
    try {
      await page.goto(origin + (app === 'home' ? (process.env.WORKDECK_UI_ORIGIN ? '/home.html' : '/home') : `/${app}/`), { waitUntil: 'networkidle' });
      const reads = requests.filter(r => r.method === 'GET');
      assert.equal(reads.filter(r => r.path === endpoint).length, 1, `${app}: one initial data request`);
      if (!['home', 'files'].includes(app)) assert.equal(reads.filter(r => r.path === '/api/workdeck').length, 0, `${app}: no duplicate whole-workspace download`);
      const session = reads.find(r => r.path === '/api/me');
      if (session) assert.ok(Math.abs(session.time - reads.find(r => r.path === endpoint).time) < 250, `${app}: data starts alongside auth`);
      if (app === 'home') {
        await page.locator('#filesList .wd-file-row').first().waitFor();
        await page.locator('#viewToggle').click();
        for (const term of ['Plan', 'Not a match', '', 'Planning']) {
          await page.locator('#searchInput').fill(term);
          assert.equal(await page.locator('.wd-file-list-head').isVisible(), false, `card search '${term}': no table header`);
          assert.equal(await page.locator('#filesList').isVisible(), false);
        }
        await page.locator('#viewToggle').click();
        assert.equal(await page.locator('.wd-file-list-head').isVisible(), true);
        await page.locator('#searchInput').fill('Nothing matches');
        assert.equal(await page.locator('.wd-file-list-head').isVisible(), false);
        await page.locator('#searchInput').fill('Plan');
        assert.equal(await page.locator('.wd-file-list-head').isVisible(), true);
        await page.locator('#viewToggle').click();
        assert.equal(await page.locator('.wd-file-list-head').isVisible(), false);
      }
      assert.deepEqual(errors, [], `${app}: no page errors`);
      console.log(`PASS ${app}: single scoped load; auth/data overlap; no page errors`);
    } finally { await context.close(); }
  }
  for (const [app, param, detail] of [['todo', 'list', '#listView'], ['blog', 'post', '#editorView'], ['minutes', 'meeting', '#editor'], ['docs', 'doc', '[title="Back to docs"]']]) {
    const { context, page, errors } = await setup();
    try {
      await page.goto(`${origin}/${app}/?${param}=${record.id}`, { waitUntil: 'networkidle' });
      if (app !== 'docs') {
        assert.equal(await page.locator(detail).isVisible(), true);
        assert.deepEqual(await page.evaluate(() => window.framesSeen), [], `${app}: no home frame on a direct detail link`);
      } else {
        assert.equal(await page.getByText('Sign in with Holm', { exact: true }).count(), 0);
        assert.equal(await page.locator('h1').filter({ hasText: 'Planning' }).count() > 0, true);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${app}: slow direct-link load never flashes home/sign-in`);
    } finally { await context.close(); }
  }
  // Also load the real libraries, not just blocked-vendor shells. Verify the
  // ordered deferred scripts still initialize each editor successfully.
  for (const app of ['sheets', 'forms', 'slides', 'draw']) {
    const { context, page, requests, errors } = await setup();
    try {
      await page.goto(`${origin}/${app}/editor.html?id=${record.id}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.locator('#loadingOverlay').waitFor({ state: 'hidden', timeout: 30000 });
      assert.equal(new URL(page.url()).pathname, `/${app}/editor.html`);
      assert.ok(await page.locator(app === 'forms' ? '.fjs-form-editor' : 'canvas').count() > 0, `${app}: actual editor mounted`);
      assert.deepEqual(errors, [], `${app}: real vendor initialization`);
      assert.equal(requests.filter(r => r.method === 'GET' && r.path === endpoints[app] && !r.query).length, 1, `${app}: metadata is not re-fetched just for settings`);
      console.log(`PASS ${app} editor: real libraries initialize, one metadata load, no page errors`);
    } finally { await context.close(); }
  }
  // Even with a blocked heavyweight vendor, authenticated metadata starts in
  // the head, and the destination shell can paint. Do not need real user data.
  for (const app of ['sheets', 'forms', 'slides', 'draw']) {
    const { context, page, requests } = await setup();
    try {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      await context.route(/https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)\/.*\.js(?:\?.*)?$/, async route => { await held; await route.abort(); });
      const navigation = page.goto(`${origin}/${app}/editor.html?id=${record.id}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      try {
        await page.waitForFunction(() => !!document.body?.querySelector('nav,.top-nav,.top-bar,.app-container'), { timeout: 10000 });
        assert.ok(requests.some(r => r.path === endpoints[app]), `${app}: fetch starts without waiting for vendor`);
        assert.ok(requests.some(r => r.path === '/api/me'));
        if (app === 'sheets') assert.ok(requests.some(r => r.query.includes('sheet=')), 'sheet body is not another waterfall');
      } finally { release(); await navigation; }
      console.log(`PASS ${app} editor: shell and data do not wait on blocking vendors`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
