/**
 * ================================================
 * KANBAN - Application (home + chrome)
 * ================================================
 *
 * Boards home (grid + search + CRUD), settings menu, modals,
 * theme wiring, and routing between /kanban/ and /kanban/?board=<id>.
 */

const state = {
    userHash: null,
    boards: [],
    settings: {},
    userDoc: null,
    creating: false,
    navigation: 0,
    searchQuery: ''
};

// ================================================
// Boot
// ================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    kanbanThemeManager.init();
    wireChrome();
    showLoading(true);
    document.getElementById('newBoardBtn').disabled = true;
    // /api/kanban authenticates the member itself. Share this one request with
    // the home sidebar instead of verifying then fetching the entire workspace.
    window.WDKanbanData = kanbanStorage.loadUserData();
    const doc = await window.WDKanbanData;
    if (!doc) {
        showBoardsView(); // The shared sidebar shows a persistent Retry state.
        showLoading(false);
        showNotification('Could not load boards. Please refresh to retry.', 'error');
        return;
    }
    kanbanThemeManager.applyFromServer(doc.settings && doc.settings.theme);
    state.userDoc = doc;
    state.settings = doc.settings || {};
    state.boards = doc.kanban || [];
    document.getElementById('newBoardBtn').disabled = false;
    await openBoard(requestedBoardId(), { historyMode: 'replace' });
    showLoading(false);
}

function requestedBoardId() {
    const pathId = (/^\/kanban\/([a-zA-Z0-9_-]{8,128})\/?$/.exec(window.location.pathname) || [])[1];
    return pathId || new URLSearchParams(window.location.search).get('board') || null;
}

// ================================================
// Views
// ================================================

function showBoardsView() {
    window.WDPageTitle?.home();
    document.getElementById('boardsView').classList.remove('hidden');
    document.getElementById('boardView').classList.add('hidden');
    document.getElementById('pageTitle').textContent = 'My Boards';
    ['#listsSearchBar', '#newBoardBtn', '#boardsSearchToggle'].forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.classList.remove('hidden');
    });
}

function showBoardView() {
    document.getElementById('boardsView').classList.add('hidden');
    document.getElementById('boardView').classList.remove('hidden');
    ['#listsSearchBar', '#newBoardBtn', '#boardsSearchToggle'].forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.classList.add('hidden');
    });
}

// ================================================
// Boards home
// ================================================

function renderBoards() {
    const grid = document.getElementById('boardsGrid');
    grid.innerHTML = '';

    const q = state.searchQuery.toLowerCase().trim();
    const visible = state.boards.filter(b =>
        !q || (b.name || '').toLowerCase().includes(q)
    );

    const lastOpened = (state.settings && state.settings.lastOpened) || {};

    visible.forEach(board => {
        const card = document.getElementById('kbBoardCardTemplate')
            .content.firstElementChild.cloneNode(true);
        card.dataset.id = board.id;

        const color = window.kbBoardColor
            ? kbBoardColor(board)
            : 'var(--accent-color)';
        const cover = card.querySelector('.kb-board-cover');
        cover.style.background =
            `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 72%, #1e293b))`;
        card.querySelector('.kb-board-name').textContent = board.name || 'Untitled Board';

        const cardCount = Array.isArray(board.cards) ? board.cards.length : 0;
        const colCount = Array.isArray(board.columns) ? board.columns.length : 0;
        card.querySelector('.kb-board-meta').textContent =
            `${cardCount} card${cardCount === 1 ? '' : 's'} · ${colCount} list${colCount === 1 ? '' : 's'}`;

        card.addEventListener('click', () => openBoard(board.id));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openBoard(board.id);
            }
        });
        card.querySelector('.kb-board-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            openNameModal('Rename Board', board.name, async (name) => {
                const ok = await kanbanStorage.renameBoard(board.id, name);
                if (ok) {
                    board.name = name;
                    renderBoards();
                    showNotification('Board renamed');
                } else {
                    showNotification('Rename failed', 'error');
                }
            });
        });
        card.querySelector('.kb-board-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            openConfirm(
                'Delete Board',
                `"${board.name || 'Untitled Board'}" will be deleted. This cannot be undone.`,
                async () => {
                    const ok = await kanbanStorage.deleteBoard(board.id);
                    if (ok) {
                        state.boards = state.boards.filter(b => b.id !== board.id);
                        delete lastOpened[board.id];
                        renderBoards();
                        showNotification('Board deleted');
                    } else {
                        showNotification('Delete failed', 'error');
                    }
                }
            );
        });
        grid.appendChild(card);
    });

    document.getElementById('boardsNoResults').classList.toggle('hidden', q === '' || visible.length > 0);
    document.getElementById('boardsEmpty').classList.toggle('hidden', state.boards.length > 0);

    const cards = state.boards.reduce((n, b) => n + (Array.isArray(b.cards) ? b.cards.length : 0), 0);
    document.getElementById('kanbanFooterStats').textContent =
        `${state.boards.length} board${state.boards.length === 1 ? '' : 's'} · ${cards} card${cards === 1 ? '' : 's'}`;
    if (state.userDoc) {
        state.userDoc.kanban = state.boards;
        document.dispatchEvent(new CustomEvent('wd:home-data', { detail: { app: 'kanban', data: state.userDoc } }));
    }
}

