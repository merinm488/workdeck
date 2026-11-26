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

test('Minutes modal creation preserves a member-owned launcher tag without accepting foreign tags', async () => {
  const { member, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Planning', color: '#3B82F6' })).body.data.tags[0];
  const created = await put(handleMinutes, alice, 'create', { title: 'Tagged meeting', tagId: tag.id });
  assert.equal(created.status, 200);
  assert.equal(created.body.meeting.tagId, tag.id);
  const saved = await put(handleMinutes, alice, 'save', { ...created.body.meeting, agenda: [section] });
  assert.equal(saved.body.meeting.tagId, tag.id, 'template save preserves the assigned tag');
  const foreign = await put(handleMinutes, bob, 'create', { tagId: tag.id });
  assert.equal(foreign.status, 200);
  assert.equal(foreign.body.meeting.tagId, null);
  assert.equal((await put(handleMinutes, alice, 'create', { tagId: 'missing_tag_001' })).body.meeting.tagId, null);
  for (const tagId of [123, {}, [], 'bad']) assert.equal((await put(handleMinutes, alice, 'create', { tagId })).status, 400);
  assert.equal((await put(handleMinutes, alice, 'create', { tagId: null })).body.meeting.tagId, null);
});

test('Minutes updates multiple existing actions and adds a new one without losing Todo edits', async () => {
  const { member, put } = fixture();
  const alice = member('alice');
  const meeting = (await put(handleMinutes, alice, 'create', { title: 'Follow-ups' })).body.meeting;
  const agenda = [{ ...section, points: [section.points[0], { ...section.points[0], id: 'action_second123', text: 'Review draft' }] }];
  const first = (await put(handleMinutes, alice, 'save', { ...meeting, agenda })).body;
  assert.equal(first.todo.length, 1);
  const updates = first.meeting.agenda.map(topic => ({ ...topic, points: [
    ...topic.points.map((point, index) => ({ ...point, text: 'Updated action ' + index, owner: 'Priya', dueDate: '2027-02-03' })),
    { ...section.points[0], id: 'action_third1234', text: 'Publish summary' },
  ] }));
  const second = (await put(handleMinutes, alice, 'save', { ...first.meeting, agenda: updates })).body;
  assert.equal(second.todo.length, 1);
  assert.deepEqual(second.todo[0].items.map(item => item.title), ['Updated action 0', 'Updated action 1', 'Publish summary']);
  assert.deepEqual(second.todo[0].items.slice(0, 2).map(item => item.dueDate), ['2027-02-03', '2027-02-03']);
  assert.ok(second.todo[0].items.slice(0, 2).every(item => item.description.includes('Priya')));
  const third = (await put(handleMinutes, alice, 'save', second.meeting)).body;
  assert.equal(third.todo[0].items.length, 3, 'repeated saves never duplicate linked actions');
});

test('Minutes completion patches only its linked Todo task, supports undo/final meetings, and preserves list revisions', async () => {
  const { member, put, call } = fixture();
  const alice = member('alice'), ds = alice.holm.app.member.ds;
  const created = (await put(handleMinutes, alice, 'create', { title: 'Completion test' })).body.meeting;
  const first = (await put(handleMinutes, alice, 'save', { ...created, agenda: [{ ...section, points: [
    section.points[0], { ...section.points[0], id: 'other_action_001', text: 'Another task' },
  ] }] })).body;
  const meeting = first.meeting, point = meeting.agenda[0].points[0], list = first.todo[0];
  const external = (await call(handleTodo, alice, 'PUT', { name: 'Renamed in Todo', version: list.version,
    items: list.items.map((task, index) => ({ ...task, title: 'Edited in Todo ' + index, completed: index === 1 }))
  }, undefined, `/api/todo/lists/${list.id}`)).body.list;
  const data = { id: meeting.id, pointId: point.id, completed: true };
  const result = await put(handleMinutes, alice, 'setActionCompleted', data);
  assert.equal(result.status, 200);
  assert.equal(result.body.todoList.version, external.version + 1);
  assert.equal(result.body.todoList.name, external.name);
  assert.deepEqual(result.body.todoList.items, external.items.map((task, index) => index === 0 ? { ...task, completed: true } : task));
  assert.deepEqual(ds.findOne('meeting_minutes', meeting.id), meeting, 'completion never changes meeting content or revision');
  const todo = (await call(handleTodo, alice)).body.lists.find(item => item.id === list.id);
  assert.equal(todo.items[0].completed, true, 'the respective Todo file sees the same completion');
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', data)).body.todoList.version, todo.version, 'retrying the explicit state is idempotent');
  assert.equal((await call(handleTodo, alice, 'PUT', external, undefined, `/api/todo/lists/${list.id}`)).status, 409, 'stale whole-list writes cannot erase completion');
  const undone = await put(handleMinutes, alice, 'setActionCompleted', { ...data, completed: false });
  assert.equal(undone.body.todoList.items[0].completed, false);
  assert.equal(undone.body.todoList.items[1].completed, true, 'other tasks are untouched');
  const final = (await put(handleMinutes, alice, 'save', { ...meeting, state: 'final', approvedBy: 'Sam' })).body.meeting;
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', data)).status, 200);
  assert.deepEqual(ds.findOne('meeting_minutes', meeting.id), final, 'final minutes remain frozen while follow-ups can finish');
  const reopened = await put(handleMinutes, alice, 'save', { ...final, state: 'draft' });
  assert.equal(reopened.body.todo[0].items[0].completed, true, 'later meeting saves preserve completion');
});

test('Minutes completion rejects unauthorized, malformed, forged and missing links without creating tasks', async () => {
  const { member, anon, put, call } = fixture();
  const alice = member('alice'), bob = member('bob'), ds = alice.holm.app.member.ds;
  const created = (await put(handleMinutes, alice, 'create', {})).body.meeting;
  const saved = (await put(handleMinutes, alice, 'save', { ...created, agenda: [{ ...section, points: [
    ...section.points, { ...section.points[0], id: 'empty_action_001', text: '' },
  ] }] })).body;
  const point = saved.meeting.agenda[0].points[0];
  const data = { id: created.id, pointId: point.id, completed: true };
  assert.equal((await put(handleMinutes, anon, 'setActionCompleted', data)).status, 401);
  assert.equal((await put(handleMinutes, bob, 'setActionCompleted', data)).status, 404);
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', data, 'https://other.test')).status, 403);
  for (const bad of [undefined, null, 'true', 1, {}]) assert.equal((await put(handleMinutes, alice, 'setActionCompleted', { ...data, completed: bad })).status, 400);
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', { ...data, pointId: 'bad' })).status, 400);
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', { ...data, pointId: section.points[1].id })).status, 404);
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', { ...data, pointId: 'empty_action_001' })).status, 409);
  const otherList = (await call(handleTodo, bob, 'POST', { name: 'Private' })).body.list;
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', { ...data, todoListId: otherList.id, todoTaskId: 'forged_task_001' })).status, 400);
  const untouched = (await call(handleTodo, bob)).body.lists[0];
  assert.equal(untouched.id, otherList.id);
  assert.deepEqual(untouched.items, otherList.items);
  const list = ds.findOne('todo_lists', point.todoListId);
  ds.update('todo_lists', { id: list.id }, { $set: { items: [], version: list.version + 1 } });
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', data)).status, 409);
  assert.deepEqual(ds.findOne('todo_lists', list.id).items, [], 'a missing task is never recreated');
  ds.delete('todo_lists', { id: list.id });
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', data)).status, 409);
  const transaction = ds.transaction;
  ds.transaction = () => { throw new Error('Store unavailable'); };
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', data)).status, 503);
  ds.transaction = transaction;
  await put(handleMinutes, alice, 'delete', { id: created.id });
  assert.equal((await put(handleMinutes, alice, 'setActionCompleted', data)).status, 404);
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

test('Holm package ships the document-first Minutes UI with shared home and self-hosted editing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-minutes-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir]);
    const original = readFileSync(new URL('../holm/minutes/index.html', import.meta.url), 'utf8');
    const html = readFileSync(join(dir, 'web/minutes/index.html'), 'utf8');
    assert.match(html, /<link rel="stylesheet" href="\/app-sidebar\.css">/);
    assert.match(html, /<script defer src="\/js\/app-sidebar\.js" data-app="minutes"><\/script>/);
    // Native home/editor and shared account controls are assembled by the suite.
    assert.match(html, /id="settingsBtn"[^>]*class="wd-account-trigger"/);
    assert.match(html, /data-theme="system"/);
    assert.match(html, /id="logoutBtn"/);
    assert.doesNotMatch(html, /id="themeBtn"/);
    assert.match(html, /id="overviewToggle"[^>]*aria-controls="meetingOverview"[^>]*aria-expanded="true"/);
    assert.match(html, /id="meetingOverview" class="agenda-rail"/);
    assert.doesNotMatch(html, /rail-hint|Made for the conversation.|to add the next note|for a new line/);
    assert.match(html, /id="documentName"[^>]*aria-haspopup="dialog"[^>]*>Untitled meeting<\/button><span id="saveState"/);
    assert.doesNotMatch(html, /breadcrumb-divider|id="returnBtn"|editor-app-icon/);
    const header = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('<main'));
    assert.doesNotMatch(header, /id="overviewToggle"|<img/);
    assert.match(html, /id="editorToolbar" class="editor-toolbar">\s*<button id="overviewToggle"/);
    assert.match(html, /id="documentScroll" class="document-scroll"/);
    assert.doesNotMatch(html, /printBtn|printView|Print or save as PDF/);
    assert.doesNotMatch(html, /bottomReview|document-footer|Good meetings lead to clear next steps/);
    assert.doesNotMatch(html, /Capture the discussion\. Make the next steps clear\.|A clear record\. A clear next step\.|Review the follow-ups before finishing your minutes\.|Approval names are recorded, not independently verified\.|These minutes are final and read-only\.|id="finalNotice"/);
    assert.match(html, /<h2 id="reviewTitle">Review<\/h2>/);
    assert.match(html, /id="stateChip"[^>]*>Draft<\/span><span id="approvalName"[^>]*hidden/);
    assert.equal((html.match(/id="reviewBtn"/g) || []).length, 1);
    assert.match(header, /id="reviewBtn"[^>]*>Update Status<\/button>/);
    assert.doesNotMatch(html, /Review &(?:amp;)? finish/);
    assert.equal(html.includes("Start with a little structure. Make it your own."), false);
    for (const id of ['decisionsList', 'actionsList']) assert.match(html, new RegExp(`<ol id="${id}" class="summary-list"`));
    for (const id of ['decisionSummaryCount', 'actionSummaryCount', 'actionError']) assert.ok(html.includes(`id="${id}"`));
    assert.doesNotMatch(html, /actionProgress/);
    const body = page => page.slice(page.indexOf('<main'))
      .replaceAll('<script defer ', '<script ')
      .replace('id="home" class="home hidden"', 'id="home" class="home"')
      .replace('<script src="/js/app-sidebar.js" data-app="minutes"></script>', '')
      .replace('<script src="/minutes/pwa.js" defer></script>', '')
      .replace(/<script src="\/js\/(?:previews|tag-ui|home-ui|home-icons|action-menu|dialogs|settings-menu|search-suggestions|profile-photo)\.js"><\/script>/g, '');
    assert.equal(body(html), body(original));
    for (const id of ['outline', 'createDialog', 'reviewDialog', 'notesList', 'decisionsList', 'actionsList', 'saveError', 'downloadRecovery']) assert.ok(html.includes(`id="${id}"`));
    assert.doesNotMatch(html, /home-hero|column-headers|cdn.jsdelivr/);
    assert.ok(html.includes('src="/minutes/vendor-quill.js"'));
    assert.ok(html.includes('src="/minutes/vendor-purify.js"'));
    assert.ok(readFileSync(join(dir, 'web/minutes/vendor-quill.js'), 'utf8').length > 100000);
    assert.ok(readFileSync(join(dir, 'web/minutes/vendor-purify.js'), 'utf8').includes('DOMPurify'));
    assert.match(html, /data-wd-app="minutes"/);
    assert.match(html, /<html[^>]*data-minutes-loading/);
    assert.match(html, /#minutesLoading\{display:none\}/);
    assert.match(html, /html\[data-minutes-loading\] body >[^}]*visibility:hidden!important/);
    assert.match(html, /id="minutesLoading" role="status" aria-live="polite"/);
    assert.match(html, /href="\/suite-theme\.css"/);
    assert.equal(readFileSync(join(dir, 'web/minutes/styles.css'), 'utf8'),
      readFileSync(new URL('../holm/minutes/styles.css', import.meta.url), 'utf8'));
    assert.doesNotMatch(readFileSync(join(dir, 'web/minutes/styles.css'), 'utf8'), /@media print|print-view/);
    const script = readFileSync(join(dir, 'web/minutes/app.js'), 'utf8');
    assert.doesNotMatch(script, /printBtn|printView|renderPrint|beforeprint|\bprint\(/);
    assert.match(script, /function recoveryHTML\(\)/);
    assert.doesNotMatch(script, /bottomReview|finalNotice|All action items have an owner and due date/);
    assert.doesNotMatch(script, /wd_hash|todo_user_hash|\?hash=|JSON\.stringify\(\{ hash/);
    assert.ok(script.includes("'/minutes/?meeting='"));
    assert.ok(script.includes('/todo/?list='));
    assert.match(script, /class="rename-meeting"/);
    assert.match(script, /request\('renameFile', \{ app: 'minutes', fileId: meeting.id, name \}, '\/api\/workdeck'\)/);
    assert.match(script, /await shellReady/);
    assert.match(script, /removeAttribute\('data-minutes-loading'\)/);
    assert.match(readFileSync(join(dir, 'web/js/home-ui.js'), 'utf8'), /\.rename-meeting,\.delete-meeting,\.wd-app-card-tag/);
    assert.ok(readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8').includes("['todo', 'kanban', 'minutes', 'calendar', 'docs', 'sheets', 'forms', 'slides', 'draw', 'filebox', 'blog']"));
    const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
    vm.runInNewContext(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), { window, URL, URLSearchParams });
    const href = window.WDLinks.url('minutes', 'record_abcdef123');
    assert.equal(href, '/minutes/?meeting=record_abcdef123');
    assert.equal(window.WDLinks.parseHref(href).id, 'record_abcdef123');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
