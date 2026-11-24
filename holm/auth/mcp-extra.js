// Additional Holm-native MCP handlers mirroring the legacy connector. Holm
// verifies identity/consent before invocation; only member DS is touched.
import { createPostRecord, scrubPostHtml, deriveExcerpt } from './posts.js';
import { createSheet as createSheetRecord } from './sheets.js';

const COL = { docs: 'user_docs', sheets: 'sheet_records', forms: 'user_forms',
  slides: 'slide_decks', draws: 'canvas_drawings', files: 'file_records',
  folders: 'file_folders', calendars: 'user_calendars', events: 'calendar_events',
  kanban: 'kanban_boards', posts: 'blog_posts' };
const MAX = { docs: 500, sheets: 200, forms: 200, slides: 200, draws: 200,
  files: 2000, folders: 1000, calendars: 100, events: 2000, kanban: 200, posts: 200 };
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID().replaceAll('-', '');
const dsOf = env => env.holm.app.member.ds;
function get(tx, app, id) {
  if (!idOK(id) || !COL[app]) throw new Error('Invalid record');
  const row = tx.findOne(COL[app], id);
  if (!row) throw new Error('Record not found');
  return row;
}
function nonblank(value, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('Invalid name');
  return value.trim();
}
function limit(tx, app) {
  if (tx.count(COL[app], {}) >= MAX[app]) throw new Error('Workdeck record limit reached');
}
function changed(tx, app, row, patch) {
  const next = { ...patch, updatedAt: now(), version: (row.version || 1) + 1 };
  tx.update(COL[app], { id: row.id }, { $set: next });
  return { ...row, ...next };
}
function assertPrivate(row) {
  if (row.sharedId) throw new Error('Unshare in Workdeck before editing via AI');
}
function textDate(value) {
  return typeof value === 'string' && value.length <= 40 &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:/.test(value) &&
    /(?:Z|[+-]\d\d:\d\d)$/.test(value) && !Number.isNaN(Date.parse(value));
}
function eventRange(start, end) {
  if (!textDate(start) || !textDate(end) || Date.parse(start) > Date.parse(end)) throw new Error('Invalid event dates');
}
export function workspaceCreate({ app, name, content, calId, start, end }, env) {
  if (!['docs', 'posts', 'calendars', 'events', 'kanban', 'forms', 'slides', 'draws'].includes(app))
    throw new Error('Use the dedicated creation tool for this app');
  const ds = dsOf(env);
  return ds.transaction(tx => {
    limit(tx, app);
    const stamp = now(), title = nonblank(name || 'Untitled', 100);
    let row;
    switch (app) {
      case 'docs': row = { title, content: content || '', contentType: 'plain-text', pinned: false, archived: false }; break;
      case 'posts': {
        const post = createPostRecord(null, { title, posts: tx.find(COL.posts, {}, { limit: 200 }) });
        const { id: unused, ...fields } = post;
        row = { ...fields, html: scrubPostHtml(content || '') };
        row.excerpt = deriveExcerpt(row.html);
        break;
      }
      case 'calendars': row = { name: title, color: '#0284c7', visible: true }; break;
      case 'events':
        get(tx, 'calendars', calId);
        eventRange(start, end);
        row = { calId, title, description: content || '', start, end, location: '',
          allDay: false, rrule: null, duration: null, exdates: [], reminders: [], links: [], parentEventId: null, origStart: null }; break;
      case 'kanban': row = { name: title, columns: [{ id: newId(), label: 'Untitled List' }], rows: [], cards: [], links: [] }; break;
      case 'forms': row = { name: title, display: 'form', components: [{ type: 'button', label: 'Submit', action: 'submit' }] }; break;
      case 'slides': row = { name: title, formatVersion: 1, width: 960, height: 540,
        slides: [{ id: 's1', name: 'Slide 1', background: '#ffffff', objects: [] }] }; break;
      case 'draws': row = { name: title, formatVersion: 1, background: '#ffffff', objects: [],
        viewport: { zoom: 1, panX: 0, panY: 0 } }; break;
    }
    const id = tx.insert(COL[app], { ...row, version: 1, createdAt: stamp, updatedAt: stamp });
    return { id, ...row, version: 1, createdAt: stamp, updatedAt: stamp };
  });
}
export function workspaceUpdate({ app, recordId, name, content, start, end }, env) {
  if (!COL[app] || app === 'calendars' && (content !== undefined || start !== undefined || end !== undefined)) throw new Error('Unsupported update');
  if (name === undefined && content === undefined && start === undefined && end === undefined) throw new Error('No changes supplied');
  const ds = dsOf(env);
  return ds.transaction(tx => {
    const row = get(tx, app, recordId);
    if (app === 'posts' && row.publishedAt) throw new Error('Published posts cannot be edited via AI');
    if (['docs', 'forms', 'slides', 'draws', 'sheets'].includes(app)) assertPrivate(row);
    if (content !== undefined && !['docs', 'posts', 'events'].includes(app)) throw new Error('Content updates not supported');
    if ((start !== undefined || end !== undefined) && app !== 'events') throw new Error('Dates only apply to events');
    const patch = {};
    if (name !== undefined) patch[['docs', 'posts', 'events'].includes(app) ? 'title' : 'name'] = nonblank(name, 100);
    if (content !== undefined) {
      if (app === 'docs' && row.contentType !== 'plain-text') throw new Error('Only plain-text documents can be edited via AI');
      if (app === 'posts') { patch.html = scrubPostHtml(content); patch.excerpt = deriveExcerpt(patch.html); }
      else patch[app === 'docs' ? 'content' : 'description'] = content;
    }
    if (app === 'events') {
      if (start !== undefined || end !== undefined) {
        eventRange(start || row.start, end || row.end);
        if (start !== undefined) patch.start = start;
        if (end !== undefined) patch.end = end;
      }
    }
    if (app === 'sheets' && name !== undefined) {
      const body = tx.find('sheet_bodies', { sheetId: recordId }, { limit: 1 })[0];
      if (body) tx.update('sheet_bodies', { id: body.id }, { $set: { data: { ...body.data, name: patch.name } } });
    }
    return changed(tx, app, row, patch);
  });
}
export function todoRenameList({ listId, name }, env) {
  return dsOf(env).transaction(tx => {
    const row = tx.findOne('todo_lists', listId);
    if (!row || !idOK(listId)) throw new Error('List not found');
    const updated = { name: nonblank(name, 100), version: row.version + 1, updatedAt: now() };
    tx.update('todo_lists', { id: listId }, { $set: updated });
    return { id: listId, ...updated };
  });
}
export function kanbanCreateBoard({ name }, env) { return workspaceCreate({ app: 'kanban', name }, env); }
export function kanbanAddColumn({ boardId, label }, env) {
  return dsOf(env).transaction(tx => {
    const board = get(tx, 'kanban', boardId);
    if ((board.columns || []).length >= 100) throw new Error('Column limit reached');
    const column = { id: newId(), label: nonblank(label, 100) };
    changed(tx, 'kanban', board, { columns: [...board.columns, column] });
    return column;
  });
}
export function kanbanUpsertCard({ boardId, cardId, column, label, description, priority, progress }, env) {
  return dsOf(env).transaction(tx => {
    const board = get(tx, 'kanban', boardId);
    const cards = [...(board.cards || [])];
    const index = cardId ? cards.findIndex(c => c.id === cardId) : -1;
    if (cardId && index < 0) throw new Error('Card not found');
    if (index < 0 && cards.length >= 1000) throw new Error('Card limit reached');
    const chosen = column || (index >= 0 ? cards[index].column : board.columns?.[0]?.id);
    if (!board.columns?.some(c => c.id === chosen)) throw new Error('Column not found');
    if (index < 0 && !label) throw new Error('Card label required');
    const card = index >= 0 ? { ...cards[index] } : { id: newId(), column: chosen, checklist: [], createdAt: now() };
    if (label !== undefined) card.label = nonblank(label);
    if (description !== undefined) card.description = description;
    if (priority !== undefined) card.priority = priority;
    if (progress !== undefined) card.progress = progress;
    card.column = chosen;
    if (index < 0) cards.push(card); else cards[index] = card;
    changed(tx, 'kanban', board, { cards });
    return card;
  });
}
export function formCreate({ name }, env) { return workspaceCreate({ app: 'forms', name }, env); }
export function formUpsertQuestion({ formId, questionId, label, type, required, choices }, env) {
  return dsOf(env).transaction(tx => {
    const form = get(tx, 'forms', formId);
    assertPrivate(form);
    const components = [...(form.components || [])];
    const index = questionId ? components.findIndex(c => c.id === questionId) : -1;
    if (questionId && index < 0) throw new Error('Question not found');
    if (index < 0 && components.length >= 200) throw new Error('Form question limit reached');
    const old = index >= 0 ? components[index] : null;
    const kind = type || old?.type;
    if (!kind || kind === 'button') throw new Error('Question type required');
    const text = nonblank(label || old?.label, 200);
    const question = { ...old, id: old?.id || newId(), key: old?.key || 'field_' + newId(),
      type: kind, label: text, validate: { ...(old?.validate || {}), required: required ?? old?.validate?.required ?? false } };
    if (['select', 'radio', 'checklist'].includes(kind)) {
      const options = choices || old?.values?.map(v => v.label);
      if (!options?.length) throw new Error('Choices required');
      question.values = options.map((choice, i) => ({ label: nonblank(choice, 100), value: 'choice_' + (i + 1) }));
    } else delete question.values;
    if (index < 0) {
      const submit = components.findIndex(c => c.type === 'button' && c.action === 'submit');
      components.splice(submit < 0 ? components.length : submit, 0, question);
    } else components[index] = question;
    if (!components.some(c => c.type === 'button' && c.action === 'submit'))
      components.push({ type: 'button', label: 'Submit', action: 'submit' });
    changed(tx, 'forms', form, { components });
    return question;
  });
}
export function slidesCreateDeck({ name }, env) { return workspaceCreate({ app: 'slides', name }, env); }
export function drawCreate({ name }, env) { return workspaceCreate({ app: 'draws', name }, env); }
export function slidesAddSlide({ deckId, name }, env) {
  return dsOf(env).transaction(tx => {
    const deck = get(tx, 'slides', deckId);
    assertPrivate(deck);
    if (!Array.isArray(deck.slides) || deck.slides.length >= 200) throw new Error('Slide limit reached');
    const slide = { id: newId(), name: name || `Slide ${deck.slides.length + 1}`, background: '#ffffff', objects: [] };
    changed(tx, 'slides', deck, { slides: [...deck.slides, slide] });
    return slide;
  });
}
export function canvasAddObject({ app, recordId, slideId, shape = 'text', text, left, top, width, height, fontSize, fill }, env) {
  if (!['slides', 'draws'].includes(app)) throw new Error('Invalid canvas app');
  return dsOf(env).transaction(tx => {
    const row = get(tx, app, recordId);
    assertPrivate(row);
    const slides = app === 'slides' ? [...row.slides] : null;
    const index = slides?.findIndex(s => s.id === slideId);
    if (app === 'slides' && (index < 0 || !slideId)) throw new Error('Slide not found');
    const canvas = app === 'slides' ? { ...slides[index] } : row;
    if (!Array.isArray(canvas.objects) || canvas.objects.length >= 2000) throw new Error('Canvas is full');
    const object = shape === 'text'
      ? { type: app === 'slides' ? 'textbox' : 'IText', text: text || 'Text', left, top,
        width: width || 320, fontSize: fontSize || 24, fill: fill || '#1a1a1a' }
      : { type: app === 'slides' ? 'rect' : 'Rect', left, top, width: width || 160,
        height: height || 100, fill: fill || '#fed7aa' };
    const objects = [...canvas.objects, object];
    if (slides) { slides[index] = { ...canvas, objects }; changed(tx, app, row, { slides }); }
    else changed(tx, app, row, { objects });
    return { objectIndex: objects.length - 1, object };
  });
}
export function canvasUpdateObject({ app, recordId, slideId, objectIndex, text, left, top, fill }, env) {
  if (!['slides', 'draws'].includes(app)) throw new Error('Invalid canvas app');
  if (text === undefined && left === undefined && top === undefined && fill === undefined) throw new Error('No object changes');
  return dsOf(env).transaction(tx => {
    const row = get(tx, app, recordId);
    assertPrivate(row);
    const slides = app === 'slides' ? [...row.slides] : null;
    const index = slides?.findIndex(s => s.id === slideId);
    if (app === 'slides' && (index < 0 || !slideId)) throw new Error('Slide not found');
    const canvas = app === 'slides' ? { ...slides[index] } : row;
    const objects = [...canvas.objects];
    if (!objects[objectIndex]) throw new Error('Canvas object not found');
    const obj = { ...objects[objectIndex] };
    if (text !== undefined) {
      if (!['textbox', 'IText', 'i-text'].includes(obj.type)) throw new Error('Only text objects accept text');
      obj.text = text;
    }
    if (left !== undefined) obj.left = left;
    if (top !== undefined) obj.top = top;
    if (fill !== undefined) obj.fill = fill;
    objects[objectIndex] = obj;
    if (slides) { slides[index] = { ...canvas, objects }; changed(tx, app, row, { slides }); }
    else changed(tx, app, row, { objects });
    return obj;
  });
}
export function slidesAddText({ deckId, ...fields }, env) { return canvasAddObject({ app: 'slides', recordId: deckId, ...fields }, env); }
export function drawAddText({ drawingId, ...fields }, env) { return canvasAddObject({ app: 'draws', recordId: drawingId, ...fields }, env); }
export function sheetCreate({ name }, env) {
  return dsOf(env).transaction(tx => {
    const created = createSheetRecord(tx);
    if (!created) throw new Error('Sheet limit reached');
    const body = tx.find('sheet_bodies', { sheetId: created.id }, { limit: 1 })[0];
    tx.update('sheet_records', { id: created.id }, { $set: { name: nonblank(name, 100) } });
    if (body) tx.update('sheet_bodies', { id: body.id }, { $set: { data: { ...body.data, name } } });
    return { ...created, name };
  });
}
function sheetData(tx, sheetId, tabId, cells) {
  const sheet = get(tx, 'sheets', sheetId);
  if (cells) assertPrivate(sheet);
  const row = tx.find('sheet_bodies', { sheetId }, { limit: 1 })[0];
  if (!row?.data?.sheets) throw new Error('Workbook body not found');
  const workbook = row.data;
  const tab = workbook.sheets[tabId || workbook.sheetOrder?.[0]];
  if (!tab) throw new Error('Sheet tab not found');
  let source = tab.cellData || {};
  if (cells) {
    if (!Array.isArray(cells) || !cells.length || cells.length > 100 || cells.some(c =>
      !Number.isInteger(c.row) || c.row < 0 || c.row > 9999 ||
      !Number.isInteger(c.column) || c.column < 0 || c.column > 999 ||
      c.value !== null && typeof c.value !== 'boolean' &&
      (typeof c.value === 'string' ? c.value.length > 4000 :
        typeof c.value !== 'number' || !Number.isFinite(c.value)))) throw new Error('Invalid cells');
    const next = { ...tab, cellData: { ...tab.cellData } };
    for (const { row: r, column, value } of cells) {
      const cols = { ...(next.cellData[r] || {}) };
      if (value === null) delete cols[column];
      else cols[column] = { v: value, t: typeof value === 'number' ? 2 : typeof value === 'boolean' ? 3 : 1 };
      next.cellData[r] = cols;
    }
    next.rowCount = Math.max(next.rowCount || 0, ...cells.map(c => c.row + 1));
    next.columnCount = Math.max(next.columnCount || 0, ...cells.map(c => c.column + 1));
    tx.update('sheet_bodies', { id: row.id }, { $set: { data: { ...workbook, sheets: { ...workbook.sheets, [tab.id]: next } } } });
    changed(tx, 'sheets', sheet, {});
    source = next.cellData;
  }
  return { tabId: tab.id, tabName: tab.name, cells: Object.entries(source).flatMap(([r, cols]) =>
    Object.entries(cols).filter(([, cell]) => cell && cell.v !== undefined).map(([col, cell]) =>
      ({ row: Number(r), column: Number(col), value: cell.v ?? null, ...(cell.f ? { formula: cell.f } : {}) }))).slice(0, 200),
    note: 'Showing at most 200 populated cells' };
}
export function sheetReadCells({ sheetId, tabId }, env) { return sheetData(dsOf(env), sheetId, tabId); }
export function sheetWriteCells({ sheetId, tabId, cells }, env) {
  return dsOf(env).transaction(tx => sheetData(tx, sheetId, tabId, cells));
}
export function sheetCells({ sheetId, tabId, cells }, env) {
  return cells ? sheetWriteCells({ sheetId, tabId, cells }, env) : sheetReadCells({ sheetId, tabId }, env);
}
export function folderCreate({ name, parentId }, env) {
  return dsOf(env).transaction(tx => {
    limit(tx, 'folders');
    if (parentId) get(tx, 'folders', parentId);
    const stamp = now();
    const row = { name: nonblank(name, 255), color: '#FACC15', parentId: parentId || null,
      tags: [], createdAt: stamp, updatedAt: stamp };
    return { id: tx.insert('file_folders', row), ...row };
  });
}
function validBase64(value) {
  if (typeof value !== 'string' || value.length > 140000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error('Invalid base64');
  const decoded = atob(value);
  if (!decoded.length || decoded.length > 100 * 1024 || btoa(decoded) !== value) throw new Error('MCP file size limit is 100 KB');
  return decoded.length;
}
export function fileUpload({ name, mime, base64, folderId }, env) {
  const size = validBase64(base64);
  return dsOf(env).transaction(tx => {
    limit(tx, 'files');
    if (folderId) get(tx, 'folders', folderId);
    const stamp = now();
    const fields = { name: nonblank(name, 255), mime, size, folderId: folderId || null,
      tags: [], thumbnailCover: false, thumbVer: 0, thumbRef: 0,
      createdAt: stamp, updatedAt: stamp };
    const id = tx.insert('file_records', fields);
    tx.insert('file_contents', { fileId: id, base64 });
    return { id, ...fields };
  });
}
export function fileRead({ fileId }, env) {
  const ds = dsOf(env);
  const file = get(ds, 'files', fileId);
  if (file.size > 100 * 1024) throw new Error('File too large for MCP transfer');
  const bytes = ds.find('file_contents', { fileId }, { limit: 1 })[0];
  if (!bytes?.base64) throw new Error('File bytes unavailable');
  return { name: file.name, mime: file.mime, base64: bytes.base64 };
}
