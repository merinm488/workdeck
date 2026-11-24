// Holm Kanban: only the verified current member's DS is used. No access key,
// hash, user ID or client-generated board ID can select another account.
const COLLECTION = 'kanban_boards';
const TODO = 'todo_lists';
const SETTINGS = 'workdeck_settings';
const MAX_BOARDS = 200;
const MAX_BYTES = 850_000;
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
const titleOK = value => typeof value === 'string' && !!value.trim() && value.trim().length <= 100;
const textOK = (value, max) => value === undefined || (typeof value === 'string' && value.length <= max);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status) => json({ success: false, error: message }, status);
const now = () => new Date().toISOString();
const exposed = record => ({ id: record.id, name: record.name, columns: record.columns || [],
  rows: record.rows || [], cards: record.cards || [], links: record.links || [],
  tagId: record.tagId || null, version: record.version, createdAt: record.createdAt, updatedAt: record.updatedAt });
const rowOK = (r, max) => r && typeof r === 'object' && idOK(r.id) && textOK(r.label, max) &&
  (r.collapsed === undefined || typeof r.collapsed === 'boolean');

function validBoard(board, ds, previous) {
  if (!board || typeof board !== 'object' || Array.isArray(board) || !titleOK(board.name) ||
      !Array.isArray(board.columns) || board.columns.length < 1 || board.columns.length > 100 ||
      !board.columns.every(c => rowOK(c, 100) && (c.limit === undefined || (Number.isInteger(c.limit) && c.limit >= 0 && c.limit <= 1000))) ||
      !Array.isArray(board.rows) || board.rows.length > 50 || !board.rows.every(r => rowOK(r, 100)) ||
      !Array.isArray(board.cards) || board.cards.length > 1000 ||
      !Array.isArray(board.links) || board.links.length > 2000) return false;
  const columns = new Set(board.columns.map(c => c.id));
  const rows = new Set(board.rows.map(r => r.id));
  if (columns.size !== board.columns.length || rows.size !== board.rows.length) return false;
  const ids = new Set();
  for (const card of board.cards) {
    if (!card || typeof card !== 'object' || Array.isArray(card) || !idOK(card.id) ||
        ids.has(card.id) || !columns.has(card.column) || (card.row && !rows.has(card.row)) ||
        !textOK(card.label, 300) || !textOK(card.description, 8000) ||
        !textOK(card.color, 40) || !textOK(card.end_date, 80) ||
        !['low', 'medium', 'high', undefined].includes(card.priority) ||
        (card.progress !== undefined && (typeof card.progress !== 'number' || card.progress < 0 || card.progress > 100)) ||
        (card.checklist !== undefined && (!Array.isArray(card.checklist) || card.checklist.length > 100 ||
          card.checklist.some(i => !i || !idOK(i.id) || !textOK(i.text, 2000) || typeof i.done !== 'boolean'))) ||
        (card.comments !== undefined && (!Array.isArray(card.comments) || card.comments.length > 200 ||
          card.comments.some(c => !c || !idOK(c.id) || !textOK(c.text, 4000) || !textOK(c.date, 80)))) ||
        (card.todoListId && (!idOK(card.todoListId) || !idOK(card.todoTaskId)))) return false;
    // Never let a board fabricate or refer to a task in another account.
    if (card.todoListId) {
      const list = ds.findOne(TODO, card.todoListId);
      if (!list?.items?.some(item => item.id === card.todoTaskId)) {
        const oldCard = previous?.cards?.find(old => old.id === card.id);
        if (oldCard?.todoListId !== card.todoListId || oldCard?.todoTaskId !== card.todoTaskId) return false;
      }
    } else if (card.todoTaskId) return false;
    ids.add(card.id);
  }
  return true;
}

