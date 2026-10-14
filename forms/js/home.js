/**
 * ================================================
 * FORMS - Home
 * ================================================
 *
 * The /forms/ home page: every form on the account
 * (open/rename/delete/create). One form = the Questions/Responses editor
 * at /forms/<id>.
 */

// ================================================
// State
// ================================================

let forms = [];  // the account's forms (userData.forms)

// Home layout: 'cards' grid or 'list' rows (toggle in the top bar)
const HOME_LAYOUT_STORAGE_KEY = 'forms_home_layout';
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
const newFormBtn = $('newFormBtn');
const emptyNewFormBtn = $('emptyNewFormBtn');
const homeSearchInput = $('homeSearchInput');
const homeSearchClear = $('homeSearchClear');
const clearHomeSearchBtn = $('clearHomeSearchBtn');
const homeSearchToggle = $('homeSearchToggle');
const homeLayoutBtn = $('homeLayoutBtn');
const topNav = document.querySelector('.top-nav');

const footerStats = $('formsFooterStats');
const loadingOverlay = $('loadingOverlay');

const keyModal = $('keyModal');
const keyText = $('keyText');
const keyCopyBtn = $('keyCopyBtn');
const keyCopyFeedback = $('keyCopyFeedback');
const deleteAccountModal = $('deleteAccountModal');
const renameFormModal = $('renameFormModal');
const renameFormInput = $('renameFormInput');
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

function openRenameForm(form) {
    renameFormInput.value = form.name === 'Untitled Form' ? '' : form.name;
    renameCallback = async () => {
        const name = renameFormInput.value.trim();
        if (!name) {
            showNotification('Please enter a form name', 'error');
            return;
        }
        const saved = await formsStorage.saveForm(form.id, { name });
        if (saved) {
            form.name = name;
            form.updatedAt = new Date().toISOString();
            closeModal(renameFormModal);
            renderForms();
            showNotification('Form renamed!');
        } else {
            showNotification('Failed to rename form. Please try again.', 'error');
        }
    };
    openModal(renameFormModal);
    renameFormInput.focus();
}

// ================================================
// Home grid
// ================================================

function getSearchQuery() {
    return homeSearchInput.value.trim().toLowerCase();
}

function formMatchesSearch(form, q) {
    if (!q) return true;
    return (form.name || 'Untitled Form').toLowerCase().includes(q);
}

function questionCount(form) {
    return Array.isArray(form.components) ? form.components.length : 0;
}

function renderForms() {
    homeGrid.innerHTML = '';

    const q = getSearchQuery();
    const sorted = [...forms]
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .filter(form => formMatchesSearch(form, q));

    homeEmpty.classList.toggle('hidden', forms.length > 0);
    homeNoResults.classList.toggle('hidden', forms.length === 0 || sorted.length > 0);
    if (forms.length === 0 || sorted.length === 0) {
        updateFooter();
        return;
    }

    sorted.forEach(form => {
        const questions = questionCount(form);

        const card = $('formsCardTemplate').content.firstElementChild.cloneNode(true);
        card.dataset.id = form.id;
        card.querySelector('.home-card-name').textContent = form.name || 'Untitled Form';
        card.querySelector('.home-card-meta').textContent =
            (questions === 1 ? '1 question' : questions + ' questions') +
            (form.updatedAt ? ' · ' + formatRelativeDate(form.updatedAt) : '');

        card.addEventListener('click', () => WDLinks.open('forms', form.id));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                WDLinks.open('forms', form.id);
            }
        });
        card.querySelector('.home-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            openRenameForm(form);
        });
        card.querySelector('.home-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            openConfirm(
                'Delete Form',
                `Delete "${form.name || 'Untitled Form'}" and all its responses? This cannot be undone.`,
                'Delete Form',
                async () => {
                    const saved = await formsStorage.deleteForm(form.id);
                    if (saved) {
                        forms = forms.filter(f => f.id !== form.id);
                        closeModal(confirmModal);
                        renderForms();
                        showNotification('Form deleted!');
                    } else {
                        showNotification('Failed to delete form. Please try again.', 'error');
                    }
                }
            );
        });

        homeGrid.appendChild(card);
    });

    updateFooter();
}

async function createNewForm() {
    const hash = getFormsUserHash();
    if (!hash) {
        window.location.href = '/';
        return;
    }

    try {
        const response = await fetch('/api/workdeck', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash, action: 'createForm', data: {} })
        });
        const result = await response.json();
        const created = result && result.success && result.data &&
            result.data.forms && result.data.forms[0];
        if (!created) throw new Error(result && result.error);

        WDLinks.recordOpen('forms', created.id);
        window.location.assign('/forms/' + encodeURIComponent(created.id));
    } catch (error) {
        console.error('[HOME] Create error:', error);
        showNotification('Failed to create form. Please try again.', 'error');
    }
}

