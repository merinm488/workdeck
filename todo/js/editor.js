/**
 * ================================================
 * TODO - Editor
 * ================================================
 *
 * Two views:
 *   lists view — every task list on the account (create/rename/delete)
 *   list view  — the tasks of one list (add/toggle/edit/delete/reorder)
 */

// ================================================
// State
// ================================================

let lists = [];          // the account's task lists (userData.todo)
let currentList = null;  // the open list, or null in the lists view
let sortable = null;
let listsLayout = APP_CONFIG.layout.default;  // 'cards' | 'list'
let userSettings = {};   // userData.settings (kanbanCards staging lives here)

// ================================================
// DOM
// ================================================

const $ = (id) => document.getElementById(id);

const homeBtn = $('homeBtn');
let pageTitle = $('pageTitle');
const settingsBtn = $('settingsBtn');
const settingsDropdown = $('settingsDropdown');
const themeToggleBtn = $('themeToggleBtn');
const themeSubmenu = $('themeSubmenu');
const viewKeyBtn = $('viewKeyBtn');
const logoutBtn = $('logoutBtn');
const deleteAccountBtn = $('deleteAccountBtn');

const listsView = $('listsView');
const listsGrid = $('listsGrid');
const listsEmpty = $('listsEmpty');
const listsNoResults = $('listsNoResults');
const newListBtn = $('newListBtn');
const emptyNewListBtn = $('emptyNewListBtn');
const listsLayoutBtn = $('listsLayoutBtn');
const listsSearchInput = $('listsSearchInput');
const listsSearchClear = $('listsSearchClear');
const clearListsSearchBtn = $('clearListsSearchBtn');
const listsSearchToggle = $('listsSearchToggle');
const topNav = document.querySelector('.top-nav');

const listView = $('listView');
const navAdd = $('navAdd');
const navList = $('navList');
const addViewEl = $('addView');
const taskListViewEl = $('taskListView');
const todoForm = $('todoForm');
const todoTitleInput = $('todoTitle');
const todoDescriptionInput = $('todoDescription');
const todoDateInput = $('todoDate');
const todoPriorityInput = $('todoPriority');
const todoListEl = $('todoList');
const emptyStateEl = $('emptyState');
const emptyAddTaskBtn = $('emptyAddTaskBtn');
const taskCountEl = $('taskCount');
const footerStats = $('todoFooterStats');
const loadingOverlay = $('loadingOverlay');

const keyModal = $('keyModal');
const keyText = $('keyText');
const keyCopyBtn = $('keyCopyBtn');
const keyCopyFeedback = $('keyCopyFeedback');
const deleteAccountModal = $('deleteAccountModal');
const renameListModal = $('renameListModal');
const renameListInput = $('renameListInput');
const confirmModal = $('confirmModal');
const confirmTitle = $('confirmTitle');
const confirmMessage = $('confirmMessage');
const confirmActionBtn = $('confirmAction');
const editTaskModal = $('editTaskModal');
const editForm = $('editForm');
const editIdInput = $('editId');
const editTitleInput = $('editTitle');
const editDescriptionInput = $('editDescription');
const editDateInput = $('editDate');
const editPriorityInput = $('editPriority');

// ================================================
// Small helpers
// ================================================

function genItemId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** "Just now", "5m ago", "Yesterday", ... (matches the other apps). */
function formatRelativeDate(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';

    const diff = Date.now() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return minutes + 'm ago';
    if (hours < 24) return hours + 'h ago';
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + 'd ago';
    return date.toLocaleDateString();
}

/** Due badge: Today/Tomorrow/Yesterday/N days ago/weekday/Mon D. */
function formatDueDate(dueDate) {
    const due = new Date(dueDate + 'T00:00:00');
    if (Number.isNaN(due.getTime())) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);

    if (diffDays === 0) return { text: 'Today', cls: 'date-today' };
    if (diffDays === 1) return { text: 'Tomorrow', cls: 'date-tomorrow' };
    if (diffDays === -1) return { text: 'Yesterday', cls: 'date-overdue' };
    if (diffDays < -1) return { text: Math.abs(diffDays) + ' days ago', cls: 'date-overdue' };
    if (diffDays <= 7) {
        return { text: due.toLocaleDateString(undefined, { weekday: 'long' }), cls: 'date-this-week' };
    }
    return { text: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: 'date-future' };
}

