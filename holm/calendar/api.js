// Holm Calendar. Store only the verified member's calendars/events. The
// FullCalendar/rrule/ICS editor still composes occurrences on the client;
// here we validate ownership, payload size, and atomic record versions.
const CAL = 'user_calendars';
const EVENTS = 'calendar_events';
const TODO = 'todo_lists';
const KANBAN = 'kanban_boards';
const MINUTES = 'meeting_minutes';
const TAGS = 'workspace_tags';
const DOCS = 'user_docs';
const SHEETS = 'sheet_records';
const FORMS = 'user_forms';
const SLIDES = 'slide_decks';
const DRAWS = 'canvas_drawings';
const FILES = 'file_records';
const FOLDERS = 'file_folders';
const SETTINGS = 'workdeck_settings';
const MAX_CALS = 100;
const MAX_EVENTS = 2000;
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
const isId = value => typeof value === 'string' && ID.test(value);
const str = (value, max) => typeof value === 'string' && value.length <= max;
const nameOK = value => str(value, 100) && !!value.trim();
const colorOK = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const timestamp = () => new Date().toISOString();
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status) => json({ success: false, error }, status);
const versionOK = value => Number.isSafeInteger(value) && value >= 1;
const timeOK = value => typeof value === 'string' && value.length <= 40 &&
  (/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isNaN(Date.parse(value)));
const exposed = doc => doc;
const calendarRows = ds => ds.find(CAL, {}, { limit: MAX_CALS, order: 'desc' }).map(exposed);
const eventRows = ds => ds.find(EVENTS, {}, { limit: MAX_EVENTS, order: 'desc' }).map(exposed);
function dataOf(ds, kv) {
  return {
    calendars: calendarRows(ds), events: eventRows(ds),
    todo: ds.find(TODO, {}, { limit: 200, order: 'desc' }),
    kanban: ds.find(KANBAN, {}, { limit: 200, order: 'desc' }),
    minutes: ds.find(MINUTES, {}, { limit: 200, order: 'desc' }),
    docs: ds.find(DOCS, {}, { limit: 500, order: 'desc' }),
    sheets: ds.find(SHEETS, {}, { limit: 200, order: 'desc' }),
    forms: ds.find(FORMS, {}, { limit: 200, order: 'desc' }),
    slides: ds.find(SLIDES, {}, { limit: 200, order: 'desc' }),
    draws: ds.find(DRAWS, {}, { limit: 200, order: 'desc' }),
    files: ds.find(FILES, {}, { limit: 2000, order: 'desc' }),
    folders: ds.find(FOLDERS, {}, { limit: 1000, order: 'desc' }), posts: [],
    settings: { theme: 'dark', ...(kv.get(SETTINGS) || {}) },
  };
}
function linkCollection(app) {
  return { todo: TODO, kanban: KANBAN, minutes: MINUTES, calendar: CAL,
    docs: DOCS, sheets: SHEETS, forms: FORMS, slides: SLIDES, draw: DRAWS }[app] || null;
}
function eventOK(value, tx, previous) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !isId(value.calId) || !tx.findOne(CAL, value.calId) ||
      !str(value.title, 300) || !str(value.description || '', 12000) || !str(value.location || '', 500) ||
      typeof value.allDay !== 'boolean' || !timeOK(value.start) || !timeOK(value.end) ||
      (value.allDay !== /^\d{4}-\d{2}-\d{2}$/.test(value.start)) ||
      (value.allDay !== /^\d{4}-\d{2}-\d{2}$/.test(value.end)) ||
      value.end < value.start ||
      (value.rrule != null && !str(value.rrule, 1000)) ||
      (value.duration != null && !str(value.duration, 100)) ||
      (value.origStart != null && !timeOK(value.origStart)) ||
      (value.parentEventId != null && (!isId(value.parentEventId) ||
        !tx.findOne(EVENTS, value.parentEventId))) ||
      (value.exdates !== undefined && (!Array.isArray(value.exdates) || value.exdates.length > 2000 ||
        value.exdates.some(date => !timeOK(date)))) ||
      (value.reminders !== undefined && (!Array.isArray(value.reminders) || value.reminders.length > 24 ||
        value.reminders.some(n => !Number.isInteger(n) || n < 0 || n > 10080))) ||
      (value.links !== undefined && (!Array.isArray(value.links) || value.links.length > 100))) return false;
  // Exception records must be tied to the same owned calendar as their master.
  if (value.parentEventId && tx.findOne(EVENTS, value.parentEventId).calId !== value.calId) return false;
  // Existing broken links can remain to avoid blocking other edits. New links
  // may only point at records in the current member's migrated collections.
  for (const link of value.links || []) {
    if (!link || typeof link !== 'object' || !isId(link.id) || !str(link.name || '', 300) ||
        !(link.app === 'filebox' || linkCollection(link.app))) return false;
    const before = previous?.links?.some(old => old.app === link.app && old.id === link.id);
    const owns = link.app === 'filebox'
      ? tx.findOne(FILES, link.id) || tx.findOne(FOLDERS, link.id)
      : tx.findOne(linkCollection(link.app), link.id);
    if (!before && !owns) return false;
  }
  return true;
}

