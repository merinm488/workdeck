// Build-time source for the remaining legacy MCP tool schemas. The build emits
// one static api/contract.json, as required by Holm App Spec v1.
const str = (minLength = 1, maxLength = 300) => ({ type: 'string', minLength, maxLength });
const id = str(1, 128), title = str(), body = { type: 'string', maxLength: 16000 };
const num = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const kind = (...values) => ({ type: 'string', enum: values });
const date = { type: 'string', maxLength: 40, minLength: 10 };
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const bool = { type: 'boolean' };
const cell = { type: 'object', properties: { row: integer(0, 9999), column: integer(0, 999),
  value: { type: ['string', 'number', 'boolean', 'null'] } }, required: ['row', 'column', 'value'], additionalProperties: false };
const cells = { type: 'array', items: cell, minItems: 1, maxItems: 100 };
const point = { left: num(-100000, 100000), top: num(-100000, 100000) };
const style = { width: num(1, 10000), fontSize: num(1, 300), fill: color };
const canvas = { ...point, ...style, height: num(1, 10000), shape: kind('text', 'rect'), text: str(0, 4000), slideId: id };
const sheetArgs = { sheetId: id, tabId: id };
const app = kind('docs', 'sheets', 'forms', 'slides', 'draws', 'files', 'folders',
  'todo', 'minutes', 'calendars', 'events', 'kanban', 'posts');
const make = (summary, handler, risk, properties, required = []) => ({ summary, handler, auth: 'user', risk,
  ...(risk === 'write' ? { idempotency: 'optional' } : {}),
  input: { type: 'object', properties, required, additionalProperties: false }, output: { type: 'object' } });
export const operations = {
  'todo.rename.list': make('Rename an existing Todo list', 'todoRenameList', 'write', { listId: id, name: title }, ['listId', 'name']),
  'workspace.create': make('Create a document, blog draft, calendar, event, board, form, deck or drawing; other apps use dedicated tools',
    'workspaceCreate', 'write', { app, name: title, content: body, calId: id, start: date, end: date }, ['app']),
  'workspace.update': make('Rename a record, change plain-text Doc or blog draft content, or edit event details; does not publish or delete',
    'workspaceUpdate', 'write', { app, recordId: id, name: title, content: body, start: date, end: date }, ['app', 'recordId']),
  'kanban.create.board': make('Create a board with one empty column', 'kanbanCreateBoard', 'write', { name: title }, ['name']),
  'kanban.add.column': make('Add a column to a board', 'kanbanAddColumn', 'write', { boardId: id, label: title }, ['boardId', 'label']),
  'kanban.upsert.card': make('Add or update a card; use workspace_read to find column IDs', 'kanbanUpsertCard', 'write',
    { boardId: id, cardId: id, column: id, label: title, description: { type: 'string', maxLength: 4000 },
      priority: kind('low', 'medium', 'high'), progress: num(0, 100) }, ['boardId']),
  'form.create': make('Create a form with a Submit button', 'formCreate', 'write', { name: title }, ['name']),
  'form.upsert.question': make('Add or edit a form question; unshare shared forms before editing', 'formUpsertQuestion', 'write',
    { formId: id, questionId: id, label: title, type: kind('textfield', 'textarea', 'number', 'datetime',
      'checkbox', 'select', 'radio', 'checklist'), required: bool,
      choices: { type: 'array', items: title, minItems: 1, maxItems: 30 } }, ['formId']),
  'slides.create.deck': make('Create a slide deck with one blank slide', 'slidesCreateDeck', 'write', { name: title }, ['name']),
  'slides.add.slide': make('Append a slide to a deck', 'slidesAddSlide', 'write', { deckId: id, name: title }, ['deckId']),
  'slides.add.text': make('Add text to an existing slide', 'slidesAddText', 'write',
    { deckId: id, slideId: id, text: str(1, 4000), ...point, ...style }, ['deckId', 'slideId', 'text', 'left', 'top']),
  'draw.create': make('Create an empty drawing', 'drawCreate', 'write', { name: title }, ['name']),
  'draw.add.text': make('Add text to a drawing', 'drawAddText', 'write',
    { drawingId: id, text: str(1, 4000), ...point, ...style }, ['drawingId', 'text', 'left', 'top']),
  'canvas.add.object': make('Add a text or rectangle object to a slide or drawing', 'canvasAddObject', 'write',
    { app: kind('slides', 'draws'), recordId: id, ...canvas }, ['app', 'recordId', 'left', 'top']),
  'canvas.update.object': make('Update an existing canvas object by zero-based index', 'canvasUpdateObject', 'write',
    { app: kind('slides', 'draws'), recordId: id, slideId: id, objectIndex: integer(0, 10000),
      text: str(0, 4000), left: point.left, top: point.top, fill: color }, ['app', 'recordId', 'objectIndex']),
  'sheet.create': make('Create a spreadsheet with an empty tab', 'sheetCreate', 'write', { name: title }, ['name']),
  'sheet.read.cells': make('Read up to 200 populated cells from a spreadsheet', 'sheetReadCells', 'read', sheetArgs, ['sheetId']),
  'sheet.write.cells': make('Write up to 100 spreadsheet cells; null clears a cell', 'sheetWriteCells', 'write',
    { ...sheetArgs, cells }, ['sheetId', 'cells']),
  // Legacy combined read/write tool: use write risk so a read consent cannot be used to mutate cells.
  'sheet.cells': make('Read cells, or write cells when supplied; writing requires change consent', 'sheetCells', 'write',
    { ...sheetArgs, cells }, ['sheetId']),
  'folder.create': make('Create a Files folder, optionally in a parent folder', 'folderCreate', 'write',
    { name: title, parentId: id }, ['name']),
  'file.upload': make('Upload a base64 file (max 100 KB); remote AI cannot read a local file path', 'fileUpload', 'write',
    { name: title, mime: str(1, 128), base64: { type: 'string', minLength: 1, maxLength: 140000 }, folderId: id },
    ['name', 'mime', 'base64']),
  'file.read': make('Read a file as base64 (max 100 KB)', 'fileRead', 'read', { fileId: id }, ['fileId']),
};