function showNotification(message, type) {
    const el = $('notification');
    el.textContent = message;
    el.className = 'notification ' + (type || 'success');
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

// ================================================
// Modals
// ================================================

function openModal(modal) {
    modal.classList.add('active');
}

function closeModal(modal) {
    modal.classList.remove('active');
}

let confirmCallback = null;

function openConfirm(title, message, actionLabel, onConfirm) {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmActionBtn.textContent = actionLabel || 'Delete';
    confirmCallback = onConfirm;
    openModal(confirmModal);
}

let renameCallback = null;

function openRenameList(list) {
    renameListInput.value = list.name === 'Untitled List' ? '' : list.name;
    renameCallback = async () => {
        const name = renameListInput.value.trim();
        if (!name) {
            showNotification('Please enter a list name', 'error');
            return;
        }
        const saved = await todoStorage.renameList(list.id, name);
        if (saved) {
            list.name = name;
            list.updatedAt = new Date().toISOString();
            closeModal(renameListModal);
            renderLists();
            if (currentList && currentList.id === list.id) {
                pageTitle.textContent = name;
            }
            showNotification('List renamed!');
        } else {
            showNotification('Failed to rename list. Please try again.', 'error');
        }
    };
    openModal(renameListModal);
    renameListInput.focus();
}

// ================================================
// Lists view
// ================================================

function getSearchQuery() {
    return listsSearchInput.value.trim().toLowerCase();
}

/** Search matches the list name or any task title/description in it. */
function listMatchesSearch(list, q) {
    if (!q) return true;
    if ((list.name || 'Untitled List').toLowerCase().includes(q)) return true;
    const items = Array.isArray(list.items) ? list.items : [];
    return items.some(t =>
        String(t.title || '').toLowerCase().includes(q) ||
        String(t.description || '').toLowerCase().includes(q));
}

function renderLists() {
    listsGrid.innerHTML = '';

    const q = getSearchQuery();
    const sorted = [...lists]
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .filter(list => listMatchesSearch(list, q));

    listsEmpty.classList.toggle('hidden', lists.length > 0);
    listsNoResults.classList.toggle('hidden', lists.length === 0 || sorted.length > 0);
    if (lists.length === 0 || sorted.length === 0) {
        updateFooter();
        return;
    }

    sorted.forEach(list => {
        const items = Array.isArray(list.items) ? list.items : [];
        const open = items.filter(t => !t.completed).length;

        const card = $('tdListCardTemplate').content.firstElementChild.cloneNode(true);
        card.dataset.id = list.id;
        card.querySelector('.td-list-name').textContent = list.name || 'Untitled List';
        card.querySelector('.td-list-meta').textContent =
            (items.length === 1 ? '1 task' : items.length + ' tasks') +
            (items.length ? ` · ${open} open` : '') +
            (list.updatedAt ? ' · ' + formatRelativeDate(list.updatedAt) : '');

        card.addEventListener('click', () => openList(list.id));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openList(list.id);
            }
        });
        card.querySelector('.td-list-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            openRenameList(list);
        });
        card.querySelector('.td-list-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            openConfirm(
                'Delete List',
                `Delete "${list.name || 'Untitled List'}" and all its tasks? This cannot be undone.`,
                'Delete List',
                async () => {
                    const saved = await todoStorage.deleteList(list.id);
                    if (saved) {
                        lists = lists.filter(l => l.id !== list.id);
                        closeModal(confirmModal);
                        renderLists();
                        showNotification('List deleted!');
                    } else {
                        showNotification('Failed to delete list. Please try again.', 'error');
                    }
                }
            );
        });

        listsGrid.appendChild(card);
    });

    updateFooter();
}

async function createNewList() {
    const list = await todoStorage.createList();
    if (!list) {
        showNotification('Failed to create list. Please try again.', 'error');
        return;
    }
    lists.unshift(list);
    renderLists();
    openList(list.id);
    showNotification('List created!');
}

// ================================================
// Lists home layout (cards grid / rows) + search bar
// ================================================

