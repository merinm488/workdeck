/**
 * ================================================
 * WORKDECK - Landing Page Application
 * ================================================
 * Drive-style home for the registered apps (Docs, Sheets, ...):
 * - Recent files across all apps (sorted by lastOpened, then updatedAt)
 * - + New dropdowns (header + empty state) with redirect into the app
 * - App filter (All files / per-app) via the filter chooser
 * - Theme via wdThemeManager, settings via the unified account document
 */

// ================================================
// Configuration
// ================================================

const WD_APP = {
    apiEndpoint: '/api/workdeck',
    // localStorage mirror of the view mode (server settings win on load)
    viewKey: 'workdeck_view_mode'
};

const DOC_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>'
    + '<polyline points="14 2 14 8 20 8"></polyline>'
    + '<line x1="16" y1="13" x2="8" y2="13"></line>'
    + '<line x1="16" y1="17" x2="8" y2="17"></line>'
    + '</svg>';

const SHEET_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3 10h18M3 14h18m-9-4v8m-7-6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2z" />'
    + '</svg>';

const FORM_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"></path>'
    + '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>'
    + '<line x1="9" y1="12" x2="15" y2="12"></line>'
    + '<line x1="9" y1="16" x2="13" y2="16"></line>'
    + '</svg>';

const SLIDE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect x="3" y="4" width="18" height="13" rx="2"></rect>'
      + '<line x1="12" y1="17" x2="12" y2="21"></line>'
      + '<line x1="8" y1="21" x2="16" y2="21"></line>'
      + '</svg>';

/**
 * App registry — the single source of truth for every Workdeck app.
 * Adding an app (Forms, Slides, ...) = one new entry here plus API support.
 */
const WD_APPS = [
    {
        id: 'docs',
        name: 'Docs',
        label: 'Doc',                       // badge text on file cards
        accent: 'doc',                      // suffix for CSS classes (-icon-doc, --doc-accent, ...)
        icon: DOC_ICON,
        route: '/docs/',
        editorParam: 'doc',
        create: {
            action: 'createDoc',
            payload: { title: 'Untitled' },
            // The API unshifts, so the newest doc is first.
            pickNewest: function (data) { return data.docs && data.docs[0]; }
        },
        contentSearch: true                 // search matches file content
    },
    {
        id: 'sheets',
        name: 'Sheets',
        label: 'Sheet',
        accent: 'sheet',
        icon: SHEET_ICON,
        route: '/sheets/editor.html',
        editorParam: 'id',
        create: {
            action: 'createSheet',
            payload: {},
            // The API pushes, so the newest sheet is last.
            pickNewest: function (data) {
                const list = data.sheets;
                return list && list[list.length - 1];
            }
        },
        contentSearch: false
    },
    {
        id: 'forms',
        name: 'Forms',
        label: 'Form',
        accent: 'form',
        icon: FORM_ICON,
        route: '/forms/editor.html',
        editorParam: 'id',
        create: {
            action: 'createForm',
            payload: {},
            // The API unshifts, so the newest form is first.
            pickNewest: function (data) { return data.forms && data.forms[0]; }
        },
        contentSearch: false
    },
    {
      id: 'slides',
        name: 'Slides',
        label: 'Slide',
        accent: 'slide',
        icon: SLIDE_ICON,
        route: '/slides/editor.html',
        editorParam: 'id',
        create: {
            action: 'createDeck',
            payload: {},
            // The API unshifts, so the newest slide is first.
            pickNewest: function (data) { return data.slides && data.slides[0]; }
        },
        contentSearch: false  
    }
];

/** Look up a registry entry by app id (falls back to the first app). */
function getApp(appId) {
    return WD_APPS.find(function (app) { return app.id === appId; }) || WD_APPS[0];
}

// ================================================
// State
// ================================================

const state = {
    userHash: null,
    docs: [],
    sheets: [],
    forms: [],
    slides: [],
    settings: {},
    searchQuery: '',
    filter: 'all',       // 'all' | app id from WD_APPS
    viewMode: 'grid',    // 'grid' | 'list'
    fileToRename: null,
    fileToDelete: null
};

// ================================================
// Helpers
// ================================================

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

/**
 * Relative timestamp like the child apps show ("Just now", "5m ago", ...).
 */
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

