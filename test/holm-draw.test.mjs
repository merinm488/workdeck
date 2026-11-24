import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { handleDraw } from '../holm/draw/api.js';
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
    const route = path || (handler === handleDraw ? '/api/draw' :
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

test('Draw keeps Fabric v7 objects and infinite-canvas viewport member-private with stale-write checks', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await call(handleDraw, anon)).status, 401);
  assert.equal((await put(handleDraw, alice, 'updateSettings', { settings: { theme: 'dark' } }, 'https://evil.test')).status, 403);
  assert.equal((await call(handleDraw, alice, 'PUT', { hash: 'bob', action: 'updateSettings', data: {} })).status, 400);
  const drawing = (await put(handleWorkspace, alice, 'createDrawing', {})).body.data.draws[0];
  assert.equal(drawing.version, 1);
  assert.deepEqual(drawing.viewport, { zoom: 1, panX: 0, panY: 0 });
  assert.deepEqual((await call(handleDraw, bob)).body.data.draws, []);
  assert.equal((await put(handleDraw, bob, 'updateDrawing', { drawingId: drawing.id, version: 1,
    drawingData: { name: 'Stolen' } })).status, 404);
  const objects = [
    { type: 'Textbox', text: 'Linked task', wdRef: { app: 'todo', id: 'task_abcdef1234' }, left: 80, top: 200 },
    { type: 'Line', from: { x: 0, y: 20 }, to: { x: 100, y: 40 }, stroke: '#334455' },
  ];
  const saved = await put(handleDraw, alice, 'updateDrawing', { drawingId: drawing.id, version: 1,
    drawingData: { name: 'Plan', background: '#ffeedd', objects, viewport: { zoom: 2, panX: -500, panY: 150 } } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data.draws[0].objects, objects);
  assert.deepEqual(saved.body.data.draws[0].viewport, { zoom: 2, panX: -500, panY: 150 });
  assert.equal(saved.body.data.draws[0].version, 2);
  assert.equal((await put(handleDraw, alice, 'updateDrawing', { drawingId: drawing.id, version: 1,
    drawingData: { name: 'Stale' } })).status, 409);
  assert.equal((await put(handleDraw, alice, 'updateDrawing', { drawingId: drawing.id, version: 2,
    drawingData: { viewport: { zoom: -3, panX: 0, panY: 0 } } })).status, 400);
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Art', color: '#991122' })).body.data.tags[0];
  assert.equal((await put(handleWorkspace, alice, 'setFileTag', { app: 'draw', fileId: drawing.id, tagId: tag.id })).status, 200);
  assert.equal((await put(handleWorkspace, bob, 'recordOpen', { app: 'draw', fileId: drawing.id })).status, 404);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'draw', fileId: drawing.id })).status, 200);
  assert.ok((await call(handleWorkspace, alice)).body.data.settings.lastOpened[drawing.id]);
});

test('Draw public share has only the read-only snapshot and is revoked on deletion or tag deletion', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  const drawing = (await put(handleWorkspace, alice, 'createDrawing', {})).body.data.draws[0];
  assert.equal((await call(handleDraw, anon, 'GET', undefined, '/api/draw?shared=invalid')).status, 404);
  assert.equal((await put(handleDraw, bob, 'shareDrawing', { drawingId: drawing.id, version: 1 })).status, 404);
  const shared = await put(handleDraw, alice, 'shareDrawing', { drawingId: drawing.id, version: 1 });
  assert.equal(shared.status, 200);
  assert.match(shared.body.shareId, /^[0-9a-f]{64}$/);
  assert.equal(shared.body.shareUrl, `https://workdeck.test/draw/shared.html?shared=${shared.body.shareId}`);
  const visible = await call(handleDraw, anon, 'GET', undefined, `/api/draw?shared=${shared.body.shareId}`);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.drawing.name, 'Untitled Drawing');
  for (const field of ['sharedId', 'tagId', 'version', 'memberId', 'hash']) assert.equal(visible.body.drawing[field], undefined);
  assert.equal((await put(handleDraw, anon, 'updateDrawing', { drawingId: drawing.id, version: 2,
    drawingData: { name: 'No' } })).status, 401);
  const saved = await put(handleDraw, alice, 'updateDrawing', { drawingId: drawing.id, version: 2,
    drawingData: { name: 'New public name', viewport: { zoom: 1, panX: 20, panY: 30 } } });
  assert.equal(saved.status, 200);
  assert.equal((await call(handleDraw, anon, 'GET', undefined, `/api/draw?shared=${shared.body.shareId}`)).body.drawing.name, 'New public name');
  assert.equal((await put(handleDraw, alice, 'shareDrawing', { drawingId: drawing.id, version: 3 })).body.alreadyShared, true);
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Sketches', color: '#ff3300' })).body.data.tags[0];
  assert.equal((await put(handleWorkspace, alice, 'setFileTag', { app: 'draw', fileId: drawing.id, tagId: tag.id })).status, 200);
  assert.equal((await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id })).status, 200);
  assert.equal((await call(handleDraw, anon, 'GET', undefined, `/api/draw?shared=${shared.body.shareId}`)).status, 404);
  const second = (await put(handleWorkspace, alice, 'createDrawing', {})).body.data.draws[0];
  const token = (await put(handleDraw, alice, 'shareDrawing', { drawingId: second.id, version: 1 })).body.shareId;
  assert.equal((await put(handleWorkspace, alice, 'deleteFile', { app: 'draw', fileId: second.id })).status, 200);
  assert.equal((await call(handleDraw, anon, 'GET', undefined, `/api/draw?shared=${token}`)).status, 404);
});

