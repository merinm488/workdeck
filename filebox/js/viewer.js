/**
 * ================================================
 * FILEBOX - Viewer
 * ================================================
 *
 * fileboxViewer — per-type file previews, each delegated to a library
 * (replacing the image/PDF branching that was hand-rolled in main.js):
 *
 *   image/*      PhotoSwipe   fullscreen lightbox: pinch/zoom/swipe + download
 *   pdf          pdf.js       paginated canvas renderer with zoom controls
 *   docx         docx-preview layout-faithful Word rendering (.docx only)
 *   xlsx         SheetJS      table view with sheet tabs
 *   csv          Papa Parse   parsed rows rendered as a table
 *   md           marked       sanitized HTML + highlight.js code blocks
 *   code/text    highlight.js language-aware source view
 *   video/audio  Video.js     player with controls
 *   else         tile + download hint (fallback)
 *
 * Images bypass the fbViewer modal entirely — PhotoSwipe is its own
 * fullscreen overlay. Everything else renders inside the modal; close()
 * destroys the active pdf.js document / video.js player.
 *
 * Every renderer guards its library global, so a blocked CDN degrades to
 * the download fallback instead of a dead modal.
 */

const FB_CODE_LANGS = {
    js: 'javascript', ts: 'typescript', json: 'json', html: 'xml', css: 'css',
    py: 'python', xml: 'xml', sh: 'bash', yml: 'yaml', yaml: 'yaml',
    java: 'java', c: 'c', cpp: 'cpp', rb: 'ruby', go: 'go', rs: 'rust'
};

class FileboxViewer {
    constructor() {
        this.state = null;
        this.pdfDoc = null;         // active pdf.js document
        this.mediaPlayer = null;    // active video.js player
    }

    /** Wire to main.js state (needs the folder context + deep-link URL). */
    init(state) {
        this.state = state;
    }

    emitShown() {
        if (typeof this.onShown === 'function') this.onShown();
    }

    emitAfterEntryAnimation(el) {
        let fired = false;
        const fire = () => {
            if (fired) return;
            fired = true;
            this.emitShown();
        };
        if (el) el.addEventListener('animationend', fire, { once: true });
        setTimeout(fire, 300);   // entry fade is 160ms
    }

    // ================================================
    // Entry / exit
    // ================================================

    open(file) {
        fileboxStorage.recordOpen(file.id).catch(function () {});
        $('fbViewerTitle').textContent = file.name;
        $('fbViewerMeta').textContent = formatBytes(file.size) + ' · ' + formatRelativeDate(file.updatedAt);
        $('fbViewerDownload').onclick = function () {
            window.location.href = fileboxStorage.fileUrl(file.id, true);
        };
        this.syncUrlWithId(file.id);

        const kind = this.kindOf(file);
        if (kind === 'image') {
            this.openImage(file);   // PhotoSwipe overlay; modal stays closed
            return;
        }

        openModal('fbViewer');
        this.emitAfterEntryAnimation($('fbViewer').querySelector('.fb-modal-content'));
        const body = $('fbViewerBody');
        const loading = document.createElement('div');
        loading.className = 'fb-viewer-loading';
        loading.textContent = 'Loading preview…';
        body.replaceChildren(loading);

        const renderers = {
            pdf: this.renderPdf,
            docx: this.renderDocx,
            xlsx: this.renderXlsx,
            csv: this.renderCsv,
            md: this.renderMarkdown,
            code: this.renderCode,
            text: this.renderCode,
            video: this.renderMedia,
            audio: this.renderMedia
        };
        const renderer = renderers[kind] || this.renderFallback;
        renderer.call(this, file, body).catch(function (err) {
            console.error('[VIEWER] Preview failed:', err);
            const box = document.createElement('div');
            box.className = 'fb-viewer-fallback';
            const p = document.createElement('p');
            p.textContent = 'Preview failed to load.';
            box.append(p);
            body.replaceChildren(box);
        });
    }

    close() {
        this.teardown();
        closeModal('fbViewer');

        const loc = window.WDLinks ? WDLinks.parseLocation() : null;
        const params = new URLSearchParams(window.location.search);
        if ((loc && loc.id) || params.get('id')) {
            params.delete('id');
            const qs = params.toString();
            history.replaceState(null, '', '/filebox/' + (qs ? '?' + qs : ''));
        }
    }

