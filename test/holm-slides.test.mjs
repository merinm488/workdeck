import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { handleSlides } from '../holm/slides/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';
import { handleCalendar } from '../holm/calendar/api.js';

function fixture() {
  const stores = new Map(), all = new Map(); let seq = 0;
  const clone = obj => structuredClone(obj);
  function realm(rows) {
    const col = name => { if (!rows.has(name)) rows.set(name, new Map()); return rows.get(name); };
    const ds = {
      find: (name, query = {}, opts = {}) => {
        const entries = [...col(name).values()].filter(row => Object.entries(query).every(([k, v]) => row[k] === v));
        return (opts.order === 'desc' ? entries.reverse() : entries).slice(0, opts.limit || Infinity).map(clone);
      },
      findOne: (name, id) => clone(col(name).get(typeof id === 'string' ? id : id.id) || null),
      count: name => col(name).size,
      insert: (name, record) => { const id = `record_${++seq}_abcxyz`; col(name).set(id, clone({ ...record, id })); return id; },
      update: (name, where, patch) => col(name).set(where.id, clone({ ...col(name).get(where.id), ...patch.$set })),
      delete: (name, where) => col(name).delete(where.id), transaction: fn => fn(ds),
    };
    return ds;
  }
  const publicDS = realm(all);
  function member(id) {
    if (!stores.has(id)) stores.set(id, { rows: new Map(), prefs: new Map() });
    const { rows, prefs } = stores.get(id);
    return { holm: { auth: { getMember: () => ({ id }) }, app: { ds: publicDS,
      member: { ds: realm(rows), kv: {
        get: key => clone(prefs.get(key)), set: (key, value) => prefs.set(key, clone(value)),
      } },
    } } };
  }
  const anon = { holm: { auth: { getMember: () => null }, app: { ds: publicDS } } };
  async function call(handler, env, method = 'GET', body, path, origin = 'https://workdeck.test') {
    const route = path || (handler === handleSlides ? '/api/slides' :
      handler === handleWorkspace ? '/api/workdeck' : '/api/calendar');
    const response = await handler(new Request('https://workdeck.test' + route, { method,
      headers: body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: response.status, body: await response.json() };
  }
  const put = (handler, env, action, data, origin) => call(handler, env, 'PUT', { action, data }, undefined, origin);
  return { member, anon, call, put };
}

test('Slides Fabric JSON and tags stay member-private; stale edits cannot overwrite a deck', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await call(handleSlides, anon)).status, 401);
  assert.equal((await put(handleSlides, alice, 'updateSettings', { settings: { theme: 'light' } }, 'https://evil.test')).status, 403);
  assert.equal((await call(handleSlides, alice, 'PUT', { hash: 'bob', action: 'updateSettings', data: {} })).status, 400);
  const deck = (await put(handleWorkspace, alice, 'createDeck', {})).body.data.slides[0];
  assert.equal(deck.version, 1);
  assert.deepEqual(deck.slides, [{ id: 's1', name: 'Slide 1', background: '#ffffff', objects: [] }]);
  assert.deepEqual((await call(handleSlides, bob)).body.data.slides, []);
  assert.equal((await put(handleSlides, bob, 'updateDeck', {
    deckId: deck.id, version: 1, deckData: { name: 'Stolen' },
  })).status, 404);
  const objects = [{ type: 'Textbox', text: 'Welcome', left: 80, top: 100, fill: '#abcdef' },
    { type: 'Rect', width: 200, height: 60, left: 90, top: 50 }];
  const slides = [{ id: 's1', name: 'Opening', background: '#ffffff', objects },
    { id: 's2', name: 'Closing', background: '#000000', objects: [] }];
  const updated = await put(handleSlides, alice, 'updateDeck', {
    deckId: deck.id, version: 1, deckData: { name: 'Launch', slides },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.data.slides[0].slides, slides);
  assert.equal(updated.body.data.slides[0].version, 2);
  assert.equal((await put(handleSlides, alice, 'updateDeck', {
    deckId: deck.id, version: 1, deckData: { name: 'Stale' },
  })).status, 409);
  assert.equal((await put(handleSlides, alice, 'updateDeck', {
    deckId: deck.id, version: 2, deckData: { slides: [{ ...slides[0], id: 's2' }, slides[1]] },
  })).status, 400);
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Pitch', color: '#ff6600' })).body.data.tags[0];
  assert.equal((await put(handleWorkspace, alice, 'setFileTag', { app: 'slides', fileId: deck.id, tagId: tag.id })).status, 200);
  assert.equal((await put(handleWorkspace, bob, 'recordOpen', { app: 'slides', fileId: deck.id })).status, 404);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'slides', fileId: deck.id })).status, 200);
  assert.ok((await call(handleWorkspace, alice)).body.data.settings.lastOpened[deck.id]);
  assert.equal((await call(handleSlides, bob)).body.data.settings.theme, 'dark');
});

