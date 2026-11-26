// Holm Minutes: member-private meetings, without legacy access keys or external storage.
// Meeting revisions and linked Todo actions are saved in ONE member-DS
// transaction, so a meeting can never claim to have created a missing task.
const MINUTES = 'meeting_minutes';
const TODO = 'todo_lists';
const EVENTS = 'calendar_events'; // Calendar will register this collection later.
const PREFS = 'workdeck_settings';
const TYPES = new Set(['discussion', 'decision', 'action', 'information', 'question']);
const STATES = new Set(['draft', 'review', 'final']);
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + 'T00:00:00Z')) ? value : '';
const stamp = () => new Date().toISOString();
const id = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status) => json({ success: false, error }, status);

// Server-side twin of the existing Quill HTML scrub. The reader applies
// DOMPurify again; notes never become an unescaped dashboard title or link.
function scrub(html) {
  return String(html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\s(?:href|src)\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, _lead, value) =>
      /^\s*javascript:/i.test(value.replace(/^["']|["']$/g, '')) ? '' : match);
}
function normalized(input, prior, ds) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !Array.isArray(input.agenda) || input.agenda.length > 100) return null;
  const seen = new Set();
  const unique = value => {
    if (typeof value !== 'string' || !ID.test(value) || seen.has(value)) return false;
    seen.add(value); return true;
  };
  const agenda = [];
  for (const section of input.agenda) {
    if (!section || typeof section !== 'object' || !unique(section.id) ||
        !Array.isArray(section.points) || section.points.length > 200) return null;
    const points = [];
    for (const point of section.points) {
      if (!point || typeof point !== 'object' || !unique(point.id)) return null;
      // Link IDs are NEVER accepted from the browser. Only a previous
      // revision of this member-owned meeting can carry an existing link.
      const old = (prior.agenda || []).flatMap(s => s.points || []).find(p => p.id === point.id);
      points.push({ id: point.id, type: TYPES.has(point.type) ? point.type : 'discussion',
        text: clean(point.text, 2000), notes: scrub(clean(point.notes, 15000)),
        owner: clean(point.owner, 120), dueDate: day(point.dueDate),
        todoListId: old?.todoListId || null, todoTaskId: old?.todoTaskId || null });
    }
    agenda.push({ id: section.id, title: clean(section.title, 200), points });
  }
  const state = STATES.has(input.state) ? input.state : 'draft';
  // Never permit links to another member's Calendar event (none exist yet
  // until Calendar moves); preserve a previously linked event if still present.
  const event = typeof input.calendarEventId === 'string' && ID.test(input.calendarEventId) &&
    ds.findOne(EVENTS, input.calendarEventId) ? input.calendarEventId : null;
  return {
    id: prior.id, title: clean(input.title, 200) || 'Untitled meeting',
    date: day(input.date), startTime: clean(input.startTime, 5), endTime: clean(input.endTime, 5),
    location: clean(input.location, 300), chair: clean(input.chair, 120),
    noteTaker: clean(input.noteTaker, 120), attendees: clean(input.attendees, 1000),
    apologies: clean(input.apologies, 1000), series: clean(input.series, 120),
    calendarEventId: event, state,
    approvedBy: state === 'final' ? clean(input.approvedBy, 120) : '',
    approvedAt: state === 'final' ? (prior.state === 'final' ? prior.approvedAt : stamp()) : null,
    agenda, tagId: prior.tagId || null, createdAt: prior.createdAt,
    updatedAt: stamp(), revision: prior.revision + 1,
  };
}
function taskDescription(meeting, section, owner) {
  return `Responsible: ${owner || 'Unassigned'}\nFrom Minutes: ${meeting.title} · ${section.title || 'Agenda'}\n/minutes/?meeting=${encodeURIComponent(meeting.id)}`.slice(0, 2000);
}
function syncTasks(tx, meeting, prior) {
  const oldPoints = new Map((prior.agenda || []).flatMap(s => s.points || []).map(p => [p.id, p]));
  let list = null;
  const dirtyLists = new Map();
  for (const section of meeting.agenda) for (const point of section.points) {
    if (point.type !== 'action' || !point.text) continue;
    const prev = oldPoints.get(point.id);
    const dest = point.todoListId && (dirtyLists.get(point.todoListId) || tx.findOne(TODO, point.todoListId));
    const task = dest?.items?.find(item => item.id === point.todoTaskId);
    if (task) {
      let changed = false;
      if (point.text !== prev?.text) { task.title = point.text.slice(0, 200); changed = true; }
      if (point.dueDate !== prev?.dueDate) { task.dueDate = point.dueDate || null; changed = true; }
      if (point.owner !== prev?.owner || task.description === taskDescription(prior, section, prev?.owner) && task.description !== taskDescription(meeting, section, point.owner)) {
        task.description = taskDescription(meeting, section, point.owner); changed = true;
      }
      if (changed) dirtyLists.set(dest.id, dest);
    } else if (!point.todoTaskId) {
      if (!list || list.items.length >= 256) {
        list = [...dirtyLists.values(), ...tx.find(TODO, {}, { limit: 200 }).filter(row => !dirtyLists.has(row.id))].find(row =>
          row.name === 'Meeting actions' && row.items.length < 256) || null;
        if (!list) {
          if (tx.count(TODO, {}) >= 200) throw new Error('Todo list limit reached');
          const createdAt = stamp();
          const base = { name: 'Meeting actions', items: [], version: 1, updatedAt: createdAt, createdAt };
          const newId = tx.insert(TODO, base);
          list = { ...base, id: newId };
        }
      }
      if (list.items.length >= 256) throw new Error('Todo list is full');
      const taskId = id('task');
      list.items.push({ id: taskId, title: point.text.slice(0, 200),
        description: taskDescription(meeting, section, point.owner),
        dueDate: point.dueDate || null, priority: 'medium', completed: false,
        createdAt: stamp() });
      dirtyLists.set(list.id, list);
      point.todoListId = list.id; point.todoTaskId = taskId;
    }
    // Removed Todo tasks keep a broken link for the existing warning UI.
  }
  for (const row of dirtyLists.values()) {
    tx.update(TODO, { id: row.id }, { $set: {
      items: row.items, version: row.version + 1, updatedAt: stamp(),
    } });
  }
}

export async function handleMinutes(request, env) {
  if (new URL(request.url).pathname !== '/api/minutes') return fail('Not found.', 404);
  if (!env.holm.auth.getMember()) return fail('Sign in to continue.', 401);
  const { ds, kv } = env.holm.app.member;
  if (request.method === 'GET') return json({ success: true, data: {
    minutes: ds.find(MINUTES, {}, { limit: 200, order: 'desc' }),
    tags: ds.find('workspace_tags', {}, { limit: 200, order: 'desc' }),
    todo: ds.find(TODO, {}, { limit: 200, order: 'desc' }),
    events: ds.find(EVENTS, {}, { limit: 2000, order: 'desc' }),
    settings: { theme: 'dark', ...(kv.get(PREFS) || {}) },
  } });
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  if (raw.length > 400_000) return fail('Meeting too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.data || typeof body.data !== 'object' ||
      Array.isArray(body.data) || 'hash' in body || 'key' in body || 'memberId' in body) return fail('Invalid request.', 400);
  const { action, data } = body;
  if (action === 'create') {
    if (data.title !== undefined && typeof data.title !== 'string') return fail('Invalid title.', 400);
    const meeting = ds.transaction(tx => {
      if (tx.count(MINUTES, {}) >= 200) return null;
      const timestamp = stamp();
      const base = { title: clean(data.title, 200) || 'Untitled meeting',
        date: day(data.date) || timestamp.slice(0, 10), state: 'draft',
        revision: 0, agenda: [], tagId: null, createdAt: timestamp, updatedAt: timestamp };
      const newId = tx.insert(MINUTES, base);
      return { id: newId, ...base };
    });
    return meeting ? json({ success: true, meeting }) : fail('Meeting limit reached.', 409);
  }
  if (typeof data.id !== 'string' || !ID.test(data.id)) return fail('Invalid meeting ID.', 400);
  if (action === 'setActionCompleted') {
    if (typeof data.pointId !== 'string' || !ID.test(data.pointId) || typeof data.completed !== 'boolean' ||
        Object.keys(data).some(key => !['id', 'pointId', 'completed'].includes(key))) return fail('Invalid task completion request.', 400);
    let result;
    try {
      result = ds.transaction(tx => {
        const meeting = tx.findOne(MINUTES, data.id);
        if (!meeting) return { error: 'Meeting not found.', status: 404 };
        const point = (meeting.agenda || []).flatMap(section => section.points || []).find(point => point.id === data.pointId && point.type === 'action');
        if (!point) return { error: 'Action item not found. Refresh the meeting and try again.', status: 404 };
        // Resolve links from the stored member-owned meeting, never from client IDs.
        const list = point.todoListId && tx.findOne(TODO, point.todoListId);
        const task = list?.items?.find(item => item.id === point.todoTaskId);
        if (!task) return { error: 'The linked Todo task is unavailable. Refresh the action items.', status: 409 };
        // Follow-ups may be completed after finalization: the meeting itself stays frozen.
        // Patch only completion on the latest list, preserving concurrent Todo edits.
        if (task.completed !== data.completed) {
          task.completed = data.completed;
          list.version += 1; list.updatedAt = stamp();
          tx.update(TODO, { id: list.id }, { $set: { items: list.items, version: list.version, updatedAt: list.updatedAt } });
        }
        return { status: 200, todoList: list };
      });
    } catch {
      return fail('Could not update task completion. Please try again.', 503);
    }
    return result.error ? fail(result.error, result.status) : json({ success: true, todoList: result.todoList });
  }
  if (action === 'save') {
    if (!Number.isSafeInteger(data.revision) || data.revision < 0) return fail('Invalid revision.', 400);
    let result;
    try {
      result = ds.transaction(tx => {
        const previous = tx.findOne(MINUTES, data.id);
        if (!previous) return { status: 404 };
        if (previous.revision !== data.revision) return { status: 409 };
        const meeting = normalized(data, previous, tx);
        if (!meeting) return { status: 400 };
        // The published/final record is frozen until reopened as a draft.
        if (previous.state === 'final' && meeting.state !== 'draft') return { status: 400 };
        syncTasks(tx, meeting, previous);
        tx.update(MINUTES, { id: data.id }, { $set: meeting });
        return { status: 200, meeting };
      });
    } catch (error) {
      return fail(error.message === 'Todo list limit reached' || error.message === 'Todo list is full'
        ? error.message : 'Could not save Minutes.', 409);
    }
    if (result.status !== 200) return fail(result.status === 404 ? 'Meeting not found.' :
      result.status === 409 ? 'This meeting changed elsewhere. Reload before editing further.' : 'Invalid meeting.', result.status);
    return json({ success: true, meeting: result.meeting,
      todo: ds.find(TODO, {}, { limit: 200, order: 'desc' }) });
  }
  if (action === 'delete') {
    const deleted = ds.transaction(tx => {
      if (!tx.findOne(MINUTES, data.id)) return false;
      tx.delete(MINUTES, { id: data.id });
      return true;
    });
    if (!deleted) return fail('Meeting not found.', 404);
    const prefs = kv.get(PREFS) || {};
    const lastOpened = { ...(prefs.lastOpened || {}) };
    delete lastOpened[data.id];
    kv.set(PREFS, { ...prefs, lastOpened });
    // Linked Todo tasks intentionally outlive the meeting.
    return json({ success: true });
  }
  return fail('Unknown action.', 400);
}
