/**
 * ================================================
 * DRAW - Home
 * ================================================
 *
 * The /draw/ home page: every drawing on the account
 * (open/rename/delete/create). One drawing = the editor at /draw/<id>.
 */

// ================================================
// State
// ================================================

let drawings = [];  // the account's drawings (userData.draws)
let notificationTimer = null;

// Home layout: 'cards' grid or 'list' rows (toggle in the top bar)
const HOME_LAYOUT_STORAGE_KEY = 'draw_home_layout';
let homeLayout = 'cards';

// ================================================
// DOM
// ================================================

const $ = (id) => document.getElementById(id);

const homeBtn = $('homeBtn');
const settingsBtn = $('settingsBtn');
const settingsDropdown = $('settingsDropdown');
const themeToggleBtn = $('themeToggleBtn');
const themeSubmenu = $('themeSubmenu');
const viewKeyBtn = $('viewKeyBtn');
const logoutBtn = $('logoutBtn');
const deleteAccountBtn = $('deleteAccountBtn');

const homeGrid = $('homeGrid');
const homeEmpty = $('homeEmpty');
const homeNoResults = $('homeNoResults');
const newDrawingBtn = $('newDrawingBtn');
const emptyNewDrawingBtn = $('emptyNewDrawingBtn');
const homeSearchInput = $('homeSearchInput');
const homeSearchClear = $('homeSearchClear');
const clearHomeSearchBtn = $('clearHomeSearchBtn');
const homeSearchToggle = $('homeSearchToggle');
const homeLayoutBtn = $('homeLayoutBtn');
const topNav = document.querySelector('.top-nav');

const footerStats = $('drawFooterStats');
const loadingOverlay = $('loadingOverlay');

const keyModal = $('keyModal');
const keyText = $('keyText');
const keyCopyBtn = $('keyCopyBtn');
const keyCopyFeedback = $('keyCopyFeedback');
const deleteAccountModal = $('deleteAccountModal');
const renameDrawingModal = $('renameDrawingModal');
const renameDrawingInput = $('renameDrawingInput');
const confirmModal = $('confirmModal');
const confirmTitle = $('confirmTitle');
const confirmMessage = $('confirmMessage');
const confirmActionBtn = $('confirmAction');

// ================================================
// Small helpers
// ================================================

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

function showNotification(message, isError = false) {
    const el = $('notification');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');

    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        el.classList.remove('show');
    }, 2500);
}

// ================================================
// Modals (the editor's .open convention)
// ================================================

function openModal(el) {
    el.classList.add('open');
}

function closeModal(el) {
    el.classList.remove('open');
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

function openRenameDrawing(drawing) {
    renameDrawingInput.value = drawing.name === 'Untitled Drawing' ? '' : drawing.name;
    renameCallback = async () => {
        const name = renameDrawingInput.value.trim();
        if (!name) {
            showNotification('Please enter a drawing name', true);
            return;
        }
        const saved = await drawStorage.saveDrawing(drawing.id, { name });
        if (saved) {
            drawing.name = name;
            drawing.updatedAt = new Date().toISOString();
            closeModal(renameDrawingModal);
            renderDrawings();
            showNotification('Drawing renamed!');
        } else {
            showNotification('Failed to rename drawing. Please try again.', true);
        }
    };
    openModal(renameDrawingModal);
    renameDrawingInput.focus();
}

// ================================================
// Home grid
// ================================================

function getSearchQuery() {
    return homeSearchInput.value.trim().toLowerCase();
}

function drawingMatchesSearch(drawing, q) {
    if (!q) return true;
    return (drawing.name || 'Untitled Drawing').toLowerCase().includes(q);
}

function renderDrawings() {
    homeGrid.innerHTML = '';

    const q = getSearchQuery();
    const sorted = [...drawings]
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .filter(drawing => drawingMatchesSearch(drawing, q));

    homeEmpty.classList.toggle('hidden', drawings.length > 0);
    homeNoResults.classList.toggle('hidden', drawings.length === 0 || sorted.length > 0);
    if (drawings.length === 0 || sorted.length === 0) {
        updateFooter();
        return;
    }

    sorted.forEach(drawing => {
        const card = $('drawsCardTemplate').content.firstElementChild.cloneNode(true);
        card.dataset.id = drawing.id;
        card.querySelector('.home-card-name').textContent = drawing.name || 'Untitled Drawing';
        card.querySelector('.home-card-meta').textContent =
            drawing.updatedAt ? 'Edited ' + formatRelativeDate(drawing.updatedAt) : '';

        card.addEventListener('click', () => WDLinks.open('draw', drawing.id));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                WDLinks.open('draw', drawing.id);
            }
        });
        card.querySelector('.home-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            openRenameDrawing(drawing);
        });
        card.querySelector('.home-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            openConfirm(
                'Delete Drawing',
                `Delete "${drawing.name || 'Untitled Drawing'}"? This cannot be undone.`,
                'Delete Drawing',
                async () => {
                    const saved = await drawStorage.deleteDrawing(drawing.id);
                    if (saved) {
                        drawings = drawings.filter(d => d.id !== drawing.id);
                        closeModal(confirmModal);
                        renderDrawings();
                        showNotification('Drawing deleted!');
                    } else {
                        showNotification('Failed to delete drawing. Please try again.', true);
                    }
                }
            );
        });

        homeGrid.appendChild(card);
    });

    updateFooter();
}

