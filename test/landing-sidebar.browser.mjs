// Synthetic-session browser regression for sidebar -> workspace -> landing.
// WORKDECK_UI_BUILD=/tmp/workdeck-holm-release PLAYWRIGHT_PATH=/tmp/workdeck-ui-browser/node_modules/playwright/index.mjs CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/landing-sidebar.browser.mjs
import assert from 'node:assert/strict';
import { checkAccountAvatars } from './avatar-assertions.browser.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    let file = path.join(root, ['/home', '/apps'].includes(pathname) ? pathname + '.html' : pathname);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
async function checkNeutralHome(page, link, icon, theme, label) {
  const palette = theme === 'dark'
    ? { bg: 'rgb(20, 20, 20)', ink: 'rgb(245, 245, 245)', border: 'rgb(42, 42, 42)', hover: 'rgb(30, 30, 30)' }
    : { bg: 'rgb(247, 247, 245)', ink: 'rgb(26, 26, 26)', border: 'rgb(229, 229, 224)', hover: 'rgb(241, 241, 239)' };
  const appearance = el => {
    const css = getComputedStyle(el);
    return { bg: css.backgroundColor, ink: css.color, border: css.borderTopColor, image: css.backgroundImage, filter: css.filter };
  };
  await page.mouse.move(page.viewportSize().width - 1, 899);
  const normal = await icon.evaluate(appearance);
  assert.deepEqual(normal, { bg: palette.bg, ink: palette.ink, border: palette.border, image: 'none', filter: 'none' }, label + ' neutral home icon');
  const avatar = page.locator('.wd-account-trigger').first();
  if (await avatar.count()) assert.deepEqual(await avatar.evaluate(appearance), normal, label + ' matches avatar palette');
  await link.hover();
  assert.deepEqual(await icon.evaluate(appearance), { ...normal, bg: palette.hover }, label + ' neutral hover');
  await page.mouse.move(page.viewportSize().width - 1, 899);
}
try {
  for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(theme => localStorage.setItem('workdeck_theme', theme), theme);
    let member = true, failLogout = false, failSession = false, logouts = 0;
    const data = { settings: { theme }, tags: [], docs: [], sheets: [], forms: [], slides: [], draws: [], todo: [], kanban: [], minutes: [], posts: [], files: [], folders: [], calendars: [], events: [] };
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/me') {
        if (failSession) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        return route.fulfill({ json: { member: member ? { id: 'synthetic-member', name: 'Test', theme } : null,
          loginURL: '/auth/login?redirect=%2Fhome', logoutURL: '/auth/logout', accountURL: '/auth/account?redirect=%2Fhome' } });
      }
      if (url.pathname === '/api/todo/lists') return route.fulfill({ json: { lists: [], settings: data.settings } });
      return route.fulfill({ json: { success: true, data } });
    });
    await context.route('**/auth/logout', async route => {
      assert.equal(route.request().method(), 'POST');
      logouts++;
      if (failLogout) { failLogout = false; return route.fulfill({ status: 503, json: { error: 'Try again' } }); }
      member = false;
      return route.fulfill({ json: { success: true } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let icon, color;
    try {
      for (const app of ['docs', 'sheets', 'forms', 'slides', 'draw', 'todo', 'kanban', 'minutes', 'blog', 'files', 'calendar']) {
        await page.goto(`${origin}/${app}/`);
        const home = page.locator('aside').getByRole('link', { name: 'Workdeck home', exact: true, includeHidden: true });
        await home.waitFor({ state: 'attached' });
        const toggle = page.locator(app === 'docs' ? 'header button[aria-controls="docsSidebar"]:visible' : app === 'files' ? '#fbSidebarToggle' : app === 'calendar' ? '#sidebarToggleBtn' : '.wd-app-side-toggle');
        const assertBorderless = async () => assert.deepEqual(await toggle.evaluate(el => {
          const s = getComputedStyle(el);
          return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth, s.boxShadow, s.backgroundColor];
        }), ['0px', '0px', '0px', '0px', 'none', 'rgba(0, 0, 0, 0)'], app + ' borderless chevrons');
        await assertBorderless();
        try { await toggle.hover(); } catch (error) { console.error({ app, errors, url: page.url() }); throw error; }
        await assertBorderless();
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await assertBorderless();
        await home.waitFor({ state: 'visible' });
        await page.waitForTimeout(250); // drawer transition
        assert.equal(await home.getAttribute('href'), '/home', app);
        await page.mouse.move(width - 1, 899);
        const metrics = await home.evaluate(el => {
          const r = el.getBoundingClientRect(), sidebar = el.closest('aside').getBoundingClientRect(), style = getComputedStyle(el);
          return { width: r.width, height: r.height, x: r.left - sidebar.left, y: r.top - sidebar.top,
            bg: style.backgroundColor, svg: el.querySelector('svg').outerHTML };
        });
        assert.equal(metrics.width, 42, app + ' target width');
        assert.equal(metrics.height, 42, app + ' target height');
        assert.ok(Math.abs(metrics.x - 16) <= 1 && Math.abs(metrics.y - 16) <= 1, app + ' consistent top-left placement: ' + JSON.stringify(metrics));
        if (!icon) { icon = metrics.svg; color = metrics.bg; }
        assert.equal(metrics.svg, icon, app + ' same home icon');
        assert.equal(metrics.bg, color, app + ' same Workdeck identity');
        await checkNeutralHome(page, home, home, theme, app);
        await checkAccountAvatars(page, { required: app !== 'minutes' });
        await home.focus();
        await page.keyboard.press('Enter');
        await page.waitForURL(origin + '/home');
        const landingLink = page.getByRole('link', { name: 'Workdeck landing page', exact: true, includeHidden: true });
        await landingLink.waitFor({ state: 'attached' });
        if (width < 1024 && await page.locator('#sidebarToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#sidebarToggle').click();
        assert.equal(await landingLink.getAttribute('href'), '/');
        await checkNeutralHome(page, landingLink, landingLink.locator('.wd-logo-icon'), theme, 'dashboard');
        await checkAccountAvatars(page);
        await landingLink.click();
        await page.waitForURL(origin + '/');
        await page.locator('#landingSignOut:not([hidden])').waitFor({ state: 'attached' });
        assert.equal(page.url(), origin + '/', app + ' landing must not redirect signed-in visitors');
        assert.equal(await page.locator('#landingAccountLink').getAttribute('hidden'), '');
        const workspaceLink = page.getByRole('link', { name: 'Open Workdeck', exact: true });
        await workspaceLink.waitFor();
        assert.equal(await workspaceLink.getAttribute('href'), '/home');
        assert.equal(logouts, 0, 'visiting landing must not sign out');
        await checkAccountAvatars(page);
      }
      // Same public main content whether signed in or out; only account action changes.
      const memberMain = await page.locator('.lp > main').innerHTML();
      // The workspace entry is outside the closed menu and works by keyboard.
      if (width === 390) {
        await page.setViewportSize({ width: 320, height: 900 });
        const bounds = await page.locator('#landingWorkspaceLink').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320, 'workspace link fits a narrow phone');
        const accountBounds = await page.locator('#landingMenuToggle').boundingBox();
        assert.ok(accountBounds.x >= 0 && accountBounds.x + accountBounds.width <= 320, 'account remains reachable');
        await page.setViewportSize({ width, height: 900 });
      }
      await page.locator('#landingWorkspaceLink').focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(origin + '/home');
      await page.goBack();
      await page.waitForURL(origin + '/');
      await page.locator('#landingWorkspaceLink:not([hidden])').waitFor();
      await page.reload();
      await page.locator('#landingSignOut:not([hidden])').waitFor({ state: 'attached' });
      assert.equal(page.url(), origin + '/');
      await page.locator('#landingMenuToggle').click();
      assert.equal(await page.getByRole('link', { name: 'Sign in', exact: true }).count(), 0);
      assert.equal(await page.getByRole('link', { name: 'Your sign-ins', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Light theme', exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      failLogout = true;
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#landingSignOut').disabled);
      assert.equal(member, true);
      assert.equal(page.url(), origin + '/');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#landingAccountLink').hidden);
      await page.locator('#landingMenuToggle').click();
      await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sign out', exact: true }).count(), 0);
      assert.equal(member, false);
      assert.equal(await page.locator('#landingWorkspaceLink').isVisible(), false, 'guest has no member shortcut');
      assert.equal(logouts, 2);
      assert.equal(await page.locator('.lp > main').innerHTML(), memberMain, 'public UI unchanged');
      assert.equal(await page.locator('#landingAccountLink').getAttribute('href'), '/auth/login?redirect=%2Fhome');
      failSession = true;
      await page.reload();
      await page.locator('#landingMenuToggle').click();
      await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
      assert.equal(page.url(), origin + '/', 'session failure leaves public page usable');
      assert.equal(await page.locator('#landingWorkspaceLink').isVisible(), false, 'failed session check does not imply membership');
      failSession = false; member = true;
      await page.goto(origin + '/apps');
      await page.locator('#landingSignOut:not([hidden])').waitFor({ state: 'attached' });
      assert.equal(page.url(), origin + '/apps');
      assert.equal(await page.locator('#lp-docs-open').getAttribute('href'), '/docs/');
      await page.getByRole('link', { name: 'Open Workdeck', exact: true }).click();
      await page.waitForURL(origin + '/home');
      assert.deepEqual(errors, []);
      console.log(`PASS ${theme} ${width}px: neutral home/avatar palettes, 11 sidebar links, dashboard -> landing, member/guest UI, logout and failure states`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