async function openBoard(boardId, { historyMode = 'push' } = {}) {
    if (!state.userDoc) return;
    const navigation = ++state.navigation;
    const previousId = KanbanBoard.currentBoard()?.id;
    const url = id => id ? '/kanban/?board=' + encodeURIComponent(id) : '/kanban/';
    const waitingForSave = KanbanBoard.dirty || KanbanBoard.saving;
    if (waitingForSave) showLoading(true);
    try {
        if (!(await KanbanBoard.flush())) {
            if (navigation === state.navigation) history.replaceState({}, '', url(previousId));
            return; // Never leave unsaved edits behind on a failed request.
        }
        if (navigation !== state.navigation) return;
        closeAllPopovers();
        KanbanBoard.destroy();
        if (boardId && !state.boards.some(board => board.id === boardId)) {
            showNotification('Board not found', 'error');
            boardId = null;
            historyMode = 'replace';
        }
        state.userDoc.kanban = state.boards;
        if (boardId) {
            KanbanBoard.open(boardId, state.userDoc);
            showBoardView();
        } else {
            renderBoards();
            showBoardsView();
        }
        if (historyMode === 'replace') history.replaceState({}, '', url(boardId));
        else if (historyMode === 'push' && requestedBoardId() !== boardId) history.pushState({}, '', url(boardId));
    } finally {
        if (waitingForSave && navigation === state.navigation) showLoading(false);
    }
}

async function createBoard(name) {
    if (state.creating || !state.userDoc) return;
    state.creating = true;
    const navigation = state.navigation;
    showLoading(true);
    try {
        const board = await kanbanStorage.createBoard(name);
        if (!board) {
            showNotification('Failed to create board. Please try again.', 'error');
            return;
        }
        state.boards.unshift(board);
        // The creation response is the authoritative board. Render it directly;
        // no navigation reload, repeat sign-in check, or second boards request.
        if (navigation === state.navigation) await openBoard(board.id);
        else renderBoards(); // A browser-back during creation keeps its destination.
    } finally {
        state.creating = false;
        showLoading(false);
    }
}

// ================================================
// Modals
// ================================================

let nameModalAction = null;

function openNameModal(title, initial, onConfirm) {
    const modal = document.getElementById('nameModal');
    document.getElementById('nameModalTitle').textContent = title;
    document.getElementById('confirmNameModal').textContent = initial ? 'Rename' : 'Create';
    const input = document.getElementById('nameModalInput');
    input.value = initial || '';
    nameModalAction = onConfirm;
    modal.classList.add('open');
    input.focus();
    input.select();
}

function closeNameModal() {
    document.getElementById('nameModal').classList.remove('open');
    nameModalAction = null;
}

async function confirmNameModal() {
    const input = document.getElementById('nameModalInput');
    const name = input.value.trim();
    if (!name || !nameModalAction) return;
    const action = nameModalAction;
    closeNameModal();
    await action(name);
}

let confirmAction = null;

function openConfirm(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    confirmAction = onConfirm;
    modal.classList.add('open');
}

function closeConfirm() {
    document.getElementById('confirmModal').classList.remove('open');
    confirmAction = null;
}

async function runConfirm() {
    const action = confirmAction;
    closeConfirm();
    if (action) await action();
}

function closeAllPopovers() {
    document.getElementById('checklistModal').classList.remove('open');
    document.getElementById('wipLimitModal').classList.remove('open');
    if (window.KanbanBoard) KanbanBoard.closeOverlays();
    closeNameModal();
    closeConfirm();
    document.getElementById('settingsDropdown').classList.remove('open');
    document.getElementById('themeSubmenu').classList.remove('open');
}

// ================================================
// Chrome (nav, settings, modals)
// ================================================

