import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workspaceList, workspaceRead, docCreate, docUpdate, todoCreateList,
  todoAddTask, todoItems, todoUpdateTask } from '../holm/auth/mcp.js';
import { operations as extraOperations } from '../holm/auth/mcp-extra-contract.js';
import { workspaceCreate, workspaceUpdate, todoRenameList, kanbanAddColumn, kanbanUpsertCard,
  formUpsertQuestion, canvasAddObject, canvasUpdateObject, slidesAddSlide, sheetCreate,
  sheetWriteCells, sheetReadCells, folderCreate, fileUpload, fileRead } from '../holm/auth/mcp-extra.js';

const contract = JSON.parse(readFileSync(new URL('../holm/auth/mcp-contract.json', import.meta.url)));
test('Holm MCP only declares consented member operations', () => {
  assert.equal(Object.keys(contract.operations).length + Object.keys(extraOperations).length, 31);
  const oldServer = readFileSync(new URL('../api/_lib/mcp-http.js', import.meta.url), 'utf8');
  const oldNames = [...oldServer.matchAll(/  tool\('([^']+)'/g)].map(match => match[1]);
  const newNames = new Set(Object.keys({ ...contract.operations, ...extraOperations }).map(key => key.replaceAll('.', '_')));
  assert.deepEqual(oldNames.filter(name => !newNames.has(name)), []);
  for (const op of Object.values({ ...contract.operations, ...extraOperations })) assert.equal(op.auth, 'user');
  assert.equal(extraOperations['sheet.cells'].risk, 'write');
  assert.equal(contract.operations['docs.update'].risk, 'write');
});

function member() {
  const data = new Map();
  const collection = name => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name);
  };
  const ds = {
    find: (name, query = {}, opts) => [...collection(name).values()]
      .filter(row => Object.entries(query).every(([key, value]) => row[key] === value)).slice(0, opts?.limit),
    findOne: (name, id) => collection(name).get(id) || null,
    count: name => collection(name).size,
    insert: (name, row) => {
      const id = 'r' + (collection(name).size + 1);
      collection(name).set(id, { ...row, id });
      return id;
    },
    update: (name, query, patch) => collection(name).set(query.id, { ...collection(name).get(query.id), ...patch.$set }),
    transaction: callback => callback(ds),
  };
  return { holm: { app: { member: { ds } } } };
}

test('operations isolate members, redact share tokens and refuse stale or shared edits', () => {
  const alice = member(), bob = member();
  const doc = docCreate({ title: 'Notes', content: 'first' }, alice);
  assert.equal(workspaceList({ app: 'docs' }, bob).total, 0);
  assert.throws(() => workspaceRead({ app: 'docs', recordId: doc.id }, bob));
  const row = alice.holm.app.member.ds.findOne('user_docs', doc.id);
  row.sharedId = 'private-share-token';
  assert.equal(workspaceRead({ app: 'docs', recordId: doc.id }, alice).sharedId, undefined);
  assert.throws(() => docUpdate({ recordId: doc.id, version: 1, content: 'x' }, alice), /Unshare/);
  delete row.sharedId;
  assert.equal(docUpdate({ recordId: doc.id, version: 1, content: 'next' }, alice).version, 2);
  assert.throws(() => docUpdate({ recordId: doc.id, version: 1, content: 'lost' }, alice), /changed/);
});

