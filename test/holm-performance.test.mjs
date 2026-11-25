import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { withPageBoot } from '../holm/auth/navigation-build.mjs';
const source = readFileSync(new URL('../holm/auth/page-boot.js', import.meta.url), 'utf8');
function fixture(app = 'forms', pathname = '/forms/', search = '') {
  const requests = [], events = [], listeners = {}, window = {};
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ success: true, member: { id: 'synthetic' }, data: { forms: [{ id: 'form123456', version: requests.length }], tags: [] } });
  };
  runInNewContext(source, { window, location: { pathname, search }, URLSearchParams, AbortSignal,
    fetch, setTimeout() {}, addEventListener: (name, fn) => { listeners[name] = fn; },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { documentElement: { dataset: { wdApp: app } }, dispatchEvent: event => events.push(event) },
  });
  return { boot: window.WDBoot, requests, events, listeners };
}
test('startup overlaps session and scoped data; sidebar shares it; later reads are fresh', async () => {
  const { boot, requests, events, listeners } = fixture();
  assert.deepEqual(requests.map(r => r.url), ['/api/forms', '/api/me']);
  const [response, sidebar] = await Promise.all([boot.fetch('/api/forms'), boot.homeData(true)]);
  assert.equal((await response.json()).data.forms[0].id, sidebar.forms[0].id);
  assert.equal(requests.length, 2);
  await boot.fetch('/api/forms');
  assert.equal(requests.length, 3, 'only startup is reused, not later refreshes');
  await boot.fetch('/api/forms', { method: 'PUT', body: JSON.stringify({ action: 'updateForm' }) });
  assert.equal(events[0].type, 'wd:data-changed');
  listeners.pagehide();
  await boot.fetch('/api/me');
  assert.equal(requests.length, 5, 'bfcache restores cannot consume a stale session');
  assert.ok(requests.slice(0, 2).every(r => r.options.cache === 'no-store'));
});
test('shared pages never prefetch private data or a member session', () => {
  for (const [app, path, search] of [['forms', '/forms/shared.html', ''], ['docs', '/docs/', '?shared=token']]) {
    assert.equal(fixture(app, path, search).requests.length, 0);
  }
});
test('sheet body starts alongside metadata and auth, not after the editor libraries', () => {
  assert.deepEqual(fixture('sheets', '/sheets/editor.html', '?id=sheet12345').requests.map(r => r.url),
    ['/api/users', '/api/me', '/api/users?sheet=sheet12345']);
});
test('deferred libraries preserve order, route homes start hidden, iframe templates remain inert', () => {
  const template = '<textarea hidden><script src="__FABRIC_SRC__"></script></textarea>';
  const page = '<html data-wd-app="todo"><head><script src="/js/suite-theme.js"></script><script src="vendor.js"></script></head><body><div id="listsView"></div>' + template + '<script src="app.js"></script></body></html>';
  const built = withPageBoot(page);
  assert.match(built, /<head><script data-wd-boot>/);
  assert.match(built, /<script src="\/js\/suite-theme.js"><\/script>/);
  assert.match(built, /<script defer src="vendor.js"><\/script>/);
  assert.match(built, /<script defer src="app.js"><\/script>/);
  assert.ok(built.includes(template));
  assert.match(built, /id="listsView" class="hidden"/);
});