    teardown() {
        if (this.pdfDoc) {
            try { this.pdfDoc.destroy(); } catch (err) { /* already gone */ }
            this.pdfDoc = null;
        }
        if (this.mediaPlayer) {
            try { this.mediaPlayer.dispose(); } catch (err) { /* already gone */ }
            this.mediaPlayer = null;
        }
    }

    syncUrlWithId(fileId) {
        const params = new URLSearchParams(window.location.search);
        if (this.state && this.state.currentFolderId) params.set('folder', this.state.currentFolderId);
        const qs = params.toString();
        // Canonical hard link in the address bar while the viewer is open.
        history.replaceState(null, '', '/filebox/' + encodeURIComponent(fileId) + (qs ? '?' + qs : ''));
    }

    // ================================================
    // Type detection (mime first, extension as backstop)
    // ================================================

    kindOf(file) {
        const mime = file.mime || '';
        const match = /\.([a-z0-9]{1,8})$/i.exec(file.name || '');
        const ext = match ? match[1].toLowerCase() : '';

        if (mime.startsWith('image/')) return 'image';
        if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
        if (ext === 'docx') return 'docx';
        if (ext === 'xls' || ext === 'xlsx' || mime.includes('spreadsheet')) return 'xlsx';
        if (ext === 'csv' || mime === 'text/csv') return 'csv';
        if (ext === 'md' || ext === 'markdown') return 'md';
        if (mime.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
        if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio';
        if (FB_CODE_LANGS[ext]) return 'code';
        if (mime.startsWith('text/') || ext === 'txt') return 'text';
        return 'unknown';
    }

    // ================================================
    // Fetch helpers
    // ================================================

    async fetchBuffer(file) {
        const response = await fetch(fileboxStorage.fileUrl(file.id, false));
        if (!response.ok) throw new Error('Fetch failed (' + response.status + ')');
        return response.arrayBuffer();
    }

    async fetchText(file) {
        const response = await fetch(fileboxStorage.fileUrl(file.id, false));
        if (!response.ok) throw new Error('Fetch failed (' + response.status + ')');
        return response.text();
    }

    // ================================================
    // Images — PhotoSwipe 5 (fullscreen overlay, not the modal)
    // ================================================

    openImage(file) {
        const url = fileboxStorage.fileUrl(file.id, false);
        const self = this;

        // PhotoSwipe wants intrinsic dimensions up front — measure once.
        new Promise(function (resolve) {
            const probe = new Image();
            probe.onload = function () { resolve({ w: probe.naturalWidth || 1200, h: probe.naturalHeight || 900 }); };
            probe.onerror = function () { resolve({ w: 1200, h: 900 }); };
            probe.src = url;
        }).then(function (dims) {
            const pswp = new PhotoSwipe({
                dataSource: [{ src: url, width: dims.w, height: dims.h, alt: file.name }],
                showHideAnimationType: 'fade',
                zoom: true,
                close: true,
                counter: false,
                wheelToZoom: true,
                bgOpacity: 1
            });
            pswp.on('uiRegister', function () {
                const icon = fbIcon('download');
                icon.setAttribute('width', '20');
                icon.setAttribute('height', '20');
                pswp.ui.registerElement({
                    name: 'download',
                    isButton: true,
                    order: 9,
                    tagName: 'a',
                    appendTo: 'bar',
                    html: icon.outerHTML,
                    onInit: function (el) {
                        el.setAttribute('href', fileboxStorage.fileUrl(file.id, true));
                        el.setAttribute('download', file.name);
                        el.setAttribute('title', 'Download');
                        el.setAttribute('aria-label', 'Download');
                    }
                });
            });
            pswp.on('destroy', function () {
                const loc = window.WDLinks ? WDLinks.parseLocation() : null;
                const params = new URLSearchParams(window.location.search);
                if ((loc && loc.id) || params.get('id')) {
                    params.delete('id');
                    const qs = params.toString();
                    history.replaceState(null, '', '/filebox/' + (qs ? '?' + qs : ''));
                }
            });
            pswp.on('openingAnimationEnd', function () {
                self.emitShown();
            });
            pswp.init();
            self.pswp = pswp;
        });
    }

    // ================================================
    // PDF — pdf.js canvas pages + zoom / page toolbar
    // ================================================

    async renderPdf(file, body) {
        if (!window.pdfjsLib) return this.renderFallback(file, body);

        const doc = await pdfjsLib.getDocument({ data: await this.fetchBuffer(file) }).promise;
        this.pdfDoc = doc;

        const toolbar = $('fbPdfToolbarTemplate').content.firstElementChild.cloneNode(true);
        toolbar.querySelector('[data-r="pages"]').textContent = doc.numPages;

        const scroller = document.createElement('div');
        scroller.className = 'fb-pdf-scroll';
        const stack = document.createElement('div');
        stack.className = 'fb-pdf-stack';
        body.innerHTML = '';
        body.appendChild(toolbar);
        body.appendChild(scroller);
        scroller.appendChild(stack);

        const steps = [0.6, 0.8, 1, 1.25, 1.5, 2];
        let step = 2;
        let pageEls = [];

        // 100% shows the page at actual size (A4 = 794×1123 CSS px on
        // standard 96-dpi screens) — 1 PDF point renders as 4/3 CSS px.
        const NATURAL = 96 / 72;

        async function renderAll() {
            const scale = Math.min(Math.max(0.2, NATURAL * steps[step]), 4);

            pageEls.forEach(function (el) { el.remove(); });
            pageEls = [];

            for (let n = 1; n <= doc.numPages; n++) {
                const page = await doc.getPage(n);
                const viewport = page.getViewport({ scale: scale });
                const wrap = document.createElement('div');
                wrap.className = 'fb-pdf-page';
                wrap.style.width = Math.ceil(viewport.width) + 'px';
                wrap.style.height = Math.ceil(viewport.height) + 'px';
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                wrap.appendChild(canvas);
                stack.appendChild(wrap);
                pageEls.push(wrap);
                await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
            }
            toolbar.querySelector('[data-r="zoom"]').textContent = Math.round(steps[step] * 100) + '%';
        }

        toolbar.addEventListener('click', function (e) {
            const btn = e.target.closest('button[data-a]');
            if (!btn) return;
            const action = btn.dataset.a;
            if (action === 'in' && step < steps.length - 1) { step++; renderAll(); }
            if (action === 'out' && step > 0) { step--; renderAll(); }
            if (action === 'prev' || action === 'next') {
                const current = Math.round(scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight) * (doc.numPages - 1)) + 1;
                const target = Math.min(doc.numPages, Math.max(1, action === 'next' ? current + 1 : current - 1));
                const el = pageEls[target - 1];
                if (el) scroller.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
                toolbar.querySelector('[data-r="page"]').textContent = target;
            }
        });
        scroller.addEventListener('scroll', function () {
            if (pageEls.length < 2) return;
            const pos = scroller.scrollTop + scroller.clientHeight / 3;
            let seen = 1;
            for (let i = 0; i < pageEls.length; i++) {
                if (pageEls[i].offsetTop <= pos) seen = i + 1;
            }
            toolbar.querySelector('[data-r="page"]').textContent = seen;
        });

        await renderAll();
    }

