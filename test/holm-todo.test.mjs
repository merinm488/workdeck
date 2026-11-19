import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleTodo } from '../holm/todo/api.js';

function fixture() {
  let next = 0;
  const owners = new Map();
  function member(email) {
    if (!owners.has(email)) owners.set(email, new Map());
    const rows = owners.get(email);
    const tx = {
      find: () => [...rows.values()],
      count: () => rows.size,
      insert: (_collection, doc) => { const id = `list_${++next}`; rows.set(id, { id, ...doc }); return id; },
      findOne: (_collection, id) => rows.get(typeof id === 'string' ? id : id.id) || null,
      update: (_collection, selector, update) => { rows.set(selector.id, { ...rows.get(selector.id), ...update.$set }); },
      delete: (_collection, selector) => { rows.delete(selector.id); },
      transaction: callback => callback(tx),
    };
    return { holm: { auth: { getMember: () => ({ email, id: email }) }, app: { member: { ds: tx } } } };
  }
  const anon = { holm: { auth: { getMember: () => null }, app: { member: { ds: null } } } };
  async function call(env, path, method = 'GET', body, origin = 'https://mer-workdeck.fazt.sh') {
    const request = new Request('https://mer-workdeck.fazt.sh' + path, {
      method, headers: body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await handleTodo(request, env);
    return { status: response.status, body: await response.json() };
  }
  return { member, anon, call };
}

const item = { id: 'task_0001', title: 'Make a plan', description: '', priority: 'medium',
  dueDate: null, completed: false, createdAt: '2026-11-19T12:00:00.000Z' };

test('Todo requires verified Holm email and same-origin writes', async () => {
  const { member, anon, call } = fixture();
  assert.equal((await call(anon, '/api/todo/lists')).status, 401);
  assert.equal((await call(member('alice@example.test'), '/api/todo/lists', 'POST', { name: 'Hi' }, 'https://evil.test')).status, 403);
  assert.equal((await call(member('alice@example.test'), '/api/todo/lists', 'POST', { name: '' })).status, 400);
});

test('Todo creates, edits, and deletes lists only in the signed-in member scope', async () => {
  const { member, call } = fixture();
  const alice = member('alice@example.test');
  const bob = member('bob@example.test');
  const created = await call(alice, '/api/todo/lists', 'POST', { name: 'Home' });
  assert.equal(created.status, 201);
  const id = created.body.list.id;
  assert.deepEqual((await call(bob, '/api/todo/lists')).body.lists, []);
  assert.equal((await call(bob, `/api/todo/lists/${id}`, 'PUT', { name: 'X', items: [], version: 1 })).status, 404);
  const saved = await call(alice, `/api/todo/lists/${id}`, 'PUT', { name: 'Home', items: [item], version: 1 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.list.version, 2);
  assert.equal((await call(alice, `/api/todo/lists/${id}`, 'PUT', { name: 'Stale', items: [], version: 1 })).status, 409);
  assert.equal((await call(alice, '/api/todo/lists')).body.lists[0].items[0].title, item.title);
  assert.equal((await call(bob, `/api/todo/lists/${id}`, 'DELETE', { version: 2 })).status, 404);
  assert.equal((await call(alice, `/api/todo/lists/${id}`, 'DELETE', { version: 2 })).status, 200);
  assert.deepEqual((await call(alice, '/api/todo/lists')).body.lists, []);
});

test('Todo refuses invalid task fields, duplicate IDs, and dangerous payloads', async () => {
  const { member, call } = fixture();
  const alice = member('alice@example.test');
  const id = (await call(alice, '/api/todo/lists', 'POST', { name: 'Work' })).body.list.id;
  for (const items of [[{ ...item, title: '' }], [{ ...item, priority: 'urgent' }],
    [item, { ...item }], [{ ...item, description: 'x'.repeat(2001) }]]) {
    assert.equal((await call(alice, `/api/todo/lists/${id}`, 'PUT', { name: 'Work', items, version: 1 })).status, 400);
  }
  assert.equal((await call(alice, '/api/todo/lists')).body.lists[0].version, 1);
});
