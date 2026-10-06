/**
 * ================================================
 * FILEBOX - Application
 * ================================================
 *
 * Drive-style manager for the user's files, organized in nested folders:
 *   header     — brand (/), search, Upload, New folder, sort, view toggle,
 *                settings (theme + View My Key + Logout)
 *   sidebar    — "All folders" root + unlimited-depth folder tree with
 *                expand/collapse, per-row actions, drag-a-file-to-move
 *   dashboard  — breadcrumb + folder/file cards (grid) or rows (list)
 *
 * Two subsystems live in their own modules, each backed by libraries:
 *   uploads.js — Uppy Dashboard picker/queue/progress; a custom plugin
 *                POSTs base64 JSON to /api/filebox, strictly sequentially
 *                (parallel uploads would read-modify-write the shared
 *                user doc), with client-side thumbnails for images/PDFs.
 *   viewer.js  — per-type previews (PhotoSwipe, pdf.js, docx-preview,
 *                SheetJS, Papa Parse, marked, highlight.js, Video.js).
 *
 * URL states: ?folder=<id> (inside a folder), ?id=<fileId> (viewer),
 * ?upload=1 (opens the picker on load).
 */

// ================================================
// Icons (inline SVG, feather-style)
// ================================================

const FB_ICONS = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    upload: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16m8-8H4"></path></svg>',
    caret: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
    dots: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg>',
    rename: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>',
    download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    move: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>',
    tags: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>',
    check: '<svg class="fb-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    open: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
    link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    key: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>',
    logout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>',
    sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>'
};

function folderArt(color) {
    const dark = shadeColor(color, -18);
    return '<svg viewBox="0 0 48 40" aria-hidden="true">'
        + '<path d="M2 8a4 4 0 0 1 4-4h11a4 4 0 0 1 3.2 1.6L23 10h19a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" fill="' + dark + '"/>'
        + '<path d="M2 14h44v20a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V14z" fill="' + color + '"/>'
        + '</svg>';
}

