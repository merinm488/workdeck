import { generateId, getUserDoc, saveOwnedSections } from './store.js';

// These operations only expose Todo data. Neither tools nor callers receive
// the unified account document or any account credential.
function listSummary(list) {
  return { id: list.id, name: list.name, itemCount: (list.items || []).length, updatedAt: list.updatedAt };
}

function taskSummary(item) {
  return { id: item.id, title: item.title, description: item.description || '',
    dueDate: item.dueDate || null, priority: item.priority || 'medium',
    completed: item.completed === true, createdAt: item.createdAt };
}

async function accountTodo(hash) {
  const doc = await getUserDoc(hash);
  if (!doc) throw new Error('Account not found');
  return doc;
}

function findList(doc, listId) {
  const list = doc.todo.find(item => item && item.id === listId);
  if (!list) throw new Error('Todo list not found');
  return list;
}

async function saveTodo(hash, doc) {
  if (!(await saveOwnedSections(hash, { todo: doc.todo }))) throw new Error('Could not save Todo changes');
}

export async function listTodoLists(hash) {
  return (await accountTodo(hash)).todo.filter(Boolean).map(listSummary);
}

export async function listTodoItems(hash, listId, offset = 0, limit = 50) {
  const list = findList(await accountTodo(hash), listId);
  const items = Array.isArray(list.items) ? list.items : [];
  return { list: listSummary(list), total: items.length,
    items: items.slice(offset, offset + limit).filter(Boolean).map(taskSummary) };
}

export async function createTodoList(hash, name) {
  const doc = await accountTodo(hash);
  const now = new Date().toISOString();
  let id = generateId();
  while (doc.todo.some(list => list && list.id === id)) id = generateId();
  const list = { id, name, items: [], createdAt: now, updatedAt: now };
  doc.todo.unshift(list);
  await saveTodo(hash, doc);
  return listSummary(list);
}

export async function addTodoTask(hash, listId, fields) {
  const doc = await accountTodo(hash);
  const list = findList(doc, listId);
  if (!Array.isArray(list.items)) throw new Error('Todo list has invalid items');
  const now = new Date().toISOString();
  let id = generateId();
  while (list.items.some(item => item && item.id === id)) id = generateId();
  const task = { id, title: fields.title, description: fields.description || '',
    dueDate: fields.dueDate || null, priority: fields.priority || 'medium',
    completed: false, createdAt: now };
  list.items.push(task);
  list.updatedAt = now;
  await saveTodo(hash, doc);
  return { listId, task: taskSummary(task) };
}

export async function updateTodoTask(hash, listId, taskId, updates) {
  if (!Object.keys(updates).length) throw new Error('At least one task field is required');
  const doc = await accountTodo(hash);
  const list = findList(doc, listId);
  const task = (list.items || []).find(item => item && item.id === taskId);
  if (!task) throw new Error('Todo task not found');
  for (const field of ['title', 'description', 'dueDate', 'priority', 'completed']) {
    if (Object.hasOwn(updates, field)) task[field] = updates[field];
  }
  list.updatedAt = new Date().toISOString();
  await saveTodo(hash, doc);
  return { listId, task: taskSummary(task) };
}
