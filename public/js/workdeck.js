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

const WD_SIDEBAR = {
    // Desktop pin/unpin is remembered; the mobile drawer never auto-opens.
    storageKey: 'workdeck_sidebar_open',
    desktopQuery: window.matchMedia('(min-width: 1024px)')
};

const PROJECT_COLORS = ['#FACC15', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4', '#F97316'];

function wdIcon(name) {
    const tpl = document.getElementById('wd-icon-' + name);
    return tpl
        ? tpl.content.firstElementChild.cloneNode(true)
        : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

function wdDot(color) {
    const dot = document.createElement('span');
    dot.className = 'wd-dot';
    dot.style.background = color;
    return dot;
}

/** #rrggbb -> darkened/lightened copy, for two-tone folder art. */
function shadeColor(hex, percent) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!match) return hex || '#FACC15';
    const n = parseInt(match[1], 16);
    const shift = c => Math.max(0, Math.min(255, Math.round(c + (percent / 100) * 255)));
    const r = shift(n >> 16), g = shift((n >> 8) & 255), b = shift(n & 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function folderArt(color) {
    const dark = shadeColor(color, -18);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 48 40');
    svg.setAttribute('aria-hidden', 'true');
    [['M2 8a4 4 0 0 1 4-4h11a4 4 0 0 1 3.2 1.6L23 10h19a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z', dark],
     ['M2 14h44v20a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V14z', color]].forEach(function (part) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', part[0]);
        path.setAttribute('fill', part[1]);
        svg.appendChild(path);
    });
    return svg;
}

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
        icon: 'docs',
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
        icon: 'sheets',
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
        icon: 'forms',
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
        icon: 'slides',
        route: '/slides/editor.html',
        editorParam: 'id',
        create: {
            action: 'createDeck',
            payload: {},
            // The API unshifts, so the newest slide is first.
            pickNewest: function (data) { return data.slides && data.slides[0]; }
        },
        contentSearch: false
    },
    {
        id: 'draw',
        name: 'Draw',
        label: 'Drawing',
        accent: 'draw',
        icon: 'draw',
        route: '/draw/editor.html',
        editorParam: 'id',
        create: {
            action: 'createDrawing',
            payload: {},
            // The API unshifts, so the newest drawing is first.
            pickNewest: function (data) { return data.draws && data.draws[0]; }
        },
        contentSearch: false
    },
    {
        id: 'filebox',
        name: 'Files',
        label: 'File',
        accent: 'filebox',
        icon: 'filebox',
        route: '/filebox/',
        editorParam: 'id',
        create: null,
        chooserOpensApp: true,
        contentSearch: false
    }
];

/** Look up a registry entry by app id (falls back to the first app). */
function getApp(appId) {
    return WD_APPS.find(function (app) { return app.id === appId; }) || WD_APPS[0];
}

/** Look up a tag by id. */
function getTag(tagId) {
    return state.tags.find(function (t) { return t.id === tagId; }) || null;
}

/**
 * Tag match across both models: the single tagId on docs/sheets/forms/
 * slides/draws, or the tags[] array on Filebox files and folders.
 */
function fileMatchesTag(file, tagId) {
    if (!tagId) return false;
    if (file.tagId === tagId) return true;
    return Array.isArray(file.tags) && file.tags.includes(tagId);
}

/** Filebox items carry tags[] instead of a single tagId. */
function isMultiTagItem(file) {
    return Array.isArray(file.tags);
}

