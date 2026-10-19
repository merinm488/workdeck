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
    searchQuery: ''
};

// ================================================
// Boot
// ================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    kanbanThemeManager.init();
    wireChrome();

    const session = kanbanAuth.getSession();
    if (!session) {
        window.location.href = '/';
        return;
    }
    state.userHash = session.hash;

    showLoading(true);
    const doc = await kanbanStorage.loadUserData();
    showLoading(false);

    if (!doc) {
        kanbanAuth.logout();
        return;
    }

    kanbanThemeManager.applyFromServer(doc.settings && doc.settings.theme);
    state.settings = doc.settings || {};
    state.boards = doc.kanban || [];

    const pathId = (/^\/kanban\/([a-z0-9]{14,})\/?$/.exec(window.location.pathname) || [])[1];
    const boardId = pathId ||
        new URLSearchParams(window.location.search).get('board');
    if (boardId) {
        showBoardView();
        const opened = await KanbanBoard.open(boardId, doc);
        if (!opened) {
            showNotification('Board not found', 'error');
            window.location.href = '/kanban/';
        }
    } else {
        showBoardsView();
        renderBoards();
    }
}

// ================================================
// Views
// ================================================

function showBoardsView() {
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
        card.querySelector('.kb-board-name').textContent = board.name || 'Untitled Board';
        const cardCount = Array.isArray(board.cards) ? board.cards.length : 0;
        const colCount = Array.isArray(board.columns) ? board.columns.length : 0;
        card.querySelector('.kb-board-meta').textContent =
            `${cardCount} card${cardCount === 1 ? '' : 's'} · ${colCount} column${colCount === 1 ? '' : 's'}`;

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
}

function openBoard(boardId) {
    window.location.href = '/kanban/?board=' + encodeURIComponent(boardId);
}

async function createBoard(name) {
    showLoading(true);
    const board = await kanbanStorage.createBoard(name);
    showLoading(false);
    if (!board) {
        showNotification('Failed to create board', 'error');
        return;
    }
    state.boards.unshift(board);
    openBoard(board.id);
}

// ================================================
// Modals
// ================================================

let nameModalAction = null;

function openNameModal(title, initial, onConfirm) {
    const modal = document.getElementById('nameModal');
    document.getElementById('nameModalTitle').textContent = title;
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
    closeNameModal();
    closeConfirm();
    document.getElementById('keyModal').classList.remove('open');
    document.getElementById('deleteAccountModal').classList.remove('open');
    document.getElementById('settingsDropdown').classList.remove('open');
    document.getElementById('themeSubmenu').classList.remove('open');
}

// ================================================
// Chrome (nav, settings, modals)
// ================================================

function wireChrome() {
    document.getElementById('homeBtn').addEventListener('click', () => {
        if (new URLSearchParams(window.location.search).get('board')) {
            window.location.href = '/kanban/';
        } else {
            window.location.href = '/';
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

    // Key modal
    document.getElementById('viewKeyBtn').addEventListener('click', () => {
        const key = getKanbanUserKey() || '-';
        document.getElementById('keyText').textContent = key;
        document.getElementById('keyModal').classList.add('open');
    });
    document.getElementById('keyModalClose').addEventListener('click', () => {
        document.getElementById('keyModal').classList.remove('open');
    });
    document.getElementById('keyModalCloseBtn').addEventListener('click', () => {
        document.getElementById('keyModal').classList.remove('open');
    });
    document.getElementById('keyCopyBtn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(getKanbanUserKey() || '');
            const feedback = document.getElementById('keyCopyFeedback');
            feedback.classList.add('visible');
            setTimeout(() => feedback.classList.remove('visible'), 1500);
        } catch (err) { /* clipboard unavailable */ }
    });

    // Delete account
    document.getElementById('deleteAccountBtn').addEventListener('click', () => {
        document.getElementById('deleteAccountModal').classList.add('open');
    });
    document.getElementById('deleteAccountModalClose').addEventListener('click', () => {
        document.getElementById('deleteAccountModal').classList.remove('open');
    });
    document.getElementById('cancelDeleteAccount').addEventListener('click', () => {
        document.getElementById('deleteAccountModal').classList.remove('open');
    });
    document.getElementById('confirmDeleteAccount').addEventListener('click', async () => {
        const result = await kanbanAuth.deleteAccount();
        if (!result.success) showNotification(result.error || 'Failed to delete account', 'error');
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