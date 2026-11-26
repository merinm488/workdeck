// Browser regression checks against a BUILT Holm package with synthetic data.
// No production API or account is used. Install Playwright outside the repo or
// provide PLAYWRIGHT_PATH; set CHROME to use an existing Chrome executable.
// WORKDECK_UI_BUILD=/tmp/workdeck-ui-consistency PLAYWRIGHT_PATH=/path/to/playwright/index.mjs CHROME=/path/to/chrome node test/home-ui.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pageFixture } from './holm-page-fixtures.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-ui-consistency', 'web');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    let file = path.join(root, pathname === '/home' ? 'home.html' : pathname);
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    file = pageFixture(root, file);
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const shared = { id: 'record00000000001', name: 'Planning notes', title: 'Planning notes', tagId: 'tag1', updatedAt: '2026-07-01T12:00:00Z', createdAt: '2026-07-01T12:00:00Z', version: 1 };
const apps = ['home', 'docs', 'sheets', 'forms', 'slides', 'draw', 'todo', 'kanban', 'blog', 'minutes', 'files'];
async function checkHomeRibbons(page, app) {
  assert.equal(await page.locator('.home-toolbar, .lists-toolbar, .home-view-indicator').count(), 0, `${app}: no redundant home ribbon or empty wrapper`);
  if (app === 'docs') assert.equal(await page.locator('main > div > h2').count(), 0, 'Docs: no view/tag title ribbon');
  if (app === 'home') return; // Workdeck dashboard is not an app home.
  const headers = page.locator(app === 'calendar' ? '.top-nav' : '.wd-home-header, header:has(> .wd-home-header)');
  assert.ok(await headers.count(), `${app}: app home header exists`);
  for (const header of await headers.all()) {
    const style = await header.evaluate(el => {
      const css = getComputedStyle(el);
      return { border: css.borderBottomWidth, shadow: css.boxShadow };
    });
    assert.equal(style.border, '0px', `${app}: no horizontal divider below home header`);
    assert.equal(style.shadow, 'none', `${app}: no header shadow acting as a divider`);
  }
}
function checkMenuLabels(labels, app) {
  assert.ok(!labels.some(label => /(?:change|add) tags?/i.test(label)), `${app}: no old tag action label`);
  if (app !== 'home' || labels.some(label => /^Delete/.test(label))) {
    assert.ok(labels.includes('Edit tags'), `${app}: exact Edit tags label`);
  }
  if (app === 'files') assert.ok(!labels.some(label => /^(Edit tags|Move to folder)[.…]/i.test(label)), 'Files: no trailing ellipses');
}
async function checkFilesLayout(page) {
  assert.equal(await page.locator('#fbSidebarClose').count(), 0, 'Files: sidebar X removed from markup');
  await page.locator('#fbGrid [data-id="folder0000000001"]').click();
  await page.locator('#fbGrid [data-id="folder0000000002"]').click();
  const breadcrumb = page.locator('#fbBreadcrumb');
  assert.deepEqual(await breadcrumb.locator('button').allTextContents(), ['All folders', 'Planning folder', 'Nested folder']);
  const toggle = page.locator('#fbSidebarToggle');
  for (const width of [1440, 1920, 1024, 1023, 710, 390]) {
    await page.setViewportSize({ width, height: 980 });
    for (const expanded of width >= 1024 ? ['true', 'false'] : ['false']) {
      if (await toggle.getAttribute('aria-expanded') !== expanded) await toggle.click();
      for (const view of ['cards', 'list']) {
        if (view === 'list') await page.locator('#fbViewToggle').click();
        const results = page.locator(view === 'cards' ? '#fbGrid' : '#fbList');
        await results.locator('[data-id="nestedfile000001"]').waitFor();
        const bounds = await results.boundingBox();
        const crumb = await breadcrumb.evaluate(el => {
          const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
          const range = document.createRange(); range.selectNodeContents(el.firstElementChild);
          return { left: rect.left + parseFloat(css.paddingLeft), right: rect.right - parseFloat(css.paddingRight), textLeft: range.getBoundingClientRect().left };
        });
        const state = `${width}px sidebar=${expanded} ${view}`;
        assert.ok(Math.abs(crumb.left - bounds.x) <= 1, `Files: breadcrumb left aligned (${state})`);
        assert.ok(Math.abs(crumb.right - bounds.x - bounds.width) <= 1, `Files: breadcrumb right aligned (${state})`);
        assert.ok(Math.abs(crumb.textLeft - bounds.x) <= 1, `Files: breadcrumb text aligned (${state})`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Files: no overflow (${state})`);
        if (view === 'list') await page.locator('#fbViewToggle').click();
      }
    }
    if (width < 1024) {
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Files: Escape closes mobile drawer');
      assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
      await toggle.click();
      await page.locator('#fbSidebarScrim').click({ position: { x: width - 10, y: 300 } });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Files: scrim closes mobile drawer');
    }
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  // Renamed labels retain the same dialogs and cancelling changes no data.
  const more = page.locator('#fbGrid .fb-item-menu');
  const menu = page.getByRole('menu', { name: 'File actions', exact: true });
  for (const [label, modal] of [['Edit tags', '.wd-tag-picker[open]'], ['Move to folder', '#fbMoveModal.active']]) {
    await more.click();
    await menu.getByRole('menuitem', { name: label, exact: true }).click();
    await page.locator(modal).waitFor();
    await page.locator(modal).getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator(modal).waitFor({ state: 'hidden' });
  }
  await breadcrumb.getByRole('button', { name: 'All folders', exact: true }).click();
}
async function checkCardMenus(page, app, { mobile = false, dispatch = false } = {}) {
  const cards = page.locator('#filesGrid .wd-file-card:visible, .wd-home-grid:not(.as-list) > .wd-home-card:visible, .wd-doc-card:visible, #fbGrid .fb-card:visible');
  assert.ok(await cards.count(), `${app}: cards exist`);
  const menu = page.getByRole('menu', { name: 'File actions', exact: true });
  const pageURL = page.url();
  for (let i = 0; i < await cards.count(); i++) {
    const card = cards.nth(i), trigger = card.locator('.wd-card-more');
    if (app === 'home' && await card.getAttribute('data-id') === 'folder0000000001') {
      const icon = card.locator('.wd-file-icon svg');
      assert.equal(await icon.count(), 1, 'Folder card has its Files app icon');
      const box = await icon.boundingBox();
      assert.ok(box.width > 0 && box.height > 0, 'Folder card icon has visible dimensions');
    }
    assert.ok(await card.evaluate(el => parseFloat(getComputedStyle(el).borderTopWidth) > 0), `${app}: card outline is preserved`);
    assert.equal(await card.locator('button:visible').count(), 1, `${app}: only one visible card action control`);
    assert.equal(await trigger.count(), 1, `${app}: one three-dot button per card`);
    assert.equal(await trigger.getAttribute('aria-haspopup'), 'menu');
    assert.equal(await trigger.evaluate(el => getComputedStyle(el).opacity), '1', `${app}: dots visible without hovering`);
    // Let the scroll generated by bringing a mobile card into view finish
    // before opening a menu (menus intentionally dismiss on scroll).
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (mobile) await trigger.dispatchEvent('click');
    else await trigger.click();
    await menu.waitFor();
    const labels = (await menu.getByRole('menuitem').allTextContents()).map(label => label.trim());
    assert.ok(labels.length && labels.every(label => label.trim()), `${app}: labelled card menu`);
    checkMenuLabels(labels, app);
    assert.ok(!labels.some(label => /More actions|More options/.test(label)), `${app}: no recursive menu action`);
    if (await card.getAttribute('data-id') === 'calendar') assert.deepEqual(labels, ['Copy link']);
    else assert.match(labels.at(-1), /^Delete/, `${app}: destructive action remains last`);
    if (app === 'docs') assert.ok(!labels.some(label => /pin/i.test(label)), 'Docs has no pin actions');
    const bounds = await menu.boundingBox(), viewport = page.viewportSize();
    assert.ok(bounds, `${app}: menu remains visible after opening`);
    assert.ok(bounds.x >= 8 && bounds.x + bounds.width <= viewport.width - 8, `${app}: card menu horizontal bounds`);
    assert.ok(bounds.y >= 8 && bounds.y + bounds.height <= viewport.height - 8, `${app}: card menu vertical bounds`);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true, `${app}: focus returns to card dots`);
    assert.equal(page.url(), pageURL, `${app}: opening card menu must not open the file`);
  }
  const trigger = cards.first().locator('.wd-card-more');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await menu.waitFor();
  assert.equal(await menu.getByRole('menuitem').first().evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('End');
  assert.equal(await menu.getByRole('menuitem').last().evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  if (dispatch) {
    page.once('dialog', nativeDialog => nativeDialog.dismiss());
    await trigger.click();
    const rename = menu.getByRole('menuitem', { name: /^Rename/ });
    await (await rename.count() ? rename.first() : menu.getByRole('menuitem', { name: /^Delete/ }).first()).click();
    await menu.waitFor({ state: 'detached' });
    await page.waitForTimeout(150);
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await cancel.count()) await cancel.first().click();
    assert.equal(page.url(), pageURL, `${app}: card action must not activate the card`);
  }
  if (!mobile && app === 'home') {
    await trigger.click();
    await page.evaluate(() => {
      const input = document.querySelector('#searchInput');
      input.value = 'no-matching-record-123'; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await menu.waitFor({ state: 'detached' });
    await page.locator('#searchInput').fill('');
    await cards.first().waitFor();
  }
}
try {
  for (const theme of ['dark', 'light']) {
    let reference;
    for (const app of apps) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, serviceWorkers: 'block' });
      await context.addInitScript(value => localStorage.setItem('workdeck_theme', value), theme);
      let data = {
        tags: [{ id: 'tag1', name: 'Project planning', color: '#3B82F6' }], settings: { theme },
        docs: [{ ...shared, content: 'A shared preview\nReview the project and plan next steps.', contentType: 'plain-text' }],
        sheets: [{ ...shared, rows: 20, cols: 5 }], forms: [{ ...shared, components: [] }],
        slides: [{ ...shared, slides: [] }], draws: [{ ...shared, canvas: { objects: [] } }],
        todo: [{ ...shared, items: [{ text: 'Review plan', done: false }] }],
        kanban: [{ ...shared, columns: [], cards: [] }], posts: [{ ...shared, excerpt: 'A shared preview of the next project.' }],
        minutes: [{ ...shared, date: '2026-07-01', state: 'draft', agenda: [] }],
        files: [{ ...shared, name: 'Planning.txt', mimeType: 'text/plain', size: 28, tags: ['tag1'], thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=' }],
        folders: [{ ...shared, id: 'folder0000000001', name: 'Planning folder', tags: ['tag1'], parentId: null, updatedAt: '2026-06-01T12:00:00Z' }],
        calendars: [{ id: 'calendar00000001', name: 'Work', color: '#0284c7', updatedAt: '2026-06-01T12:00:00Z' }], events: [],
      };
      if (app === 'files') {
        data.folders.push({ ...data.folders[0], id: 'folder0000000002', name: 'Nested folder', parentId: data.folders[0].id });
        data.files.push({ ...data.files[0], id: 'nestedfile000001', folderId: 'folder0000000002' });
      }
      const mutations = [];
      let failNext = false;
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/me') return route.fulfill({ json: { member: { name: 'Test User', theme } } });
        if (url.pathname === '/api/todo/lists') return route.fulfill({ json: { lists: data.todo, tags: data.tags, settings: data.settings } });
        const body = route.request().postDataJSON();
        if (body?.action) {
          mutations.push(body);
          if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { success: false, error: 'Test request failed' } }); }
          if (body.action === 'updateTag') data.tags = data.tags.map(tag => tag.id === body.data.tagId ? { ...tag, ...body.data.updates } : tag);
          if (body.action === 'createTag') data.tags = [{ id: 'tag2', ...body.data }, ...data.tags];
          if (body.action === 'deleteTag') data.tags = data.tags.filter(tag => tag.id !== body.data.tagId);
        }
        return route.fulfill({ json: { success: true, data } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(`${origin}/${app === 'home' ? 'home' : app + '/'}`, { waitUntil: 'networkidle' });
        const tags = page.locator('.wd-tag-ui:has(.wd-tag-rows)').first();
        await tags.locator('.wd-project-row').waitFor();
        await checkHomeRibbons(page, app);
        const metrics = await page.evaluate(() => {
          const input = document.querySelector('.wd-home-search input, #searchInput');
          const style = getComputedStyle(input), box = input.getBoundingClientRect();
          const icon = input.parentElement.querySelector('.wd-search-icon');
          const card = document.querySelector('.wd-home-card,.wd-doc-card,.wd-file-card,.fb-card');
          return { x: box.x, width: box.width, height: box.height, radius: style.borderRadius,
            iconColor: getComputedStyle(icon).color, cardWidth: card?.getBoundingClientRect().width,
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        if (app === 'home') reference = metrics;
        assert.equal(metrics.radius, reference.radius, `${app}: search radius`);
        assert.equal(metrics.iconColor, reference.iconColor, `${app}: search icon color`);
        assert.equal(metrics.width, reference.width, `${app}: search width`);
        assert.equal(metrics.x, reference.x, `${app}: search alignment`);
        assert.ok(Math.abs(metrics.height - reference.height) <= 1, `${app}: search height`);
        assert.equal(metrics.cardWidth, reference.cardWidth, `${app}: grid width`);
        assert.equal(metrics.overflow, false, `${app}: desktop overflow`);
        assert.equal(await tags.locator('.wd-side-more').count(), 0);
        await checkCardMenus(page, app, { dispatch: true });
        if (app === 'files') await checkFilesLayout(page);

        // Opening/closing does not mutate; edits autosave and failures retry.
        const row = tags.locator('.wd-project-row').first();
        await row.focus();
        await row.getByRole('button', { name: 'Edit Project planning' }).click();
        const name = tags.getByRole('textbox', { name: 'Tag name' });
        const before = mutations.length;
        await tags.getByRole('button', { name: 'Done', exact: true }).click();
        assert.equal(mutations.length, before);
        await row.focus();
        await row.getByRole('button', { name: 'Edit Project planning' }).click();
        await name.fill('Updated planning');
        failNext = true;
        await tags.locator('[data-save-status=error]').waitFor();
        assert.equal(await name.inputValue(), 'Updated planning');
        await page.evaluate(() => dispatchEvent(new Event('online')));
        await tags.getByRole('button', { name: 'Edit Updated planning', includeHidden: true }).waitFor({ state: 'attached' });
        assert.equal(data.tags[0].name, 'Updated planning');
        await tags.getByRole('button', { name: 'Done', exact: true }).click();

        // Delete uses the shared, keyboard-trapped dialog, not browser confirm.
        await tags.locator('.wd-project-row').first().focus();
        await tags.getByRole('button', { name: 'Delete Updated planning' }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete Tag' });
        await dialog.waitFor();
        assert.match(await dialog.textContent(), /Files and folders in Files keep existing/);
        const deletes = mutations.filter(item => item.action === 'deleteTag').length;
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(mutations.filter(item => item.action === 'deleteTag').length, deletes);

        // Creation shares the palette, labels and inline form across all apps.
        await tags.getByRole('button', { name: 'New tag', exact: true }).click();
        assert.equal(await tags.locator('.wd-color-swatch').count(), 8);
        await name.fill('A new tag');
        await tags.getByRole('button', { name: 'Create', exact: true }).click();
        await tags.getByRole('button', { name: 'Edit A new tag', includeHidden: true }).waitFor({ state: 'attached' });
        await tags.locator('.wd-project-row').filter({ hasText: 'A new tag' }).focus();
        await tags.getByRole('button', { name: 'Delete A new tag' }).click();
        failNext = true;
        await dialog.getByRole('button', { name: 'Delete Tag', exact: true }).click();
        await dialog.getByRole('alert').waitFor();
        assert.equal(data.tags.some(tag => tag.id === 'tag2'), true, 'failed delete preserves tag');
        await dialog.getByRole('button', { name: 'Delete Tag', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        await tags.locator('.wd-project-row').first().waitFor();
        assert.equal(data.tags.some(tag => tag.id === 'tag2'), false, 'confirmed delete removes tag');

        const toggle = page.getByRole('button', { name: 'Switch to list view', exact: true }).first();
        const more = page.locator('.wd-file-list-more:visible, .wd-app-list-more:visible, #fbList .fb-item-menu:visible, .docs-list-grid [aria-label="More options"]:visible').first();
        const actions = page.getByRole('menu', { name: 'File actions', exact: true });
        if (await toggle.count()) {
          await toggle.click();
          assert.ok(await page.getByText('Updated', { exact: true }).first().isVisible(), `${app}: list columns`);
          await more.click();
          await actions.waitFor();
          const geometry = await actions.getByRole('menuitem').evaluateAll(items => items.map(item => {
            const rect = item.getBoundingClientRect(), label = item.querySelector('.wd-action-menu-label');
            return { x: rect.x, y: rect.y, width: rect.width, text: label.textContent.trim(), labelWidth: label.getBoundingClientRect().width, icon: !!item.querySelector('svg') };
          }));
          assert.ok(geometry.length >= 2);
          checkMenuLabels(geometry.map(item => item.text), app);
          assert.match(geometry.at(-1).text, /^Delete/, `${app}: destructive action at bottom`);
          geometry.forEach((item, index) => {
            assert.ok(item.text && item.icon && item.labelWidth > 30 && item.width > 150, `${app}: visible labels and icons`);
            if (index) { assert.equal(item.x, geometry[0].x); assert.ok(item.y > geometry[index - 1].y, `${app}: vertical menu`); }
          });
          const anchor = await more.boundingBox(), box = await actions.boundingBox();
          assert.ok(box.y >= anchor.y + anchor.height || box.y + box.height <= anchor.y, `${app}: dropdown, not side strip`);
          await page.locator('.wd-home-search input, #searchInput').first().click();
          await actions.waitFor({ state: 'detached' });
          assert.equal(await more.getAttribute('aria-expanded'), 'false');

          await more.focus();
          await page.keyboard.press('ArrowDown');
          await actions.waitFor();
          assert.equal(await actions.getByRole('menuitem').first().evaluate(el => el === document.activeElement), true);
          await page.keyboard.press('End');
          assert.equal(await actions.getByRole('menuitem').last().evaluate(el => el === document.activeElement), true);
          await page.keyboard.press('Home');
          assert.equal(await actions.getByRole('menuitem').first().evaluate(el => el === document.activeElement), true);
          await page.keyboard.press('ArrowDown');
          assert.equal(await actions.getByRole('menuitem').nth(1).evaluate(el => el === document.activeElement), true);
          await page.keyboard.press('Escape');
          await actions.waitFor({ state: 'detached' });
          assert.equal(await more.evaluate(el => el === document.activeElement), true);

          // The visible label still dispatches the existing action; it never opens the file row.
          const dataMutations = () => mutations.filter(item => !['updateSettings', 'setFileThumbnail'].includes(item.action)).length;
          const beforeAction = page.url(), beforeMutations = dataMutations();
          page.once('dialog', nativeDialog => nativeDialog.dismiss()); // Blog/Minutes use native confirmations.
          await more.click();
          const rename = actions.getByRole('menuitem', { name: /^Rename/ });
          await (await rename.count() ? rename.first() : actions.getByRole('menuitem', { name: /^Delete/ }).first()).click();
          await actions.waitFor({ state: 'detached' });
          await page.waitForTimeout(150);
          const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
          if (await cancel.count()) await cancel.first().click();
          assert.equal(page.url(), beforeAction, `${app}: action must not open the file`);
          assert.equal(dataMutations(), beforeMutations, `${app}: cancelling action must not mutate data`);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(500);
        // Some apps retain the desktop sidebar state when resized; close the
        // drawer as a mobile user would before operating the underlying list.
        const drawerCloses = page.getByRole('button', { name: 'Close sidebar', exact: true });
        for (const close of await drawerCloses.all()) {
          const reachable = await close.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
          if (reachable) { await close.click(); await page.waitForTimeout(300); break; }
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${app}: mobile overflow`);
        const search = page.locator('.wd-home-search input, #searchInput').first();
        assert.equal(await search.isVisible(), true, `${app}: mobile search remains visible`);
        await checkHomeRibbons(page, app);
        if (await more.count()) {
          // Force the trigger against the bottom/right edge to exercise upward placement.
          await more.evaluate(el => { el.style.position = 'fixed'; el.style.right = '8px'; el.style.bottom = '8px'; el.style.zIndex = '1100'; });
          await more.click();
          await actions.waitFor();
          const box = await actions.boundingBox(), anchor = await more.boundingBox();
          assert.ok(box.x >= 8 && box.x + box.width <= 382, `${app}: mobile menu horizontal bounds`);
          assert.ok(box.y >= 8 && box.y + box.height <= anchor.y, `${app}: mobile menu flips above`);
          await page.keyboard.press('Escape');
          await actions.waitFor({ state: 'detached' });
          if (app === 'home' && theme === 'dark') {
            await more.evaluate(el => window.WDActionMenu.open(el, Array.from({ length: 30 }, (_, i) => ({ label: `Action ${i + 1}`, icon: window.WDHomeIcons.docs, onSelect() {} }))));
            await page.keyboard.press('End');
            assert.equal(await actions.getByRole('menuitem').last().evaluate(el => el === document.activeElement), true);
            assert.ok(await actions.evaluate(el => el.scrollTop > 0), 'long menus scroll internally without dismissing');
            await page.keyboard.press('Escape');
            await actions.waitFor({ state: 'detached' });
          }
          await more.evaluate(el => el.removeAttribute('style'));
          await page.getByRole('button', { name: 'Switch to card view', exact: true }).first().click();
          await page.waitForTimeout(200); // view preference response may rebuild the cards
          await checkCardMenus(page, app, { mobile: true });
        }
        assert.deepEqual(errors, [], `${app}: browser errors`);
        console.log(`PASS ${theme} ${app}: layout, tags, card/list menus, keyboard, mobile`);
      } catch (error) {
        console.error({ app, theme, mutations, tags: data.tags, forms: await page.locator('.wd-tag-ui form').allTextContents() });
        throw error;
      } finally { await context.close(); }
    }
    // Calendar is a calendar workspace, not a file grid/tag sidebar.
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, serviceWorkers: 'block' });
    try {
      await context.addInitScript(value => localStorage.setItem('workdeck_theme', value), theme);
      await context.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/me'
        ? { member: { name: 'Test User', theme } }
        : { success: true, data: { calendars: [], events: [], todo: [], settings: { theme } } } }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/calendar/`, { waitUntil: 'networkidle' });
      await checkHomeRibbons(page, 'calendar');
      const input = page.locator('.wd-home-search input');
      assert.equal(await input.evaluate(el => getComputedStyle(el).borderRadius), reference.radius);
      assert.equal(await page.locator('.wd-home-search .wd-search-icon').evaluate(el => getComputedStyle(el).color), reference.iconColor);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      await checkHomeRibbons(page, 'calendar');
      assert.equal(await input.isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      console.log(`PASS ${theme} calendar: search styling, mobile`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); server.close(); }