function applyListsLayout(mode) {
    listsLayout = mode === 'list' ? 'list' : 'cards';
    const asList = listsLayout === 'list';

    listsGrid.classList.toggle('as-list', asList);
    listsLayoutBtn.setAttribute('aria-pressed', String(asList));
    listsLayoutBtn.querySelector('.layout-icon-list').classList.toggle('hidden', asList);
    listsLayoutBtn.querySelector('.layout-icon-cards').classList.toggle('hidden', !asList);
    const label = asList ? 'Switch to card view' : 'Switch to list view';
    listsLayoutBtn.title = label;
    listsLayoutBtn.setAttribute('aria-label', label);
}

function toggleListsLayout() {
    applyListsLayout(listsLayout === 'list' ? 'cards' : 'list');
    try {
        localStorage.setItem(APP_CONFIG.layout.storageKey, listsLayout);
    } catch (err) { /* private mode */ }
}

function clearListsSearch() {
    listsSearchInput.value = '';
    listsSearchClear.classList.add('hidden');
    renderLists();
    listsSearchInput.focus();
}

function setSearchOpen(open) {
    topNav.classList.toggle('search-open', open);
    if (open) listsSearchInput.focus();
}

// ================================================
// List view
// ================================================

function openList(id) {
    const list = lists.find(l => l.id === id);
    if (!list) return;

    currentList = list;
    if (!Array.isArray(list.items)) list.items = [];

    listsView.classList.add('hidden');
    listView.classList.remove('hidden');
    pageTitle.textContent = list.name || 'Untitled List';
    pageTitle.classList.add('page-title-editable');
    pageTitle.title = 'Click to rename';
    document.title = (list.name || 'Untitled List') + ' - Todo';
    homeBtn.title = 'Back to My Lists';
    homeBtn.setAttribute('aria-label', 'Back to My Lists');

    history.replaceState(null, '', '/todo/' + encodeURIComponent(id));

    // The lists search/layout/new controls don't apply inside a list
    topNav.classList.add('list-open');

    showView('add');
    renderTasks();
}

function showLists() {
    currentList = null;

    topNav.classList.remove('list-open');

    listView.classList.add('hidden');
    listsView.classList.remove('hidden');
    pageTitle.textContent = 'My Lists';
    pageTitle.classList.remove('page-title-editable');
    pageTitle.title = '';
    document.title = 'Todo - Task Lists';
    homeBtn.title = 'Back to Workdeck';
    homeBtn.setAttribute('aria-label', 'Back to Workdeck');

    history.replaceState(null, '', '/todo/');
    renderLists();
}

/** Persist the open list (whole record upsert) and refresh its recency. */
async function saveCurrentList() {
    if (!currentList) return false;
    currentList.updatedAt = new Date().toISOString();
    const saved = await todoStorage.saveList(currentList);
    if (!saved) {
        showNotification('Failed to save changes. Please try again.', 'error');
    }
    return saved;
}

function renderTasks() {
    if (!currentList) return;

    const items = currentList.items;
    taskCountEl.textContent = items.length;

    emptyStateEl.classList.toggle('hidden', items.length > 0);
    todoListEl.innerHTML = '';
    updateFooter();

    if (items.length === 0) return;

    const sorted = [...items].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;

        const priorityOrder = { high: 0, medium: 1, low: 2 };
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return a.dueDate ? -1 : 1;
    });

    sorted.forEach(task => {
        const row = $('tdTaskTemplate').content.firstElementChild.cloneNode(true);
        row.dataset.id = task.id;
        row.classList.toggle('completed', !!task.completed);

        const check = row.querySelector('.td-task-check');
        check.checked = !!task.completed;
        check.addEventListener('change', () => toggleTodo(task.id));

        row.querySelector('.todo-title').textContent = task.title;

        const desc = row.querySelector('.todo-description');
        if (task.description) {
            desc.textContent = task.description;
            desc.classList.remove('hidden');
        } else {
            desc.classList.add('hidden');
        }

        const dateBadge = row.querySelector('.todo-date');
        const due = task.dueDate ? formatDueDate(task.dueDate) : null;
        if (due) {
            dateBadge.classList.remove('hidden');
            dateBadge.classList.add(due.cls);
            row.querySelector('.td-date-text').textContent = due.text;
        }

        const badge = row.querySelector('.priority-badge');
        badge.classList.remove('medium');
        badge.classList.add(task.priority || 'medium');
        badge.textContent = task.priority || 'medium';

        const kanbanBtn = row.querySelector('.td-task-kanban');
        if (task.completed) {
            kanbanBtn.classList.add('hidden');
        } else {
            const staged = kanbanStagedIds().includes(task.id);
            kanbanBtn.classList.toggle('active', staged);
            kanbanBtn.title = staged ? 'Remove from Kanban' : 'Add to Kanban';
            kanbanBtn.addEventListener('click', () => toggleKanbanStaged(task.id));
        }

        row.querySelector('.td-task-edit').addEventListener('click', () => openEditModal(task.id));
        row.querySelector('.td-task-delete').addEventListener('click', () => deleteTodo(task.id));

        todoListEl.appendChild(row);
    });
}