test('Slides share snapshots are read-only/public and revoked by owner deletion or tag deletion', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  const deck = (await put(handleWorkspace, alice, 'createDeck', {})).body.data.slides[0];
  assert.equal((await call(handleSlides, anon, 'GET', undefined, '/api/slides?shared=invalid')).status, 404);
  assert.equal((await put(handleSlides, bob, 'shareDeck', { deckId: deck.id, version: 1 })).status, 404);
  const shared = await put(handleSlides, alice, 'shareDeck', { deckId: deck.id, version: 1 });
  assert.equal(shared.status, 200);
  assert.match(shared.body.shareId, /^[0-9a-f]{64}$/);
  assert.equal(shared.body.shareUrl, `https://workdeck.test/slides/shared.html?shared=${shared.body.shareId}`);
  const visible = await call(handleSlides, anon, 'GET', undefined, `/api/slides?shared=${shared.body.shareId}`);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.deck.name, 'Untitled');
  for (const field of ['sharedId', 'tagId', 'version', 'memberId', 'hash']) assert.equal(visible.body.deck[field], undefined);
  assert.equal((await put(handleSlides, anon, 'updateDeck', { deckId: deck.id, version: 2,
    deckData: { name: 'No' } })).status, 401);
  const saved = await put(handleSlides, alice, 'updateDeck', { deckId: deck.id, version: 2,
    deckData: { name: 'Published change', slides: deck.slides } });
  assert.equal(saved.status, 200);
  assert.equal((await call(handleSlides, anon, 'GET', undefined, `/api/slides?shared=${shared.body.shareId}`)).body.deck.name, 'Published change');
  const reused = await put(handleSlides, alice, 'shareDeck', { deckId: deck.id, version: 3 });
  assert.equal(reused.body.alreadyShared, true);
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Folder', color: '#ff6600' })).body.data.tags[0];
  assert.equal((await put(handleWorkspace, alice, 'setFileTag', { app: 'slides', fileId: deck.id, tagId: tag.id })).status, 200);
  assert.equal((await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id })).status, 200);
  assert.equal((await call(handleSlides, anon, 'GET', undefined, `/api/slides?shared=${shared.body.shareId}`)).status, 404);
  const another = (await put(handleWorkspace, alice, 'createDeck', {})).body.data.slides[0];
  const token = (await put(handleSlides, alice, 'shareDeck', { deckId: another.id, version: 1 })).body.shareId;
  assert.equal((await put(handleWorkspace, alice, 'deleteFile', { app: 'slides', fileId: another.id })).status, 200);
  assert.equal((await call(handleSlides, anon, 'GET', undefined, `/api/slides?shared=${token}`)).status, 404);
});

