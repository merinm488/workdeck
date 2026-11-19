// Holm Todo API. Records belong to the current verified member; no client-
// supplied account ID, access key or shared storage path is ever trusted.
const COLLECTION = 'todo_lists';
const MAX_LISTS = 200;
const MAX_ITEMS = 256;
const MAX_BODY = 800_000;
const json = (value, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const date = () => new Date().toISOString();

async function inputOf(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
  catch { return null; }
}
function listName(value) {
  return typeof value === 'string' && value.trim().length <= 100 && value.trim().length > 0
    ? value.trim() : null;
}
function tasksOf(items) {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return null;
  const ids = new Set();
  const tasks = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(item.id) || ids.has(item.id) ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 200 ||
        typeof item.description !== 'string' || item.description.length > 2000 ||
        typeof item.completed !== 'boolean' ||
        !['low', 'medium', 'high'].includes(item.priority) ||
        (item.dueDate !== null && (typeof item.dueDate !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ||
          Number.isNaN(Date.parse(item.dueDate + 'T00:00:00Z')))) ||
        typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))) return null;
    ids.add(item.id);
    tasks.push({ id: item.id, title: item.title.trim(), description: item.description,
      priority: item.priority, dueDate: item.dueDate, completed: item.completed, createdAt: item.createdAt });
  }
  return tasks;
}
function exposed(record) {
  return { id: record.id, name: record.name, items: record.items || [],
    version: record.version, updatedAt: record.updatedAt };
}

export async function handleTodo(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const member = env.holm.auth.getMember();
  if (!member) return json({ error: 'Sign in to continue.' }, 401);
  if (!member.email) return json({ error: 'A verified email is required for Todo.' }, 403);
  const ds = env.holm.app.member.ds;
  if (pathname === '/api/todo/lists' && request.method === 'GET') {
    return json({ lists: ds.find(COLLECTION, {}, { limit: MAX_LISTS, order: 'desc' }).map(exposed) });
  }
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Not found.' }, 404);
  // Holm protects cookie-authenticated writes; also require an exact same-origin
  // Origin for every mutation, including PUT/DELETE (not just POST).
  if (request.headers.get('origin') !== url.origin) return json({ error: 'Invalid origin.' }, 403);
  const data = await inputOf(request);
  if (!data) return json({ error: 'Invalid JSON or request too large.' }, 400);

  if (pathname === '/api/todo/lists' && request.method === 'POST') {
    const name = listName(data.name);
    if (!name) return json({ error: 'List name must be 1–100 characters.' }, 400);
    const result = ds.transaction(tx => {
      if (tx.count(COLLECTION, {}) >= MAX_LISTS) return null;
      const updatedAt = date();
      const id = tx.insert(COLLECTION, { name, items: [], version: 1, updatedAt });
      return { id, name, items: [], version: 1, updatedAt };
    });
    return result ? json({ list: result }, 201) : json({ error: 'List limit reached.' }, 409);
  }

  const match = /^\/api\/todo\/lists\/([a-zA-Z0-9_-]{1,128})$/.exec(pathname);
  if (!match || !['PUT', 'DELETE'].includes(request.method)) return json({ error: 'Not found.' }, 404);
  if (!Number.isSafeInteger(data.version) || data.version < 1) return json({ error: 'Invalid version.' }, 400);
  const name = request.method === 'PUT' ? listName(data.name) : null;
  const tasks = request.method === 'PUT' ? tasksOf(data.items) : null;
  if (request.method === 'PUT' && (!name || !tasks)) return json({ error: 'Invalid list or tasks.' }, 400);
  const result = ds.transaction(tx => {
    const current = tx.findOne(COLLECTION, match[1]);
    if (!current) return { status: 404 };
    if (current.version !== data.version) return { status: 409 };
    if (request.method === 'DELETE') {
      tx.delete(COLLECTION, { id: match[1] });
      return { status: 200 };
    }
    const updatedAt = date();
    tx.update(COLLECTION, { id: match[1] }, { $set: {
      name, items: tasks, version: current.version + 1, updatedAt,
    } });
    return { status: 200, list: { id: match[1], name, items: tasks,
      version: current.version + 1, updatedAt } };
  });
  if (result.status === 404) return json({ error: 'List not found.' }, 404);
  if (result.status === 409) return json({ error: 'List changed in another tab. Reload and try again.' }, 409);
  return json(result.list ? { list: result.list } : { deleted: true });
}