function showView(view) {
    if (view === 'add') {
        addViewEl.classList.remove('hidden');
        taskListViewEl.classList.add('hidden');
        navAdd.classList.add('active');
        navAdd.setAttribute('aria-selected', 'true');
        navList.classList.remove('active');
        navList.setAttribute('aria-selected', 'false');
    } else {
        addViewEl.classList.add('hidden');
        taskListViewEl.classList.remove('hidden');
        navAdd.classList.remove('active');
        navAdd.setAttribute('aria-selected', 'false');
        navList.classList.add('active');
        navList.setAttribute('aria-selected', 'true');
    }
}

async function addTodo(title, description, dueDate, priority) {
    currentList.items.push({
        id: genItemId(),
        title,
        description: description || '',
        dueDate: dueDate || null,
        priority: priority || 'medium',
        completed: false,
        createdAt: new Date().toISOString()
    });

    const saved = await saveCurrentList();
    if (saved) {
        renderTasks();
        showNotification('Task added successfully!');
    }
}

async function toggleTodo(id) {
    const task = currentList.items.find(t => t.id === id);
    if (!task) return;

    task.completed = !task.completed;
    const saved = await saveCurrentList();
    if (saved) {
        renderTasks();
    }
}

// Tasks staged for the Kanban sidebar ("Cards" panel) — shared via settings
function kanbanStagedIds() {
    return Array.isArray(userSettings.kanbanCards) ? userSettings.kanbanCards : [];
}

async function toggleKanbanStaged(id) {
    const ids = kanbanStagedIds();
    const staged = ids.includes(id);
    const next = staged ? ids.filter(x => x !== id) : ids.concat(id);

    const ok = await todoStorage.saveSettings({ kanbanCards: next });
    if (!ok) {
        showNotification('Could not update the Kanban list', 'error');
        return;
    }
    userSettings.kanbanCards = next;
    renderTasks();
    showNotification(staged ? 'Removed from Kanban' : 'Added to Kanban');
}

function openEditModal(id) {
    const task = currentList.items.find(t => t.id === id);
    if (!task) return;

    editIdInput.value = task.id;
    editTitleInput.value = task.title;
    editDescriptionInput.value = task.description || '';
    editDateInput.value = task.dueDate || '';
    editPriorityInput.value = task.priority || 'medium';

    openModal(editTaskModal);
    editTitleInput.focus();
}

function closeEditModal() {
    closeModal(editTaskModal);
    editForm.reset();
}

async function updateTodo(id, title, description, dueDate, priority) {
    const task = currentList.items.find(t => t.id === id);
    if (!task) return;

    task.title = title;
    task.description = description || '';
    task.dueDate = dueDate || null;
    task.priority = priority;

    const saved = await saveCurrentList();
    if (saved) {
        renderTasks();
        closeEditModal();
        showNotification('Task updated successfully!');
    }
}

function deleteTodo(id) {
    const task = currentList.items.find(t => t.id === id);
    if (!task) return;

    openConfirm('Delete Task', `Delete "${task.title}"? This cannot be undone.`, 'Delete Task',
        async () => {
            currentList.items = currentList.items.filter(t => t.id !== id);
            const saved = await saveCurrentList();
            if (saved) {
                closeModal(confirmModal);
                renderTasks();
                showNotification('Task deleted!');
            }
        });
}

// ================================================
// Drag reorder (SortableJS)
// ================================================

