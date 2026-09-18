/**
 * ================================================
 * SLIDES - Deck Editor  
 * ================================================
 *
 * ARCHITECTURE MAP
 * ────────────────
 * One fabric.Canvas ("the stage") shows ONE slide at a time. The deck is a
 * plain JSON record (schema documented in js/storage.js); slides never live
 * anywhere but `state.deck.slides[]`, and the canvas is just their viewport:
 *
 *   canvas  ->  slide        (save)   syncCurrentSlideFromCanvas():
 *                                       slide.objects   = canvas.toObject().objects
 *                                       slide.background = canvas.background
 *   slide   ->  canvas       (load)   loadSlide(index):
 *                                       canvas.loadFromJSON({ objects: [...] })
 *                                       canvas.backgroundColor = slide.background
 *
 * On top of that core loop:
 *   - thumbnails: re-render a slide offscreen at ~0.2 scale -> dataURL <img>
 *   - undo/redo : a stack of JSON.stringify(slide.objects) snapshots
 *   - autosave  : markDirty() flag -> interval -> saveDeck()
 *   - present   : render each slide's JSON onto #presentCanvas, fullscreen
 *   - export    : PNG (toDataURL) / PDF (jsPDF) / PPTX (PptxGenJS)
 *
 * ELEMENT IDs — every element this file touches already exists in
 * editor.html:
 *   nav      #homeBtn #deckTitle #saveState #presentBtn #exportBtn
 *            #exportDropdown #exportPngBtn #exportPdfBtn #exportPptxBtn
 *            #saveBtn #settingsBtn #settingsDropdown #themeToggleBtn
 *            #themeSubmenu #viewKeyBtn #shareBtn #deleteAccountBtn #logoutBtn
 *            .theme-option[data-theme]
 *   panel    #addSlideBtn #slideThumbs
 *   toolbar  #toolSelectBtn #toolTextBtn #toolDrawBtn #imageBtn #imageFileInput
 *            #toolShapeBtn #shapeIconHolder #shapeDropdown (items data-tool:
 *            rect/ellipse/triangle/line)
 *            #fontFamilySelect #fontSizeInput #charSpacingInput #textBoldBtn
 *            #textItalicBtn #textUnderlineBtn #textStrikeBtn
 *            #textAlignBtn #alignIconHolder #alignDropdown (items data-align)
 *            #fillColorInput #strokeColorInput #strokeWidthInput #opacityInput
 *            #filtersBtn #filtersDropdown #clearFiltersBtn
 *            #arrangeBtn #arrangeDropdown — holds the arrange items under
 *            their original ids (#bringForwardBtn #sendBackwardBtn #flipXBtn
 *            #flipYBtn #centerHBtn #centerVBtn #groupBtn #ungroupBtn)
 *            #duplicateBtn #deleteBtn #zoomOutBtn #zoomValue #zoomInBtn
 *            #zoomFitBtn
 *   stage    #slideSurface #slideCanvas
 *   present  #presentOverlay #presentCanvas #presentExitBtn #presentPrevBtn
 *            #presentCounter #presentNextBtn
 *   modals   #loadingOverlay #notification #keyModal #keyText #keyCopyBtn
 *            #keyCopyFeedback #keyModalClose #keyModalCloseBtn
 *            #deleteAccountModal #deleteAccountModalClose #cancelDeleteAccount
 *            #confirmDeleteAccount #renameModal #renameModalClose #renameInput
 *            #renameCancelBtn #renameConfirmBtn #shareModal #shareModalClose
 *            #shareDeckName #shareUrlInput #copyShareUrlBtn #copyButtonText
 *            #shareModalCloseBtn
 *
 * LOAD ORDER (editor.html): config.js -> auth.js -> storage.js -> themes.js
 * -> editor.js. Everything runs after DOMContentLoaded.
 * ================================================
 */

// ================================================
// State
// ================================================

const editorState = {
    deck: null,             // deck record (see schema in js/storage.js)
    deckId: null,           // from ?id= (the inline auth check guarantees it)
    currentSlideIndex: 0,
    canvas: null,           // the fabric.Canvas instance
    activeTool: 'select',   // 'select' | 'text' | 'rect' | 'ellipse' | 'triangle' | 'line' | 'draw'
    zoom: 1,
    isDirty: false,
    isSaving: false,
    undoStack: [],          // JSON strings of the CURRENT slide's objects
    redoStack: [],
    isRestoring: false,     // true while undo/redo reloads the canvas (don't re-record)
    autoSaveTimer: null,
    presentIndex: 0,
    thumbCanvas: null,
    presentCanvas: null
};

let undoSnapshotTimer = null;
let notificationTimer = null;

// ================================================
// Boot
// ================================================



async function init() {
    setLoading(true);
    editorState.deckId = new URLSearchParams(location.search).get('id');
    if (!slidesAuth.getSession()) {
        goToWorkdeck();
        return;
    }

    slidesThemeManager.init();

    await document.fonts.ready;

    editorState.deck = await slidesStorage.getDeck(editorState.deckId);
    if (!editorState.deck) {
        showNotification('Deck not found', true);
        goToWorkdeck();
        return;
    }

    const userData = await slidesStorage.loadUserData();
    if (userData && userData.settings && userData.settings.theme) {
        slidesThemeManager.applyFromServer(userData.settings.theme);
    }

    initCanvas();

    $('deckTitle').textContent = editorState.deck.name;

    loadSlide(0);
    buildThumbs();
    zoomToFit();

    bindToolbar();
    bindTopNav();
    bindModals();
    bindKeyboard();
    startAutoSave();

    setLoading(false);

    offerTemplatesForNewDeck();
}

document.addEventListener('DOMContentLoaded', init);

// ================================================
// Fabric canvas
// ================================================

function initCanvas() {
    editorState.canvas = new fabric.Canvas('slideCanvas', {
        width: APP_CONFIG.slide.width,       // logical size; CSS zoom is separate
        height: APP_CONFIG.slide.height,
        background: '#ffffff',               // v6 renamed backgroundColor -> background
        selection: true,                     // rubber-band multi-select
        preserveObjectStacking: true         // keep z-order on select
      });

      const onObjectChanged = () => {
        if (editorState.isRestoring) return;
        recordUndoSnapshot();
        markDirty();
        syncCurrentSlideFromCanvas();
        renderThumb(editorState.currentSlideIndex);
      };
    editorState.canvas.on('object:added', onObjectChanged);
    editorState.canvas.on('object:removed', onObjectChanged);
    editorState.canvas.on('object:modified', onObjectChanged);

    editorState.canvas.on('selection:created', syncToolbarFromSelection);
    editorState.canvas.on('selection:updated', syncToolbarFromSelection);
    editorState.canvas.on('selection:cleared', syncToolbarFromSelection);

    editorState.canvas.on('mouse:down', (opt) => {
        // 'draw' is handled by isDrawingMode/PencilBrush, not insert-at-pointer
        if (editorState.activeTool !== 'select' && editorState.activeTool !== 'draw') {
            insertObjectAtPointer(opt);
        }
    });
}

