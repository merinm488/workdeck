// Holm's native connected-app MCP calls these operations after its own OAuth,
// consent and member verification. Never select a member from caller input.
const COLLECTIONS = {
  docs: 'user_docs', sheets: 'sheet_records', forms: 'user_forms',
  slides: 'slide_decks', draws: 'canvas_drawings', files: 'file_records',
  folders: 'file_folders', todo: 'todo_lists', minutes: 'meeting_minutes',
  calendars: 'user_calendars', events: 'calendar_events',
  kanban: 'kanban_boards', posts: 'blog_posts',
};
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const now = () => new Date().toISOString();
const clean = row => {
  if (!row) return null;
  const { sharedId, token, accountHash, ...safe } = row;
  return safe;
};
const small = row => {
  const value = clean(row);
  if (JSON.stringify(value).length > 64_000) throw new Error('Record exceeds the 64 KB MCP response limit. Open it in Workdeck.');
  return value;
};
function collection(app) {
  if (!Object.hasOwn(COLLECTIONS, app)) throw new Error('Unknown Workdeck app');
  return COLLECTIONS[app];
}
function record(tx, app, id) {
  if (!ID.test(id)) throw new Error('Invalid record ID');
  const row = tx.findOne(collection(app), id);
  if (!row) throw new Error('Record not found');
  return row;
}
export function workspaceList({ app, limit = 50, offset = 0 }, env) {
  const rows = env.holm.app.member.ds.find(collection(app), {}, { limit: 2000, order: 'desc' });
  return { total: rows.length, records: rows.slice(offset, offset + limit).map(row => {
    const { id, name, title, version, updatedAt, createdAt, date, state } = row;
    return { id, name: name || title || '', version, updatedAt, createdAt, date, state };
  }) };
}
export function workspaceRead({ app, recordId }, env) {
  const row = record(env.holm.app.member.ds, app, recordId);
  // Binary contents and entire workbooks live in separate collections, not here.
  // Older records can still carry inline data or internal storage references.
  const safe = clean(row);
  if (app === 'sheets') { delete safe.data; delete safe.thumbnail; }
  if (app === 'files') {
    for (const key of ['storageKey', 'bytes', 'base64', 'data']) delete safe[key];
  }
  return small(safe);
}
export function docCreate({ title, content = '' }, env) {
  if (!title.trim()) throw new Error('Title cannot be blank');
  const ds = env.holm.app.member.ds;
  return ds.transaction(tx => {
    if (tx.count('user_docs', {}) >= 500) throw new Error('Document limit reached');
    const stamp = now();
    const id = tx.insert('user_docs', { title: title.trim(), content, contentType: 'plain-text',
      pinned: false, archived: false, version: 1, createdAt: stamp, updatedAt: stamp });
    return { id, title: title.trim(), version: 1 };
  });
}
export function docUpdate({ recordId, version, title, content }, env) {
  return env.holm.app.member.ds.transaction(tx => {
    const old = record(tx, 'docs', recordId);
    if (old.version !== version) throw new Error('Document changed. Read it again before editing.');
    if (old.sharedId) throw new Error('Unshare the document in Workdeck before editing it via AI');
    if (content !== undefined && old.contentType !== 'plain-text') throw new Error('Only plain-text documents can be edited by AI');
    if (title !== undefined && !title.trim()) throw new Error('Title cannot be blank');
    const patch = { version: version + 1, updatedAt: now() };
    if (title !== undefined) patch.title = title.trim();
    if (content !== undefined) patch.content = content;
    tx.update('user_docs', { id: recordId }, { $set: patch });
    return { id: recordId, version: patch.version };
  });
}
export function todoLists(_input, env) {
  return env.holm.app.member.ds.find('todo_lists', {}, { limit: 200, order: 'desc' })
    .map(({ id, name, version, updatedAt, items }) => ({ id, name, version, updatedAt, taskCount: items?.length || 0 }));
}
export function todoItems({ listId, offset = 0, limit = 50 }, env) {
  const list = record(env.holm.app.member.ds, 'todo', listId);
  const items = list.items || [];
  return { listId, list: { id: list.id, name: list.name, itemCount: items.length, updatedAt: list.updatedAt },
    total: items.length, version: list.version, items: items.slice(offset, offset + limit) };
}
export function todoCreateList({ name }, env) {
  if (!name.trim()) throw new Error('List name cannot be blank');
  return env.holm.app.member.ds.transaction(tx => {
    if (tx.count('todo_lists', {}) >= 200) throw new Error('Todo list limit reached');
    const id = tx.insert('todo_lists', { name: name.trim(), items: [], version: 1, updatedAt: now() });
    return { id, name: name.trim(), version: 1 };
  });
}
export function todoAddTask({ listId, title, description = '', priority = 'medium', dueDate }, env) {
  if (!title.trim()) throw new Error('Task title cannot be blank');
  if (dueDate !== undefined && (Number.isNaN(Date.parse(dueDate + 'T00:00:00Z')) ||
      new Date(dueDate + 'T00:00:00Z').toISOString().slice(0, 10) !== dueDate)) throw new Error('Invalid due date');
  return env.holm.app.member.ds.transaction(tx => {
    const list = record(tx, 'todo', listId);
    const items = list.items || [];
    if (items.length >= 256) throw new Error('Todo list is full');
    const task = { id: crypto.randomUUID().replaceAll('-', ''), title: title.trim(), description,
      priority, dueDate: dueDate ?? null, completed: false, createdAt: now() };
    tx.update('todo_lists', { id: listId }, { $set: {
      items: [...items, task], version: list.version + 1, updatedAt: now(),
    } });
    return { listId, version: list.version + 1, task };
  });
}
export function todoUpdateTask({ listId, taskId, version, title, description, completed, priority, dueDate }, env) {
  if (title !== undefined && !title.trim()) throw new Error('Task title cannot be blank');
  if (dueDate !== undefined && dueDate !== null && (Number.isNaN(Date.parse(dueDate + 'T00:00:00Z')) ||
      new Date(dueDate + 'T00:00:00Z').toISOString().slice(0, 10) !== dueDate)) throw new Error('Invalid due date');
  return env.holm.app.member.ds.transaction(tx => {
    const list = record(tx, 'todo', listId);
    if (version !== undefined && list.version !== version) throw new Error('List changed. Read its tasks again before editing.');
    if (title === undefined && description === undefined && completed === undefined &&
        priority === undefined && dueDate === undefined) throw new Error('No task changes supplied');
    const items = [...(list.items || [])];
    const index = items.findIndex(item => item.id === taskId);
    if (index < 0) throw new Error('Task not found');
    const patch = { ...items[index] };
    if (title !== undefined) patch.title = title.trim();
    if (description !== undefined) patch.description = description;
    if (completed !== undefined) patch.completed = completed;
    if (priority !== undefined) patch.priority = priority;
    if (dueDate !== undefined) patch.dueDate = dueDate;
    items[index] = patch;
    tx.update('todo_lists', { id: listId }, { $set: { items, version: list.version + 1, updatedAt: now() } });
    return { listId, version: list.version + 1, task: patch };
  });
}
