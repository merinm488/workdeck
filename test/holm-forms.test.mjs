import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { handleForms } from '../holm/forms/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';
import { handleSheets } from '../holm/sheets/api.js';
import { handleCalendar } from '../holm/calendar/api.js';

function fixture() {
  const members = new Map(), globalRows = new Map(), globalPrefs = new Map();
  let counter = 0;
  const clone = obj => structuredClone(obj);
  function realm(rows) {
    const col = name => { if (!rows.has(name)) rows.set(name, new Map()); return rows.get(name); };
    const ds = {
      find: (name, query = {}, opts = {}) => {
        const entries = [...col(name).values()].filter(row => Object.entries(query).every(([key, value]) => row[key] === value));
        return (opts.order === 'desc' ? entries.reverse() : entries).slice(0, opts.limit || Infinity).map(clone);
      },
      findOne: (name, selector) => clone(col(name).get(typeof selector === 'string' ? selector : selector.id) || null),
      count: name => col(name).size,
      insert: (name, record) => { const id = `record_${++counter}_abcxyz`; col(name).set(id, clone({ ...record, id })); return id; },
      update: (name, query, update) => col(name).set(query.id, clone({ ...col(name).get(query.id), ...update.$set })),
      delete: (name, query) => col(name).delete(query.id), transaction: fn => fn(ds),
    };
    return ds;
  }
  const shared = realm(globalRows);
  const globalKV = { increment: key => { const next = (globalPrefs.get(key) || 0) + 1; globalPrefs.set(key, next); return next; } };
  function member(id) {
    if (!members.has(id)) members.set(id, { rows: new Map(), prefs: new Map() });
    const { rows, prefs } = members.get(id);
    return { holm: { auth: { getMember: () => ({ id }) }, app: {
      ds: shared, kv: globalKV, member: { ds: realm(rows), kv: {
        get: key => clone(prefs.get(key)), set: (key, value) => prefs.set(key, clone(value)),
      } },
    } } };
  }
  const anon = { holm: { auth: { getMember: () => null }, app: { ds: shared, kv: globalKV } } };
  async function call(handler, env, method = 'GET', body, path, origin = 'https://workdeck.test') {
    const route = path || (handler === handleForms ? '/api/forms' : handler === handleSheets ? '/api/users' :
      handler === handleCalendar ? '/api/calendar' : '/api/workdeck');
    const res = await handler(new Request('https://workdeck.test' + route, { method,
      headers: body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: res.status, body: await res.json() };
  }
  const put = (handler, env, action, data, origin) => call(handler, env, 'PUT', { action, data }, undefined, origin);
  const postResponse = (env, shareId, data, origin) => call(handleForms, env, 'POST', {
    action: 'submitResponse', shareId, data: { response: { data, meta: { userAgent: 'Test Agent' } } },
  }, undefined, origin);
  return { member, anon, call, put, postResponse, globalPrefs };
}
const fields = [
  { type: 'textfield', key: 'name', label: 'Your name' },
  { type: 'select', key: 'color', label: 'Color', values: [{ value: 'red', label: 'Red' }] },
  { type: 'checkbox', key: 'approve', label: 'Approved?' },
  { type: 'number', key: 'qty', label: 'Quantity' },
  { type: 'button', key: 'submit', label: 'Submit' },
];

test('Forms owner data is private, anonymous visitor sees questions only and can submit responses', async () => {
  const { member, anon, put, call, postResponse, globalPrefs } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await call(handleForms, anon)).status, 401);
  assert.equal((await put(handleForms, alice, 'updateSettings', { settings: { theme: 'dark' } }, 'https://evil.test')).status, 403);
  assert.equal((await call(handleForms, alice, 'PUT', { hash: 'bob', action: 'updateSettings', data: { settings: {} } })).status, 400);
  const form = (await put(handleWorkspace, alice, 'createForm', {})).body.data.forms[0];
  assert.equal(form.version, 1);
  assert.deepEqual((await call(handleForms, bob)).body.data.forms, []);
  assert.equal((await put(handleForms, bob, 'updateForm', { formId: form.id, version: 1,
    formData: { name: 'Stolen', components: fields } })).status, 404);
  const saved = await put(handleForms, alice, 'updateForm', { formId: form.id, version: 1,
    formData: { name: 'Survey', display: 'form', components: fields } });
  assert.equal(saved.status, 200);
  assert.equal((await put(handleForms, alice, 'updateForm', { formId: form.id, version: 1,
    formData: { name: 'Stale', components: fields } })).status, 409);
  const shared = await put(handleForms, alice, 'shareForm', { formId: form.id, version: 2 });
  assert.equal(shared.status, 200);
  assert.match(shared.body.shareId, /^[0-9a-f]{64}$/);
  assert.equal(shared.body.shareUrl, `https://workdeck.test/forms/shared.html?shared=${shared.body.shareId}`);
  assert.equal((await call(handleForms, anon, 'GET', undefined, '/api/forms?shared=invalid')).status, 404);
  const publicView = await call(handleForms, anon, 'GET', undefined, `/api/forms?shared=${shared.body.shareId}`);
  assert.equal(publicView.status, 200);
  assert.equal(publicView.body.form.name, 'Survey');
  for (const key of ['responses', 'sharedId', 'linkedSheet', 'version', 'memberId', 'hash'])
    assert.equal(publicView.body.form[key], undefined);
  assert.equal(publicView.body.responses, undefined);
  assert.equal((await postResponse(anon, shared.body.shareId, { name: 'Wrong origin' }, 'https://evil.test')).status, 403);
  assert.equal((await postResponse(anon, '1'.repeat(64), { name: 'Unknown' })).status, 404);
  assert.equal(globalPrefs.size, 0); // Invalid tokens cannot exhaust the global KV budget.
  const posted = await postResponse(anon, shared.body.shareId, { name: 'Kim', color: 'red', approve: true, qty: 12 });
  assert.equal(posted.status, 201);
  const privateResult = await put(handleForms, alice, 'getResponses', { formId: form.id });
  assert.equal(privateResult.body.responses.length, 1);
  assert.equal(privateResult.body.responses[0].data.name, 'Kim');
  assert.ok(privateResult.body.responses[0].id);
  assert.ok(privateResult.body.responses[0].submittedAt);
  assert.equal((await put(handleForms, bob, 'getResponses', { formId: form.id })).status, 404);
  assert.equal((await put(handleForms, anon, 'getResponses', { formId: form.id })).status, 401);
  assert.equal((await call(handleForms, anon, 'GET', undefined, `/api/forms?shared=${shared.body.shareId}`)).body.responses, undefined);
  const edited = await put(handleForms, alice, 'updateForm', { formId: form.id, version: 3,
    formData: { name: 'Survey 2', components: fields } });
  assert.equal(edited.status, 200);
  assert.equal((await call(handleForms, anon, 'GET', undefined, `/api/forms?shared=${shared.body.shareId}`)).body.form.name, 'Survey 2');
  assert.equal((await put(handleForms, alice, 'deleteResponses', { formId: form.id })).status, 200);
  assert.deepEqual((await put(handleForms, alice, 'getResponses', { formId: form.id })).body.responses, []);
});