/**
 * Render slide `index` onto the stage.
 */
function loadSlide(index, skipSync = false) {
    if (!skipSync) {
        syncCurrentSlideFromCanvas();
      }

    const slide = editorState.deck.slides[index];
    if (!slide) return;

    editorState.currentSlideIndex = index;
    editorState.undoStack = [];
    editorState.redoStack = [];
    clearTimeout(undoSnapshotTimer);

    editorState.isRestoring = true;

    return editorState.canvas.loadFromJSON({ objects: slide.objects || [] }).then(() => {
        editorState.canvas.background = slide.background;
        editorState.canvas.discardActiveObject();
        editorState.canvas.requestRenderAll();
        editorState.isRestoring = false;

        updateThumbsActiveState();
    });
}

/**
 * Copy the canvas back into the current slide record (save direction).
 */
function syncCurrentSlideFromCanvas() {
    const slide = editorState.deck.slides[editorState.currentSlideIndex];
    if(!slide) return;

    slide.objects = editorState.canvas.toObject().objects;
    slide.background = editorState.canvas.background;
}

// ================================================
// Slide management (sorter panel)
// ================================================

/**
 * Push a blank slide after the current one and switch to it
 */
function addSlide() {
    const n = editorState.deck.slides.length;
    const newSlide = {
        id: 's'+ Date.now().toString(36),
        name: 'Slide ' + (n + 1),
        background: APP_CONFIG.slide.defaultBackground,
        objects: []
    };
    editorState.deck.slides.splice(editorState.currentSlideIndex + 1, 0, newSlide);
    loadSlide(editorState.currentSlideIndex + 1);
    buildThumbs();
    markDirty();
}

/**
 * Clone the current slide right after it (deep-copy objects via JSON
 * round-trip so the two slides never share object references).
 */
function duplicateSlide(index) {
    const source = editorState.deck.slides[index];
    if(!source) return;
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = 's' + Date.now().toString(36);
    copy.name = source.name + ' copy';

    editorState.deck.slides.splice(index +1, 0, copy);

    loadSlide(index + 1);
    buildThumbs();
    markDirty();
}

/**
 * Delete slide `index` — keep at least ONE slide (block + notify).
 */
function deleteSlide(index) {
    const slides = editorState.deck.slides;
    if(slides.length<=1){
        showNotification('A deck needs at least 1 slide', true);
        return;
    }
    const deletingCurrentSlide = index === editorState.currentSlideIndex;
    slides.splice(index,1);
    if(editorState.currentSlideIndex >= slides.length){
        editorState.currentSlideIndex = slides.length-1;
    } else if (editorState.currentSlideIndex > index){
        editorState.currentSlideIndex -=1;
    }
    loadSlide(editorState.currentSlideIndex,deletingCurrentSlide);
    buildThumbs();
    markDirty();

}

/**
 * Render the sorter
 */

//inline SVG icons
const DUPLICATE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const DELETE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

function buildThumbs() {
    $('slideThumbs').innerHTML = editorState.deck.slides.map((slide, i) => `
          <li class="thumb-card${i === editorState.currentSlideIndex ? ' active' : ''}" data-slide-id="${slide.id}">
              <img class="thumb-img" alt="">
              <span class="thumb-num">${i + 1}</span>
              <div class="thumb-actions">
                  <button class="thumb-act-btn" data-action="duplicate" title="Duplicate slide">${DUPLICATE_ICON}</button>
                  <button class="thumb-act-btn" data-action="delete" title="Delete slide">${DELETE_ICON}</button>
              </div>
          </li>
      `).join('');
      editorState.deck.slides.forEach((slide, i) => renderThumb(i));

      document.querySelectorAll('.thumb-card').forEach((card) => {
          card.addEventListener('click', (e) => {
              const index = editorState.deck.slides.findIndex(
                  (s) => s.id === card.dataset.slideId
              );
              const actionBtn = e.target.closest('.thumb-act-btn');

              if (actionBtn && index !== -1) {
                  if (actionBtn.dataset.action === 'duplicate') {
                      duplicateSlide(index);
                  } else {
                      deleteSlide(index);
                  }
              } else if (index !== -1) {
                  loadSlide(index);
              }
          });
        });
}

/**
 * Re-render ONE thumbnail (after edits on the current slide).
 */
function renderThumb(index) {
    const slide = editorState.deck.slides[index];
    if (!slide) return;

    if (!editorState.thumbCanvas){
        editorState.thumbCanvas = new fabric.StaticCanvas(undefined, {
            width: APP_CONFIG.slide.width,
            height: APP_CONFIG.slide.height
        });
    }
    const thumbCanvas = editorState.thumbCanvas;
    thumbCanvas.loadFromJSON({objects: slide.objects || []}).then(() => {
        thumbCanvas.background = slide.background;
        thumbCanvas.renderAll();

        const dataUrl = thumbCanvas.toDataURL({ format: 'png', multiplier: 0.2 });
        const card = document.querySelector(`.thumb-card[data-slide-id="${slide.id}"]`);
          if (card) {
              card.querySelector('.thumb-img').src = dataUrl;
          }
    });
}

/** Toggle .active on the thumb matching currentSlideIndex. */
function updateThumbsActiveState() {
    const currentSlide = editorState.deck.slides[editorState.currentSlideIndex];
    if (!currentSlide) return;

    document.querySelectorAll('.thumb-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.slideId === currentSlide.id);
    });
}

// ================================================
// Toolbar
// ================================================

function toggleBold() {
    const obj = editorState.canvas.getActiveObjects()[0];
    if (!obj) return;

    const isBold = obj.fontWeight === 700 || obj.fontWeight === '700';
    applyToSelection('fontWeight', isBold ? 400 : 700);
}

function toggleItalic() {
    const obj = editorState.canvas.getActiveObjects()[0];
    if (!obj) return;

    const isItalic = obj.fontStyle === 'italic';
    applyToSelection('fontStyle', isItalic ? 'normal' : 'italic');
}

function toggleUnderline() {
    const obj = editorState.canvas.getActiveObjects()[0];
    if (!obj) return;

    const isUnderlined = obj.underline === true;
    applyToSelection('underline', !isUnderlined);
}

function toggleStrikethrough() {
    const obj = editorState.canvas.getActiveObjects()[0];
    if (!obj) return;

    applyToSelection('linethrough', !obj.linethrough);
}

