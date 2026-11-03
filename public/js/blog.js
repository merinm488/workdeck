/**
 * ================================================
 * WORKDECK - Public site viewer (blog.js)
 * ================================================
 *
 * Renders a published site for visitors: /<slug> (a transparent
 * rewrite of /blog.html?site=<slug>). Everything comes from the
 * public GET-only api/blog.js — the visitor's browser never sees
 * (and cannot learn) the owning account's hash or storage address,
 * and there is no write path at all.
 *
 * The home view is the app's own home page (index.html + workdeck.js)
 * driven by the public payload instead of a session: same sidebar with
 * the Apps chooser, same grid/list toggle, search ghost, card previews
 * and footer stats. Every write affordance is simply absent — no
 * "+ New", no tag/card actions, and the settings gear carries the
 * theme menu only. Detail views reuse the suite's public surfaces:
 *   docs   -> rendered here (markdown via marked + sanitizer, plain
 *             text as-is)
 *   sheets -> rendered here (workbook bodies fetched per sheet, drawn
 *             as read-only HTML tables)
 *   decks  -> iframe of /slides/shared.html (the existing share viewer)
 *   forms  -> rendered read-only with the form-js viewer; "Fill out"
 *             opens /forms/shared.html (the existing fill-out page)
 */

(function () {
    'use strict';

    const API = '/api/blog';

    // The published kinds, in display order — same shape as workdeck.js's
    // WD_APPS entries so the shared CSS hooks (icon chips, badges, tints)
    // apply unchanged.
    const SITE_APPS = [
        { id: 'docs',   name: 'Docs',   label: 'Doc',   accent: 'doc',   icon: 'docs',   key: 'docs',   contentSearch: true  },
        { id: 'sheets', name: 'Sheets', label: 'Sheet', accent: 'sheet', icon: 'sheets', key: 'sheets', contentSearch: false },
        { id: 'slides', name: 'Slides', label: 'Slide', accent: 'slide', icon: 'slides', key: 'slides', contentSearch: false },
        { id: 'forms',  name: 'Forms',  label: 'Form',  accent: 'form',  icon: 'forms',  key: 'forms',  contentSearch: false }
    ];

    // Same sidebar behavior/storage as the app shell. The view toggle gets
    // its own storage key so a visitor's choice never touches the app's.
    const SIDEBAR = {
        storageKey: 'workdeck_sidebar_open',
        desktopQuery: window.matchMedia('(min-width: 1024px)')
    };
    const VIEW_KEY = 'workdeck_site_view_mode';

    const state = {
        slug: null,
        site: null,
        docs: [],
        tags: [],
        sheets: [],
        forms: [],
        slides: [],
        filter: 'all',       // 'all' | app id from SITE_APPS
        activeTag: null,     // tag id, null = All files
        searchQuery: '',
        sidebarOpen: false,
        viewMode: 'grid'     // 'grid' | 'list'
    };

    function $(id) {
        return document.getElementById(id);
    }

    /** Look up a published kind by app id. */
    function getApp(appId) {
        return SITE_APPS.find(function (app) { return app.id === appId; }) || SITE_APPS[0];
    }

    /** Kinds that actually have published content (dropdown + stats). */
    function listedApps() {
        return SITE_APPS.filter(function (app) { return (state[app.key] || []).length > 0; });
    }

    /** Look up a tag by id. */
    function getTag(tagId) {
        return state.tags.find(function (t) { return t.id === tagId; }) || null;
    }

    /** #rrggbb -> rgba(), so active tag rows tint with the tag color. */
    function hexToRgba(hex, alpha) {
        const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!match) return '';
        const n = parseInt(match[1], 16);
        return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
    }

    /** Relative timestamp like the app shows ("Just now", "5m ago", ...). */
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

    function formatDate(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function wdIcon(name) {
        const tpl = document.getElementById('wd-icon-' + name);
        return tpl
            ? tpl.content.firstElementChild.cloneNode(true)
            : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    }

    // ================================================
    // Markdown (same sanitizer rules as the landing page previews)
    // ================================================

    function sanitizeFragment(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('script,iframe,object,embed,link,style,meta').forEach(function (el) {
            el.remove();
        });
        tpl.content.querySelectorAll('*').forEach(function (el) {
            Array.from(el.attributes).forEach(function (attr) {
                const name = attr.name.toLowerCase();
                if (name.indexOf('on') === 0) el.removeAttribute(attr.name);
                else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        return tpl.content;
    }

    function markdownFragment(content) {
        try {
            if (window.marked && typeof window.marked.parse === 'function') {
                return sanitizeFragment(window.marked.parse(content));
            }
        } catch (err) { /* fall through to plain text */ }
        const frag = document.createDocumentFragment();
        const pre = document.createElement('pre');
        pre.textContent = content;
        frag.append(pre);
        return frag;
    }

    // ================================================
    // Items: one flat list across all four kinds
    // ================================================

    /** Unified item list, same shape as the app's getAllFiles() minus
     *  lastOpened (the public projection never exposes it). */
    function allItems() {
        const items = [];
        SITE_APPS.forEach(function (app) {
            (state[app.key] || []).forEach(function (raw) {
                items.push({
                    id: raw.id,
                    app: app.id,
                    name: app.id === 'docs' ? (raw.title || 'Untitled') : (raw.name || 'Untitled'),
                    updatedAt: raw.updatedAt,
                    tagId: getTag(raw.tagId) ? raw.tagId : null,
                    content: app.id === 'docs' ? (raw.content || '') : '',
                    raw: raw
                });
            });
        });
        return items.sort(function (a, b) {
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
    }

    /** Apply the active filter + search query; docs match on content. */
    function getVisibleItems() {
        const q = state.searchQuery.toLowerCase().trim();
        return allItems().filter(function (item) {
            if (state.activeTag && item.tagId !== state.activeTag) return false;
            if (state.filter !== 'all' && item.app !== state.filter) return false;
            if (!q) return true;
            if (item.name.toLowerCase().includes(q)) return true;
            return getApp(item.app).contentSearch && item.content.toLowerCase().includes(q);
        });
    }

    // ================================================
    // Sheet bodies (preview sketches + the sheet detail view share one
    // fetch per sheet; responses are CDN-cached server-side)
    // ================================================

    const sheetBodies = new Map();   // sheet id -> Promise<workbook|null>

    function sheetBody(sheetId) {
        if (!sheetBodies.has(sheetId)) {
            sheetBodies.set(sheetId,
                fetch(`${API}?slug=${encodeURIComponent(state.slug)}&sheet=${encodeURIComponent(sheetId)}`)
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (j) { return (j && j.success && j.data) || null; })
                    .catch(function () { return null; }));
        }
        return sheetBodies.get(sheetId);
    }

    /** Sheet cards have no inline body in the site payload — fetch it and
     *  let WDPreviews redraw the mini-grid over the skeleton. */
    function mountSheetPreview(page, item) {
        sheetBody(item.id).then(function (workbook) {
            if (!workbook || !page.isConnected) return;
            item.raw.data = workbook;
            if (window.WDPreviews) WDPreviews.mount(page, item);
        });
    }

    function mountPreview(page, item) {
        if (!page) return;
        if (item.app === 'sheets') { mountSheetPreview(page, item); return; }
        if (window.WDPreviews) WDPreviews.mount(page, item);
    }

    // ================================================
    // Dropdown placement (mobile sheets) — same as workdeck.js
    // ================================================

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
        ['filterDropdown', 'settingsDropdown'].forEach(function (id) {
            const dd = $(id);
            if (dd && dd.classList.contains('active')) placeDropdownSheet(dd);
        });
    });

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
    // Sidebar (tags)
    // ================================================

    function renderSidebar() {
        $('allFilesBtn').classList.toggle('active', state.activeTag === null);

        const counts = {};
        allItems().forEach(function (item) {
            if (item.tagId) counts[item.tagId] = (counts[item.tagId] || 0) + 1;
        });

        const list = $('projectList');
        list.replaceChildren();
        state.tags.forEach(function (tag) {
            const active = state.activeTag === tag.id;
            const row = $('blogSideTagTemplate').content.firstElementChild.cloneNode(true);
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

            const activate = function () { selectTag(tag.id); };
            row.addEventListener('click', activate);
            row.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                }
            });
            list.appendChild(row);
        });

        $('siteTagsSection').classList.toggle('hidden', state.tags.length === 0);
    }

    function selectTag(tagId) {
        state.activeTag = tagId;
        closeDetail();
        render();
        closeSidebarDrawer();
    }

    /** Brand click: clear the app filter + tag and show all files. */
    function resetFilters() {
        state.filter = 'all';
        selectTag(null);
    }

    // ================================================
    // Status footer
    // ================================================

    function renderFooter() {
        const statsEl = $('wdFooterStats');
        if (!statsEl) return;

        const items = allItems();
        const total = items.length;

        if (state.searchQuery.trim()) {
            const visible = getVisibleItems().length;
            statsEl.textContent = visible + ' of ' + total + ' file' + (total === 1 ? '' : 's');
        } else if (state.activeTag) {
            const count = items.filter(function (item) { return item.tagId === state.activeTag; }).length;
            statsEl.textContent = count + ' file' + (count === 1 ? '' : 's');
        } else if (state.filter !== 'all') {
            const count = items.filter(function (item) { return item.app === state.filter; }).length;
            statsEl.textContent = count + ' file' + (count === 1 ? '' : 's');
        } else {
            const apps = listedApps().length;
            statsEl.textContent = total + ' file' + (total === 1 ? '' : 's') + ' · ' + apps
                + (apps === 1 ? ' app' : ' apps') + ' · ' + state.tags.length
                + (state.tags.length === 1 ? ' tag' : ' tags');
        }
    }

    function renderViewToggle() {
        document.querySelectorAll('.wd-view-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.view === state.viewMode);
        });
    }

    /**
     * Shared item for the app filter chooser dropdown: icon chip + name.
     * Same builder as workdeck.js's, minus the selected checkmark variant
     * handled below.
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

    /**
     * Fill the filter chooser dropdown (one entry per kind with content)
     * and sync the chooser button's label/icon/tint with the active filter.
     */
    function renderFilterMenu() {
        const apps = listedApps();
        $('filterDropdown').replaceChildren(...apps.map(function (app) {
            return buildAppMenuItem(app, state.filter === app.id);
        }));

        document.querySelectorAll('#filterDropdown .wd-dropdown-item').forEach(function (item) {
            const slot = document.createElement('span');
            slot.className = 'wd-filter-check-slot';
            if (item.dataset.selected) slot.append(wdIcon('filter-check'));
            item.append(slot);
        });

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

    /** Tag chip on cards and list rows (same builder as the app's). */
    function projectChip(tag, extraClass) {
        const chip = document.createElement('span');
        chip.className = 'wd-file-project' + (extraClass ? ' ' + extraClass : '');
        chip.title = tag.name;
        const name = document.createElement('span');
        name.className = 'wd-file-project-name';
        name.textContent = tag.name;
        const dot = document.createElement('span');
        dot.className = 'wd-dot';
        dot.style.background = tag.color;
        chip.append(dot, name);
        return chip;
    }

    function renderFiles() {
        const items = getVisibleItems();
        const gridView = $('filesGrid');
        const listView = $('filesList');
        const emptyState = $('emptyState');
        const viewTitle = $('viewTitle');
        const viewCount = $('viewCount');
        const searchHint = $('searchHint');

        gridView.replaceChildren();
        listView.replaceChildren();

        // Title + count
        const isSearching = Boolean(state.searchQuery.trim());
        const activeTag = state.activeTag ? getTag(state.activeTag) : null;
        const filterNames = { all: 'Recent files' };
        SITE_APPS.forEach(function (app) { filterNames[app.id] = app.name; });
        if (activeTag) {
            const dot = document.createElement('span');
            dot.className = 'wd-dot';
            dot.style.background = activeTag.color;
            viewTitle.replaceChildren(dot, document.createTextNode(activeTag.name));
        } else {
            viewTitle.textContent = isSearching ? 'Search results' : filterNames[state.filter];
        }
        viewCount.textContent = items.length ? String(items.length) : '';
        searchHint.classList.toggle('hidden', !isSearching);

        renderFooter();

        if (items.length === 0) {
            gridView.classList.add('hidden');
            listView.classList.add('hidden');
            emptyState.classList.remove('hidden');

            const title = emptyState.querySelector('.wd-empty-title');
            const desc = emptyState.querySelector('.wd-empty-description');
            if (isSearching) {
                title.textContent = 'No matches found';
                desc.textContent = 'Try a different search term or filter';
            } else {
                title.textContent = 'Nothing here yet';
                desc.textContent = activeTag
                    ? 'No files with this tag yet.'
                    : 'Nothing has been published in this view.';
            }
            return;
        }

        emptyState.classList.add('hidden');

        if (state.viewMode === 'list') {
            listView.classList.remove('hidden');
            items.forEach(function (item) { listView.appendChild(buildListRow(item)); });
        } else {
            gridView.classList.remove('hidden');
            items.forEach(function (item) { gridView.appendChild(buildCard(item)); });
        }
    }

    function buildCard(item) {
        const card = $('wdFileCardTemplate').content.firstElementChild.cloneNode(true);
        card.dataset.id = item.id;
        card.dataset.app = item.app;

        const app = getApp(item.app);

        const icon = card.querySelector('.wd-file-icon');
        icon.classList.add('wd-file-icon-' + app.accent);
        icon.append(wdIcon(app.icon));
        card.querySelector('.wd-file-title').textContent = item.name;

        const badge = card.querySelector('.wd-file-app-badge');
        badge.classList.add(app.accent);
        badge.textContent = app.label;
        const date = card.querySelector('.wd-file-date');
        date.textContent = formatRelativeDate(item.updatedAt);
        const tag = item.tagId ? getTag(item.tagId) : null;
        if (tag) date.before(projectChip(tag));

        mountPreview(card.querySelector('.wd-file-preview-page'), item);

        card.addEventListener('click', function () { openItem(item); });
        return card;
    }

    function buildListRow(item) {
        const row = $('wdFileRowTemplate').content.firstElementChild.cloneNode(true);
        row.dataset.id = item.id;
        row.dataset.app = item.app;

        const app = getApp(item.app);

        const icon = row.querySelector('.wd-file-icon');
        icon.classList.add('wd-file-icon-' + app.accent);
        icon.append(wdIcon(app.icon));
        row.querySelector('.wd-file-row-title').textContent = item.name;
        const tag = item.tagId ? getTag(item.tagId) : null;
        if (tag) row.querySelector('.wd-file-row-main').append(projectChip(tag, 'wd-file-row-project'));
        const badge = row.querySelector('.wd-file-app-badge');
        badge.classList.add(app.accent);
        badge.textContent = app.label;
        row.querySelector('.wd-file-row-meta').textContent = formatRelativeDate(item.updatedAt);

        row.addEventListener('click', function () { openItem(item); });
        return row;
    }

    // ================================================
    // Detail views (read-only renderings of one file)
    // ================================================

    function openItem(item) {
        if (item.app === 'docs') renderDoc(item.id);
        else if (item.app === 'sheets') renderSheet(item.id);
        else if (item.app === 'slides') renderDeck(item.id);
        else renderForm(item.id);
    }

    /** Back link shared by every detail view; the filter is preserved. */
    function wireBack(view, sectionLabel) {
        view.querySelector('.blog-back-label').textContent = 'All ' + sectionLabel.toLowerCase();
        view.querySelector('.blog-back').addEventListener('click', closeDetail);
    }

    function showDetail(view) {
        $('blogHome').classList.add('hidden');
        $('blogDetail').replaceChildren(view);
        window.scrollTo(0, 0);
    }

    function closeDetail() {
        $('blogDetail').replaceChildren();
        $('blogHome').classList.remove('hidden');
    }

    // ---- Docs ----

    function renderDoc(docId) {
        const doc = state.docs.find(function (d) { return d.id === docId; });
        if (!doc) return;

        const article = $('blogArticleTemplate').content.firstElementChild.cloneNode(true);
        wireBack(article, 'Docs');
        article.querySelector('.blog-article-title').textContent = doc.title;

        const meta = article.querySelector('.blog-article-meta');
        const parts = [formatDate(doc.createdAt)];
        if (doc.updatedAt && doc.updatedAt !== doc.createdAt) parts.push('updated ' + formatDate(doc.updatedAt));
        meta.textContent = parts.filter(Boolean).join(' · ');
        const tag = doc.tagId ? getTag(doc.tagId) : null;
        if (tag) meta.append(' · ', projectChip(tag));

        const body = article.querySelector('.blog-article-body');
        const content = String(doc.content || '');
        if (!content.trim()) {
            const empty = document.createElement('p');
            empty.className = 'blog-note';
            empty.textContent = 'This post is empty.';
            body.append(empty);
        } else if (doc.contentType === 'markdown') {
            body.className = 'blog-article-body blog-md';
            body.append(markdownFragment(content));
        } else {
            body.className = 'blog-article-body blog-plain';
            body.textContent = content;
        }

        showDetail(article);
    }

    // ---- Sheets (read-only tables) ----

    async function renderSheet(sheetId) {
        const sheet = state.sheets.find(function (s) { return s.id === sheetId; });
        if (!sheet) return;

        const view = $('blogSheetTemplate').content.firstElementChild.cloneNode(true);
        wireBack(view, 'Sheets');
        view.querySelector('.blog-item-title').textContent = sheet.name;
        const iso = sheet.updatedAt || sheet.createdAt;
        view.querySelector('.blog-item-meta').textContent = iso ? 'Updated ' + formatDate(iso) : '';
        const note = view.querySelector('.blog-loading-note');
        note.classList.remove('hidden');
        showDetail(view);

        const workbook = await sheetBody(sheetId);

        note.classList.add('hidden');
        const body = view.querySelector('.blog-sheet-body');
        if (!workbook || !workbook.sheets) {
            const fail = document.createElement('p');
            fail.className = 'blog-note';
            fail.textContent = 'This sheet could not be loaded.';
            body.append(fail);
            return;
        }

        const order = Array.isArray(workbook.sheetOrder) ? workbook.sheetOrder : Object.keys(workbook.sheets);
        order.forEach(function (wsId) {
            const ws = workbook.sheets[wsId];
            if (!ws || !ws.cellData) return;
            const section = $('blogWorksheetTemplate').content.firstElementChild.cloneNode(true);
            section.querySelector('.blog-worksheet-name').textContent = ws.name || 'Sheet';
            section.querySelector('.blog-table').append(buildTable(ws.cellData));
            body.append(section);
        });
    }

    /** Univer cellData -> a read-only table. Row 0 renders as a header. */
    function buildTable(cellData) {
        const table = document.createElement('table');
        const rowKeys = Object.keys(cellData)
            .map(Number).filter(Number.isFinite).sort(function (a, b) { return a - b; });

        rowKeys.forEach(function (rowKey, rowIndex) {
            const tr = document.createElement('tr');
            const cells = cellData[String(rowKey)] || {};
            const colKeys = Object.keys(cells)
                .map(Number).filter(Number.isFinite).sort(function (a, b) { return a - b; });
            const width = colKeys.length ? colKeys[colKeys.length - 1] + 1 : 0;

            for (let col = 0; col < width; col++) {
                const cell = cells[String(col)];
                const tag = rowIndex === 0 ? 'th' : 'td';
                const el = document.createElement(tag);
                if (cell && cell.v !== undefined && cell.v !== null) {
                    el.textContent = String(cell.v);
                    if (cell.t === 2) el.classList.add('num');
                }
                tr.append(el);
            }
            table.append(tr);
        });
        return table;
    }

    // ---- Slides (embed the existing share viewer) ----

    function renderDeck(deckId) {
        const deck = state.slides.find(function (d) { return d.id === deckId; });
        if (!deck) return;

        const view = $('blogSlideTemplate').content.firstElementChild.cloneNode(true);
        wireBack(view, 'Decks');
        view.querySelector('.blog-item-title').textContent = deck.name;
        const iso = deck.updatedAt || deck.createdAt;
        view.querySelector('.blog-item-meta').textContent = iso ? 'Updated ' + formatDate(iso) : '';
        showDetail(view);

        if (deck.sharedId) {
            view.querySelector('iframe').src = '/slides/shared.html?shared=' + encodeURIComponent(deck.sharedId);
        } else {
            view.querySelector('.blog-slide-frame').remove();
            view.querySelector('.blog-note').classList.remove('hidden');
        }
    }

    // ---- Forms (read-only preview + existing fill-out page) ----

    async function renderForm(formId) {
        const form = state.forms.find(function (f) { return f.id === formId; });
        if (!form) return;

        const view = $('blogFormTemplate').content.firstElementChild.cloneNode(true);
        wireBack(view, 'Forms');
        view.querySelector('.blog-item-title').textContent = form.name;
        const iso = form.updatedAt || form.createdAt;
        view.querySelector('.blog-item-meta').textContent = iso ? 'Updated ' + formatDate(iso) : '';
        showDetail(view);

        if (form.sharedId) {
            const open = view.querySelector('.blog-form-open');
            open.href = '/forms/shared.html?shared=' + encodeURIComponent(form.sharedId);
            open.classList.remove('hidden');
        } else {
            view.querySelector('.blog-form-actions').remove();
            view.querySelector('.blog-note').classList.remove('hidden');
        }

        const container = view.querySelector('.blog-form-frame');
        if (!(form.components || []).length) {
            const empty = document.createElement('p');
            empty.className = 'blog-note';
            empty.textContent = 'This form has no questions yet.';
            container.append(empty);
            return;
        }
        if (typeof FormViewer === 'undefined') {
            const fail = document.createElement('p');
            fail.className = 'blog-note';
            fail.textContent = 'The form library failed to load.';
            container.append(fail);
            return;
        }
        try {
            await FormViewer.createForm({
                container: container,
                schema: { type: 'default', components: form.components || [] }
            });
        } catch (err) {
            const fail = document.createElement('p');
            fail.className = 'blog-note';
            fail.textContent = 'This form could not be rendered.';
            container.append(fail);
        }
    }

    // ================================================
    // Errors / shell
    // ================================================

    function showError(title, text) {
        $('blogLoading').classList.add('hidden');
        $('blogApp').classList.add('hidden');
        $('blogErrorTitle').textContent = title;
        $('blogErrorText').textContent = text;
        $('blogError').classList.remove('hidden');
    }

    async function loadSite() {
        const response = await fetch(`${API}?slug=${encodeURIComponent(state.slug)}`);
        let json = null;
        try { json = await response.json(); } catch (err) { /* handled below */ }
        if (!response.ok || !json || !json.success) {
            showError((json && json.error) || 'Site not found', 'This address is not published.');
            return;
        }
        state.site = json.site;
        state.docs = json.docs || [];
        state.tags = json.tags || [];
        state.sheets = json.sheets || [];
        state.forms = json.forms || [];
        state.slides = json.slides || [];

        const title = state.site.title || 'Workdeck Site';
        document.title = title;
        $('siteBrand').textContent = title;

        $('blogLoading').classList.add('hidden');
        $('blogError').classList.add('hidden');
        $('blogApp').classList.remove('hidden');
        render();
    }

    // ================================================
    // Sidebar open state — same behavior/storage as the app shell
    // ================================================

    function applySidebar() {
        document.body.classList.toggle('wd-sidebar-open', state.sidebarOpen);
        $('sidebarToggle').setAttribute('aria-expanded', String(state.sidebarOpen));
    }

    function initSidebar() {
        state.sidebarOpen = SIDEBAR.desktopQuery.matches &&
            localStorage.getItem(SIDEBAR.storageKey) !== '0';
        applySidebar();
    }

    function toggleSidebar() {
        state.sidebarOpen = !state.sidebarOpen;
        // Only desktop pin/unpin is remembered; drawer open/close is per-session.
        if (SIDEBAR.desktopQuery.matches) {
            localStorage.setItem(SIDEBAR.storageKey, state.sidebarOpen ? '1' : '0');
        }
        applySidebar();
    }

    function closeSidebarDrawer() {
        if (!SIDEBAR.desktopQuery.matches && state.sidebarOpen) {
            state.sidebarOpen = false;
            applySidebar();
        }
    }

    // ================================================
    // Event listeners
    // ================================================

    function setupEventListeners() {
        // ----- Search (ghost suggestion + clear, same as the app) -----
        const searchInput = $('searchInput');
        const searchWrapper = searchInput.closest('.wd-search-wrapper');
        const searchGhostTyped = $('searchGhostTyped');
        const searchGhostRest = $('searchGhostRest');
        let searchSuggestion = null;

        // Greyed-out inline completion from the most recent title matching the prefix.
        function updateSearchSuggestion() {
            const value = searchInput.value;
            searchSuggestion = null;
            if (value.trim()) {
                const q = value.toLowerCase();
                const match = allItems().find(function (item) {
                    return (state.filter === 'all' || item.app === state.filter) &&
                        (!state.activeTag || item.tagId === state.activeTag) &&
                        item.name.toLowerCase().startsWith(q) &&
                        item.name.length > value.length;
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

        function applySearch(value) {
            state.searchQuery = value;
            $('clearSearch').classList.toggle('hidden', !state.searchQuery);
            closeDetail();
            renderFiles();
        }

        searchInput.addEventListener('input', function (e) {
            applySearch(e.target.value);
            updateSearchSuggestion();
        });

        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                searchInput.value = '';
                applySearch('');
                hideSearchSuggestion();
                searchInput.blur();
            } else if (e.key === 'Tab' && searchSuggestion && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                searchInput.value = searchSuggestion;
                applySearch(searchSuggestion);
                updateSearchSuggestion();
            }
        });

        searchInput.addEventListener('scroll', function () {
            $('searchGhost').scrollLeft = searchInput.scrollLeft;
        });
        searchInput.addEventListener('focus', updateSearchSuggestion);
        searchInput.addEventListener('blur', hideSearchSuggestion);

        $('clearSearch').addEventListener('click', function () {
            searchInput.value = '';
            applySearch('');
            hideSearchSuggestion();
        });

        // ----- Sidebar -----
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

        // Escape closes the mobile drawer
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeSidebarDrawer();
        });

        // Brand click: back to everything (the app's brand links to '/',
        // which resets both the app filter and the tag).
        const brand = $('blogBrand');
        brand.addEventListener('click', resetFilters);
        brand.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                resetFilters();
            }
        });

        // ----- Filter chooser -----
        document.querySelectorAll('.wd-filter[data-filter]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.filter = btn.dataset.filter;
                closeFilterDropdown();
                closeDetail();
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
            closeDetail();
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
                localStorage.setItem(VIEW_KEY, state.viewMode);
                renderFiles();
            });
        });

        // ----- Settings dropdown (theme only) -----
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

        // ----- Global click closes dropdowns -----
        document.addEventListener('click', function (e) {
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
        });

        // ----- Retry after a load error -----
        $('blogRetryBtn').addEventListener('click', function () {
            $('blogError').classList.add('hidden');
            $('blogLoading').classList.remove('hidden');
            loadSite().catch(function () {
                showError('Could not load this site', 'Check your connection and try again.');
            });
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

    function init() {
        wdThemeManager.init();
        setupEventListeners();
        updateThemeLabel();
        initSidebar();

        // Pretty URLs (/<slug>) are transparent rewrites: the browser URL
        // keeps the slug in its PATH, so read it there first — same as
        // todo/js/editor.js — with ?site= as the plain-URL fallback.
        const pathSlug = (/^\/([a-z0-9-]{3,40})\/?$/.exec(location.pathname) || [])[1];
        const params = new URLSearchParams(location.search);
        const slug = (pathSlug || params.get('site') || params.get('slug') || '').trim().toLowerCase();
        if (!slug) {
            showError('Nothing to see here', 'No site address was given.');
            return;
        }
        state.slug = slug;
        state.viewMode = localStorage.getItem(VIEW_KEY) || 'grid';
        loadSite().catch(function () {
            showError('Could not load this site', 'Check your connection and try again.');
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