/** #rrggbb -> rgba(), so active rows can tint with the project color. */
function hexToRgba(hex, alpha) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!match) return '';
    const n = parseInt(match[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}

// ================================================
// State
// ================================================

const state = {
    userHash: null,
    docs: [],
    tags: [],
    sheets: [],
    forms: [],
    slides: [],
    draws: [],
    files: [],           // Filebox file metadata
    folders: [],         // Filebox folders
    settings: {},
    searchQuery: '',
    filter: 'all',       // 'all' | app id from WD_APPS
    activeTag: null,     // tag id, null = All files
    sidebarOpen: false,
    viewMode: 'grid',    // 'grid' | 'list'
    fileToRename: null,
    fileToDelete: null,
    fileToMove: null,
    moveTarget: null,
    moveChecked: null,   // Set of tag ids while the multi-tag modal is open
    projectToDelete: null
};

// ================================================
// Helpers
// ================================================

function $(id) {
    return document.getElementById(id);
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
 * Unified file list: everything tagged with its app, sorted
 * most-recently-used first. Filebox contributes two kinds
 * of entries: file cards (raw.metadata in raw) and — top level only —
 * folder cards ({kind:'folder'}), interleaved in the same recency sort.
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
                tagId: getTag(d.tagId) ? d.tagId : null,
                content: d.content || '',
                raw: d
            };
        });

    const sheetFiles = state.sheets.map(function (s) {
        return {
            id: s.id,
            app: 'sheets',
            name: s.name || 'Untitled Spreadsheet',
            updatedAt: s.updatedAt,
            lastOpened: lastOpened[s.id] || null,
            tagId: getTag(s.tagId) ? s.tagId : null,
            content: '',
            raw: s
        };
    });

    const formFiles = state.forms.map(function (f) {
        return {
            id: f.id,
            app: 'forms',
            name: f.name || 'Untitled Form',
            updatedAt: f.updatedAt,
            lastOpened: lastOpened[f.id] || null,
            tagId: getTag(f.tagId) ? f.tagId : null,
            content: '',
            raw: f
        };
    });

    const slideFiles = state.slides.map(function (f) {
        return {
            id: f.id,
            app: 'slides',
            name: f.name || 'Untitled',
            updatedAt: f.updatedAt,
            lastOpened: lastOpened[f.id] || null,
            tagId: getTag(f.tagId) ? f.tagId : null,
            content: '',
            raw: f
        };
    });

    const drawFiles = state.draws.map(function (f) {
        return {
            id: f.id,
            app: 'draw',
            name: f.name || 'Untitled Drawing',
            updatedAt: f.updatedAt,
            lastOpened: lastOpened[f.id] || null,
            tagId: getTag(f.tagId) ? f.tagId : null,
            content: '',
            raw: f
        };
    });

    const fileboxFiles = (state.files || []).map(function (f) {
        return {
            id: f.id,
            app: 'filebox',
            kind: 'file',
            name: f.name || 'Untitled',
            updatedAt: f.updatedAt,
            lastOpened: lastOpened[f.id] || null,
            tagId: null,
            tags: Array.isArray(f.tags) ? f.tags.slice() : [],
            folderId: f.folderId || null,
            thumbnail: f.thumbnail || null,
            content: '',
            raw: f
        };
    });

    // Only root-level folders appear here — nested depth is navigated
    // inside Filebox itself.
    const folderCards = (state.folders || [])
        .filter(function (f) { return !f.parentId; })
        .map(function (f) {
            const childCount = (state.folders || []).filter(function (c) { return c && c.parentId === f.id; }).length
                + (state.files || []).filter(function (c) { return c && c.folderId === f.id; }).length;
            return {
                id: f.id,
                app: 'filebox',
                kind: 'folder',
                name: f.name || 'Untitled',
                updatedAt: f.updatedAt,
                lastOpened: lastOpened[f.id] || null,
                tagId: null,
                tags: Array.isArray(f.tags) ? f.tags.slice() : [],
                childCount: childCount,
                content: '',
                raw: f
            };
        });

    return docs.concat(sheetFiles).concat(formFiles).concat(slideFiles).concat(drawFiles)
        .concat(fileboxFiles).concat(folderCards)
        .sort(function (a, b) {
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
        if (state.activeTag && !fileMatchesTag(file, state.activeTag)) return false;
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
    state.tags = data.tags || [];
    state.sheets = data.sheets || [];
    state.forms = data.forms || [];
    state.slides = data.slides || [];
    state.draws = data.draws || [];
    state.files = data.files || [];
    state.folders = data.folders || [];
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
// Sidebar (projects)
// ================================================

function applySidebar() {
    document.body.classList.toggle('wd-sidebar-open', state.sidebarOpen);
    const toggle = $('sidebarToggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(state.sidebarOpen));
}

function initSidebar() {
    // Desktop: pinned unless the user collapsed it. Mobile: always start
    // with the drawer closed, whatever the desktop preference says.
    state.sidebarOpen = WD_SIDEBAR.desktopQuery.matches &&
        localStorage.getItem(WD_SIDEBAR.storageKey) !== '0';
    applySidebar();
}

function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    // Only desktop pin/unpin is remembered; drawer open/close is per-session.
    if (WD_SIDEBAR.desktopQuery.matches) {
        localStorage.setItem(WD_SIDEBAR.storageKey, state.sidebarOpen ? '1' : '0');
    }
    applySidebar();
}

function closeSidebarDrawer() {
    if (!WD_SIDEBAR.desktopQuery.matches && state.sidebarOpen) {
        state.sidebarOpen = false;
        applySidebar();
    }
}

// ================================================
// Rendering
// ================================================

function render() {
    renderSidebar();
    renderFiles();
    renderViewToggle();
    renderFilterMenu();
}

// ================================================
// Sidebar rendering
// ================================================

function renderSidebar() {
    $('allFilesBtn').classList.toggle('active', state.activeTag === null);

    const counts = {};
    getAllFiles().forEach(function (file) {
        if (file.tagId) counts[file.tagId] = (counts[file.tagId] || 0) + 1;
        (file.tags || []).forEach(function (id) {
            counts[id] = (counts[id] || 0) + 1;
        });
    });

    const list = $('projectList');
    list.innerHTML = '';
    state.tags.forEach(function (tag) {
        const active = state.activeTag === tag.id;
        const row = $('wdSideTagRowTemplate').content.firstElementChild.cloneNode(true);
        if (active) {
            row.classList.add('active');
            if (tag.color) row.style.background = hexToRgba(tag.color, 0.14);
        }
        row.dataset.tag = tag.id;
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.querySelector('.wd-dot').style.background = tag.color;
        row.querySelector('.wd-side-row-name').textContent = tag.name;
        row.querySelector('.wd-side-count').textContent = counts[tag.id] || 0;

        row.addEventListener('click', function (e) {
            if (e.target.closest('.wd-side-action')) return;
            selectTag(tag.id);
        });
        row.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.wd-side-action')) {
                e.preventDefault();
                selectTag(tag.id);
            }
        });
        row.querySelector('.edit').addEventListener('click', function (e) {
            e.stopPropagation();
            openProjectForm(tag);
        });
        row.querySelector('.danger').addEventListener('click', function (e) {
            e.stopPropagation();
            showDeleteProjectModal(tag);
        });
        makeDropTarget(row, tag.id);
        list.appendChild(row);
    });

    $('projectEmpty').classList.toggle('hidden', state.tags.length > 0);
}

function selectTag(tagId) {
    state.activeTag = tagId;
    render();
    closeSidebarDrawer();
}

// ================================================
// Status footer
// ================================================