function bindTextControls() {
    $('fontFamilySelect').addEventListener('change', () => {
        applyToSelection('fontFamily', $('fontFamilySelect').value);
    });

    $('fontSizeInput').addEventListener('change', () => {
        applyToSelection('fontSize', Number($('fontSizeInput').value));
    });

    $('textBoldBtn').addEventListener('click', toggleBold);
    $('textItalicBtn').addEventListener('click', toggleItalic);
    $('textUnderlineBtn').addEventListener('click', toggleUnderline);
    $('textStrikeBtn').addEventListener('click', toggleStrikethrough);

    // text alignment lives in the Align dropdown (bindAlignDropdown)

    $('charSpacingInput').addEventListener('change', () => {
        applyToSelection('charSpacing', Number($('charSpacingInput').value));
    });
}

function bindStyleControls() {
    $('fillColorInput').addEventListener('input', () => {
        applyToSelection('fill', $('fillColorInput').value);
    });

    $('strokeColorInput').addEventListener('input', () => {
        applyToSelection('stroke', $('strokeColorInput').value);
        // the pencil brush draws with the border color too
        if (editorState.canvas.isDrawingMode) {
            editorState.canvas.freeDrawingBrush.color = $('strokeColorInput').value;
        }
    });

    $('strokeWidthInput').addEventListener('change', () => {
        applyToSelection('strokeWidth', Number($('strokeWidthInput').value));
        if (editorState.canvas.isDrawingMode) {
            editorState.canvas.freeDrawingBrush.width =
                Math.max(1, Number($('strokeWidthInput').value) || 2);
        }
    });

    $('opacityInput').addEventListener('input', () => {
        applyToSelection('opacity', Number($('opacityInput').value) / 100);
    });
}

function bindToolbar() {
    bindToolModeButtons();
    bindShapeDropdown();
    bindImageInsert();
    bindTextControls();
    bindAlignDropdown();
    bindStyleControls();
    bindArrangeControls();
    bindTransformControls();
    bindGroupControls();
    bindEditButtons();
    bindFiltersMenu();
    bindZoomControls();

    // the menus are viewport-anchored (fixed), so a toolbar scroll or window
    // resize would leave them stranded — just close them
    document.querySelector('.toolbar').addEventListener('scroll', () => closeAllToolbarDropdowns());
    window.addEventListener('resize', () => closeAllToolbarDropdowns());
}

function bindToolModeButtons() {
    Object.keys(TOOL_BUTTON_IDS).forEach((name) => {
        $(TOOL_BUTTON_IDS[name]).addEventListener('click', () => {
            setActiveTool(name);
        });
    });
}

/**
 * Insert an object where the user clicked 
 */

const TOOL_BUTTON_IDS = {
    select: 'toolSelectBtn',
    text: 'toolTextBtn',
    draw: 'toolDrawBtn'
};

// insert tools that live inside the Shapes dropdown
const SHAPE_TOOLS = ['rect', 'ellipse', 'triangle', 'line'];

function setActiveTool(tool) {
    editorState.activeTool = tool;

    Object.keys(TOOL_BUTTON_IDS).forEach((name) => {
        $(TOOL_BUTTON_IDS[name]).classList.toggle('active', name === tool);
    });

    // the Shapes button stands in for the rect/ellipse/triangle/line tools —
    // mirror the armed shape's icon and light the button while it's active
    const isShape = SHAPE_TOOLS.includes(tool);
    $('toolShapeBtn').classList.toggle('active', isShape);
    if (isShape) {
        setShapeIcon(tool);
    }

    // 'draw' hands the pointer to fabric's freehand engine; every other
    // tool runs with isDrawingMode off
    const isDraw = tool === 'draw';
    editorState.canvas.isDrawingMode = isDraw;
    if (isDraw) {
        configureFreehandBrush();
    }

    editorState.canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
}

/**
 * Build the freehand brush from the current border color/width inputs.
 * Called on entering draw mode and when those inputs change mid-mode.
 */
function configureFreehandBrush() {
    const brush = new fabric.PencilBrush(editorState.canvas);
    brush.color = $('strokeColorInput').value;
    brush.width = Math.max(1, Number($('strokeWidthInput').value) || 2);
    brush.decimate = 2;
    editorState.canvas.freeDrawingBrush = brush;
}

// ================================================
// Toolbar dropdowns (Shapes, Alignment)
// ================================================

/** Copy a dropdown item's svg onto a dropdown button's icon holder. */
function mirrorDropdownIcon(dropdownId, selector, holderId) {
    const item = document.querySelector(`#${dropdownId} ${selector}`);
    if (item && item.querySelector('svg')) {
        $(holderId).innerHTML = item.querySelector('svg').outerHTML;
    }
}

function setShapeIcon(tool) {
    mirrorDropdownIcon('shapeDropdown', `[data-tool="${tool}"]`, 'shapeIconHolder');
}

function setAlignIcon(align) {
    mirrorDropdownIcon('alignDropdown', `[data-align="${align}"]`, 'alignIconHolder');
}

/** Anchor a toolbar dropdown below its trigger. The menus are position:fixed
 * because the toolbar's overflow-x scroll would clip absolute children. */
