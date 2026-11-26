// Packaged app homes, real UI, synthetic local data only.
// PLAYWRIGHT_PATH=/tmp/workdeck-ui-browser/node_modules/playwright/index.mjs CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/search-suggestions.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pageFixture } from './holm-page-fixtures.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const output = '/tmp/workdeck-search-suggestions';
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
const apps = (process.env.SEARCH_APPS || 'docs,sheets,forms,slides,draw,todo,kanban,blog,minutes,files,calendar').split(',');
const keyFor = app => ({ draw: 'draws', blog: 'posts', calendar: 'events' })[app] || app;
function fixture(app, theme, empty = false) {
  const names = empty ? [] : ['Planning notes', 'Planning review', '<Planning> & review', 'A'.repeat(180) + ' plan'];
  const records = names.map((name, index) => ({
    id: `record0000000000${index + 1}`, name, title: name, tagId: index === 1 ? 'tag2' : 'tag1', tags: [index === 1 ? 'tag2' : 'tag1'],
    updatedAt: new Date(Date.now() - index * 3600000).toISOString(), createdAt: '2026-01-01T00:00:00Z', version: 1, revision: 1,
    content: 'Test content', contentType: 'plain-text', components: [], objects: [], slides: [], items: [], columns: [], cards: [],
    date: new Date().toISOString().slice(0, 10), state: index === 1 ? 'final' : 'draft', agenda: [],
    mimeType: 'text/plain', size: 24, calId: 'calendar00000001', allDay: false,
    start: new Date(Date.now() + (index + 1) * 86400000).toISOString(), end: new Date(Date.now() + (index + 1) * 86400000 + 3600000).toISOString(),
    exdates: [], reminders: [], links: [],
  }));
  const data = { settings: { theme, calendarThumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=' }, tags: [{ id: 'tag1', name: 'Project alpha', color: '#3B82F6' }, { id: 'tag2', name: 'Project beta', color: '#EF4444' }], calendars: [{ id: 'calendar00000001', name: 'Work', color: '#0284c7', visible: true }], folders: [] };
  for (const key of ['docs', 'sheets', 'forms', 'slides', 'draws', 'todo', 'kanban', 'posts', 'minutes', 'files', 'events']) {
    data[key] = key === keyFor(app) ? records : [{ ...records[0], id: 'elsewhere0000001', name: 'Elsewhere private', title: 'Elsewhere private', items: [], columns: [], cards: [], start: new Date().toISOString(), end: new Date().toISOString() }];
  }
  if (app === 'files' && !empty) {
    data.folders = [{ id: 'folder0000000001', name: 'Planning folder', tags: ['tag1'], parentId: null, updatedAt: '2026-01-01T00:00:00Z' }];
    data.files.push({ ...records[0], id: 'nested000000001', name: 'Nested budget', folderId: data.folders[0].id });
  }
  return data;
}
async function setup(app, theme, { empty = false, delayed = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(value => localStorage.setItem('workdeck_theme', value), theme);
  const data = fixture(app, theme, empty), calls = [], errors = [];
  let release;
  const pending = delayed ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    calls.push({ method: request.method(), url: url.pathname });
    if (url.pathname === '/api/me') return route.fulfill({ json: { member: { name: 'Search Test', theme } } });
    await pending;
    return route.fulfill({ json: url.pathname === '/api/todo/lists' ? { lists: data.todo, tags: data.tags, settings: data.settings } : { success: true, data } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, calls, errors, data, release };
}
const waitSuffix = async (page, suffix) => {
  await page.waitForFunction(expected => {
    const ghost = document.querySelector('.wd-search-completion');
    return ghost && !ghost.hidden && ghost.querySelector('.wd-search-completion-rest').textContent === expected;
  }, suffix);
};
try {
  // Preserve the existing Workdeck reference, rather than replacing its search.
  for (const theme of ['dark', 'light']) {
    const { context, page, errors } = await setup('docs', theme);
    try {
      await page.goto(`${origin}/home`, { waitUntil: 'networkidle' });
      const input = page.locator('#searchInput'); await input.fill('Pla');
      await page.waitForFunction(() => document.querySelector('#searchGhostRest').textContent === 'nning notes');
      assert.equal(await input.inputValue(), 'Pla');
      await input.press('Tab'); assert.equal(await input.inputValue(), 'Planning notes');
      assert.deepEqual(errors, []); console.log(`PASS ${theme} Workdeck Home reference`);
    } finally { await context.close(); }
  }
  for (const theme of ['dark', 'light']) for (const app of apps) {
    const { context, page, calls, errors } = await setup(app, theme);
    try {
      await page.goto(`${origin}/${app}/`, { waitUntil: 'networkidle' });
      const input = page.locator('.wd-home-search input'), ghost = page.locator('.wd-search-completion');
      await input.waitFor();
      assert.equal(await input.getAttribute('aria-autocomplete'), 'inline');
      const initialCalls = calls.length;
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(350);
        await input.fill('plAn'); await waitSuffix(page, 'ning notes');
        assert.equal(await input.inputValue(), 'plAn', 'Suggestion never replaces unaccepted input');
        assert.equal(await input.evaluate(el => getComputedStyle(el).color), theme === 'dark' ? 'rgb(245, 245, 245)' : 'rgb(26, 26, 26)', 'Typed text/caret stay native and readable');
        assert.equal(await ghost.locator('.wd-search-completion-rest').evaluate(el => getComputedStyle(el).color), theme === 'dark' ? 'rgb(115, 115, 115)' : 'rgb(161, 161, 170)', 'Same muted suffix as Workdeck Home');
        const bounds = await ghost.boundingBox(), field = await input.boundingBox();
        assert.ok(bounds.x >= field.x && bounds.x + bounds.width <= field.x + field.width, 'Ghost cannot overlap icons or overflow the input');
        await page.screenshot({ path: `${output}/${app}-${theme}-${width}.png` });
        const url = page.url();
        await input.press('Tab');
        assert.equal(await input.inputValue(), 'Planning notes');
        assert.equal(await input.evaluate(el => document.activeElement === el), true, 'Accepting keeps input focus');
        assert.equal(page.url(), url, 'Completing never opens a file');
        assert.equal(await ghost.isVisible(), false, 'Exact title is complete');
        await input.press('Tab');
        assert.equal(await input.evaluate(el => document.activeElement === el), false, 'A second Tab navigates normally');
        await input.fill('Pla'); await waitSuffix(page, 'nning notes');
        await input.press('Shift+Tab'); assert.equal(await input.inputValue(), 'Pla');
        assert.equal(await ghost.isVisible(), false, 'Blur hides completion');
        await input.fill('not a matching file'); await page.waitForTimeout(280);
        assert.equal(await ghost.isVisible(), false);
        await input.press('Tab'); assert.equal(await input.inputValue(), 'not a matching file');
        await input.fill('Elsewhere'); await page.waitForTimeout(280);
        assert.equal(await ghost.isVisible(), false, 'Never suggest another app’s files');
        await input.fill('   '); assert.equal(await ghost.isVisible(), false);
        await input.fill('<Plan'); await waitSuffix(page, 'ning> & review');
        assert.equal(await ghost.locator('img,script,b').count(), 0, 'Filenames are text, not markup');
        await input.fill('A'.repeat(100)); await waitSuffix(page, 'A'.repeat(80) + ' plan');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Long completions do not widen the page');
        await input.press('Escape'); assert.equal(await input.inputValue(), ''); assert.equal(await ghost.isVisible(), false);
        await input.fill('Pla'); await waitSuffix(page, 'nning notes');
        await page.getByRole('button', { name: 'Clear search', exact: true }).click();
        assert.equal(await input.inputValue(), ''); assert.equal(await ghost.isVisible(), false);
      }
      // Editing an earlier character or a selected range must not autocomplete.
      await input.fill('Pla'); await waitSuffix(page, 'nning notes');
      await input.evaluate(el => { el.setSelectionRange(1, 1); el.dispatchEvent(new Event('select')); });
      assert.equal(await ghost.isVisible(), false);
      await input.press('Tab'); assert.equal(await input.inputValue(), 'Pla');
      await input.fill('Pla'); await input.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      assert.equal(await ghost.isVisible(), false);
      const unhandled = await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', isComposing: true, bubbles: true, cancelable: true })));
      assert.equal(unhandled, true); assert.equal(await input.inputValue(), 'Pla');
      await input.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await waitSuffix(page, 'nning notes'); await input.press('Escape');
      assert.equal(calls.length, initialCalls, 'Typing/completing causes no API calls or writes');

      // Existing scopes and display order drive candidates, including list view.
      await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(350);
      const listToggle = page.getByRole('button', { name: 'Switch to list view', exact: true }).first();
      if (await listToggle.isVisible()) { await listToggle.click(); await input.fill('Pla'); await waitSuffix(page, 'nning notes'); await input.press('Escape'); }
      if (!['calendar', 'docs'].includes(app)) {
        const openSidebar = page.getByRole('button', { name: 'Open sidebar', exact: true }).first();
        if (await openSidebar.isVisible()) await openSidebar.click();
        await page.getByRole('button', { name: 'Project beta', exact: true }).click();
        await input.fill('Pla'); await waitSuffix(page, 'nning review'); await input.press('Tab');
        assert.equal(await input.inputValue(), 'Planning review', 'No suggestion from excluded tags');
        await input.press('Escape');
      }
      if (app === 'minutes') {
        await page.getByRole('button', { name: 'All items', exact: true }).click();
        await page.getByLabel('Filter meetings', { exact: true }).selectOption('final');
        await input.fill('Pla'); await waitSuffix(page, 'nning review');
      }
      if (app === 'files') {
        await page.getByRole('button', { name: 'All folders', exact: true }).first().click();
        await input.fill('Planning f'); await waitSuffix(page, 'older');
        await input.fill('Nested'); await waitSuffix(page, ' budget');
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${theme} ${app}: desktop/mobile ghost, Tab, Shift+Tab, Escape, clear, IME, caret, scopes, long/safe titles, no extra requests`);
    } catch (error) {
      await page.screenshot({ path: `${output}/FAIL-${app}-${theme}.png` });
      console.error({ app, theme, errors, calls }); throw error;
    } finally { await context.close(); }
  }
  for (const app of ['forms', 'calendar']) for (const empty of [false, true]) {
    const { context, page, release, errors } = await setup(app, 'dark', { empty, delayed: true });
    try {
      await page.goto(`${origin}/${app}/`, { waitUntil: 'domcontentloaded' });
      const input = page.locator('.wd-home-search input'); await input.fill('Pla');
      assert.equal(await page.locator('.wd-search-completion').isVisible(), false);
      release(); await page.waitForLoadState('networkidle');
      if (empty) { assert.equal(await page.locator('.wd-search-completion').isVisible(), false); await input.press('Tab'); assert.equal(await input.inputValue(), 'Pla'); }
      else await waitSuffix(page, 'nning notes');
      assert.deepEqual(errors, []); console.log(`PASS ${app} delayed data, empty=${empty}`);
    } finally { release(); await context.close(); }
  }
} finally { await browser.close(); server.close(); }