function shadeColor(hex, percent) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!match) return hex || '#FACC15';
    const n = parseInt(match[1], 16);
    const shift = c => Math.max(0, Math.min(255, Math.round(c + (percent / 100) * 255)));
    const r = shift(n >> 16), g = shift((n >> 8) & 255), b = shift(n & 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/** Tile tint per extension group (suite palette). */
const EXT_COLORS = {
        pdf: '#EF4444', doc: '#4285F4', docx: '#4285F4', txt: '#64748B', md: '#64748B',
    xls: '#22c55e', xlsx: '#22c55e', csv: '#22c55e',
    ppt: '#ea580c', pptx: '#ea580c', key: '#ea580c',
    png: '#8B5CF6', jpg: '#8B5CF6', jpeg: '#8B5CF6', gif: '#8B5CF6', webp: '#8B5CF6', svg: '#8B5CF6', heic: '#8B5CF6',
    zip: '#FACC15', rar: '#FACC15', '7z': '#FACC15', tar: '#FACC15', gz: '#FACC15',
    mp3: '#EC4899', wav: '#EC4899', m4a: '#EC4899', aac: '#EC4899',
    mp4: '#e11d48', mov: '#e11d48', avi: '#e11d48', mkv: '#e11d48',
    js: '#06B6D4', ts: '#06B6D4', json: '#06B6D4', html: '#06B6D4', css: '#06B6D4', py: '#06B6D4'
};

function extColor(name) {
    const match = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
    return EXT_COLORS[match ? match[1].toLowerCase() : ''] || '#64748B';
}

function fileExt(name) {
    const match = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
    return match ? match[1].toUpperCase() : 'FILE';
}

// ================================================
// State
// ================================================

const FB_VIEW_KEY = 'filebox_view_mode';
const FB_SORT_KEY = 'filebox_sort_by';

const state = {
    userHash: null,
    userKey: null,
    files: [],
    folders: [],
    tags: [],
    rawDoc: null,                   
    settings: {},
    currentFolderId: null,          // null = root ("All folders")
    activeTag: null,               
    view: localStorage.getItem(FB_VIEW_KEY) || 'grid',
    sort: localStorage.getItem(FB_SORT_KEY) || 'recent',
    searchQuery: '',
    expanded: new Set(),            // expanded folder ids in the sidebar tree
    dragFileId: null,
    dragDepth: 0,

    // Modal scratch
    folderFormId: null,             // null = create, folderId = rename
    folderFormParent: null,
    folderFormColor: APP_CONFIG.folderColors[0],
    tagFormId: null,                // null = create, tagId = edit
    tagFormColor: APP_CONFIG.folderColors[0],
    moveFileId: null,
    moveTarget: null,
    tagsTarget: null,               // {kind: 'file'|'folder', id}
    tagSelection: new Set(),
    deleteTarget: null,             // {kind, id}
    renameTarget: null              // {kind, id}
};

// ================================================
// Small helpers
// ================================================

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

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

function getTag(tagId) {
    return state.tags.find(function (t) { return t.id === tagId; }) || null;
}


function fileboxTags() {
    return state.tags.filter(function (t) { return t.origin === 'filebox'; });
}

/** Filebox items (files + folders, any depth) carrying a tag. */
function tagItemCount(tagId) {
    return state.files.filter(function (f) { return (f.tags || []).includes(tagId); }).length
        + state.folders.filter(function (f) { return (f.tags || []).includes(tagId); }).length;
}

/** #rrggbb -> rgba(), so active tag rows tint with the tag color. */
function hexToRgba(hex, alpha) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!match) return '';
    const n = parseInt(match[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}

function getFolder(id) {
    return state.folders.find(function (f) { return f.id === id; }) || null;
}

function getFile(id) {
    return state.files.find(function (f) { return f.id === id; }) || null;
}

function childFolders(parentId) {
    return state.folders.filter(function (f) { return (f.parentId || null) === (parentId || null); });
}

function childFiles(parentId) {
    return state.files.filter(function (f) { return (f.folderId || null) === (parentId || null); });
}

/** Chain from the root down to id (inclusive); [] when id is unknown. */
function ancestorsOf(id) {
    const chain = [];
    let cur = getFolder(id);
    let guard = 0;
    while (cur && guard++ < 100) {
        chain.unshift(cur);
        cur = cur.parentId ? getFolder(cur.parentId) : null;
    }
    return chain;
}

/** All folder ids in the subtree rooted at rootId (inclusive). */
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

function folderItemCount(rootId) {
    const doomed = collectFolderIds(rootId);
    return state.folders.filter(function (f) { return f && doomed.has(f.id) && f.id !== rootId; }).length
        + state.files.filter(function (f) { return f && doomed.has(f.folderId); }).length;
}

function recency(record) {
    const lastOpened = (state.settings && state.settings.lastOpened) || {};
    return lastOpened[record.id] || record.updatedAt || record.createdAt || '';
}

function sortBy(list, keyFn) {
    if (state.sort === 'name') {
        return list.slice().sort(function (a, b) {
            return String(a.name).localeCompare(String(b.name));
        });
    }
    if (state.sort === 'size') {
        return list.slice().sort(function (a, b) { return keyFn(b) - keyFn(a); });
    }
    return list.slice().sort(function (a, b) {
        return recency(b).localeCompare(recency(a));
    });
}

function tagChipsHtml(record) {
    const tags = (record.tags || []).map(getTag).filter(Boolean);
    if (!tags.length) return '';
    const shown = tags.slice(0, 3);
    const overflow = tags.length - shown.length;
    return '<span class="fb-chips">'
        + shown.map(function (tag) {
            return '<span class="fb-chip" title="' + escapeHtml(tag.name) + '">'
                + '<span class="fb-dot" style="background:' + escapeHtml(tag.color) + '"></span>'
                + escapeHtml(tag.name) + '</span>';
        }).join('')
        + (overflow > 0 ? '<span class="fb-chip fb-chip-more" title="'
            + tags.slice(3).map(function (t) { return escapeHtml(t.name); }).join(', ')
            + '">+' + overflow + '</span>' : '')
        + '</span>';
}

// ================================================
// Notifications
// ================================================

let notificationTimer = null;
function showNotification(message, type) {
    const el = $('fbNotification');
    el.textContent = message;
    el.className = 'fb-notification ' + (type || 'info');
    void el.offsetWidth;
    el.classList.remove('hidden');
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(function () {
        el.classList.add('hidden');
    }, 3000);
}

// ================================================
// Data load
// ================================================

function applyUserData(data) {
    state.files = data.files || [];
    state.folders = data.folders || [];
    state.tags = data.tags || [];
    state.settings = data.settings || {};
    state.rawDoc = data;    // docs/sheets/... counts for the delete-tag warning
    render();
}

async function loadUserData() {
    const data = await fileboxStorage.loadUserData();
    if (!data) {
        showNotification('Cannot reach the server. Retrying on next poll.', 'error');
        return false;
    }
    applyUserData(data);
    return true;
}

// ================================================
// URL states
// ================================================

function syncUrl() {
    const params = new URLSearchParams();
    if (state.currentFolderId) params.set('folder', state.currentFolderId);
    const qs = params.toString();
    history.replaceState(null, '', '/filebox/' + (qs ? '?' + qs : ''));
}

/** Apply the hard link (/filebox/<id>), ?folder= / ?tag= / ?id= /
 *  ?upload=1 after data has loaded. */
function applyUrlState() {
    const params = new URLSearchParams(window.location.search);

    const folderId = params.get('folder');
    if (folderId && getFolder(folderId)) {
        state.currentFolderId = folderId;
        ancestorsOf(folderId).forEach(function (f) { state.expanded.add(f.id); });
    }

    // Deep link from a Workdeck tag view: open in that tag's scope so the
    // picker's uploads land pre-tagged (uploads read state.activeTag).
    const tagId = params.get('tag');
    if (tagId && getTag(tagId)) {
        state.activeTag = tagId;
        state.currentFolderId = null;
    }

    // Hard link /filebox/<id> first (the browser URL carries no query —
    // the server rewrite targets the file invisibly), legacy ?id= second.
    // ?folder= ids are handled above, not here.
    const loc = window.WDLinks ? WDLinks.parseLocation() : null;
    const fileId = (loc && loc.kind !== 'folder' && loc.id) || params.get('id');
    if (fileId) {
        const file = getFile(fileId);
        if (file) {
            openViewer(file);
        } else {
            showNotification('That file no longer exists', 'error');
        }
    }

    if (params.get('upload') === '1') {
        // Pickers must open from a user gesture; a deferred open after load
        // still works in practice on Chrome/Safari.
        setTimeout(function () {
            if (window.fileboxUploads) fileboxUploads.openPicker();
        }, 300);
    }
    syncUrl();
}

// ================================================
// Navigation
// ================================================

/** Mobile drawer open/close (desktop ignores this — the sidebar is pinned). */
function applySidebarDrawer(open) {
    document.body.classList.toggle('fb-sidebar-open', open);
    const toggle = $('fbSidebarToggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
}

function openFolder(folderId) {
    state.currentFolderId = folderId || null;
    state.activeTag = null;         // navigating to a folder leaves the tag view
    state.searchQuery = '';
    $('fbSearchInput').value = '';
    $('fbClearSearch').classList.add('hidden');
    applySidebarDrawer(false);
    if (folderId) {
        ancestorsOf(folderId).forEach(function (f) { state.expanded.add(f.id); });
        fileboxStorage.recordOpen(folderId).catch(function () {});
    }
    syncUrl();
    closeItemMenu();
    render();
}

/**
 * Sidebar tag filter: shows every file/folder carrying the tag across all
 * folders (like search does), regardless of where the user was.
 */
function selectTag(tagId) {
    state.activeTag = tagId;
    state.currentFolderId = null;
    state.searchQuery = '';
    $('fbSearchInput').value = '';
    $('fbClearSearch').classList.add('hidden');
    applySidebarDrawer(false);
    syncUrl();
    closeItemMenu();
    render();
}

// ================================================
// Rendering
// ================================================

function render() {
    renderSidebar();
    renderBreadcrumb();
    renderContent();
    renderFooter();
}

function renderSidebar() {
    $('fbAllFolders').classList.toggle('active', state.currentFolderId === null && !state.activeTag);
    const tree = $('fbTree');
    tree.innerHTML = '';
    buildTreeLevel(tree, null, 0);
    renderTagSection();
}

/**
 * Sidebar tags — the same system as Workdeck's (dot + name + count, click
 * to filter, drag a file on to tag it, edit/delete on hover), but only
 * Filebox-born tags list here.
 */
function renderTagSection() {
    const list = $('fbTagList');
    list.innerHTML = '';
    const pool = fileboxTags();

    pool.forEach(function (tag) {
        const active = state.activeTag === tag.id;
        const row = document.createElement('div');
        row.className = 'fb-side-row fb-tag-row' + (active ? ' active' : '');
        row.dataset.tag = tag.id;
        row.tabIndex = 0;
        if (active && tag.color) row.style.background = hexToRgba(tag.color, 0.14);

        row.innerHTML = '<span class="fb-tag-dot" style="background:' + escapeHtml(tag.color) + '"></span>'
            + '<span class="fb-side-name">' + escapeHtml(tag.name) + '</span>'
            + '<span class="fb-side-count">' + tagItemCount(tag.id) + '</span>'
            + '<span class="fb-side-actions">'
            + '<button data-action="edit" title="Edit tag">' + FB_ICONS.rename + '</button>'
            + '<button data-action="delete" class="danger" title="Delete tag">' + FB_ICONS.trash + '</button>'
            + '</span>';

        row.addEventListener('click', function (e) {
            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                e.stopPropagation();
                if (actionEl.dataset.action === 'edit') openTagForm(tag);
                else confirmDeleteTag(tag);
                return;
            }
            selectTag(tag.id);
        });
        row.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-action]')) {
                e.preventDefault();
                selectTag(tag.id);
            }
        });
        makeTagDropTarget(row, tag.id);

        list.appendChild(row);
    });

    $('fbTagEmpty').classList.toggle('hidden', pool.length > 0);
}

