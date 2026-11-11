import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'development';
const { default: workdeck } = await import('../api/workdeck.js');
const { default: todo } = await import('../api/todo.js');
const { generateHash, deleteUserDoc } = await import('../api/_lib/store.js');

async function call(handler, method, query = {}, body = {}) {
  const result = {};
  const res = {
    setHeader() { return this; },
    status(status) { result.status = status; return this; },
    json(value) { result.body = value; return this; },
    end() { return this; }
  };
  await handler({ method, query, body, headers: {} }, res);
  return result;
}

test('existing Workdeck/Todo account key flow still creates, reads and updates lists', async () => {
  const key = `mcp-regression-${crypto.randomUUID()}`;
  const hash = generateHash(key);
  try {
    assert.equal((await call(workdeck, 'POST', {}, { key, action: 'create' })).status, 201);
    assert.equal((await call(workdeck, 'POST', {}, { key, action: 'login' })).status, 200);
    const created = await call(todo, 'PUT', {}, { key, action: 'createList', data: { name: 'Original app' } });
    assert.equal(created.status, 200);
    const listId = created.body.list.id;
    const updated = await call(todo, 'PUT', {}, { key, action: 'updateList',
      data: { listId, list: { name: 'Original app', items: [{ id: 'task1', title: 'Existing task' }] } } });
    assert.equal(updated.status, 200);
    const read = await call(workdeck, 'GET', { key });
    assert.equal(read.status, 200);
    assert.equal(read.body.data.todo[0].items[0].title, 'Existing task');
  } finally {
    await deleteUserDoc(hash);
  }
});