function positionToolbarDropdown(button, dropdown) {
    const r = button.getBoundingClientRect();
    dropdown.style.top = `${r.bottom + 6}px`;
    dropdown.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - dropdown.offsetWidth - 8))}px`;
}

/** Toggle one toolbar dropdown; outside clicks close everything. */
function bindDropdownToggle(buttonId, dropdownId) {
    const button = $(buttonId);
    const dropdown = $(dropdownId);
    button.addEventListener('click', () => {
        closeAllToolbarDropdowns(dropdownId);
        if (dropdown.classList.toggle('open')) {
            positionToolbarDropdown(button, dropdown);
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.tool-dropdown-menu')) {
            $(dropdownId).classList.remove('open');
        }
    });
}

function closeAllToolbarDropdowns(exceptId) {
    document.querySelectorAll('.tool-dropdown.open, #filtersDropdown.open').forEach((menu) => {
        if (menu.id !== exceptId) {
            menu.classList.remove('open');
        }
    });
}

function bindShapeDropdown() {
    bindDropdownToggle('toolShapeBtn', 'shapeDropdown');

    document.querySelectorAll('#shapeDropdown [data-tool]').forEach((item) => {
        item.addEventListener('click', () => {
            setActiveTool(item.dataset.tool);
            closeAllToolbarDropdowns();
        });
    });

    setShapeIcon('rect');   // default face for the Shapes button
}

function bindAlignDropdown() {
    bindDropdownToggle('textAlignBtn', 'alignDropdown');

    document.querySelectorAll('#alignDropdown [data-align]').forEach((item) => {
        item.addEventListener('click', () => {
            applyToSelection('textAlign', item.dataset.align);
            setAlignIcon(item.dataset.align);
            closeAllToolbarDropdowns();
        });
    });

    setAlignIcon('left');
}

function insertObjectAtPointer(opt) {
   const p = opt.scenePoint;
    let obj = null;

    switch (editorState.activeTool) {
        case 'text':
            obj = new fabric.Textbox('Text', {
                left: p.x, top: p.y, width: 320,
                fontSize: 24, fontFamily: 'Inter', fill: '#1a1a1a'
            });
            break;
        case 'rect':
            obj = new fabric.Rect({
                left: p.x, top: p.y, width: 160, height: 100,
                fill: '#fed7aa', rx: 4, ry: 4
            });
            break;
        case 'ellipse':
            obj = new fabric.Ellipse({ left: p.x, top: p.y, rx: 80, ry: 50, fill: '#fed7aa' });
            break;
        case 'triangle':
            obj = new fabric.Triangle({ left: p.x, top: p.y, width: 120, height: 100, fill: '#fed7aa' });
            break;
        case 'line':
            obj = new fabric.Line([p.x, p.y, p.x + 160, p.y + 90], {
                stroke: '#1a1a1a', strokeWidth: 2
            });
            break;
    }

    if (!obj) return;

    editorState.canvas.add(obj);
    editorState.canvas.setActiveObject(obj);
    setActiveTool('select');
}


function bindImageInsert() {
    $('imageBtn').addEventListener('click', () => {
        $('imageFileInput').click();
    });

    $('imageFileInput').addEventListener('change', () => {
        const file = $('imageFileInput').files[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = (e) => {
            fabric.Image.fromURL(e.target.result).then((img) => {
                const maxWidth = APP_CONFIG.slide.width * 0.8;
                const maxHeight = APP_CONFIG.slide.height * 0.8;

                if (img.width > maxWidth) {
                    img.scaleToWidth(maxWidth);
                }
                if (img.getScaledHeight() > maxHeight) {
                    img.scaleToHeight(maxHeight);
                }

                img.set({
                    left: (APP_CONFIG.slide.width - img.getScaledWidth()) / 2,
                    top: (APP_CONFIG.slide.height - img.getScaledHeight()) / 2
                });

                editorState.canvas.add(img);
                editorState.canvas.setActiveObject(img);
            });
        };

        reader.readAsDataURL(file);
        $('imageFileInput').value = '';
    });
}


function toHexOrNull(value) {
    return typeof value === 'string' && value.startsWith('#') ? value : null;
}

function setToolGroupDisabled(group, disabled) {
    group.querySelectorAll('button, input, select').forEach((el) => {
        el.disabled = disabled;
    });
}

function syncToolbarFromSelection() {
    const activeObjects = editorState.canvas.getActiveObjects();
    const hasSelection = activeObjects.length > 0;

    setToolGroupDisabled($('fontFamilySelect').closest('.tool-group'), !hasSelection);
    setToolGroupDisabled($('deleteBtn').closest('.tool-group'), !hasSelection);
    syncFiltersMenu();

    if (!hasSelection) return;

    const obj = activeObjects[0];

    if (obj.isType('textbox')) {
        $('fontFamilySelect').value = obj.fontFamily;
        $('fontSizeInput').value = obj.fontSize;
        $('charSpacingInput').value = obj.charSpacing || 0;
        setAlignIcon(obj.textAlign || 'left');

        $('textBoldBtn').classList.toggle('active', obj.fontWeight === 700 || obj.fontWeight === '700');
        $('textItalicBtn').classList.toggle('active', obj.fontStyle === 'italic');
        $('textUnderlineBtn').classList.toggle('active', obj.underline === true);
        $('textStrikeBtn').classList.toggle('active', obj.linethrough === true);
    }

    $('fillColorInput').value = toHexOrNull(obj.fill) || '#1a1a1a';
    $('strokeColorInput').value = toHexOrNull(obj.stroke) || '#000000';
    $('strokeWidthInput').value = obj.strokeWidth || 0;
    $('opacityInput').value = Math.round((obj.opacity ?? 1) * 100);
}

/**
 * Apply a property change to EVERY active object 
 */
function applyToSelection(prop, value) {
    const activeObjects = editorState.canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    activeObjects.forEach((obj) => obj.set(prop, value));

    editorState.canvas.requestRenderAll();
    syncCurrentSlideFromCanvas();
    renderThumb(editorState.currentSlideIndex);
    markDirty();
}

function bindArrangeControls() {
    // the Arrange dropdown button itself (items below keep their own bindings)
    bindDropdownToggle('arrangeBtn', 'arrangeDropdown');

    $('bringForwardBtn').addEventListener('click', () => {
        const obj = editorState.canvas.getActiveObject();
        if (!obj) return;

        editorState.canvas.bringObjectForward(obj);
        syncCurrentSlideFromCanvas();
        renderThumb(editorState.currentSlideIndex);
        markDirty();
    });

    $('sendBackwardBtn').addEventListener('click', () => {
        const obj = editorState.canvas.getActiveObject();
        if (!obj) return;

        editorState.canvas.sendObjectBackwards(obj);
        syncCurrentSlideFromCanvas();
        renderThumb(editorState.currentSlideIndex);
        markDirty();
    });
}


/**
 * Flip every active object along an axis. Per-object toggle (not a fixed
 * value) so mixed selections stay correct.
 */
function flipSelection(prop) {
    const activeObjects = editorState.canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    activeObjects.forEach((obj) => obj.set(prop, !obj[prop]));

    editorState.canvas.requestRenderAll();
    syncCurrentSlideFromCanvas();
    renderThumb(editorState.currentSlideIndex);
    markDirty();
}

/**
 * Center the active object (single or multi-select) on the slide.
 * axis: 'h' | 'v'
 */
function centerSelection(axis) {
    const obj = editorState.canvas.getActiveObject();
    if (!obj) return;

    if (axis === 'h') {
        editorState.canvas.centerObjectH(obj);
    } else {
        editorState.canvas.centerObjectV(obj);
    }
    obj.setCoords();

    editorState.canvas.requestRenderAll();
    syncCurrentSlideFromCanvas();
    renderThumb(editorState.currentSlideIndex);
    markDirty();
}

function bindTransformControls() {
    $('flipXBtn').addEventListener('click', () => flipSelection('flipX'));
    $('flipYBtn').addEventListener('click', () => flipSelection('flipY'));
    $('centerHBtn').addEventListener('click', () => centerSelection('h'));
    $('centerVBtn').addEventListener('click', () => centerSelection('v'));
}


function groupSelection() {
    const activeObject = editorState.canvas.getActiveObject();
    if (!activeObject || editorState.canvas.getActiveObjects().length < 2) return;

    // take the children out of the multi-select, then group them for real
    const objects = activeObject.getObjects();

    editorState.canvas.discardActiveObject();
    objects.forEach((obj) => editorState.canvas.remove(obj));

    const group = new fabric.Group(objects);
    editorState.canvas.add(group);
    editorState.canvas.setActiveObject(group);
}

function ungroupSelection() {
    const group = editorState.canvas.getActiveObject();
    if (!group || !group.isType('group')) return;

    // removeAll() detaches the children; re-add them to the canvas as
    // independent objects, then drop the now-empty group
    const objects = group.removeAll();

    editorState.canvas.remove(group);
    objects.forEach((obj) => editorState.canvas.add(obj));
    editorState.canvas.discardActiveObject();
}

function bindGroupControls() {
    $('groupBtn').addEventListener('click', groupSelection);
    $('ungroupBtn').addEventListener('click', ungroupSelection);
}

function duplicateSelection() {
    const activeObjects = editorState.canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    const activeObject = editorState.canvas.getActiveObject();

    activeObject.clone().then((clone) => {
        if (activeObjects.length > 1) {
            const clones = clone.getObjects();
            clones.forEach((obj) => {
                obj.set({ left: (obj.left || 0) + 16, top: (obj.top || 0) + 16 });
                editorState.canvas.add(obj);
            });

            const group = new fabric.ActiveSelection(clones, { canvas: editorState.canvas });
            editorState.canvas.setActiveObject(group);
        } else {
            clone.set({ left: (clone.left || 0) + 16, top: (clone.top || 0) + 16 });
            editorState.canvas.add(clone);
            editorState.canvas.setActiveObject(clone);
        }
    });
}

function deleteSelection() {
    const activeObjects = editorState.canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    editorState.canvas.discardActiveObject();

    activeObjects.forEach((obj) => editorState.canvas.remove(obj));
}

function bindEditButtons() {
    $('duplicateBtn').addEventListener('click', duplicateSelection);
    $('deleteBtn').addEventListener('click', deleteSelection);
}

// ================================================
// Image filters (fabric.filters — applies to images only)
// ================================================

/**
 * One-tap filters for the selected image(s). Blur/Pixelate get explicit
 * strengths — their raw defaults (blur 0 / 1px blocks) would be invisible.
 */
const FILTER_FACTORIES = {
    Grayscale: () => new fabric.filters.Grayscale(),
    Sepia: () => new fabric.filters.Sepia(),
    Invert: () => new fabric.filters.Invert(),
    Blur: () => new fabric.filters.Blur({ blur: 0.15 }),
    Pixelate: () => new fabric.filters.Pixelate({ blocksize: 6 })
};

function getSelectedImages() {
    return editorState.canvas.getActiveObjects().filter((obj) => obj.isType('image'));
}

/**
 * applyFilters() fires NO canvas event, so this does the sync/undo/thumb
 * bookkeeping that object:modified would normally do.
 */
function afterFilterChange() {
    editorState.canvas.requestRenderAll();
    syncCurrentSlideFromCanvas();
    recordUndoSnapshot();
    renderThumb(editorState.currentSlideIndex);
    markDirty();
}

/** Toggle one filter on every selected image, then refresh the menu checks. */
function toggleFilter(name) {
    const images = getSelectedImages();
    if (images.length === 0) return;

    images.forEach((img) => {
        const existing = img.filters.find((f) => f.type === name);
        if (existing) {
            img.filters = img.filters.filter((f) => f !== existing);
        } else {
            img.filters.push(FILTER_FACTORIES[name]());
        }
        img.applyFilters();
    });

    afterFilterChange();
    syncFiltersMenu();
}

function clearFilters() {
    const images = getSelectedImages();
    if (images.length === 0) return;

    images.forEach((img) => {
        img.filters = [];
        img.applyFilters();
    });

    afterFilterChange();
    syncFiltersMenu();
}

/**
 * Reflect the selection in the toolbar: enable/disable the whole group and
 * mark which filters are active. The menu stays open on filter clicks so
 * filters can be stacked.
 */
function syncFiltersMenu() {
    const images = getSelectedImages();
    setToolGroupDisabled($('filtersBtn').closest('.tool-group'), images.length === 0);

    if (images.length === 0) {
        $('filtersDropdown').classList.remove('open');
        return;
    }

    document.querySelectorAll('#filtersDropdown [data-filter]').forEach((item) => {
        const on = images.some((img) => img.filters.some((f) => f.type === item.dataset.filter));
        item.classList.toggle('active', on);
    });
}

function bindFiltersMenu() {
    $('filtersBtn').addEventListener('click', () => {
        closeAllToolbarDropdowns('filtersDropdown');
        if ($('filtersDropdown').classList.toggle('open')) {
            positionToolbarDropdown($('filtersBtn'), $('filtersDropdown'));
        }
    });

    document.querySelectorAll('#filtersDropdown [data-filter]').forEach((item) => {
        item.addEventListener('click', () => toggleFilter(item.dataset.filter));
    });

    $('clearFiltersBtn').addEventListener('click', clearFilters);

    // close the menu when clicking anywhere else (same pattern as the export menu)
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.filters-menu')) {
            $('filtersDropdown').classList.remove('open');
        }
    });
}

// ================================================
// Zoom
// ================================================


function applyZoom(z) {
    editorState.zoom = Math.min(3, Math.max(0.25, z));

    editorState.canvas.setDimensions({
        width: APP_CONFIG.slide.width * editorState.zoom,
        height: APP_CONFIG.slide.height * editorState.zoom
    });
    editorState.canvas.setZoom(editorState.zoom);

    // grow the white "paper" wrapper with the canvas
    $('slideSurface').style.width = (APP_CONFIG.slide.width * editorState.zoom) + 'px';
    $('slideSurface').style.height = (APP_CONFIG.slide.height * editorState.zoom) + 'px';

    $('zoomValue').textContent = Math.round(editorState.zoom * 100) + '%';
}

/** zoomIn/zoomOut: applyZoom(zoom ± 0.1). */
function bindZoomControls() {
    $('zoomInBtn').addEventListener('click', () => applyZoom(editorState.zoom + 0.1));
    $('zoomOutBtn').addEventListener('click', () => applyZoom(editorState.zoom - 0.1));
    $('zoomFitBtn').addEventListener('click', zoomToFit);

    // create the debounced wrapper ONCE (a fresh one per event would never cancel anything)
    const onStageResize = debounce(zoomToFit, 200);
    window.addEventListener('resize', onStageResize);
}

function zoomToFit() {
    const stage = document.querySelector('.canvas-stage');
    const availableWidth = stage.clientWidth - 56;   // .canvas-stage has 28px padding each side
    const availableHeight = stage.clientHeight - 56;

    if (availableWidth <= 0 || availableHeight <= 0) return;

    const zoom = Math.min(
        availableWidth / APP_CONFIG.slide.width,
        availableHeight / APP_CONFIG.slide.height
    );
    applyZoom(zoom);
}

// ================================================
// Undo / redo
// ================================================


function recordUndoSnapshot() {
    if (editorState.isRestoring) return;

    clearTimeout(undoSnapshotTimer);
    undoSnapshotTimer = setTimeout(() => {
        const snapshot = JSON.stringify(editorState.canvas.toObject().objects);

        editorState.undoStack.push(snapshot);
        if (editorState.undoStack.length > 50) {
            editorState.undoStack.shift();
        }
        editorState.redoStack = [];
    }, 300);
}


function restoreObjects(json) {
    editorState.isRestoring = true;

    editorState.canvas.loadFromJSON({ objects: JSON.parse(json) }).then(() => {
        editorState.canvas.discardActiveObject();
        editorState.canvas.requestRenderAll();

        editorState.isRestoring = false;

        markDirty();
        renderThumb(editorState.currentSlideIndex);
    });
}

function undo() {
    if (editorState.isRestoring || editorState.undoStack.length === 0) return;

    const previousState = editorState.undoStack.pop();
    editorState.redoStack.push(JSON.stringify(editorState.canvas.toObject().objects));

    restoreObjects(previousState);
}

function redo() {
    if (editorState.isRestoring || editorState.redoStack.length === 0) return;

    const nextState = editorState.redoStack.pop();
    editorState.undoStack.push(JSON.stringify(editorState.canvas.toObject().objects));

    restoreObjects(nextState);
}

// ================================================
// Keyboard shortcuts
// ================================================


function nudgeSelection(e) {
    const activeObject = editorState.canvas.getActiveObject();
    if (!activeObject) return;

    const moves = {
        arrowleft: ['left', -1],
        arrowright: ['left', 1],
        arrowup: ['top', -1],
        arrowdown: ['top', 1]
    };
    const move = moves[e.key.toLowerCase()];
    if (!move) return;

    e.preventDefault();

    const delta = move[1] * (e.shiftKey ? 10 : 1);
    activeObject.set(move[0], activeObject[move[0]] + delta);
    activeObject.setCoords();
    editorState.canvas.requestRenderAll();
    syncCurrentSlideFromCanvas();
    markDirty();
}

function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
        // --- present mode has its own navigation keys ---
        if (!$('presentOverlay').classList.contains('hidden')) {
            if (e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault();
                presentNext();
            } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
                e.preventDefault();
                presentPrev();
            } else if (e.key === 'Escape') {
                exitPresentMode();
            }
            return;
        }

        // --- typing must never trigger shortcuts ---
        const tagName = (e.target.tagName || '').toLowerCase();
        const editingText = editorState.canvas.getActiveObject()?.isEditing;
        if (tagName === 'input' || tagName === 'select' || tagName === 'textarea' || editingText) {
            return;
        }

        const key = e.key.toLowerCase();
        const mod = e.ctrlKey || e.metaKey;

        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            deleteSelection();
        } else if (mod && key === 'd') {
            e.preventDefault();
            duplicateSelection();
        } else if (mod && key === 'z') {
            e.preventDefault();
            if (e.shiftKey) { redo(); } else { undo(); }
        } else if (mod && key === 'y') {
            e.preventDefault();
            redo();
        } else if (mod && key === 's') {
            e.preventDefault();
            if (e.shiftKey) { toggleStrikethrough(); } else { saveDeck(); }
        } else if (mod && key === 'g') {
            e.preventDefault();
            if (e.shiftKey) { ungroupSelection(); } else { groupSelection(); }
        } else if (mod && key === 'b') {
            e.preventDefault();
            toggleBold();
        } else if (mod && key === 'i') {
            e.preventDefault();
            toggleItalic();
        } else if (mod && key === 'u') {
            e.preventDefault();
            toggleUnderline();
        } else if (!mod && e.key.startsWith('Arrow')) {
            nudgeSelection(e);
        } else if (!mod && 'vtrolp'.includes(key)) {
            const toolFor = { v: 'select', t: 'text', r: 'rect', o: 'ellipse', l: 'line', p: 'draw' };
            setActiveTool(toolFor[key]);
        } else if (key === 'escape') {
            editorState.canvas.discardActiveObject();
        }
    });
}

// ================================================
// Load / save / autosave
// ================================================


function onBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = '';   // legacy flag — Chrome needs this to show the dialog
  }
function markDirty() {
    editorState.isDirty = true;
    $('saveState').textContent = 'Unsaved changes…';
    window.addEventListener('beforeunload', onBeforeUnload)
}

/**
 * The save path (Ctrl+S, autosave, and beforeunload best-effort)
 */
async function saveDeck() {
    if (editorState.isSaving || !editorState.isDirty) return;

    editorState.isSaving = true;
    $('saveState').textContent = 'Saving…';

    syncCurrentSlideFromCanvas();

    const ok = await slidesStorage.saveDeck(editorState.deck.id, editorState.deck);

    if (ok) {
        editorState.isDirty = false;

        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        $('saveState').textContent = `Saved · ${hh}:${mm}`;

        // safe to close the tab — disarm the beforeunload guard
        window.removeEventListener('beforeunload', onBeforeUnload);
    } else {
        showNotification('Save failed — will retry automatically', true);
    }

    editorState.isSaving = false;
}

function startAutoSave() {
    editorState.autoSaveTimer = setInterval(() => {
        if (editorState.isDirty) {
            saveDeck();
        }
    }, APP_CONFIG.autoSave.interval);
}

// ================================================
// Present mode
// ================================================


function enterPresentMode() {
    syncCurrentSlideFromCanvas();
    editorState.presentIndex = editorState.currentSlideIndex;

    $('presentOverlay').classList.remove('hidden');
    
    const request = $('presentOverlay').requestFullscreen();
    if (request) {
        request.catch(() => {});
    }
   

    renderPresentSlide();
}

function presentNext() {
    if (editorState.presentIndex < editorState.deck.slides.length - 1) {
        editorState.presentIndex += 1;
        renderPresentSlide();
    }
}

function presentPrev() {
    if (editorState.presentIndex > 0) {
        editorState.presentIndex -= 1;
        renderPresentSlide();
    }
}

function renderPresentSlide() {
    const slide = editorState.deck.slides[editorState.presentIndex];
    if (!slide) return;

    const scale = Math.min(
        window.innerWidth / APP_CONFIG.slide.width,
        window.innerHeight / APP_CONFIG.slide.height
    );

    if (!editorState.presentCanvas) {
        editorState.presentCanvas = new fabric.StaticCanvas('presentCanvas');
    }
    const presentCanvas = editorState.presentCanvas;

    presentCanvas.setDimensions({
        width: APP_CONFIG.slide.width * scale,
        height: APP_CONFIG.slide.height * scale
    });
    presentCanvas.setZoom(scale);

    presentCanvas.loadFromJSON({ objects: slide.objects || [] }).then(() => {
        presentCanvas.background = slide.background;
        presentCanvas.renderAll();
    });

    $('presentCounter').textContent =
        `${editorState.presentIndex + 1} / ${editorState.deck.slides.length}`;
}

function exitPresentMode() {
    $('presentOverlay').classList.add('hidden');

    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
    editorState.canvas.requestRenderAll();
}

function bindPresentControls() {
    $('presentBtn').addEventListener('click', enterPresentMode);
    $('presentExitBtn').addEventListener('click', exitPresentMode);
    $('presentNextBtn').addEventListener('click', presentNext);
    $('presentPrevBtn').addEventListener('click', presentPrev);

    // re-letterbox while presenting when the window changes size
    window.addEventListener('resize', debounce(() => {
        if (!$('presentOverlay').classList.contains('hidden')) {
            renderPresentSlide();
        }
    }, 150));
}

// ================================================
// Export
// ================================================


function closeMenusOnOutsideClick() {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.export-menu')) {
            $('exportDropdown').classList.remove('open');
        }
        if (!e.target.closest('.top-nav-settings')) {
            $('settingsDropdown').classList.remove('open');
        }
    });
}

function bindExportMenu() {
    $('exportBtn').addEventListener('click', () => {
        $('exportDropdown').classList.toggle('open');
        $('settingsDropdown').classList.remove('open');
    });

    $('exportPngBtn').addEventListener('click', () => {
        $('exportDropdown').classList.remove('open');
        exportPng();
    });
    $('exportPdfBtn').addEventListener('click', () => {
        $('exportDropdown').classList.remove('open');
        exportPdf();
    });
    $('exportPptxBtn').addEventListener('click', () => {
        $('exportDropdown').classList.remove('open');
        exportPptx();
    });
}

/**
 * PNG — current slide at 2x for crispness:
 */
function deckFileName() {
    return editorState.deck.name || 'deck';
}

// Offscreen-render any slide to a PNG data URL (the renderThumb technique
// at an arbitrary multiplier). Async — loadFromJSON is promise-based.
async function renderSlideToPng(slide, multiplier) {
    const offscreen = new fabric.StaticCanvas(undefined, {
        width: APP_CONFIG.slide.width,
        height: APP_CONFIG.slide.height
    });

    await offscreen.loadFromJSON({ objects: slide.objects || [] });
    offscreen.background = slide.background;
    offscreen.renderAll();

    const dataUrl = offscreen.toDataURL({ format: 'png', multiplier });
    offscreen.dispose();
    return dataUrl;
}

function exportPng() {
    syncCurrentSlideFromCanvas();

    const dataUrl = editorState.canvas.toDataURL({ format: 'png', multiplier: 2 });

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${deckFileName()} - slide ${editorState.currentSlideIndex + 1}.png`;
    link.click();
}