function buildTreeLevel(container, parentId, depth) {
    sortBy(childFolders(parentId), function (f) { return f.childCount || 0; }).forEach(function (folder) {
        const kids = childFolders(folder.id);
        const expanded = state.expanded.has(folder.id);
        const active = state.currentFolderId === folder.id;

        const row = document.createElement('div');
        row.className = 'fb-side-row' + (active ? ' active' : '');
        row.dataset.folder = folder.id;
        row.style.paddingLeft = (10 + depth * 16) + 'px';

        row.innerHTML = '<span class="fb-caret' + (expanded ? ' open' : '') + (kids.length ? '' : ' invisible') + '" data-action="toggle">' + FB_ICONS.caret + '</span>'
            + '<span class="fb-side-dot" style="color:' + escapeHtml(folder.color || '#FACC15') + '">' + FB_ICONS.folder + '</span>'
            + '<span class="fb-side-name">' + escapeHtml(folder.name) + '</span>'
            + '<span class="fb-side-actions">'
            + '<button data-action="add" title="New subfolder">' + FB_ICONS.plus + '</button>'
            + '<button data-action="rename" title="Rename">' + FB_ICONS.rename + '</button>'
            + '<button data-action="delete" class="danger" title="Delete">' + FB_ICONS.trash + '</button>'
            + '</span>';

        row.addEventListener('click', function (e) {
            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                e.stopPropagation();
                const action = actionEl.dataset.action;
                if (action === 'toggle') {
                    if (state.expanded.has(folder.id)) state.expanded.delete(folder.id);
                    else state.expanded.add(folder.id);
                    renderSidebar();
                } else if (action === 'add') {
                    openFolderForm(null, folder.id);
                } else if (action === 'rename') {
                    openFolderForm(folder);
                } else if (action === 'delete') {
                    confirmDeleteFolder(folder);
                }
                return;
            }
            openFolder(folder.id);
        });
        row.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-action]')) {
                e.preventDefault();
                openFolder(folder.id);
            }
        });
        makeSidebarDropTarget(row, folder.id);
        row.tabIndex = 0;

        container.appendChild(row);

        if (expanded && kids.length) {
            buildTreeLevel(container, folder.id, depth + 1);
        }
    });
}

function renderBreadcrumb() {
    const el = $('fbBreadcrumb');
    if (state.activeTag) {
        const tag = getTag(state.activeTag);
        el.innerHTML = '<button class="fb-crumb" data-id="">All folders</button>'
            + '<span class="fb-crumb-sep">›</span>'
            + '<span class="fb-crumb-current"><span class="fb-dot" style="background:' + escapeHtml(tag ? tag.color : '#94a3b8') + '"></span> '
            + escapeHtml(tag ? tag.name : 'Tag') + '</span>';
        el.querySelector('.fb-crumb').addEventListener('click', function () {
            openFolder(null);
        });
        return;
    }
    if (state.searchQuery.trim()) {
        el.innerHTML = '<span class="fb-crumb-current">Search results</span>';
        return;
    }
    const chain = state.currentFolderId ? ancestorsOf(state.currentFolderId) : [];
    const parts = ['<button class="fb-crumb' + (chain.length ? '' : ' current') + '" data-id="">All folders</button>'];
    chain.forEach(function (folder, i) {
        parts.push('<span class="fb-crumb-sep">›</span>');
        parts.push('<button class="fb-crumb' + (i === chain.length - 1 ? ' current' : '') + '" data-id="' + folder.id + '">'
            + escapeHtml(folder.name) + '</button>');
    });
    el.innerHTML = parts.join('');
    el.querySelectorAll('.fb-crumb').forEach(function (btn) {
        btn.addEventListener('click', function () {
            openFolder(btn.dataset.id || null);
        });
    });
}

function visibleFolders() {
    // Tag view spans every folder (like search); plain view is per-folder.
    let folders;
    if (state.searchQuery.trim()) folders = searchFolders();
    else if (state.activeTag) folders = state.folders;
    else folders = childFolders(state.currentFolderId);
    if (state.activeTag) {
        folders = folders.filter(function (f) { return (f.tags || []).includes(state.activeTag); });
    }
    return sortBy(folders, function (f) { return f.childCount || 0; });
}

function visibleFiles() {
    let files;
    if (state.searchQuery.trim()) files = searchFiles();
    else if (state.activeTag) files = state.files;
    else files = childFiles(state.currentFolderId);
    if (state.activeTag) {
        files = files.filter(function (f) { return (f.tags || []).includes(state.activeTag); });
    }
    return sortBy(files, function (f) { return f.size || 0; });
}

function searchFolders() {
    const q = state.searchQuery.toLowerCase().trim();
    return state.folders.filter(function (folder) {
        if (folder.name.toLowerCase().includes(q)) return true;
        return (folder.tags || []).some(function (id) {
            const tag = getTag(id);
            return tag && tag.name.toLowerCase().includes(q);
        });
    });
}

function searchFiles() {
    const q = state.searchQuery.toLowerCase().trim();
    return state.files.filter(function (file) {
        if (file.name.toLowerCase().includes(q)) return true;
        return (file.tags || []).some(function (id) {
            const tag = getTag(id);
            return tag && tag.name.toLowerCase().includes(q);
        });
    });
}

function renderContent() {
    const folders = visibleFolders();
    const files = visibleFiles();
    const grid = $('fbGrid');
    const list = $('fbList');
    const empty = $('fbEmpty');
    grid.innerHTML = '';
    list.innerHTML = '';

    document.querySelectorAll('.fb-view-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.view === state.view);
    });

    const total = folders.length + files.length;
    if (!total) {
        grid.classList.add('hidden');
        list.classList.add('hidden');
        empty.classList.remove('hidden');
        $('fbEmptyTitle').textContent = state.searchQuery.trim()
            ? 'No matches found'
            : state.activeTag
                ? 'No items with this tag yet'
                : 'This folder is empty';
        $('fbEmptyDesc').textContent = state.searchQuery.trim()
            ? 'Try a different search term'
            : state.activeTag
                ? 'Tag a file or folder to see it here'
                : 'Upload files or create a folder to get started';
        renderFooter();
        return;
    }
    empty.classList.add('hidden');

    if (state.view === 'list') {
        list.classList.remove('hidden');
        folders.forEach(function (folder) { list.appendChild(buildFolderRow(folder)); });
        files.forEach(function (file) { list.appendChild(buildFileRow(file)); });
    } else {
        grid.classList.remove('hidden');
        folders.forEach(function (folder) { grid.appendChild(buildFolderCard(folder)); });
        files.forEach(function (file) { grid.appendChild(buildFileCard(file)); });
    }

    renderFooter();
}

function itemMenuButton(record, kind) {
    return '<button class="fb-item-menu" title="More actions">' + FB_ICONS.dots + '</button>';
}

function bindItemMenu(el, record, kind) {
    el.querySelector('.fb-item-menu').addEventListener('click', function (e) {
        e.stopPropagation();
        openItemMenu(e.currentTarget, record, kind);
    });
}

