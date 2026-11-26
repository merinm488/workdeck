// Synthetic-session browser regression using the production router: no landing flash.
// WORKDECK_UI_BUILD=/tmp/workdeck-holm-release PLAYWRIGHT_PATH=/tmp/workdeck-ui-browser/node_modules/playwright/index.mjs CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/landing-sidebar.browser.mjs
import assert from 'node:assert/strict';
import { checkAccountAvatars } from './avatar-assertions.browser.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(process.env.WORKDECK_UI_BUILD || '/tmp/workdeck-holm-release', 'web');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const { default: appRouter } = await import(pathToFileURL(path.join(root, '../api/main.js')).href);
let member = false;
const servedPages = [];
const server = createServer(async (req, res) => {
  try {
    const request = new Request(new URL(req.url, 'http://' + req.headers.host));
    const staticFetch = async request => {
      const pathname = new URL(request.url).pathname;
      let file = path.join(root, pathname === '/apps' ? '/apps.html' : pathname === '/home' ? '/home.html' : pathname);
      if (file !== root && !file.startsWith(root + '/')) throw Error('Invalid path');
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      if (file.endsWith('.html')) servedPages.push(path.relative(root, file));
      return new Response(body, { headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' } });
    };
    // Match Holm's STATIC-FIRST dispatch, not just the JavaScript router.
    const response = await staticFetch(request).catch(() => appRouter.fetch(request, { holm: {
      auth: { getMember: () => member ? { id: 'synthetic-member' } : null },
      private: { read: template => {
        servedPages.push(template);
        return readFileSync(path.join(root, '../api', template), 'utf8');
      } },
      web: { fetch: staticFetch },
    } }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
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
  // Account photos have their own borderless styling, checked separately below.
  await link.hover();
  assert.deepEqual(await icon.evaluate(appearance), { ...normal, bg: palette.hover }, label + ' neutral hover');
  await page.mouse.move(page.viewportSize().width - 1, 899);
}
try {
  for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(theme => localStorage.setItem('workdeck_theme', theme), theme);
    member = true;
    let failLogout = false, failSession = false, logouts = 0;
    const data = { settings: { theme }, tags: [], docs: [], sheets: [], forms: [], slides: [], draws: [], todo: [], kanban: [], minutes: [], posts: [], files: [], folders: [], calendars: [], events: [] };
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/me') {
        await new Promise(resolve => setTimeout(resolve, 150)); // no client-side redirect dependency
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
    const navigations = [];
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(new URL(request.url()).pathname); });
    let icon, color;
    try {
      for (const route of ['/', '/index.html', '/home/', '/home.html']) {
        servedPages.length = 0;
        await page.goto(origin + route);
        await page.waitForURL(origin + '/home');
        assert.deepEqual(servedPages, ['home.html'], route + ': server never sends landing HTML');
        assert.equal(await page.locator('#landingView').count(), 0);
      }
      await page.reload();
      assert.equal(page.url(), origin + '/home');
      for (const app of ['docs', 'sheets', 'forms', 'slides', 'draw', 'todo', 'kanban', 'minutes', 'blog', 'files', 'calendar']) {
        await page.goto(`${origin}/${app}/`, { waitUntil: 'networkidle' });
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
          const tile = el.querySelector('.wd-sidebar-home-icon');
          const r = tile.getBoundingClientRect(), sidebar = el.closest('aside').getBoundingClientRect(), style = getComputedStyle(tile);
          return { width: r.width, height: r.height, x: r.left - sidebar.left, y: r.top - sidebar.top,
            bg: style.backgroundColor, artwork: el.querySelector('img').outerHTML,
            loaded: el.querySelector('img').complete && el.querySelector('img').naturalWidth > 0,
            artworkWidth: el.querySelector('img').getBoundingClientRect().width, svg: !!el.querySelector('svg') };
        });
        assert.equal(metrics.width, 42, app + ' target width');
        assert.equal(metrics.height, 42, app + ' target height');
        assert.ok(Math.abs(metrics.x - 16) <= 1 && Math.abs(metrics.y - 16) <= 1, app + ' consistent top-left placement: ' + JSON.stringify(metrics));
        assert.equal(metrics.loaded, true, app + ' artwork loaded');
        assert.equal(metrics.artworkWidth, 32, app + ' artwork size');
        assert.equal(metrics.svg, false, app + ' no house SVG');
        if (!icon) { icon = metrics.artwork; color = metrics.bg; }
        assert.equal(metrics.artwork, icon, app + ' same app icon');
        assert.equal(metrics.bg, color, app + ' same Workdeck identity');
        const label = home.locator('.wd-sidebar-home-text');
        assert.equal(await label.textContent(), 'Workdeck', app + ' wordmark');
        assert.equal(await label.isVisible(), true, app + ' visible wordmark');
        const textStyle = el => {
          const s = getComputedStyle(el);
          return { size: s.fontSize, weight: s.fontWeight, color: s.color };
        };
        const wordmarkStyle = await label.evaluate(textStyle);
        assert.equal(wordmarkStyle.size, '18px');
        assert.equal(wordmarkStyle.weight, '700');
        const [labelBounds, tileBounds] = await home.evaluate(el => ['.wd-sidebar-home-text', '.wd-sidebar-home-icon']
          .map(selector => el.querySelector(selector).getBoundingClientRect().toJSON()));
        assert.equal(Math.round(labelBounds.x - tileBounds.x - tileBounds.width), 10, app + ' wordmark gap');
        assert.ok(labelBounds.x + labelBounds.width <= width, app + ' wordmark fits viewport');
        const close = home.locator('..').locator('button:visible');
        if (await close.count()) assert.ok(labelBounds.x + labelBounds.width <= (await close.first().boundingBox()).x, app + ' close button stays clear');
        await checkNeutralHome(page, home, home.locator('.wd-sidebar-home-icon'), theme, app);
        await checkAccountAvatars(page, { required: app !== 'minutes' });
        navigations.length = 0; servedPages.length = 0;
        // Exercise both the new text hit target and normal keyboard activation.
        if (width < 1024) await label.click();
        else { await home.focus(); await page.keyboard.press('Enter'); }
        await page.waitForURL(origin + '/home');
        const homeLink = page.locator('aside').getByRole('link', { name: 'Workdeck home', exact: true, includeHidden: true });
        await homeLink.waitFor({ state: 'attached' });
        if (width < 1024 && await page.locator('#sidebarToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#sidebarToggle').click();
        assert.equal(await homeLink.getAttribute('href'), '/home');
        assert.equal(await homeLink.locator('img').evaluate(el => el.outerHTML), icon);
        assert.deepEqual(await homeLink.locator('.wd-logo-text').evaluate(textStyle), wordmarkStyle, app + ' matches dashboard wordmark');
        await checkNeutralHome(page, homeLink, homeLink.locator('.wd-logo-icon'), theme, 'dashboard');
        await checkAccountAvatars(page);
        await homeLink.click();
        await page.waitForURL(origin + '/home');
        await page.locator('#homeView').waitFor();
        assert.ok(navigations.length >= 1);
        assert.ok(navigations.every(url => url === '/home'), app + ': direct home navigation only');
        assert.ok(servedPages.every(file => file === 'home.html'), app + ': no landing flash');
        assert.equal(logouts, 0);
      }
      // The catalogue remains available to members; root is only for guests.
      await page.goto(origin + '/apps');
      await page.locator('#landingWorkspaceLink:not([hidden])').waitFor();
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
      await page.waitForURL(origin + '/apps');
      await page.locator('#landingWorkspaceLink:not([hidden])').waitFor();
      await page.reload();
      await page.locator('#landingSignOut:not([hidden])').waitFor({ state: 'attached' });
      assert.equal(page.url(), origin + '/apps');
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
      assert.equal(page.url(), origin + '/apps');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForFunction(() => {
        const link = document.querySelector('#landingAccountLink');
        return link && !link.hidden; // sign-out reloads; the new document may not be parsed yet
      });
      await page.locator('#landingMenuToggle').click();
      await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sign out', exact: true }).count(), 0);
      assert.equal(member, false);
      assert.equal(await page.locator('#landingWorkspaceLink').isVisible(), false, 'guest has no member shortcut');
      assert.equal(logouts, 2);
      assert.equal((await page.locator('.lp > main').innerHTML()).replace('href="/auth/login?redirect=%2Fdocs%2F"', 'href="/docs/"'), memberMain, 'catalogue unchanged except the guest Docs sign-in link');
      assert.equal(await page.locator('#landingAccountLink').getAttribute('href'), '/auth/login?redirect=%2Fhome');
      await page.goto(origin + '/home');
      await page.waitForURL(origin + '/');
      await page.locator('#landingView').waitFor();
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
      console.log(`PASS ${theme} ${width}px: neutral home/avatar palettes, 11 sidebar links, direct home navigation, server redirects without landing flash, member/guest UI, logout and failure states`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