test('Forms link to Sheets backfills, syncs once, appends new questions and preserves manual rows', async () => {
  const { member, anon, put, call, postResponse } = fixture();
  const alice = member('alice');
  const form = (await put(handleWorkspace, alice, 'createForm', {})).body.data.forms[0];
  const saved = await put(handleForms, alice, 'updateForm', { formId: form.id, version: 1,
    formData: { name: 'Numbers', components: fields } });
  assert.equal(saved.status, 200);
  const token = (await put(handleForms, alice, 'shareForm', { formId: form.id, version: 2 })).body.shareId;
  await postResponse(anon, token, { name: 'Sam', color: 'red', approve: true, qty: 5 });
  const linked = await put(handleForms, alice, 'linkSheet', { formId: form.id });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.alreadyLinked, false);
  const sheetId = linked.body.sheetId;
  assert.equal(linked.body.sheetUrl, `https://workdeck.test/sheets/editor.html?id=${sheetId}`);
  const body = (await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${sheetId}`)).body.data;
  const tab = body.sheets[body.sheetOrder[0]];
  assert.equal(tab.cellData[0][0].v, 'Timestamp');
  assert.equal(tab.cellData[0][2].v, 'Color');
  assert.equal(tab.cellData[1][1].v, 'Sam');
  assert.equal(tab.cellData[1][2].v, 'Red');
  assert.equal(tab.cellData[1][3].v, 'Yes');
  assert.deepEqual(tab.cellData[1][4], { v: 5, t: 2 });
  const idempotent = await put(handleForms, alice, 'linkSheet', { formId: form.id });
  assert.equal(idempotent.body.alreadyLinked, true);
  const repeat = await put(handleForms, alice, 'getResponses', { formId: form.id });
  assert.equal(repeat.body.linkedSheet.syncedResponseIds.length, 1);
  const manuallyEdited = (await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${sheetId}`)).body.data;
  manuallyEdited.sheets[manuallyEdited.sheetOrder[0]].cellData['8'] = { 1: { v: 'Manual entry', t: 1 } };
  const meta = (await call(handleSheets, alice)).body.data.sheets.find(s => s.id === sheetId);
  assert.equal((await put(handleSheets, alice, 'updateSheet', { sheetId, version: meta.version, sheetData: { data: manuallyEdited } })).status, 200);
  await postResponse(anon, token, { name: 'Riley', color: 'red', approve: false, qty: 7 });
  const refreshed = await put(handleForms, alice, 'getResponses', { formId: form.id });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.responses.length, 2);
  assert.equal(refreshed.body.linkedSheet.syncedResponseIds.length, 2);
  let grid = (await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${sheetId}`)).body.data.sheets[body.sheetOrder[0]].cellData;
  assert.equal(grid[8][1].v, 'Manual entry');
  assert.equal(grid[9][1].v, 'Riley');
  assert.equal(grid[9][3].v, 'No');
  const freshQuestion = [...fields, { type: 'textarea', key: 'why', label: 'Why?' }];
  const current = (await call(handleForms, alice)).body.data.forms[0];
  assert.equal((await put(handleForms, alice, 'updateForm', { formId: form.id, version: current.version,
    formData: { name: 'Numbers', components: freshQuestion } })).status, 200);
  await put(handleForms, alice, 'getResponses', { formId: form.id });
  grid = (await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${sheetId}`)).body.data.sheets[body.sheetOrder[0]].cellData;
  assert.equal(grid[0][5].v, 'Why?');
  assert.equal((await put(handleForms, alice, 'unlinkSheet', { formId: form.id })).status, 200);
  assert.equal((await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${sheetId}`)).status, 200);
  assert.equal((await put(handleForms, alice, 'getResponses', { formId: form.id })).body.linkedSheet, null);
});

test('Dashboard tags, rename and delete revoke public Forms and keep Sheets', async () => {
  const { member, anon, call, put, postResponse } = fixture();
  const alice = member('alice'), bob = member('bob');
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Clients', color: '#3388bb' })).body.data.tags[0];
  const form = (await put(handleWorkspace, alice, 'createForm', { tagId: tag.id })).body.data.forms[0];
  const token = (await put(handleForms, alice, 'shareForm', { formId: form.id, version: 1 })).body.shareId;
  await postResponse(anon, token, { name: 'A' });
  const linked = await put(handleForms, alice, 'linkSheet', { formId: form.id });
  assert.equal(linked.status, 200);
  assert.equal((await put(handleWorkspace, bob, 'recordOpen', { app: 'forms', fileId: form.id })).status, 404);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'forms', fileId: form.id })).status, 200);
  assert.equal((await put(handleWorkspace, alice, 'renameFile', { app: 'forms', fileId: form.id, name: 'Updated' })).status, 200);
  assert.equal((await call(handleForms, anon, 'GET', undefined, `/api/forms?shared=${token}`)).body.form.name, 'Updated');
  const deleted = await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id });
  assert.deepEqual(deleted.body.data.forms, []);
  assert.equal(deleted.body.data.settings.lastOpened[form.id], undefined);
  assert.equal((await call(handleForms, anon, 'GET', undefined, `/api/forms?shared=${token}`)).status, 404);
  assert.equal((await call(handleSheets, alice, 'GET', undefined, `/api/users?sheet=${linked.body.sheetId}`)).status, 200);
});

test('Forms browser adapter preserves the form schema when home renames only its title', async () => {
  const { member, put } = fixture();
  const alice = member('alice');
  const created = (await put(handleWorkspace, alice, 'createForm', {})).body.data.forms[0];
  const prepared = await put(handleForms, alice, 'updateForm', { formId: created.id, version: 1,
    formData: { name: 'Original', components: fields } });
  assert.equal(prepared.status, 200);
  const window = {};
  const fetch = (path, options = {}) => handleForms(new Request('https://workdeck.test' + path, {
    ...options, headers: { ...options.headers, ...(options.method === 'PUT' ? { Origin: 'https://workdeck.test' } : {}) },
  }), alice);
  vm.runInNewContext(readFileSync(new URL('../holm/forms/storage.js', import.meta.url), 'utf8') +
    '\nwindow.formsStorage = formsStorage;', { window, fetch, console, location: { assign() {} }, alert() {} });
  const adapter = window.formsStorage;
  assert.equal((await adapter.getForm(created.id)).components.length, fields.length);
  assert.equal(await adapter.saveForm(created.id, { name: 'Renamed from home' }), true);
  const updated = await adapter.getForm(created.id);
  assert.equal(updated.name, 'Renamed from home');
  assert.equal(updated.components.length, fields.length);
  assert.equal(updated.version, 3);
});

test('Holm Forms preserves form-js builder/viewer, responses UI and removes access key flows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-forms-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir],
      { timeout: 150_000, maxBuffer: 500_000 });
    for (const page of ['index.html', 'editor.html', 'shared.html']) {
      const html = readFileSync(join(dir, 'web/forms', page), 'utf8');
      if (page === 'editor.html') for (const marker of ['form-editor.umd.js', 'chart.umd.min.js',
        'tabulator.min.js', 'id="tabResponses"', 'id="responsesTable"', 'id="shareModal"']) assert.ok(html.includes(marker));
      if (page === 'shared.html') assert.match(html, /form-viewer\.umd\.js/);
      if (page !== 'shared.html') assert.doesNotMatch(html, /Your Access Key|View My Key|Delete Account|forms_user_hash|sessionStorage/);
    }
    assert.equal(readFileSync(join(dir, 'web/forms/styles.css'), 'utf8'),
      readFileSync(new URL('../forms/styles.css', import.meta.url), 'utf8'));
    const ownerStorage = readFileSync(join(dir, 'web/forms/js/storage.js'), 'utf8');
    assert.doesNotMatch(ownerStorage, /sessionStorage|hash:|userHash|userKey/);
    assert.ok(readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8').includes("['todo', 'kanban', 'minutes', 'calendar', 'docs', 'sheets', 'forms', 'slides', 'draw', 'filebox', 'blog']"));
    const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
    vm.runInNewContext(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), { window, URL, URLSearchParams });
    const href = window.WDLinks.url('forms', 'record_abcdef123');
    assert.equal(href, '/forms/editor.html?id=record_abcdef123');
    assert.equal(window.WDLinks.parseHref(href).id, 'record_abcdef123');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