function buildFolderCard(folder) {
    const card = document.createElement('div');
    card.className = 'fb-card fb-card-folder';
    card.dataset.id = folder.id;

    const childCount = childFolders(folder.id).length + childFiles(folder.id).length;

    card.innerHTML = '<div class="fb-card-top">'
        + '<span class="fb-folder-art">' + folderArt(folder.color || '#FACC15') + '</span>'
        + '<span class="fb-item-menu">' + FB_ICONS.dots + '</span>'
        + '</div>'
        + '<div class="fb-card-title">' + escapeHtml(folder.name) + '</div>'
        + '<div class="fb-card-meta">'
        + '<span>' + childCount + (childCount === 1 ? ' item' : ' items') + '</span>'
        + tagChipsHtml(folder)
        + '</div>';

    card.addEventListener('click', function (e) {
        if (e.target.closest('.fb-item-menu')) return;
        openFolder(folder.id);
    });
    bindItemMenu(card, folder, 'folder');
    return card;
}

function buildFileCard(file) {
    const card = document.createElement('div');
    card.className = 'fb-card fb-card-file';
    card.dataset.id = file.id;

    const color = extColor(file.name);
    const tileHtml = file.thumbnail
        ? '<span class="fb-card-thumb" style="background-image:url(\'' + escapeHtml(file.thumbnail) + '\')"></span>'
        : '<div class="fb-file-tile" style="background:' + escapeHtml(shadeColor(color, 82)) + ';color:' + escapeHtml(color) + '">'
            + '<span>' + escapeHtml(fileExt(file.name)) + '</span></div>';

    card.innerHTML = '<div class="fb-card-top">'
        + tileHtml
        + '<span class="fb-item-menu">' + FB_ICONS.dots + '</span>'
        + '</div>'
        + '<div class="fb-card-title">' + escapeHtml(file.name) + '</div>'
        + '<div class="fb-card-meta">'
        + '<span>' + formatBytes(file.size) + ' · ' + formatRelativeDate(file.updatedAt) + '</span>'
        + tagChipsHtml(file)
        + '</div>';

    card.addEventListener('click', function (e) {
        if (e.target.closest('.fb-item-menu')) return;
        openViewer(file);
    });
    bindItemMenu(card, file, 'file');
    makeFileDraggable(card, file);
    return card;
}

function buildFolderRow(folder) {
    const row = document.createElement('div');
    row.className = 'fb-row';
    row.dataset.id = folder.id;

    const childCount = childFolders(folder.id).length + childFiles(folder.id).length;

    row.innerHTML = '<span class="fb-row-icon" style="color:' + escapeHtml(folder.color || '#FACC15') + '">' + FB_ICONS.folder + '</span>'
        + '<div class="fb-row-main">'
        + '<div class="fb-row-title">' + escapeHtml(folder.name) + '</div>'
        + tagChipsHtml(folder)
        + '</div>'
        + '<span class="fb-row-meta">' + childCount + (childCount === 1 ? ' item' : ' items') + '</span>'
        + '<span class="fb-row-meta">' + formatRelativeDate(folder.updatedAt) + '</span>'
        + itemMenuButton();

    row.addEventListener('click', function (e) {
        if (e.target.closest('.fb-item-menu')) return;
        openFolder(folder.id);
    });
    bindItemMenu(row, folder, 'folder');
    return row;
}

function buildFileRow(file) {
    const row = document.createElement('div');
    row.className = 'fb-row';
    row.dataset.id = file.id;

    const color = extColor(file.name);
    const iconHtml = file.thumbnail
        ? '<span class="fb-row-thumb" style="background-image:url(\'' + escapeHtml(file.thumbnail) + '\')"></span>'
        : '<span class="fb-row-icon fb-row-ext" style="color:' + escapeHtml(color) + '">' + escapeHtml(fileExt(file.name)) + '</span>';

    row.innerHTML = iconHtml
        + '<div class="fb-row-main">'
        + '<div class="fb-row-title">' + escapeHtml(file.name) + '</div>'
        + tagChipsHtml(file)
        + '</div>'
        + '<span class="fb-row-meta">' + formatBytes(file.size) + '</span>'
        + '<span class="fb-row-meta">' + formatRelativeDate(file.updatedAt) + '</span>'
        + itemMenuButton();

    row.addEventListener('click', function (e) {
        if (e.target.closest('.fb-item-menu')) return;
        openViewer(file);
    });
    bindItemMenu(row, file, 'file');
    makeFileDraggable(row, file);
    return row;
}

function renderFooter() {
    const el = $('fbFooterStats');
    if (!el) return;

    if (state.searchQuery.trim()) {
        el.textContent = (visibleFolders().length + visibleFiles().length) + ' results';
        return;
    }
    if (state.activeTag) {
        const count = visibleFolders().length + visibleFiles().length;
        el.textContent = count + (count === 1 ? ' item' : ' items') + ' with this tag';
        return;
    }
    const folderCount = state.folders.length;
    const fileCount = state.files.length;
    const used = state.files.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);
    el.textContent = folderCount + (folderCount === 1 ? ' folder' : ' folders')
        + ' · ' + fileCount + (fileCount === 1 ? ' file' : ' files')
        + ' · ' + formatBytes(used) + ' used';
}

// ================================================
// Item action menu (⋮)
// ================================================

function closeItemMenu() {
    const menu = $('fbItemMenu');
    if (menu) menu.classList.remove('open');
}

function openItemMenu(anchor, record, kind) {
    const menu = $('fbItemMenu');
    const actions = [];
    if (kind === 'file') {
        actions.push({ action: 'open', label: 'Open', icon: FB_ICONS.open });
        actions.push({ action: 'download', label: 'Download', icon: FB_ICONS.download });
        actions.push({ action: 'copylink', label: 'Copy link', icon: FB_ICONS.link });
    }
    actions.push({ action: 'rename', label: 'Rename', icon: FB_ICONS.rename });
    if (kind === 'file') {
        actions.push({ action: 'move', label: 'Move to folder…', icon: FB_ICONS.move });
    }
    actions.push({ action: 'tags', label: 'Edit tags…', icon: FB_ICONS.tags });
    actions.push({ action: 'delete', label: 'Delete', icon: FB_ICONS.trash, danger: true });

    menu.innerHTML = actions.map(function (a) {
        return '<button data-action="' + a.action + '" class="' + (a.danger ? 'danger' : '') + '">'
            + a.icon + '<span>' + a.label + '</span></button>';
    }).join('');

    menu.dataset.kind = kind;
    menu.dataset.id = record.id;

    const rect = anchor.getBoundingClientRect();
    menu.classList.add('open');
    const menuRect = menu.getBoundingClientRect();
    let top = rect.bottom + 6;
    if (top + menuRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuRect.height - 6);
    }
    let left = Math.min(rect.left, window.innerWidth - menuRect.width - 8);
    menu.style.top = top + 'px';
    menu.style.left = Math.max(8, left) + 'px';
}

function handleItemMenuAction(action) {
    const menu = $('fbItemMenu');
    const kind = menu.dataset.kind;
    const id = menu.dataset.id;
    const record = kind === 'file' ? getFile(id) : getFolder(id);
    closeItemMenu();
    if (!record) return;

    switch (action) {
        case 'open':
            if (kind === 'file') openViewer(record);
            else openFolder(record.id);
            break;
        case 'download':
            window.location.href = fileboxStorage.fileUrl(record.id, true);
            break;
        case 'copylink':
            copyFileLink(record);
            break;
        case 'rename':
            if (kind === 'file') {
                state.renameTarget = { kind: 'file', id: record.id };
                $('fbRenameInput').value = record.name;
                openModal('fbRenameModal');
            } else {
                openFolderForm(record);
            }
            break;
        case 'move':
            openMoveModal(record);
            break;
        case 'tags':
            openTagsModal(record, kind);
            break;
        case 'delete':
            if (kind === 'folder') confirmDeleteFolder(record);
            else confirmDeleteFile(record);
            break;
    }
}