function clearHomeSearch() {
    homeSearchInput.value = '';
    homeSearchClear.classList.add('hidden');
    renderForms();
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
    const questions = forms.reduce((n, f) => n + questionCount(f), 0);
    footerStats.textContent =
        `${forms.length} form${forms.length === 1 ? '' : 's'} · ` +
        `${questions} question${questions === 1 ? '' : 's'}`;
}

function updateThemeIndicator() {
    const themeText = document.getElementById('themeText');
    if (!themeText) return;
    themeText.textContent = 'Theme: ' + formsThemeManager.getDisplayLabel();

    const pref = formsThemeManager.getPreference();
    document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.toggle('active', option.dataset.theme === pref);
    });
}

function closeSettingsMenus() {
    settingsDropdown.classList.remove('active');
    themeSubmenu.classList.remove('active');
    themeToggleBtn.closest('.theme-dropdown-container').classList.remove('active');
}

// ================================================
// Events
// ================================================

function wireEvents() {
    homeBtn.addEventListener('click', () => {
        window.location.href = '/';
    });

    newFormBtn.addEventListener('click', createNewForm);
    emptyNewFormBtn.addEventListener('click', createNewForm);

    homeSearchInput.addEventListener('input', () => {
        homeSearchClear.classList.toggle('hidden', !homeSearchInput.value);
        renderForms();
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
        settingsDropdown.classList.toggle('active');
    });

    themeToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        themeSubmenu.classList.toggle('active');
        themeToggleBtn.closest('.theme-dropdown-container').classList.toggle('active');
    });

    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            formsThemeManager.setTheme(btn.dataset.theme);
            updateThemeIndicator();
            closeSettingsMenus();
        });
    });

    viewKeyBtn.addEventListener('click', () => {
        keyText.textContent = formsAuth.getUserKey() || '-';
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

    logoutBtn.addEventListener('click', () => formsAuth.logout());
    deleteAccountBtn.addEventListener('click', () => {
        closeSettingsMenus();
        openModal(deleteAccountModal);
    });

    // Modal close buttons
    $('keyModalClose').addEventListener('click', () => closeModal(keyModal));
    $('keyModalCloseBtn').addEventListener('click', () => closeModal(keyModal));
    $('deleteAccountModalClose').addEventListener('click', () => closeModal(deleteAccountModal));
    $('cancelDeleteAccount').addEventListener('click', () => closeModal(deleteAccountModal));
    $('renameFormModalClose').addEventListener('click', () => closeModal(renameFormModal));
    $('cancelRenameForm').addEventListener('click', () => closeModal(renameFormModal));
    $('confirmModalClose').addEventListener('click', () => closeModal(confirmModal));
    $('cancelConfirm').addEventListener('click', () => closeModal(confirmModal));

    confirmActionBtn.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
    });

    $('confirmRenameForm').addEventListener('click', () => {
        if (renameCallback) renameCallback();
    });

    renameFormInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && renameCallback) renameCallback();
    });

    $('confirmDeleteAccount').addEventListener('click', async () => {
        const result = await formsAuth.deleteAccount();
        if (!result.success) {
            closeModal(deleteAccountModal);
            showNotification(result.error || 'Failed to delete account', 'error');
        }
    });

    // Close modals on backdrop click / Escape
    [keyModal, deleteAccountModal, renameFormModal, confirmModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            [keyModal, deleteAccountModal, renameFormModal, confirmModal].forEach(m => {
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
    formsThemeManager.init();

    const session = formsAuth.getSession();
    if (!session) {
        window.location.href = '/';
        return;
    }

    wireEvents();

    loadingOverlay.classList.remove('hidden');

    const userData = await formsStorage.loadUserData();
    if (!userData) {
        // Account gone (deleted elsewhere) — clear mirrors and bail.
        formsAuth.logout();
        return;
    }

    formsThemeManager.applyFromServer(userData.settings && userData.settings.theme);

    forms = Array.isArray(userData.forms) ? userData.forms : [];

    try {
        homeLayout = localStorage.getItem(HOME_LAYOUT_STORAGE_KEY) === 'list' ? 'list' : 'cards';
    } catch (err) { /* private mode */ }
    applyHomeLayout(homeLayout);

    renderForms();
    updateThemeIndicator();

    loadingOverlay.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', init);