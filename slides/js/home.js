/**
 * ================================================
 * SLIDES - Home
 * ================================================
 *
 * The /slides/ home page: every deck on the account
 * (open/rename/delete/create). One deck = the editor at /slides/<id>.
 */

// ================================================
// State
// ================================================

let decks = [];  // the account's decks (userData.slides)

// Home layout: 'cards' grid or 'list' rows (toggle in the top bar)
const HOME_LAYOUT_STORAGE_KEY = 'slides_home_layout';
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
const newDeckBtn = $('newDeckBtn');
const emptyNewDeckBtn = $('emptyNewDeckBtn');
const homeSearchInput = $('homeSearchInput');
const homeSearchClear = $('homeSearchClear');
const clearHomeSearchBtn = $('clearHomeSearchBtn');
const homeSearchToggle = $('homeSearchToggle');
const homeLayoutBtn = $('homeLayoutBtn');
const topNav = document.querySelector('.top-nav');

const footerStats = $('slidesFooterStats');
const loadingOverlay = $('loadingOverlay');

const keyModal = $('keyModal');
const keyText = $('keyText');
const keyCopyBtn = $('keyCopyBtn');
const keyCopyFeedback = $('keyCopyFeedback');
const deleteAccountModal = $('deleteAccountModal');
const renameDeckModal = $('renameDeckModal');
const renameDeckInput = $('renameDeckInput');
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
    modal.classList.add('open');
}

function closeModal(modal) {
    modal.classList.remove('open');
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

function openRenameDeck(deck) {
    renameDeckInput.value = deck.name === 'Untitled Deck' ? '' : deck.name;
    renameCallback = async () => {
        const name = renameDeckInput.value.trim();
        if (!name) {
            showNotification('Please enter a deck name', 'error');
            return;
        }
        const saved = await slidesStorage.saveDeck(deck.id, { name });
        if (saved) {
            deck.name = name;
            deck.updatedAt = new Date().toISOString();
            closeModal(renameDeckModal);
            renderDecks();
            showNotification('Deck renamed!');
        } else {
            showNotification('Failed to rename deck. Please try again.', 'error');
        }
    };
    openModal(renameDeckModal);
    renameDeckInput.focus();
}

// ================================================
// Home grid
// ================================================

function getSearchQuery() {
    return homeSearchInput.value.trim().toLowerCase();
}

function deckMatchesSearch(deck, q) {
    if (!q) return true;
    return (deck.name || 'Untitled Deck').toLowerCase().includes(q);
}

function slideCount(deck) {
    return Array.isArray(deck.slides) ? deck.slides.length : 0;
}

function renderDecks() {
    homeGrid.innerHTML = '';

    const q = getSearchQuery();
    const sorted = [...decks]
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .filter(deck => deckMatchesSearch(deck, q));

    homeEmpty.classList.toggle('hidden', decks.length > 0);
    homeNoResults.classList.toggle('hidden', decks.length === 0 || sorted.length > 0);
    if (decks.length === 0 || sorted.length === 0) {
        updateFooter();
        return;
    }

    sorted.forEach(deck => {
        const slides = slideCount(deck);

        const card = $('slidesCardTemplate').content.firstElementChild.cloneNode(true);
        card.dataset.id = deck.id;
        card.querySelector('.home-card-name').textContent = deck.name || 'Untitled Deck';
        card.querySelector('.home-card-meta').textContent =
            (slides === 1 ? '1 slide' : slides + ' slides') +
            (deck.updatedAt ? ' · ' + formatRelativeDate(deck.updatedAt) : '');

        card.addEventListener('click', () => WDLinks.open('slides', deck.id));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                WDLinks.open('slides', deck.id);
            }
        });
        card.querySelector('.home-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            openRenameDeck(deck);
        });
        card.querySelector('.home-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            openConfirm(
                'Delete Deck',
                `Delete "${deck.name || 'Untitled Deck'}"? This cannot be undone.`,
                'Delete Deck',
                async () => {
                    const saved = await slidesStorage.deleteDeck(deck.id);
                    if (saved) {
                        decks = decks.filter(d => d.id !== deck.id);
                        closeModal(confirmModal);
                        renderDecks();
                        showNotification('Deck deleted!');
                    } else {
                        showNotification('Failed to delete deck. Please try again.', 'error');
                    }
                }
            );
        });

        homeGrid.appendChild(card);
    });

    updateFooter();
}