// ================================================
// Viewer (delegated to js/viewer.js)
// ================================================

function openViewer(file) {
    fileboxViewer.open(file);
}

function closeViewer() {
    fileboxViewer.close();
}

/** Copy the file's canonical hard link (/filebox/<id>) to the clipboard. */
function copyFileLink(record) {
    if (!window.WDLinks) return;
    const url = window.location.origin + WDLinks.url('filebox', record.id);
    const done = ok => showNotification(ok ? 'Link copied' : 'Could not copy link', ok ? 'success' : 'error');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
    } else {
        done(false);
    }
}

// ================================================
// Modals (generic open/close)
// ================================================

function openModal(id) {
    $(id).classList.add('active');
}

function closeModal(id) {
    $(id).classList.remove('active');
}

function closeAllModals() {
    document.querySelectorAll('.fb-modal.active').forEach(function (m) {
        m.classList.remove('active');
    });
}

// ================================================
// Folder create / rename
// ================================================

function renderFolderSwatches() {
    const picker = $('fbFolderColorPicker');
    picker.innerHTML = '';
    APP_CONFIG.folderColors.forEach(function (color) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'fb-swatch' + (color === state.folderFormColor ? ' selected' : '');
        swatch.style.background = color;
        swatch.setAttribute('aria-label', 'Pick color ' + color);
        swatch.addEventListener('click', function () {
            state.folderFormColor = color;
            renderFolderSwatches();
        });
        picker.appendChild(swatch);
    });
}

function openFolderForm(folder, parentId) {
    state.folderFormId = folder ? folder.id : null;
    state.folderFormParent = folder ? folder.parentId : (parentId || state.currentFolderId);
    state.folderFormColor = (folder && folder.color) || APP_CONFIG.folderColors[0];
    $('fbFolderModalTitle').textContent = folder ? 'Rename folder' : 'New folder';
    $('fbFolderNameInput').value = folder ? folder.name : '';
    $('fbFolderSubmit').textContent = folder ? 'Save' : 'Create';
    renderFolderSwatches();
    openModal('fbFolderModal');
    setTimeout(function () { $('fbFolderNameInput').focus(); }, 80);
}

async function submitFolderForm() {
    const name = $('fbFolderNameInput').value.trim();
    if (!name) {
        $('fbFolderNameInput').focus();
        return;
    }
    closeModal('fbFolderModal');

    if (state.folderFormId) {
        const folder = getFolder(state.folderFormId);
        if (!folder) return;
        const before = { name: folder.name, color: folder.color };
        folder.name = name;
        folder.color = state.folderFormColor;
        render();
        const data = await fileboxStorage.updateFolder(folder.id, { name: name, color: state.folderFormColor });
        if (data) {
            applyUserData(data);
            showNotification('Folder updated', 'success');
        } else {
            folder.name = before.name;
            folder.color = before.color;
            render();
            showNotification('Failed to update folder', 'error');
        }
    } else {
        const data = await fileboxStorage.createFolder(name, state.folderFormColor, state.folderFormParent);
        if (data) {
            applyUserData(data);
            // Open the brand-new folder (it's the last pushed record).
            const created = data.folders && data.folders[data.folders.length - 1];
            if (created && !state.currentFolderId && !state.folderFormParent) {
                state.expanded.add(created.id);
            }
            showNotification('Folder created', 'success');
        } else {
            showNotification('Failed to create folder', 'error');
        }
    }
}

// ================================================
// Sidebar tags: create / edit form
// ================================================

function renderTagSwatches() {
    const picker = $('fbTagColorPicker');
    picker.innerHTML = '';
    APP_CONFIG.folderColors.forEach(function (color) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'fb-swatch' + (color === state.tagFormColor ? ' selected' : '');
        swatch.style.background = color;
        swatch.setAttribute('aria-label', 'Pick color ' + color);
        swatch.addEventListener('click', function () {
            state.tagFormColor = color;
            renderTagSwatches();
        });
        picker.appendChild(swatch);
    });
}

function openTagForm(tag) {
    state.tagFormId = tag ? tag.id : null;
    state.tagFormColor = (tag && tag.color) || APP_CONFIG.folderColors[0];
    $('fbTagNameInput').value = tag ? tag.name : '';
    $('fbTagSubmit').textContent = tag ? 'Save' : 'Create';
    renderTagSwatches();
    $('fbTagForm').classList.remove('hidden');
    setTimeout(function () { $('fbTagNameInput').focus(); }, 60);
}

function closeTagForm() {
    state.tagFormId = null;
    $('fbTagForm').classList.add('hidden');
    $('fbTagNameInput').value = '';
}

async function submitTagForm(e) {
    e.preventDefault();
    const name = $('fbTagNameInput').value.trim();
    if (!name) {
        $('fbTagNameInput').focus();
        return;
    }
    const editing = state.tagFormId ? getTag(state.tagFormId) : null;

    if (editing) {
        // Optimistic rename/recolor
        const before = { name: editing.name, color: editing.color };
        editing.name = name;
        editing.color = state.tagFormColor;
        render();
        closeTagForm();
        const data = await fileboxStorage.updateTag(editing.id, { name: name, color: state.tagFormColor });
        if (data) {
            applyUserData(data);
            showNotification('Tag updated', 'success');
        } else {
            editing.name = before.name;
            editing.color = before.color;
            render();
            showNotification('Failed to update tag', 'error');
        }
    } else {
        const data = await fileboxStorage.createTag(name, state.tagFormColor);
        if (data) {
            applyUserData(data);
            closeTagForm();
            showNotification('Tag created', 'success');
        } else {
            showNotification('Failed to create tag', 'error');
        }
    }
}


function confirmDeleteTag(tag) {
    state.deleteTarget = { kind: 'tag', id: tag.id };
    const fbCount = tagItemCount(tag.id);
    const doc = state.rawDoc || {};
    const suiteCount = ['docs', 'sheets', 'forms', 'slides', 'draws'].reduce(function (sum, key) {
        return sum + (doc[key] || []).filter(function (f) { return f && f.tagId === tag.id; }).length;
    }, 0);
    $('fbDeleteTitle').textContent = 'Delete tag';
    let text = 'Delete "<span class="fb-strong">' + escapeHtml(tag.name) + '</span>"? '
        + fbCount + (fbCount === 1 ? ' Filebox item loses' : ' Filebox items lose') + ' this tag';
    if (suiteCount) {
        text += '; ' + suiteCount + (suiteCount === 1 ? ' file' : ' files')
            + ' in Docs, Sheets, Forms, Slides and Draw will be deleted';
    }
    text += '. This cannot be undone.';
    $('fbDeleteText').innerHTML = text;
    openModal('fbDeleteModal');
}