async function createNewDrawing() {
    const hash = getDrawUserHash();
    if (!hash) {
        window.location.href = '/';
        return;
    }

    try {
        const response = await fetch('/api/workdeck', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash, action: 'createDrawing', data: {} })
        });
        const result = await response.json();
        const created = result && result.success && result.data &&
            result.data.draws && result.data.draws[0];
        if (!created) throw new Error(result && result.error);

        WDLinks.recordOpen('draw', created.id);
        window.location.assign('/draw/' + encodeURIComponent(created.id));
    } catch (error) {
        console.error('[HOME] Create error:', error);
        showNotification('Failed to create drawing. Please try again.', true);
    }
}

function clearHomeSearch() {
    homeSearchInput.value = '';
    homeSearchClear.classList.add('hidden');
    renderDrawings();
    homeSearchInput.focus();
}

// ================================================
// Top bar: layout toggle + mobile search row
// ================================================

function applyHomeLayout(mode) {
    homeLayout = mode === 'list' ? 'list' : 'cards';
    const asList = homeLayout === 'list';

    homeGrid.classList.toggle('as-list', asList);
    homeLayoutBtn.setAttribute('aria-pressed', String(asList));
    homeLayoutBtn.querySelector('.layout-icon-list').classList.toggle('hidden', asList);
    homeLayoutBtn.querySelector('.layout-icon-cards').classList.toggle('hidden', !asList);
    const label = asList ? 'Switch to card view' : 'Switch to list view';
    homeLayoutBtn.title = label;
    homeLayoutBtn.setAttribute('aria-label', label);
}

function toggleHomeLayout() {
    applyHomeLayout(homeLayout === 'list' ? 'cards' : 'list');
    try {
        localStorage.setItem(HOME_LAYOUT_STORAGE_KEY, homeLayout);
    } catch (err) { /* private mode */ }
}

function setSearchOpen(open) {
    topNav.classList.toggle('search-open', open);
    if (open) homeSearchInput.focus();
}

// ================================================
// Footer / settings
// ================================================

function updateFooter() {
    footerStats.textContent =
        `${drawings.length} drawing${drawings.length === 1 ? '' : 's'}`;
}

function syncThemeControls() {
    $('themeText').textContent = 'Theme: ' + drawThemeManager.getDisplayLabel();
    const pref = drawThemeManager.getPreference();
    document.querySelectorAll('.theme-option').forEach((option) => {
        option.classList.toggle('active', option.dataset.theme === pref);
    });
}

function closeThemeSubmenu() {
    themeSubmenu.classList.remove('open');
    const container = themeToggleBtn.closest('.theme-dropdown-container');
    if (container) container.classList.remove('active');
}

function closeSettingsMenus() {
    settingsDropdown.classList.remove('open');
    closeThemeSubmenu();
}

// ================================================
// Events
// ================================================

