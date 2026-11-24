import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { handleDocs } from '../holm/docs/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';
import { handleCalendar } from '../holm/calendar/api.js';

function fixture() {
  const stores = new Map();
  let next = 0;
  const globalRows = new Map();
  const clone = value => structuredClone(value);
  function realm(rows) {
    const col = name => {
      if (!rows.has(name)) rows.set(name, new Map());
      return rows.get(name);
    };
    const ds = {
      find: (name, query = {}, options = {}) => {
        const records = [...col(name).values()].filter(row => Object.entries(query).every(([k, v]) => row[k] === v));
        return (options.order === 'desc' ? records.reverse() : records).slice(0, options.limit || Infinity).map(clone);
      },
      count: (name, query = {}) => ds.find(name, query).length,
      findOne: (name, where) => clone(col(name).get(typeof where === 'string' ? where : where.id) || null),
      insert: (name, doc) => { const id = `record_${++next}_abcxyz`; col(name).set(id, clone({ ...doc, id })); return id; },
      update: (name, where, patch) => col(name).set(where.id, clone({ ...col(name).get(where.id), ...patch.$set })),
      delete: (name, where) => col(name).delete(where.id),
      transaction: fn => fn(ds),
    };
    return ds;
  }
  const globalDS = realm(globalRows);
  function member(id) {
    if (!stores.has(id)) stores.set(id, { rows: new Map(), kv: new Map() });
    const { rows, kv } = stores.get(id);
    return { holm: { auth: { getMember: () => ({ id }) }, app: {
      ds: globalDS, member: { ds: realm(rows), kv: {
        get: key => clone(kv.get(key)), set: (key, value) => kv.set(key, clone(value)),
      } },
    } } };
  }
  const anon = { holm: { auth: { getMember: () => null }, app: { ds: globalDS } } };
  async function call(handler, env, method = 'GET', body, path, origin = 'https://workdeck.test') {
    const url = 'https://workdeck.test' + (path || (handler === handleDocs ? '/api/docs' :
      handler === handleWorkspace ? '/api/workdeck' : '/api/calendar'));
    const response = await handler(new Request(url, { method,
      headers: body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: response.status, body: await response.json() };
  }
  const put = (handler, env, action, data, origin) => call(handler, env, 'PUT', { action, data }, undefined, origin);
  return { member, anon, call, put };
}

test('Docs CRUD, versioning, suite tags and cross-app links are member-private', async () => {
  const { member, anon, put, call } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await call(handleDocs, anon)).status, 401);
  assert.equal((await put(handleDocs, alice, 'createDoc', { title: 'x' }, 'https://evil.test')).status, 403);
  assert.equal((await call(handleDocs, alice, 'PUT', { hash: 'bob', action: 'createDoc', data: {} })).status, 400);
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Writing', color: '#336699' })).body.data.tags[0];
  const doc = (await put(handleDocs, alice, 'createDoc', {
    title: 'Notes', content: '# Heading', contentType: 'markdown', tagId: tag.id,
  })).body.doc;
  assert.equal(doc.version, 1);
  assert.deepEqual((await call(handleDocs, bob)).body.data.docs, []);
  assert.equal((await put(handleDocs, bob, 'updateDoc', {
    docId: doc.id, version: 1, updates: { title: 'Stolen' },
  })).status, 404);
  assert.equal((await put(handleDocs, alice, 'createDoc', { title: 'Forged', tagId: 'other_account_tag' })).status, 400);
  const modified = await put(handleDocs, alice, 'updateDoc', {
    docId: doc.id, version: 1, updates: { content: 'Revised Markdown' },
  });
  assert.equal(modified.status, 200);
  assert.equal(modified.body.data.docs[0].version, 2);
  assert.equal((await put(handleDocs, alice, 'updateDoc', {
    docId: doc.id, version: 1, updates: { content: 'Old tab' },
  })).status, 409);
  const pin = await put(handleDocs, alice, 'togglePin', { docId: doc.id, version: 2 });
  assert.equal(pin.body.data.docs[0].pinned, true);
  const archive = await put(handleDocs, alice, 'toggleArchive', { docId: doc.id, version: 3 });
  assert.equal(archive.body.data.docs[0].archived, true);
  assert.equal(archive.body.data.docs[0].pinned, false);
  assert.equal((await put(handleWorkspace, bob, 'setFileTag', { app: 'docs', fileId: doc.id, tagId: null })).status, 404);
  const cal = (await put(handleCalendar, alice, 'createCalendar', { name: 'Personal' })).body.calendar;
  const linked = await put(handleCalendar, alice, 'createEvent', { event: {
    calId: cal.id, title: 'Linked doc', description: '', location: '', allDay: false,
    start: '2027-01-01T12:00:00.000Z', end: '2027-01-01T13:00:00.000Z', links: [
      { app: 'docs', id: doc.id, name: 'Notes' },
    ],
  } });
  assert.equal(linked.status, 200);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'docs', fileId: doc.id })).status, 200);
  assert.ok((await call(handleWorkspace, alice)).body.data.settings.lastOpened[doc.id]);
  const deletedTag = await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id });
  assert.deepEqual(deletedTag.body.data.docs, []);
  assert.equal(deletedTag.body.data.settings.lastOpened[doc.id], undefined);
});