/**
 * Unified file list: docs and sheets tagged with their app,
 * sorted most-recently-used first (lastOpened wins over updatedAt so
 * re-opening an old file bumps it to the top, like Drive).
 */
function getAllFiles() {
    const lastOpened = (state.settings && state.settings.lastOpened) || {};

    const docs = state.docs
        .filter(function (d) { return !d.archived; })
        .map(function (d) {
            return {
                id: d.id,
                app: 'docs',
                name: d.title || 'Untitled',
                updatedAt: d.updatedAt,
                lastOpened: lastOpened[d.id] || null,
                content: d.content || ''
            };
        });

    const sheetFiles = state.sheets.map(function (s) {
        return {
            id: s.id,
            app: 'sheets',
            name: s.name || 'Untitled Spreadsheet',
            updatedAt: s.updatedAt,
            lastOpened: lastOpened[s.id] || null,
            content: ''
        };
    });

    const formFiles = state.forms.map(function (f) {
        return {
            id: f.id,
            app: 'forms',
            name: f.name || 'Untitled Form',
            updatedAt: f.updatedAt,
            lastOpened: lastOpened[f.id] || null,
            content: ''
        };
    });

    const slideFiles = state.slides.map(function (f) {
        return {
            id: f.id,
            app: 'slides',
            name: f.name || 'Untitled',
            updatedAt: f.updatedAt,
            lastOpened: lastOpened[f.id] || null,
            content: ''
        };
    });

    return docs.concat(sheetFiles).concat(formFiles).concat(slideFiles).sort(function (a, b) {
        const aTime = a.lastOpened || a.updatedAt || '';
        const bTime = b.lastOpened || b.updatedAt || '';
        return bTime.localeCompare(aTime);
    });
}

/**
 * Apply the active filter + search query.
 * Search matches titles always, and doc content for docs.
 */
function getVisibleFiles() {
    const q = state.searchQuery.toLowerCase().trim();
    return getAllFiles().filter(function (file) {
        if (state.filter !== 'all' && file.app !== state.filter) return false;
        if (!q) return true;
        if (file.name.toLowerCase().includes(q)) return true;
        return getApp(file.app).contentSearch && file.content.toLowerCase().includes(q);
    });
}

// ================================================
// API
// ================================================

async function api(action, payload) {
    const response = await fetch(WD_APP.apiEndpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: state.userHash, action: action, data: payload })
    });
    const result = await response.json();
    if (!result.success) {
        throw new Error(result.error || 'API request failed');
    }
    return result.data;
}

/**
 * Load the unified account document and refresh local state.
 * Returns false (and clears the session) when the account is gone.
 */
async function loadUserData() {
    const url = WD_APP.apiEndpoint + '?hash=' + encodeURIComponent(state.userHash) + '&_t=' + Date.now();
    let response;
    try {
        response = await fetch(url, { cache: 'no-store' });
    } catch (err) {
        // Server unreachable (offline / dev server not running): keep the
        // session — this is a connectivity problem, not a deleted account —
        // and land on the login view instead of crashing init.
        showNotification('Cannot reach the server. Check your connection and try again.', 'error');
        showLogin();
        return false;
    }
    if (!response.ok) {
        wdAuth.clearSession();
        showLogin();
        return false;
    }
    const result = await response.json();
    if (!result.success) {
        wdAuth.clearSession();
        showLogin();
        return false;
    }
    applyUserData(result.data);
    return true;
}

function applyUserData(data) {
    state.docs = data.docs || [];
    state.sheets = data.sheets || [];
    state.forms = data.forms || [];
    state.slides = data.slides || [];
    state.settings = data.settings || {};
    render();
}

// ================================================
// Dropdown placement (mobile sheets)
// ================================================
// On phones (≤480px) the dropdowns are position:fixed sheets pinned to the
// viewport (see workdeck.css), so they can never clip at the screen edge.
// JS supplies top/bottom: anchored just below (or above) the trigger, with
// the height capped to the space that's actually visible.

const MOBILE_MQ = window.matchMedia('(max-width: 480px)');

