/**
 * ================================================
 * DRAW - Shared (public) Viewer
 * ================================================
 *
 * Renders a shared drawing snapshot read-only onto a fabric.StaticCanvas.
 * The infinite board is rendered fit-to-content, with +/- zoom controls.
 */

const sharedState = {
    drawing: null,
    canvas: null,      // fabric.StaticCanvas on #sharedCanvas
    zoom: 1            // viewer zoom relative to fit-scale
};

let notificationTimer = null;

// ================================================
// Boot
// ================================================

async function initShared() {
    const shareId = new URLSearchParams(location.search).get('shared');
    if (!shareId) {
        showSharedError();
        return;
    }
    const result = await drawStorage.getSharedDrawing(shareId);
    if (!result) {
        showSharedError();
        return;
    }

    sharedState.drawing = result.drawing;
    $('sharedDrawingName').textContent = sharedState.drawing.name || 'Shared Drawing';
    document.title = `${sharedState.drawing.name || 'Shared Drawing'} - Draw`;

    await document.fonts.ready;

    sharedState.canvas = new fabric.StaticCanvas('sharedCanvas');

    $('sharedLoading').classList.add('hidden');
    $('sharedStage').classList.remove('hidden');
    $('viewerControls').classList.remove('hidden');

    await renderSharedDrawing();

    window.addEventListener('resize', debounce(sizeSharedCanvas, 150));
    $('viewerZoomInBtn').addEventListener('click', () => {
        sharedState.zoom = Math.min(8, sharedState.zoom * 1.2);
        sizeSharedCanvas();
    });
    $('viewerZoomOutBtn').addEventListener('click', () => {
        sharedState.zoom = Math.max(0.1, sharedState.zoom / 1.2);
        sizeSharedCanvas();
    });
    $('viewerFitBtn').addEventListener('click', () => {
        sharedState.zoom = 1;
        sizeSharedCanvas();
    });
}

// ================================================
// Rendering
// ================================================

/**
 * Load the snapshot's objects onto the canvas, then size it to fit the
 * content bounds at the current viewer zoom.
 */
async function renderSharedDrawing() {
    const drawing = sharedState.drawing;
    await sharedState.canvas.loadFromJSON({ objects: drawing.objects || [] });
    sharedState.canvas.backgroundColor = drawing.background || APP_CONFIG.canvas.defaultBackground;
    sharedState.canvas.requestRenderAll();
    sizeSharedCanvas();
}

/**
 * Size the StaticCanvas to the content bounds of the drawing at
 * fit-scale * sharedState.zoom:
 *   1. Content bounds = union of every object's bounding box in SCENE
 *      space (getBoundingRect is scene-space in fabric v6/v7). The
 *      viewport is reset to identity before measuring and the final
 *      transform is set right after, so the measurement is never
 *      contaminated by a previous call's zoom/pan.
 *      Empty drawing -> a centered default board ~960x600.
 *   2. fitScale = min(availableW/bw, availableH/bh) capped at 1 for small
 *      doodles (don't upscale a sticky note to fill a 4K window).
 *   3. Canvas element = bw*fitScale*zoom x bh*fitScale*zoom; setZoom
 *      handles the transform. #sharedSurface gets the matching CSS size so
 *      the paper shadow wraps the content exactly.
 */
function sizeSharedCanvas() {
    const stage = $('sharedStage');
    const canvas = sharedState.canvas;
    const drawing = sharedState.drawing;
    if (!canvas || !drawing) return;

    // .shared-stage's padding varies by breakpoint — read it instead of hardcoding
    const stageStyle = getComputedStyle(stage);
    const availableWidth = stage.clientWidth -
        (parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight));
    const availableHeight = stage.clientHeight -
        (parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom));
    if (availableWidth <= 0 || availableHeight <= 0) return;

    // Measure under identity vpt — getBoundingRect() would otherwise return
    // coordinates already transformed by the transform WE set last call,
    // and re-fitting would drift on every resize/zoom-button press.
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    const objects = canvas.getObjects();
    const PAD = 24;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    if (objects.length === 0) {
        // Empty drawing: show a centered default board
        minX = 0; minY = 0; maxX = 960; maxY = 600;
    } else {
        objects.forEach(obj => {
            const rect = obj.getBoundingRect();
            minX = Math.min(minX, rect.left);
            minY = Math.min(minY, rect.top);
            maxX = Math.max(maxX, rect.left + rect.width);
            maxY = Math.max(maxY, rect.top + rect.height);
        });
    }
    minX -= PAD; minY -= PAD;
    const bw = (maxX - minX) + PAD;
    const bh = (maxY - minY) + PAD;

    // Fit (no upscale beyond 1x for small content), then apply viewer zoom
    const fitScale = Math.min(availableWidth / bw, availableHeight / bh, 1);
    const scale = fitScale * sharedState.zoom;

    canvas.setDimensions({
        width: Math.max(1, Math.round(bw * scale)),
        height: Math.max(1, Math.round(bh * scale))
    });

    // Zoom + pan so the content bounds fill the element exactly
    canvas.setZoom(scale);
    canvas.viewportTransform[4] = -minX * scale;
    canvas.viewportTransform[5] = -minY * scale;
    canvas.requestRenderAll();

    $('sharedSurface').style.width = canvas.getElement().style.width;
    $('sharedSurface').style.height = canvas.getElement().style.height;
}

// ================================================
// States / utilities
// ================================================

function showSharedError() {
    $('sharedLoading').classList.add('hidden');
    $('sharedError').classList.remove('hidden');
}

function $(id) {
    return document.getElementById(id);
}

/** Toast helper (#notification). */
function showNotification(message, isError = false) {
    const el = $('notification');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');

    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        el.classList.remove('show');
    }, 2500);
}

/** Standard debounce for resize bursts. */
function debounce(fn, waitMs) {
    let timer = null;
    return function () {
        clearTimeout(timer);
        timer = setTimeout(fn, waitMs);
    };
}

// ================================================
// Boot
// ================================================

document.addEventListener('DOMContentLoaded', () => {
    initShared();
});