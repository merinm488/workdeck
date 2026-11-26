// Cards sidebar regression against a built package; synthetic data only.
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
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(theme => localStorage.setItem('workdeck_theme', theme), theme);
    const board = { id: 'sidebarboard001', name: 'Cards sidebar test', columns: [{ id: 'column001', label: 'To do' }], rows: [], cards: [], links: [], version: 1 };
    const data = { kanban: [board], todo: [{ id: 'list001', name: 'Backlog', items: [{ id: 'task001', title: 'Staged task', completed: false }] }], tags: [], settings: { theme, kanbanCards: ['task001'] } };
    const actions = [];
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), body = route.request().postDataJSON();
      if (body?.action) actions.push(body.action);
      return route.fulfill({ json: url.pathname === '/api/me' ? { member: { id: 'test-member', theme } } : { success: true, data } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const toggle = page.locator('#kbSidebarToggle'), sidebar = page.locator('#kbSidebar');
    const url = origin + '/kanban/?board=' + board.id;
    async function checkState(open, mobile) {
      await page.waitForFunction(open => document.getElementById('kbSidebarToggle')?.getAttribute('aria-expanded') === String(open), open);
      assert.equal(await toggle.getAttribute('aria-controls'), 'kbSidebar');
      const label = open ? 'Close cards sidebar' : 'Open cards sidebar';
      assert.equal(await toggle.getAttribute('aria-label'), label);
      assert.equal(await toggle.getAttribute('title'), label);
      assert.equal(await toggle.locator('path').getAttribute('d'), open ? 'm11 6-6 6 6 6m8-12-6 6 6 6' : 'm5 6 6 6-6 6m8-12 6 6-6 6');
      assert.equal(await page.locator('#kbSidebarClose').count(), 0, 'no redundant cross button');
      assert.equal(await toggle.count(), 1, 'only one open/close control');
      assert.equal(await sidebar.evaluate(el => el.inert), !open);
      assert.equal(await toggle.evaluate(el => el.parentElement.classList.contains('kb-sidebar-actions')), mobile && open, 'mobile close control stays above the scrim');
      assert.equal(await page.locator('#kbSidebarScrim').evaluate(el => el.classList.contains('show')), mobile && open);
      assert.equal(await page.locator('#boardView').isVisible(), true);
    }
    try {
      await page.goto(url); await page.locator('#boardView').waitFor();
      await checkState(true, false);
      await toggle.click(); await checkState(false, false);
      assert.equal(await page.evaluate(() => localStorage.getItem('kanban_sidebar')), 'off');
      await page.reload(); await page.locator('#boardView').waitFor();
      await checkState(false, false);
      await toggle.focus(); await page.keyboard.press('Enter'); await checkState(true, false);
      for (const width of [701, 700, 390, 320]) {
        const mobile = width <= 700;
        await page.setViewportSize({ width, height: 900 });
        if (mobile) {
          await page.reload(); await page.locator('#boardView').waitFor();
          await checkState(false, true); // Phones never start with a drawer over the board.
          await toggle.click(); await checkState(true, true);
        } else await checkState(true, false);
        await toggle.click(); await checkState(false, mobile);
        assert.equal(await toggle.evaluate(el => document.activeElement === el), true, 'closing restores focus to the same toggle');
        await toggle.focus(); await page.keyboard.press('Enter'); await checkState(true, mobile);
        if (mobile) {
          await sidebar.locator('#kbTodoPickBtn').focus();
          await page.keyboard.press('Escape'); await checkState(false, true);
          assert.equal(await toggle.evaluate(el => document.activeElement === el), true, 'Escape restores focus');
          await toggle.click(); await checkState(true, true);
          await page.locator('#kbSidebarScrim').click({ position: { x: width - 5, y: 500 } });
          await checkState(false, true);
          await toggle.click(); await checkState(true, true);
        }
      }
      // Resize an open drawer without leaving behind an overlay or stale icon.
      await page.setViewportSize({ width: 1280, height: 900 }); await checkState(true, false);
      await page.setViewportSize({ width: 390, height: 900 }); await checkState(false, true);
      await toggle.click(); await checkState(true, true);
      await page.locator('#kbTodoPickBtn').click();
      await page.locator('#todoPickerModal.open').waitFor();
      await checkState(false, true);
      await page.locator('#todoPickerClose').click();
      await page.locator('#homeBtn').click(); await page.locator('#boardsView').waitFor();
      await page.goBack(); await page.locator('#boardView').waitFor();
      await checkState(false, true);
      assert.deepEqual(actions.filter(action => action !== 'recordOpen'), [], 'sidebar controls never mutate board or tasks');
      assert.deepEqual(errors, []);
      console.log(`PASS Kanban Cards sidebar ${theme}: no cross, double chevrons, desktop preference, mobile toggle/Escape/scrim, resize, Todo picker and navigation`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
