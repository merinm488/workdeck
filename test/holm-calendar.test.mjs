import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { handleCalendar } from '../holm/calendar/api.js';
import { handleMinutes } from '../holm/minutes/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';
import { handleTodo } from '../holm/todo/api.js';

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
  async function call(handler, env, method = 'GET', body, origin = 'https://workdeck.test') {
    const path = handler === handleCalendar ? '/api/calendar' : handler === handleMinutes ? '/api/minutes' :
      handler === handleWorkspace ? '/api/workdeck' : '/api/todo/lists';
    const res = await handler(new Request('https://workdeck.test' + path, {
      method, headers: body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: res.status, body: await res.json() };
  }
  const put = (handler, env, action, data, origin) => call(handler, env, 'PUT', { action, data }, origin);
  return { member, anon, call, put };
}
const base = calId => ({ calId, title: 'Review', description: 'A meeting', location: 'Office',
  allDay: false, start: '2027-01-05T09:00:00.000Z', end: '2027-01-05T10:00:00.000Z',
  reminders: [5, 30], rrule: 'FREQ=WEEKLY;COUNT=5', duration: 'PT1H',
  exdates: [], links: [] });

test('Calendar private CRUD, recurrence and stale-update checks', async () => {
  const { member, anon, put, call } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await call(handleCalendar, anon)).status, 401);
  assert.equal((await put(handleCalendar, alice, 'createCalendar', { name: 'Home' }, 'https://evil.test')).status, 403);
  assert.equal((await call(handleCalendar, alice, 'PUT', { key: 'bob', action: 'createCalendar', data: {} })).status, 400);
  const cal = (await put(handleCalendar, alice, 'createCalendar', { name: 'Personal', color: '#0284c7' })).body.calendar;
  assert.equal(cal.version, 1);
  assert.deepEqual((await call(handleCalendar, bob)).body.data.calendars, []);
  assert.equal((await put(handleCalendar, bob, 'updateCalendar', { calId: cal.id, version: 1, updates: { name: 'Stolen' } })).status, 404);
  const created = await put(handleCalendar, alice, 'createEvent', { event: base(cal.id) });
  assert.equal(created.status, 200);
  const event = created.body.event;
  assert.equal(event.rrule, 'FREQ=WEEKLY;COUNT=5');
  assert.equal((await put(handleCalendar, bob, 'updateEvent', { eventId: event.id, version: 1, event: base(cal.id) })).status, 404);
  assert.equal((await put(handleCalendar, bob, 'createEvent', { event: base(cal.id) })).status, 400);
  const changed = await put(handleCalendar, alice, 'updateEvent', { eventId: event.id, version: 1,
    event: { ...event, exdates: ['2027-01-12T09:00:00.000Z'] } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.data.events[0].version, 2);
  assert.deepEqual(changed.body.data.events[0].exdates, ['2027-01-12T09:00:00.000Z']);
  assert.equal((await put(handleCalendar, alice, 'updateEvent', { eventId: event.id, version: 1, event })).status, 409);
  const exception = await put(handleCalendar, alice, 'createEvent', { event: { ...base(cal.id),
    parentEventId: event.id, origStart: '2027-01-12T09:00:00.000Z', rrule: null } });
  assert.equal(exception.status, 200);
  assert.equal((await put(handleCalendar, alice, 'createEvent', { event: { ...base(cal.id), parentEventId: 'record_not_owned_99' } })).status, 400);
  const removed = await put(handleCalendar, alice, 'deleteEvent', { eventId: event.id, version: 2 });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.data.events, []); // master deletes exceptions
  assert.equal((await put(handleCalendar, alice, 'deleteCalendar', { calId: cal.id, version: 1 })).status, 200);
  assert.deepEqual((await call(handleCalendar, alice)).body.data.calendars, []);
});

