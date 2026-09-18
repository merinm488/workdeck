/**
 * ================================================
 * SLIDES - Shared (public) Viewer
 * ================================================
 *
 */

const sharedState = {
    deck: null,
    index: 0,
    canvas: null,      // fabric.StaticCanvas on #sharedCanvas
    presenting: false
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
    const result = await slidesStorage.getSharedDeck(shareId);
    if (!result) {
        showSharedError();
        return;
    }

    sharedState.deck = result.deck;
    $('sharedDeckName').textContent = sharedState.deck.name;
    document.title = `${sharedState.deck.name} - Slides`;

    await document.fonts.ready;

    sharedState.canvas = new fabric.StaticCanvas('sharedCanvas');

    $('sharedLoading').classList.add('hidden');
    $('sharedStage').classList.remove('hidden');
    $('viewerControls').classList.remove('hidden');

    renderSharedSlide(0);
    window.addEventListener('resize', debounce(sizeSharedCanvas, 150));
}

// ================================================
// Rendering
// ================================================


function renderSharedSlide(index) {
    const deck = sharedState.deck;
    const slide = deck && deck.slides[index];
    if (!slide) return;

    sharedState.index = index;

    sharedState.canvas.loadFromJSON({ objects: slide.objects || [] }).then(() => {
        sharedState.canvas.backgroundColor = slide.background || APP_CONFIG.slide.defaultBackground;
        sizeSharedCanvas();
        sharedState.canvas.requestRenderAll();
    });

    $('viewerCounter').textContent = `${index + 1} / ${deck.slides.length}`;
}

function sizeSharedCanvas() {
    const stage = $('sharedStage');
    const deck = sharedState.deck;
    if (!sharedState.canvas || !deck) return;

    const deckWidth = deck.width || APP_CONFIG.slide.width;
    const deckHeight = deck.height || APP_CONFIG.slide.height;

    const availableWidth = stage.clientWidth - 48;    // .viewer-stage has 24px padding each side
    const availableHeight = stage.clientHeight - 48;

    if (availableWidth <= 0 || availableHeight <= 0) return;

    const scale = Math.min(
        availableWidth / deckWidth,
        availableHeight / deckHeight
    );

    sharedState.canvas.setDimensions({
        width: deckWidth * scale,
        height: deckHeight * scale
    });
    sharedState.canvas.setZoom(scale);

    $('sharedSurface').style.width = (deckWidth * scale) + 'px';
    $('sharedSurface').style.height = (deckHeight * scale) + 'px';
}

// ================================================
// Controls: prev / next / present (fullscreen)
// ================================================

function viewerNext() {
    if (sharedState.deck && sharedState.index < sharedState.deck.slides.length - 1) {
        renderSharedSlide(sharedState.index + 1);
    }
}

function viewerPrev() {
    if (sharedState.index > 0) {
        renderSharedSlide(sharedState.index - 1);
    }
}

function bindSharedControls() {
    $('viewerPrevBtn').addEventListener('click', viewerPrev);
    $('viewerNextBtn').addEventListener('click', viewerNext);

    window.addEventListener('keydown', (e) => {
        if (!sharedState.deck) return;

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            viewerNext();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            viewerPrev();
        }
    });

    $('sharedPresentBtn').addEventListener('click', () => {
        sharedState.presenting = true;

        const request = document.documentElement.requestFullscreen();
        if (request) {
            request.catch(() => {});
        }
    });

    document.addEventListener('fullscreenchange', () => {
        sharedState.presenting = Boolean(document.fullscreenElement);
        sizeSharedCanvas();
    });
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

/** Toast helper — same pattern as editor.js showNotification (#notification). */
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
    return function(){
        clearTimeout(timer);
        timer = setTimeout(fn, waitMs);
    }
}

// ================================================
// Boot
// ================================================

document.addEventListener('DOMContentLoaded', () => {
    initShared();
    bindSharedControls();
});