// ================================================
// Delete folder / file (destructive, count confirm)
// ================================================

function confirmDeleteFolder(folder) {
    state.deleteTarget = { kind: 'folder', id: folder.id };
    const count = folderItemCount(folder.id);
    $('fbDeleteTitle').textContent = 'Delete folder';
    $('fbDeleteText').innerHTML = 'Delete "<span class="fb-strong">' + escapeHtml(folder.name)
        + '</span>" and its ' + count + (count === 1 ? ' item' : ' items')
        + '? This cannot be undone.';
    openModal('fbDeleteModal');
}

function confirmDeleteFile(file) {
    state.deleteTarget = { kind: 'file', id: file.id };
    $('fbDeleteTitle').textContent = 'Delete file';
    $('fbDeleteText').innerHTML = 'Delete "<span class="fb-strong">' + escapeHtml(file.name)
        + '</span>"? This permanently removes the file and its contents. This cannot be undone.';
    openModal('fbDeleteModal');
}

async function confirmDelete() {
    const target = state.deleteTarget;
    if (!target) return;
    closeModal('fbDeleteModal');

    if (target.kind === 'tag') {
        const tag = getTag(target.id);
        if (!tag) { state.deleteTarget = null; return; }
        const before = { tags: state.tags, files: state.files, folders: state.folders, activeTag: state.activeTag };
        const strip = function (list) {
            return list.map(function (f) {
                if (!Array.isArray(f.tags) || !f.tags.includes(tag.id)) return f;
                return Object.assign({}, f, { tags: f.tags.filter(function (id) { return id !== tag.id; }) });
            });
        };
        state.tags = state.tags.filter(function (t) { return t.id !== tag.id; });
        state.files = strip(state.files);
        state.folders = strip(state.folders);
        if (state.activeTag === tag.id) state.activeTag = null;
        render();
        const data = await fileboxStorage.deleteTag(tag.id);
        if (data) {
            applyUserData(data);
            showNotification('Tag deleted', 'success');
        } else {
            state.tags = before.tags;
            state.files = before.files;
            state.folders = before.folders;
            state.activeTag = before.activeTag;
            render();
            showNotification('Failed to delete tag', 'error');
        }
        state.deleteTarget = null;
        return;
    }

    if (target.kind === 'folder') {
        const folder = getFolder(target.id);
        if (!folder) return;
        const doomed = collectFolderIds(folder.id);
        const foldersBefore = state.folders, filesBefore = state.files;
        state.folders = state.folders.filter(function (f) { return f && !doomed.has(f.id); });
        state.files = state.files.filter(function (f) { return f && !doomed.has(f.folderId); });
        if (doomed.has(state.currentFolderId)) state.currentFolderId = folder.parentId || null;
        render();
        const data = await fileboxStorage.deleteFolder(folder.id);
        if (data) {
            applyUserData(data);
            showNotification('Folder deleted', 'success');
        } else {
            state.folders = foldersBefore;
            state.files = filesBefore;
            render();
            showNotification('Failed to delete folder', 'error');
        }
    } else {
        const file = getFile(target.id);
        if (!file) return;
        const before = state.files;
        state.files = state.files.filter(function (f) { return f.id !== file.id; });
        render();
        const data = await fileboxStorage.removeFile(file.id);
        if (data) {
            applyUserData(data);
            showNotification('File deleted', 'success');
        } else {
            state.files = before;
            render();
            showNotification('Failed to delete file', 'error');
        }
    }
    state.deleteTarget = null;
}

// ================================================
// Rename file
// ================================================

async function submitRename() {
    const target = state.renameTarget;
    const name = $('fbRenameInput').value.trim();
    if (!target || !name) return;
    closeModal('fbRenameModal');

    const file = getFile(target.id);
    if (!file) return;
    const before = file.name;
    file.name = name;
    render();
    const data = await fileboxStorage.renameFile(file.id, name);
    if (data) {
        applyUserData(data);
        showNotification('Renamed', 'success');
    } else {
        file.name = before;
        render();
        showNotification('Failed to rename', 'error');
    }
    state.renameTarget = null;
}

// ================================================
// Move to folder (tree picker)
// ================================================

function openMoveModal(file) {
    state.moveFileId = file.id;
    state.moveTarget = file.folderId || null;
    $('fbMoveFileName').textContent = file.name;
    renderMoveTree();
    openModal('fbMoveModal');
}

function renderMoveTree() {
    const container = $('fbMoveTree');
    container.innerHTML = '';

    const rootRow = document.createElement('button');
    rootRow.type = 'button';
    rootRow.className = 'fb-move-option' + (state.moveTarget === null ? ' selected' : '');
    rootRow.innerHTML = '<span class="fb-dot" style="background:#94a3b8"></span><span>All folders</span>' + FB_ICONS.check;
    rootRow.addEventListener('click', function () {
        state.moveTarget = null;
        renderMoveTree();
    });
    container.appendChild(rootRow);

    function addLevel(parentId, depth) {
        sortBy(childFolders(parentId), function (f) { return 0; }).forEach(function (folder) {
            if (folder.id === state.moveFileId) return;   // can't move into itself
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'fb-move-option' + (state.moveTarget === folder.id ? ' selected' : '');
            row.style.paddingLeft = (10 + depth * 18) + 'px';
            row.innerHTML = '<span class="fb-dot" style="background:' + escapeHtml(folder.color || '#FACC15') + '"></span>'
                + '<span>' + escapeHtml(folder.name) + '</span>' + FB_ICONS.check;
            row.addEventListener('click', function () {
                state.moveTarget = folder.id;
                renderMoveTree();
            });
            container.appendChild(row);
            addLevel(folder.id, depth + 1);
        });
    }
    addLevel(null, 1);
}

async function confirmMove() {
    const file = getFile(state.moveFileId);
    const target = state.moveTarget;
    closeModal('fbMoveModal');
    if (!file) return;
    if ((file.folderId || null) === (target || null)) return;

    const before = file.folderId;
    file.folderId = target;
    render();
    const data = await fileboxStorage.setFileFolder(file.id, target);
    if (data) {
        applyUserData(data);
        showNotification('Moved', 'success');
    } else {
        file.folderId = before;
        render();
        showNotification('Failed to move file', 'error');
    }
    state.moveFileId = null;
}

// ================================================
// Edit tags (checkbox multi-select + inline create)
// ================================================

function openTagsModal(record, kind) {
    state.tagsTarget = { kind: kind, id: record.id };
    state.tagSelection = new Set(record.tags || []);
    $('fbTagsItemName').textContent = record.name;
    $('fbNewTagName').value = '';
    renderTagChecks();
    openModal('fbTagsModal');
}

function renderTagChecks() {
    const container = $('fbTagChecks');
    container.innerHTML = '';
    // Same one-way pool as the sidebar: Workdeck-created tags don't offer
    // themselves here (any already on the record are preserved on save).
    const pool = fileboxTags();

    if (!pool.length) {
        container.innerHTML = '<div class="fb-tags-empty">No tags yet — create one below.</div>';
        return;
    }

    pool.forEach(function (tag) {
        const selected = state.tagSelection.has(tag.id);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'fb-move-option' + (selected ? ' selected' : '');
        row.innerHTML = '<span class="fb-dot" style="background:' + escapeHtml(tag.color) + '"></span>'
            + '<span>' + escapeHtml(tag.name) + '</span>' + FB_ICONS.check;
        row.addEventListener('click', function () {
            if (state.tagSelection.has(tag.id)) state.tagSelection.delete(tag.id);
            else state.tagSelection.add(tag.id);
            renderTagChecks();
        });
        container.appendChild(row);
    });
}

