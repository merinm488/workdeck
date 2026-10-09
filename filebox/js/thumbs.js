/**
 * ================================================
 * FILEBOX - Thumbnails
 * ================================================
 *
 * fileboxThumbs — card previews, one generator per file kind:
 *
 *   image/*   browser-image-compression downscale (gif/svg: first frame)
 *   pdf       pdf.js first page
 *   docx      docx-preview page 1 -> html2canvas-pro snapshot
 *   pptx      pptx-preview first non-blank slide -> html2canvas-pro snapshot
 *   ppt       legacy binary: XLSX.CFB walk -> slide card (text + pictures)
 *   xlsx/xls  Univer render -> canvas composite
 *   csv       Papa Parse -> same Univer render
 *   md        marked -> sanitized HTML -> html2canvas-pro snapshot
 *   text/code first lines drawn on canvas
 *   video     <video> frame grab
 *   audio     WebAudio waveform
 *   else      cover tile — filename + extension drawn on canvas
 *
 * Nothing returns null: a generator that fails (or a kind with no
 * renderer) falls back to the cover tile, so every card gets an image.
 * Univer, html2canvas-pro and pptx-preview are lazy-loaded from the CDN
 * on first use (heavy, only some files need them); the rest ship on the
 * page already (see index.html). Their download time is excluded from
 * the per-file generation timeout.
 *
 * Two entry points:
 *   forCard(blob, meta)          -> { url, cover, ver }         (upload time)
 *   ensureMissing(files, hooks)  -> backfill sweep: generates + persists
 *                                   thumbnails for records that predate
 *                                   this module, upgrades persisted cover
 *                                   tiles when a real render now works,
 *                                   and re-renders pre-versioning thumbs
 *                                   (thumbVer < THUMB_VERSION). Strictly
 *                                   sequential PUTs, paused while uploads
 *                                   run (both sides read-modify-write the
 *                                   doc).
 */