function renderFooter() {
    const statsEl = $('wdFooterStats');
    if (!statsEl) return;

    const files = getAllFiles();
    const total = files.length;

    if (state.searchQuery.trim()) {
        const visible = getVisibleFiles().length;
        statsEl.textContent = visible + ' of ' + total + ' file' + (total === 1 ? '' : 's');
    } else if (state.activeTag) {
        const count = files.filter(function (file) { return fileMatchesTag(file, state.activeTag); }).length;
        statsEl.textContent = count + ' file' + (count === 1 ? '' : 's');
    } else if (state.filter !== 'all') {
        const count = files.filter(function (file) { return file.app === getApp(state.filter).id; }).length;
        statsEl.textContent = count + ' file' + (count === 1 ? '' : 's');
    } else {
        statsEl.textContent = total + ' file' + (total === 1 ? '' : 's') + ' · ' + WD_APPS.length + ' apps · '
            + state.tags.length + (state.tags.length === 1 ? ' tag' : ' tags');
    }
}

function renderViewToggle() {
    document.querySelectorAll('.wd-view-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.view === state.viewMode);
    });
}

/**
 * Shared item for the app dropdowns ("+ New" menus and the filter chooser):
 * icon chip + app name.
 */
function buildAppMenuItem(app, selected) {
    const btn = $('wdDropdownItemTemplate').content.firstElementChild.cloneNode(true);
    btn.dataset.app = app.id;
    if (selected) btn.dataset.selected = 'true';
    const chip = btn.querySelector('.wd-app-icon');
    chip.classList.add('wd-app-icon-' + app.accent);
    chip.append(wdIcon(app.icon));
    btn.querySelector('.wd-dropdown-item-title').textContent = app.name;
    return btn;
}


function renderNewMenus() {
    const items = WD_APPS.map(function (app) { return buildAppMenuItem(app); });
    $('newDropdown').replaceChildren(...items);
    $('emptyNewDropdown').replaceChildren(...items.map(function (item) { return item.cloneNode(true); }));
}

/**
 * Fill the filter chooser dropdown (one entry per app) and sync the
 * chooser button's label/icon/tint with the active filter.
 */