function wireChrome() {
    document.getElementById('homeBtn').addEventListener('click', () => {
        if (KanbanBoard.currentBoard()) {
            openBoard(null);
        } else {
            window.location.href = '/home';
        }
    });
    window.addEventListener('popstate', () => openBoard(requestedBoardId(), { historyMode: 'none' }));
    window.addEventListener('beforeunload', event => {
        if (KanbanBoard.dirty || KanbanBoard.saving || state.creating) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    document.getElementById('newBoardBtn').addEventListener('click', () => {
        openNameModal('New Board', '', (name) => createBoard(name));
    });
    document.getElementById('emptyNewBoardBtn').addEventListener('click', () => {
        openNameModal('New Board', '', (name) => createBoard(name));
    });

    // Board title -> rename
    document.getElementById('pageTitle').addEventListener('click', () => {
        const board = KanbanBoard.currentBoard();
        if (!board) return;
        openNameModal('Rename Board', board.name, async (name) => {
            const ok = await kanbanStorage.renameBoard(board.id, name);
            if (ok) {
                board.name = name;
                document.getElementById('pageTitle').textContent = name;
                window.WDPageTitle?.file(name);
                showNotification('Board renamed');
            } else {
                showNotification('Rename failed', 'error');
            }
        });
    });

    // Home search
    const searchInput = document.getElementById('listsSearchInput');
    searchInput.addEventListener('input', () => {
        state.searchQuery = searchInput.value;
        renderBoards();
    });
    document.getElementById('listsSearchClear').addEventListener('click', () => {
        searchInput.value = '';
        state.searchQuery = '';
        renderBoards();
    });
    const searchToggle = document.getElementById('boardsSearchToggle');
    searchToggle.addEventListener('click', () => {
        const bar = document.getElementById('listsSearchBar');
        bar.classList.toggle('open');
        if (bar.classList.contains('open')) searchInput.focus();
    });

    // Name modal
    document.getElementById('nameModalClose').addEventListener('click', closeNameModal);
    document.getElementById('cancelNameModal').addEventListener('click', closeNameModal);
    document.getElementById('confirmNameModal').addEventListener('click', confirmNameModal);
    document.getElementById('nameModalInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmNameModal();
        }
    });

    // Confirm modal
    document.getElementById('confirmModalClose').addEventListener('click', closeConfirm);
    document.getElementById('cancelConfirm').addEventListener('click', closeConfirm);
    document.getElementById('confirmAction').addEventListener('click', runConfirm);

    // Checklist dialog
    document.getElementById('checklistModalClose').addEventListener('click', () => KanbanBoard.closeChecklist());
    document.getElementById('checklistAddBtn').addEventListener('click', () => KanbanBoard.addChecklistItem());
    document.getElementById('checklistNewItem').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            KanbanBoard.addChecklistItem();
        }
    });

    // WIP limit dialog
    document.getElementById('wipLimitModalClose').addEventListener('click', () => KanbanBoard.closeWipLimit());
    document.getElementById('cancelWipLimit').addEventListener('click', () => KanbanBoard.closeWipLimit());
    document.getElementById('confirmWipLimit').addEventListener('click', () => KanbanBoard.confirmWipLimit());
    document.getElementById('wipLimitInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            KanbanBoard.confirmWipLimit();
        }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => kanbanAuth.logout());

    // Settings dropdown
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsDropdown = document.getElementById('settingsDropdown');
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsDropdown.classList.toggle('open');
        document.getElementById('themeSubmenu').classList.remove('open');
    });
    document.addEventListener('click', (e) => {
        if (!settingsDropdown.contains(e.target) && e.target !== settingsBtn) {
            settingsDropdown.classList.remove('open');
            document.getElementById('themeSubmenu').classList.remove('open');
        }
    });
    document.getElementById('themeToggleBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('themeSubmenu').classList.toggle('open');
    });
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            kanbanThemeManager.setTheme(btn.dataset.theme);
            settingsDropdown.classList.remove('open');
            document.getElementById('themeSubmenu').classList.remove('open');
        });
    });

    // Escape closes popovers/modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllPopovers();
    });
}

// ================================================
// Helpers
// ================================================

let notificationTimer = null;

function showNotification(message, type) {
    const el = document.getElementById('notification');
    el.textContent = message;
    el.className = 'notification show' + (type === 'error' ? ' error' : '');
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        el.className = 'notification';
    }, 2500);
}

function showLoading(show) {
    document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

if (typeof window !== 'undefined') {
    window.showNotification = showNotification;
    window.showLoading = showLoading;
}