test('Calendar links to own Todo/Minutes, powers meeting event links, suite preview and tags', async () => {
  const { member, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  const cal = (await put(handleCalendar, alice, 'createCalendar', { name: 'Meetings' })).body.calendar;
  const meeting = (await put(handleMinutes, alice, 'create', { title: 'Planning' })).body.meeting;
  const todo = (await call(handleTodo, alice, 'POST', { name: 'Work' })).body.list;
  const other = (await call(handleTodo, bob, 'POST', { name: 'Private' })).body.list;
  const invalid = await put(handleCalendar, alice, 'createEvent', { event: {
    ...base(cal.id), links: [{ app: 'todo', id: other.id, name: 'Private' }],
  } });
  assert.equal(invalid.status, 400);
  const created = await put(handleCalendar, alice, 'createEvent', { event: {
    ...base(cal.id), links: [{ app: 'todo', id: todo.id, name: 'Work' },
      { app: 'minutes', id: meeting.id, name: 'Planning' }],
  } });
  assert.equal(created.status, 200);
  const event = created.body.event;
  assert.equal((await call(handleMinutes, alice)).body.data.events[0].id, event.id);
  const linked = await put(handleMinutes, alice, 'save', { ...meeting, calendarEventId: event.id, agenda: [] });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.meeting.calendarEventId, event.id);
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Calendar tag', color: '#442299' })).body.data.tags[0];
  const tagged = await put(handleCalendar, alice, 'updateCalendar', { calId: cal.id, version: cal.version, updates: { tagId: tag.id } });
  assert.equal(tagged.status, 200);
  assert.equal((await put(handleWorkspace, bob, 'recordOpen', { app: 'calendar', fileId: cal.id })).status, 404);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'calendar', fileId: cal.id })).status, 200);
  assert.ok((await call(handleWorkspace, alice)).body.data.settings.lastOpened.calendar);
  assert.equal((await put(handleCalendar, alice, 'updateSettings', { settings: { theme: 'light',
    calendarThumbnail: 'data:image/png;base64,YWJj' } })).status, 200);
  assert.equal((await call(handleWorkspace, alice)).body.data.settings.calendarThumbnail, 'data:image/png;base64,YWJj');
  assert.equal((await call(handleCalendar, bob)).body.data.settings.theme, 'dark');
  const deletedTag = await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id });
  assert.deepEqual(deletedTag.body.data.calendars, []);
  assert.deepEqual(deletedTag.body.data.events, []);
  assert.equal(deletedTag.body.data.settings.lastOpened.calendar, undefined);
});

test('Holm Calendar package preserves original UI and removes old key/account flows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-calendar-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir]);
    const html = readFileSync(join(dir, 'web/calendar/index.html'), 'utf8');
    const original = readFileSync(new URL('../calendar/index.html', import.meta.url), 'utf8');
    for (const marker of ['fullcalendar@6.1.21', 'rrule@2.8.1', 'id="calendarEl"',
      'id="eventModal"', 'id="scopeModal"', 'id="icsImportBtn"', 'id="linkPickerModal"']) {
      assert.ok(original.includes(marker), `Original missing ${marker}`);
      assert.ok(html.includes(marker), `Holm missing ${marker}`);
    }
    assert.equal(readFileSync(join(dir, 'web/calendar/styles.css'), 'utf8'),
      readFileSync(new URL('../calendar/styles.css', import.meta.url), 'utf8'));
    assert.doesNotMatch(html, /View My Key|Your Access Key|Delete Account|calendar_user_hash|sessionStorage/);
    const editor = readFileSync(join(dir, 'web/calendar/js/editor.js'), 'utf8');
    assert.doesNotMatch(editor, /getCalendarUserKey|calendarAuth\.getSession|viewKeyBtn/);
    assert.ok(editor.includes('function occurrenceKeys('));
    assert.ok(editor.includes('function importIcsFile('));
    assert.ok(readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8').includes("['todo', 'kanban', 'minutes', 'calendar', 'docs', 'sheets', 'forms', 'slides', 'draw', 'filebox', 'blog']"));
    const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
    vm.runInNewContext(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), { window, URL, URLSearchParams });
    assert.equal(window.WDLinks.url('calendar', 'record_abcdef123'), '/calendar/?cal=record_abcdef123');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
