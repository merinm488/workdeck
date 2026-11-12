import { generateId, getUserDoc, saveOwnedSections, getSheetBody, putSheetBody, putRawDoc, getRawDoc, deleteRawDoc } from './store.js';

async function owned(hash, app, id) {
  const doc = await getUserDoc(hash);
  if (!doc) throw new Error('Account not found');
  const record = doc[app].find(item => item?.id === id);
  if (!record) throw new Error(`${app} record not found`);
  return { doc, record };
}
async function save(hash, app, doc) {
  if (!(await saveOwnedSections(hash, { [app]: doc[app] }))) throw new Error(`Could not save ${app}`);
}
const stamp = record => { record.updatedAt = new Date().toISOString(); return record; };

export async function addBoardColumn(hash, boardId, label) {
  const { doc, record } = await owned(hash, 'kanban', boardId);
  const column = { id: generateId(), label };
  record.columns.push(column);
  stamp(record);
  await save(hash, 'kanban', doc);
  return column;
}
export async function upsertBoardCard(hash, boardId, fields) {
  const { doc, record } = await owned(hash, 'kanban', boardId);
  const card = fields.cardId && record.cards.find(c => c.id === fields.cardId);
  if (fields.cardId && !card) throw new Error('Card not found');
  if (!card && !fields.label) throw new Error('Card label required');
  const column = fields.column ?? card?.column ?? record.columns[0]?.id;
  if (!record.columns.some(c => c.id === column)) throw new Error('Column not found');
  const result = card || { id: generateId(), label: fields.label, column, checklist: [], createdAt: new Date().toISOString() };
  for (const field of ['label', 'description', 'priority', 'progress']) {
    if (fields[field] !== undefined) result[field] = fields[field];
  }
  result.column = column;
  if (!card) record.cards.push(result);
  stamp(record);
  await save(hash, 'kanban', doc);
  return result;
}

export async function upsertFormQuestion(hash, formId, fields) {
  const { doc, record } = await owned(hash, 'forms', formId);
  if (record.sharedId) throw new Error('Shared forms cannot be edited via MCP; unshare first');
  const components = record.components;
  if (!Array.isArray(components)) throw new Error('Invalid form components');
  const index = fields.questionId ? components.findIndex(c => c.id === fields.questionId) : -1;
  if (fields.questionId && index < 0) throw new Error('Question not found');
  const old = index >= 0 ? components[index] : null;
  const type = fields.type ?? old?.type;
  if (!type) throw new Error('Question type required');
  const label = fields.label ?? old?.label;
  if (!label) throw new Error('Question label required');
  const question = { ...old, id: old?.id || generateId(), type, key: old?.key || `field_${generateId()}`,
    label, validate: { ...(old?.validate || {}), required: fields.required ?? old?.validate?.required ?? false } };
  if (['select', 'radio', 'checklist'].includes(type)) {
    const choices = fields.choices ?? old?.values?.map(v => v.label);
    if (!choices?.length) throw new Error('Choices required');
    question.values = choices.map((choice, i) => ({ label: choice, value: `choice_${i + 1}` }));
  } else delete question.values;
  if (index < 0) {
    const submit = components.findIndex(c => c.type === 'button' && c.action === 'submit');
    components.splice(submit < 0 ? components.length : submit, 0, question);
  } else components[index] = question;
  if (!components.some(c => c.type === 'button' && c.action === 'submit'))
    components.push({ type: 'button', label: 'Submit', action: 'submit' });
  stamp(record);
  await save(hash, 'forms', doc);
  return question;
}

export async function addSlide(hash, deckId, name) {
  const { doc, record } = await owned(hash, 'slides', deckId);
  const slide = { id: generateId(), name: name || `Slide ${record.slides.length + 1}`, background: '#ffffff', objects: [] };
  record.slides.push(slide);
  stamp(record);
  await save(hash, 'slides', doc);
  return slide;
}
export async function addCanvasObject(hash, app, recordId, fields) {
  const { doc, record } = await owned(hash, app, recordId);
  const canvas = app === 'slides' ? record.slides.find(s => s.id === fields.slideId) : record;
  if (!canvas || !Array.isArray(canvas.objects)) throw new Error('Canvas or slide not found');
  const shape = fields.shape || 'text';
  const obj = shape === 'text'
    ? { type: app === 'slides' ? 'textbox' : 'IText', text: fields.text || 'Text', left: fields.left, top: fields.top,
      width: fields.width || 320, fontSize: fields.fontSize || 24, fill: fields.fill || '#1a1a1a' }
    : { type: app === 'slides' ? 'rect' : 'Rect', left: fields.left, top: fields.top, width: fields.width || 160,
      height: fields.height || 100, fill: fields.fill || '#fed7aa' };
  canvas.objects.push(obj);
  stamp(record);
  await save(hash, app, doc);
  return { objectIndex: canvas.objects.length - 1, object: obj };
}