/**
 * PDF — needs the jsPDF <script> 
 * For EACH slide: render it offscreen to PNG (reuse the thumbnail technique
 * at higher multiplier)
 */
async function exportPdf() {
    if (typeof window.jspdf === 'undefined') {
        showNotification('PDF export needs jsPDF — uncomment it in editor.html', true);
        return;
    }

    syncCurrentSlideFromCanvas();

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [APP_CONFIG.slide.width, APP_CONFIG.slide.height]
    });

    const slides = editorState.deck.slides;
    for (let i = 0; i < slides.length; i++) {
        showNotification(`Rendering slide ${i + 1} of ${slides.length}…`);
        const dataUrl = await renderSlideToPng(slides[i], 2);
        if (i > 0) {
            pdf.addPage();
        }
        pdf.addImage(dataUrl, 'PNG', 0, 0, APP_CONFIG.slide.width, APP_CONFIG.slide.height);
    }

    pdf.save(`${deckFileName()}.pdf`);
}

/**
 * PPTX — needs the PptxGenJS <script>
 */
// pptx colors are hex WITHOUT the '#'; map anything non-hex to a default
function hexNoHash(value) {
    const hex = toHexOrNull(value);
    return hex ? hex.slice(1) : '1a1a1a';
}

async function exportPptx() {
    if (typeof window.PptxGenJS === 'undefined') {
        showNotification('PPTX export needs PptxGenJS — uncomment it in editor.html', true);
        return;
    }

    syncCurrentSlideFromCanvas();

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'DECK', width: 10, height: 5.625 });
    pptx.layout = 'DECK';

    // deck pixels (960 wide) -> inches (10 wide)
    const S = 10 / APP_CONFIG.slide.width;

    // text + basic shapes + images map directly; anything else (groups,
    // lines, ...) falls back to a whole-slide PNG for that slide
    const DIRECT_TYPES = ['textbox', 'rect', 'ellipse', 'triangle', 'image'];

    for (const slide of editorState.deck.slides) {
        const objects = slide.objects || [];
        const pptxSlide = pptx.addSlide();
        pptxSlide.background = { color: hexNoHash(slide.background) };

        if (!objects.every((obj) => DIRECT_TYPES.includes(obj.type))) {
            const dataUrl = await renderSlideToPng(slide, 2);
            pptxSlide.addImage({ data: dataUrl, x: 0, y: 0, w: 10, h: 5.625 });
            continue;
        }

        for (const obj of objects) {
            const x = (obj.left || 0) * S;
            const y = (obj.top || 0) * S;
            const w = (obj.width || 0) * (obj.scaleX || 1) * S;
            const h = (obj.height || 0) * (obj.scaleY || 1) * S;

            if (obj.type === 'textbox' && obj.text) {
                pptxSlide.addText(obj.text, {
                    x, y, w, h,
                    fontSize: Math.max(8, Math.round((obj.fontSize || 24) * 0.75)),
                    fontFace: obj.fontFamily || 'Inter',
                    bold: obj.fontWeight === 700 || obj.fontWeight === '700',
                    italic: obj.fontStyle === 'italic',
                    align: obj.textAlign || 'left',
                    color: hexNoHash(obj.fill)
                });
            } else if (obj.type === 'rect') {
                pptxSlide.addShape(pptx.ShapeType.rect, {
                    x, y, w, h,
                    fill: { color: hexNoHash(obj.fill) },
                    line: obj.stroke ? { color: hexNoHash(obj.stroke), width: obj.strokeWidth || 0 } : undefined
                });
            } else if (obj.type === 'ellipse') {
                pptxSlide.addShape(pptx.ShapeType.ellipse, {
                    x, y,
                    w: 2 * (obj.rx || 0) * (obj.scaleX || 1) * S,
                    h: 2 * (obj.ry || 0) * (obj.scaleY || 1) * S,
                    fill: { color: hexNoHash(obj.fill) }
                });
            } else if (obj.type === 'triangle') {
                pptxSlide.addShape(pptx.ShapeType.triangle, {
                    x, y, w, h,
                    fill: { color: hexNoHash(obj.fill) }
                });
            } else if (obj.type === 'image' && obj.src) {
                pptxSlide.addImage({ data: obj.src, x, y, w, h });
            }
        }
    }

    await pptx.writeFile({ fileName: `${deckFileName()}.pptx` });
}

