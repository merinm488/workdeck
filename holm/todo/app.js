// Holm Todo: all persistent state comes from member-private Holm storage.
// The browser never supplies an account identifier or stores an access key.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let lists = [];
  let currentId = null;
  let editingTaskId = null;
  let deleting = null;
  let naming = null;
  let busy = false;
  const login = '/auth/login?redirect=%2Ftodo%2F';

  function theme() {
    let pref = 'dark';
    try { pref = localStorage.getItem('workdeck_theme') || pref; } catch (_) {}
    document.documentElement.dataset.theme = pref === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
  }
  theme();
  $('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('workdeck_theme', next); } catch (_) {}
  });

  function notice(message, error = false) {
    $('notice').textContent = message;
    $('notice').classList.toggle('error', error);
    $('notice').hidden = !message;
  }
  function current() { return lists.find(list => list.id === currentId); }
  function element(tag, cls, content) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (content != null) node.textContent = content;
    return node;
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (response.status === 401) { location.assign(login); throw new Error('Sign in required.'); }
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) await load();
      throw new Error(result.error || 'Please try again.');
    }
    return result;
  }
  async function load() {
    const result = await api('/api/todo/lists');
    lists = result.lists;
    render();
  }
  async function action(work) {
    if (busy) return false;
    busy = true;
    try { await work(); notice('Saved to your Workdeck account.'); return true; }
    catch (error) { notice(error.message || 'Could not save changes.', true); return false; }
    finally { busy = false; }
  }
  async function updateList(list, patch) {
    const result = await api('/api/todo/lists/' + encodeURIComponent(list.id), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: patch.name ?? list.name, items: patch.items ?? list.items, version: list.version }),
    });
    lists = lists.map(item => item.id === list.id ? result.list : item);
    render();
  }

  function render() {
    const list = current();
    $('newListBtn').hidden = !!list;
    $('listsPage').hidden = !!list;
    $('tasksPage').hidden = !list;
    $('pageTitle').replaceChildren();
    if (list) {
      $('pageTitle').append(document.createTextNode(list.name));
      $('pageSubtitle').textContent = 'Keep the important things moving.';
      document.title = list.name + ' — Todo';
      renderTasks(list);
    } else {
      $('pageTitle').append('A little more ', element('em', '', 'done.'));
      $('pageSubtitle').textContent = 'Your plans, one list at a time.';
      document.title = 'Todo — Workdeck';
      renderLists();
    }
  }
  function renderLists() {
    const query = $('listSearch').value.trim().toLowerCase();
    const visible = lists.filter(list => list.name.toLowerCase().includes(query) ||
      list.items.some(t => t.title.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    $('listCount').textContent = '(' + lists.length + ')';
    $('listEmpty').hidden = lists.length !== 0;
    $('searchEmpty').hidden = !lists.length || !!visible.length;
    const cards = visible.map(list => {
      const card = element('article', 'list-card');
      const top = element('div', 'list-card-top');
      const symbol = element('span', 'list-card-icon', '✓');
      const actions = element('div', 'card-actions');
      const rename = element('button', 'text-button', 'Rename');
      rename.type = 'button'; rename.setAttribute('aria-label', 'Rename ' + list.name);
      rename.addEventListener('click', () => nameDialog(list));
      const remove = element('button', 'text-button danger-text', 'Delete');
      remove.type = 'button'; remove.setAttribute('aria-label', 'Delete ' + list.name);
      remove.addEventListener('click', () => deleteDialog('Delete list?', 'Delete “' + list.name + '” and all its tasks?', () => deleteList(list)));
      actions.append(rename, remove); top.append(symbol, actions);
      const link = element('a', 'list-card-name', list.name);
      link.href = '/todo/' + encodeURIComponent(list.id);
      link.addEventListener('click', event => { event.preventDefault(); openList(list.id); });
      const open = list.items.filter(task => !task.completed).length;
      card.append(top, link, element('div', 'list-card-meta', list.items.length + ' tasks · ' + open + ' open'));
      return card;
    });
    $('listGrid').replaceChildren(...cards);
  }
  function openList(id, navigate = true) {
    if (!lists.some(list => list.id === id)) { notice('List not found.', true); return; }
    currentId = id;
    editingTaskId = null;
    resetTaskForm();
    if (navigate) history.pushState({}, '', '/todo/' + encodeURIComponent(id));
    render();
  }
  function showLists(navigate = true) {
    currentId = null;
    editingTaskId = null;
    if (navigate) history.pushState({}, '', '/todo/');
    render();
  }
  function renderTasks(list) {
    const sorted = [...list.items].sort((a, b) => {
      if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
      const rank = { high: 0, medium: 1, low: 2 };
      if (a.priority !== b.priority) return rank[a.priority] - rank[b.priority];
      return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    });
    $('taskCount').textContent = '(' + list.items.length + ')';
    $('openCount').textContent = list.items.filter(task => !task.completed).length + ' open';
    $('taskEmpty').hidden = !!list.items.length;
    $('taskRows').replaceChildren(...sorted.map(task => {
      const row = element('div', 'task-row' + (task.completed ? ' completed' : ''));
      const check = element('input');
      check.type = 'checkbox'; check.checked = task.completed;
      check.setAttribute('aria-label', 'Mark ' + task.title + (task.completed ? ' incomplete' : ' complete'));
      check.addEventListener('change', () => action(() => updateList(list, { items: list.items.map(item =>
        item.id === task.id ? { ...item, completed: check.checked } : item) })));
      const copy = element('div', 'task-copy');
      copy.append(element('div', 'task-title', task.title));
      if (task.description) copy.append(element('div', 'task-description', task.description));
      const meta = element('div', 'task-meta');
      meta.append(element('span', 'badge ' + task.priority, task.priority));
      if (task.dueDate) {
        const overdue = !task.completed && task.dueDate < new Date().toISOString().slice(0, 10);
        meta.append(element('span', 'badge' + (overdue ? ' overdue' : ''), task.dueDate));
      }
      copy.append(meta);
      const actions = element('div', 'task-actions');
      const edit = element('button', 'text-button', 'Edit');
      edit.type = 'button'; edit.setAttribute('aria-label', 'Edit ' + task.title);
      edit.addEventListener('click', () => editTask(task));
      const remove = element('button', 'text-button danger-text', 'Delete');
      remove.type = 'button'; remove.setAttribute('aria-label', 'Delete ' + task.title);
      remove.addEventListener('click', () => deleteDialog('Delete task?', 'Delete “' + task.title + '”?', () =>
        action(() => updateList(current(), { items: current().items.filter(item => item.id !== task.id) }))));
      actions.append(edit, remove); row.append(check, copy, actions);
      return row;
    }));
  }
  function resetTaskForm() {
    $('taskForm').reset(); editingTaskId = null;
    $('formHeading').textContent = 'Add a task';
    $('saveTaskBtn').textContent = 'Add task ↗';
    $('cancelEditBtn').hidden = true;
  }
  function editTask(task) {
    editingTaskId = task.id;
    $('taskTitle').value = task.title;
    $('taskDescription').value = task.description;
    $('taskDueDate').value = task.dueDate || '';
    $('taskPriority').value = task.priority;
    $('formHeading').textContent = 'Edit task';
    $('saveTaskBtn').textContent = 'Save changes ↗';
    $('cancelEditBtn').hidden = false;
    $('taskTitle').focus();
  }
  function nameDialog(list = null) {
    naming = list;
    $('nameHeading').textContent = list ? 'Rename list' : 'Name your new list';
    $('listName').value = list?.name || '';
    $('nameDialog').showModal();
    $('listName').focus();
  }
  function deleteDialog(title, message, callback) {
    deleting = callback;
    $('deleteHeading').textContent = title;
    $('deleteMessage').textContent = message + ' This cannot be undone.';
    $('deleteDialog').showModal();
  }
  async function deleteList(list) {
    const ok = await action(async () => {
      await api('/api/todo/lists/' + encodeURIComponent(list.id), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: list.version }),
      });
      lists = lists.filter(item => item.id !== list.id);
      if (currentId === list.id) showLists(); else render();
    });
    return ok;
  }

  $('listSearch').addEventListener('input', renderLists);
  $('newListBtn').addEventListener('click', () => nameDialog());
  $('emptyNewList').addEventListener('click', () => nameDialog());
  $('backToLists').addEventListener('click', () => showLists());
  $('renameListBtn').addEventListener('click', () => nameDialog(current()));
  $('deleteListBtn').addEventListener('click', () => {
    const list = current();
    deleteDialog('Delete list?', 'Delete “' + list.name + '” and all its tasks?', () => deleteList(list));
  });
  $('nameForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('listName').value.trim();
    if (!name) return;
    const ok = await action(async () => {
      if (naming) await updateList(naming, { name });
      else {
        const result = await api('/api/todo/lists', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        lists.unshift(result.list);
        openList(result.list.id);
      }
    });
    if (ok) $('nameDialog').close();
  });
  $('cancelName').addEventListener('click', () => $('nameDialog').close());
  $('cancelDelete').addEventListener('click', () => $('deleteDialog').close());
  $('confirmDelete').addEventListener('click', async () => {
    const ok = await deleting?.();
    if (ok) $('deleteDialog').close();
  });
  $('cancelEditBtn').addEventListener('click', resetTaskForm);
  $('taskForm').addEventListener('submit', async event => {
    event.preventDefault();
    const list = current();
    if (!list) return;
    const title = $('taskTitle').value.trim();
    if (!title) return;
    const previous = list.items.find(item => item.id === editingTaskId);
    const task = { id: previous?.id || crypto.randomUUID(), title,
      description: $('taskDescription').value.trim(), dueDate: $('taskDueDate').value || null,
      priority: $('taskPriority').value, completed: previous?.completed || false,
      createdAt: previous?.createdAt || new Date().toISOString() };
    const items = previous ? list.items.map(item => item.id === previous.id ? task : item) : list.items.concat(task);
    const ok = await action(() => updateList(list, { items }));
    if (ok) resetTaskForm();
  });
  addEventListener('popstate', () => {
    const id = /^\/todo\/([a-zA-Z0-9_-]+)\/?$/.exec(location.pathname)?.[1];
    if (id && lists.some(list => list.id === id)) openList(id, false);
    else showLists(false);
  });
  load().then(() => {
    const id = /^\/todo\/([a-zA-Z0-9_-]+)\/?$/.exec(location.pathname)?.[1];
    if (id) openList(id, false);
  }).catch(error => notice(error.message || 'Could not load your lists.', true));
})();