export async function updateCanvasObject(hash, app, recordId, objectIndex, fields) {
  if (!Object.keys(fields).some(key => key !== 'slideId')) throw new Error('At least one object change is required');
  const { doc, record } = await owned(hash, app, recordId);
  const canvas = app === 'slides' ? record.slides.find(s => s.id === fields.slideId) : record;
  const obj = canvas?.objects?.[objectIndex];
  if (!obj) throw new Error('Canvas object not found');
  if (fields.text !== undefined) {
    if (!['textbox', 'IText', 'i-text'].includes(obj.type)) throw new Error('Only text objects accept text');
    obj.text = fields.text;
  }
  for (const key of ['left', 'top', 'fill']) if (fields[key] !== undefined) obj[key] = fields[key];
  stamp(record);
  await save(hash, app, doc);
  return obj;
}

function emptyWorkbook(sheetId, name) {
  const tab = `sheet-${generateId()}`;
  return { id: `wb_${sheetId}`, name, appVersion: '0.25.1', locale: 'enUS', styles: {}, sheetOrder: [tab], sheets: {
    [tab]: { id: tab, name: 'Sheet1', tabColor: '', hidden: 0,
      freeze: { xOffset: 0, yOffset: 0, startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
      rowCount: 84, columnCount: 60, zoomRatio: 1, scrollTop: 0, scrollLeft: 0,
      defaultColumnWidth: 73, defaultRowHeight: 19, mergeData: [], cellData: {}, rowData: {}, columnData: {} } } };
}
export async function createSheet(hash, name) {
  const doc = await getUserDoc(hash);
  if (!doc) throw new Error('Account not found');
  const id = generateId();
  const body = emptyWorkbook(id, name);
  const now = new Date().toISOString();
  const record = { id, name, formatVersion: 2, createdAt: now, updatedAt: now };
  if (!(await putSheetBody(id, body))) throw new Error('Could not create sheet body');
  doc.sheets.push(record);
  try { await save(hash, 'sheets', doc); }
  catch (error) { await deleteRawDoc(`sheet_${id}`).catch(() => {}); throw error; }
  return record;
}
export async function sheetCells(hash, sheetId, cells, tabId) {
  const { doc, record } = await owned(hash, 'sheets', sheetId);
  const body = await getSheetBody(sheetId) || record.data;
  if (!body || !body.sheets) throw new Error('Workbook body not found');
  const tab = body.sheets[tabId || body.sheetOrder?.[0]];
  if (!tab) throw new Error('Sheet tab not found');
  tab.cellData ||= {};
  if (cells) {
    for (const { row, column, value } of cells) {
      tab.cellData[row] ||= {};
      if (value === null) delete tab.cellData[row][column];
      else tab.cellData[row][column] = { v: value, t: typeof value === 'number' ? 2 : typeof value === 'boolean' ? 3 : 1 };
    }
    tab.rowCount = Math.max(tab.rowCount || 0, ...cells.map(c => c.row + 1));
    tab.columnCount = Math.max(tab.columnCount || 0, ...cells.map(c => c.column + 1));
    if (!(await putSheetBody(sheetId, body))) throw new Error('Could not save workbook');
    stamp(record);
    await save(hash, 'sheets', doc);
  }
  return { tabId: tab.id, tabName: tab.name, cells: Object.entries(tab.cellData).flatMap(([row, cols]) =>
    Object.entries(cols).map(([column, cell]) => ({ row: Number(row), column: Number(column), value: cell.v ?? null, formula: cell.f }))).slice(0, 200),
    note: 'Showing at most 200 populated cells' };
}

export async function createFolder(hash, name, parentId) {
  const doc = await getUserDoc(hash);
  if (!doc) throw new Error('Account not found');
  if (parentId && !doc.folders.some(f => f.id === parentId)) throw new Error('Parent folder not found');
  const now = new Date().toISOString();
  const folder = { id: generateId(), name, color: '#FACC15', parentId: parentId || null, tags: [], createdAt: now, updatedAt: now };
  doc.folders.push(folder);
  await save(hash, 'folders', doc);
  return folder;
}
export async function uploadFile(hash, { name, mime, base64, folderId }) {
  const doc = await getUserDoc(hash);
  if (!doc) throw new Error('Account not found');
  if (folderId && !doc.folders.some(f => f.id === folderId)) throw new Error('Folder not found');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.toString('base64') !== base64) throw new Error('Invalid base64 content');
  // MCP tool calls have smaller practical request limits than the Files UI.
  if (bytes.length > 100 * 1024) throw new Error('MCP upload limit is 100 KB; use Workdeck Files for larger files');
  const id = generateId();
  const now = new Date().toISOString();
  const file = { id, name, mime, size: bytes.length, folderId: folderId || null, tags: [], storageKey: `file_${id}`, createdAt: now, updatedAt: now };
  if (!(await putRawDoc(file.storageKey, { bytes: base64 }))) throw new Error('Could not store file bytes');
  doc.files.unshift(file);
  try { await save(hash, 'files', doc); }
  catch (error) { await deleteRawDoc(file.storageKey).catch(() => {}); throw error; }
  const { storageKey, ...safe } = file;
  return safe;
}
export async function readFile(hash, fileId) {
  const { record } = await owned(hash, 'files', fileId);
  if (record.size > 100 * 1024) throw new Error('File too large for MCP transfer');
  const stored = await getRawDoc(record.storageKey);
  if (!stored?.bytes) throw new Error('File bytes unavailable');
  return { name: record.name, mime: record.mime, base64: stored.bytes };
}