function renderFilterMenu() {
    $('filterDropdown').replaceChildren(...WD_APPS.map(function (app) {
        return buildAppMenuItem(app, state.filter === app.id);
    }));

    document.querySelectorAll('#filterDropdown .wd-dropdown-item').forEach(function (item) {
        const slot = document.createElement('span');
        slot.className = 'wd-filter-check-slot';
        if (item.dataset.selected) slot.append(wdIcon('filter-check'));
        item.append(slot);
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
    iconSlot.replaceChildren(...(activeApp ? [wdIcon(activeApp.icon)] : []));
    iconSlot.classList.toggle('hidden', !activeApp);
    label.textContent = activeApp ? activeApp.name : 'Apps';
}

function projectChip(tag, extraClass) {
    const chip = document.createElement('span');
    chip.className = 'wd-file-project' + (extraClass ? ' ' + extraClass : '');
    chip.title = tag.name;
    const name = document.createElement('span');
    name.className = 'wd-file-project-name';
    name.textContent = tag.name;
    chip.append(wdDot(tag.color), name);
    return chip;
}

/**
 * Tag chips on cards and list rows. Filebox items are multi-tag: up to
 * 3 chips + an overflow count. Other apps keep the single chip.
 */
function projectChipFragment(file, extraClass) {
    const frag = document.createDocumentFragment();
    if (isMultiTagItem(file)) {
        const tags = (file.tags || []).map(getTag).filter(Boolean);
        if (!tags.length) return frag;
        const shown = tags.slice(0, 3);
        shown.forEach(function (tag) { frag.append(projectChip(tag, extraClass)); });
        const overflow = tags.length - shown.length;
        if (overflow > 0) {
            const more = document.createElement('span');
            more.className = 'wd-file-project' + (extraClass ? ' ' + extraClass : '') + ' wd-file-project-more';
            more.title = tags.slice(3).map(function (t) { return t.name; }).join(', ');
            more.textContent = '+' + overflow;
            frag.append(more);
        }
        return frag;
    }

    const tag = file.tagId ? getTag(file.tagId) : null;
    if (!tag) return frag;
    frag.append(projectChip(tag, extraClass));
    return frag;
}

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
    const activeTag = state.activeTag ? getTag(state.activeTag) : null;
    const filterNames = { all: 'Recent files' };
    WD_APPS.forEach(function (app) { filterNames[app.id] = app.name; });
    if (activeTag) {
        viewTitle.replaceChildren(wdDot(activeTag.color), document.createTextNode(activeTag.name));
    } else {
        viewTitle.textContent = isSearching ? 'Search results' : filterNames[state.filter];
    }
    viewCount.textContent = files.length ? String(files.length) : '';
    searchHint.classList.toggle('hidden', !isSearching);

    renderFooter();

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
            desc.textContent = activeTag
                ? 'No files with this tag yet. Tag something to see it here.'
                : 'Create your first file to get started';
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
    if (file.kind === 'folder') return buildFolderCard(file);

    const card = $('wdFileCardTemplate').content.firstElementChild.cloneNode(true);
    card.dataset.id = file.id;
    card.dataset.app = file.app;

    const app = getApp(file.app);
    const when = file.lastOpened || file.updatedAt;

    const icon = card.querySelector('.wd-file-icon');
    icon.classList.add('wd-file-icon-' + app.accent);
    icon.append(wdIcon(app.icon));
    card.querySelector('.wd-file-title').textContent = file.name;

    const badge = card.querySelector('.wd-file-app-badge');
    badge.classList.add(app.accent);
    badge.textContent = app.label;
    const date = card.querySelector('.wd-file-date');
    date.textContent = formatRelativeDate(when);
    date.before(projectChipFragment(file));

    const previewPage = card.querySelector('.wd-file-preview-page');
    if (previewPage && window.WDPreviews) WDPreviews.mount(previewPage, file);

    card.addEventListener('click', function (e) {
        if (!e.target.closest('.wd-file-action-btn')) openFile(file);
    });
    card.querySelector('.move').addEventListener('click', function (e) {
        e.stopPropagation();
        showMoveModal(file);
    });
    card.querySelector('.copylink').addEventListener('click', function (e) {
        e.stopPropagation();
        copyFileLink(file);
    });
    card.querySelector('.rename').addEventListener('click', function (e) {
        e.stopPropagation();
        showRenameModal(file);
    });
    card.querySelector('.delete').addEventListener('click', function (e) {
        e.stopPropagation();
        showDeleteModal(file);
    });
    makeDraggable(card, file);

    return card;
}

/** Drive-style folder tile card (homepage shows root-level folders only). */
function buildFolderCard(folder) {
    const card = $('wdFolderCardTemplate').content.firstElementChild.cloneNode(true);
    card.dataset.id = folder.id;
    card.dataset.app = 'filebox';

    const when = folder.lastOpened || folder.updatedAt;
    const color = (folder.raw && folder.raw.color) || '#FACC15';

    card.querySelector('.wd-file-title').textContent = folder.name;
    card.querySelector('.wd-folder-tile-glyph').append(folderArt(color));
    card.querySelector('.wd-folder-tile-count').textContent =
        folder.childCount + (folder.childCount === 1 ? ' item' : ' items');
    const date = card.querySelector('.wd-file-date');
    date.textContent = formatRelativeDate(when);
    date.before(projectChipFragment(folder));

    card.addEventListener('click', function (e) {
        if (!e.target.closest('.wd-file-action-btn')) openFile(folder);
    });
    card.querySelector('.move').addEventListener('click', function (e) {
        e.stopPropagation();
        showMoveModal(folder);
    });
    card.querySelector('.copylink').addEventListener('click', function (e) {
        e.stopPropagation();
        copyFileLink(folder);
    });
    card.querySelector('.rename').addEventListener('click', function (e) {
        e.stopPropagation();
        showRenameModal(folder);
    });
    card.querySelector('.delete').addEventListener('click', function (e) {
        e.stopPropagation();
        showDeleteModal(folder);
    });
    makeDraggable(card, folder);

    return card;
}

function buildListRow(file) {
    if (file.kind === 'folder') return buildFolderRow(file);

    const row = $('wdFileRowTemplate').content.firstElementChild.cloneNode(true);
    row.dataset.id = file.id;
    row.dataset.app = file.app;

    const app = getApp(file.app);
    const when = file.lastOpened || file.updatedAt;

    const icon = row.querySelector('.wd-file-icon');
    icon.classList.add('wd-file-icon-' + app.accent);
    icon.append(wdIcon(app.icon));
    row.querySelector('.wd-file-row-title').textContent = file.name;
    row.querySelector('.wd-file-row-main').append(projectChipFragment(file, 'wd-file-row-project'));
    const badge = row.querySelector('.wd-file-app-badge');
    badge.classList.add(app.accent);
    badge.textContent = app.label;
    row.querySelector('.wd-file-row-meta').textContent = formatRelativeDate(when);

    row.addEventListener('click', function (e) {
        if (!e.target.closest('.wd-file-action-btn')) openFile(file);
    });
    row.querySelector('.move').addEventListener('click', function (e) {
        e.stopPropagation();
        showMoveModal(file);
    });
    row.querySelector('.copylink').addEventListener('click', function (e) {
        e.stopPropagation();
        copyFileLink(file);
    });
    row.querySelector('.rename').addEventListener('click', function (e) {
        e.stopPropagation();
        showRenameModal(file);
    });
    row.querySelector('.delete').addEventListener('click', function (e) {
        e.stopPropagation();
        showDeleteModal(file);
    });
    makeDraggable(row, file);

    return row;
}

/** List-mode folder row (same actions as the folder card). */
function buildFolderRow(folder) {
    const row = $('wdFolderRowTemplate').content.firstElementChild.cloneNode(true);
    row.dataset.id = folder.id;
    row.dataset.app = 'filebox';

    const when = folder.lastOpened || folder.updatedAt;
    const color = (folder.raw && folder.raw.color) || '#FACC15';

    row.querySelector('.wd-file-row-title').textContent = folder.name;
    row.querySelector('.wd-file-row-main').append(projectChipFragment(folder, 'wd-file-row-project'));
    const count = row.querySelector('.wd-folder-row-count');
    count.style.color = color;
    count.textContent = folder.childCount + (folder.childCount === 1 ? ' item' : ' items');
    row.querySelector('.wd-file-row-meta').textContent = formatRelativeDate(when);

    row.addEventListener('click', function (e) {
        if (!e.target.closest('.wd-file-action-btn')) openFile(folder);
    });
    row.querySelector('.move').addEventListener('click', function (e) {
        e.stopPropagation();
        showMoveModal(folder);
    });
    row.querySelector('.copylink').addEventListener('click', function (e) {
        e.stopPropagation();
        copyFileLink(folder);
    });
    row.querySelector('.rename').addEventListener('click', function (e) {
        e.stopPropagation();
        showRenameModal(folder);
    });
    row.querySelector('.delete').addEventListener('click', function (e) {
        e.stopPropagation();
        showDeleteModal(folder);
    });
    makeDraggable(row, folder);

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
 * recents ordering picks it up then. Filebox folder cards share the
 * /filebox/<id> hard link with files; the Files app opens them inside
 * the folder.
 */
function openFile(file) {
    // Canonical hard link (/sheets/<id>, /filebox/<id>, ...).
    const url = WDLinks.url(file.app, file.id);
    openInNewTab(url);
    api('recordOpen', { fileId: file.id, app: file.app })
        .catch(function (err) { console.error('[WORKDECK] recordOpen failed:', err); });
}

/** Copy a file's canonical hard link (absolute URL) to the clipboard. */
function copyFileLink(file) {
    const path = WDLinks.url(file.app, file.id);
    const absolute = window.location.origin + path;
    const done = ok => showNotification(ok ? 'Link copied' : 'Could not copy link', ok ? 'success' : 'error');
    const fallbackCopy = function () {
        const ta = document.createElement('textarea');
        ta.value = absolute;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        document.body.removeChild(ta);
        done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(absolute).then(function () { done(true); }, fallbackCopy);
    } else {
        fallbackCopy();
    }
}

/**
 * Create a new file server-side, then open it in the app's editor (new tab).
 * Newly created files get &edit=1 so Docs skips the preview and opens the
 * editor directly — a fresh file is opened to be written in.
 */
async function createFile(appId) {
    const app = getApp(appId);
    if (!app.create) {
        const tagQs = state.activeTag ? '&tag=' + encodeURIComponent(state.activeTag) : '';
        openInNewTab(app.route + '?upload=1' + tagQs);
        return;
    }
    showLoading('Creating ' + app.label.toLowerCase() + '...');
    try {
        // Inside a project, new files are created straight into it.
        const payload = Object.assign({}, app.create.payload);
        if (state.activeTag) payload.tagId = state.activeTag;
        const data = await api(app.create.action, payload);
        const file = app.create.pickNewest(data);
        if (!file) throw new Error('File creation failed');
        openInNewTab(WDLinks.url(file.app, file.id, { edit: true }));
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
        if (file.kind === 'folder') {
            await api('updateFolder', { folderId: file.id, updates: { name: name } });
        } else {
            await api('renameFile', { fileId: file.id, app: file.app, name: name });
        }
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
    const el = $('deleteModalText');
    const strong = document.createElement('span');
    strong.className = 'wd-strong';
    strong.textContent = file.name;
    if (file.kind === 'folder') {
        // Destructive cascade: everything inside goes with it.
        const count = folderDeleteCount(file.id);
        el.replaceChildren('Delete "', strong,
            '" and its ' + count + (count === 1 ? ' item' : ' items') + '? This cannot be undone.');
    } else {
        el.replaceChildren('Are you sure you want to delete "', strong, '"? This cannot be undone.');
        // Warn when other files reference this one (@mentions will break).
        if (window.WDMentions) {
            const backlinks = WDMentions.findBacklinks(file.id, state);
            if (backlinks.length) {
                const note = document.createElement('div');
                note.className = 'wd-delete-backlinks';
                note.textContent = backlinks.length
                    + (backlinks.length === 1 ? ' file links' : ' files link')
                    + ' to this — its mentions will show as unavailable.';
                el.append(note);
            }
        }
    }
    $('deleteModal').classList.add('active');
}

/** Items (subfolders + files) that die with a folder, matching the server's
 *  cascade in api/workdeck.js deleteFolder. */
function folderDeleteCount(rootId) {
    const doomed = collectFolderIds(rootId);
    return state.folders.filter(function (f) { return f && doomed.has(f.id) && f.id !== rootId; }).length
        + state.files.filter(function (f) { return f && doomed.has(f.folderId); }).length;
}

function collectFolderIds(rootId) {
    const doomed = new Set([rootId]);
    let grew = true;
    while (grew) {
        grew = false;
        state.folders.forEach(function (f) {
            if (f && f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
                doomed.add(f.id);
                grew = true;
            }
        });
    }
    return doomed;
}

function hideDeleteModal() {
    state.fileToDelete = null;
    $('deleteModal').classList.remove('active');
}

async function confirmDelete() {
    if (!state.fileToDelete) return;
    const file = state.fileToDelete;

    if (file.kind === 'folder') {
        const doomed = collectFolderIds(file.id);
        state.folders = state.folders.filter(function (f) { return f && !doomed.has(f.id); });
        state.files = state.files.filter(function (f) { return f && !doomed.has(f.folderId); });
        render();
        hideDeleteModal();
        try {
            await api('deleteFolder', { folderId: file.id });
            showNotification('Folder deleted', 'success');
        } catch (error) {
            showNotification(error.message || 'Failed to delete folder', 'error');
            await loadUserData();
        }
        return;
    }

    // Optimistic removal
    if (file.app === "sheets") {
        state.sheets = state.sheets.filter(function (s) { return s.id !== file.id; });
    } else if (file.app === "forms") {
        state.forms = state.forms.filter(function (f) { return f.id !== file.id; });
    } else if (file.app === 'slides'){
        state.slides = state.slides.filter(function (d) { return d.id !== file.id});
    } else if (file.app === 'draw') {
        state.draws = state.draws.filter(function (d) { return d.id !== file.id });
    } else if (file.app === 'filebox') {
        state.files = state.files.filter(function (f) { return f.id !== file.id; });
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
// Projects (tags)
// ================================================

let projectFormTagId = null;   // null = create mode, else editing this tag
let projectFormColor = PROJECT_COLORS[0];

function renderProjectColors() {
    const picker = $('projectColorPicker');
    picker.innerHTML = '';
    PROJECT_COLORS.forEach(function (color) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'wd-color-swatch' + (color === projectFormColor ? ' selected' : '');
        swatch.style.background = color;
        swatch.setAttribute('aria-label', 'Pick color ' + color);
        swatch.addEventListener('click', function () {
            projectFormColor = color;
            renderProjectColors();
        });
        picker.appendChild(swatch);
    });
}

function openProjectForm(tag) {
    projectFormTagId = tag ? tag.id : null;
    projectFormColor = tag && tag.color ? tag.color : PROJECT_COLORS[0];
    $('projectNameInput').value = tag ? tag.name : '';
    $('projectFormSubmit').textContent = tag ? 'Save' : 'Create';
    renderProjectColors();
    $('projectForm').classList.remove('hidden');
    $('projectForm').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(function () { $('projectNameInput').focus(); }, 60);
}

function closeProjectForm() {
    projectFormTagId = null;
    $('projectForm').classList.add('hidden');
    $('projectNameInput').value = '';
}

async function submitProjectForm(e) {
    e.preventDefault();
    const name = $('projectNameInput').value.trim();
    if (!name) {
        $('projectNameInput').focus();
        return;
    }

    const editing = projectFormTagId ? getTag(projectFormTagId) : null;

    if (editing) {
        // Optimistic rename/recolor
        const before = { name: editing.name, color: editing.color };
        editing.name = name;
        editing.color = projectFormColor;
        render();
        closeProjectForm();
        try {
            await api('updateTag', { tagId: editing.id, updates: { name: name, color: projectFormColor } });
            showNotification('Tag updated', 'success');
        } catch (error) {
            editing.name = before.name;
            editing.color = before.color;
            render();
            showNotification(error.message || 'Failed to update tag', 'error');
        }
    } else {
        try {
            await api('createTag', { name: name, color: projectFormColor });
            closeProjectForm();
            await loadUserData();
            showNotification('Tag created', 'success');
        } catch (error) {
            showNotification(error.message || 'Failed to create tag', 'error');
        }
    }
}

function showDeleteProjectModal(tag) {
    state.projectToDelete = tag;
    // Mixed semantics, stated explicitly: docs/sheets/forms/slides/draws
    // carrying the tag are deleted; Filebox items only lose the tag.
    const files = getAllFiles();
    const fileboxCount = files.filter(function (file) {
        return isMultiTagItem(file) && file.tags.includes(tag.id);
    }).length;
    $('deleteProjectName').textContent = tag.name;
    $('deleteProjectFileboxNote').classList.toggle('hidden', fileboxCount === 0);
    $('deleteProjectFileboxCount').textContent = fileboxCount + (fileboxCount === 1 ? ' item' : ' items');
    $('deleteProjectModal').classList.add('active');
}

function hideDeleteProjectModal() {
    state.projectToDelete = null;
    $('deleteProjectModal').classList.remove('active');
}

async function confirmDeleteProject() {
    const tag = state.projectToDelete;
    if (!tag) return;
    hideDeleteProjectModal();

    if (state.activeTag === tag.id) state.activeTag = null;

    // Optimistic removal: single-tag files die, Filebox items lose the tag
    const dropTagged = function (list) {
        return list.filter(function (f) { return f.tagId !== tag.id; });
    };
    const stripTag = function (list) {
        return list.map(function (f) {
            if (!Array.isArray(f.tags) || !f.tags.includes(tag.id)) return f;
            return Object.assign({}, f, { tags: f.tags.filter(function (id) { return id !== tag.id; }) });
        });
    };
    state.tags = state.tags.filter(function (t) { return t.id !== tag.id; });
    state.docs = dropTagged(state.docs);
    state.sheets = dropTagged(state.sheets);
    state.forms = dropTagged(state.forms);
    state.slides = dropTagged(state.slides);
    state.draws = dropTagged(state.draws);
    state.files = stripTag(state.files);
    state.folders = stripTag(state.folders);
    render();

    try {
        await api('deleteTag', { tagId: tag.id });
        showNotification('Tag deleted', 'success');
    } catch (error) {
        showNotification(error.message || 'Failed to delete tag', 'error');
        await loadUserData();
    }
}

// ================================================
// Move-to-project modal
// ================================================

function showMoveModal(file) {
    state.fileToMove = file;
    $('moveFileName').textContent = file.name;
    if (isMultiTagItem(file)) {
        // Filebox files/folders: checkbox list over the tag pool.
        state.moveChecked = new Set(file.tags || []);
        state.moveTarget = null;
        $('moveSelect').classList.add('wd-move-multi');
        renderMoveChecks();
    } else {
        state.moveChecked = null;
        state.moveTarget = file.tagId || null;
        $('moveSelect').classList.remove('wd-move-multi');
        renderMoveOptions();
    }
    closeMoveDropdown();
    $('moveModal').classList.add('active');
}

function hideMoveModal() {
    state.fileToMove = null;
    state.moveTarget = null;
    closeMoveDropdown();
    $('moveModal').classList.remove('active');
}

function closeMoveDropdown() {
    $('moveDropdown').classList.remove('active');
    $('moveSelect').classList.remove('active');
    $('moveSelectBtn').setAttribute('aria-expanded', 'false');
}

function setMoveTriggerValue(option) {
    const el = $('moveSelectValue');
    if (option && option.color) {
        const name = document.createElement('span');
        name.className = 'wd-move-select-name';
        name.textContent = option.name;
        el.replaceChildren(wdDot(option.color), name);
    } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'wd-move-select-placeholder';
        placeholder.textContent = option ? option.name : 'Choose tags';
        el.replaceChildren(placeholder);
    }
}

function moveEmptyDiv() {
    const el = document.createElement('div');
    el.className = 'wd-move-empty';
    el.textContent = 'No tags yet — create one in the sidebar.';
    return el;
}

function moveOptionRow(selected) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'wd-move-option' + (selected ? ' selected' : '');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));
    return row;
}