async function createTagInline() {
    const name = $('fbNewTagName').value.trim();
    if (!name) return;
    const color = APP_CONFIG.folderColors[state.tags.length % APP_CONFIG.folderColors.length];
    const data = await fileboxStorage.createTag(name, color);
    if (data) {
        applyUserData(data);
        const created = data.tags && data.tags[data.tags.length - 1];
        if (created) state.tagSelection.add(created.id);
        $('fbNewTagName').value = '';
        renderTagChecks();
    } else {
        showNotification('Failed to create tag', 'error');
    }
}

async function applyRecordTags(record, kind, tagIds) {
    const before = Array.isArray(record.tags) ? record.tags.slice() : [];
    if (before.length === tagIds.length && before.every(function (id) { return tagIds.includes(id); })) return;

    record.tags = tagIds.slice();
    render();
    const data = kind === 'file'
        ? await fileboxStorage.setFileTags(record.id, tagIds)
        : await fileboxStorage.setFolderTags(record.id, tagIds);
    if (data) {
        applyUserData(data);
        showNotification('Tags updated', 'success');
    } else {
        record.tags = before;
        render();
        showNotification('Failed to update tags', 'error');
    }
}

async function confirmTags() {
    const target = state.tagsTarget;
    if (!target) return;
    closeModal('fbTagsModal');
    state.tagsTarget = null;

    const record = target.kind === 'file' ? getFile(target.id) : getFolder(target.id);
    if (!record) return;
    await applyRecordTags(record, target.kind, Array.from(state.tagSelection));
}

// ================================================
// Sidebar: drag a file card onto a folder row to move it
// ================================================

function makeFileDraggable(el, file) {
    el.draggable = true;
    el.addEventListener('dragstart', function (e) {
        state.dragFileId = file.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'filebox:' + file.id);
        el.classList.add('dragging');
    });
    el.addEventListener('dragend', function () {
        state.dragFileId = null;
        el.classList.remove('dragging');
        document.querySelectorAll('.fb-side-row.drop-target, #fbAllFolders.drop-target').forEach(function (row) {
            row.classList.remove('drop-target');
        });
    });
}

function makeSidebarDropTarget(row, folderId) {
    row.addEventListener('dragover', function (e) {
        if (!state.dragFileId) return;
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
        if (state.dragFileId) moveFileToFolder(state.dragFileId, folderId);
    });
}

/** Drop a dragged file/folder card on a tag row*/
function makeTagDropTarget(row, tagId) {
    row.addEventListener('dragover', function (e) {
        if (!state.dragFileId) return;
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
        if (state.dragFileId) addTagToRecord(state.dragFileId, tagId);
    });
}

async function addTagToRecord(recordId, tagId) {
    const isFolder = state.folders.some(function (f) { return f.id === recordId; });
    const record = isFolder ? getFolder(recordId) : getFile(recordId);
    if (!record || !getTag(tagId)) return;
    const current = Array.isArray(record.tags) ? record.tags : [];
    if (current.includes(tagId)) return;
    await applyRecordTags(record, isFolder ? 'folder' : 'file', current.concat([tagId]));
}

async function moveFileToFolder(fileId, folderId) {
    const file = getFile(fileId);
    if (!file || (file.folderId || null) === (folderId || null)) return;

    const before = file.folderId;
    file.folderId = folderId;
    render();
    const data = await fileboxStorage.setFileFolder(fileId, folderId);
    if (data) {
        applyUserData(data);
        showNotification('Moved', 'success');
    } else {
        file.folderId = before;
        render();
        showNotification('Failed to move file', 'error');
    }
}

// ================================================
// Window-wide file drop (routes into the Uppy queue, js/uploads.js)
// ================================================

function setupDropOverlay() {
    const overlay = $('fbDropOverlay');

    window.addEventListener('dragenter', function (e) {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        state.dragDepth++;
        overlay.classList.add('active');
    });
    window.addEventListener('dragover', function (e) {
        if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
    });
    window.addEventListener('dragleave', function (e) {
        if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
        state.dragDepth = Math.max(0, state.dragDepth - 1);
        if (state.dragDepth === 0) overlay.classList.remove('active');
    });
    window.addEventListener('drop', function (e) {
        if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        state.dragDepth = 0;
        overlay.classList.remove('active');
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
            fileboxUploads.addFiles(e.dataTransfer.files);
        }
    });
}

// ================================================
// Event wiring
// ================================================