async function createNewDeck() {
    const hash = getSlidesUserHash();
    if (!hash) {
        window.location.href = '/';
        return;
    }

    try {
        const response = await fetch('/api/workdeck', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash, action: 'createDeck', data: {} })
        });
        const result = await response.json();
        const created = result && result.success && result.data &&
            result.data.slides && result.data.slides[0];
        if (!created) throw new Error(result && result.error);

        WDLinks.recordOpen('slides', created.id);
        window.location.assign('/slides/' + encodeURIComponent(created.id));
    } catch (error) {
        console.error('[HOME] Create error:', error);
        showNotification('Failed to create deck. Please try again.', 'error');
    }
}

function clearHomeSearch() {
    homeSearchInput.value = '';
    homeSearchClear.classList.add('hidden');
    renderDecks();
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
    const slides = decks.reduce((n, d) => n + slideCount(d), 0);
    footerStats.textContent =
        `${decks.length} deck${decks.length === 1 ? '' : 's'} · ` +
        `${slides} slide${slides === 1 ? '' : 's'}`;
}

function updateThemeIndicator() {
    const themeText = document.getElementById('themeText');
    if (!themeText) return;
    themeText.textContent = 'Theme: ' + slidesThemeManager.getDisplayLabel();

    const pref = slidesThemeManager.getPreference();
    document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.toggle('active', option.dataset.theme === pref);
    });
}

function closeSettingsMenus() {
    settingsDropdown.classList.remove('open');
    themeSubmenu.classList.remove('open');
    themeToggleBtn.closest('.theme-dropdown-container').classList.remove('active');
}

// ================================================
// Events
// ================================================

function wireEvents() {
    homeBtn.addEventListener('click', () => {
        window.location.href = '/';
    });

    newDeckBtn.addEventListener('click', createNewDeck);
    emptyNewDeckBtn.addEventListener('click', createNewDeck);

    homeSearchInput.addEventListener('input', () => {
        homeSearchClear.classList.toggle('hidden', !homeSearchInput.value);
        renderDecks();
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

    themeToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        themeSubmenu.classList.toggle('open');
        themeToggleBtn.closest('.theme-dropdown-container').classList.toggle('active');
    });

    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            slidesThemeManager.setTheme(btn.dataset.theme);
            updateThemeIndicator();
            closeSettingsMenus();
        });
    });

    viewKeyBtn.addEventListener('click', () => {
        keyText.textContent = slidesAuth.getUserKey() || '-';
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

    logoutBtn.addEventListener('click', () => slidesAuth.logout());
    deleteAccountBtn.addEventListener('click', () => {
        closeSettingsMenus();
        openModal(deleteAccountModal);
    });

    // Modal close buttons
    $('keyModalClose').addEventListener('click', () => closeModal(keyModal));
    $('keyModalCloseBtn').addEventListener('click', () => closeModal(keyModal));
    $('deleteAccountModalClose').addEventListener('click', () => closeModal(deleteAccountModal));
    $('cancelDeleteAccount').addEventListener('click', () => closeModal(deleteAccountModal));
    $('renameDeckModalClose').addEventListener('click', () => closeModal(renameDeckModal));
    $('cancelRenameDeck').addEventListener('click', () => closeModal(renameDeckModal));
    $('confirmModalClose').addEventListener('click', () => closeModal(confirmModal));
    $('cancelConfirm').addEventListener('click', () => closeModal(confirmModal));

    confirmActionBtn.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
    });

    $('confirmRenameDeck').addEventListener('click', () => {
        if (renameCallback) renameCallback();
    });

    renameDeckInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && renameCallback) renameCallback();
    });

    $('confirmDeleteAccount').addEventListener('click', async () => {
        const result = await slidesAuth.deleteAccount();
        if (!result.success) {
            closeModal(deleteAccountModal);
            showNotification(result.error || 'Failed to delete account', 'error');
        }
    });

    // Close modals on backdrop click / Escape
    [keyModal, deleteAccountModal, renameDeckModal, confirmModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            [keyModal, deleteAccountModal, renameDeckModal, confirmModal].forEach(m => {
                if (m.classList.contains('open')) closeModal(m);
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
    slidesThemeManager.init();

    const session = slidesAuth.getSession();
    if (!session) {
        window.location.href = '/';
        return;
    }

    wireEvents();

    loadingOverlay.classList.remove('hidden');

    const userData = await slidesStorage.loadUserData();
    if (!userData) {
        // Account gone (deleted elsewhere) — clear mirrors and bail.
        slidesAuth.logout();
        return;
    }

    slidesThemeManager.applyFromServer(userData.settings && userData.settings.theme);

    decks = Array.isArray(userData.slides) ? userData.slides : [];

    try {
        homeLayout = localStorage.getItem(HOME_LAYOUT_STORAGE_KEY) === 'list' ? 'list' : 'cards';
    } catch (err) { /* private mode */ }
    applyHomeLayout(homeLayout);

    renderDecks();
    updateThemeIndicator();

    loadingOverlay.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', init);