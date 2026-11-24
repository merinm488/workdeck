import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWorkspace } from '../holm/auth/workspace.js';
import { handleTodo } from '../holm/todo/api.js';

function fixture() {
  const members = new Map();
  let sequence = 0;
  function member(id) {
    if (!members.has(id)) members.set(id, { records: new Map(), prefs: new Map() });
    const { records, prefs } = members.get(id);
    const collection = name => {
      if (!records.has(name)) records.set(name, new Map());
      return records.get(name);
    };
    const ds = {
      find: name => [...collection(name).values()],
      findOne: (name, id) => collection(name).get(typeof id === 'string' ? id : id.id) || null,
      count: name => collection(name).size,
      insert: (name, doc) => { const id = `record_${++sequence}`; collection(name).set(id, { id, ...doc }); return id; },
      update: (name, where, patch) => collection(name).set(where.id, { ...collection(name).get(where.id), ...patch.$set }),
      delete: (name, where) => collection(name).delete(where.id),
      transaction: callback => callback(ds),
    };
    return { holm: { auth: { getMember: () => ({ id }) }, app: { member: {
      ds, kv: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) },
    } } } };
  }
  const guest = { holm: { auth: { getMember: () => null } } };
  async function call(handler, env, method = 'GET', data, origin = 'https://workdeck.test') {
    const response = await handler(new Request('https://workdeck.test/' +
      (handler === handleTodo ? 'api/todo/lists' : 'api/workdeck'), {
      method, headers: data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }), env);
    return { status: response.status, body: await response.json() };
  }
  const put = (env, action, data, origin) => call(handleWorkspace, env, 'PUT', { action, data }, origin);
  const read = env => call(handleWorkspace, env);
  return { member, guest, call, put, read };
}

test('workspace and Todo share only the current Holm member storage', async () => {
  const { member, guest, call, put, read } = fixture();
  const a = member('alice');
  const b = member('bob');
  assert.equal((await read(guest)).status, 401);
  assert.equal((await put(a, 'createTodo', {})).status, 200);
  const rows = (await read(a)).body.data.todo;
  assert.equal(rows.length, 1);
  assert.deepEqual((await read(b)).body.data.todo, []);
  assert.equal((await put(b, 'renameFile', { app: 'todo', fileId: rows[0].id, name: 'Stolen' })).status, 404);
  assert.equal((await call(handleTodo, a)).body.lists[0].name, 'Untitled List');
  assert.equal((await call(handleTodo, a, 'POST', { name: 'From Todo' })).status, 201);
  assert.equal((await read(a)).body.data.todo.length, 2);
  assert.equal((await put(a, 'createTodo', {}, 'https://other.test')).status, 403);
  assert.equal((await call(handleWorkspace, a, 'PUT', { hash: 'alice', action: 'createTodo', data: {} })).status, 400);
  assert.equal((await put(a, 'createPost', {})).body.data.posts.length, 1);
  assert.deepEqual((await read(b)).body.data.posts, []);
});

test('tags, recency and theme work with Todo and stay member-private', async () => {
  const { member, put, read, call } = fixture();
  const a = member('alice');
  const b = member('bob');
  const id = (await put(a, 'createTodo', {})).body.data.todo[0].id;
  const created = await put(a, 'createTag', { name: ' Project ', color: '#123456' });
  const tag = created.body.data.tags[0];
  assert.equal(tag.name, 'Project');
  assert.equal((await put(b, 'setFileTag', { app: 'todo', fileId: id, tagId: tag.id })).status, 404);
  assert.equal((await put(a, 'setFileTag', { app: 'todo', fileId: id, tagId: tag.id })).status, 200);
  assert.equal((await put(a, 'recordOpen', { app: 'todo', fileId: id })).status, 200);
  assert.ok((await read(a)).body.data.settings.lastOpened[id]);
  assert.equal((await put(a, 'updateSettings', { settings: { theme: 'light', viewMode: 'list' } })).status, 200);
  assert.equal((await call(handleTodo, a)).body.settings.theme, 'light');
  assert.equal((await put(a, 'updateSettings', { settings: { lastOpened: { [id]: 'bogus' } } })).status, 400);
  assert.deepEqual((await read(b)).body.data.tags, []);
  assert.equal((await read(b)).body.data.settings.theme, 'dark');
  const deleted = await put(a, 'deleteTag', { tagId: tag.id });
  assert.deepEqual(deleted.body.data.todo, []);
  assert.equal(deleted.body.data.settings.lastOpened[id], undefined);
});
