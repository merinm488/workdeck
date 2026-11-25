// Upgrade regression using a REAL installed v2 worker, stale query-string
// shells, production-like CSP and synthetic workbook data. No real account.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const legacyWorker = await readFile(new URL('./fixtures/sheets-worker-v2.js', import.meta.url), 'utf8');
const editor = await readFile(path.join(root, 'sheets/editor.html'), 'utf8');
const staleEditor = editor.replace(/<script\b[^>]*src="\/js\/autosave\.js"[^>]*><\/script>/, '')
  .replace('<body', '<body data-legacy-shell="true"')
  .replace('</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"></head>');
assert.ok(!staleEditor.includes('src="/js/autosave.js"'));
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net https://unpkg.com; img-src 'self' data: blob: https:; object-src 'none'";
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
let serveLegacyWorker = true;
const id = 'synthetic-sheet-book';
let workbook = { id, name: 'Worker upgrade test', appVersion: '0.10.0', locale: 'enUS', sheetOrder: ['sheet1'], sheets: { sheet1: { id: 'sheet1', name: 'Sheet1', rowCount: 100, columnCount: 20, cellData: {} } }, styles: {} };
let version = 1, writes = 0;
const apiData = () => ({ settings: { theme: 'dark' }, tags: [], sheets: [{ id, name: workbook.name, data: workbook, formatVersion: 2, version, updatedAt: new Date().toISOString() }] });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Content-Security-Policy', csp);
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/me') return res.end(JSON.stringify({ member: { id: 'synthetic-member', name: 'Test User', theme: 'dark' } }));
      if (req.method === 'PUT') {
        let text = ''; for await (const chunk of req) text += chunk;
        const body = JSON.parse(text);
        if (body.action === 'updateSheet') {
          assert.equal(body.data.sheetId, id); assert.equal(body.data.version, version);
          workbook = body.data.sheetData.data; version++; writes++;
        }
        assert.notEqual(body.action, 'createSheet', 'cache recovery must never create a replacement workbook');
      }
      return res.end(JSON.stringify({ success: true, data: url.searchParams.has('sheet') ? workbook : apiData() }));
    }
    if (url.pathname === '/sheets/worker-test.html') {
      res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>Worker upgrade harness</title><body>Install old worker</body>');
    }
    if (url.pathname === '/sheets/service-worker.js' && serveLegacyWorker) {
      res.setHeader('Content-Type', 'text/javascript'); return res.end(legacyWorker);
    }
    const alias = ['/sheets/editor', '/sheets/' + id].includes(url.pathname) ? '/sheets/editor.html' : url.pathname;
    let file = path.join(root, alias);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
try {
  // Each URL form previously entered v2's cache-first branch.
  for (const editorPath of [`/sheets/editor?id=${id}`, `/sheets/editor.html?id=${id}`, `/sheets/${id}`]) {
    serveLegacyWorker = true;
    const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1440, height: 980 } });
    await context.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => cspViolations.push([event.violatedDirective, event.blockedURI]));
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin + '/sheets/worker-test.html');
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('/sheets/service-worker.js', { scope: '/sheets/' });
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      });
      await page.evaluate(async ({ editorPath, staleEditor }) => {
        const cache = await caches.open('sheets-dynamic-holm-v2');
        await cache.put(editorPath, new Response(staleEditor, { headers: { 'Content-Type': 'text/html' } }));
        const unrelated = await caches.open('workdeck-docs-hashed-v1');
        await unrelated.put('/docs/keep-test', new Response('untouched'));
      }, { editorPath, staleEditor });
      serveLegacyWorker = false;
      const oldResponse = await page.goto(origin + editorPath, { waitUntil: 'commit' });
      assert.equal(oldResponse.fromServiceWorker(), true, 'the actual old worker serves the obsolete shell');
      assert.match(await oldResponse.text(), /data-legacy-shell="true"/);
      await page.waitForFunction(() => window.sheetsApp?.isInitialized && window.WDAutosave);
      assert.equal(await page.locator('body[data-legacy-shell]').count(), 0, 'the old shell was replaced before editing');
      assert.equal(await page.locator('link[href*="fonts.googleapis.com"]').count(), 0);
      assert.equal(await page.locator('#saveBtn').count(), 0);
      assert.equal(new URL(page.url()).searchParams.get('id'), id);
      assert.equal(new URL(page.url()).searchParams.has('wd-shell'), false, 'canonical link restored');
      await page.waitForFunction(async () => !(await caches.keys()).some(name => /^sheets-.*-v2$/.test(name)));
      assert.equal(await page.evaluate(async () => (await caches.open('workdeck-docs-hashed-v1')).match('/docs/keep-test').then(Boolean)), true);
      assert.deepEqual(await page.evaluate(() => cspViolations), [], 'fresh shell obeys CSP without relaxing connect-src');
      assert.ok(!errors.some(message => /WDAutosave|Failed to convert value to 'Response'/.test(message)), errors.join('\n'));

      const before = writes;
      await page.evaluate(() => spreadsheetManager.getCurrentSheetData().getRange('A1').setValue('Saved after worker upgrade'));
      await page.locator('#saveState[data-save-status=saved]').waitFor();
      assert.ok(writes > before, 'real editor autosaved through the new worker');
      const freshResponse = await page.reload();
      assert.equal(freshResponse.fromServiceWorker(), false, 'navigations are no longer cached/intercepted');
      await page.waitForFunction(() => window.sheetsApp?.isInitialized);
      assert.equal(await page.evaluate(() => spreadsheetManager.getCurrentSheetData().getRange('A1').getValue()), 'Saved after worker upgrade');
      const cached = await page.evaluate(async () => {
        const keys = await caches.keys();
        return (await Promise.all(keys.filter(key => key.startsWith('sheets-')).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat();
      });
      assert.ok(cached.every(url => /\.(?:png|svg|webp|ico|woff2?)(?:\?|$)/.test(url)), JSON.stringify(cached));
      assert.deepEqual(await page.evaluate(() => cspViolations), []);
      console.log('PASS installed-worker upgrade, CSP, autosave and reload:', editorPath);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