function renderMoveOptions() {
    const dd = $('moveDropdown');

    if (state.tags.length === 0) {
        dd.replaceChildren(moveEmptyDiv());
        setMoveTriggerValue(null);
        return;
    }

    const options = [{ id: null, name: 'No tags', color: null }].concat(state.tags);
    options.forEach(function (option) {
        const selected = (state.moveTarget || null) === option.id;
        const row = moveOptionRow(selected);
        const dot = wdDot(option.color);
        if (!option.color) dot.classList.add('wd-dot-none');
        const name = document.createElement('span');
        name.className = 'wd-move-option-name';
        name.textContent = option.name;
        row.append(dot, name, wdIcon('check'));
        row.addEventListener('click', function () {
            state.moveTarget = option.id;
            renderMoveOptions();
            closeMoveDropdown();
        });
        dd.appendChild(row);
    });

    setMoveTriggerValue(options.find(function (option) { return (state.moveTarget || null) === option.id; }));
}

/** Multi-tag checkbox list (Filebox items). The single-select trigger stays
 *  hidden; the menu renders inline. */
function renderMoveChecks() {
    const dd = $('moveDropdown');
    const checked = state.moveChecked || new Set();

    if (state.tags.length === 0) {
        dd.replaceChildren(moveEmptyDiv());
        return;
    }

    state.tags.forEach(function (tag) {
        const selected = checked.has(tag.id);
        const row = moveOptionRow(selected);
        const name = document.createElement('span');
        name.className = 'wd-move-option-name';
        name.textContent = tag.name;
        row.append(wdDot(tag.color), name, wdIcon('check'));
        row.addEventListener('click', function () {
            if (checked.has(tag.id)) {
                checked.delete(tag.id);
            } else {
                checked.add(tag.id);
            }
            renderMoveChecks();
        });
        dd.appendChild(row);
    });

    if (checked.size === 0) {
        const none = document.createElement('div');
        none.className = 'wd-move-empty';
        none.textContent = 'No tags selected';
        dd.appendChild(none);
    }
}