function placeDropdownSheet(dd) {
    const trigger = dd._wdTrigger;
    if (!dd.classList.contains('active') || !trigger || !MOBILE_MQ.matches) {
        dd.style.top = '';
        dd.style.bottom = '';
        dd.style.maxHeight = '';
        return;
    }
    const rect = trigger.getBoundingClientRect();
    const opensUp = dd.classList.contains('wd-dropdown-up');
    const minGap = 12;
    if (opensUp) {
        // Anchor the sheet's bottom just above the trigger, clamped so the
        // sheet stays fully on-screen even if the trigger is scrolled
        // partly out of view.
        const bottom = Math.min(Math.max(minGap, window.innerHeight - rect.top + 8), window.innerHeight - minGap - 140);
        dd.style.top = 'auto';
        dd.style.bottom = bottom + 'px';
        dd.style.maxHeight = Math.max(140, window.innerHeight - bottom - minGap) + 'px';
    } else {
        const top = Math.min(Math.max(minGap, rect.bottom + 8), window.innerHeight - minGap - 140);
        dd.style.top = top + 'px';
        dd.style.bottom = 'auto';
        dd.style.maxHeight = Math.max(140, window.innerHeight - top - minGap) + 'px';
    }
}

function openDropdown(dd, trigger) {
    dd._wdTrigger = trigger;
    dd.classList.add('active');
    placeDropdownSheet(dd);
}

function closeDropdown(dd) {
    dd.classList.remove('active');
    dd._wdTrigger = null;
    dd.style.top = '';
    dd.style.bottom = '';
    dd.style.maxHeight = '';
}

function toggleDropdown(dd, trigger) {
    if (dd.classList.contains('active')) {
        closeDropdown(dd);
        return false;
    }
    openDropdown(dd, trigger);
    return true;
}

window.addEventListener('resize', function () {
    ['newDropdown', 'emptyNewDropdown', 'filterDropdown', 'settingsDropdown'].forEach(function (id) {
        const dd = $(id);
        if (dd && dd.classList.contains('active')) placeDropdownSheet(dd);
    });
});

// Debounced settings save (theme / viewMode flips)
let settingsSaveTimer = null;
function saveSettings(patch) {
    Object.assign(state.settings, patch);
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(async function () {
        try {
            await api('updateSettings', { settings: patch });
        } catch (error) {
            console.error('[WORKDECK] Failed to save settings:', error);
        }
    }, 500);
}

// ================================================
// Views: login vs home
// ================================================

function showLogin() {
    $('loginView').classList.remove('hidden');
    $('homeView').classList.add('hidden');
}

function showHome() {
    $('loginView').classList.add('hidden');
    $('homeView').classList.remove('hidden');
}

// ================================================
// Rendering
// ================================================

function render() {
    renderFiles();
    renderViewToggle();
    renderFilterMenu();
}

function renderViewToggle() {
    document.querySelectorAll('.wd-view-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.view === state.viewMode);
    });
}

/**
 * Shared item markup for the app dropdowns ("+ New" menus and the filter
 * chooser): icon chip + app name.
 */
function buildAppMenuItem(app, extraAttrs) {
    return '<button class="wd-dropdown-item" data-app="' + app.id + '"' + (extraAttrs || '') + '>'
        + '<span class="wd-app-icon wd-app-icon-' + app.accent + '">' + app.icon + '</span>'
        + '<div class="wd-dropdown-item-text">'
        + '<span class="wd-dropdown-item-title">' + escapeHtml(app.name) + '</span>'
        + '</div>'
        + '</button>';
}

/**
 * Fill both "+ New" dropdowns (header + empty state) from WD_APPS.
 */
function renderNewMenus() {
    const items = WD_APPS.map(function (app) { return buildAppMenuItem(app); }).join('');
    $('newDropdown').innerHTML = items;
    $('emptyNewDropdown').innerHTML = items;
}

/**
 * Fill the filter chooser dropdown (one entry per app) and sync the
 * chooser button's label/icon/tint with the active filter.
 */