    // ================================================
    // Word (.docx) — docx-preview
    // ================================================

    async renderDocx(file, body) {
        if (!window.docx) return this.renderFallback(file, body);
        const buffer = await this.fetchBuffer(file);
        body.innerHTML = '';
        const paper = document.createElement('div');
        paper.className = 'fb-docx-paper';
        body.appendChild(paper);
        await docx.renderAsync(buffer, paper, null, { inWrapper: true });
    }

    // ================================================
    // Excel — SheetJS (+ tabs when the book has several sheets)
    // ================================================

    async renderXlsx(file, body) {
        if (!window.XLSX) return this.renderFallback(file, body);
        const buffer = await this.fetchBuffer(file);
        const book = XLSX.read(buffer, { type: 'array' });

        body.innerHTML = '';
        const scroller = document.createElement('div');
        scroller.className = 'fb-sheet-scroll';
        body.appendChild(scroller);

        function show(name) {
            scroller.innerHTML = DOMPurify.sanitize(
                XLSX.utils.sheet_to_html(book.Sheets[name]),
                { USE_PROFILES: { html: true } }
            );
        }

        if (book.SheetNames.length > 1) {
            const tabs = document.createElement('div');
            tabs.className = 'fb-sheet-tabs';
            book.SheetNames.forEach(function (name) {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.textContent = name;
                tab.addEventListener('click', function () {
                    show(name);
                    tabs.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
                    tab.classList.add('active');
                });
                tabs.appendChild(tab);
            });
            tabs.firstChild.classList.add('active');
            body.insertBefore(tabs, scroller);
        }

        show(book.SheetNames[0]);
    }