async function confirmMove() {
    const file = state.fileToMove;
    if (!file) return;
    if (isMultiTagItem(file)) {
        const tagIds = Array.from(state.moveChecked || []);
        hideMoveModal();
        applyFileTags(file, tagIds);
        return;
    }
    const target = state.moveTarget || null;
    hideMoveModal();
    applyFileMove(file, target);
}

// Optimistic tag write for multi-tag items, shared by the modal confirm and
// drag-and-drop (full-array replace = one call adds AND removes).
async function applyFileTags(file, tagIds) {
    const original = Array.isArray(file.tags) ? file.tags.slice() : [];
    const unchanged = original.length === tagIds.length && original.every(function (id) {
        return tagIds.includes(id);
    });
    if (unchanged) return;

    file.tags = tagIds.slice();
    render();
    try {
        if (file.kind === 'folder') {
            await api('setFolderTags', { folderId: file.id, tagIds: tagIds });
        } else {
            await api('setFileTags', { fileId: file.id, tagIds: tagIds });
        }
        showNotification('Tags updated', 'success');
        loadUserData();
    } catch (error) {
        file.tags = original;
        render();
        showNotification(error.message || 'Failed to update tags', 'error');
    }
}

// Optimistic move shared by the modal confirm and sidebar drag-and-drop.
async function applyFileMove(file, target) {
    if (isMultiTagItem(file)) {
        // Dropping on a tag row union-adds; dropping on "All files" clears.
        const current = Array.isArray(file.tags) ? file.tags : [];
        const next = target && !current.includes(target) ? current.concat([target]) : current;
        applyFileTags(file, next);
        return;
    }

    const original = file.tagId || null;
    if (target === original) return;

    file.tagId = target;
    render();
    try {
        await api('setFileTag', { fileId: file.id, app: file.app, tagId: target });
        showNotification(target ? 'Tag added' : 'Tag removed', 'success');
        loadUserData();
    } catch (error) {
        file.tagId = original;
        render();
        showNotification(error.message || 'Failed to move file', 'error');
    }
}