function renderFilterMenu() {
    const checkmark = '<svg class="wd-filter-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
        + '<polyline points="20 6 9 17 4 12"></polyline>'
        + '</svg>';

    $('filterDropdown').innerHTML = WD_APPS.map(function (app) {
        return buildAppMenuItem(app, state.filter === app.id ? ' data-selected="true"' : '');
    }).join('');

    document.querySelectorAll('#filterDropdown .wd-dropdown-item').forEach(function (item) {
        item.insertAdjacentHTML('beforeend', '<span class="wd-filter-check-slot">'
            + (item.dataset.selected ? checkmark : '') + '</span>');
    });

    // Chooser button face: app icon + name when filtered, generic otherwise.
    const btn = $('filterChooserBtn');
    const label = $('filterChooserLabel');
    const iconSlot = $('filterChooserIcon');
    const activeApp = state.filter === 'all' ? null : getApp(state.filter);

    document.querySelectorAll('.wd-filter[data-filter]').forEach(function (pill) {
        pill.classList.toggle('active', pill.dataset.filter === state.filter);
    });

    btn.classList.toggle('app-selected', Boolean(activeApp));
    if (activeApp) {
        btn.style.background = 'var(--' + activeApp.accent + '-accent-soft)';
        btn.style.color = 'var(--' + activeApp.accent + '-accent)';
    } else {
        btn.style.background = '';
        btn.style.color = '';
    }
    iconSlot.innerHTML = activeApp ? activeApp.icon : '';
    iconSlot.classList.toggle('hidden', !activeApp);
    label.textContent = activeApp ? activeApp.name : 'Apps';
}

const RENAME_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />'
    + '</svg>';

const DELETE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />'
    + '</svg>';

function renderFiles() {
    const files = getVisibleFiles();
    const gridView = $('filesGrid');
    const listView = $('filesList');
    const emptyState = $('emptyState');
    const viewTitle = $('viewTitle');
    const viewCount = $('viewCount');
    const searchHint = $('searchHint');

    gridView.innerHTML = '';
    listView.innerHTML = '';

    // Title + count
    const isSearching = Boolean(state.searchQuery.trim());
    const filterNames = { all: 'Recent files' };
    WD_APPS.forEach(function (app) { filterNames[app.id] = app.name; });
    viewTitle.textContent = isSearching ? 'Search results' : filterNames[state.filter];
    viewCount.textContent = files.length ? String(files.length) : '';
    searchHint.classList.toggle('hidden', !isSearching);

    if (files.length === 0) {
        gridView.classList.add('hidden');
        listView.classList.add('hidden');
        emptyState.classList.remove('hidden');

        const title = emptyState.querySelector('.wd-empty-title');
        const desc = emptyState.querySelector('.wd-empty-description');
        const actions = emptyState.querySelector('.wd-empty-actions');

        if (isSearching) {
            title.textContent = 'No matches found';
            desc.textContent = 'Try a different search term or filter';
            actions.classList.add('hidden');
        } else {
            actions.classList.remove('hidden');
            title.textContent = 'Nothing here yet';
            desc.textContent = 'Create your first file to get started';
        }
        return;
    }

    emptyState.classList.add('hidden');

    if (state.viewMode === 'list') {
        listView.classList.remove('hidden');
        files.forEach(function (file) { listView.appendChild(buildListRow(file)); });
    } else {
        gridView.classList.remove('hidden');
        files.forEach(function (file) { gridView.appendChild(buildCard(file)); });
    }
}

function buildCard(file) {
    const card = document.createElement('div');
    card.className = 'wd-file-card';
    card.dataset.id = file.id;
    card.dataset.app = file.app;

    const app = getApp(file.app);
    const when = file.lastOpened || file.updatedAt;

    card.innerHTML = '<div class="wd-file-card-top">'
        + '<div class="wd-file-icon wd-file-icon-' + app.accent + '">' + app.icon + '</div>'
        + '<div class="wd-file-actions">'
        + '<button class="wd-file-action-btn rename" title="Rename">' + RENAME_ICON + '</button>'
        + '<button class="wd-file-action-btn danger delete" title="Delete">' + DELETE_ICON + '</button>'
        + '</div>'
        + '</div>'
        + '<div class="wd-file-title">' + escapeHtml(file.name) + '</div>'
        + '<div class="wd-file-meta">'
        + '<span class="wd-file-app-badge ' + app.accent + '">' + app.label + '</span>'
        + '<span>' + formatRelativeDate(when) + '</span>'
        + '</div>';

    card.addEventListener('click', function (e) {
        if (!e.target.closest('.wd-file-action-btn')) openFile(file);
    });
    card.querySelector('.rename').addEventListener('click', function (e) {
        e.stopPropagation();
        showRenameModal(file);
    });
    card.querySelector('.delete').addEventListener('click', function (e) {
        e.stopPropagation();
        showDeleteModal(file);
    });

    return card;
}