test('Slides owner can link decks in Calendar but another member cannot', async () => {
  const { member, put } = fixture();
  const a = member('alice'), b = member('bob');
  const deck = (await put(handleWorkspace, a, 'createDeck', {})).body.data.slides[0];
  const other = (await put(handleWorkspace, b, 'createDeck', {})).body.data.slides[0];
  const cal = (await put(handleCalendar, a, 'createCalendar', { name: 'Work' })).body.calendar;
  const start = '2027-01-01T00:00:00.000Z';
  const event = id => ({ calId: cal.id, title: 'Review', description: '', location: '',
    allDay: false, start, end: '2027-01-01T01:00:00.000Z', links: [{ app: 'slides', id, name: 'Deck' }] });
  assert.equal((await put(handleCalendar, a, 'createEvent', { event: event(deck.id) })).status, 200);
  assert.equal((await put(handleCalendar, a, 'createEvent', { event: event(other.id) })).status, 400);
});

test('Slides browser adapter preserves deck slides on a title-only home rename', async () => {
  const { member, put, call } = fixture();
  const owner = member('owner');
  const deck = (await put(handleWorkspace, owner, 'createDeck', {})).body.data.slides[0];
  const window = {};
  const fetch = (path, options = {}) => handleSlides(new Request('https://workdeck.test' + path, {
    ...options, headers: { ...options.headers, ...(options.method === 'PUT' ? { Origin: 'https://workdeck.test' } : {}) },
  }), owner);
  vm.runInNewContext(readFileSync(new URL('../holm/slides/storage.js', import.meta.url), 'utf8') +
    '\nwindow.slidesStorage = slidesStorage;', { window, fetch, console, location: { assign() {} }, alert() {} });
  const adapter = window.slidesStorage;
  assert.equal((await adapter.getDeck(deck.id)).slides.length, 1);
  assert.equal(await adapter.saveDeck(deck.id, { name: 'From home' }), true);
  const stored = (await call(handleSlides, owner)).body.data.slides[0];
  assert.equal(stored.name, 'From home');
  assert.equal(stored.slides.length, 1);
  assert.equal(stored.version, 2);
});

test('Holm Slides retains Fabric editor, presentation templates and share viewer without key auth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-slides-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir],
      { timeout: 150_000, maxBuffer: 500_000 });
    const editor = readFileSync(join(dir, 'web/slides/editor.html'), 'utf8');
    const original = readFileSync(new URL('../slides/editor.html', import.meta.url), 'utf8');
    for (const marker of ['fabric@6', 'pptxgenjs@3.12.0', 'id="slideThumbs"',
      'id="slideCanvas"', 'id="templateModal"', 'id="shareModal"']) {
      assert.ok(original.includes(marker), `original missing ${marker}`);
      assert.ok(editor.includes(marker), `Holm missing ${marker}`);
    }
    assert.equal(readFileSync(join(dir, 'web/slides/styles.css'), 'utf8'),
      readFileSync(new URL('../slides/styles.css', import.meta.url), 'utf8'));
    assert.ok(readFileSync(join(dir, 'web/slides/templates/index.json'), 'utf8').includes('templates'));
    assert.match(readFileSync(join(dir, 'web/slides/shared.html'), 'utf8'), /sharedCanvas/);
    for (const name of ['index.html', 'editor.html']) {
      assert.doesNotMatch(readFileSync(join(dir, 'web/slides', name), 'utf8'), /Your Access Key|View My Key|Delete Account|slides_user_hash|sessionStorage/);
    }
    assert.doesNotMatch(readFileSync(join(dir, 'web/slides/js/storage.js'), 'utf8'), /sessionStorage|hash:|userHash|userKey/);
    assert.ok(readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8').includes("['todo', 'kanban', 'minutes', 'calendar', 'docs', 'sheets', 'forms', 'slides', 'draw', 'filebox', 'blog']"));
    const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
    vm.runInNewContext(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), { window, URL, URLSearchParams });
    const href = window.WDLinks.url('slides', 'record_abcdef123');
    assert.equal(href, '/slides/editor.html?id=record_abcdef123');
    assert.equal(window.WDLinks.parseHref(href).id, 'record_abcdef123');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
