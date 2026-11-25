import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { handleSheets } from '../holm/sheets/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';
import { handleCalendar } from '../holm/calendar/api.js';

function fixture() {
  const members = new Map(); let seq = 0;
  const globalRows = new Map(), clone = obj => structuredClone(obj);
  function realm(rows) {
    const col = name => { if (!rows.has(name)) rows.set(name, new Map()); return rows.get(name); };
    const ds = {
      find: (name, where = {}, opts = {}) => {
        const records = [...col(name).values()].filter(rec => Object.entries(where).every(([k, v]) => rec[k] === v));
        return (opts.order === 'desc' ? records.reverse() : records).slice(0, opts.limit || Infinity).map(clone);
      },
      findOne: (name, where) => clone(col(name).get(typeof where === 'string' ? where : where.id) || null),
      count: name => col(name).size,
      insert: (name, rec) => { const id = `record_${++seq}_abcxyz`; col(name).set(id, clone({ ...rec, id })); return id; },
      update: (name, where, patch) => col(name).set(where.id, clone({ ...col(name).get(where.id), ...patch.$set })),
      delete: (name, where) => col(name).delete(where.id), transaction: fn => fn(ds),
    };
    return ds;
  }
  const sharedDS = realm(globalRows);
  function member(id) {
    if (!members.has(id)) members.set(id, { rows: new Map(), prefs: new Map() });
    const { rows, prefs } = members.get(id);
    return { holm: { auth: { getMember: () => ({ id }) }, app: {
      ds: sharedDS, member: { ds: realm(rows), kv: {
        get: key => clone(prefs.get(key)), set: (key, value) => prefs.set(key, clone(value)),
      } },
    } } };
  }
  const anon = { holm: { auth: { getMember: () => null }, app: { ds: sharedDS } } };
  async function call(handler, env, method = 'GET', body, path, origin = 'https://workdeck.test') {
    const route = path || (handler === handleSheets ? '/api/users' : handler === handleWorkspace ? '/api/workdeck' : '/api/calendar');
    const response = await handler(new Request('https://workdeck.test' + route, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: response.status, body: await response.json() };
  }
  const put = (handler, env, action, data, origin) => call(handler, env, 'PUT', { action, data }, undefined, origin);
  return { member, anon, call, put };
}

test('Sheets metadata, Univer body and thumbnail remain private with version checks', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await call(handleSheets, anon)).status, 401);
  assert.equal((await put(handleSheets, alice, 'createSheet', {}, 'https://evil.test')).status, 403);
  assert.equal((await call(handleSheets, alice, 'PUT', { hash: 'bob', action: 'createSheet', data: {} })).status, 400);
  const result = await put(handleWorkspace, alice, 'createSheet', {});
  assert.equal(result.status, 200);
  const sheet = result.body.data.sheets[0];
  assert.equal(sheet.version, 1);
  assert.equal(sheet.data, undefined);
  assert.deepEqual((await call(handleSheets, bob)).body.data.sheets, []);
  assert.equal((await call(handleSheets, bob, 'GET', undefined, `/api/users?sheet=${sheet.id}`)).status, 404);
  const body = (await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${sheet.id}`)).body.data;
  assert.equal(body.id, `wb_${sheet.id}`);
  assert.equal(Object.keys(body.sheets).length, 1);
  body.sheets[body.sheetOrder[0]].cellData = { 0: { 0: { v: 'Budget' } } };
  const updated = await put(handleSheets, alice, 'updateSheet', { sheetId: sheet.id, version: 1,
    sheetData: { name: 'Budget', data: body, thumbnail: 'data:image/png;base64,YWJj' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.sheets[0].name, 'Budget');
  assert.equal(updated.body.data.sheets[0].data, undefined);
  assert.equal(updated.body.data.sheets[0].thumbRef, 1);
  assert.equal((await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${sheet.id}`)).body.data.sheets[body.sheetOrder[0]].cellData[0][0].v, 'Budget');
  assert.equal((await call(handleSheets, alice, 'GET', undefined, `/api/users?thumbs=${sheet.id}`)).body.thumbnails[sheet.id], 'data:image/png;base64,YWJj');
  assert.deepEqual((await call(handleSheets, bob, 'GET', undefined, `/api/users?thumbs=${sheet.id}`)).body.thumbnails, {});
  assert.equal((await put(handleSheets, alice, 'updateSheet', { sheetId: sheet.id, version: 1,
    sheetData: { name: 'Stale' } })).status, 409);
  assert.equal((await put(handleSheets, bob, 'updateSheet', { sheetId: sheet.id, version: 1,
    sheetData: { name: 'Intrusion' } })).status, 404);
  assert.equal((await put(handleSheets, alice, 'updateSheet', { sheetId: sheet.id, version: 2,
    sheetData: { name: 'Renamed without touching body' } })).status, 200);
  assert.equal((await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${sheet.id}`)).body.data.sheets[body.sheetOrder[0]].cellData[0][0].v, 'Budget');
});

test('Sheets public read-only share snapshots refresh and revoke on deletion', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  const sheet = (await put(handleSheets, alice, 'createSheet', {})).body.sheet;
  assert.equal((await call(handleSheets, anon, 'GET', undefined, '/api/users?shared=invalid')).status, 404);
  assert.equal((await put(handleSheets, bob, 'shareSheet', { sheetId: sheet.id, version: 1 })).status, 404);
  const first = await put(handleSheets, alice, 'shareSheet', { sheetId: sheet.id, version: 1 });
  assert.equal(first.status, 200);
  const token = first.body.shareId;
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(first.body.shareUrl, `https://workdeck.test/sheets/shared.html?shared=${token}`);
  const publicSheet = await call(handleSheets, anon, 'GET', undefined, `/api/users?shared=${token}`);
  assert.equal(publicSheet.status, 200);
  assert.ok(publicSheet.body.sheet.data.sheets);
  for (const privateField of ['sharedId', 'tagId', 'version', 'hash', 'memberId'])
    assert.equal(publicSheet.body.sheet[privateField], undefined);
  assert.equal((await put(handleSheets, anon, 'updateSheet', { sheetId: sheet.id, version: 2, sheetData: { name: 'No' } })).status, 401);
  assert.equal((await put(handleSheets, alice, 'updateSheet', { sheetId: sheet.id, version: 2,
    sheetData: { name: 'Published name' } })).status, 200);
  assert.equal((await call(handleSheets, anon, 'GET', undefined, `/api/users?shared=${token}`)).body.sheet.name, 'Published name');
  const second = await put(handleSheets, alice, 'shareSheet', { sheetId: sheet.id, version: 3 });
  assert.equal(second.body.alreadyShared, true);
  assert.equal(second.body.shareId, token);
  assert.equal((await put(handleSheets, alice, 'deleteSheet', { sheetId: sheet.id, version: 3 })).status, 200);
  assert.equal((await call(handleSheets, anon, 'GET', undefined, `/api/users?shared=${token}`)).status, 404);
  assert.equal((await call(handleSheets, alice)).body.data.sheets.length, 0);
});