function buildListRow(file) {
    const row = document.createElement('div');
    row.className = 'wd-file-row';
    row.dataset.id = file.id;
    row.dataset.app = file.app;

    const app = getApp(file.app);
    const when = file.lastOpened || file.updatedAt;

    row.innerHTML = '<div class="wd-file-icon wd-file-icon-' + app.accent + '">' + app.icon + '</div>'
        + '<div class="wd-file-row-main">'
        + '<div class="wd-file-row-title">' + escapeHtml(file.name) + '</div>'
        + '</div>'
        + '<span class="wd-file-app-badge ' + app.accent + '">' + app.label + '</span>'
        + '<div class="wd-file-row-meta">' + formatRelativeDate(when) + '</div>'
        + '<div class="wd-file-actions">'
        + '<button class="wd-file-action-btn rename" title="Rename">' + RENAME_ICON + '</button>'
        + '<button class="wd-file-action-btn danger delete" title="Delete">' + DELETE_ICON + '</button>'
        + '</div>';

    row.addEventListener('click', function (e) {
        if (!e.target.closest('.wd-file-action-btn')) openFile(file);
    });
    row.querySelector('.rename').addEventListener('click', function (e) {
        e.stopPropagation();
        showRenameModal(file);
    });
    row.querySelector('.delete').addEventListener('click', function (e) {
        e.stopPropagation();
        showDeleteModal(file);
    });

    return row;
}

// ================================================
// File operations
// ================================================

/**
 * Open an app URL in a new tab so Workdeck stays available — except on
 * phones and tablets, which navigate this tab instead: Safari doesn't
 * copy sessionStorage into a newly opened tab, so the editors' session
 * guards bounce every new-tab open straight back to '/'. Same-tab
 * navigation carries the session (and skips tab litter). The recents
 * "recordOpen" ping in openFile() may be dropped when the page unloads
 * mid-flight; ordering self-corrects on later opens.
 * Falls back to navigating this tab when the browser blocks the popup (this
 * can happen after an async wait), matching the old behavior.
 */
function openInNewTab(url) {
    // (pointer: coarse) and (hover: none) — touch-first devices (phones,
    // tablets) but NOT touch-screen laptops, which keep new-tab behavior.
    if (window.matchMedia('(pointer: coarse) and (hover: none)').matches) {
        window.location.href = url;
        return false;
    }
    const tab = window.open(url, '_blank');
    if (tab) {
        tab.opener = null;  // don"'t expose the Workdeck window to the app tab
        return true;
    }
    window.location.href = url;
    return false;
}

/**
 * Open a file in its app (new tab) and record lastOpened fire-and-forget —
 * the Workdeck tab stays open and refreshes on visibilitychange, so the
 * recents ordering picks it up then.
 */
function openFile(file) {
    const app = getApp(file.app);
    openInNewTab(app.route + '?' + app.editorParam + '=' + encodeURIComponent(file.id));
    api('recordOpen', { fileId: file.id, app: file.app })
        .catch(function (err) { console.error('[WORKDECK] recordOpen failed:', err); });
}

/**
 * Create a new file server-side, then open it in the app's editor (new tab).
 * Newly created files get &edit=1 so Docs skips the preview and opens the
 * editor directly — a fresh file is opened to be written in.
 */
async function createFile(appId) {
    const app = getApp(appId);
    showLoading('Creating ' + app.label.toLowerCase() + '...');
    try {
        const data = await api(app.create.action, app.create.payload);
        const file = app.create.pickNewest(data);
        if (!file) throw new Error('File creation failed');
        openInNewTab(app.route + '?' + app.editorParam + '=' + encodeURIComponent(file.id) + '&edit=1');
        hideLoading();
        loadUserData();  // show the new file in the list right away
    } catch (error) {
        console.error('[WORKDECK] Create failed:', error);
        hideLoading();
        showNotification(error.message || 'Failed to create file', 'error');
    }
}

// ================================================
// Modals
// ================================================

function showRenameModal(file) {
    state.fileToRename = file;
    $('renameInput').value = file.name;
    $('renameModal').classList.add('active');
    setTimeout(function () {
        $('renameInput').focus();
        $('renameInput').select();
    }, 100);
}

