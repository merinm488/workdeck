import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { handleFilebox } from '../holm/files/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';
import { handleSheets } from '../holm/sheets/api.js';
import { handleCalendar } from '../holm/calendar/api.js';
import { handleDocs } from '../holm/docs/api.js';

function fixture() {
  let seq = 0; const members = new Map(), globalRows = new Map();
  const clone = obj => structuredClone(obj);
  function realm(rows) {
    const col = name => { if (!rows.has(name)) rows.set(name, new Map()); return rows.get(name); };
    const ds = {
      find: (name, where = {}, opts = {}) => {
        const list = [...col(name).values()].filter(row => Object.entries(where).every(([k, v]) => row[k] === v));
        return (opts.order === 'desc' ? list.reverse() : list).slice(0, opts.limit || Infinity).map(clone);
      },
      findOne: (name, value) => clone(col(name).get(typeof value === 'string' ? value : value.id) || null),
      count: name => col(name).size,
      insert: (name, record) => { const id = `record_${++seq}_abcdef`; col(name).set(id, clone({ ...record, id })); return id; },
      update: (name, where, patch) => col(name).set(where.id, clone({ ...col(name).get(where.id), ...patch.$set })),
      delete: (name, where) => col(name).delete(where.id), transaction: fn => fn(ds),
    };
    return ds;
  }
  const shared = realm(globalRows);
  function member(id) {
    if (!members.has(id)) members.set(id, { rows: new Map(), prefs: new Map() });
    const { rows, prefs } = members.get(id);
    return { holm: { auth: { getMember: () => ({ id }) }, app: { ds: shared,
      member: { ds: realm(rows), kv: {
        get: key => clone(prefs.get(key)), set: (key, value) => prefs.set(key, clone(value)),
      } },
    } } };
  }
  const anon = { holm: { auth: { getMember: () => null }, app: { ds: shared } } };
  async function call(handler, env, method = 'GET', body, path, origin = 'https://workdeck.test') {
    const route = path || (handler === handleFilebox ? '/api/filebox' : handler === handleSheets ? '/api/users' :
      handler === handleCalendar ? '/api/calendar' : handler === handleDocs ? '/api/docs' : '/api/workdeck');
    return handler(new Request('https://workdeck.test' + route, { method,
      headers: body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
  }
  const json = async (...args) => {
    const response = await call(...args);
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const put = (handler, env, action, data, origin) => json(handler, env, 'PUT', { action, data }, undefined, origin);
  const upload = (env, opts) => put(handleFilebox, env, 'uploadFile', {
    name: 'budget.txt', mime: 'text/plain', base64: 'SGVsbG8=', ...opts,
  });
  return { member, anon, call, json, put, upload };
}

test('Files uploads/reads are member-private; no access key, client path, or cache leaks', async () => {
  const { member, anon, call, json, put, upload } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await json(handleFilebox, anon, 'GET', undefined, '/api/filebox?limits=1')).body.limits.maxFileSize, 300 * 1024);
  assert.equal((await json(handleFilebox, anon, 'GET', undefined, '/api/filebox?fileId=record_abc123')).status, 401);
  assert.equal((await upload(alice, { name: 'hi.txt' })).status, 201);
  assert.equal((await json(handleFilebox, alice, 'PUT', { hash: 'bob', action: 'uploadFile', data: {} })).status, 400);
  assert.equal((await json(handleFilebox, alice, 'PUT', { action: 'uploadFile', data: { name: 'No', mime: 'text/plain', base64: 'SGVsbG8=' } }, undefined, 'https://evil.test')).status, 403);
  assert.equal((await upload(alice, { name: 'bad.txt', base64: '@@@=' })).status, 400);
  assert.equal((await upload(alice, { name: 'giant.txt', base64: Buffer.alloc(300 * 1024 + 1, 'a').toString('base64') })).status, 413);
  const tagged = (await put(handleWorkspace, alice, 'createTag', { name: 'Finance', color: '#336699', origin: 'filebox' })).body.data.tags[0];
  const file = (await upload(alice, { name: 'résumé <script>.html', mime: 'text/html',
    base64: Buffer.from('<script>fetch("/api/workdeck")</script>').toString('base64'),
    tags: [tagged.id], thumbnail: 'data:image/png;base64,YWJj', thumbnailCover: true, thumbVer: 2,
    storageKey: 'evil_other_user_path' })).body.file;
  assert.equal(file.tags[0], tagged.id);
  assert.equal(file.storageKey, `file_${file.id}`);
  assert.equal(file.thumbRef, 1);
  assert.equal((await json(handleFilebox, bob, 'GET', undefined, `/api/filebox?fileId=${file.id}`)).status, 404);
  assert.deepEqual((await json(handleSheets, bob, 'GET', undefined, `/api/users?thumbs=${file.id}`)).body.thumbnails, {});
  assert.equal((await json(handleSheets, alice, 'GET', undefined, `/api/users?thumbs=${file.id}`)).body.thumbnails[file.id], 'data:image/png;base64,YWJj');
  const response = await call(handleFilebox, alice, 'GET', undefined, `/api/filebox?fileId=${file.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-type'), 'text/html');
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '<script>fetch("/api/workdeck")</script>');
  assert.equal((await call(handleFilebox, alice, 'GET', undefined, `/api/filebox?fileId=${file.id}&dl=1`)).headers.get('content-disposition').startsWith('attachment'), true);
  assert.equal((await json(handleWorkspace, bob)).body.data.files.length, 0);
});

test('Files retries and post-commit lookups reuse one member-private upload', async () => {
  const { member, anon, json, upload } = fixture();
  const alice = member('alice'), bob = member('bob');
  const uploadId = 'upload_0123456789abcdef';
  const first = await upload(alice, { name: 'once.txt', uploadId });
  const retry = await upload(alice, { name: 'once.txt', uploadId });
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.file.id, first.body.file.id);
  assert.equal((await json(handleWorkspace, alice)).body.data.files.length, 1);
  const path = `/api/filebox?uploadId=${uploadId}`;
  assert.equal((await json(handleFilebox, alice, 'GET', undefined, path)).body.file.id, first.body.file.id);
  assert.equal((await json(handleFilebox, bob, 'GET', undefined, path)).status, 404);
  assert.equal((await json(handleFilebox, anon, 'GET', undefined, path)).status, 401);
  assert.equal((await json(handleFilebox, alice, 'GET', undefined, '/api/filebox?uploadId=bad')).status, 400);
  assert.equal((await upload(alice, { name: 'different.txt', uploadId })).status, 409);
  assert.equal((await upload(alice, { name: 'invalid.txt', uploadId: 'bad' })).status, 400);
});

test('Files nested folders, single tags and destructive folder cascade are owner-scoped', async () => {
  const { member, anon, call, json, put, upload } = fixture();
  const alice = member('alice'), bob = member('bob');
  const folder = (await put(handleWorkspace, alice, 'createFolder', { name: 'Projects', color: '#33aa99' })).body.data.folders[0];
  const child = (await put(handleWorkspace, alice, 'createFolder', { name: 'Reports', parentId: folder.id })).body.data.folders[0];
  assert.equal((await put(handleWorkspace, bob, 'createFolder', { name: 'Stolen', parentId: folder.id })).status, 400);
  assert.equal((await put(handleWorkspace, alice, 'setFolderParent', { folderId: folder.id, parentId: child.id })).status, 400);
  const file = (await upload(alice, { name: 'report.txt', folderId: child.id })).body.file;
  assert.equal((await upload(bob, { name: 'foreign.txt', folderId: child.id })).status, 404);
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Tagged', color: '#113355', origin: 'filebox' })).body.data.tags[0];
  assert.equal(tag.origin, 'filebox');
  const other = (await put(handleWorkspace, alice, 'createTag', { name: 'Other', origin: 'filebox' })).body.data.tags[0];
  assert.equal((await put(handleWorkspace, alice, 'setFileTags', { fileId: file.id, tagIds: [tag.id, other.id] })).status, 400);
  assert.equal((await put(handleWorkspace, alice, 'setFolderTags', { folderId: folder.id, tagIds: [tag.id, other.id] })).status, 400);
  assert.equal((await put(handleWorkspace, alice, 'createFolder', { name: 'Invalid', tags: [tag.id, other.id] })).status, 400);
  assert.equal((await upload(alice, { name: 'invalid.txt', tags: [tag.id, other.id] })).status, 400);
  assert.equal((await put(handleWorkspace, alice, 'setFileTags', { fileId: file.id, tagIds: [tag.id] })).status, 200);
  assert.equal((await put(handleWorkspace, alice, 'setFileTags', { fileId: file.id, tagIds: [other.id] })).body.data.files.find(item => item.id === file.id).tags[0], other.id);
  assert.equal((await put(handleWorkspace, alice, 'setFileTags', { fileId: file.id, tagIds: [tag.id] })).status, 200);
  assert.equal((await put(handleWorkspace, alice, 'setFolderTags', { folderId: folder.id, tagIds: [tag.id] })).status, 200);
  const doc = (await put(handleDocs, alice, 'createDoc', { title: 'Single-tagged', tagId: tag.id })).body.doc;
  const removedTag = await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id });
  assert.ok(removedTag.body.data.files.some(item => item.id === file.id));
  assert.deepEqual(removedTag.body.data.files.find(item => item.id === file.id).tags, []);
  assert.deepEqual(removedTag.body.data.folders.find(item => item.id === folder.id).tags, []);
  assert.equal(removedTag.body.data.docs.some(item => item.id === doc.id), false);
  assert.equal((await call(handleFilebox, alice, 'GET', undefined, `/api/filebox?fileId=${file.id}`)).status, 200);
  assert.equal((await put(handleWorkspace, bob, 'deleteFolder', { folderId: folder.id })).status, 404);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'filebox', fileId: file.id })).status, 200);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'filebox', fileId: folder.id })).status, 200);
  const deleted = await put(handleWorkspace, alice, 'deleteFolder', { folderId: folder.id });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.data.folders, []);
  assert.equal(deleted.body.data.files.some(item => item.id === file.id), false);
  assert.equal(deleted.body.data.settings.lastOpened[file.id], undefined);
  assert.equal(deleted.body.data.settings.lastOpened[folder.id], undefined);
  assert.equal((await json(handleFilebox, alice, 'GET', undefined, `/api/filebox?fileId=${file.id}`)).status, 404);
  assert.equal((await json(handleSheets, alice, 'GET', undefined, `/api/users?thumbs=${file.id}`)).body.thumbnails[file.id], undefined);
});

test('Files links, thumbs and metadata operations work without exposing other accounts', async () => {
  const { member, json, put, upload } = fixture();
  const a = member('a'), b = member('b');
  const first = (await upload(a, { name: 'plan.pdf', mime: 'application/pdf' })).body.file;
  const second = (await upload(b, { name: 'secret.pdf', mime: 'application/pdf' })).body.file;
  const folder = (await put(handleWorkspace, a, 'createFolder', { name: 'Home' })).body.data.folders[0];
  assert.equal((await put(handleWorkspace, a, 'setFileFolder', { fileId: first.id, folderId: folder.id })).status, 200);
  assert.equal((await put(handleWorkspace, a, 'setFileFolder', { fileId: first.id, folderId: second.id })).status, 404);
  assert.equal((await put(handleWorkspace, a, 'setFileThumbnail', { fileId: first.id,
    thumbnail: 'data:image/jpeg;base64,YWJj', thumbnailCover: true, thumbVer: 2 })).status, 200);
  assert.equal((await json(handleSheets, a, 'GET', undefined, `/api/users?thumbs=${first.id}`)).body.thumbnails[first.id], 'data:image/jpeg;base64,YWJj');
  const cal = (await put(handleCalendar, a, 'createCalendar', { name: 'Today' })).body.calendar;
  const event = id => ({ calId: cal.id, title: 'Meet', description: '', location: '',
    allDay: false, start: '2027-01-01T09:00:00.000Z', end: '2027-01-01T10:00:00.000Z',
    links: [{ app: 'filebox', id, name: 'Linked file' }] });
  assert.equal((await put(handleCalendar, a, 'createEvent', { event: event(first.id) })).status, 200);
  assert.equal((await put(handleCalendar, a, 'createEvent', { event: event(second.id) })).status, 400);
  assert.equal((await put(handleWorkspace, a, 'renameFile', { app: 'filebox', fileId: first.id, name: 'final.pdf' })).status, 200);
  assert.equal((await put(handleWorkspace, a, 'deleteFile', { app: 'filebox', fileId: first.id })).status, 200);
  assert.equal((await json(handleSheets, a, 'GET', undefined, `/api/users?thumbs=${first.id}`)).body.thumbnails[first.id], undefined);
  assert.equal((await json(handleFilebox, a, 'GET', undefined, `/api/filebox?fileId=${first.id}`)).status, 404);
});

test('Files uses the shared picker for files/folders and replaces only one tag', async () => {
  const source = readFileSync(new URL('../holm/files/main.js', import.meta.url), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const record = { id: 'file', name: 'report', tags: ['first'] };
  const state = { tags: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }], folders: [] };
  let picker;
  const calls = [];
  const ui = vm.runInNewContext(`${section('function openTagsModal(', 'async function applyRecordTags(')}
    ${section('async function addTagToRecord(', 'async function moveFileToFolder(')}
    ({ openTagsModal, addTagToRecord })`, {
    state, WDTagUI: { editTags: options => { picker = options; } },
    getFile: () => record, getFolder: () => null, getTag: id => state.tags.find(t => t.id === id),
    applyRecordTags: (file, kind, ids) => { calls.push({ kind, ids: Array.from(ids) }); return false; },
  });
  for (const kind of ['file', 'folder']) {
    ui.openTagsModal(record, kind);
    assert.equal(picker.tagId, 'first');
    assert.equal(picker.tags, state.tags, 'same shared tag pool as Workdeck home');
    assert.equal(await picker.onSave('second'), false);
    assert.deepEqual(calls.at(-1), { kind, ids: ['second'] });
    await picker.onSave(null);
    assert.deepEqual(calls.at(-1), { kind, ids: [] });
  }
  await ui.addTagToRecord(record.id, 'first');
  assert.deepEqual(calls.at(-1), { kind: 'file', ids: ['first'] });
});

test('Holm Files retains original manager/viewers but removes key auth and uses reload-safe URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-files-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir],
      { timeout: 150_000, maxBuffer: 500_000 });
    const html = readFileSync(join(dir, 'web/files/index.html'), 'utf8');
    const original = readFileSync(new URL('../files/index.html', import.meta.url), 'utf8');
    for (const marker of ['id="fbGrid"', 'id="fbList"', 'id="fbUploadBtn"', 'id="fbViewer"', 'id="fbTagList"']) {
      assert.ok(original.includes(marker)); assert.ok(html.includes(marker));
    }
    assert.equal(readFileSync(join(dir, 'web/files/styles.css'), 'utf8'),
      readFileSync(new URL('../files/styles.css', import.meta.url), 'utf8'));
    assert.doesNotMatch(html, /View My Key|Your Access Key|filebox_user_hash|sessionStorage|releases\.transloadit/);
    assert.doesNotMatch(html, /id="fbSidebarClose"/);
    assert.match(html, /id="fbSidebarToggle"/);
    assert.match(html, /id="fbSidebarScrim"/);
    assert.match(html, /\/files\/vendor-uppy\.min\.css/);
    assert.match(html, /\/files\/js\/vendor-uppy\.min\.js/);
    assert.equal(readFileSync(join(dir, 'web/files/js/vendor-uppy.min.js'), 'utf8'),
      readFileSync(new URL('../holm/files/vendor-uppy.min.js', import.meta.url), 'utf8'));
    assert.ok(readFileSync(join(dir, 'web/files/js/vendor-esm.js'), 'utf8').includes("'/files/js/pdf.worker.min.mjs'"));
    assert.ok(readFileSync(join(dir, 'web/files/service-worker.js'), 'utf8').includes("key.startsWith('filebox-')"));
    const main = readFileSync(join(dir, 'web/files/js/main.js'), 'utf8');
    const viewer = readFileSync(join(dir, 'web/files/js/viewer.js'), 'utf8');
    assert.doesNotMatch(main, /getFileboxUserHash|sessionStorage|fbViewKeyBtn|fbKeyModal|fbSidebarClose/);
    assert.ok(viewer.includes("params.set('id', fileId)"));
    const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
    vm.runInNewContext(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), { window, URL, URLSearchParams });
    const href = window.WDLinks.url('filebox', 'record_abcdef123');
    assert.equal(href, '/files/?id=record_abcdef123');
    assert.equal(window.WDLinks.parseHref(href).id, 'record_abcdef123');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
