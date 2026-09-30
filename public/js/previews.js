/**
 * WORKDECK - Card previews
 *
 * Live mini-renders of file content for grid cards:
 *   docs   -> markdown/plain text laid out on a virtual page, scaled to fit
 *   sheets -> editor canvas snapshot stored at save (mini-grid sketch fallback)
 *   forms  -> simplified component rows
 *   slides -> first slide rendered offscreen by fabric@6 in a sandboxed iframe
 *   draw   -> content-fit render by fabric@7 in a sandboxed iframe
 *
 * Canvas results are cached per file revision ("app:id:updatedAt"), so grid
 * re-renders (search, filter, reloads) reuse them until a file changes.
 */

(function () {
    'use strict';

    const VIRTUAL_WIDTH = { docs: 720, forms: 420 };
    const MAX_SHEET_COLS = 9;
    const MAX_SHEET_ROWS = 8;
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

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

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
        page.innerHTML = '<img class="wd-preview-img" alt="" src="' + dataUrl + '">';
    }

    // ================================================
    // Markdown (small subset, enough for a thumbnail)
    // ================================================

    function inlineMd(escaped) {
        return escaped
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '<span class="wd-md-link">$1</span>');
    }

    function markdownToHtml(md) {
        const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
        const out = [];
        let inCode = false;
        let codeBuf = [];
        let listMode = null;

        function closeList() {
            if (listMode) {
                out.push('</' + listMode + '>');
                listMode = null;
            }
        }

        lines.forEach(function (line) {
            if (/^\s*```/.test(line)) {
                if (inCode) {
                    out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
                    codeBuf = [];
                    inCode = false;
                } else {
                    closeList();
                    inCode = true;
                }
                return;
            }
            if (inCode) {
                codeBuf.push(escapeHtml(line));
                return;
            }
            const t = line.trim();
            if (!t) { closeList(); return; }
            const h = t.match(/^(#{1,6})\s+(.*)/);
            if (h) {
                closeList();
                const lvl = Math.min(h[1].length, 3);
                out.push('<h' + lvl + '>' + inlineMd(escapeHtml(h[2])) + '</h' + lvl + '>');
                return;
            }
            if (/^(-{3,}|\*{3,})$/.test(t)) { closeList(); out.push('<hr>'); return; }
            const q = t.match(/^>\s?(.*)/);
            if (q) {
                closeList();
                out.push('<blockquote>' + inlineMd(escapeHtml(q[1])) + '</blockquote>');
                return;
            }
            const ul = t.match(/^[-*+]\s+(.*)/);
            const ol = t.match(/^(\d+)[.)]\s+(.*)/);
            if (ul || ol) {
                const mode = ul ? 'ul' : 'ol';
                if (listMode !== mode) { closeList(); out.push('<' + mode + '>'); listMode = mode; }
                out.push('<li>' + inlineMd(escapeHtml(ul ? ul[1] : ol[2])) + '</li>');
                return;
            }
            closeList();
            out.push('<p>' + inlineMd(escapeHtml(t)) + '</p>');
        });

        if (inCode && codeBuf.length) out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
        closeList();
        return out.join('');
    }

    // ================================================
    // DOM previews (docs / forms)
    // ================================================

    function registerScaledPage(inner, virtualWidth) {
        scaledPages.push({ el: inner, w: virtualWidth });
        scalePage(inner, virtualWidth);
    }

    function scalePage(inner, virtualWidth) {
        const box = inner.parentElement;
        const boxW = (box && box.clientWidth) || 280;
        inner.style.transform = 'scale(' + (boxW / virtualWidth) + ')';
    }

    function markdownBody(content) {
        try {
            if (window.marked && typeof window.marked.parse === 'function') {
                return window.marked.parse(content)
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/\son\w+="[^"]*"/gi, '')
                    .replace(/\son\w+='[^']*'/gi, '');
            }
        } catch (err) { /* fall through */ }
        return markdownToHtml(content);
    }

    function renderDocs(page, file) {
        const raw = file.raw || {};
        const content = String(raw.content || '').trim();
        if (!content) return;

        const isMd = raw.contentType === 'markdown';
        const body = isMd ? markdownBody(content) : escapeHtml(content);
        page.innerHTML = '<div class="wd-preview-doc' + (isMd ? ' wd-preview-md' : ' wd-preview-plain') + '">'
            + body + '</div>';

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

    function formRowHtml(c) {
        const label = escapeHtml(String(c.label || c.title || c.content || '').replace(/<[^>]*>/g, ''));
        switch (c.type) {
            case 'header':
                return '<div class="wd-form-heading">' + label + '</div>';
            case 'paragraph':
                return '<div class="wd-form-text">' + label + '</div>';
            case 'button':
                return '<div class="wd-form-btn">' + (label || 'Submit') + '</div>';
            case 'checkbox':
            case 'radio':
                return '<div class="wd-form-check"><span class="wd-form-box"></span>' + label + '</div>';
            case 'select':
                return '<div class="wd-form-field"><div class="wd-form-label">' + label + '</div>'
                    + '<div class="wd-form-input wd-form-select">▾</div></div>';
            case 'textarea':
                return '<div class="wd-form-field"><div class="wd-form-label">' + label + '</div>'
                    + '<div class="wd-form-input wd-form-area"></div></div>';
            case 'hidden':
                return '';
            default:
                if (!label) return '';
                return '<div class="wd-form-field"><div class="wd-form-label">' + label + '</div>'
                    + '<div class="wd-form-input"></div></div>';
        }
    }

    function renderForms(page, file) {
        const components = (file.raw && file.raw.components) || [];
        const flat = [];
        flattenFormComponents(components, flat);
        const rows = flat.map(formRowHtml).filter(Boolean);
        if (!rows.length) return;
        page.innerHTML = '<div class="wd-preview-form">' + rows.join('') + '</div>';
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
        // Snapshot stored by the editor at save time; the sketch below
        // only covers files that haven't been re-saved since
        const thumb = file.raw && typeof file.raw.thumbnail === 'string' && file.raw.thumbnail;
        if (thumb) {
            setImage(page, thumb);
            return;
        }

        const info = extractSheetCells(file.raw);
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
        return '<!DOCTYPE html><html><head>'
            + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">'
            + '<script src="' + FABRIC_CDN[kind] + '"><\/script></head><body>'
            + '<script>\n'
            + 'async function render(job) {\n'
            + '  try { await document.fonts.load("400 20px Inter"); await document.fonts.load("700 20px Inter"); } catch (e) {}\n'
            + '  const el = document.createElement("canvas");\n'
            + '  if (job.kind === "slides") {\n'
            + '    const canvas = new fabric.StaticCanvas(el, { width: job.w, height: job.h });\n'
            + '    await canvas.loadFromJSON({ objects: job.objects || [] });\n'
            + '    canvas.backgroundColor = job.background || "#ffffff";\n'
            + '    canvas.renderAll();\n'
            + '    const multiplier = Math.max(0.3, Math.min(2, ((job.outW || 600) * (job.dpr || 1)) / job.w));\n'
            + '    return canvas.toDataURL({ format: "png", multiplier: multiplier });\n'
            + '  }\n'
            + '  const outW = job.outW || 300;\n'
            + '  const outH = Math.round(outW * 0.625);\n'
            + '  const canvas = new fabric.StaticCanvas(el, { width: outW, height: outH });\n'
            + '  await canvas.loadFromJSON({ objects: job.objects || [] });\n'
            + '  canvas.backgroundColor = job.background || "#ffffff";\n'
            + '  canvas.renderAll();\n'
            + '  const objs = canvas.getObjects();\n'
            + '  if (objs.length) {\n'
            + '    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;\n'
            + '    objs.forEach(function (o) {\n'
            + '      const r = o.getBoundingRect();\n'
            + '      minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);\n'
            + '      maxX = Math.max(maxX, r.left + r.width); maxY = Math.max(maxY, r.top + r.height);\n'
            + '    });\n'
            + '    const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1);\n'
            + '    const scale = Math.min((outW * 0.9) / bw, (outH * 0.9) / bh, 2);\n'
            + '    canvas.setViewportTransform([scale, 0, 0, scale,\n'
            + '      outW / 2 - (minX + bw / 2) * scale, outH / 2 - (minY + bh / 2) * scale]);\n'
            + '    canvas.renderAll();\n'
            + '  }\n'
            + '  return canvas.toDataURL({ format: "png", multiplier: Math.max(1, Math.min(3, job.dpr || 1)) });\n'
            + '}\n'
            + 'window.addEventListener("message", async function (e) {\n'
            + '  const data = e.data || {};\n'
            + '  if (!data.jobId) return;\n'
            + '  try {\n'
            + '    const dataUrl = await render(data.job);\n'
            + '    parent.postMessage({ jobId: data.jobId, dataUrl: dataUrl }, "*");\n'
            + '  } catch (err) {\n'
            + '    parent.postMessage({ jobId: data.jobId, error: String(err) }, "*");\n'
            + '  }\n'
            + '});\n'
            + 'parent.postMessage({ previewReady: true, kind: "' + kind + '" }, "*");\n'
            + '<\/script></body></html>';
    }

    function ensureFrame(kind) {
        if (frames[kind]) return frames[kind];
        frames[kind] = new Promise(function (resolve) {
            const frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-scripts');
            frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
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
        }
    }

    window.WDPreviews = { mount: mount };
})();