export async function handleKanban(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/kanban') return fail('Not found.', 404);
  if (!env.holm.auth.getMember()) return fail('Sign in to continue.', 401);
  const { ds, kv } = env.holm.app.member;
  if (request.method === 'GET') return json({ success: true, data: {
    kanban: ds.find(COLLECTION, {}, { limit: MAX_BOARDS, order: 'desc' }).map(exposed),
    todo: ds.find(TODO, {}, { limit: 200, order: 'desc' }),
    settings: { theme: 'dark', ...(kv.get(SETTINGS) || {}),
      kanbanCards: (kv.get('todo_settings') || {}).kanbanCards || [] },
  } });
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return fail('Board too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object' ||
      Array.isArray(body.data) || 'hash' in body || 'key' in body || 'memberId' in body) return fail('Invalid request.', 400);
  const { action, data } = body;
  if (action === 'updateSettings') {
    const patch = data.settings;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
        !Object.keys(patch).length || Object.keys(patch).some(key => !['theme', 'kanbanCards'].includes(key)) ||
        ('theme' in patch && !['light', 'dark', 'system'].includes(patch.theme)) ||
        ('kanbanCards' in patch && (!Array.isArray(patch.kanbanCards) || patch.kanbanCards.length > 1000 ||
          patch.kanbanCards.some(id => !idOK(id))))) return fail('Invalid settings.', 400);
    if (patch.theme) kv.set(SETTINGS, { ...(kv.get(SETTINGS) || {}), theme: patch.theme });
    if (patch.kanbanCards) kv.set('todo_settings', { ...(kv.get('todo_settings') || {}), kanbanCards: [...new Set(patch.kanbanCards)] });
    return json({ success: true });
  }
  if (action === 'recordOpen') {
    if (!idOK(data.boardId) || !ds.findOne(COLLECTION, data.boardId)) return fail('Board not found.', 404);
    const current = kv.get(SETTINGS) || {};
    kv.set(SETTINGS, { ...current, lastOpened: { ...(current.lastOpened || {}), [data.boardId]: now() } });
    return json({ success: true });
  }
  if (action === 'createBoard') {
    if (data.name !== undefined && !titleOK(data.name)) return fail('Invalid name.', 400);
    const board = ds.transaction(tx => {
      if (tx.count(COLLECTION, {}) >= MAX_BOARDS) return null;
      const timestamp = now();
      const base = { name: data.name?.trim() || 'Untitled Board',
        columns: [{ id: `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, label: 'Untitled List' }],
        rows: [], cards: [], links: [], tagId: null, version: 1,
        createdAt: timestamp, updatedAt: timestamp };
      const id = tx.insert(COLLECTION, base);
      return { id, ...base };
    });
    return board ? json({ success: true, board: exposed(board) }) : fail('Board limit reached.', 409);
  }
  if (!idOK(data.boardId)) return fail('Invalid board ID.', 400);
  if (action === 'updateBoard') {
    if (!Number.isSafeInteger(data.version) || data.version < 1) return fail('Invalid version.', 400);
    const result = ds.transaction(tx => {
      const old = tx.findOne(COLLECTION, data.boardId);
      if (!old) return { status: 404 };
      if (old.version !== data.version) return { status: 409 };
      if (!validBoard(data.board, tx, old)) return { status: 400 };
      const patch = { name: data.board.name.trim(), columns: data.board.columns, rows: data.board.rows,
        cards: data.board.cards, links: data.board.links, version: old.version + 1, updatedAt: now() };
      tx.update(COLLECTION, { id: data.boardId }, { $set: patch });
      return { status: 200, board: exposed({ ...old, ...patch }) };
    });
    if (result.status !== 200) return fail(result.status === 404 ? 'Board not found.' :
      result.status === 409 ? 'Board changed in another tab. Reload before saving.' : 'Invalid board.', result.status);
    return json({ success: true, board: result.board });
  }
  if (action === 'renameBoard' || action === 'deleteBoard') {
    const result = ds.transaction(tx => {
      const old = tx.findOne(COLLECTION, data.boardId);
      if (!old) return { status: 404 };
      if (action === 'renameBoard') {
        if (!titleOK(data.name)) return { status: 400 };
        const patch = { name: data.name.trim(), version: old.version + 1, updatedAt: now() };
        tx.update(COLLECTION, { id: data.boardId }, { $set: patch });
        return { status: 200, board: exposed({ ...old, ...patch }) };
      }
      tx.delete(COLLECTION, { id: data.boardId });
      return { status: 200, deleted: true };
    });
    if (result.status !== 200) return fail(result.status === 404 ? 'Board not found.' : 'Invalid name.', result.status);
    if (result.deleted) {
      const prefs = kv.get(SETTINGS) || {};
      const lastOpened = { ...(prefs.lastOpened || {}) };
      delete lastOpened[data.boardId];
      kv.set(SETTINGS, { ...prefs, lastOpened });
    }
    return json({ success: true, ...result });
  }
  return fail('Unknown action.', 400);
}