// ================================================
// Top nav: title, save, settings, share
// ================================================

function bindTopNav() {
    $('homeBtn').addEventListener('click', () => {
        saveDeck();            // best-effort; the beforeunload guard covers the rest
        goToWorkdeck();
    });

    $('saveBtn').addEventListener('click', saveDeck);
    $('deckTitle').addEventListener('click', openRenameModal);

    bindExportMenu();
    bindPresentControls();
    bindSettingsMenu();
    closeMenusOnOutsideClick();
}

function confirmRename() {
    const name = $('renameInput').value.trim() || 'Untitled deck';

    editorState.deck.name = name;
    $('deckTitle').textContent = name;

    closeModal($('renameModal'));
    markDirty();
    saveDeck();
}

function openRenameModal() {
    $('renameInput').value = editorState.deck.name || '';
    openModal($('renameModal'));
    $('renameInput').focus();
    $('renameInput').select();
}


function bindSettingsMenu() {
    $('themeText').textContent = 'Theme: ' + slidesThemeManager.getDisplayLabel();

    $('settingsBtn').addEventListener('click', () => {
        $('settingsDropdown').classList.toggle('open');
        $('exportDropdown').classList.remove('open');
    });

    $('themeToggleBtn').addEventListener('click', () => {
        $('themeSubmenu').classList.toggle('open');
    });

    document.querySelectorAll('.theme-option').forEach((option) => {
        option.addEventListener('click', () => {
            slidesThemeManager.setTheme(option.dataset.theme);
            $('themeText').textContent = 'Theme: ' + slidesThemeManager.getDisplayLabel();
        });
    });

    $('viewKeyBtn').addEventListener('click', () => {
        $('keyText').textContent = getSlidesUserKey() || '-';
        openModal($('keyModal'));
    });

    $('shareBtn').addEventListener('click', () => {
        $('settingsDropdown').classList.remove('open');
        openShareModal();
    });

    $('logoutBtn').addEventListener('click', () => {
        saveDeck();            // best-effort
        slidesAuth.logout();
    });

    $('deleteAccountBtn').addEventListener('click', () => {
        openModal($('deleteAccountModal'));
    });

    $('confirmDeleteAccount').addEventListener('click', async () => {
        const result = await slidesAuth.deleteAccount();
        if (!result.success) {
            showNotification(result.error || 'Failed to delete account', true);
        }
        // on success auth.js logs out and navigates home itself
    });
}