test('Docs sharing is explicitly public, read-only, revocable, and never exposes private member metadata', async () => {
  const { member, anon, put, call } = fixture();
  const alice = member('alice'), bob = member('bob');
  const doc = (await put(handleDocs, alice, 'createDoc', {
    title: 'Share me', content: 'Safe content', contentType: 'markdown',
  })).body.doc;
  assert.equal((await call(handleDocs, anon, 'GET', undefined, '/api/docs?shared=guess')).status, 404);
  const shared = await put(handleDocs, alice, 'shareDoc', { docId: doc.id, version: 1 });
  assert.equal(shared.status, 200);
  assert.match(shared.body.shareId, /^[0-9a-f]{64}$/);
  assert.equal(shared.body.shareUrl, `https://workdeck.test/docs/?shared=${shared.body.shareId}`);
  const anonRead = await call(handleDocs, anon, 'GET', undefined, `/api/docs?shared=${shared.body.shareId}`);
  assert.equal(anonRead.status, 200);
  assert.equal(anonRead.body.doc.title, 'Share me');
  for (const privateField of ['sharedId', 'tagId', 'version', 'memberId', 'email', 'hash'])
    assert.equal(anonRead.body.doc[privateField], undefined);
  assert.equal((await put(handleDocs, bob, 'shareDoc', { docId: doc.id, version: 1 })).status, 404);
  assert.equal((await put(handleDocs, anon, 'updateDoc', { docId: doc.id, version: 1, updates: { title: 'Hack' } })).status, 401);
  const update = await put(handleDocs, alice, 'updateDoc', {
    docId: doc.id, version: 2, updates: { title: 'New public title', content: 'Live update' },
  });
  assert.equal(update.status, 200);
  const publicUpdated = await call(handleDocs, anon, 'GET', undefined, `/api/docs?shared=${shared.body.shareId}`);
  assert.equal(publicUpdated.body.doc.content, 'Live update');
  assert.equal(publicUpdated.body.doc.title, 'New public title');
  const reused = await put(handleDocs, alice, 'shareDoc', { docId: doc.id, version: 3 });
  assert.equal(reused.body.alreadyShared, true);
  assert.equal(reused.body.shareId, shared.body.shareId);
  assert.equal((await put(handleDocs, alice, 'deleteDoc', { docId: doc.id, version: 3 })).status, 200);
  assert.equal((await call(handleDocs, anon, 'GET', undefined, `/api/docs?shared=${shared.body.shareId}`)).status, 404);
});