test('Kanban, Forms and canvases mutate only owned records, with caps and share guards', () => {
  const env = member(), stranger = member();
  const board = workspaceCreate({ app: 'kanban', name: 'Plan' }, env);
  const column = kanbanAddColumn({ boardId: board.id, label: 'Doing' }, env);
  const card = kanbanUpsertCard({ boardId: board.id, column: column.id, label: 'Ship' }, env);
  assert.equal(workspaceRead({ app: 'kanban', recordId: board.id }, env).cards[0].id, card.id);
  assert.throws(() => kanbanAddColumn({ boardId: board.id, label: 'X' }, stranger));
  const form = workspaceCreate({ app: 'forms', name: 'Survey' }, env);
  const q = formUpsertQuestion({ formId: form.id, label: 'Pick', type: 'select', choices: ['A', 'B'] }, env);
  assert.equal(q.values.length, 2);
  env.holm.app.member.ds.findOne('user_forms', form.id).sharedId = 'share';
  assert.throws(() => formUpsertQuestion({ formId: form.id, questionId: q.id, label: 'No' }, env), /Unshare/);
  const deck = workspaceCreate({ app: 'slides', name: 'Talk' }, env);
  const slide = slidesAddSlide({ deckId: deck.id }, env);
  const obj = canvasAddObject({ app: 'slides', recordId: deck.id, slideId: slide.id, left: 3, top: 4, text: 'Hello' }, env);
  assert.equal(canvasUpdateObject({ app: 'slides', recordId: deck.id, slideId: slide.id, objectIndex: obj.objectIndex, text: 'Bye' }, env).text, 'Bye');
  assert.throws(() => canvasAddObject({ app: 'slides', recordId: deck.id, slideId: 'missing', left: 3, top: 4 }, env));
});

test('Sheets cells and Files bytes use their real separate Holm member collections', () => {
  const env = member(), stranger = member();
  const sheet = sheetCreate({ name: 'Numbers' }, env);
  const tabId = sheetReadCells({ sheetId: sheet.id }, env).tabId;
  sheetWriteCells({ sheetId: sheet.id, cells: [{ row: 0, column: 0, value: 42 }, { row: 1, column: 0, value: 'ok' }] }, env);
  assert.equal(sheetReadCells({ sheetId: sheet.id }, env).cells[0].value, 42);
  sheetWriteCells({ sheetId: sheet.id, tabId, cells: [{ row: 0, column: 0, value: null }] }, env);
  assert.equal(sheetReadCells({ sheetId: sheet.id }, env).cells[0].value, 'ok');
  assert.throws(() => sheetReadCells({ sheetId: sheet.id }, stranger));
  const folder = folderCreate({ name: 'Docs' }, env);
  const file = fileUpload({ name: 'hi.txt', mime: 'text/plain', folderId: folder.id, base64: 'aGk=' }, env);
  assert.equal(fileRead({ fileId: file.id }, env).base64, 'aGk=');
  assert.throws(() => fileRead({ fileId: file.id }, stranger));
  assert.throws(() => fileUpload({ name: 'bad', mime: 'text/plain', base64: 'aGk==' }, env), /Invalid base64/);
});

test('workspace creation, updates and Todo rename respect migrated models', () => {
  const env = member();
  const calendar = workspaceCreate({ app: 'calendars', name: 'Meetings' }, env);
  const event = workspaceCreate({ app: 'events', calId: calendar.id, name: 'Standup',
    start: '2026-01-10T10:00:00Z', end: '2026-01-10T11:00:00Z' }, env);
  assert.equal(workspaceUpdate({ app: 'events', recordId: event.id, content: 'Daily' }, env).description, 'Daily');
  assert.throws(() => workspaceCreate({ app: 'events', calId: 'missing', name: 'X',
    start: '2026-01-10T10:00:00Z', end: '2026-01-10T11:00:00Z' }, env));
  const post = workspaceCreate({ app: 'posts', name: 'Draft', content: '<script>bad</script><p>Hi</p>' }, env);
  assert.equal(post.html, '<p>Hi</p>');
  const list = todoCreateList({ name: 'Old' }, env);
  assert.equal(todoRenameList({ listId: list.id, name: 'New' }, env).name, 'New');
  assert.equal(workspaceRead({ app: 'todo', recordId: list.id }, env).version, 2);
});

test('Todo operations use the same member-private list shape and check versions', () => {
  const env = member();
  const list = todoCreateList({ name: 'Tasks' }, env);
  const created = todoAddTask({ listId: list.id, title: 'Do it' }, env);
  assert.equal(todoItems({ listId: list.id }, env).items[0].title, 'Do it');
  assert.equal(created.task.dueDate, null);
  assert.equal(todoUpdateTask({ listId: list.id, taskId: created.task.id, version: 2, completed: true }, env).version, 3);
  assert.throws(() => todoUpdateTask({ listId: list.id, taskId: created.task.id, version: 2, completed: false }, env), /changed/);
});
