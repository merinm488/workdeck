// Geometry regression for every file-home list, using Docs as the reference.
// Uses a built Holm package and synthetic data only; no production API/account.
// WORKDECK_UI_BUILD=/tmp/workdeck-holm-release PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROME=/path/to/chrome node test/list-layout.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    let file = path.join(root, pathname === '/home' ? 'home.html' : pathname);
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const apps = ['docs', 'home', 'sheets', 'forms', 'slides', 'draw', 'todo', 'kanban', 'blog', 'minutes', 'files'];
function fixture(theme) {
  const records = app => ['Planning notes', 'A very long project title '.repeat(8), 'Untagged notes'].map((title, i) => ({
    id: `${app}_record00000${i}`, title, name: title, tagId: i === 2 ? null : `tag${i + 1}`,
    createdAt: '2026-07-01T12:00:00Z', updatedAt: '2026-07-01T12:00:00Z',
  }));
  return {
    settings: { theme }, tags: [{ id: 'tag1', name: 'Planning', color: '#3B82F6' }, { id: 'tag2', name: 'A long tag name that must never make the table rows taller', color: '#0D9488' }],
    docs: records('docs').map(record => ({ ...record, content: 'Test preview', contentType: 'plain-text' })),
    sheets: records('sheets').map(record => ({ ...record, rows: 20, cols: 5 })),
    forms: records('forms').map(record => ({ ...record, components: [] })),
    slides: records('slides').map(record => ({ ...record, slides: [] })),
    draws: records('draws').map(record => ({ ...record, canvas: { objects: [] } })),
    todo: records('todo').map(record => ({ ...record, items: [] })),
    kanban: records('kanban').map(record => ({ ...record, columns: [], cards: [] })),
    posts: records('posts').map(record => ({ ...record, excerpt: 'Test preview', public: true })),
    minutes: records('minutes').map(record => ({ ...record, date: '2026-07-01', state: 'draft', agenda: [] })),
    files: records('files').map(record => ({ ...record, name: record.name + '.txt', mimeType: 'text/plain', size: 28, tags: record.tagId ? [record.tagId] : [] })),
    folders: [{ id: 'folder0000000001', name: 'Planning folder', tags: ['tag1'], parentId: null, updatedAt: '2026-07-01T12:00:00Z' }],
    calendars: [{ id: 'calendar00000001', name: 'Work', color: '#0284C7' }], events: [],
  };
}
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1, `${label}: expected ${expected}, got ${actual}`);
async function measure(page, app) {
  return page.evaluate(app => {
    const header = document.querySelector('.docs-list-grid, .wd-file-list-head, .wd-app-table-head, .fb-list-head');
    const table = app === 'docs' ? header.parentElement : header;
    const rows = [...document.querySelectorAll('.docs-list-grid + .docs-list-grid, #filesList > .wd-file-row, .wd-app-items.as-list > [data-id], #fbList > .fb-row')];
    const bounds = table.getBoundingClientRect();
    return {
      width: bounds.width, left: bounds.left,
      headerHeight: header.getBoundingClientRect().height + (app === 'docs' ? 1 : 0),
      overflow: document.documentElement.scrollWidth > innerWidth,
      rows: rows.map(row => {
        const rect = row.getBoundingClientRect();
        return { height: rect.height, width: rect.width, left: rect.left,
          overflowingCells: [...row.children].filter(cell => {
            const box = cell.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1);
          }).map(cell => cell.className),
        };
      }),
    };
  }, app);
}
try {
  for (const theme of ['light', 'dark']) {
    const reference = new Map();
    for (const app of apps) {
      const data = fixture(theme);
      const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, serviceWorkers: 'block' });
      await context.addInitScript(theme => localStorage.setItem('workdeck_theme', theme), theme);
      await context.route('**/api/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        return route.fulfill({ json: pathname === '/api/me' ? { member: { name: 'Test User', theme } }
          : pathname === '/api/todo/lists' ? { lists: data.todo, tags: data.tags, settings: data.settings } : { success: true, data } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(`${origin}/${app === 'home' ? 'home' : app + '/'}`, { waitUntil: 'networkidle' });
        const cards = page.locator('#filesGrid .wd-file-card:visible, .wd-home-grid:not(.as-list) > .wd-home-card:visible, .wd-doc-card:visible, #fbGrid .fb-card:visible');
        await cards.first().waitFor();
        const cardWidth = (await cards.first().boundingBox()).width;
        await page.getByRole('button', { name: 'Switch to list view', exact: true }).first().click();
        for (const width of [1440, 1920, 1024, 710, 700, 640, 639, 390]) {
          await page.setViewportSize({ width, height: 980 });
          await page.waitForTimeout(350); // includes the existing sidebar/content transitions
          for (const expanded of width >= 1024 ? [true, false] : [false]) {
            const toggle = page.locator(app === 'docs' ? 'header button[aria-controls="docsSidebar"]:visible'
              : app === 'home' ? '#sidebarToggle' : app === 'files' ? '#fbSidebarToggle' : '.wd-app-side-toggle');
            if (await toggle.getAttribute('aria-expanded') !== String(expanded)) {
              if (app === 'docs' && width < 1024) await page.locator('aside button[aria-label="Close sidebar"]').click();
              else await toggle.click();
              await page.waitForTimeout(350);
            }
            const metrics = await measure(page, app);
            const key = `${width}:${expanded}`, label = `${theme} ${app} ${key}`;
            assert.ok(metrics.rows.length >= 3, `${label}: multi-row fixture loaded`);
            if (app === 'docs') {
              near(metrics.width, Math.min(1024, width - (expanded ? 280 : 0) - (width <= 700 ? 32 : 48)), `${label}: Docs reference width`);
              metrics.rows.forEach(row => near(row.height, width < 640 ? 53 : 51, `${label}: Docs reference row height`));
              reference.set(key, metrics);
            }
            const expected = reference.get(key);
            near(metrics.width, expected.width, `${label}: table width matches Docs`);
            near(metrics.left, expected.left, `${label}: table alignment matches Docs`);
            near(metrics.headerHeight, expected.headerHeight, `${label}: header height matches Docs`);
            metrics.rows.forEach((row, i) => {
              near(row.height, expected.rows[0].height, `${label}: row ${i} height matches Docs`);
              near(row.width, expected.rows[0].width, `${label}: row ${i} width matches Docs`);
              near(row.left, expected.rows[0].left, `${label}: row ${i} alignment matches Docs`);
              assert.deepEqual(row.overflowingCells, [], `${label}: row ${i} content stays inside row`);
            });
            assert.equal(metrics.overflow, false, `${label}: no horizontal overflow`);
          }
        }
        // The shared row size must not clip or disable the action entry points.
        const more = page.locator('.docs-list-grid [aria-label="More options"], #filesList .wd-file-list-more, .wd-app-items.as-list .wd-app-list-more, #fbList .fb-item-menu').last();
        await more.click();
        const menu = page.getByRole('menu', { name: 'File actions', exact: true });
        await menu.waitFor();
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
        assert.equal(await more.evaluate(el => el === document.activeElement), true);
        // Returning to cards must retain the original grid dimensions.
        await page.setViewportSize({ width: 1440, height: 980 });
        await page.waitForTimeout(350);
        const open = page.getByRole('button', { name: 'Open sidebar', exact: true });
        if (await open.count()) await open.first().click();
        await page.waitForTimeout(350);
        await page.getByRole('button', { name: 'Switch to card view', exact: true }).first().click();
        await cards.first().waitFor();
        near((await cards.first().boundingBox()).width, cardWidth, `${app}: card width unchanged`);
        assert.deepEqual(errors, [], `${app}: browser errors`);
        console.log(`PASS ${theme} ${app}: Docs table width/row height, headers, long titles/tags, sidebar states, responsive layout, actions, card switch`);
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); server.close(); }