function hideRenameModal() {
    state.fileToRename = null;
    $('renameModal').classList.remove('active');
}

async function confirmRename() {
    if (!state.fileToRename) return;
    const name = $('renameInput').value.trim();
    if (!name) {
        showNotification('Name cannot be empty', 'error');
        return;
    }

    const file = state.fileToRename;
    const originalName = file.name;

    // Optimistic update
    file.name = name;
    render();
    hideRenameModal();

    try {
        await api('renameFile', { fileId: file.id, app: file.app, name: name });
        await loadUserData();
        showNotification('Renamed successfully', 'success');
    } catch (error) {
        file.name = originalName;
        render();
        showNotification(error.message || 'Failed to rename', 'error');
    }
}

function showDeleteModal(file) {
    state.fileToDelete = file;
    $('deleteFileName').textContent = file.name;
    $('deleteModal').classList.add('active');
}

function hideDeleteModal() {
    state.fileToDelete = null;
    $('deleteModal').classList.remove('active');
}

async function confirmDelete() {
    if (!state.fileToDelete) return;
    const file = state.fileToDelete;

    // Optimistic removal
    if (file.app === "sheets") {
        state.sheets = state.sheets.filter(function (s) { return s.id !== file.id; });
    } else if (file.app === "forms") {
        state.forms = state.forms.filter(function (f) { return f.id !== file.id; });
    } else if (file.app === 'slides'){
        state.slides = state.slides.filter(function (d) { return d.id !== file.id});
    } else {
        state.docs = state.docs.filter(function (n) { return n.id !== file.id; });
    }
    render();
    hideDeleteModal();

    try {
        await api('deleteFile', { fileId: file.id, app: file.app });
        showNotification('Deleted successfully', 'success');
    } catch (error) {
        showNotification(error.message || 'Failed to delete', 'error');
        await loadUserData();
    }
}

// ================================================
// Key / account modals
// ================================================

function showKeyModal() {
    $('keyText').textContent = wdAuth.getUserKey() || 'Not available';
    $('keyModal').classList.add('active');
    closeDropdown($('settingsDropdown'));
}

function hideKeyModal() {
    $('keyModal').classList.remove('active');
}

function showDeleteAccountModal() {
    $('deleteAccountModal').classList.add('active');
    closeDropdown($('settingsDropdown'));
}

function hideDeleteAccountModal() {
    $('deleteAccountModal').classList.remove('active');
}

async function confirmDeleteAccount() {
    try {
        const result = await wdAuth.deleteAccount();
        if (result.success) {
            hideDeleteAccountModal();
            showLogin();
            showNotification('Account deleted', 'success');
        } else {
            showNotification(result.error || 'Failed to delete account', 'error');
        }
    } catch (error) {
        showNotification('Failed to delete account', 'error');
    }
}

// ================================================
// Loading / notifications
// ================================================

