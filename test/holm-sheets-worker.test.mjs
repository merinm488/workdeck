import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function worker({ offline = false, cached = null, brokenCache = false } = {}) {
  const listeners = {}, deleted = [], put = [], fetched = [];
  const keys = ['sheets-static-holm-v2', 'sheets-dynamic-holm-v2', 'sheets-api-holm-v2', 'sheets-static-holm-v3', 'workdeck-docs-hashed-v1', 'filebox-static-v1'];
  const self = { location: { origin: 'https://workdeck.test' }, clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener: (name, fn) => { listeners[name] = fn; } };
  runInNewContext(read('holm/sheets/service-worker.js'), {
    self, URL, Response, console,
    caches: { keys: async () => keys, delete: async name => deleted.push(name), open: async () => {
      if (brokenCache) throw Error('Cache unavailable');
      return { match: async () => cached, put: async (...args) => put.push(args) };
    } },
    fetch: async request => {
      fetched.push(request.url);
      if (offline) throw TypeError('Offline');
      const response = new Response('fresh');
      Object.defineProperty(response, 'type', { value: 'basic' });
      return response;
    }
  });
  async function request(path, { mode = 'cors', method = 'GET' } = {}) {
    let response; const tasks = [];
    listeners.fetch({ request: { url: new URL(path, self.location.origin).href, mode, method }, respondWith: p => { response = p; }, waitUntil: p => tasks.push(p) });
    const result = response === undefined ? undefined : await response;
    await Promise.all(tasks);
    return result;
  }
  return { listeners, deleted, put, fetched, request };
}

test('Sheets worker never intercepts editor shells, runtime code, auth, APIs or external fonts', async () => {
  const sw = worker();
  for (const path of ['/sheets/', '/sheets/editor?id=one', '/sheets/editor.html?id=one', '/sheets/book-id', '/sheets/shared?shared=one', '/sheets/shared.html?shared=one', '/sheets/js/app.js', '/js/autosave.js', '/sheets/js/app.js?v=3', '/sheets/styles.css', '/api/me', '/api/users', '/auth/login', 'https://fonts.googleapis.com/css2?family=Inter', 'https://fonts.gstatic.com/inter.woff2', 'https://cdn.jsdelivr.net/library.js']) {
    assert.equal(await sw.request(path), undefined, path);
    assert.equal(await sw.request(path, { mode: 'navigate' }), undefined, path + ' navigation');
  }
  assert.equal(await sw.request('/sheets/icons/icon-192x192.png', { method: 'POST' }), undefined);
  assert.deepEqual(sw.fetched, []);
});

test('Sheets migration removes every obsolete Sheets cache without touching other apps', async () => {
  const sw = worker(); let task;
  sw.listeners.activate({ waitUntil: promise => { task = promise; } }); await task;
  assert.deepEqual(sw.deleted, ['sheets-static-holm-v2', 'sheets-dynamic-holm-v2', 'sheets-api-holm-v2']);
});

test('artwork is network-first; offline misses always resolve to a Response', async () => {
  const online = worker();
  assert.equal(await (await online.request('/icons/sheets192.png')).text(), 'fresh');
  assert.equal(online.put.length, 1);
  for (const brokenCache of [false, true]) {
    const offline = worker({ offline: true, brokenCache });
    const response = await offline.request('/fonts/InterVariable.woff2');
    assert.ok(response instanceof Response); assert.equal(response.type, 'error');
  }
  const offline = worker({ offline: true, cached: new Response('cached icon') });
  assert.equal(await (await offline.request('/sheets/icons/icon-192x192.png')).text(), 'cached icon');
});

test('stale Sheets shells recover once before initialization, without reloading a valid editor', () => {
  const source = read('holm/sheets/app.js');
  const start = source.indexOf('function ensureSheetsRuntime()');
  const end = source.indexOf("document.addEventListener('DOMContentLoaded'", start);
  function run({ runtime = false, script = false, url = 'https://workdeck.test/sheets/editor?id=synthetic-book' } = {}) {
    const replaced = [], context = { URL, window: { WDAutosave: runtime ? {} : undefined, location: { href: url, replace: value => replaced.push(value) } }, document: { querySelector: () => script } };
    runInNewContext(source.slice(start, end), context);
    return { ensure: context.ensureSheetsRuntime, replaced };
  }
  const old = run(); assert.equal(old.ensure(), false);
  const url = new URL(old.replaced[0]); assert.equal(url.searchParams.get('id'), 'synthetic-book'); assert.equal(url.searchParams.get('wd-shell'), '3');
  assert.throws(() => run({ url: url.href }).ensure(), /could not load/);
  assert.throws(() => run({ script: true }).ensure(), /could not load/);
  const current = run({ runtime: true, script: true });
  assert.equal(current.ensure(), true); assert.deepEqual(current.replaced, []);
  assert.match(source.slice(end), /if \(!ensureSheetsRuntime\(\)\) return;/);
});
