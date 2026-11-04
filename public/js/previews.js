/**
 * WORKDECK - Card previews
 *
 * Live mini-renders of file content for grid cards:
 *   docs   -> markdown/plain text laid out on a virtual page, scaled to fit
 *   sheets -> editor canvas snapshot stored at save (mini-grid sketch fallback)
 *   forms  -> simplified component rows
 *   slides -> first slide rendered offscreen by fabric@6 in a sandboxed iframe
 *   draw   -> content-fit render by fabric@7 in a sandboxed iframe
 *   kanban -> mini board: columns with header + stacked cards
 *   todo   -> checklist rows
 *   calendar -> snapshot of the app's current view, captured at save
 *
 * Canvas results are cached per file revision ("app:id:updatedAt"), so grid
 * re-renders (search, filter, reloads) reuse them until a file changes.
 */

(function () {
    'use strict';

    const VIRTUAL_WIDTH = { docs: 720, forms: 420, todo: 420, kanban: 640, blog: 720 };
    const MAX_SHEET_COLS = 9;
    const MAX_SHEET_ROWS = 8;
    const MAX_KANBAN_COLS = 4;
    const MAX_KANBAN_CARDS = 4;
    const KANBAN_PRIORITY = { high: '#dc2626', medium: '#b45309', low: '#15803d' };
    const CACHE_LIMIT = 300;
    const JOB_TIMEOUT = 10000;

    const FABRIC_CDN = {
        slides: 'https://cdn.jsdelivr.net/npm/fabric@6/dist/index.min.js',
        draw: 'https://cdn.jsdelivr.net/npm/fabric@7/dist/index.min.js'
    };

    const cache = new Map();      // revision key -> dataURL
    const inFlight = new Map();   // revision key -> Promise<dataURL|null>
    const scaledPages = [];       // DOM previews re-scaled on window resize
    const frames = {};            // app kind -> Promise<{win}|null>
    const pendingJobs = new Map();// jobId -> { resolve, timer }
    const jobQueue = [];
    let jobRunning = false;
    let jobSeq = 0;
    let resizeTimer = null;

    // ================================================
    // Small helpers
    // ================================================

    function pixelRatio() {
        return Math.min(window.devicePixelRatio || 1, 2);
    }

    function revisionKey(file) {
        return file.app + ':' + file.id + ':' + (file.updatedAt || '');
    }

    function rememberCache(key, value) {
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
        cache.set(key, value);
    }

    function setImage(page, dataUrl) {
        const img = document.createElement('img');
        img.className = 'wd-preview-img';
        img.alt = '';
        img.src = dataUrl;
        page.replaceChildren(img);
    }

    // Thumbnails live in their own storage record (thumbRef); inline only
    // on legacy records. Fetches are cached for the session.
    const thumbCache = new Map();   // record id -> Promise<dataUrl|null>

    function sessionHash() {
        try { return sessionStorage.getItem('wd_hash'); } catch (e) { return null; }
    }

    /** dataUrl | Promise<dataUrl|null> | null — sync when inline. */
    function thumbOf(record) {
        if (!record) return null;
        if (typeof record.thumbnail === 'string' && record.thumbnail) {
            return record.thumbnail;
        }
        if (!record.thumbRef) return null;
        const id = record.id;
        if (!thumbCache.has(id)) {
            const hash = sessionHash();
            if (!hash) return null;
            thumbCache.set(id,
                fetch('/api/users?' + new URLSearchParams({ hash: hash, thumbs: id }))
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (j) {
                        return (j && j.success && j.thumbnails && j.thumbnails[id]) || null;
                    })
                    .catch(function () { return null; }));
        }
        return thumbCache.get(id);
    }

    /** setImage with a Promise — skipped when the card has moved on. */
    function setThumbWhenReady(page, key, thumb) {
        thumb.then(function (dataUrl) {
            if (dataUrl && page.isConnected && page.dataset.fileKey === key) {
                setImage(page, dataUrl);
            }
        });
    }

    // ================================================
    // Markdown (small subset, enough for a thumbnail)
    // ================================================

    /** Inline `code`, **bold**, *em*, [link](url) — that precedence. */
    function appendInline(parent, text) {
        const re = /`([^`]+)`|\*\*([^*]+)\*\*|(^|\W)\*([^*\n]+)\*(?=\W|$)|\[([^\]]+)\]\([^)]*\)/g;
        let last = 0;
        let m;
        while ((m = re.exec(text))) {
            if (m.index > last) parent.append(text.slice(last, m.index));
            if (m[1] !== undefined) {
                const code = document.createElement('code');
                code.textContent = m[1];
                parent.append(code);
            } else if (m[2] !== undefined) {
                const strong = document.createElement('strong');
                strong.textContent = m[2];
                parent.append(strong);
            } else if (m[4] !== undefined) {
                if (m[3]) parent.append(m[3]);
                const em = document.createElement('em');
                em.textContent = m[4];
                parent.append(em);
            } else if (m[5] !== undefined) {
                const link = document.createElement('span');
                link.className = 'wd-md-link';
                link.textContent = m[5];
                parent.append(link);
            }
            last = re.lastIndex;
        }
        if (last < text.length) parent.append(text.slice(last));
    }

    function appendCodeBlock(frag, lines) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = lines.join('\n');
        pre.append(code);
        frag.append(pre);
    }

    function markdownToFragment(md) {
        const frag = document.createDocumentFragment();
        const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
        let inCode = false;
        let codeBuf = [];
        let listEl = null;

        lines.forEach(function (line) {
            if (/^\s*```/.test(line)) {
                if (inCode) {
                    appendCodeBlock(frag, codeBuf);
                    codeBuf = [];
                    inCode = false;
                } else {
                    listEl = null;
                    inCode = true;
                }
                return;
            }
            if (inCode) {
                codeBuf.push(line);
                return;
            }
            const t = line.trim();
            if (!t) { listEl = null; return; }
            const h = t.match(/^(#{1,6})\s+(.*)/);
            if (h) {
                listEl = null;
                const heading = document.createElement('h' + Math.min(h[1].length, 3));
                appendInline(heading, h[2]);
                frag.append(heading);
                return;
            }
            if (/^(-{3,}|\*{3,})$/.test(t)) { listEl = null; frag.append(document.createElement('hr')); return; }
            const q = t.match(/^>\s?(.*)/);
            if (q) {
                listEl = null;
                const quote = document.createElement('blockquote');
                appendInline(quote, q[1]);
                frag.append(quote);
                return;
            }
            const ul = t.match(/^[-*+]\s+(.*)/);
            const ol = t.match(/^(\d+)[.)]\s+(.*)/);
            if (ul || ol) {
                const mode = ul ? 'ul' : 'ol';
                if (!listEl || listEl.tagName.toLowerCase() !== mode) {
                    listEl = document.createElement(mode);
                    frag.append(listEl);
                }
                const li = document.createElement('li');
                appendInline(li, ul ? ul[1] : ol[2]);
                listEl.append(li);
                return;
            }
            listEl = null;
            const p = document.createElement('p');
            appendInline(p, t);
            frag.append(p);
        });

        if (inCode && codeBuf.length) appendCodeBlock(frag, codeBuf);
        return frag;
    }

    // ================================================
    // DOM previews (docs / forms)
    // ================================================

    function registerScaledPage(inner, virtualWidth) {
        scaledPages.push({ el: inner, w: virtualWidth });
        scalePage(inner, virtualWidth);
        // Cards mount before their grid append, so clientWidth is still 0
        // (fallback 280) — re-scale once connected.
        if (!inner.isConnected) {
            requestAnimationFrame(function () {
                if (inner.isConnected) scalePage(inner, virtualWidth);
            });
        }
    }

    function scalePage(inner, virtualWidth) {
        const box = inner.parentElement;
        const boxW = (box && box.clientWidth) || 280;
        inner.style.transform = 'scale(' + (boxW / virtualWidth) + ')';
    }

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
        } catch (err) { /* fall through */ }
        return markdownToFragment(content);
    }

    function renderDocs(page, file) {
        const raw = file.raw || {};
        const content = String(raw.content || '').trim();
        if (!content) return;

        const isMd = raw.contentType === 'markdown';
        const doc = document.createElement('div');
        doc.className = 'wd-preview-doc' + (isMd ? ' wd-preview-md' : ' wd-preview-plain');
        if (isMd) doc.append(markdownFragment(content));
        else doc.textContent = content;
        page.replaceChildren(doc);

        registerScaledPage(page.firstChild, VIRTUAL_WIDTH.docs);
    }

    function flattenFormComponents(components, out) {
        (components || []).some(function (c) {
            if (!c || out.length >= 8) return true;
            if (c.type === 'columns' && Array.isArray(c.columns)) {
                c.columns.forEach(function (col) { flattenFormComponents(col && col.components, out); });
                return false;
            }
            if (Array.isArray(c.components)) {
                flattenFormComponents(c.components, out);
                return false;
            }
            out.push(c);
            return false;
        });
    }

    function formEl(className, text) {
        const el = document.createElement('div');
        el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function appendFormRow(parent, c) {
        const label = String(c.label || c.title || c.content || '').replace(/<[^>]*>/g, '');
        switch (c.type) {
            case 'header':
                parent.append(formEl('wd-form-heading', label));
                return;
            case 'paragraph':
                parent.append(formEl('wd-form-text', label));
                return;
            case 'button':
                parent.append(formEl('wd-form-btn', label || 'Submit'));
                return;
            case 'checkbox':
            case 'radio': {
                const check = formEl('wd-form-check');
                check.append(formEl('wd-form-box'), label);
                parent.append(check);
                return;
            }
            case 'select': {
                const field = formEl('wd-form-field');
                field.append(formEl('wd-form-label', label), formEl('wd-form-input wd-form-select', '▾'));
                parent.append(field);
                return;
            }
            case 'textarea': {
                const field = formEl('wd-form-field');
                field.append(formEl('wd-form-label', label), formEl('wd-form-input wd-form-area'));
                parent.append(field);
                return;
            }
            case 'hidden':
                return;
            default: {
                if (!label) return;
                const field = formEl('wd-form-field');
                field.append(formEl('wd-form-label', label), formEl('wd-form-input'));
                parent.append(field);
            }
        }
    }

    function renderForms(page, file) {
        const components = (file.raw && file.raw.components) || [];
        const flat = [];
        flattenFormComponents(components, flat);
        if (!flat.length) return;
        const wrap = formEl('wd-preview-form');
        flat.forEach(function (c) { appendFormRow(wrap, c); });
        if (!wrap.children.length) return;
        page.replaceChildren(wrap);
        registerScaledPage(page.firstChild, VIRTUAL_WIDTH.forms);
    }

    // ================================================
    // Sheets preview (canvas mini-grid)
    // ================================================

    function extractSheetCells(raw) {
        const wb = raw && raw.data;
        const sheets = wb && wb.sheets;
        if (!sheets) return null;
        const firstId = (wb.sheetOrder && wb.sheetOrder[0]) || Object.keys(sheets)[0];
        const sheet = firstId && sheets[firstId];
        if (!sheet || !sheet.cellData) return null;

        let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
        Object.keys(sheet.cellData).forEach(function (r) {
            const ri = Number(r);
            const row = sheet.cellData[r];
            Object.keys(row).forEach(function (c) {
                const cell = row[c];
                if (!cell || cell.v === undefined || cell.v === '') return;
                const ci = Number(c);
                if (ri < minR) minR = ri;
                if (ci < minC) minC = ci;
                if (ri > maxR) maxR = ri;
                if (ci > maxC) maxC = ci;
            });
        });
        if (maxR < 0) return null;

        return {
            cells: sheet.cellData,
            startRow: minR,
            startCol: minC,
            rows: Math.min(maxR - minR + 1, MAX_SHEET_ROWS),
            cols: Math.min(maxC - minC + 1, MAX_SHEET_COLS)
        };
    }

    function colLabel(index) {
        let s = '';
        let n = index;
        while (n >= 0) {
            s = String.fromCharCode(65 + (n % 26)) + s;
            n = Math.floor(n / 26) - 1;
        }
        return s;
    }

    function renderSheets(page, file) {
        const raw = file.raw || {};
        const key = revisionKey(file);
        page.dataset.fileKey = key;

        // Snapshot stored by the editor at save time (own record since the
        // thumbnail split); the sketch below only covers legacy files with
        // neither thumb nor body.
        const thumb = thumbOf(raw);
        if (thumb && typeof thumb.then !== 'function') {
            setImage(page, thumb);
            return;
        }
        if (thumb) {
            setThumbWhenReady(page, key, thumb);
            return;
        }

        const info = extractSheetCells(raw);
        if (!info) return;

        const box = page.parentElement;
        const boxW = (box && box.clientWidth) || 280;
        const boxH = (box && box.clientHeight) || 175;
        const k = pixelRatio();

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(boxW * k);
        canvas.height = Math.round(boxH * k);
        canvas.className = 'wd-preview-img';
        page.innerHTML = '';
        page.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        ctx.scale(k, k);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, boxW, boxH);

        const headerW = 24;
        const headerH = 17;
        const gridW = boxW - headerW;
        const gridH = boxH - headerH;
        const colW = gridW / info.cols;
        const rowH = gridH / (info.rows + 1);

        ctx.font = '9px Inter, system-ui, sans-serif';

        // Header chrome: column letters + row numbers
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(0, 0, boxW, headerH);
        ctx.fillRect(0, 0, headerW, boxH);
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let c = 0; c < info.cols; c++) {
            ctx.fillText(colLabel(info.startCol + c), headerW + colW * (c + 0.5), headerH / 2 + 0.5);
        }
        for (let r = 0; r < info.rows; r++) {
            ctx.fillText(String(info.startRow + r + 1), headerW / 2, headerH + rowH * (r + 0.5) + 0.5);
        }

        // Cell values
        ctx.textAlign = 'left';
        ctx.fillStyle = '#374151';
        for (let r = 0; r < info.rows; r++) {
            const rowData = info.cells[String(info.startRow + r)] || {};
            for (let c = 0; c < info.cols; c++) {
                const cell = rowData[String(info.startCol + c)];
                if (!cell || cell.v === undefined || cell.v === '') continue;
                const maxW = colW - 8;
                let label = String(cell.v);
                while (label.length > 1 && ctx.measureText(label).width > maxW) {
                    label = label.slice(0, -2) + '…';
                }
                ctx.fillText(label, headerW + colW * c + 4, headerH + rowH * (r + 0.5) + 0.5, maxW);
            }
        }

        // Grid lines
        ctx.strokeStyle = '#e1e4ea';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let c = 0; c <= info.cols; c++) {
            const x = Math.round(headerW + colW * c) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, boxH);
        }
        for (let r = 0; r <= info.rows; r++) {
            const y = Math.round(headerH + rowH * r) + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(boxW, y);
        }
        ctx.moveTo(headerW + 0.5, 0);
        ctx.lineTo(headerW + 0.5, boxH);
        ctx.moveTo(0, headerH + 0.5);
        ctx.lineTo(boxW, headerH + 0.5);
        ctx.stroke();
    }

    // ================================================
    // Slides / Draw previews (fabric inside sandboxed iframes)
    // ================================================

    function frameSrcdoc(kind) {
        const doc = document.getElementById('wdPreviewFrameDoc').value;
        return doc
            .replace('__FABRIC_SRC__', FABRIC_CDN[kind])
            .replace('__KIND__', kind);
    }

    function ensureFrame(kind) {
        if (frames[kind]) return frames[kind];
        frames[kind] = new Promise(function (resolve) {
            const frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-scripts');
            frame.className = 'wd-sandbox-frame';
            let settled = false;

            const onMessage = function (e) {
                const d = e.data || {};
                if (d.previewReady && d.kind === kind) {
                    settled = true;
                    window.removeEventListener('message', onMessage);
                    resolve({ win: frame.contentWindow });
                }
            };
            window.addEventListener('message', onMessage);

            frame.srcdoc = frameSrcdoc(kind);
            document.body.appendChild(frame);

            setTimeout(function () {
                if (settled) return;
                window.removeEventListener('message', onMessage);
                frame.remove();
                frames[kind] = null; // let a later mount retry
                resolve(null);
            }, 12000);
        });
        return frames[kind];
    }

    window.addEventListener('message', function (e) {
        const d = e.data || {};
        if (!d.jobId || !pendingJobs.has(d.jobId)) return;
        const entry = pendingJobs.get(d.jobId);
        pendingJobs.delete(d.jobId);
        clearTimeout(entry.timer);
        entry.resolve(d.error ? null : (d.dataUrl || null));
        jobRunning = false;
        pumpJobs();
    });

    function pumpJobs() {
        if (jobRunning || !jobQueue.length) return;
        const job = jobQueue.shift();
        jobRunning = true;
        ensureFrame(job.kind).then(function (frame) {
            if (!frame) {
                job.resolve(null);
                jobRunning = false;
                pumpJobs();
                return;
            }
            const id = ++jobSeq;
            const timer = setTimeout(function () {
                if (pendingJobs.delete(id)) {
                    job.resolve(null);
                    jobRunning = false;
                    pumpJobs();
                }
            }, JOB_TIMEOUT);
            pendingJobs.set(id, { resolve: job.resolve, timer: timer });
            frame.win.postMessage({ jobId: id, job: job.payload }, '*');
        });
    }

    function renderInFrame(kind, payload) {
        return new Promise(function (resolve) {
            jobQueue.push({ kind: kind, payload: payload, resolve: resolve });
            pumpJobs();
        });
    }

    function renderFabric(page, file) {
        const raw = file.raw || {};
        const key = revisionKey(file);
        page.dataset.fileKey = key;

        const cached = cache.get(key);
        if (cached) {
            setImage(page, cached);
            return;
        }

        let pending = inFlight.get(key);
        if (!pending) {
            const box = page.parentElement;
            const outW = (box && box.clientWidth) || 300;
            let payload;
            if (file.app === 'slides') {
                const slide = raw.slides && raw.slides[0];
                if (!slide) return;
                payload = {
                    kind: 'slides',
                    objects: slide.objects || [],
                    background: slide.background || raw.background || '#ffffff',
                    w: raw.width || 960,
                    h: raw.height || 540,
                    outW: outW,
                    dpr: pixelRatio()
                };
            } else {
                if (!(raw.objects && raw.objects.length)) return;
                payload = {
                    kind: 'draw',
                    objects: raw.objects,
                    background: raw.background || '#ffffff',
                    outW: outW,
                    dpr: pixelRatio()
                };
            }

            pending = renderInFrame(file.app, payload).then(function (dataUrl) {
                inFlight.delete(key);
                if (dataUrl) rememberCache(key, dataUrl);
                return dataUrl;
            });
            inFlight.set(key, pending);
        }

        pending.then(function (dataUrl) {
            if (!dataUrl) return;
            if (!page.isConnected || page.dataset.fileKey !== key) return;
            setImage(page, dataUrl);
        });
    }

    // ================================================
    // Filebox previews 
    // ================================================

    function fileExtension(name) {
        const match = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
        return match ? match[1].toUpperCase() : 'FILE';
    }

    function renderFilebox(page, file) {
        const raw = file.raw || {};
        const key = revisionKey(file);
        page.dataset.fileKey = key;

        const thumb = thumbOf(raw);
        if (thumb && typeof thumb.then !== 'function') {
            setImage(page, thumb);
            return;
        }
        if (thumb) {
            setThumbWhenReady(page, key, thumb);
            return;
        }
        const tile = document.createElement('div');
        tile.className = 'wd-preview-filebox-tile';
        const ext = document.createElement('span');
        ext.className = 'wd-preview-filebox-ext';
        ext.textContent = fileExtension(raw.name || file.name);
        tile.append(ext);
        page.replaceChildren(tile);
    }

    // ================================================
    // Todo preview (checklist rows)
    // ================================================

    function renderTodo(page, file) {
        const items = (file.raw && file.raw.items) || [];
        if (!items.length) return;

        const wrap = document.createElement('div');
        wrap.className = 'wd-preview-todo';

        items.slice(0, 7).forEach(function (item) {
            if (!item) return;
            const row = document.createElement('div');
            row.className = 'wd-todo-row' + (item.completed ? ' wd-todo-done' : '');

            const box = document.createElement('span');
            box.className = 'wd-todo-box';
            row.append(box);

            const text = document.createElement('span');
            text.className = 'wd-todo-text';
            text.textContent = item.title || '';
            row.append(text);

            if (item.dueDate) {
                const badge = document.createElement('span');
                badge.className = 'wd-todo-badge';
                const d = new Date(item.dueDate + 'T00:00:00');
                badge.textContent = Number.isNaN(d.getTime())
                    ? item.dueDate
                    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                row.append(badge);
            }

            wrap.append(row);
        });

        page.replaceChildren(wrap);
        registerScaledPage(page.firstChild, VIRTUAL_WIDTH.todo);
    }

    // ================================================
    // Kanban preview (mini board)
    // ================================================

    function kanbanCard(parent, card) {
        const el = document.createElement('div');
        el.className = 'wd-kanban-card';
        if (card.color) {
            const strip = document.createElement('span');
            strip.className = 'wd-kanban-strip';
            strip.style.background = card.color;
            el.append(strip);
        }

        const title = document.createElement('div');
        title.className = 'wd-kanban-card-title';
        title.textContent = card.label || 'Untitled';
        el.append(title);

        const meta = document.createElement('div');
        meta.className = 'wd-kanban-card-meta';
        const dot = KANBAN_PRIORITY[card.priority];
        if (dot) {
            const pri = document.createElement('span');
            pri.className = 'wd-kanban-dot';
            pri.style.background = dot;
            meta.append(pri);
        }
        if (Array.isArray(card.checklist) && card.checklist.length) {
            const done = card.checklist.filter(function (i) { return i && i.done; }).length;
            meta.append(formEl('wd-kanban-check', done + '/' + card.checklist.length));
        }
        if (meta.children.length) el.append(meta);

        parent.append(el);
    }

    function renderKanban(page, file) {
        const board = file.raw || {};
        const columns = Array.isArray(board.columns) ? board.columns : [];
        if (!columns.length) return;
        const cards = Array.isArray(board.cards) ? board.cards : [];

        const wrap = document.createElement('div');
        wrap.className = 'wd-preview-kanban';

        columns.slice(0, MAX_KANBAN_COLS).forEach(function (col) {
            if (!col) return;
            const inCol = cards.filter(function (c) { return c && c.column === col.id; });

            const head = document.createElement('div');
            head.className = 'wd-kanban-col-head';
            head.append(
                formEl('wd-kanban-col-title', col.label || 'Untitled list'),
                formEl('wd-kanban-col-count', String(inCol.length))
            );

            const body = document.createElement('div');
            body.className = 'wd-kanban-cards';
            inCol.slice(0, MAX_KANBAN_CARDS).forEach(function (card) { kanbanCard(body, card); });
            if (!inCol.length) body.append(formEl('wd-kanban-empty'));

            const lane = document.createElement('div');
            lane.className = 'wd-kanban-col';
            lane.append(head, body);
            wrap.append(lane);
        });

        page.replaceChildren(wrap);
        registerScaledPage(page.firstChild, VIRTUAL_WIDTH.kanban);
    }

    // ================================================
    // Calendar preview (snapshot captured by the app at save)
    // ================================================

    function renderCalendar(page, file) {
        const thumb = file.raw && typeof file.raw.thumbnail === 'string' && file.raw.thumbnail;
        if (thumb) setImage(page, thumb);
    }

    // ================================================
    // Blog preview (derived excerpt on a virtual page — never renders the
    // post HTML, so a card can't load external images)
    // ================================================

    function renderBlog(page, file) {
        const raw = file.raw || {};
        const excerpt = String(raw.excerpt || '').trim();
        if (!excerpt) return;

        const doc = document.createElement('div');
        doc.className = 'wd-preview-doc wd-preview-plain';
        doc.textContent = excerpt;
        page.replaceChildren(doc);

        registerScaledPage(page.firstChild, VIRTUAL_WIDTH.blog);
    }

    // ================================================
    // Resize: keep DOM previews scaled to their card
    // ================================================

    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            scaledPages.forEach(function (entry) {
                if (entry.el.isConnected) scalePage(entry.el, entry.w);
            });
        }, 150);
    });

    // ================================================
    // Public entry point
    // ================================================

    /**
     * Fill a card's preview page with a mini-render of the file.
     * Leaves the skeleton in place for empty files / unsupported apps.
     */
    function mount(page, file) {
        if (!page || !file) return;
        switch (file.app) {
            case 'docs': renderDocs(page, file); break;
            case 'forms': renderForms(page, file); break;
            case 'sheets': renderSheets(page, file); break;
            case 'slides':
            case 'draw': renderFabric(page, file); break;
            case 'todo': renderTodo(page, file); break;
            case 'kanban': renderKanban(page, file); break;
            case 'blog': renderBlog(page, file); break;
            case 'calendar': renderCalendar(page, file); break;
            case 'filebox': renderFilebox(page, file); break;
        }
    }

    window.WDPreviews = { mount: mount };
})();