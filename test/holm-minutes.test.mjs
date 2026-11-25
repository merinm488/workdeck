import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { handleMinutes } from '../holm/minutes/api.js';
import { handleTodo } from '../holm/todo/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';

function fixture() {
  const members = new Map();
  let seq = 0;
  const clone = obj => structuredClone(obj);
  function member(id) {
    if (!members.has(id)) members.set(id, { rows: new Map(), prefs: new Map() });
    const { rows, prefs } = members.get(id);
    const col = name => {
      if (!rows.has(name)) rows.set(name, new Map());
      return rows.get(name);
    };
    const ds = {
      find: name => [...col(name).values()].map(clone),
      count: name => col(name).size,
      findOne: (name, where) => clone(col(name).get(typeof where === 'string' ? where : where.id) || null),
      insert: (name, record) => { const key = `record_${++seq}_abcdef`; col(name).set(key, clone({ ...record, id: key })); return key; },
      update: (name, where, patch) => col(name).set(where.id, clone({ ...col(name).get(where.id), ...patch.$set })),
      delete: (name, where) => col(name).delete(where.id), transaction: fn => fn(ds),
    };
    return { holm: { auth: { getMember: () => ({ id }) }, app: { member: {
      ds, kv: { get: key => clone(prefs.get(key)), set: (key, value) => prefs.set(key, clone(value)) },
    } } } };
  }
  const anon = { holm: { auth: { getMember: () => null } } };
  async function call(handler, env, method = 'GET', body, origin = 'https://workdeck.test', path) {
    const pathname = path || (handler === handleTodo ? '/api/todo/lists' : handler === handleWorkspace ? '/api/workdeck' : '/api/minutes');
    const response = await handler(new Request('https://workdeck.test' + pathname, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: response.status, body: await response.json() };
  }
  const put = (handler, env, action, data, origin) => call(handler, env, 'PUT', { action, data }, origin);
  return { member, anon, call, put };
}

const section = { id: 'section123456789', title: 'Planning', points: [
  { id: 'action1234567890', type: 'action', text: 'Send proposal', owner: 'Sam', dueDate: '2027-01-02', notes: '<p>Next steps</p>' },
  { id: 'note12345678901', type: 'discussion', text: 'Review options', notes: '' },
] };

test('Minutes member-only CRUD, revisions, Todo links and finalized/reopen flow', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await call(handleMinutes, anon)).status, 401);
  assert.equal((await put(handleMinutes, alice, 'create', {}, 'https://other.test')).status, 403);
  assert.equal((await call(handleMinutes, alice, 'PUT', { hash: 'bob', action: 'create', data: {} })).status, 400);
  const created = await put(handleMinutes, alice, 'create', { title: 'Meeting' });
  assert.equal(created.status, 200);
  const meeting = created.body.meeting;
  assert.equal((await call(handleMinutes, bob)).body.data.minutes.length, 0);
  assert.equal((await put(handleMinutes, bob, 'save', { ...meeting, agenda: [section] })).status, 404);
  const first = await put(handleMinutes, alice, 'save', { ...meeting, agenda: [section] });
  assert.equal(first.status, 200);
  const point = first.body.meeting.agenda[0].points[0];
  assert.ok(point.todoListId && point.todoTaskId);
  assert.equal(first.body.todo[0].items.length, 1);
  assert.equal(first.body.todo[0].items[0].title, 'Send proposal');
  assert.equal((await put(handleMinutes, alice, 'save', { ...meeting, agenda: [section] })).status, 409);
  const list = first.body.todo[0];
  const completed = await call(handleTodo, alice, 'PUT', { name: list.name, version: list.version,
    items: list.items.map(task => ({ ...task, completed: true })) }, undefined, `/api/todo/lists/${list.id}`);
  assert.equal(completed.status, 200);
  const second = await put(handleMinutes, alice, 'save', { ...first.body.meeting,
    agenda: [{ ...first.body.meeting.agenda[0], points: [{ ...point, text: 'Send final proposal' }, first.body.meeting.agenda[0].points[1]] }] });
  assert.equal(second.status, 200);
  assert.equal(second.body.todo[0].items.length, 1);
  assert.equal(second.body.todo[0].items[0].title, 'Send final proposal');
  assert.equal(second.body.todo[0].items[0].completed, true);
  const final = await put(handleMinutes, alice, 'save', { ...second.body.meeting, state: 'final', approvedBy: 'Sam' });
  assert.equal(final.body.meeting.state, 'final');
  assert.equal((await put(handleMinutes, alice, 'save', { ...final.body.meeting, title: 'Oops' })).status, 400);
  const reopened = await put(handleMinutes, alice, 'save', { ...final.body.meeting, state: 'draft' });
  assert.equal(reopened.body.meeting.approvedBy, '');
  assert.equal(reopened.body.meeting.approvedAt, null);
  assert.equal((await put(handleMinutes, alice, 'delete', { id: meeting.id })).status, 200);
  assert.equal((await call(handleMinutes, alice)).body.data.minutes.length, 0);
  assert.equal((await call(handleTodo, alice)).body.lists.length, 1); // Actions survive deletion.
});

