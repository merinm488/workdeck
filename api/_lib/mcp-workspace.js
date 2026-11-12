import { generateId, getUserDoc, saveOwnedSections, getSheetBody, putSheetBody } from './store.js';
import { createPostRecord, scrubPostHtml, deriveExcerpt } from './posts.js';

// Explicit allowlist: never expose settings, account keys, OAuth grants, tags or raw file bytes.
export const COLLECTIONS = ['docs', 'sheets', 'forms', 'slides', 'draws', 'files', 'folders', 'todo', 'calendars', 'events', 'kanban', 'posts'];
const CREATE_SEPARATELY = new Set(['sheets', 'files', 'folders', 'todo']); // Dedicated content tools.

async function account(hash) {
  const doc = await getUserDoc(hash);
  if (!doc) throw new Error('Account not found');
  return doc;
}
function collection(doc, app) {
  if (!COLLECTIONS.includes(app)) throw new Error('Unknown Workdeck collection');
  return doc[app];
}
function summary(item, app) {
  return { id: item.id, name: item.name ?? item.title ?? item.label ?? null,
    ...(app === 'events' ? { calId: item.calId, start: item.start, end: item.end } : {}),
    updatedAt: item.updatedAt ?? null };
}
export async function listRecords(hash, app, offset, limit) {
  const records = collection(await account(hash), app).filter(item => item && item.id);
  return { total: records.length, records: records.slice(offset, offset + limit).map(item => summary(item, app)) };
}
export async function readRecord(hash, app, recordId) {
  const record = collection(await account(hash), app).find(item => item?.id === recordId);
  if (!record) throw new Error('Record not found');
  // Old sheet records can still carry an inline workbook; file metadata can
  // contain internal storage pointers. Neither belongs in an MCP result.
  const safeRecord = app === 'sheets'
    ? Object.fromEntries(Object.entries(record).filter(([key]) => !['data', 'thumbnail'].includes(key)))
    : app === 'files'
      ? Object.fromEntries(Object.entries(record).filter(([key]) => !['storageKey', 'bytes', 'base64', 'data'].includes(key)))
      : record;
  const text = JSON.stringify(safeRecord);
  if (Buffer.byteLength(text) > 64000) throw new Error('Record is too large for MCP');
  return safeRecord;
}
async function save(hash, app, doc) {
  if (!(await saveOwnedSections(hash, { [app]: doc[app] }))) throw new Error('Could not save Workdeck changes');
}
export async function createRecord(hash, app, fields) {
  if (!COLLECTIONS.includes(app) || CREATE_SEPARATELY.has(app)) throw new Error('Use the dedicated creation tool for this collection');
  const doc = await account(hash);
  const now = new Date().toISOString();
  let id = generateId();
  while (doc[app].some(item => item?.id === id)) id = generateId();
  const name = fields.name || 'Untitled';
  let record;
  switch (app) {
    case 'docs': record = { id, title: name, content: fields.content || '', contentType: 'plain-text', tagId: null, pinned: false, archived: false, createdAt: now, updatedAt: now }; break;
    case 'posts': record = createPostRecord(id, { title: name, html: fields.content || '', posts: doc.posts }); break;
    case 'calendars': record = { id, name, color: '#0284c7', visible: true, tagId: null, createdAt: now, updatedAt: now }; break;
    case 'events': {
      if (!fields.calId || !doc.calendars.some(c => c?.id === fields.calId)) throw new Error('Existing calendar ID required');
      if (!fields.start || !fields.end || !Number.isFinite(Date.parse(fields.start)) || !Number.isFinite(Date.parse(fields.end)) || Date.parse(fields.start) > Date.parse(fields.end)) throw new Error('Valid start and end required');
      record = { id, calId: fields.calId, title: name, description: fields.content || '', start: fields.start, end: fields.end, allDay: false, createdAt: now, updatedAt: now }; break;
    }
    case 'kanban': record = { id, name, columns: [{ id: generateId(), label: 'Untitled List' }], rows: [], cards: [], links: [], createdAt: now, updatedAt: now }; break;
    case 'forms': record = { id, name, display: 'form', components: [{ type: 'button', label: 'Submit', action: 'submit' }], sharedId: null, createdAt: now, updatedAt: now }; break;
    case 'slides': record = { id, name, formatVersion: 1, width: 960, height: 540, slides: [{ id: 's1', name: 'Slide 1', background: '#ffffff', objects: [] }], sharedId: null, createdAt: now, updatedAt: now }; break;
    case 'draws': record = { id, name, formatVersion: 1, background: '#ffffff', objects: [], viewport: { zoom: 1, panX: 0, panY: 0 }, sharedId: null, createdAt: now, updatedAt: now }; break;
  }
  doc[app].unshift(record);
  await save(hash, app, doc);
  return record;
}
export async function updateRecord(hash, app, recordId, changes) {
  if (!COLLECTIONS.includes(app) || app === 'todo') throw new Error('Use Todo tools to update tasks');
  if (!Object.keys(changes).length) throw new Error('At least one field required');
  const doc = await account(hash);
  const record = doc[app].find(item => item?.id === recordId);
  if (!record) throw new Error('Record not found');
  if (app === 'posts' && record.publishedAt) throw new Error('Published posts cannot be edited via MCP');
  if (changes.name !== undefined) record[app === 'docs' || app === 'posts' || app === 'events' ? 'title' : 'name'] = changes.name;
  if (app === 'sheets' && changes.name !== undefined) {
    const body = await getSheetBody(recordId);
    if (body) {
      body.name = changes.name;
      if (!(await putSheetBody(recordId, body))) throw new Error('Could not rename spreadsheet body');
    }
  }
  if (changes.content !== undefined) {
    if (app === 'docs') {
      if (record.contentType !== 'plain-text') throw new Error('Only plain-text documents can be edited via MCP');
      record.content = changes.content;
    }
    else if (app === 'posts') {
      record.html = scrubPostHtml(changes.content);
      record.excerpt = deriveExcerpt(record.html);
    } else if (app === 'events') record.description = changes.content;
    else throw new Error('Content updates are not supported for this collection');
  }
  if (changes.start !== undefined || changes.end !== undefined) {
    if (app !== 'events') throw new Error('Dates are only supported for events');
    const start = changes.start ?? record.start;
    const end = changes.end ?? record.end;
    if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) > Date.parse(end)) throw new Error('Valid start and end required');
    record.start = start;
    record.end = end;
  }
  record.updatedAt = new Date().toISOString();
  await save(hash, app, doc);
  return record;
}