test('Draw is linkable from a member-owned Calendar and not another member', async () => {
  const { member, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  const drawing = (await put(handleWorkspace, alice, 'createDrawing', {})).body.data.draws[0];
  const foreign = (await put(handleWorkspace, bob, 'createDrawing', {})).body.data.draws[0];
  const cal = (await put(handleCalendar, alice, 'createCalendar', { name: 'Art' })).body.calendar;
  const event = id => ({ calId: cal.id, title: 'Sketch', description: '', location: '',
    allDay: false, start: '2027-02-01T09:00:00.000Z', end: '2027-02-01T10:00:00.000Z',
    links: [{ app: 'draw', id, name: 'Canvas' }] });
  assert.equal((await put(handleCalendar, alice, 'createEvent', { event: event(drawing.id) })).status, 200);
  assert.equal((await put(handleCalendar, alice, 'createEvent', { event: event(foreign.id) })).status, 400);
});

test('Draw adapter preserves objects on a title-only home rename', async () => {
  const { member, put, call } = fixture();
  const owner = member('owner');
  const drawing = (await put(handleWorkspace, owner, 'createDrawing', {})).body.data.draws[0];
  const window = {};
  const fetch = (path, options = {}) => handleDraw(new Request('https://workdeck.test' + path, {
    ...options, headers: { ...options.headers, ...(options.method === 'PUT' ? { Origin: 'https://workdeck.test' } : {}) },
  }), owner);
  vm.runInNewContext(readFileSync(new URL('../holm/draw/storage.js', import.meta.url), 'utf8') +
    '\nwindow.drawStorage = drawStorage;', { window, fetch, console, location: { assign() {} }, alert() {} });
  const adapter = window.drawStorage;
  assert.deepEqual((await adapter.getDrawing(drawing.id)).objects, []);
  assert.equal(await adapter.saveDrawing(drawing.id, { name: 'From home' }), true);
  const stored = (await call(handleDraw, owner)).body.data.draws[0];
  assert.equal(stored.name, 'From home');
  assert.deepEqual(stored.objects, []);
  assert.equal(stored.version, 2);
});

test('Holm Draw retains original Fabric canvas/editor/viewer with no legacy key chrome', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-draw-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir],
      { timeout: 150_000, maxBuffer: 500_000 });
    const original = readFileSync(new URL('../draw/editor.html', import.meta.url), 'utf8');
    const html = readFileSync(join(dir, 'web/draw/editor.html'), 'utf8');
    for (const marker of ['fabric@7', 'id="drawCanvas"', 'id="shareModal"', 'id="renamePromptModal"', 'id="canvasColorInput"']) {
      assert.ok(original.includes(marker), `original missing ${marker}`);
      assert.ok(html.includes(marker), `Holm missing ${marker}`);
    }
    assert.equal(readFileSync(join(dir, 'web/draw/styles.css'), 'utf8'),
      readFileSync(new URL('../draw/styles.css', import.meta.url), 'utf8'));
    assert.match(readFileSync(join(dir, 'web/draw/shared.html'), 'utf8'), /sharedCanvas/);
    for (const name of ['index.html', 'editor.html'])
      assert.doesNotMatch(readFileSync(join(dir, 'web/draw', name), 'utf8'), /Your Access Key|View My Key|Delete Account|draw_user_hash|sessionStorage/);
    assert.doesNotMatch(readFileSync(join(dir, 'web/draw/js/storage.js'), 'utf8'), /sessionStorage|hash:|userHash|userKey/);
    assert.ok(readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8').includes("['todo', 'kanban', 'minutes', 'calendar', 'docs', 'sheets', 'forms', 'slides', 'draw', 'filebox', 'blog']"));
    const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
    vm.runInNewContext(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), { window, URL, URLSearchParams });
    const href = window.WDLinks.url('draw', 'record_abcdef123');
    assert.equal(href, '/draw/editor.html?id=record_abcdef123');
    assert.equal(window.WDLinks.parseHref(href).id, 'record_abcdef123');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