test('Minutes rejects forged task/event links and scrubs Quill HTML', async () => {
  const { member, put, call } = fixture();
  const alice = member('alice'), bob = member('bob');
  const meeting = (await put(handleMinutes, alice, 'create', {})).body.meeting;
  const otherList = (await call(handleTodo, bob, 'POST', { name: 'Private tasks' })).body.list;
  const tainted = { ...meeting, calendarEventId: 'event_other_member', agenda: [{ ...section,
    points: [{ ...section.points[0], todoListId: otherList.id, todoTaskId: 'task_abcdef1234',
      notes: '<p onclick="bad()">Safe</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>' }] }] };
  const saved = await put(handleMinutes, alice, 'save', tainted);
  assert.equal(saved.status, 200);
  const point = saved.body.meeting.agenda[0].points[0];
  assert.notEqual(point.todoListId, otherList.id);
  assert.equal(saved.body.meeting.calendarEventId, null);
  assert.doesNotMatch(point.notes, /script|onclick|javascript:/i);
  assert.equal((await put(handleMinutes, alice, 'save', { ...saved.body.meeting,
    agenda: [{ id: 'section123456789', title: '', points: [{ ...point, id: 'section123456789' }] }] })).status, 400);
});

test('Minutes cards, suite tags, theme and recency share the Holm member scope', async () => {
  const { member, put, call } = fixture();
  const alice = member('alice'), bob = member('bob');
  const meeting = (await put(handleMinutes, alice, 'create', {})).body.meeting;
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Meetings', color: '#442299' })).body.data.tags[0];
  assert.equal((await put(handleWorkspace, alice, 'setFileTag', { app: 'minutes', fileId: meeting.id, tagId: tag.id })).status, 200);
  assert.equal((await put(handleWorkspace, bob, 'recordOpen', { app: 'minutes', fileId: meeting.id })).status, 404);
  const opened = await put(handleWorkspace, alice, 'recordOpen', { app: 'minutes', fileId: meeting.id });
  assert.ok(opened.body.data.settings.lastOpened[meeting.id]);
  assert.equal((await put(handleWorkspace, alice, 'renameFile', { app: 'minutes', fileId: meeting.id, name: 'New name' })).status, 200);
  assert.equal((await put(handleMinutes, alice, 'save', { ...meeting, agenda: [] })).status, 409);
  assert.equal((await call(handleWorkspace, alice)).body.data.minutes[0].title, 'New name');
  const deleted = await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id });
  assert.deepEqual(deleted.body.data.minutes, []);
  assert.equal(deleted.body.data.settings.lastOpened[meeting.id], undefined);
  assert.deepEqual((await call(handleWorkspace, bob)).body.data.minutes, []);
});

test('Holm package preserves Minutes UI but removes legacy hash auth and uses reload-safe links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-minutes-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir]);
    const original = readFileSync(new URL('../minutes/index.html', import.meta.url), 'utf8');
    const html = readFileSync(join(dir, 'web/minutes/index.html'), 'utf8');
    assert.match(html, /<link rel="stylesheet" href="\/app-sidebar\.css">/);
    assert.match(html, /<script defer src="\/js\/app-sidebar\.js" data-app="minutes"><\/script>/);
    // Holm adds suite styling and PWA metadata, but retains the meeting UI.
    const body = page => page.slice(page.indexOf('<body>'))
      .replaceAll('<script defer ', '<script ')
      .replace('id="home" class="home hidden"', 'id="home" class="home"')
      .replace('<script src="/js/app-sidebar.js" data-app="minutes"></script>', '')
      .replace('<script src="/minutes/pwa.js" defer></script>', '')
      .replace(/<script src="\/js\/(?:previews|tag-ui|home-ui|home-icons|action-menu)\.js"><\/script>/g, '');
    assert.equal(body(html), body(original).replace('href="/" class="home-link"', 'href="/home" class="home-link"').replace('>Save status<', '>Apply status<'));
    assert.match(html, /data-wd-app="minutes"/);
    assert.match(html, /href="\/suite-theme\.css"/);
    assert.equal(readFileSync(join(dir, 'web/minutes/styles.css'), 'utf8'),
      readFileSync(new URL('../minutes/styles.css', import.meta.url), 'utf8'));
    const script = readFileSync(join(dir, 'web/minutes/app.js'), 'utf8');
    assert.doesNotMatch(script, /wd_hash|todo_user_hash|\?hash=|JSON\.stringify\(\{ hash/);
    assert.ok(script.includes("'/minutes/?meeting='"));
    assert.ok(script.includes('/todo/?list='));
    assert.ok(readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8').includes("['todo', 'kanban', 'minutes', 'calendar', 'docs', 'sheets', 'forms', 'slides', 'draw', 'filebox', 'blog']"));
    const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
    vm.runInNewContext(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), { window, URL, URLSearchParams });
    const href = window.WDLinks.url('minutes', 'record_abcdef123');
    assert.equal(href, '/minutes/?meeting=record_abcdef123');
    assert.equal(window.WDLinks.parseHref(href).id, 'record_abcdef123');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