async function openShareModal() {
    const result = await slidesStorage.shareDeck(editorState.deck.id);
    if (!result) {
        showNotification('Could not create share link', true);
        return;
    }

    $('shareDeckName').textContent = editorState.deck.name;
    $('shareUrlInput').value = result.shareUrl;
    openModal($('shareModal'));
}


function openModal(el) {
    el.classList.add('open');
}

function closeModal(el) {
    el.classList.remove('open');
}

function bindModals() {
    // --- rename ---
    $('renameModalClose').addEventListener('click', () => closeModal($('renameModal')));
    $('renameCancelBtn').addEventListener('click', () => closeModal($('renameModal')));
    $('renameConfirmBtn').addEventListener('click', confirmRename);
    $('renameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmRename();
        }
    });

    // --- key modal ---
    $('keyModalClose').addEventListener('click', () => closeModal($('keyModal')));
    $('keyModalCloseBtn').addEventListener('click', () => closeModal($('keyModal')));
    $('keyCopyBtn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($('keyText').textContent);
            $('keyCopyFeedback').textContent = 'Copied!';
            setTimeout(() => {
                $('keyCopyFeedback').textContent = '';
            }, 1500);
        } catch (err) {
            showNotification('Copy failed — select the key manually', true);
        }
    });

    // --- delete account ---
    $('deleteAccountModalClose').addEventListener('click', () => closeModal($('deleteAccountModal')));
    $('cancelDeleteAccount').addEventListener('click', () => closeModal($('deleteAccountModal')));

    // --- share ---
    $('shareModalClose').addEventListener('click', () => closeModal($('shareModal')));
    $('shareModalCloseBtn').addEventListener('click', () => closeModal($('shareModal')));
    $('copyShareUrlBtn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($('shareUrlInput').value);
            $('copyShareUrlBtn').classList.add('copied');
            $('copyButtonText').textContent = 'Copied';
            setTimeout(() => {
                $('copyShareUrlBtn').classList.remove('copied');
                $('copyButtonText').textContent = 'Copy';
            }, 1500);
        } catch (err) {
            showNotification('Copy failed', true);
        }
    });
    
    ['keyModal', 'deleteAccountModal', 'renameModal', 'shareModal'].forEach((id) => {
        $(id).addEventListener('click', (e) => {
            if (e.target === $(id)) {
                closeModal($(id));
            }
        });
    });
}

