/**
 * ================================================
 * WORKDECK - File Mentions (WDMentions)
 * ================================================
 */

(function () {
    'use strict';

    var DOC_TTL = 15000;
    var docCache = { data: null, at: 0, inflight: null };

    /** Unified user doc, cached briefly (file names change often enough). */
    function getUnifiedDoc(force) {
        var now = Date.now();
        if (!force && docCache.data && now - docCache.at < DOC_TTL) {
            return Promise.resolve(docCache.data);
        }
        if (!force && docCache.inflight) return docCache.inflight;

        var hash = window.WDLinks && WDLinks.sessionHash();
        if (!hash) return Promise.reject(new Error('Not signed in'));

        docCache.inflight = fetch('/api/workdeck?hash=' + encodeURIComponent(hash), { cache: 'no-store' })
            .then(function (res) {
                if (!res.ok) throw new Error('Failed to load files (' + res.status + ')');
                return res.json();
            })
            .then(function (result) {
                if (!result || !result.success) throw new Error((result && result.error) || 'Failed to load files');
                docCache.data = result.data;
                docCache.at = Date.now();
                docCache.inflight = null;
                return result.data;
            })
            .catch(function (err) {
                docCache.inflight = null;
                throw err;
            });
        return docCache.inflight;
    }

    function invalidateDocCache() {
        docCache.data = null;
        docCache.at = 0;
    }

    /** Flat, pickable list of every file/folder in the unified doc. */
    function entries(userData) {
        if (!userData) return [];
        var list = [];
        var add = function (app, rec, kind) {
            if (!rec || !rec.id) return;
            list.push({
                app: app,
                id: rec.id,
                kind: kind || 'file',
                name: rec.title || rec.name || 'Untitled',
                updatedAt: rec.updatedAt || '',
                lastOpened: (userData.settings && userData.settings.lastOpened && userData.settings.lastOpened[rec.id]) || ''
            });
        };
        (userData.docs || []).forEach(function (d) { add('docs', d); });
        (userData.sheets || []).forEach(function (s) { add('sheets', s); });
        (userData.forms || []).forEach(function (f) { add('forms', f); });
        (userData.slides || []).forEach(function (s) { add('slides', s); });
        (userData.draws || []).forEach(function (d) { add('draw', d); });
        (userData.todo || []).forEach(function (t) { add('todo', t); });
        (userData.posts || []).forEach(function (p) { add('blog', p); });
        (userData.files || []).forEach(function (f) { add('filebox', f); });
        (userData.folders || []).forEach(function (f) { add('filebox', f, 'folder'); });
        return list;
    }

    /** Match quality: higher = better. 0 = no match. */
    function score(entry, query) {
        if (!query) return 1;
        var name = entry.name.toLowerCase();
        var app = (WDLinks.APPS[entry.app] ? WDLinks.APPS[entry.app].name : entry.app).toLowerCase();
        var q = query.toLowerCase().replace(/^@+/, '');
        if (!q) return 1;
        if (name === q) return 6;
        if (name.indexOf(q) === 0) return 5;
        if (new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(name)) return 4;
        if (name.indexOf(q) !== -1) return 3;
        var initials = name.split(/[\s\-_]+/).map(function (w) { return w.charAt(0); }).join('');
        if (q.length > 1 && initials.indexOf(q) === 0) return 2;
        if (app.indexOf(q) !== -1) return 1;
        return 0;
    }

    /** Recency order (launcher's rule: lastOpened, then updatedAt). */
    function byRecency(a, b) {
        if (a.lastOpened && b.lastOpened) return a.lastOpened < b.lastOpened ? 1 : -1;
        if (a.lastOpened) return -1;
        if (b.lastOpened) return 1;
        return (a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1;
    }

    function filterEntries(list, query, excludeIds) {
        var scored = [];
        for (var i = 0; i < list.length; i++) {
            if (excludeIds && excludeIds.indexOf(list[i].id) !== -1) continue;
            var s = score(list[i], query);
            if (s > 0) scored.push({ e: list[i], s: s });
        }
        scored.sort(function (a, b) { return b.s - a.s || byRecency(a.e, b.e); });
        return scored.map(function (x) { return x.e; });
    }

    // ================================================
    // Picker (singleton)
    // ================================================

    var pop = null;          // .wdm-pop element
    var popState = null;     // { entries, filtered, index, onPick, mode, excludeIds, getData }

    function ensurePop() {
        if (pop) return pop;
        pop = document.createElement('div');
        pop.className = 'wdm-pop';
        pop.setAttribute('role', 'listbox');
        document.body.appendChild(pop);
        pop.addEventListener('mousedown', function (e) {
            // Clicking an item must not blur the host editor first.
            e.preventDefault();
            var item = e.target.closest('.wdm-item');
            if (item) pickIndex(parseInt(item.dataset.index, 10));
        });
        document.addEventListener('mousedown', function (e) {
            if (pop && popState && !pop.contains(e.target)) close();
        }, true);
        return pop;
    }

    function buildItem(entry, index, selected) {
        var app = WDLinks.APPS[entry.app] || WDLinks.APPS.filebox;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wdm-item' + (selected ? ' wdm-item-active' : '');
        btn.setAttribute('role', 'option');
        btn.dataset.index = index;
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');

        var icon = document.createElement('span');
        icon.className = 'wdm-item-icon wdm-app-' + entry.app;
        icon.append(WDLinks.iconNode(entry.app, 16));
        var name = document.createElement('span');
        name.className = 'wdm-item-name';
        name.textContent = entry.name;
        var appLabel = document.createElement('span');
        appLabel.className = 'wdm-item-app';
        appLabel.textContent = app.name;
        btn.append(icon, name, appLabel);
        return btn;
    }

    function emptyDiv(message) {
        var el = document.createElement('div');
        el.className = 'wdm-empty';
        el.textContent = message;
        return el;
    }

    function render() {
        if (!pop || !popState) return;
        var head = [];
        if (popState.mode === 'input') {
            var search = document.createElement('div');
            search.className = 'wdm-search';
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'wdm-search-input';
            input.placeholder = 'Link to a file…';
            input.spellcheck = false;
            input.autocomplete = 'off';
            search.append(input);
            head.push(search);
        }
        if (popState.filtered.length) {
            var list = document.createElement('div');
            list.className = 'wdm-list';
            for (var i = 0; i < popState.filtered.length; i++) {
                list.append(buildItem(popState.filtered[i], i, i === popState.index));
            }
            head.push(list);
        } else {
            head.push(emptyDiv('No matching files'));
        }
        pop.replaceChildren(...head);

        var input = pop.querySelector('.wdm-search-input');
        if (input) {
            input.value = popState.query || '';
            input.addEventListener('input', function () { setFilter(input.value); });
            input.addEventListener('keydown', onKeydown);
            setTimeout(function () { input.focus(); }, 0);
        }
        var active = pop.querySelector('.wdm-item-active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function position(anchor) {
        var rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
        if (!rect) rect = { left: 24, bottom: 24, top: 24 };
        var vw = window.innerWidth, vh = window.innerHeight;
        pop.style.left = '0px';
        pop.style.top = '0px';
        pop.style.visibility = 'hidden';
        pop.style.display = '';
        var pw = pop.offsetWidth, ph = pop.offsetHeight;
        var left = Math.min(Math.max(8, rect.left), vw - pw - 8);
        var below = (rect.bottom || 0) + 6;
        var top = below + ph <= vh - 8 ? below : Math.max(8, (rect.top || below) - ph - 6);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
        pop.style.visibility = '';
    }

    /**
     * Open the picker.
     *   anchor    Element | DOMRect | {left, top, bottom}
     *   onPick    (entry) -> void          entry: { app, id, name, kind, ... }
     *   getData   optional () -> Promise<unifiedDoc>; default getUnifiedDoc()
     *   mode      'input' (default) | 'external' (caller drives keys/filter)
     *   query     optional initial filter
     *   excludeIds optional [fileId] to hide (e.g. the current file)
     * Returns a handle: { setFilter, move, pick, close, visible, activeEntry }
     */
    function open(opts) {
        opts = opts || {};
        ensurePop();
        close();

        popState = {
            mode: opts.mode === 'external' ? 'external' : 'input',
            onPick: opts.onPick || function () {},
            excludeIds: opts.excludeIds || [],
            query: opts.query || '',
            index: 0,
            entries: [],
            filtered: [],
            getData: opts.getData || getUnifiedDoc
        };
        pop.classList.add('active');
        render();
        position(opts.anchor);
        pop.classList.add('loading');

        Promise.resolve()
            .then(function () { return popState.getData(); })
            .then(function (data) {
                if (!popState) return;
                popState.entries = entries(data);
                applyFilter();
                pop.classList.remove('loading');
                position(opts.anchor);
            })
            .catch(function (err) {
                if (!popState) return;
                pop.classList.remove('loading');
                pop.replaceChildren(emptyDiv(err.message || 'Failed to load files'));
                position(opts.anchor);
            });

        return {
            setFilter: function (q) { setFilter(q); },
            move: function (delta) { move(delta); },
            pick: function () { return pickIndex(popState ? popState.index : -1); },
            close: function () { close(); },
            reposition: function (anchor) { if (pop && popState) position(anchor); },
            visible: function () { return !!popState; },
            activeEntry: function () {
                return popState && popState.filtered[popState.index] || null;
            }
        };
    }

    function applyFilter() {
        if (!popState) return;
        popState.filtered = filterEntries(popState.entries, popState.query, popState.excludeIds);
        if (popState.index >= popState.filtered.length) popState.index = 0;
        render();
    }

    function setFilter(q) {
        if (!popState) return;
        popState.query = q || '';
        popState.index = 0;
        if (popState.entries.length) {
            applyFilter();
        } else if (popState.getData) {
            // External mode may filter before the doc fetch resolves
        }
    }

    function move(delta) {
        if (!popState || !popState.filtered.length) return;
        var count = popState.filtered.length;
        popState.index = (popState.index + delta + count) % count;
        render();
    }

    function pickIndex(index) {
        if (!popState || index < 0 || index >= popState.filtered.length) return false;
        var entry = popState.filtered[index];
        var onPick = popState.onPick;
        close();
        onPick(entry);
        return true;
    }

    function onKeydown(e) {
        if (!popState) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); pickIndex(popState.index); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
    }

    function close() {
        popState = null;
        if (pop) {
            pop.classList.remove('active', 'loading');
            pop.innerHTML = '';
        }
    }

    // ================================================
    // "@" typing trigger (shared by the apps)
    // ================================================
    function caretRect(ta) {
        var cs = window.getComputedStyle(ta);
        var div = document.createElement('div');
        var style = div.style;
        style.position = 'absolute';
        style.visibility = 'hidden';
        style.whiteSpace = ta.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre';
        style.wordWrap = 'break-word';
        style.font = cs.font;
        style.letterSpacing = cs.letterSpacing;
        style.tabSize = cs.tabSize;
        style.textIndent = cs.textIndent;
        style.padding = cs.padding;
        style.border = cs.border;
        style.boxSizing = cs.boxSizing;
        style.width = ta.clientWidth + 'px';
        style.lineHeight = cs.lineHeight;

        div.textContent = ta.value.slice(0, ta.selectionStart);
        var sentinel = document.createElement('span');
        // The rest of the text starts exactly at the caret.
        sentinel.textContent = ta.value.slice(ta.selectionStart) || '.';
        div.appendChild(sentinel);
        document.body.appendChild(div);

        var box = ta.getBoundingClientRect();
        var fontSize = parseFloat(cs.fontSize) || 14;
        var lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5;
        var left = box.left + (sentinel.offsetLeft - ta.scrollLeft);
        var top = box.top + (sentinel.offsetTop - ta.scrollTop);
        document.body.removeChild(div);

        return { left: left, right: left, top: top - fontSize, bottom: top + lineHeight * 0.4 };
    }


    function mentionAt(text, caret) {
        var end = (caret == null || caret > text.length) ? text.length : caret;
        var before = text.slice(Math.max(0, end - 200), end);
        var m = /(?:^|\s)@([^\s@]*)$/.exec(before);
        if (!m) return null;
        return { from: end - m[1].length - 1, to: end, query: m[1] };
    }

    function createMentionSession(opts) {
        var handle = null;
        var range = null;
        var dismissedQuery = null;

        function close(dismiss) {
            if (handle) {
                handle.close();
                handle = null;
            }
            if (dismiss && range) {
                // Stay closed until the query text changes (Escape / outside
                // click), otherwise the next sync instantly reopens.
                dismissedQuery = range.query;
            }
            range = null;
        }

        function sync() {
            if (opts.isActive && !opts.isActive()) { close(false); return; }
            var text = opts.getText();
            var hit = mentionAt(text, opts.getCaret ? opts.getCaret() : null);
            if (!hit) { close(false); return; }
            if (dismissedQuery === hit.query) return;
            dismissedQuery = null;
            range = hit;
            var anchor = opts.getAnchor ? opts.getAnchor(hit) : null;
            if (handle && handle.visible()) {
                if (hit.query !== (handle.lastQuery || '')) {
                    handle.lastQuery = hit.query;
                    handle.setFilter(hit.query);
                }
                handle.reposition(anchor);
            } else {
                handle = open({
                    anchor: anchor,
                    mode: 'external',
                    query: hit.query,
                    excludeIds: (opts.excludeIds && opts.excludeIds()) || [],
                    onPick: function (entry) {
                        var r = range;
                        handle = null;
                        range = null;
                        dismissedQuery = '';
                        opts.onPick(entry, r);
                    }
                });
            }
        }

        /** Consume a keydown while the picker is open. Returns true when eaten. */
        function keydown(e) {
            if (e.ctrlKey || e.metaKey || e.altKey) return false;
            if (!handle || !handle.visible()) return false;
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); handle.move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); handle.move(-1); }
            else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); handle.pick(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(true); }
            else return false;
            return true;
        }

        document.addEventListener('mousedown', function (e) {
            if (!handle || !handle.visible()) return;
            var pop = document.querySelector('.wdm-pop');
            if (!pop || !pop.contains(e.target)) close(true);
        }, true);

        return {
            sync: sync,
            keydown: keydown,
            close: close,
            isActive: function () { return !!(handle && handle.visible()); },
            getRange: function () { return range; }
        };
    }

    function attachTextareaTrigger(el, opts) {
        opts = opts || {};
        var session = createMentionSession({
            isActive: opts.isActive,
            excludeIds: opts.excludeIds,
            getText: function () { return el.value; },
            getCaret: function () { return typeof el.selectionStart === 'number' ? el.selectionStart : null; },
            getAnchor: function () { return caretRect(el); },
            onPick: function (entry, range) {
                if (opts.onPick) { opts.onPick(entry, range, el); return; }
                var hit = mentionAt(el.value, el.selectionStart) || range;
                var format = opts.format || function (e2) { return mentionMarkdown(e2.app, e2.id, e2.name); };
                var text = format(entry, hit);
                el.value = el.value.slice(0, hit.from) + text + el.value.slice(hit.to);
                var caret = hit.from + text.length;
                el.setSelectionRange(caret, caret);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.focus();
            }
        });
        var onKey = function (e) { session.keydown(e); };
        var onSync = function () { session.sync(); };
        el.addEventListener('keydown', onKey, true);
        el.addEventListener('input', onSync);
        el.addEventListener('click', onSync);
        el.addEventListener('keyup', onSync);
        return function detach() {
            el.removeEventListener('keydown', onKey, true);
            el.removeEventListener('input', onSync);
            el.removeEventListener('click', onSync);
            el.removeEventListener('keyup', onSync);
            session.close(false);
        };
    }

    // ================================================
    // References
    // ================================================

    /** Markdown form of a mention: [@Name](/sheets/<id>). */
    function mentionMarkdown(appId, fileId, label) {
        var clean = String(label || '').replace(/[\[\]\n]/g, '').trim() || 'Untitled';
        return '[@' + clean + '](' + WDLinks.url(appId, fileId) + ')';
    }

    /**
     * Resolve a mention target (a path like '/sheets/<id>' or {app, id})
     * against the unified doc. Returns
     * { app, id, name, url, kind, missing } — name is null when the target
     * no longer exists.
     */
    function resolveRef(target, userData) {
        var ref = typeof target === 'string' ? (WDLinks.parseHref(target) || WDLinks.parsePath(target)) : target;
        if (!ref || !ref.id) return null;
        var hit = WDLinks.resolve(ref.id, userData);
        if (hit) {
            return { app: hit.app, id: hit.id, name: hit.name, kind: hit.kind,
                url: hit.url, missing: false };
        }
        return {
            app: ref.app || 'filebox',
            id: ref.id,
            name: null,
            kind: ref.kind || 'file',
            url: WDLinks.url(ref.app || 'filebox', ref.id),
            missing: true
        };
    }

    function escapeRegExp(text) {
        return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

  
    function findBacklinks(targetId, userData) {
        if (!userData || !WDLinks.ID_RE.test(targetId || '')) return [];
        var targetRe = new RegExp('/(?:docs|sheets|forms|slides|draw|todo|filebox)/' + escapeRegExp(targetId) + '(?![a-z0-9])');
        var out = [];
        var seen = {};
        function push(app, id, name) {
            if (seen[app + ':' + id]) return;
            seen[app + ':' + id] = true;
            out.push({ app: app, id: id, name: name || 'Untitled', url: WDLinks.url(app, id) });
        }

        (userData.docs || []).forEach(function (doc) {
            if (doc.id !== targetId && doc.content && targetRe.test(doc.content)) {
                push('docs', doc.id, doc.title);
            }
        });

        (userData.sheets || []).forEach(function (sheet) {
            if (sheet.id === targetId) return;
            var hit = false;
            var worksheets = (sheet.data && sheet.data.sheets) || {};
            Object.keys(worksheets).forEach(function (wsId) {
                if (hit) return;
                var cellData = (worksheets[wsId] && worksheets[wsId].cellData) || {};
                Object.keys(cellData).some(function (row) {
                    return Object.keys(cellData[row]).some(function (col) {
                        var cell = cellData[row][col];
                        if (!cell) return false;
                        var link = cell.hyperlink && (typeof cell.hyperlink === 'string' ? cell.hyperlink : cell.hyperlink.url);
                        if (link && targetRe.test(link)) return (hit = true);
                        if (cell.p && cell.p.body && cell.p.body.customRanges) {
                            cell.p.body.customRanges.some(function (cr) {
                                var u = cr && cr.properties && cr.properties.url;
                                if (u && targetRe.test(u)) return (hit = true);
                                return false;
                            });
                        }
                        if (hit) return true;
                        if (cell.p && cell.p.dataStream && targetRe.test(cell.p.dataStream)) return (hit = true);
                        return false;
                    });
                });
            });
            if (hit) push('sheets', sheet.id, sheet.name);
        });

        function objectsMention(objects) {
            return (objects || []).some(function (obj) {
                return obj && obj.wdRef && obj.wdRef.id === targetId;
            });
        }
        (userData.draws || []).forEach(function (d) {
            if (d.id !== targetId && objectsMention(d.objects)) push('draw', d.id, d.name);
        });
        (userData.slides || []).forEach(function (deck) {
            if (deck.id === targetId) return;
            var hit = (deck.slides || []).some(function (slide) { return objectsMention(slide.objects); });
            if (hit) push('slides', deck.id, deck.name);
        });

        (userData.forms || []).forEach(function (form) {
            if (form.id === targetId) return;
            var hit = false;
            (function walk(components) {
                (components || []).forEach(function (comp) {
                    if (!comp) return;
                    ['content', 'description', 'label', 'text'].some(function (key) {
                        if (typeof comp[key] === 'string' && targetRe.test(comp[key])) return (hit = true);
                        return false;
                    });
                    if (comp.components) walk(comp.components);
                });
            })(form.components);
            if (hit) push('forms', form.id, form.name);
        });

        return out;
    }

    window.WDMentions = {
        getUnifiedDoc: getUnifiedDoc,
        invalidateDocCache: invalidateDocCache,
        entries: entries,
        open: open,
        close: close,
        mentionMarkdown: mentionMarkdown,
        resolveRef: resolveRef,
        findBacklinks: findBacklinks,
        caretRect: caretRect,
        mentionAt: mentionAt,
        createMentionSession: createMentionSession,
        attachTextareaTrigger: attachTextareaTrigger
    };
})();