function setupEventListeners() {
    // ----- Mobile sidebar drawer -----
    $('fbSidebarToggle').addEventListener('click', function (e) {
        e.stopPropagation();
        applySidebarDrawer(!document.body.classList.contains('fb-sidebar-open'));
    });
    $('fbSidebarClose').addEventListener('click', function () {
        applySidebarDrawer(false);
    });
    $('fbSidebarScrim').addEventListener('click', function () {
        applySidebarDrawer(false);
    });

    // ----- Header: search -----
    const searchInput = $('fbSearchInput');
    searchInput.addEventListener('input', function (e) {
        state.searchQuery = e.target.value;
        $('fbClearSearch').classList.toggle('hidden', !state.searchQuery);
        renderContent();
        renderBreadcrumb();
    });
    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            searchInput.value = '';
            state.searchQuery = '';
            $('fbClearSearch').classList.add('hidden');
            renderContent();
            renderBreadcrumb();
            searchInput.blur();
        }
    });
    $('fbClearSearch').addEventListener('click', function () {
        searchInput.value = '';
        state.searchQuery = '';
        $('fbClearSearch').classList.add('hidden');
        renderContent();
        renderBreadcrumb();
    });

    // ----- Header: new folder -----
    // (Upload is bound by Uppy's Dashboard trigger in js/uploads.js.)
    $('fbNewFolderBtn').addEventListener('click', function () {
        openFolderForm(null, state.currentFolderId);
    });

    // ----- Header: sort + view -----
    $('fbSortSelect').addEventListener('change', function (e) {
        state.sort = e.target.value;
        localStorage.setItem(FB_SORT_KEY, state.sort);
        renderContent();
    });

    document.querySelectorAll('.fb-view-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            state.view = btn.dataset.view;
            localStorage.setItem(FB_VIEW_KEY, state.view);
            renderContent();
        });
    });

    // ----- Header: settings -----
    $('fbSettingsBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        $('fbSettingsDropdown').classList.toggle('open');
    });

    $('fbThemeToggleBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        $('fbThemeSubmenu').classList.toggle('open');
    });

    document.querySelectorAll('.fb-theme-option').forEach(function (option) {
        option.addEventListener('click', function (e) {
            e.stopPropagation();
            fileboxThemeManager.setTheme(option.dataset.theme);
            updateThemeLabel();
            $('fbThemeSubmenu').classList.remove('open');
        });
    });

    $('fbViewKeyBtn').addEventListener('click', function () {
        $('fbKeyText').textContent = state.userKey || 'Not available';
        openModal('fbKeyModal');
        $('fbSettingsDropdown').classList.remove('open');
    });
    $('fbKeyCopyBtn').addEventListener('click', async function () {
        if (!state.userKey) return;
        try {
            await navigator.clipboard.writeText(state.userKey);
            $('fbKeyCopyFeedback').classList.add('visible');
            setTimeout(function () { $('fbKeyCopyFeedback').classList.remove('visible'); }, 2000);
        } catch (err) { /* clipboard blocked */ }
    });

    $('fbLogoutBtn').addEventListener('click', function () {
        fileboxAuth.logout();
    });

    // ----- Sidebar -----
    $('fbAllFolders').addEventListener('click', function () {
        openFolder(null);
    });
    $('fbAllFolders').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFolder(null);
        }
    });
    makeSidebarDropTarget($('fbAllFolders'), null);
    $('fbAllFolders').tabIndex = 0;

    // ----- Folder form -----
    $('fbFolderForm').addEventListener('submit', function (e) {
        e.preventDefault();
        submitFolderForm();
    });
    $('fbFolderCancel').addEventListener('click', function () {
        closeModal('fbFolderModal');
    });

    // ----- Sidebar tags: create / edit form -----
    $('fbNewTagBtn').addEventListener('click', function () {
        if ($('fbTagForm').classList.contains('hidden')) openTagForm(null);
        else closeTagForm();
    });
    $('fbTagForm').addEventListener('submit', submitTagForm);
    $('fbTagCancel').addEventListener('click', closeTagForm);
    $('fbTagNameInput').addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeTagForm();
    });

    // ----- Item action menu (delegated: buttons are re-rendered per open) -----
    $('fbItemMenu').addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        handleItemMenuAction(btn.dataset.action);
    });

    // ----- Delete modal -----
    $('fbDeleteCancel').addEventListener('click', function () {
        closeModal('fbDeleteModal');
        state.deleteTarget = null;
    });
    $('fbDeleteConfirm').addEventListener('click', confirmDelete);

    // ----- Rename modal -----
    $('fbRenameForm').addEventListener('submit', function (e) {
        e.preventDefault();
        submitRename();
    });
    $('fbRenameCancel').addEventListener('click', function () {
        closeModal('fbRenameModal');
        state.renameTarget = null;
    });

    // ----- Move modal -----
    $('fbMoveCancel').addEventListener('click', function () {
        closeModal('fbMoveModal');
        state.moveFileId = null;
    });
    $('fbMoveConfirm').addEventListener('click', confirmMove);

    // ----- Tags modal -----
    $('fbTagsCancel').addEventListener('click', function () {
        closeModal('fbTagsModal');
        state.tagsTarget = null;
    });
    $('fbTagsConfirm').addEventListener('click', confirmTags);
    $('fbNewTagForm').addEventListener('submit', function (e) {
        e.preventDefault();
        createTagInline();
    });

    // ----- Viewer -----
    // Download is wired in openViewer (it needs the open file's id).
    $('fbViewerClose').addEventListener('click', closeViewer);

    // ----- Key modal -----
    $('fbKeyClose').addEventListener('click', function () {
        closeModal('fbKeyModal');
    });

    // ----- Global dismissers -----
    document.addEventListener('click', function (e) {
        if (!e.target.closest('#fbItemMenu') && !e.target.closest('.fb-item-menu')) {
            closeItemMenu();
        }
        if (!e.target.closest('.fb-settings-container')) {
            $('fbSettingsDropdown').classList.remove('open');
            $('fbThemeSubmenu').classList.remove('open');
        }
        document.querySelectorAll('.fb-modal.active').forEach(function (modal) {
            if (e.target === modal) closeModal(modal.id);
        });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        closeItemMenu();
        $('fbSettingsDropdown').classList.remove('open');
        $('fbThemeSubmenu').classList.remove('open');
        const active = document.querySelector('.fb-modal.active');
        if (active) {
            if (active.id === 'fbViewer') closeViewer();
            else closeModal(active.id);
        }
    });

    setupDropOverlay();

    // ----- Refresh: visibilitychange + 30s poll while visible -----
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && state.userHash) loadUserData();
    });
    setInterval(function () {
        if (!document.hidden && state.userHash && !(fileboxUploads && fileboxUploads.isBusy())) {
            loadUserData();
        }
    }, APP_CONFIG.pollInterval);
}

function updateThemeLabel() {
    $('fbThemeText').textContent = 'Theme: ' + fileboxThemeManager.getDisplayLabel();
    document.querySelectorAll('.fb-theme-option').forEach(function (option) {
        option.classList.toggle('active', option.dataset.theme === fileboxThemeManager.getPreference());
    });

    // Vendor widgets follow the resolved app theme.
    const resolved = fileboxThemeManager.currentTheme || APP_CONFIG.themes.default;
    const light = $('fbHljsLight'), dark = $('fbHljsDark');
    if (light && dark) {
        light.disabled = resolved === 'dark';
        dark.disabled = resolved !== 'dark';
    }
    fileboxUploads.applyTheme(fileboxThemeManager.getPreference());
}

// ================================================
// Init
// ================================================

async function init() {
    const session = fileboxAuth.getSession();
    if (!session) {
        // No session or no key -> back to Workdeck (matches the other apps'
        // entry guards; Filebox has no login page of its own).
        goToWorkdeck();
        return;
    }
    state.userHash = session.hash;
    state.userKey = session.key;

    fileboxThemeManager.init();
    $('fbSortSelect').value = state.sort;
    setupEventListeners();
    updateThemeLabel();

    fileboxViewer.init(state);
    fileboxUploads.init({
        theme: function () { return fileboxThemeManager.getPreference(); },
        currentFolderId: function () { return state.currentFolderId; },
        activeTagId: function () { return state.activeTag; },
        notify: showNotification,
        onFileUploaded: function (record) {
            // Show it immediately; the batch reconcile corrects the rest.
            if (!getFile(record.id)) {
                state.files.unshift(record);
                render();
            }
        },
        onComplete: async function (result) {
            // Reconcile once per batch, not per file (server is the truth).
            await loadUserData();
            const okCount = ((result && result.successful) || []).length;
            const failed = ((result && result.failed) || []).length;
            if (okCount) showNotification('Uploaded ' + okCount + (okCount === 1 ? ' file' : ' files'), 'success');
            if (failed) showNotification(failed + (failed === 1 ? ' file' : ' files') + ' failed to upload', 'error');
        }
    });

    const ok = await loadUserData();
    if (!ok) return;

    // A deleted account (cleared in another tab) bounces back to Workdeck.
    const verified = await fileboxAuth.verifySession();
    if (!verified) {
        goToWorkdeck();
        return;
    }

    fileboxThemeManager.applyFromServer(state.settings.theme);
    updateThemeLabel();
    applyUrlState();
    render();
}

document.addEventListener('DOMContentLoaded', init);

if (typeof window !== 'undefined') {
    window.fileboxApp = {
        get state() { return state; },
        loadUserData: loadUserData,
        themes: fileboxThemeManager
    };
}