    // ================================================
    // CSV — Papa Parse (cells land via textContent, never innerHTML)
    // ================================================

    async renderCsv(file, body) {
        if (!window.Papa) return this.renderFallback(file, body);
        const text = await this.fetchText(file);
        const rows = (Papa.parse(text.trim(), { skipEmptyLines: true }).data) || [];

        const table = document.createElement('table');
        table.className = 'fb-sheet-table';
        rows.forEach(function (cells, i) {
            const tr = document.createElement('tr');
            const tag = i === 0 ? 'th' : 'td';
            cells.forEach(function (cell) {
                const el = document.createElement(tag);
                el.textContent = cell == null ? '' : String(cell);
                tr.appendChild(el);
            });
            table.appendChild(tr);
        });

        body.innerHTML = '';
        const scroller = document.createElement('div');
        scroller.className = 'fb-sheet-scroll';
        scroller.appendChild(table);
        body.appendChild(scroller);
    }

    // ================================================
    // Markdown — marked -> DOMPurify -> highlight.js code blocks
    // ================================================

    async renderMarkdown(file, body) {
        if (!window.marked || !window.DOMPurify) return this.renderFallback(file, body);
        const text = await this.fetchText(file);
        const article = document.createElement('div');
        article.className = 'fb-md-body';
        article.innerHTML = DOMPurify.sanitize(marked.parse(text), { USE_PROFILES: { html: true } });

        body.innerHTML = '';
        body.appendChild(article);
        if (window.hljs) {
            article.querySelectorAll('pre code').forEach(function (block) {
                try { hljs.highlightElement(block); } catch (err) { /* leave plain */ }
            });
        }
    }

    // ================================================
    // Source / text — highlight.js (textContent, never raw HTML)
    // ================================================

    async renderCode(file, body) {
        const text = await this.fetchText(file);
        const match = /\.([a-z0-9]{1,8})$/i.exec(file.name || '');
        const ext = match ? match[1].toLowerCase() : '';

        body.innerHTML = '';
        const pre = document.createElement('pre');
        pre.className = 'fb-code-body';
        const code = document.createElement('code');
        code.textContent = text;
        if (FB_CODE_LANGS[ext]) code.className = 'language-' + FB_CODE_LANGS[ext];
        pre.appendChild(code);
        body.appendChild(pre);

        if (window.hljs) {
            try { hljs.highlightElement(code); } catch (err) { /* leave plain */ }
        }
    }

    // ================================================
    // Video / audio — Video.js
    // ================================================

    renderMedia(file, body) {
        if (!window.videojs) return this.renderFallback(file, body);

        const match = /\.([a-z0-9]{1,8})$/i.exec(file.name || '');
        const ext = match ? match[1].toLowerCase() : '';
        const isAudio = (file.mime || '').startsWith('audio/') ||
            ['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext);

        body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'fb-video-wrap' + (isAudio ? ' fb-audio-wrap' : '');
        const media = document.createElement(isAudio ? 'audio' : 'video');
        media.className = 'video-js vjs-big-play-centered';
        media.controls = true;
        media.preload = 'metadata';
        const source = document.createElement('source');
        source.src = fileboxStorage.fileUrl(file.id, false);
        source.type = file.mime || (isAudio ? 'audio/mpeg' : 'video/mp4');
        media.appendChild(source);
        wrap.appendChild(media);
        body.appendChild(wrap);

        this.mediaPlayer = videojs(media, { fluid: !isAudio });
        return Promise.resolve();
    }

    // ================================================
    // Fallback
    // ================================================

    renderFallback(file, body) {
        const color = extColor(file.name);
        const box = $('fbViewerFallbackTemplate').content.firstElementChild.cloneNode(true);
        const tile = box.querySelector('.fb-viewer-tile');
        tile.style.background = shadeColor(color, 82);
        tile.style.color = color;
        tile.firstElementChild.textContent = fileExt(file.name);
        body.replaceChildren(box);
        return Promise.resolve();
    }
}

// ================================================
// Export
// ================================================

const fileboxViewer = new FileboxViewer();

if (typeof window !== 'undefined') {
    window.FileboxViewer = FileboxViewer;
    window.fileboxViewer = fileboxViewer;
}