(function () {
    'use strict';

    var THUMB_WIDTH = 480;
    var THUMB_MAX_HEIGHT = 640;
    var QUALITY_STEPS = [0.72, 0.5, 0.35];
    var MAX_CHARS = 60000;         // api/filebox.js cap
    var JOB_TIMEOUT = 8000;
    var THUMB_VERSION = 2;         // bump to re-render every card once

    var CDN = {
        snap: 'https://cdn.jsdelivr.net/npm/html2canvas-pro@1.5.11/dist/html2canvas-pro.min.js',
        pptx: 'https://cdn.jsdelivr.net/npm/pptx-preview@1.0.7/dist/pptx-preview.umd.js',
        zip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
    };

    var UNIVER_CSS = ['https://unpkg.com/@univerjs/preset-sheets-core@0.25.1/lib/index.css'];
    var UNIVER_SCRIPTS = [
        'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
        'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
        'https://unpkg.com/rxjs@7.8.1/dist/bundles/rxjs.umd.min.js',
        'https://unpkg.com/@univerjs/presets@0.25.1/lib/umd/index.js',
        'https://unpkg.com/@univerjs/preset-sheets-core@0.25.1/lib/umd/index.js',
        'https://unpkg.com/@univerjs/preset-sheets-core@0.25.1/lib/umd/locales/en-US.js'
    ];

    // ================================================
    // Kind detection (mirrors viewer.js)
    // ================================================

    var CODE_LANGS = {
        js: 1, ts: 1, json: 1, jsonl: 1, ndjson: 1, html: 1, css: 1, py: 1,
        xml: 1, sh: 1, yml: 1, yaml: 1, java: 1, c: 1, cpp: 1, rb: 1, go: 1,
        rs: 1, log: 1
    };

    function extOf(name) {
        var match = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
        return match ? match[1].toLowerCase() : '';
    }

    function kindOf(name, mime) {
        mime = mime || '';
        var ext = extOf(name);
        if (mime.indexOf('image/') === 0) return 'image';
        if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
        if (ext === 'docx') return 'docx';
        if (ext === 'pptx' || mime.indexOf('presentation') >= 0) return 'pptx';
        if (ext === 'ppt' || mime === 'application/vnd.ms-powerpoint') return 'ppt';
        if (ext === 'xls' || ext === 'xlsx' || mime.indexOf('spreadsheet') >= 0) return 'xlsx';
        if (ext === 'csv' || mime === 'text/csv') return 'csv';
        if (ext === 'md' || ext === 'markdown') return 'md';
        if (mime.indexOf('video/') === 0 || ['mp4', 'mov', 'avi', 'mkv', 'webm'].indexOf(ext) >= 0) return 'video';
        if (mime.indexOf('audio/') === 0 || ['mp3', 'wav', 'm4a', 'aac', 'ogg'].indexOf(ext) >= 0) return 'audio';
        if (CODE_LANGS[ext]) return 'text';
        if (mime.indexOf('text/') === 0 || ext === 'txt') return 'text';
        return 'unknown';
    }

    function isGeneratable(file) {
        return Boolean(GENERATORS[kindOf(file && file.name, file && file.mime)]);
    }

    // ================================================
    // Small helpers
    // ================================================

    function blobToDataUrl(blob, withPrefix) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('Could not read file')); };
            reader.onload = function () {
                var url = String(reader.result || '');
                resolve(withPrefix ? url : url.slice(url.indexOf(',') + 1));
            };
            reader.readAsDataURL(blob);
        });
    }

    function canvasToJpeg(canvas) {
        var work = canvas;
        for (var guard = 0; guard < 8; guard++) {
            for (var i = 0; i < QUALITY_STEPS.length; i++) {
                var url = work.toDataURL('image/jpeg', QUALITY_STEPS[i]);
                // a zero-size canvas yields "data:," — junk, not a thumbnail
                if (url.length > 64 && url.length <= MAX_CHARS) return url;
            }
            if (work.height > THUMB_MAX_HEIGHT) {
                var cropped = document.createElement('canvas');
                cropped.width = work.width;
                cropped.height = THUMB_MAX_HEIGHT;
                cropped.getContext('2d').drawImage(work, 0, 0);   // keep the top
                work = cropped;
            } else if (work.width > 240) {
                var shrunk = document.createElement('canvas');
                shrunk.width = Math.round(work.width / 2);
                shrunk.height = Math.round(work.height / 2);
                shrunk.getContext('2d').drawImage(work, 0, 0, shrunk.width, shrunk.height);
                work = shrunk;
            } else {
                return null;
            }
        }
        return null;
    }

    function pixelRatio() {
        return Math.min(window.devicePixelRatio || 1, 2);
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () { reject(new Error('Thumbnail timed out')); }, ms);
            promise.then(function (v) { clearTimeout(timer); resolve(v); },
                function (e) { clearTimeout(timer); reject(e); });
        });
    }

    /** Detached-but-laid-out container for library renders. */
    function offstage(cssWidth, cssHeight) {
        var el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + cssWidth + 'px;'
            + (cssHeight ? 'height:' + cssHeight + 'px;' : '')
            + 'background:#ffffff;overflow:hidden;';
        document.body.appendChild(el);
        return el;
    }

    var scriptPromises = {};
    function loadScript(url, label) {
        if (!scriptPromises[url]) {
            scriptPromises[url] = new Promise(function (resolve, reject) {
                var tag = document.createElement('script');
                tag.src = url;
                tag.onload = resolve;
                tag.onerror = function () {
                    delete scriptPromises[url];
                    reject(new Error(label + ' failed to load'));
                };
                document.head.appendChild(tag);
            });
        }
        return scriptPromises[url];
    }

    var stylePromises = {};
    function loadStyle(url) {
        if (!stylePromises[url]) {
            stylePromises[url] = new Promise(function (resolve) {
                var tag = document.createElement('link');
                tag.rel = 'stylesheet';
                tag.href = url;
                tag.onload = resolve;
                tag.onerror = resolve;   // canvas render works without CSS too
                document.head.appendChild(tag);
            });
        }
        return stylePromises[url];
    }

    /** Heavy CDN libs download outside the generation timeout. */
    async function preloadFor(kind) {
        try {
            if (kind === 'docx' || kind === 'md' || kind === 'pptx' || kind === 'ppt') {
                await loadScript(CDN.snap, 'html2canvas-pro');
            }
            if (kind === 'pptx') await loadScript(CDN.pptx, 'pptx-preview');
        } catch (err) { /* generator degrades */ }
    }

    async function snapCanvas(el, outWidth) {
        var box = el.getBoundingClientRect();
        if (!box.width || !box.height) return null;
        return window.html2canvas(el, {
            scale: Math.min(outWidth / box.width, 2),
            backgroundColor: '#ffffff',
            useCORS: true,
            logging: false
        });
    }

    async function snapElement(el, outWidth) {
        var canvas = await snapCanvas(el, outWidth);
        return canvas ? canvasToJpeg(canvas) : null;
    }

    /** Fraction of sampled pixels that are (near-)white — catches empty renders. */
    function canvasIsBlank(canvas) {
        if (!canvas.width || !canvas.height) return true;
        var d;
        try {
            d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        } catch (err) {
            return false;   // tainted canvas — assume it painted
        }
        var white = 0, total = 0;
        for (var i = 0; i < d.length; i += 64) {   // every 16th pixel
            total++;
            if (d[i] > 247 && d[i + 1] > 247 && d[i + 2] > 247) white++;
        }
        return total > 0 && white / total > 0.995;
    }

    // ================================================
    // image (gif/svg draw their first frame like any bitmap)
    // ================================================

    function drawImageThumb(blob) {
        return new Promise(function (resolve) {
            var url = URL.createObjectURL(blob);
            var img = new Image();
            img.onload = function () {
                try {
                    var scale = Math.min(THUMB_WIDTH / (img.naturalWidth || THUMB_WIDTH), 2);
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.round((img.naturalWidth || THUMB_WIDTH) * scale);
                    canvas.height = Math.round((img.naturalHeight || 300) * scale);
                    var ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';   // transparency reads black in JPEG
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvasToJpeg(canvas));   // taints -> null -> cover tile
                } catch (err) {
                    resolve(null);
                } finally {
                    URL.revokeObjectURL(url);
                }
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                resolve(null);
            };
            img.src = url;
        });
    }

    async function genImage(blob, meta) {
        if (meta.mime === 'image/gif' || meta.mime === 'image/svg+xml') {
            return drawImageThumb(blob);
        }
        if (!window.imageCompression) return null;
        var out = await window.imageCompression(blob, {
            maxWidthOrHeight: THUMB_WIDTH,
            initialQuality: 0.72,
            fileType: 'image/jpeg'
        });
        var url = await blobToDataUrl(out, true);
        return url.length <= MAX_CHARS ? url : null;
    }

    // ================================================
    // pdf (teardown via loadingTask)
    // ================================================

    async function genPdf(blob) {
        if (!window.pdfjsLib) return null;
        var task = pdfjsLib.getDocument({ data: await blob.arrayBuffer() });
        var pdf = await task.promise;
        try {
            var page = await pdf.getPage(1);
            var base = page.getViewport({ scale: 1 });
            var viewport = page.getViewport({ scale: Math.min(THUMB_WIDTH / base.width, 2) });
            var canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            return canvasToJpeg(canvas);
        } finally {
            try { task.destroy(); } catch (err) { /* already gone */ }
        }
    }

    // ================================================
    // docx / md — DOM renders snapshotted with html2canvas-pro
    // (md typography lives in styles.css under .fb-thumb-md)
    // ================================================

    async function genDocx(blob) {
        if (!window.docx) return null;
        var stage = offstage(794);
        try {
            await window.docx.renderAsync(await blob.arrayBuffer(), stage, null, { inWrapper: true });
            var page = stage.querySelector('.docx-wrapper > section.docx') || stage.firstElementChild;
            if (!page) return null;
            page.style.boxShadow = 'none';
            page.style.margin = '0';
            var wrapper = stage.querySelector('.docx-wrapper');
            if (wrapper) wrapper.style.background = 'none';
            return await snapElement(page, THUMB_WIDTH);
        } finally {
            stage.remove();
        }
    }

    async function genMd(blob) {
        var text = await blob.text();
        if (window.marked && window.DOMPurify) {
            try {
                var stage = offstage(720, 560);
                try {
                    var article = document.createElement('article');
                    article.className = 'fb-thumb-md';
                    article.innerHTML = window.DOMPurify.sanitize(
                        window.marked.parse(text), { USE_PROFILES: { html: true } });
                    stage.appendChild(article);
                    return await snapElement(stage, THUMB_WIDTH);
                } finally {
                    stage.remove();
                }
            } catch (err) { /* fall through to plain text */ }
        }
        return drawTextThumb(text);
    }

    // ================================================
    // xlsx / csv — Univer render + canvas composite
    // ================================================

    async function ensureUniver() {
        if (window.UniverPresets && window.UniverCore && window.UniverPresetSheetsCore) return;
        UNIVER_CSS.forEach(loadStyle);
        for (var i = 0; i < UNIVER_SCRIPTS.length; i++) {
            await loadScript(UNIVER_SCRIPTS[i], 'univer');
        }
    }

    function sheetSnapshotFromAoa(aoa, sheetName) {
        var cellData = {};
        var maxCols = 0;
        aoa.forEach(function (row, r) {
            if (!row) return;
            var rowMap = {};
            row.forEach(function (val, c) {
                if (val === null || val === undefined || val === '') return;
                rowMap[c] = { v: val };
                if (c + 1 > maxCols) maxCols = c + 1;
            });
            if (Object.keys(rowMap).length) cellData[r] = rowMap;
        });
        var sheetId = 's1';
        return {
            id: 'fb_thumb_wb',
            name: String(sheetName || 'Sheet1'),
            appVersion: '0.25.1',
            locale: 'enUS',
            styles: {},
            sheetOrder: [sheetId],
            sheets: {
                s1: {
                    id: sheetId,
                    name: String(sheetName || 'Sheet1'),
                    tabColor: '',
                    hidden: 0,
                    freeze: { xOffset: 0, yOffset: 0, startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
                    rowCount: Math.max(aoa.length + 10, 60),
                    columnCount: Math.max(maxCols + 5, 26),
                    zoomRatio: 1,
                    scrollTop: 0,
                    scrollLeft: 0,
                    defaultColumnWidth: 73,
                    defaultRowHeight: 19,
                    mergeData: [],
                    cellData: cellData,
                    rowData: {},
                    columnData: {},
                    rowHeader: { width: 46 },
                    columnHeader: { height: 20 },
                    rightToLeft: 0
                }
            }
        };
    }

    /** Composite Univer's render canvases (cf. Sheets captureThumbnail). */
    function captureUniverCanvas(stage) {
        var stageRect = stage.getBoundingClientRect();
        var canvases = Array.from(stage.querySelectorAll('canvas[data-u-comp="render-canvas"]'));
        if (!canvases.length) canvases = Array.from(stage.querySelectorAll('canvas'));

        var rects = new Map();
        var largest = 0;
        canvases = canvases.filter(function (c) {
            if (!c.width || !c.height) return false;
            var rect = c.getBoundingClientRect();
            rects.set(c, rect);
            largest = Math.max(largest, rect.width * rect.height);
            return true;
        });
        if (!canvases.length || !largest) return null;

        var layers = canvases.filter(function (c) {
            var r = rects.get(c);
            return r.width * r.height >= largest * 0.1;
        });

        var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        layers.forEach(function (c) {
            var r = rects.get(c);
            left = Math.min(left, r.left - stageRect.left);
            top = Math.min(top, r.top - stageRect.top);
            right = Math.max(right, r.right - stageRect.left);
            bottom = Math.max(bottom, r.bottom - stageRect.top);
        });
        var unionW = right - left, unionH = bottom - top;
        if (unionW <= 0 || unionH <= 0) return null;

        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var composite = document.createElement('canvas');
        composite.width = Math.round(unionW * dpr);
        composite.height = Math.round(unionH * dpr);
        var ctx = composite.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, composite.width, composite.height);
        layers.forEach(function (c) {
            var r = rects.get(c);
            ctx.drawImage(c, Math.round((r.left - stageRect.left - left) * dpr),
                Math.round((r.top - stageRect.top - top) * dpr),
                Math.round(r.width * dpr), Math.round(r.height * dpr));
        });

        var scale = Math.min(THUMB_WIDTH / composite.width, 2);
        var out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(composite.width * scale));
        out.height = Math.max(1, Math.round(composite.height * scale));
        out.getContext('2d').drawImage(composite, 0, 0, out.width, out.height);
        return canvasToJpeg(out);
    }

    function waitForUniverRender(stage) {
        return new Promise(function (resolve, reject) {
            var tries = 0;
            (function poll() {
                var canvas = stage.querySelector('canvas');
                if (canvas && canvas.width > 0) { resolve(); return; }
                if (++tries > 50) { reject(new Error('Univer did not render')); return; }
                setTimeout(poll, 100);
            })();
        });
    }

    async function renderInUniver(snapshot) {
        await ensureUniver();
        var stage = offstage(1000, 560);
        var seq = document.querySelectorAll('[data-fb-univer]').length + 1;
        stage.setAttribute('data-fb-univer', String(seq));
        var univerAPI = null;
        try {
            var create = window.UniverPresets.createUniver;
            var core = window.UniverCore;
            var preset = window.UniverPresetSheetsCore;
            var made = create({
                locale: core.LocaleType.EN_US,
                locales: { enUS: core.mergeLocales(window.UniverPresetSheetsCoreEnUS) },
                presets: [preset.UniverSheetsCorePreset({ container: stage })]
            });
            univerAPI = made.univerAPI;
            univerAPI.createWorkbook(snapshot);
            await waitForUniverRender(stage);
            await new Promise(function (r) { setTimeout(r, 400); });   // paint settle
            return captureUniverCanvas(stage);
        } finally {
            if (univerAPI) { try { univerAPI.dispose(); } catch (err) { /* gone */ } }
            stage.remove();
        }
    }

    async function genSheet(blob, meta) {
        var aoa = null, sheetName = 'Sheet1';
        var ext = extOf(meta.name);
        if (ext === 'csv' || meta.mime === 'text/csv') {
            if (!window.Papa) return null;
            aoa = window.Papa.parse((await blob.text()).trim(), { skipEmptyLines: true }).data || [];
        } else {
            if (!window.XLSX) return null;
            var book = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
            if (!book.SheetNames.length) return null;
            sheetName = book.SheetNames[0];
            aoa = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: true, defval: null });
        }
        if (!aoa.length) return null;
        try {
            var snap = await renderInUniver(sheetSnapshotFromAoa(aoa, sheetName));
            if (snap) return snap;
        } catch (err) { /* fall back to the sketch */ }
        return drawSheetThumb(aoa.map(function (row) {
            return (row || []).map(function (v) { return v == null ? '' : String(v); });
        }), 0, 0);
    }

    // ================================================
    // xlsx / csv fallback sketch (no Univer)
    // ================================================

    /** rows: array of string arrays, windowed to the top-left used block. */
    function drawSheetThumb(rows, startCol, startRow) {
        while (rows.length && rows[0].every(function (c) { return c === '' || c == null; })) {
            rows = rows.slice(1);
            startRow++;
        }
        if (!rows.length) return null;

        var maxCols = 0;
        rows.slice(0, 8).forEach(function (row) {
            maxCols = Math.max(maxCols, row.length);
        });
        var cols = Math.min(maxCols, 9);
        if (!cols) return null;

        var k = pixelRatio();
        var boxW = 480, boxH = 300;
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(boxW * k);
        canvas.height = Math.round(boxH * k);
        var ctx = canvas.getContext('2d');
        ctx.scale(k, k);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, boxW, boxH);

        var headerW = 24, headerH = 17;
        var colW = (boxW - headerW) / cols;
        var rowH = (boxH - headerH) / (Math.min(rows.length, 8) + 1);
        ctx.font = '9px Inter, system-ui, sans-serif';

        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(0, 0, boxW, headerH);
        ctx.fillRect(0, 0, headerW, boxH);
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        function colLabel(index) {
            var s = '', n = index;
            while (n >= 0) {
                s = String.fromCharCode(65 + (n % 26)) + s;
                n = Math.floor(n / 26) - 1;
            }
            return s;
        }
        for (var c = 0; c < cols; c++) {
            ctx.fillText(colLabel(startCol + c), headerW + colW * (c + 0.5), headerH / 2 + 0.5);
        }
        for (var r = 0; r < Math.min(rows.length, 8); r++) {
            ctx.fillText(String(startRow + r + 1), headerW / 2, headerH + rowH * (r + 0.5) + 0.5);
        }

        ctx.textAlign = 'left';
        ctx.fillStyle = '#374151';
        for (r = 0; r < Math.min(rows.length, 8); r++) {
            var row = rows[r];
            for (c = 0; c < cols; c++) {
                var value = row[c];
                if (value == null || value === '') continue;
                var label = String(value);
                var maxW = colW - 8;
                while (label.length > 1 && ctx.measureText(label).width > maxW) {
                    label = label.slice(0, -2) + '…';
                }
                ctx.fillText(label, headerW + colW * c + 4, headerH + rowH * (r + 0.5) + 0.5, maxW);
            }
        }

        ctx.strokeStyle = '#e1e4ea';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (c = 0; c <= cols; c++) {
            var x = Math.round(headerW + colW * c) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, boxH);
        }
        for (r = 0; r <= Math.min(rows.length, 8); r++) {
            var y = Math.round(headerH + rowH * r) + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(boxW, y);
        }
        ctx.moveTo(headerW + 0.5, 0);
        ctx.lineTo(headerW + 0.5, boxH);
        ctx.moveTo(0, headerH + 0.5);
        ctx.lineTo(boxW, headerH + 0.5);
        ctx.stroke();

        return canvasToJpeg(canvas);
    }

    // ================================================
    // text / code — first lines on canvas
    // ================================================

    function drawTextThumb(text) {
        var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
        while (lines.length && !lines[0].trim()) lines = lines.slice(1);
        lines = lines.slice(0, 14);
        if (!lines.length) return null;

        var k = pixelRatio();
        var boxW = 480, boxH = 300;
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(boxW * k);
        canvas.height = Math.round(boxH * k);
        var ctx = canvas.getContext('2d');
        ctx.scale(k, k);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, boxW, boxH);
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#374151';
        ctx.textBaseline = 'top';

        var maxW = boxW - 36;
        for (var i = 0; i < lines.length; i++) {
            var label = lines[i].replace(/\t/g, '    ');
            while (label.length > 1 && ctx.measureText(label).width > maxW) {
                label = label.slice(0, -2) + '…';
            }
            ctx.fillText(label, 18, 16 + i * 19);
        }
        return canvasToJpeg(canvas);
    }

    async function genText(blob) {
        return drawTextThumb((await blob.text()).slice(0, 4000));
    }

    // ================================================
    // pptx — first non-blank slide via pptx-preview
    // ================================================

    async function repairPptx(buffer) {
        try {
            if (!window.JSZip) await loadScript(CDN.zip, 'jszip');
            var zip = await window.JSZip.loadAsync(buffer);
            var ctFile = zip.file('[Content_Types].xml');
            if (!ctFile) return null;
            var doc = new DOMParser().parseFromString(await ctFile.async('text'), 'application/xml');
            var dropped = 0;
            Array.from(doc.querySelectorAll('Override')).forEach(function (o) {
                var part = (o.getAttribute('PartName') || '').replace(/^\//, '');
                if (part && !zip.file(part)) { o.remove(); dropped++; }
            });
            if (!dropped) return null;
            zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(doc));
            return zip.generateAsync({ type: 'arraybuffer' });
        } catch (err) {
            return null;
        }
    }

    async function genPptx(blob) {
        if (!window.pptxPreview) return null;   // preloaded in preloadFor
        var stage = offstage(960);
        var previewer = null;
        try {
            var buffer = await blob.arrayBuffer();
            previewer = window.pptxPreview.init(stage, { width: 960 });
            await previewer.preview(buffer);
            await new Promise(function (r) { setTimeout(r, 300); });   // paint settle
            // Slide markup varies; the pagination chrome is whatever carries
            // the counter/buttons — drop it before the snapshot.
            stage.querySelectorAll('button,[class*="button"],[class*="pagination"],[class*="page-num"]')
                .forEach(function (el) { el.remove(); });
            var slides = stage.querySelectorAll('.pptx-preview-slide-wrapper');
            if (!slides.length) {
                var fixed = await repairPptx(buffer);   // preview() clears its own DOM
                if (fixed) {
                    await previewer.preview(fixed);
                    await new Promise(function (r) { setTimeout(r, 300); });
                    stage.querySelectorAll('button,[class*="button"],[class*="pagination"],[class*="page-num"]')
                        .forEach(function (el) { el.remove(); });
                    slides = stage.querySelectorAll('.pptx-preview-slide-wrapper');
                }
            }
            if (!slides.length) return null;
            // A blank first slide (title-only decks) would read as a white tile —
            // prefer the first slide that actually painted something.
            var fallback = null;
            for (var i = 0; i < slides.length && i < 5; i++) {
                var canvas = await snapCanvas(slides[i], THUMB_WIDTH);
                if (!canvas) continue;
                if (!fallback) fallback = canvas;
                if (!canvasIsBlank(canvas)) return canvasToJpeg(canvas);
            }
            return fallback ? canvasToJpeg(fallback) : null;
        } finally {
            if (previewer) { try { previewer.destroy(); } catch (err) { /* gone */ } }
            stage.remove();
        }
    }

    // ================================================
    // ppt — legacy binary deck (OLE2 via SheetJS's CFB)
    // ================================================

    var PPT_SLIDE = 0x3EE;          // SlideContainer
    var PPT_TEXT_CHARS = 0x0FA0;    // TextCharsAtom (UTF-16LE)
    var PPT_TEXT_BYTES = 0x0FA8;    // TextBytesAtom (ANSI)
    var PPT_OPT = 0xF00B;           // OfficeArtOPT (shape property grid)
    var BLIP_MIMES = { 0xF01D: 'image/jpeg', 0xF01E: 'image/png', 0xF01F: 'image/bmp' };
    var BLIP_TYPES = { 0xF01A: 1, 0xF01B: 1, 0xF01C: 1, 0xF01D: 1, 0xF01E: 1, 0xF01F: 1, 0xF021: 1 };

    function walkPptRecords(bytes, visit, startAt, endAt) {
        var open = [];              // extents of the containers we are inside
        var pos = startAt || 0;
        var end = endAt || bytes.length;
        while (pos + 8 <= end) {
            while (open.length && pos >= open[open.length - 1].end) open.pop();
            var verInst = bytes[pos] | (bytes[pos + 1] << 8);
            var type = bytes[pos + 2] | (bytes[pos + 3] << 8);
            var len = (bytes[pos + 4] | (bytes[pos + 5] << 8) |
                (bytes[pos + 6] << 16) | (bytes[pos + 7] << 24)) >>> 0;
            if (len > end - pos - 8) { pos++; continue; }   // padding — resync
            var container = (verInst & 15) === 15;
            visit(type, verInst, pos + 8, len, container);
            if (container) {
                open.push({ type: type, end: pos + 8 + len });
                pos += 8;
            } else {
                pos += 8 + len;
            }
        }
    }

    function pptAtomText(bytes, start, len, utf16) {
        try {
            return new TextDecoder(utf16 ? 'utf-16le' : 'windows-1252')
                .decode(bytes.subarray(start, start + len));
        } catch (err) {
            return '';
        }
    }

  
    function pptBlipBlobs(stream) {
        var blips = [];
        walkPptRecords(stream, function (type, verInst, start, len) {
            if (!BLIP_TYPES[type]) return;   // every blip takes a slot, keep refs aligned
            var mime = BLIP_MIMES[type];
            var blob = null;
            if (mime) {
                var sigs = mime === 'image/png' ? [[0x89, 0x50, 0x4E, 0x47]]
                    : mime === 'image/jpeg' ? [[0xFF, 0xD8, 0xFF]]
                    : [[0x28, 0x00, 0x00, 0x00], [0x0C, 0x00, 0x00, 0x00]];   // DIB header sizes
                for (var i = 0; i < 64 && i + 4 <= len; i++) {
                    var hit = sigs.some(function (sig) {
                        return sig.every(function (b, j) { return stream[start + i + j] === b; });
                    });
                    if (!hit) continue;
                    var payload = stream.subarray(start + i, start + len);
                    if (mime === 'image/bmp') payload = new Blob([pptBmpHeader(payload), payload]);
                    blob = new Blob([payload], { type: mime });
                    break;
                }
            }
            blips.push(blob);
        });
        return blips;
    }

    /** Wrap a bare DIB in the BITMAPFILEHEADER browsers need. */
    function pptBmpHeader(dib) {
        var header = new Uint8Array(14);
        var view = new DataView(header.buffer);
        view.setUint8(0, 0x42);   // 'B'
        view.setUint8(1, 0x4D);   // 'M'
        view.setUint32(2, 14 + dib.length, true);
        view.setUint32(10, 14 + (dib[0] | (dib[1] << 8) | (dib[2] << 16) | (dib[3] << 24)), true);
        return header;
    }

    /** Blobs the slide's shapes reference (OPT pid 260 -> 1-based blip index). */
    function pptSlideImages(bytes, start, end, blips) {
        var refs = [];
        walkPptRecords(bytes, function (type, verInst, at, len, container) {
            if (container || type !== PPT_OPT) return;
            var rows = Math.floor(len / 6);   
            for (var p = 0; p < rows; p++) {
                var row = at + p * 6;
                var pid = bytes[row] | (bytes[row + 1] << 8);
                if ((pid & 0x3FFF) === 260) {
                    refs.push((bytes[row + 2] | (bytes[row + 3] << 8) |
                        (bytes[row + 4] << 16) | (bytes[row + 5] << 24)) >>> 0);
                }
            }
        }, start, end);
        var images = [];
        refs.forEach(function (ref) {
            var blob = ref >= 1 && blips[ref - 1];
            if (blob && images.indexOf(blob) < 0) images.push(blob);
        });
        return images;
    }

    function parsePpt(buffer) {
        var out = { width: 0, height: 0, slides: [], image: null };
        if (!window.XLSX || !XLSX.CFB) return out;
        var cfb;
        try {
            cfb = XLSX.CFB.read(new Uint8Array(buffer), { type: 'array' });
        } catch (err) {
            return out;
        }

        var pics = XLSX.CFB.find(cfb, 'Pictures');
        var blips = pics && pics.content && pics.content.length
            ? pptBlipBlobs(new Uint8Array(pics.content)) : [];

        var doc = XLSX.CFB.find(cfb, 'PowerPoint Document');
        if (doc && doc.content && doc.content.length) {
            var bytes = new Uint8Array(doc.content);
            walkPptRecords(bytes, function (type, verInst, start, len, container) {
                if (!container) return;
                if (type === 0x3E8 && !out.width) {   // DocumentContainer: slide size in master units
                    out.width = (bytes[start + 8] | (bytes[start + 9] << 8) |
                        (bytes[start + 10] << 16) | (bytes[start + 11] << 24)) >>> 0;
                    out.height = (bytes[start + 12] | (bytes[start + 13] << 8) |
                        (bytes[start + 14] << 16) | (bytes[start + 15] << 24)) >>> 0;
                }
                if (type !== PPT_SLIDE) return;
                var slide = { lines: [], images: [] };
                out.slides.push(slide);
                walkPptRecords(bytes, function (t2, vi2, s2, l2, c2) {
                    if (c2 || (t2 !== PPT_TEXT_CHARS && t2 !== PPT_TEXT_BYTES)) return;
                    pptAtomText(bytes, s2, l2, t2 === PPT_TEXT_CHARS)
                        .split(/[\r\u000b]/)
                        .forEach(function (line) {
                            line = line.trim();
                            if (line) slide.lines.push(line);
                        });
                }, start, start + len);
                slide.images = pptSlideImages(bytes, start, start + len, blips);
            });
        }

        out.slides.forEach(function (slide) {
            if (!out.image && slide.images.length) out.image = slide.images[0];
        });
        return out;
    }

    /** Slide-styled card, shared by the viewer and the thumbnail snapshot. */
    function buildPptCard(deck, slide, index, total, width) {
        var card = document.createElement('div');
        card.className = 'fb-ppt-slide';
        if (width) {
            card.style.width = width + 'px';
            card.style.maxWidth = 'none';
        }
        if (deck.width > 0 && deck.height > 0) {
            card.style.aspectRatio = deck.width + ' / ' + deck.height;
        }

        var counter = document.createElement('span');
        counter.className = 'fb-ppt-num';
        counter.textContent = (index + 1) + ' / ' + total;
        card.appendChild(counter);

        if (slide.lines.length) {
            var title = document.createElement('h3');
            title.textContent = slide.lines[0];
            card.appendChild(title);
        }
        if (slide.lines.length > 1) {
            var body = document.createElement('div');
            body.className = 'fb-ppt-bullets';
            slide.lines.slice(1, 14).forEach(function (line) {
                var p = document.createElement('p');
                p.textContent = line;
                body.appendChild(p);
            });
            card.appendChild(body);
        }
        if (slide.images.length) {
            var strip = document.createElement('div');
            strip.className = 'fb-ppt-pics';
            slide.images.slice(0, 3).forEach(function (blob) {
                var img = document.createElement('img');
                img.src = URL.createObjectURL(blob);
                img.alt = '';
                strip.appendChild(img);
            });
            card.appendChild(strip);
        }
        return card;
    }

    function fitLabel(ctx, label, maxW) {
        var out = String(label);
        while (out.length > 1 && ctx.measureText(out).width > maxW) {
            out = out.slice(0, -2) + '…';
        }
        return out;
    }

    /** Slide sketch: first line as the title, the rest as bullets. */
    function drawPptThumb(lines) {
        var k = pixelRatio();
        var boxW = 480, boxH = 300;
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(boxW * k);
        canvas.height = Math.round(boxH * k);
        var ctx = canvas.getContext('2d');
        ctx.scale(k, k);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, boxW, boxH);

        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#111827';
        ctx.font = '700 22px Inter, system-ui, sans-serif';
        ctx.fillText(fitLabel(ctx, lines[0], boxW - 64), 32, 68);

        ctx.fillStyle = '#374151';
        ctx.font = '13px Inter, system-ui, sans-serif';
        lines.slice(1, 8).forEach(function (line, i) {
            ctx.fillText('•  ' + fitLabel(ctx, line, boxW - 84), 44, 116 + i * 24);
        });
        return canvasToJpeg(canvas);
    }

    async function genPpt(blob) {
        var deck = parsePpt(await blob.arrayBuffer());
        var slide = null;
        var index = -1;
        for (var i = 0; i < deck.slides.length && !slide; i++) {
            if (deck.slides[i].lines.length || deck.slides[i].images.length) {
                slide = deck.slides[i];
                index = i;
            }
        }
        if (!slide) return deck.image ? drawImageThumb(deck.image) : null;

        if (window.html2canvas) {   // preloaded in preloadFor
            try {
                var stage = offstage(500);
                try {
                    stage.appendChild(buildPptCard(deck, slide, index, deck.slides.length, 480));
                    var canvas = await snapCanvas(stage.firstElementChild, THUMB_WIDTH);
                    if (canvas && !canvasIsBlank(canvas)) return canvasToJpeg(canvas);
                } finally {
                    stage.remove();
                }
            } catch (err) { /* fall back to the sketch */ }
        }
        if (slide.lines.length) return drawPptThumb(slide.lines);
        return slide.images.length ? drawImageThumb(slide.images[0]) : null;
    }

    // ================================================
    // video — frame grab
    // ================================================

    function mediaEvent(el, names, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () {
                cleanup();
                reject(new Error('media timeout'));
            }, timeoutMs);
            function onEvent(e) {
                cleanup();
                if (e.type === 'error') reject(new Error('media error'));
                else resolve();
            }
            function cleanup() {
                clearTimeout(timer);
                names.forEach(function (n) { el.removeEventListener(n, onEvent); });
            }
            names.forEach(function (n) { el.addEventListener(n, onEvent, { once: true }); });
        });
    }

    async function genVideo(blob) {
        var url = URL.createObjectURL(blob);
        var video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.style.cssText = 'position:fixed;left:-99999px;width:320px;';
        document.body.appendChild(video);
        try {
            video.src = url;
            await mediaEvent(video, ['loadedmetadata', 'error'], 5000);
            if (!video.videoWidth) return null;
            var target = Math.min(1, (isFinite(video.duration) ? video.duration : 0) / 2);
            if (target > 0) {
                video.currentTime = target;
                await mediaEvent(video, ['seeked', 'error'], 5000);
            }
            var scale = Math.min(THUMB_WIDTH / video.videoWidth, 2);
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            return canvasToJpeg(canvas);
        } finally {
            video.remove();
            URL.revokeObjectURL(url);
        }
    }

    // ================================================
    // audio — decoded waveform
    // ================================================

    async function genAudio(blob, meta) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        var ctx = new AC();
        try {
            var buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
            var samples = buffer.getChannelData(0);
            var bars = 48, peaks = [];
            var step = Math.max(1, Math.floor(samples.length / bars));
            for (var b = 0; b < bars; b++) {
                var peak = 0;
                for (var i = b * step; i < Math.min((b + 1) * step, samples.length); i += 16) {
                    var v = Math.abs(samples[i]);
                    if (v > peak) peak = v;
                }
                peaks.push(peak);
            }
            if (!peaks.some(function (p) { return p > 0.001; })) return null;

            var color = typeof extColor === 'function' ? extColor(meta.name) : '#EC4899';
            var tint = typeof shadeColor === 'function' ? shadeColor(color, 88) : '#FCE7F3';
            var k = pixelRatio();
            var boxW = 480, boxH = 300;
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(boxW * k);
            canvas.height = Math.round(boxH * k);
            var c2 = canvas.getContext('2d');
            c2.scale(k, k);
            c2.fillStyle = tint;
            c2.fillRect(0, 0, boxW, boxH);
            c2.fillStyle = color;
            var barW = boxW / bars;
            var mid = boxH / 2;
            peaks.forEach(function (p, idx) {
                var h = Math.max(2, p * (boxH * 0.36));
                c2.fillRect(idx * barW + barW * 0.22, mid - h, barW * 0.56, h * 2);
            });
            return canvasToJpeg(canvas);
        } finally {
            if (ctx.close) ctx.close().catch(function () {});
        }
    }

    // ================================================
    // cover tile — the front page for files without a renderer
    // ================================================

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    async function genCover(blob, meta) {
        var color = typeof extColor === 'function' ? extColor(meta.name) : '#64748B';
        var tint = typeof shadeColor === 'function' ? shadeColor(color, 86) : '#F1F5F9';
        var ext = String(meta.name || '').split('.').pop().toUpperCase().slice(0, 8) || 'FILE';
        var name = String(meta.name || '');

        var k = pixelRatio();
        var boxW = 480, boxH = 300;
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(boxW * k);
        canvas.height = Math.round(boxH * k);
        var ctx = canvas.getContext('2d');
        ctx.scale(k, k);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, boxW, boxH);
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, boxW, 6);

        // extension chip
        ctx.font = '700 34px Inter, system-ui, sans-serif';
        var chipW = Math.max(120, ctx.measureText(ext).width + 56);
        var chipX = (boxW - chipW) / 2;
        ctx.fillStyle = tint;
        roundRect(ctx, chipX, 96, chipW, 66, 14);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ext, boxW / 2, 130);

        // filename
        ctx.font = '500 15px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#6b7280';
        var label = name.length > 34 ? name.slice(0, 32) + '…' : name;
        ctx.fillText(label, boxW / 2, 202);
        return canvasToJpeg(canvas);
    }

    // ================================================
    // Dispatch — nothing returns null: failures fall back to the cover
    // ================================================

    var GENERATORS = {
        image: genImage,
        pdf: genPdf,
        docx: genDocx,
        pptx: genPptx,
        ppt: genPpt,
        xlsx: genSheet,
        csv: genSheet,
        md: genMd,
        text: genText,
        video: genVideo,
        audio: genAudio
    };

    async function forCard(blob, meta) {
        try {
            if (!blob) return { url: null, cover: true, ver: THUMB_VERSION };
            meta = meta || {};
            var kind = kindOf(meta.name, meta.mime);
            await preloadFor(kind);
            var gen = GENERATORS[kind];
            var url = gen ? await withTimeout(Promise.resolve(gen(blob, meta)), JOB_TIMEOUT) : null;
            if (url) return { url: url, cover: false, ver: THUMB_VERSION };
        } catch (err) { /* fall through to the cover */ }
        try {
            return { url: await genCover(blob, meta || {}), cover: true, ver: THUMB_VERSION };
        } catch (err2) {
            return { url: null, cover: true, ver: THUMB_VERSION };
        }
    }

    async function forFile(blob, meta) {
        return (await forCard(blob, meta)).url;
    }

    // ================================================
    // Backfill sweep — thumbnails for records that predate
    // this module (or whose upload-time run failed)
    // ================================================

    var pending = new Set();    // ids mid-generation
    var attempted = {};         // 'id@updatedAt' -> generation definitively failed
    var deferred = {};          // 'id@updatedAt' -> card waiting for uploads to finish
    var chain = Promise.resolve();   // sequential: metadata PUTs RMW the shared doc

    function recordKey(file) {
        return file.id + '@' + (file.updatedAt || '');
    }

    function wantsThumb(file) {
        if (!file || !file.thumbnail) return true;
        return file.thumbnailCover || (file.thumbVer || 0) < THUMB_VERSION;
    }

    /** True while the card should show a loading skeleton (vs the ext tile). */
    function isPending(file) {
        return Boolean(file && !file.thumbnail && !file.thumbnailCover &&
            isGeneratable(file) && !attempted[recordKey(file)]);
    }

    function persistIfQuiet(file, card) {
        if (window.fileboxUploads && fileboxUploads.isBusy()) {
            deferred[recordKey(file)] = card;
            return false;
        }
        return true;
    }

    function ensureMissing(files, hooks) {
        hooks = hooks || {};
        (files || []).forEach(function (file) {
            if (!file || pending.has(file.id)) return;
            if (!wantsThumb(file)) return;
            var key = recordKey(file);
            if (attempted[key]) return;
            if (!isGeneratable(file)) { attempted[key] = true; return; }
            if (deferred[key]) {
                chain = chain.then(function () { return flushDeferred(key, hooks); });
                return;
            }
            pending.add(file.id);
            chain = chain.then(function () { return backfillOne(key, hooks); });
        });
    }

    async function backfillOne(key, hooks) {
        var fileId = key.split('@')[0];
        try {
            var file = hooks.getFile && hooks.getFile(fileId);
            if (!file || !wantsThumb(file) || attempted[key]) return;

            if (window.fileboxUploads && fileboxUploads.isBusy()) return;   // retry next sweep

            var response = await fetch(fileboxStorage.fileUrl(file.id, false));
            if (!response.ok) return;   // offline / gone — retried next sweep
            var blob = await response.blob();

            var card = await forCard(blob, { name: file.name, mime: file.mime });
            file = hooks.getFile ? hooks.getFile(file.id) : file;
            if (!file || !wantsThumb(file)) return;

            if (card.url && persistIfQuiet(file, card)) {
                var saved = await fileboxStorage.setFileThumbnail(file.id, card.url, card.cover, card.ver);
                if (saved) {
                    file.thumbnail = card.url;
                    file.thumbnailCover = card.cover;
                    file.thumbVer = card.ver;
                    if (hooks.onThumb) hooks.onThumb(file, card.url);
                }
            }
            if (!card.url || card.cover) {
                attempted[key] = true;   // keep whatever tile is showing
            }
        } catch (err) {
            /* best-effort */
        } finally {
            pending.delete(fileId);
        }
    }

    async function flushDeferred(key, hooks) {
        try {
            var card = deferred[key];
            delete deferred[key];
            var file = hooks.getFile && hooks.getFile(key.split('@')[0]);
            if (!card || !card.url || !file || !wantsThumb(file)) return;
            if (!persistIfQuiet(file, card)) return;   // still busy — next sweep
            var saved = await fileboxStorage.setFileThumbnail(file.id, card.url, card.cover, card.ver);
            if (saved) {
                file.thumbnail = card.url;
                file.thumbnailCover = card.cover;
                file.thumbVer = card.ver;
                if (hooks.onThumb) hooks.onThumb(file, card.url);
            }
        } catch (err) {
            /* best-effort */
        }
    }

    // ================================================
    // Export
    // ================================================

    window.fileboxThumbs = {
        forCard: forCard,
        forFile: forFile,
        ensureMissing: ensureMissing,
        isGeneratable: isGeneratable,
        isPending: isPending,
        parsePpt: parsePpt,         // legacy .ppt slide text + images (viewer.js)
        pptSlideCard: buildPptCard, // legacy .ppt slide card (viewer.js)
        repairPptx: repairPptx,     // broken [Content_Types].xml fix (viewer.js)
        preload: preloadFor         // shared CDN loader (viewer.js)
    };
})();