// ================================================
// Drag a file onto a sidebar project to move it
// (HTML5 drag & drop — touch devices keep using the move modal)
// ================================================

let dragFile = null;

function makeDraggable(el, file) {
    el.draggable = true;
    el.addEventListener('dragstart', function (e) {
        dragFile = file;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', file.app + ':' + file.id);
        el.classList.add('dragging');
    });
    el.addEventListener('dragend', function () {
        dragFile = null;
        el.classList.remove('dragging');
        clearDropHints();
    });
}

function clearDropHints() {
    document.querySelectorAll('.wd-side-row.drop-target').forEach(function (row) {
        row.classList.remove('drop-target');
    });
}

function makeDropTarget(row, tagId) {
    row.addEventListener('dragover', function (e) {
        if (!dragFile) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', function (e) {
        if (!row.contains(e.relatedTarget)) row.classList.remove('drop-target');
    });
    row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('drop-target');
        if (dragFile) applyFileMove(dragFile, tagId);
    });
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
    const searchWrapper = searchInput.closest('.wd-search-wrapper');
    const searchGhost = $('searchGhost');
    const searchGhostTyped = $('searchGhostTyped');
    const searchGhostRest = $('searchGhostRest');
    let searchSuggestion = null;

    // Greyed-out inline completion from the most recent title matching the prefix.
    function updateSearchSuggestion() {
        const value = searchInput.value;
        searchSuggestion = null;
        if (value.trim()) {
            const q = value.toLowerCase();
            const match = getAllFiles().find(function (file) {
                return (state.filter === 'all' || file.app === state.filter) &&
                    (!state.activeTag || fileMatchesTag(file, state.activeTag)) &&
                    file.name.toLowerCase().startsWith(q) &&
                    file.name.length > value.length;
            });
            if (match) searchSuggestion = match.name;
        }
        if (searchSuggestion) {
            searchGhostTyped.textContent = value;
            searchGhostRest.textContent = searchSuggestion.slice(value.length);
            searchWrapper.classList.add('suggesting');
        } else {
            searchWrapper.classList.remove('suggesting');
        }
    }

    function hideSearchSuggestion() {
        searchSuggestion = null;
        searchWrapper.classList.remove('suggesting');
    }

    searchInput.addEventListener('input', function (e) {
        state.searchQuery = e.target.value;
        $('clearSearch').classList.toggle('hidden', !state.searchQuery);
        updateSearchSuggestion();
        renderFiles();
    });

    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            searchInput.value = '';
            state.searchQuery = '';
            $('clearSearch').classList.add('hidden');
            renderFiles();
            hideSearchSuggestion();
            searchInput.blur();
        } else if (e.key === 'Tab' && searchSuggestion && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            searchInput.value = searchSuggestion;
            state.searchQuery = searchSuggestion;
            $('clearSearch').classList.remove('hidden');
            renderFiles();
            updateSearchSuggestion();
        }
    });

    searchInput.addEventListener('scroll', function () {
        searchGhost.scrollLeft = searchInput.scrollLeft;
    });
    searchInput.addEventListener('focus', updateSearchSuggestion);
    searchInput.addEventListener('blur', hideSearchSuggestion);

    $('clearSearch').addEventListener('click', function () {
        searchInput.value = '';
        state.searchQuery = '';
        $('clearSearch').classList.add('hidden');
        renderFiles();
        hideSearchSuggestion();
    });

    // ----- + New dropdowns (header + empty state) -----
    $('newBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDropdown($('newDropdown'), $('newBtn'));
        $('newBtn').closest('.wd-new-container').classList.toggle('active');
    });

    // Empty-state "+ New": inside a filtered app section the app is implied,
    // so create in it directly; with "All files" active, open the picker.
    $('emptyNewBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        if (state.filter !== 'all') {
            createFile(state.filter);
            return;
        }
        toggleDropdown($('emptyNewDropdown'), $('emptyNewBtn'));
        $('emptyNewBtn').closest('.wd-new-container').classList.toggle('active');
    });

    // App items in both "+ New" menus 
    ['newDropdown', 'emptyNewDropdown'].forEach(function (menuId) {
        $(menuId).addEventListener('click', function (e) {
            const item = e.target.closest('.wd-dropdown-item[data-app]');
            if (!item) return;
            e.stopPropagation();
            closeDropdown($(menuId));
            const container = $(menuId).closest('.wd-new-container');
            if (container) container.classList.remove('active');
            createFile(item.dataset.app);
        });
    });

    // ----- Projects sidebar -----
    $('sidebarToggle').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleSidebar();
    });

    $('sidebarClose').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleSidebar();
    });

    $('sidebarScrim').addEventListener('click', closeSidebarDrawer);

    function selectAllFiles() {
        selectTag(null);
    }
    $('allFilesBtn').addEventListener('click', selectAllFiles);
    $('allFilesBtn').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectAllFiles();
        }
    });
    // Dropping a file here removes it from its project.
    makeDropTarget($('allFilesBtn'), null);

    $('newProjectBtn').addEventListener('click', function () {
        if ($('projectForm').classList.contains('hidden')) {
            openProjectForm(null);
        } else {
            closeProjectForm();
        }
    });
    $('projectForm').addEventListener('submit', submitProjectForm);
    $('projectFormCancel').addEventListener('click', closeProjectForm);
    $('projectNameInput').addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeProjectForm();
    });

    // Escape closes the mobile drawer (modals have their own handling)
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeSidebarDrawer();
    });

    // ----- Move-to-project modal -----
    $('moveModalClose').addEventListener('click', hideMoveModal);
    $('cancelMove').addEventListener('click', hideMoveModal);
    $('confirmMove').addEventListener('click', confirmMove);
    $('moveSelectBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        const open = $('moveDropdown').classList.toggle('active');
        $('moveSelect').classList.toggle('active', open);
        this.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !$('moveModal').classList.contains('active')) return;
        if ($('moveDropdown').classList.contains('active')) {
            closeMoveDropdown();
            return;
        }
        hideMoveModal();
    });

    // ----- Delete project modal -----
    $('deleteProjectModalClose').addEventListener('click', hideDeleteProjectModal);
    $('cancelDeleteProject').addEventListener('click', hideDeleteProjectModal);
    $('confirmDeleteProject').addEventListener('click', confirmDeleteProject);

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
        const app = getApp(item.dataset.app);
        if (app.chooserOpensApp) {
            closeFilterDropdown();
            openInNewTab(app.route);
            return;
        }
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
        if (!e.target.closest('#moveSelect')) {
            closeMoveDropdown();
        }
        document.querySelectorAll('.wd-modal.active').forEach(function (modal) {
            if (e.target === modal) {
                modal.classList.remove('active');
                state.fileToRename = null;
                state.fileToDelete = null;
                state.fileToMove = null;
                state.projectToDelete = null;
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

    label.textContent = 'Theme: ' + display;

    // Checkmark on the row matching the saved preference
    document.querySelectorAll('.wd-theme-option').forEach(function (option) {
        option.classList.toggle('active', option.dataset.theme === saved);
    });
}

// ================================================
// Init
// ================================================

async function init() {
    wdThemeManager.init();
    renderNewMenus();
    setupEventListeners();
    updateThemeLabel();
    initSidebar();

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