function showLoading(text) {
    $('loadingText').textContent = text || 'Loading...';
    $('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
    $('loadingOverlay').classList.add('hidden');
}

function showNotification(message, type) {
    const el = $('notification');
    el.textContent = message;
    el.className = 'wd-notification ' + (type || 'info');
    // Force reflow so consecutive notifications re-trigger the transition
    void el.offsetWidth;
    el.classList.remove('hidden');
    setTimeout(function () {
        el.classList.add('hidden');
    }, 3000);
}

// ================================================
// Event listeners
// ================================================

function setupEventListeners() {
    // ----- Login form -----
    $('loginForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        const key = $('keyInput').value;
        const errorEl = $('loginError');
        const submitBtn = $('loginSubmit');

        errorEl.classList.add('hidden');

        if (!key.trim()) {
            errorEl.textContent = 'Key cannot be empty';
            errorEl.classList.remove('hidden');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.querySelector('.wd-btn-text').textContent = 'Entering...';
        submitBtn.querySelector('.wd-btn-spinner').classList.remove('hidden');

        const result = await wdAuth.authenticate(key);

        submitBtn.disabled = false;
        submitBtn.querySelector('.wd-btn-text').textContent = 'Sign in';
        submitBtn.querySelector('.wd-btn-spinner').classList.add('hidden');

        if (result.success) {
            state.userHash = wdAuth.getUserHash();
            applyUserData(result.data);
            showHome();
            wdThemeManager.applyFromServer(state.settings.theme);
            if (state.settings.viewMode) {
                state.viewMode = state.settings.viewMode;
                renderViewToggle();
            }
            $('keyInput').value = '';
            showNotification(result.isNewUser ? 'Account created — welcome!' : 'Welcome back!', 'success');
        } else {
            errorEl.textContent = result.error || 'Login failed';
            errorEl.classList.remove('hidden');
        }
    });

    // ----- Search -----
    const searchInput = $('searchInput');
    searchInput.addEventListener('input', function (e) {
        state.searchQuery = e.target.value;
        $('clearSearch').classList.toggle('hidden', !state.searchQuery);
        renderFiles();
    });

    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            searchInput.value = '';
            state.searchQuery = '';
            $('clearSearch').classList.add('hidden');
            renderFiles();
            searchInput.blur();
        }
    });

    $('clearSearch').addEventListener('click', function () {
        searchInput.value = '';
        state.searchQuery = '';
        $('clearSearch').classList.add('hidden');
        renderFiles();
    });

    // ----- + New dropdowns (header + empty state) -----
    $('newBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDropdown($('newDropdown'), $('newBtn'));
        $('newBtn').closest('.wd-new-container').classList.toggle('active');
    });

    $('emptyNewBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDropdown($('emptyNewDropdown'), $('emptyNewBtn'));
        $('emptyNewBtn').closest('.wd-new-container').classList.toggle('active');
    });

    // App items in both "+ New" menus (delegated — items come from WD_APPS).
    ['newDropdown', 'emptyNewDropdown'].forEach(function (menuId) {
        $(menuId).addEventListener('click', function (e) {
            const item = e.target.closest('.wd-dropdown-item[data-app]');
            if (!item) return;
            e.stopPropagation();
            createFile(item.dataset.app);
        });
    });

    // ----- Filter chooser -----
    document.querySelectorAll('.wd-filter[data-filter]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            state.filter = btn.dataset.filter;
            closeFilterDropdown();
            render();
        });
    });

    $('filterChooserBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        const open = toggleDropdown($('filterDropdown'), this);
        $('filterChooser').classList.toggle('active', open);
        this.setAttribute('aria-expanded', String(open));
    });

    $('filterDropdown').addEventListener('click', function (e) {
        const item = e.target.closest('.wd-dropdown-item[data-app]');
        if (!item) return;
        e.stopPropagation();
        state.filter = item.dataset.app;
        closeFilterDropdown();
        render();
    });

    function closeFilterDropdown() {
        closeDropdown($('filterDropdown'));
        $('filterChooser').classList.remove('active');
        $('filterChooserBtn').setAttribute('aria-expanded', 'false');
    }

    // ----- View toggle -----
    document.querySelectorAll('.wd-view-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            state.viewMode = btn.dataset.view;
            localStorage.setItem(WD_APP.viewKey, state.viewMode);
            saveSettings({ viewMode: state.viewMode });
            render();
        });
    });

    // ----- Settings dropdown -----
    $('settingsBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDropdown($('settingsDropdown'), $('settingsBtn'));
    });

    $('themeToggleBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        $('themeSubmenu').classList.toggle('active');
        const container = $('themeToggleBtn').closest('.wd-theme-container');
        if (container) container.classList.toggle('active');
    });

    document.querySelectorAll('.wd-theme-option').forEach(function (option) {
        option.addEventListener('click', function (e) {
            e.stopPropagation();
            wdThemeManager.setTheme(option.dataset.theme);
            updateThemeLabel();
            $('themeSubmenu').classList.remove('active');
            const container = $('themeToggleBtn').closest('.wd-theme-container');
            if (container) container.classList.remove('active');
        });
    });

    $('viewKeyBtn').addEventListener('click', showKeyModal);
    $('logoutBtn').addEventListener('click', function () {
        wdAuth.logout();
        state.userHash = null;
        showLogin();
        showNotification('Logged out', 'success');
    });
    $('deleteAccountBtn').addEventListener('click', showDeleteAccountModal);

    // ----- Rename modal -----
    $('renameModalClose').addEventListener('click', hideRenameModal);
    $('cancelRename').addEventListener('click', hideRenameModal);
    $('confirmRename').addEventListener('click', confirmRename);
    $('renameInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') confirmRename();
        if (e.key === 'Escape') hideRenameModal();
    });

    // ----- Delete file modal -----
    $('deleteModalClose').addEventListener('click', hideDeleteModal);
    $('cancelDelete').addEventListener('click', hideDeleteModal);
    $('confirmDelete').addEventListener('click', confirmDelete);

    // ----- Key modal -----
    $('keyModalClose').addEventListener('click', hideKeyModal);
    $('keyModalCloseBtn').addEventListener('click', hideKeyModal);
    $('keyCopyBtn').addEventListener('click', async function () {
        const key = wdAuth.getUserKey();
        if (!key) return;
        try {
            await navigator.clipboard.writeText(key);
            $('keyCopyFeedback').classList.add('visible');
            setTimeout(function () {
                $('keyCopyFeedback').classList.remove('visible');
            }, 2000);
        } catch (err) {
            console.error('Failed to copy key:', err);
        }
    });

    // ----- Delete account modal -----
    $('deleteAccountModalClose').addEventListener('click', hideDeleteAccountModal);
    $('cancelDeleteAccount').addEventListener('click', hideDeleteAccountModal);
    $('confirmDeleteAccount').addEventListener('click', confirmDeleteAccount);

    // ----- Login theme toggle -----
    $('loginThemeToggle').addEventListener('click', function () {
        wdThemeManager.toggleTheme();
    });

    // ----- Global click closes dropdowns & backdrops -----
    document.addEventListener('click', function (e) {
        // Header and empty-state "+ New" each close independently, so a click
        // inside one doesn't hold the other open.
        ['newBtn', 'emptyNewBtn'].forEach(function (btnId) {
            const btn = $(btnId);
            if (e.target.closest('.wd-new-container') === btn.closest('.wd-new-container')) return;
            closeDropdown($(btnId.replace('Btn', 'Dropdown')));
            const container = btn.closest('.wd-new-container');
            if (container) container.classList.remove('active');
        });
        if (!e.target.closest('#filterChooser')) {
            closeDropdown($('filterDropdown'));
            $('filterChooser').classList.remove('active');
            $('filterChooserBtn').setAttribute('aria-expanded', 'false');
        }
        if (!e.target.closest('.wd-settings-container')) {
            closeDropdown($('settingsDropdown'));
            $('themeSubmenu').classList.remove('active');
            const themeContainer = $('themeToggleBtn').closest('.wd-theme-container');
            if (themeContainer) themeContainer.classList.remove('active');
        }
        document.querySelectorAll('.wd-modal.active').forEach(function (modal) {
            if (e.target === modal) {
                modal.classList.remove('active');
                state.fileToRename = null;
                state.fileToDelete = null;
            }
        });
    });

    // ----- Refresh when tab becomes visible again -----
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && state.userHash) {
            loadUserData();
        }
    });
}