function initSortable() {
    if (sortable) return;

    sortable = new Sortable(todoListEl, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        handle: '.todo-content',
        filter: '.td-icon-btn, input',
        preventOnFilter: false,
        forceFallback: true,
        fallbackTolerance: 3,
        delay: 150,
        delayOnTouchOnly: true,

        onEnd: async function (evt) {
            if (evt.oldIndex === evt.newIndex || !currentList) return;

            const order = Array.from(todoListEl.children).map(el => el.dataset.id);
            currentList.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

            await saveCurrentList();
            showNotification('Task order updated');
        }
    });
}

// ================================================
// Footer / settings
// ================================================

function updateFooter() {
    if (currentList) {
        const total = currentList.items.length;
        const open = currentList.items.filter(t => !t.completed).length;
        footerStats.textContent = `${total} task${total === 1 ? '' : 's'} · ${open} open`;
    } else {
        const tasks = lists.reduce((n, l) => n + (Array.isArray(l.items) ? l.items.length : 0), 0);
        footerStats.textContent =
            `${lists.length} list${lists.length === 1 ? '' : 's'} · ${tasks} task${tasks === 1 ? '' : 's'}`;
    }
}

function closeSettingsMenus() {
    settingsDropdown.classList.remove('active');
    themeSubmenu.classList.remove('active');
    themeToggleBtn.closest('.theme-dropdown-container').classList.remove('active');
}

// ================================================
// Inline title rename (top bar, open list only)
// ================================================

function makeTitleEditable() {
    if (!currentList) return;

    const h1 = pageTitle;
    const current = currentList.name || 'Untitled List';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'page-title-input';
    input.value = current;
    input.maxLength = 100;

    h1.parentNode.replaceChild(input, h1);
    input.focus();
    input.select();

    let cancelled = false;

    const commit = async () => {
        if (cancelled) return;
        cancelled = true;

        const newName = input.value.trim() || 'Untitled List';
        if (newName !== current) {
            const saved = await todoStorage.renameList(currentList.id, newName);
            if (saved) {
                currentList.name = newName;
                currentList.updatedAt = new Date().toISOString();
                showNotification('List renamed!');
            } else {
                showNotification('Failed to rename list. Please try again.', 'error');
            }
        }
        restoreTitleDisplay(currentList.name || 'Untitled List');
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            cancelled = true;
            restoreTitleDisplay(current);
        }
    });

    input.addEventListener('blur', commit);
}

function restoreTitleDisplay(title) {
    const input = document.querySelector('.page-title-input');
    if (!input) return;

    const h1 = document.createElement('h1');
    h1.id = 'pageTitle';
    h1.className = 'page-title page-title-editable';
    h1.title = 'Click to rename';
    h1.textContent = title;

    input.parentNode.replaceChild(h1, input);
    pageTitle = h1;
    h1.addEventListener('click', makeTitleEditable);
}

// ================================================
// Events
// ================================================

