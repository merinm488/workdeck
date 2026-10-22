/**
 * ================================================
 * CALENDAR - Workdeck card snapshot
 * ================================================
 *
 */

/**
 * Copy every computed style onto a cloned tree so the SVG raster renders
 * it without the app's stylesheets. Absolute px values also freeze the
 * layout against reflow at the SVG's intrinsic size.
 */
function inlineSnapshotStyles(source, clone) {
    const srcEls = [source].concat(Array.from(source.querySelectorAll('*')));
    const dstEls = [clone].concat(Array.from(clone.querySelectorAll('*')));
    srcEls.forEach(function (el, i) {
        const target = dstEls[i];
        if (!target) return;
        const cs = getComputedStyle(el);
        for (let j = 0; j < cs.length; j++) {
            const prop = cs[j];
            target.style.setProperty(prop, cs.getPropertyValue(prop));
        }
    });
}

/**
 * Serialize `el` to a same-size SVG document string, styled for the
 * light theme. The flip + restore happen inside one synchronous block,
 * so nothing paints in the app's own theme.
 */
function elToSvg(el) {
    const html = document.documentElement;
    const theme = html.getAttribute('data-theme');
    const freeze = document.createElement('style');
    try {
        if (theme !== 'light') html.setAttribute('data-theme', 'light');
        // Themed values must be read past any transition start state.
        freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
        document.head.appendChild(freeze);
        void document.body.offsetWidth;

        const rect = el.getBoundingClientRect();
        const clone = el.cloneNode(true);
        inlineSnapshotStyles(el, clone);
        clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

        // Mask-image icons (fc-icon chevrons) and nested <svg> don't
        // raster inside foreignObject — swap them for text stands.
        clone.querySelectorAll('.fc-icon').forEach(function (icon) {
            icon.textContent = icon.classList.contains('fc-icon-chevron-left') ? '‹' :
                icon.classList.contains('fc-icon-chevron-right') ? '›' : '';
            icon.style.cssText += ';background:none;mask-image:none;-webkit-mask-image:none;' +
                'display:inline-flex;align-items:center;justify-content:center;font-weight:700;';
        });
        clone.querySelectorAll('svg').forEach(function (icon) {
            const btn = icon.closest('button');
            const glyph = btn && btn.classList.contains('fc-prev-button') ? '‹' :
                btn && btn.classList.contains('fc-next-button') ? '›' : '';
            const stand = document.createElement('span');
            stand.textContent = glyph;
            stand.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;overflow:hidden;' +
                'width:' + icon.clientWidth + 'px;height:' + icon.clientHeight + 'px;';
            icon.replaceWith(stand);
        });

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        // outerHTML omits the declaration on a detached root, and without
        // it the <img> decoder refuses the whole image.
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', Math.round(rect.width));
        svg.setAttribute('height', Math.round(rect.height));
        const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreign.setAttribute('width', '100%');
        foreign.setAttribute('height', '100%');
        foreign.appendChild(clone);
        svg.appendChild(foreign);
        return svg.outerHTML;
    } finally {
        freeze.remove();
        if (theme !== null) html.setAttribute('data-theme', theme);
    }
}

/**
 * Snapshot the calendar view. Returns null when there is nothing to
 * capture (not rendered, raster failed, ...) — callers then just omit
 * the thumbnail.
 * @param {number} maxWidth - Output pixel width cap
 * @returns {Promise<string|null>} PNG (or JPEG when too large) data URL
 */
async function captureCalendarThumbnail(maxWidth = 640) {
    try {
        const el = document.getElementById('calendarEl');
        if (!el || !el.clientWidth || !calendar) return null;

        // Data URL, not blob: blob-sourced SVGs with foreignObject taint
        // the canvas in Chromium, which blocks the toDataURL export.
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(elToSvg(el));
        await img.decode();

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const outW = Math.min(Math.round(el.clientWidth * dpr), maxWidth);
        const outH = Math.max(1, Math.round(img.height * outW / img.width));

        const out = document.createElement('canvas');
        out.width = outW;
        out.height = outH;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, 0, 0, outW, outH);

        const png = out.toDataURL('image/png');
        if (png.length <= 250000) return png;
        return out.toDataURL('image/jpeg', 0.75);
    } catch (error) {
        console.warn('[CALENDAR] Snapshot capture failed:', error);
        return null;
    }
}

if (typeof window !== 'undefined') {
    window.captureCalendarThumbnail = captureCalendarThumbnail;
}