export async function handleCalendar(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/calendar') return fail('Not found.', 404);
  if (!env.holm.auth.getMember()) return fail('Sign in to continue.', 401);
  const { ds, kv } = env.holm.app.member;
  if (request.method === 'GET') return json({ success: true, data: dataOf(ds, kv) });
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  if (raw.length > 350_000) return fail('Request too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !body.data || typeof body.data !== 'object' || Array.isArray(body.data) ||
      'hash' in body || 'key' in body || 'memberId' in body) return fail('Invalid request.', 400);
  const { action, data } = body;
  if (action === 'updateSettings') {
    const patch = data.settings;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
        !Object.keys(patch).length || Object.keys(patch).some(key => !['theme', 'calendarThumbnail'].includes(key)) ||
        ('theme' in patch && !['light', 'dark', 'system'].includes(patch.theme)) ||
        ('calendarThumbnail' in patch && (typeof patch.calendarThumbnail !== 'string' ||
          patch.calendarThumbnail.length > 260_000 ||
          !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(patch.calendarThumbnail)))) return fail('Invalid settings.', 400);
    kv.set(SETTINGS, { ...(kv.get(SETTINGS) || {}), ...patch });
    return json({ success: true, data: dataOf(ds, kv) });
  }
  let result;
  if (action === 'createCalendar') {
    if (data.name !== undefined && data.name !== '' && !nameOK(data.name) ||
        data.color != null && !colorOK(data.color) ||
        data.tagId && (!isId(data.tagId) || !ds.findOne(TAGS, data.tagId))) return fail('Invalid calendar.', 400);
    result = ds.transaction(tx => {
      if (tx.count(CAL, {}) >= MAX_CALS) return { status: 409 };
      const stamp = timestamp();
      const base = { name: data.name?.trim() || 'Untitled Calendar', color: data.color || '#0284c7',
        visible: true, tagId: data.tagId || null, version: 1, createdAt: stamp, updatedAt: stamp };
      const id = tx.insert(CAL, base);
      return { status: 200, calendar: { ...base, id } };
    });
  } else if (action === 'updateCalendar' || action === 'deleteCalendar') {
    if (!isId(data.calId) || !versionOK(data.version)) return fail('Invalid calendar or version.', 400);
    const updates = data.updates;
    if (action === 'updateCalendar' && (!updates || typeof updates !== 'object' || Array.isArray(updates) ||
        Object.keys(updates).some(key => !['name', 'color', 'visible', 'tagId'].includes(key)) ||
        ('name' in updates && !nameOK(updates.name)) ||
        ('color' in updates && !colorOK(updates.color)) ||
        ('visible' in updates && typeof updates.visible !== 'boolean') ||
        ('tagId' in updates && updates.tagId != null && (!isId(updates.tagId) || !ds.findOne(TAGS, updates.tagId))))) return fail('Invalid calendar updates.', 400);
    result = ds.transaction(tx => {
      const old = tx.findOne(CAL, data.calId);
      if (!old) return { status: 404 };
      if (old.version !== data.version) return { status: 409 };
      if (action === 'updateCalendar') {
        tx.update(CAL, { id: data.calId }, { $set: { ...updates,
          ...(updates.name ? { name: updates.name.trim() } : {}),
          version: old.version + 1, updatedAt: timestamp() } });
        return { status: 200 };
      }
      tx.delete(CAL, { id: data.calId });
      for (const e of tx.find(EVENTS, {}, { limit: MAX_EVENTS }).filter(e => e.calId === data.calId))
        tx.delete(EVENTS, { id: e.id });
      return { status: 200, deleted: true };
    });
  } else if (action === 'createEvent' || action === 'updateEvent' || action === 'deleteEvent') {
    if (action !== 'createEvent' && (!isId(data.eventId) || !versionOK(data.version))) return fail('Invalid event or version.', 400);
    result = ds.transaction(tx => {
      const old = action === 'createEvent' ? null : tx.findOne(EVENTS, data.eventId);
      if (action !== 'createEvent' && !old) return { status: 404 };
      if (old && old.version !== data.version) return { status: 409 };
      if (action === 'deleteEvent') {
        // Deleting a master also removes its exception records.
        for (const e of tx.find(EVENTS, {}, { limit: MAX_EVENTS }).filter(e => e.parentEventId === data.eventId))
          tx.delete(EVENTS, { id: e.id });
        tx.delete(EVENTS, { id: data.eventId });
        return { status: 200, deleted: true };
      }
      if (action === 'createEvent' && tx.count(EVENTS, {}) >= MAX_EVENTS) return { status: 409 };
      if (!eventOK(data.event, tx, old) ||
          old && data.event.calId !== old.calId && data.event.parentEventId) return { status: 400 };
      const input = data.event;
      const record = {
        calId: input.calId, title: input.title, description: input.description || '',
        location: input.location || '', allDay: input.allDay, start: input.start, end: input.end,
        rrule: input.rrule || null, duration: input.duration || null,
        exdates: input.exdates || [], reminders: input.reminders || [], links: input.links || [],
        parentEventId: input.parentEventId || null, origStart: input.origStart || null,
        updatedAt: timestamp(),
      };
      if (old) {
        tx.update(EVENTS, { id: data.eventId }, { $set: { ...record, version: old.version + 1 } });
        return { status: 200 };
      }
      const stamp = record.updatedAt;
      const id = tx.insert(EVENTS, { ...record, version: 1, createdAt: stamp });
      return { status: 200, event: { id, ...record, version: 1, createdAt: stamp } };
    });
  } else return fail('Unknown action.', 400);
  if (result.status !== 200) return fail(result.status === 404 ? 'Record not found.' :
    result.status === 409 ? 'Record changed or limit reached. Reload and try again.' : 'Invalid calendar or event.', result.status);
  if (result.deleted) {
    const prefs = kv.get(SETTINGS) || {};
    const lastOpened = { ...(prefs.lastOpened || {}) };
    delete lastOpened[data.calId || data.eventId];
    kv.set(SETTINGS, { ...prefs, lastOpened });
  }
  return json({ success: true, ...result, data: dataOf(ds, kv) });
}