function updateThemeLabel() {
    const label = $('themeText');
    const saved = wdThemeManager.getPreference();
    const current = wdThemeManager.getCurrentTheme();
    const display = saved === 'system'
        ? 'System'
        : current.charAt(0).toUpperCase() + current.slice(1);

    if (window.innerWidth <= 640) {
        label.textContent = 'Theme';
    } else {
        label.textContent = 'Theme: ' + display;
    }
}

// ================================================
// Init
// ================================================

async function init() {
    wdThemeManager.init();
    renderNewMenus();
    setupEventListeners();
    updateThemeLabel();

    const session = wdAuth.getSession();
    if (!session) {
        showLogin();
        return;
    }

    state.userHash = session.hash;
    state.viewMode = localStorage.getItem(WD_APP.viewKey) || 'grid';

    const ok = await loadUserData();
    if (!ok) return;

    showHome();
    wdThemeManager.applyFromServer(state.settings.theme);
    if (state.settings.viewMode && state.settings.viewMode !== state.viewMode) {
        state.viewMode = state.settings.viewMode;
    }
    render();
}

// ================================================
// Boot
// ================================================

document.addEventListener('DOMContentLoaded', init);

if (typeof window !== 'undefined') {
    window.workdeckApp = {
        get state() { return state; },
        saveSettings: saveSettings,
        loadUserData: loadUserData,
        themes: wdThemeManager
    };
}