// ================================================
// Utilities
// ================================================

function $(id) {
    return document.getElementById(id);
}


function showNotification(message, isError = false) {
    const el = $('notification');
    el.textContent = message;
    el.classList.toggle('error',isError);
    el.classList.add('show');

    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        el.classList.remove('show');
    }, 2500);
}

/** #loadingOverlay .hidden toggle. */
function setLoading(isLoading) {
    $('loadingOverlay').classList.toggle('hidden', !isLoading);
}

/** Standard debounce for resize/undo-snapshot bursts. */
function debounce(fn, waitMs) {
    let timer = null;
    return function(){
        clearTimeout(timer);
        timer = setTimeout(fn,waitMs);
    }
}

// ================================================
// Templates ("new deck" flow)
// ================================================


async function offerTemplatesForNewDeck() {
    // only fresh decks: exactly one slide, no objects, never renamed
    const deck = editorState.deck;
    const isNewDeck = deck.slides.length === 1 &&
        (deck.slides[0].objects || []).length === 0 &&
        (deck.name || '').startsWith('Untitled');
    if (!isNewDeck) return;

    let index;
    try {
        const response = await fetch('templates/index.json');
        index = await response.json();
    } catch (err) {
        return;   // templates are optional — the blank deck is fine
    }
    if (!index || !Array.isArray(index.templates)) return;

    const cards = $('templateCards');
    cards.innerHTML = index.templates.map((t) => `
        <button class="template-card" data-template-file="${t.file}">
            <span class="template-swatch" style="background: ${t.swatch}"></span>
            <span class="template-card-name">${t.name}</span>
            <span class="template-card-desc">${t.description}</span>
        </button>
    `).join('');

    cards.querySelectorAll('.template-card').forEach((card) => {
        card.addEventListener('click', async () => {
            const template = index.templates.find((t) => t.file === card.dataset.templateFile);
            if (!template) return;

            try {
                const response = await fetch('templates/' + template.file);
                const tpl = await response.json();

                deck.slides = tpl.slides;
                deck.width = tpl.width;
                deck.height = tpl.height;

                closeModal($('templateModal'));

                // skipSync: the canvas still shows the old blank slide — it must
                // NOT overwrite the template's first slide
                await loadSlide(0, true);
                buildThumbs();
                zoomToFit();
                markDirty();
                await saveDeck();

                showNotification(`Applied "${template.name}" template`);
            } catch (err) {
                showNotification('Could not load template', true);
            }
        });
    });

    $('templateSkipBtn').addEventListener('click', () => closeModal($('templateModal')));
    $('templateModalClose').addEventListener('click', () => closeModal($('templateModal')));

    openModal($('templateModal'));
}