function wireEvents() {
    homeBtn.addEventListener('click', () => {
        window.location.href = '/';
    });

    newDrawingBtn.addEventListener('click', createNewDrawing);
    emptyNewDrawingBtn.addEventListener('click', createNewDrawing);

    homeSearchInput.addEventListener('input', () => {
        homeSearchClear.classList.toggle('hidden', !homeSearchInput.value);
        renderDrawings();
    });
    homeSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (homeSearchInput.value) clearHomeSearch();
            else setSearchOpen(false);
        }
    });
    homeSearchClear.addEventListener('click', clearHomeSearch);
    clearHomeSearchBtn.addEventListener('click', clearHomeSearch);
    homeSearchToggle.addEventListener('click', () => {
        setSearchOpen(!topNav.classList.contains('search-open'));
    });

    homeLayoutBtn.addEventListener('click', toggleHomeLayout);

    // Settings dropdown
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsDropdown.classList.toggle('open');
    });

    // Theme row expands the submenu inline
    themeToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = themeSubmenu.classList.toggle('open');
        themeToggleBtn.closest('.theme-dropdown-container').classList.toggle('active', open);
    });

    document.querySelectorAll('.theme-option').forEach((option) => {
        option.addEventListener('click', () => {
            drawThemeManager.setTheme(option.dataset.theme);
            syncThemeControls();
            closeSettingsMenus();
        });
    });

    viewKeyBtn.addEventListener('click', () => {
        keyText.textContent = drawAuth.getUserKey() || '-';
        closeSettingsMenus();
        openModal(keyModal);
    });

    keyCopyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(keyText.textContent);
            keyCopyFeedback.classList.add('visible');
            setTimeout(() => keyCopyFeedback.classList.remove('visible'), 1500);
        } catch (err) {
            console.error('[HOME] Copy failed:', err);
        }
    });

    logoutBtn.addEventListener('click', () => drawAuth.logout());
    deleteAccountBtn.addEventListener('click', () => {
        closeSettingsMenus();
        openModal(deleteAccountModal);
    });

    // Modal close buttons
    $('keyModalClose').addEventListener('click', () => closeModal(keyModal));
    $('keyModalCloseBtn').addEventListener('click', () => closeModal(keyModal));
    $('deleteAccountModalClose').addEventListener('click', () => closeModal(deleteAccountModal));
    $('cancelDeleteAccount').addEventListener('click', () => closeModal(deleteAccountModal));
    $('renameDrawingModalClose').addEventListener('click', () => closeModal(renameDrawingModal));
    $('cancelRenameDrawing').addEventListener('click', () => closeModal(renameDrawingModal));
    $('confirmModalClose').addEventListener('click', () => closeModal(confirmModal));
    $('cancelConfirm').addEventListener('click', () => closeModal(confirmModal));

    confirmActionBtn.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
    });

    $('confirmRenameDrawing').addEventListener('click', () => {
        if (renameCallback) renameCallback();
    });

    renameDrawingInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && renameCallback) renameCallback();
    });

    $('confirmDeleteAccount').addEventListener('click', async () => {
        const result = await drawAuth.deleteAccount();
        if (!result.success) {
            closeModal(deleteAccountModal);
            showNotification(result.error || 'Failed to delete account', true);
        }
    });

    // Close modals on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            [keyModal, deleteAccountModal, renameDrawingModal, confirmModal].forEach(m => {
                if (m.classList.contains('open')) closeModal(m);
            });
            closeSettingsMenus();
        }
    });

    // A click anywhere else closes the dropdowns
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#settingsBtn, #settingsDropdown')) {
            closeSettingsMenus();
        }
    });
}

// ================================================
// Init
// ================================================

async function init() {
    drawThemeManager.init();

    const session = drawAuth.getSession();
    if (!session) {
        window.location.href = '/';
        return;
    }

    wireEvents();

    loadingOverlay.classList.remove('hidden');

    const userData = await drawStorage.loadUserData();
    if (!userData) {
        // Account gone (deleted elsewhere) — clear mirrors and bail.
        drawAuth.logout();
        return;
    }

    drawThemeManager.applyFromServer(userData.settings && userData.settings.theme);

    drawings = Array.isArray(userData.draws) ? userData.draws : [];

    try {
        homeLayout = localStorage.getItem(HOME_LAYOUT_STORAGE_KEY) === 'list' ? 'list' : 'cards';
    } catch (err) { /* private mode */ }
    applyHomeLayout(homeLayout);

    renderDrawings();
    syncThemeControls();

    loadingOverlay.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', init);
