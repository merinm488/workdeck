/**
 * ================================================
 * WORKDECK - Public site viewer (blog.js)
 * ================================================
 *
 * Renders a published site for visitors: /blog.html?site=<slug>
 * (the /<slug> pretty URLs rewrite here). Everything comes from the
 * public GET-only api/blog.js — the visitor's browser never sees (and
 * cannot learn) the owning account's hash or storage address, and there
 * is no write path at all.
 *
 * Rendering reuses the suite's existing public surfaces where content is
 * interactive:
 *   docs   -> rendered here (markdown via marked + the previews.js
 *             sanitizer, plain text as-is)
 *   sheets -> rendered here (workbook bodies fetched per sheet, drawn as
 *             read-only HTML tables)
 *   decks  -> iframe of /slides/shared.html (the existing share viewer)
 *   forms  -> rendered read-only with the form-js viewer; "Fill out"
 *             opens /forms/shared.html (the existing fill-out page)
 */

(function () {
    'use strict';

    const API = '/api/blog';

    const state = {
        slug: null,
        site: null,
        data: null,
        activeTab: null
    };

    function $(id) {
        return document.getElementById(id);
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
    // Small builders
    // ================================================

    function clone(templateId) {
        // The template's root element, cloned — NOT the .content fragment
        // (a fragment's children are moved out on append, which strands
        // both listeners attached to the fragment and later queries).
        return $(templateId).content.firstElementChild.cloneNode(true);
    }

    function formatDate(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function getTag(tagId) {
        return (state.data.tags || []).find(function (t) { return t.id === tagId; }) || null;
    }

    function chip(tagId) {
        const tag = getTag(tagId);
        if (!tag) return null;
        const chip = clone('blogChipTemplate');
        chip.querySelector('.blog-chip-dot').style.background = tag.color || 'var(--accent)';
        chip.querySelector('.blog-chip-name').textContent = tag.name;
        return chip;
    }

    function iconSvg(kind) {
        // Tab/row icons live as <svg> templates per kind in blog.html
        const svg = $('blog-icon-' + kind);
        return svg ? svg.content.cloneNode(true) : null;
    }

    function row(item, kind, onClick) {
        const row = clone('blogRowTemplate');
        const iconHost = row.querySelector('.blog-row-icon');
        const svg = iconSvg(kind);
        if (svg) iconHost.append(svg);
        row.querySelector('.blog-row-title').textContent = item.__title;
        const metaHost = row.querySelector('.blog-row-meta');
        if (item.__meta) metaHost.textContent = item.__meta;
        else metaHost.remove();
        row.querySelector('.blog-row-date').textContent = formatDate(item.updatedAt || item.createdAt);
        row.addEventListener('click', onClick);
        return row;
    }

    function backButton(label, onClick) {
        const btn = document.createElement('button');
        btn.className = 'blog-back';
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }

    // ================================================
    // Load + shell
    // ================================================

    async function loadSite() {
        const response = await fetch(`${API}?slug=${encodeURIComponent(state.slug)}`);
        let json = null;
        try { json = await response.json(); } catch (err) { /* handled below */ }
        if (!response.ok || !json || !json.success) {
            showError((json && json.error) || 'Site not found', 'This address is not published.');
            return;
        }
        state.site = json.site;
        state.data = json;
        renderShell();
    }

    function sections() {
        const d = state.data;
        return [
            { key: 'docs', label: 'Posts', count: d.docs.length },
            { key: 'sheets', label: 'Sheets', count: d.sheets.length },
            { key: 'slides', label: 'Decks', count: d.slides.length },
            { key: 'forms', label: 'Forms', count: d.forms.length }
        ].filter(function (s) { return s.count > 0; });
    }

    function renderShell() {
        $('blogLoading').classList.add('hidden');
        $('blogError').classList.add('hidden');
        $('blogApp').classList.remove('hidden');

        document.title = state.site.title || 'Workdeck Site';
        $('siteTitle').textContent = state.site.title || 'Workdeck Site';
        $('siteMeta').textContent = state.site.publishedAt
            ? 'Published ' + formatDate(state.site.publishedAt)
            : '';

        const list = sections();
        const tabsHost = $('blogTabs');
        tabsHost.replaceChildren();
        list.forEach(function (section) {
            const tab = clone('blogTabTemplate');
            tab.querySelector('.blog-tab-label').textContent = section.label;
            tab.querySelector('.blog-tab-count').textContent = String(section.count);
            tab.addEventListener('click', function () {
                renderTab(section.key);
            });
            tab.dataset.key = section.key;
            tabsHost.append(tab);
        });

        if (list.length === 0) {
            $('blogMain').replaceChildren(clone('blogEmptyTemplate'));
            return;
        }
        renderTab(state.activeTab && list.some(function (s) { return s.key === state.activeTab; })
            ? state.activeTab
            : list[0].key);
    }

    function renderTab(key) {
        state.activeTab = key;
        document.querySelectorAll('.blog-tab').forEach(function (tab) {
            tab.classList.toggle('active', tab.dataset.key === key);
        });
        window.scrollTo(0, 0);

        if (key === 'docs') renderPosts();
        else if (key === 'sheets') renderSheetList();
        else if (key === 'slides') renderSlideList();
        else if (key === 'forms') renderFormList();
    }

    function listHost() {
        const host = document.createElement('div');
        host.className = 'blog-list';
        $('blogMain').replaceChildren(host);
        return host;
    }

    // ================================================
    // Docs
    // ================================================

    function renderPosts() {
        const host = listHost();
        const docs = state.data.docs.slice().sort(function (a, b) {
            return (b.pinned === true) - (a.pinned === true);
        });
        docs.forEach(function (doc) {
            const r = row(
                Object.assign({}, doc, { __title: doc.title }),
                'doc',
                function () { renderArticle(doc.id); }
            );
            const tag = getTag(doc.tagId);
            if (tag) {
                const metaHost = r.querySelector('.blog-row-meta');
                metaHost.textContent = '';
                metaHost.append(chip(doc.tagId));
            }
            if (doc.pinned) r.classList.add('pinned');
            host.append(r);
        });
    }

    function renderArticle(docId) {
        const doc = state.data.docs.find(function (d) { return d.id === docId; });
        if (!doc) return renderTab('docs');

        const article = clone('blogArticleTemplate');
        article.querySelector('.blog-back').addEventListener('click', function () { renderTab('docs'); });
        article.querySelector('.blog-article-title').textContent = doc.title;

        const meta = article.querySelector('.blog-article-meta');
        const parts = [formatDate(doc.createdAt)];
        if (doc.updatedAt && doc.updatedAt !== doc.createdAt) parts.push('updated ' + formatDate(doc.updatedAt));
        meta.textContent = parts.filter(Boolean).join(' · ');
        const tagChip = chip(doc.tagId);
        if (tagChip) meta.append(' · ', tagChip);

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

        $('blogMain').replaceChildren(article);
        window.scrollTo(0, 0);
    }

    // ================================================
    // Sheets (read-only tables)
    // ================================================

    function renderSheetList() {
        const host = listHost();
        state.data.sheets.forEach(function (sheet) {
            host.append(row(
                Object.assign({}, sheet, { __title: sheet.name }),
                'sheet',
                function () { renderSheet(sheet.id); }
            ));
        });
    }

    async function renderSheet(sheetId) {
        const sheetMeta = state.data.sheets.find(function (s) { return s.id === sheetId; });
        if (!sheetMeta) return renderTab('sheets');

        const view = clone('blogSheetTemplate');
        view.querySelector('.blog-back').addEventListener('click', function () { renderTab('sheets'); });
        view.querySelector('.blog-item-title').textContent = sheetMeta.name;
        const note = view.querySelector('.blog-loading-note');
        note.classList.remove('hidden');
        $('blogMain').replaceChildren(view);
        window.scrollTo(0, 0);

        let workbook = null;
        try {
            const response = await fetch(`${API}?slug=${encodeURIComponent(state.slug)}&sheet=${encodeURIComponent(sheetId)}`);
            const json = await response.json();
            if (response.ok && json.success) workbook = json.data;
        } catch (err) { /* rendered as failure below */ }

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
            const section = clone('blogWorksheetTemplate');
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

    // ================================================
    // Slides (embed the existing share viewer)
    // ================================================

    function renderSlideList() {
        const host = listHost();
        state.data.slides.forEach(function (deck) {
            const meta = (deck.slides || []).length
                ? (deck.slides.length === 1 ? '1 slide' : deck.slides.length + ' slides')
                : 'Empty deck';
            host.append(row(
                Object.assign({}, deck, { __title: deck.name, __meta: meta }),
                'deck',
                function () { renderDeck(deck.id); }
            ));
        });
    }

    function renderDeck(deckId) {
        const deck = state.data.slides.find(function (d) { return d.id === deckId; });
        if (!deck) return renderTab('slides');

        const view = clone('blogSlideTemplate');
        view.querySelector('.blog-back').addEventListener('click', function () { renderTab('slides'); });
        view.querySelector('.blog-item-title').textContent = deck.name;
        $('blogMain').replaceChildren(view);
        window.scrollTo(0, 0);

        if (deck.sharedId) {
            view.querySelector('iframe').src = '/slides/shared.html?shared=' + encodeURIComponent(deck.sharedId);
        } else {
            view.querySelector('.blog-slide-frame').remove();
            view.querySelector('.blog-note').classList.remove('hidden');
        }
    }

    // ================================================
    // Forms (read-only preview + existing fill-out page)
    // ================================================

    function renderFormList() {
        const host = listHost();
        state.data.forms.forEach(function (form) {
            host.append(row(
                Object.assign({}, form, { __title: form.name }),
                'form',
                function () { renderForm(form.id); }
            ));
        });
    }

    async function renderForm(formId) {
        const form = state.data.forms.find(function (f) { return f.id === formId; });
        if (!form) return renderTab('forms');

        const view = clone('blogFormTemplate');
        view.querySelector('.blog-back').addEventListener('click', function () { renderTab('forms'); });
        view.querySelector('.blog-item-title').textContent = form.name;
        $('blogMain').replaceChildren(view);
        window.scrollTo(0, 0);

        if (form.sharedId) {
            const open = view.querySelector('.blog-form-open');
            open.href = '/forms/shared.html?shared=' + encodeURIComponent(form.sharedId);
            open.classList.remove('hidden');
        } else {
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
    // Errors / boot
    // ================================================

    function showError(title, text) {
        $('blogLoading').classList.add('hidden');
        $('blogApp').classList.add('hidden');
        $('blogErrorTitle').textContent = title;
        $('blogErrorText').textContent = text;
        $('blogError').classList.remove('hidden');
    }

    document.addEventListener('DOMContentLoaded', function () {
        wdThemeManager.init();
        $('blogThemeToggle').addEventListener('click', function () {
            wdThemeManager.toggleTheme();
        });
        $('blogRetryBtn').addEventListener('click', function () {
            $('blogError').classList.add('hidden');
            $('blogLoading').classList.remove('hidden');
            loadSite();
        });

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
        loadSite().catch(function () {
            showError('Could not load this site', 'Check your connection and try again.');
        });
    });
})();