test('Dashboard rename and tag deletion update/revoke shared Docs without exposing other members', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice');
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Private', color: '#335577' })).body.data.tags[0];
  const doc = (await put(handleDocs, alice, 'createDoc', { title: 'Tagged', tagId: tag.id })).body.doc;
  const token = (await put(handleDocs, alice, 'shareDoc', { docId: doc.id, version: 1 })).body.shareId;
  const renamed = await put(handleWorkspace, alice, 'renameFile', { app: 'docs', fileId: doc.id, name: 'Renamed' });
  assert.equal(renamed.status, 200);
  const publicDoc = await call(handleDocs, anon, 'GET', undefined, `/api/docs?shared=${token}`);
  assert.equal(publicDoc.body.doc.title, 'Renamed');
  assert.equal((await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id })).status, 200);
  assert.equal((await call(handleDocs, anon, 'GET', undefined, `/api/docs?shared=${token}`)).status, 404);
  const extra = (await put(handleDocs, alice, 'createDoc', { title: 'One more' })).body.doc;
  const secondToken = (await put(handleDocs, alice, 'shareDoc', { docId: extra.id, version: 1 })).body.shareId;
  assert.equal((await put(handleWorkspace, alice, 'deleteFile', { app: 'docs', fileId: extra.id })).status, 200);
  assert.equal((await call(handleDocs, anon, 'GET', undefined, `/api/docs?shared=${secondToken}`)).status, 404);
});

test('Holm React Docs build preserves editor/preview and has no access-key login or TextDB API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-docs-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir],
      { timeout: 150_000, maxBuffer: 500_000 });
    const index = readFileSync(join(dir, 'web/docs/index.html'), 'utf8');
    assert.match(index, /\/docs\/assets\/index-/);
    assert.match(index, /Holm Docs: refreshed navigation precache/);
    const rootWorker = readFileSync(join(dir, 'web/sw.js'), 'utf8');
    assert.match(rootWorker, /k\.startsWith\('workdeck-landing-'\)/);
    assert.match(rootWorker, /'\/docs\/', '\/sheets\/', '\/files\/'/);
    // CacheStorage is shared by every service worker on this origin. A root
    // update must preserve Docs' precache and leave Docs navigations alone.
    const listeners = {};
    const deleted = [];
    vm.runInNewContext(rootWorker, {
      self: { location: { origin: 'https://workdeck.test' }, addEventListener: (type, fn) => { listeners[type] = fn; }, clients: { claim: async () => {} } },
      caches: { keys: async () => ['workdeck-landing-v14', 'workdeck-landing-v15', 'workbox-precache-v2', 'static-assets-cache'], delete: async key => { deleted.push(key); } },
      URL,
    });
    await new Promise((resolve, reject) => listeners.activate({ waitUntil: promise => promise.then(resolve, reject) }));
    assert.deepEqual(deleted, ['workdeck-landing-v14', 'workdeck-landing-v15']);
    for (const path of ['/docs/?doc=example', '/docs/assets/index.js', '/sheets/', '/files/']) {
      let intercepted = false;
      listeners.fetch({ request: { url: 'https://workdeck.test' + path, method: 'GET' }, respondWith: () => { intercepted = true; } });
      assert.equal(intercepted, false, `root worker intercepted ${path}`);
    }
    const docsWorker = readFileSync(join(dir, 'web/docs/sw.js'), 'utf8');
    assert.match(docsWorker, /precacheAndRoute/);
    assert.match(docsWorker, /NavigationRoute/);
    assert.doesNotMatch(index, /docs-ecru-one\.vercel|node_modules\/|Enter your Key/);
    const editor = readFileSync(new URL('../docs-src/src/components/DocEditor.jsx', import.meta.url), 'utf8');
    const detail = readFileSync(new URL('../docs-src/src/components/DocDetailView.jsx', import.meta.url), 'utf8');
    assert.ok(editor.includes('MDEditor'));
    assert.ok(detail.includes('onUpdateDoc'));
    assert.ok(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8').includes("docs: 'doc'"));
    const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
    vm.runInNewContext(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), { window, URL, URLSearchParams });
    const href = window.WDLinks.url('docs', 'record_abcdef123');
    assert.equal(href, '/docs/?doc=record_abcdef123');
    assert.equal(window.WDLinks.parseHref(href).id, 'record_abcdef123');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