function wireEvents() {
    homeBtn.addEventListener('click', () => {
        if (currentList) {
            showLists();
        } else {
            window.location.href = '/';
        }
    });

    newListBtn.addEventListener('click', createNewList);
    emptyNewListBtn.addEventListener('click', createNewList);
    emptyAddTaskBtn.addEventListener('click', () => showView('add'));

    listsLayoutBtn.addEventListener('click', toggleListsLayout);

    listsSearchInput.addEventListener('input', () => {
        listsSearchClear.classList.toggle('hidden', !listsSearchInput.value);
        renderLists();
    });
    listsSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (listsSearchInput.value) clearListsSearch();
            else setSearchOpen(false);
        }
    });
    listsSearchClear.addEventListener('click', clearListsSearch);
    clearListsSearchBtn.addEventListener('click', clearListsSearch);
    listsSearchToggle.addEventListener('click', () => {
        setSearchOpen(!topNav.classList.contains('search-open'));
    });

    navAdd.addEventListener('click', () => showView('add'));
    navList.addEventListener('click', () => showView('list'));

    pageTitle.addEventListener('click', makeTitleEditable);

    todoForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const title = todoTitleInput.value.trim();
        if (!title) {
            showNotification('Please enter a task title', 'error');
            return;
        }

        await addTodo(title, todoDescriptionInput.value.trim(), todoDateInput.value, todoPriorityInput.value);
        todoForm.reset();
        showView('list');
    });

    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = editIdInput.value;
        const title = editTitleInput.value.trim();
        if (!title) {
            showNotification('Please enter a task title', 'error');
            return;
        }

        await updateTodo(id, title, editDescriptionInput.value.trim(), editDateInput.value, editPriorityInput.value);
    });

    // Settings dropdown
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsDropdown.classList.toggle('active');
    });

    themeToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        themeSubmenu.classList.toggle('active');
        themeToggleBtn.closest('.theme-dropdown-container').classList.toggle('active');
    });

    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            todoThemeManager.setTheme(btn.dataset.theme);
            closeSettingsMenus();
        });
    });

    viewKeyBtn.addEventListener('click', () => {
        keyText.textContent = todoAuth.getUserKey() || '-';
        closeSettingsMenus();
        openModal(keyModal);
    });

    keyCopyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(keyText.textContent);
            keyCopyFeedback.classList.add('visible');
            setTimeout(() => keyCopyFeedback.classList.remove('visible'), 1500);
        } catch (err) {
            console.error('[TODO] Copy failed:', err);
        }
    });

    logoutBtn.addEventListener('click', () => todoAuth.logout());
    deleteAccountBtn.addEventListener('click', () => {
        closeSettingsMenus();
        openModal(deleteAccountModal);
    });

    // Modal close buttons
    $('keyModalClose').addEventListener('click', () => closeModal(keyModal));
    $('keyModalCloseBtn').addEventListener('click', () => closeModal(keyModal));
    $('deleteAccountModalClose').addEventListener('click', () => closeModal(deleteAccountModal));
    $('cancelDeleteAccount').addEventListener('click', () => closeModal(deleteAccountModal));
    $('renameListModalClose').addEventListener('click', () => closeModal(renameListModal));
    $('cancelRenameList').addEventListener('click', () => closeModal(renameListModal));
    $('confirmModalClose').addEventListener('click', () => closeModal(confirmModal));
    $('cancelConfirm').addEventListener('click', () => closeModal(confirmModal));
    $('editTaskModalClose').addEventListener('click', closeEditModal);
    $('cancelEdit').addEventListener('click', closeEditModal);

    confirmActionBtn.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
    });

    $('confirmRenameList').addEventListener('click', () => {
        if (renameCallback) renameCallback();
    });

    renameListInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && renameCallback) renameCallback();
    });

    $('confirmDeleteAccount').addEventListener('click', async () => {
        const result = await todoAuth.deleteAccount();
        if (!result.success) {
            closeModal(deleteAccountModal);
            showNotification(result.error || 'Failed to delete account', 'error');
        }
    });

    // Close modals on backdrop click / Escape
    [keyModal, deleteAccountModal, renameListModal, confirmModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (editTaskModal.classList.contains('active')) closeEditModal();
            [keyModal, deleteAccountModal, renameListModal, confirmModal].forEach(m => {
                if (m.classList.contains('active')) closeModal(m);
            });
            closeSettingsMenus();
        }
    });

    // Click outside closes the settings dropdown
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.top-nav-settings')) {
            closeSettingsMenus();
        }
    });
}

// ================================================
// Init
// ================================================

async function init() {
    todoThemeManager.init();

    const session = todoAuth.getSession();
    if (!session) {
        window.location.href = '/';
        return;
    }

    wireEvents();

    loadingOverlay.classList.remove('hidden');

    const userData = await todoStorage.loadUserData();
    if (!userData) {
        // Account gone (deleted elsewhere) — clear mirrors and bail.
        todoAuth.logout();
        return;
    }

    todoThemeManager.applyFromServer(userData.settings && userData.settings.theme);

    lists = Array.isArray(userData.todo) ? userData.todo : [];
    userSettings = userData.settings || {};

    let storedLayout = null;
    try {
        storedLayout = localStorage.getItem(APP_CONFIG.layout.storageKey);
    } catch (err) { /* private mode */ }
    applyListsLayout(storedLayout || APP_CONFIG.layout.default);

    renderLists();

    const pathId = (/^\/todo\/([a-z0-9]{14,})\/?$/.exec(window.location.pathname) || [])[1];
    const requestedId = pathId ||
        new URLSearchParams(window.location.search).get('list');
    if (requestedId && lists.some(l => l.id === requestedId)) {
        openList(requestedId);
    } else {
        showLists();
    }

    initSortable();

    loadingOverlay.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', init);