import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.NODE_ENV = 'development';
const { default: workdeck } = await import('../api/workdeck.js');
const { default: minutes } = await import('../api/minutes.js');
const { default: todo } = await import('../api/todo.js');
const { generateHash, deleteUserDoc } = await import('../api/_lib/store.js');

async function call(handler, method, hash, action, data) {
  const out = {};
  const res = {
    setHeader() { return this; },
    status(value) { out.status = value; return this; },
    json(value) { out.body = value; return this; },
    end() { return this; }
  };
  await handler({ method, query: { hash }, body: { hash, action, data }, headers: {} }, res);
  return out;
}

test('Minutes creates linked Todo tasks once, preserves completion, and rejects stale edits', async () => {
  const key = `minutes-test-${crypto.randomUUID()}`;
  const hash = generateHash(key);
  try {
    const created = await call(workdeck, 'PUT', hash, 'createMinutes', {});
    // Missing account cannot create a meeting.
    assert.equal(created.status, 404);
    const signup = await (async () => {
      const out = {};
      const res = { setHeader() { return this; }, status(s) { out.status = s; return this; }, json(j) { out.body = j; return this; } };
      await workdeck({ method: 'POST', query: {}, body: { key, action: 'create' }, headers: {} }, res);
      return out;
    })();
    assert.equal(signup.status, 201);
    const first = await call(minutes, 'PUT', hash, 'create', { title: 'Team meeting' });
    assert.equal(first.body.success, true);
    const meeting = first.body.meeting;
    const section = { id: 'section123456789', title: 'Budget', points: [{ id: 'action1234567890', type: 'action', text: 'Send proposal', owner: 'Sam', dueDate: '2027-01-02', notes: '' }, { id: 'note12345678901', type: 'discussion', text: 'Review next quarter', owner: 'Alex', dueDate: '2027-02-03', notes: '' }] };
    let saved = await call(minutes, 'PUT', hash, 'save', { ...meeting, agenda: [section] });
    assert.equal(saved.body.success, true);
    assert.equal(saved.body.todo.length, 1);
    const list = saved.body.todo[0];
    const taskId = saved.body.meeting.agenda[0].points[0].todoTaskId;
    assert.equal(saved.body.meeting.agenda[0].points[1].owner, 'Alex');
    assert.equal(saved.body.meeting.agenda[0].points[1].dueDate, '2027-02-03');
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].id, taskId);
    assert.equal(list.items[0].owner, 'Sam');
    const stale = await call(minutes, 'PUT', hash, 'save', { ...meeting, agenda: [section] });
    assert.equal(stale.status, 409);
    const updatedTask = { ...list, items: [{ ...list.items[0], completed: true }] };
    assert.equal((await call(todo, 'PUT', hash, 'updateList', { listId: list.id, list: updatedTask })).body.success, true);
    saved = await call(minutes, 'PUT', hash, 'save', { ...saved.body.meeting, title: 'Renamed meeting' });
    assert.equal(saved.body.success, true);
    assert.equal(saved.body.todo[0].items.length, 1);
    assert.equal(saved.body.todo[0].items[0].completed, true);
    assert.equal((await call(minutes, 'GET', hash)).body.data.minutes[0].title, 'Renamed meeting');
    const finalized = await call(minutes, 'PUT', hash, 'save', { ...saved.body.meeting, state: 'final', approvedBy: 'Alex' });
    assert.equal(finalized.body.meeting.approvedBy, 'Alex');
    assert.equal((await call(minutes, 'PUT', hash, 'save', { ...finalized.body.meeting, title: 'Changed' })).status, 400);
  } finally { await deleteUserDoc(hash); }
});