test('Sheets suite tags cascade body/thumb/share cleanup; Calendar can link only owned sheets', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  const sheet = (await put(handleSheets, alice, 'createSheet', {})).body.sheet;
  const otherSheet = (await put(handleSheets, bob, 'createSheet', {})).body.sheet;
  const cal = (await put(handleCalendar, alice, 'createCalendar', { name: 'Personal' })).body.calendar;
  const start = '2027-01-05T09:00:00.000Z', end = '2027-01-05T10:00:00.000Z';
  const record = links => ({ calId: cal.id, title: 'Finance', description: '', location: '',
    allDay: false, start, end, links });
  assert.equal((await put(handleCalendar, alice, 'createEvent', { event: record([
    { app: 'sheets', id: sheet.id, name: 'Budget' },
  ]) })).status, 200);
  assert.equal((await put(handleCalendar, alice, 'createEvent', { event: record([
    { app: 'sheets', id: otherSheet.id, name: 'Private' },
  ]) })).status, 400);
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Finance', color: '#224466' })).body.data.tags[0];
  assert.equal((await put(handleWorkspace, alice, 'setFileTag', { app: 'sheets', fileId: sheet.id, tagId: tag.id })).status, 200);
  assert.equal((await put(handleWorkspace, bob, 'recordOpen', { app: 'sheets', fileId: sheet.id })).status, 404);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'sheets', fileId: sheet.id })).status, 200);
  const version = (await call(handleSheets, alice)).body.data.sheets[0].version;
  const saved = await put(handleSheets, alice, 'updateSheet', { sheetId: sheet.id, version,
    sheetData: { thumbnail: 'data:image/jpeg;base64,YWJj' } });
  assert.equal(saved.status, 200);
  const shareVersion = saved.body.data.sheets[0].version;
  const token = (await put(handleSheets, alice, 'shareSheet', { sheetId: sheet.id, version: shareVersion })).body.shareId;
  assert.equal((await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id })).status, 200);
  assert.equal((await call(handleSheets, anon, 'GET', undefined, `/api/users?shared=${token}`)).status, 404);
  assert.equal((await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${sheet.id}`)).status, 404);
  assert.deepEqual((await call(handleSheets, alice, 'GET', undefined, `/api/users?thumbs=${sheet.id}`)).body.thumbnails, {});
  assert.equal((await call(handleWorkspace, alice)).body.data.settings.lastOpened[sheet.id], undefined);
});

test('Sheets browser adapter loads metadata and a separate workbook body without treating the body as a sheet list', async () => {
  const { member, put } = fixture();
  const owner = member('owner');
  const sheet = (await put(handleSheets, owner, 'createSheet', {})).body.sheet;
  const window = {};
  const fetch = async (path, options = {}) => {
    const req = new Request('https://workdeck.test' + path, {
      ...options,
      headers: { ...options.headers, ...(options.method === 'PUT' ? { Origin: 'https://workdeck.test' } : {}) },
    });
    return handleSheets(req, owner);
  };
  vm.runInNewContext(readFileSync(new URL('../holm/sheets/storage.js', import.meta.url), 'utf8') +
    '\nwindow.sheetsStorage = sheetsStorage;', { window, fetch, console, location: { assign() {} }, URLSearchParams });
  const result = await window.sheetsStorage.getSpreadsheet(sheet.id);
  assert.equal(result.id, sheet.id);
  assert.equal(result.data.id, `wb_${sheet.id}`);
  assert.equal(window.sheetsStorage.versions.get(sheet.id), 1);
});

test('Holm Sheets ships same Univer UI, new member auth and reload-safe links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-sheets-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir],
      { timeout: 150_000, maxBuffer: 500_000 });
    for (const page of ['index.html', 'editor.html', 'shared.html']) {
      const html = readFileSync(join(dir, 'web/sheets', page), 'utf8');
      if (page !== 'index.html') assert.match(html, /@univerjs\/presets@0\.25\.1/);
      if (page !== 'shared.html') assert.doesNotMatch(html, /Your Access Key|View My Key|Delete Account|sheets_user_hash|sessionStorage/);
    }
    assert.equal(readFileSync(join(dir, 'web/sheets/styles.css'), 'utf8'),
      readFileSync(new URL('../sheets/styles.css', import.meta.url), 'utf8'));
    assert.equal(readFileSync(join(dir, 'web/sheets/home.css'), 'utf8'),
      readFileSync(new URL('../sheets/home.css', import.meta.url), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(dir, 'web/sheets/manifest.json'), 'utf8'));
    assert.equal(manifest.theme_color, '#22c55e');
    assert.deepEqual(manifest.icons.map(icon => icon.src),
      ['/icons/sheets192.png', '/icons/sheetspwa512.png']);
    for (const icon of manifest.icons) assert.equal(icon.purpose, 'any');
    assert.deepEqual(readFileSync(join(dir, 'web/icons/sheetspwa512.png')),
      readFileSync(new URL('../holm/icons/sheets512.png', import.meta.url)));
    assert.deepEqual(readFileSync(join(dir, 'web/sheets/icons/icon-512x512.png')),
      readFileSync(new URL('../holm/icons/sheets512.png', import.meta.url)));
    for (const filename of ['icon-192x192.png', 'apple-touch-icon.png', 'favicon-32x32.png']) {
      assert.deepEqual(readFileSync(join(dir, 'web/sheets/icons', filename)),
        readFileSync(new URL('../sheets/icons/' + filename, import.meta.url)));
    }
    assert.match(readFileSync(join(dir, 'web/sheets/service-worker.js'), 'utf8'), /sheets-static-holm-v3/);
    const editor = readFileSync(join(dir, 'web/sheets/editor.html'), 'utf8');
    assert.match(editor, /src="\/sheets\/js\/vendor-xlsx\.js"/);
    const storage = readFileSync(join(dir, 'web/sheets/js/storage.js'), 'utf8');
    assert.doesNotMatch(storage, /sessionStorage|hash:|userHash|userKey/);
    assert.ok(readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8').includes("['todo', 'kanban', 'minutes', 'calendar', 'docs', 'sheets', 'forms', 'slides', 'draw', 'filebox', 'blog']"));
    const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
    vm.runInNewContext(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), { window, URL, URLSearchParams });
    const link = window.WDLinks.url('sheets', 'record_abcdef123');
    assert.equal(link, '/sheets/editor.html?id=record_abcdef123');
    assert.equal(window.WDLinks.parseHref(link).id, 'record_abcdef123');
    assert.ok(readFileSync(join(dir, 'web/sheets/service-worker.js'), 'utf8').includes("name.startsWith('sheets-')"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
