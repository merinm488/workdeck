/**
 * ================================================
 * DRAW - Drawing Editor
 * ================================================
 *
 *
 * Architecture — infinite-canvas drawing app on Fabric.js v7:
 *  
 *
 * Fabric v7 notes :
 *   - new fabric.Canvas('drawCanvas', {...})
 *   - fabric.IText is the on-canvas editable text object (v7 API unchanged).
 *   - loadFromJSON returns a Promise in v6+ (no callback argument).
 *
 */

// ================================================
// State
// ================================================

const editorState = {
    drawing: null,          // drawing record (schema in js/storage.js)
    drawingId: null,        // from ?id= (the inline auth check guarantees it)
    canvas: null,           // the fabric.Canvas instance
    activeTool: 'select',   // 'select' | 'draw' | 'marker' | 'spray' | 'dots' | 'stripes' | 'eraser' | 'text' | 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'pan'
    isPanning: false,       // true while space-drag / middle-drag pan is active
    lastPanPoint: null,     // {x, y} — pointer position when the current pan started
    zoom: 1,                // cache of viewportTransform[0]
    isDirty: false,
    isSaving: false,
    renamePromptProceed: null,     // pending "continue leaving" callback while the rename reminder is open
    undoStack: [],          // JSON strings of canvas.toObject(EXTRA_SERIALIZED_PROPS).objects
    redoStack: [],
    isRestoring: false,     // true while undo/redo reloads the canvas (don't re-record)
    autoSaveTimer: null,
    touchMode: null,         // 'draw' | 'pan-zoom' — set by touchstart pointer count
    isSpaceDown: false,
    isErasing: false,        // true while the eraser tool has the pointer down
    draftLine: null
};

let undoSnapshotTimer = null;
let notificationTimer = null;
const EXTRA_SERIALIZED_PROPS = ['from', 'to'];

// ================================================
// Boot
// ================================================

async function init() {
    setLoading(true);

    editorState.drawingId = new URLSearchParams(location.search).get('id');
    if (!drawAuth.getSession() || !editorState.drawingId) {
        goToWorkdeck();
        return;
    }

    drawThemeManager.init();

    await document.fonts.ready;

    const drawing = await drawStorage.getDrawing(editorState.drawingId);
    if (!drawing) {
        showNotification('Drawing not found', true);
        goToWorkdeck();
        return;
    }
    editorState.drawing = drawing;

    const userData = await drawStorage.loadUserData();
    if (userData && userData.settings && userData.settings.theme) {
        drawThemeManager.applyFromServer(userData.settings.theme);
    }

    initCanvas();
    if (drawing.objects && drawing.objects.length > 0) {
        await editorState.canvas.loadFromJSON({ objects: drawing.objects });
    }

    editorState.canvas.backgroundColor = drawing.background || APP_CONFIG.canvas.defaultBackground;
    if (/^#[0-9a-f]{6}$/i.test(editorState.canvas.backgroundColor)) {
        $('canvasColorInput').value = editorState.canvas.backgroundColor;   // picker reflects the saved board
    }
    applyViewport(drawing.viewport || { zoom: 1, panX: 0, panY: 0 });
    $('drawingTitle').textContent = drawing.name || 'Untitled Drawing';

    bindToolbar();
    bindTopNav();
    bindModals();
    bindKeyboard();
    bindTouchGestures();
    bindBeforeUnload();
    startAutoSave();

    setLoading(false);
}

document.addEventListener('DOMContentLoaded', init);

// ================================================
// Fabric canvas
// ================================================

function initCanvas() {
    editorState.canvas = new fabric.Canvas('drawCanvas', {
        backgroundColor: APP_CONFIG.canvas.defaultBackground,
        selection: true,
        preserveObjectStacking: true
    });

    resizeCanvasToStage(); //size it right after creating

    editorState.canvas.on('object:added', onObjectChanged);
    editorState.canvas.on('object:removed', onObjectChanged);
    editorState.canvas.on('object:modified', (opt) => {
        onObjectModified(opt);   // arrow resize -> bake the transform (must run first)
        onObjectChanged();
    });

    editorState.canvas.on('selection:created', syncToolbarFromSelection);
    editorState.canvas.on('selection:updated', syncToolbarFromSelection);
    editorState.canvas.on('selection:cleared', () => {
        syncToolbarFromSelection();
        normalizeArrows();       // multi-select resizes commit to arrows on release
    });

    editorState.canvas.on('text:changed', markDirty);
    editorState.canvas.on('mouse:wheel', handleWheel);

    const upperCanvas = editorState.canvas.upperCanvasEl;
    let gestureScale = 1;
    upperCanvas.addEventListener('gesturestart', (e) => {
        e.preventDefault();
        if (editorState.touchMode === 'pan-zoom') return;
        gestureScale = 1;
    });
    upperCanvas.addEventListener('gesturechange', (e) => {
        e.preventDefault();
        if (editorState.touchMode === 'pan-zoom') return;
        const rect = upperCanvas.getBoundingClientRect();
        zoomToPoint(e.scale / gestureScale, { x: e.clientX - rect.left, y: e.clientY - rect.top });
        gestureScale = e.scale;
    });

    editorState.canvas.on('mouse:down', onCanvasMouseDown);
    editorState.canvas.on('mouse:move', onCanvasMouseMove);
    editorState.canvas.on('mouse:up', onCanvasMouseUp);
    
    window.addEventListener('resize', debounce(resizeCanvasToStage, 150));
}

/**
 * onObjectChanged — shared handler for added/removed/modified
 */
function onObjectChanged() {
    if (editorState.isRestoring) return;
    if(editorState.draftLine) return;
    recordUndoSnapshot();
    markDirty();
}


function resizeCanvasToStage() {
    const stage = document.querySelector('.canvas-stage');
    editorState.canvas.setDimensions({
        width: stage.clientWidth,
        height: stage.clientHeight
    });
    editorState.canvas.requestRenderAll();
}

function setCanvasBackground(color) {
    editorState.canvas.backgroundColor = color;
    editorState.canvas.requestRenderAll();
    markDirty();
}

// ================================================
// Viewport: pan & zoom (the infinite-canvas core)
// ================================================


function applyViewport(vp) {
    editorState.canvas.setViewportTransform([vp.zoom, 0, 0, vp.zoom, vp.panX, vp.panY]);
    editorState.canvas.requestRenderAll();
    editorState.zoom = vp.zoom;
    updateZoomLabel();
}

function getViewport() {
    const vpt = editorState.canvas.viewportTransform;
    return {zoom: vpt[0], panX: vpt[4], panY: vpt[5]};
}


function zoomToPoint(factor, point) {
    const vp = getViewport();
    const newZoom = Math.min(APP_CONFIG.canvas.maxZoom , Math.max(APP_CONFIG.canvas.minZoom, vp.zoom * factor));
    const ratio = newZoom / vp.zoom;
    const newPanX = point.x - (point.x - vp.panX) * ratio;
    const newPanY = point.y - (point.y - vp.panY) * ratio;
    applyViewport({zoom: newZoom, panX: newPanX, panY: newPanY});
}


/**
 * Wheel over the canvas — the two trackpad gestures, told apart the way
 * browsers report them:
 *   two-finger scroll  -> pan (deltas move the viewport; content follows
 *                         the fingers, like scrolling a page)
 *   pinch / ctrl+wheel -> zoom at the pointer (browsers flag trackpad
 *                         pinch as a wheel event with ctrlKey set)
 */
function handleWheel(opt) {
    const e = opt.e;
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
        zoomToPoint(Math.exp(-e.deltaY * APP_CONFIG.canvas.wheelZoomFactor), opt.viewportPoint);
        return;
    }

    // Firefox reports scroll distance in lines (deltaMode 1) or pages (2), not pixels
    const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? editorState.canvas.getHeight() : 1;
    const vp = getViewport();
    applyViewport({
        zoom: vp.zoom,
        panX: vp.panX - e.deltaX * px,   // negate: scroll down / swipe up
        panY: vp.panY - e.deltaY * px    // moves the view down, like a page
    });
}

function zoomIn() {
    zoomToPoint(APP_CONFIG.canvas.zoomStep, 
        {x: editorState.canvas.getWidth()/2, y: editorState.canvas.getHeight()/2});
}

function zoomOut() {
    zoomToPoint(1/APP_CONFIG.canvas.zoomStep, 
        {x: editorState.canvas.getWidth()/2, y: editorState.canvas.getHeight()/2});
}


function zoomToFit() {
    if(editorState.canvas.getObjects().length === 0) {
        applyViewport({zoom: 1, panX:0, panY:0});
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let obj of editorState.canvas.getObjects()){
        let r = obj.getBoundingRect();
        minX = Math.min(minX, r.left);
        minY = Math.min(minY, r.top);
        maxX = Math.max(maxX , r.left + r.width);
        maxY = Math.max(maxY, r.top + r.height);
    }

    const stageW = editorState.canvas.getWidth();
    const stageH = editorState.canvas.getHeight();
    const boxW  = maxX - minX;        // size  → used in the zoom ratio
    const boxH  = maxY - minY;
    const boxCX = (minX + maxX) / 2;  // center → used in the pan formula
    const boxCY = (minY + maxY) / 2;
    const newZoom = Math.min(stageW / boxW, stageH / boxH) * 0.9;
    const panX = stageW/2 - newZoom * boxCX;
    const panY = stageH/2 - newZoom * boxCY;
    applyViewport({zoom: newZoom, panX,panY});
}

/** Reset to 100% (1 canvas px = 1 screen px), keeping the screen centre fixed. */
function zoomToActualSize() {
    const canvas = editorState.canvas;
    zoomToPoint(1 / getViewport().zoom, { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 });
}

/** #zoomValue text = Math.round(zoom * 100) + '%'. */
function updateZoomLabel() {
    $('zoomValue').textContent = Math.round(editorState.zoom*100) + '%';
}

// ================================================
// Tools
// ================================================

const TOOL_BUTTON_IDS = {
    select: 'toolSelectBtn',
    eraser: 'toolEraserBtn',
    text: 'toolTextBtn'
};

// Shape tools living inside the Shapes dropdown
const SHAPE_TOOLS = ['rect', 'ellipse', 'triangle', 'line', 'arrow'];

// Freehand tools living inside the Brushes dropdown (all fabric brushes)
const BRUSH_TOOLS = ['draw', 'marker', 'spray', 'dots', 'stripes'];


function setActiveTool(tool) {
    editorState.activeTool = tool;

    Object.keys(TOOL_BUTTON_IDS).forEach((name) => {
        $(TOOL_BUTTON_IDS[name]).classList.toggle('active', name === tool);
    })
    const isShape = SHAPE_TOOLS.includes(tool);
    $('toolShapeBtn').classList.toggle('active', isShape);
    if(isShape){
        setShapeIcon(tool);
    }
    const isBrush = BRUSH_TOOLS.includes(tool);
    $('toolDrawBtn').classList.toggle('active', isBrush);
    if(isBrush){
        setBrushIcon(tool);
    }

    editorState.canvas.isDrawingMode = isBrush;
    if (isBrush) {
        configureFreehandBrush();
    } else if (tool === 'eraser') {
        // No EraserBrush to configure (see file top) — eraseAtPointer
        // removes objects on mouse:down / mouse:move instead.
    }
    editorState.canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';

    if(tool !== 'select' && editorState.canvas.getActiveObject()){
        editorState.canvas.discardActiveObject();
        editorState.canvas.requestRenderAll();
    }
}

// Copy a dropdown item's svg onto a dropdown button's icon holder. */
function mirrorDropdownIcon(dropdownId, selector, holderId) {
    const item = document.querySelector(`#${dropdownId} ${selector}`);
    if (item && item.querySelector('svg')) {
        $(holderId).innerHTML = item.querySelector('svg').outerHTML;
    }
}

function setShapeIcon(tool) {
    mirrorDropdownIcon('shapeDropdown', `[data-tool="${tool}"]`, 'shapeIconHolder');
}

function setBrushIcon(tool) {
    mirrorDropdownIcon('brushDropdown', `[data-tool="${tool}"]`, 'brushIconHolder');
}

/** Seamless 45° stripe tile for the Stripes pattern brush. */
function makeStripesCanvas(color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 12;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-3, 15); ctx.lineTo(15, -3);
    ctx.moveTo(-9, 9);  ctx.lineTo(9, -9);
    ctx.moveTo(3, 21);  ctx.lineTo(21, 3);
    ctx.stroke();
    return canvas;
}

/** Build the freeDrawingBrush for the armed tool (all fabric brushes). */
function configureFreehandBrush() {
    const canvas = editorState.canvas;
    const color = $('strokeColorInput').value;
    const width = Math.max(1, Number($('strokeWidthInput').value) || 2);
    let brush;

    switch (editorState.activeTool) {
        case 'marker': {
            brush = new fabric.CircleBrush(canvas);
            brush.color = color;
            brush.width = Math.max(8, width * 4);   // dot diameter base
            break;
        }
        case 'spray': {
            brush = new fabric.SprayBrush(canvas);
            brush.color = color;
            brush.width = Math.max(14, width * 4);      // spray-can radius
            brush.dotWidth = Math.max(1, width / 2);    // speck size follows the width slider
            brush.dotWidthVariance = brush.dotWidth;
            break;
        }
        case 'dots':
        case 'stripes': {
            brush = new fabric.PatternBrush(canvas);
            brush.color = color;
            if (editorState.activeTool === 'stripes') brush.source = makeStripesCanvas(color);
            brush.width = Math.max(4, width * 3);   // pattern strokes need girth to show the texture
            break;
        }
        default: {
            brush = new fabric.PencilBrush(canvas);
            brush.color = color;
            brush.decimate = 2;
        }
    }
    editorState.canvas.freeDrawingBrush = brush;
}


function onCanvasMouseDown(opt) {
    const canvas = editorState.canvas;
    const tool = editorState.activeTool;

    if(opt.e.button === 1 || editorState.isSpaceDown || tool === 'pan'){
        editorState.isPanning = true;
        editorState.lastPanPoint = opt.viewportPoint;
        canvas.selection = false;
        return;
    }
    if (tool === 'select' || BRUSH_TOOLS.includes(tool)) return;   // fabric's brush draws these
    if (tool === 'eraser') {
        editorState.isErasing = true;
        eraseAtPointer(opt);          // a plain click erases too, not just drags
        return;
    }
    const p = opt.scenePoint;
    if(tool === 'line' || tool === 'arrow'){
        
        editorState.draftLine = new fabric.Line([p.x, p.y, p.x, p.y], {
            stroke: $('strokeColorInput').value,
            strokeWidth: Math.max(1, Number($('strokeWidthInput').value) || 2)
        });
        canvas.add(editorState.draftLine);
        return;
    }
    const stroke = $('strokeColorInput').value;
    const fill   = $('fillColorInput').value;
    const strokeWidth = Math.max(1, Number($('strokeWidthInput').value) || 2);
    let obj = null;
    switch (tool){
        case 'rect':
            obj = new fabric.Rect({
                left: p.x - 60, top: p.y - 40,     // centered under the cursor
                width: 120, height: 80,
                fill, stroke, strokeWidth
            });
            break;
        case 'ellipse':
            obj = new fabric.Ellipse({
                left: p.x - 60, top: p.y - 40,
                rx: 60, ry: 40,                    // RADII — box is 2rx × 2ry = 120×80
                fill, stroke, strokeWidth
            });
            break;
        case 'triangle':
            obj = new fabric.Triangle({ 
                left: p.x - 60, top: p.y - 40, 
                width: 120, height: 80, 
                fill, stroke, strokeWidth });
            break;
        case 'text':
            obj = new fabric.IText('Text', {
                left: p.x, top: p.y,               // text: cursor is the top-left — natural
                fontFamily: APP_CONFIG.tools.fontFamily,
                fontSize: APP_CONFIG.tools.fontSize,
                fill: stroke
        });
            break;
    }
    if (!obj) return;

  canvas.add(obj);
  canvas.setActiveObject(obj);
  if (tool === 'text') {
      obj.enterEditing();          // typing goes straight in — no second click
  }
  setActiveTool('select');
}


function onCanvasMouseMove(opt) {
    if (editorState.isPanning) {
      const dx = opt.viewportPoint.x - editorState.lastPanPoint.x;
      const dy = opt.viewportPoint.y - editorState.lastPanPoint.y;
      const vp = getViewport();
      applyViewport({ zoom: vp.zoom, panX: vp.panX + dx, panY: vp.panY + dy });
      editorState.lastPanPoint = opt.viewportPoint;    // re-anchor!
      return;
    }

    if (editorState.isErasing) {
      eraseAtPointer(opt);
      return;
    }

    if (editorState.draftLine) {
      const p = opt.scenePoint;
      editorState.draftLine.set({ x2: p.x, y2: p.y });
      editorState.canvas.requestRenderAll();
    }
}

/**
 * Object-level eraser (fabric v7 ships no EraserBrush in its browser
 * builds — see the file top): remove the topmost object under the pointer.
 * canvas.remove fires object:removed, so undo snapshots + the dirty flag
 * come for free, and the deletion round-trips through toObject like any
 * other object operation.
 */
function eraseAtPointer(opt) {
    const canvas = editorState.canvas;
    const p = opt.scenePoint;
    const objects = canvas.getObjects();
    for (let i = objects.length - 1; i >= 0; i--) {
        if (objects[i].containsPoint(p)) {
            canvas.discardActiveObject();   // never leave a removed object active
            canvas.remove(objects[i]);
            break;                          // one object per event — feels like a real eraser
        }
    }
}

/** Finalize drafting on mouse:up (line/arrow): remove preview, add final object. */
function onCanvasMouseUp(opt) {
    editorState.isErasing = false;
    if (editorState.isPanning) {
      editorState.isPanning = false;
      editorState.lastPanPoint = null;
      editorState.canvas.selection = true;
      return;
    }
    if (editorState.draftLine) {
      const canvas = editorState.canvas;
      const tool = editorState.activeTool;
      const from = { x: editorState.draftLine.x1, y: editorState.draftLine.y1 };
      const to = { x: editorState.draftLine.x2, y: editorState.draftLine.y2 };
      canvas.remove(editorState.draftLine);
      editorState.draftLine = null;        // un-guard BEFORE the real add, so it snapshots
      if (Math.hypot(to.x - from.x, to.y - from.y) < 1) {
        setActiveTool('select');
        return;                            // a click, not a drag — preview already gone, state clean
      }
      const props = {
        stroke: $('strokeColorInput').value,
        strokeWidth: Math.max(1, Number($('strokeWidthInput').value) || 2)
      };
      const final = tool === 'arrow'
        ? buildArrow(from, to, props)
        : new fabric.Line([from.x, from.y, to.x, to.y], props);

      if (!final) return;
      canvas.add(final);                   // fires object:added → guard is down → snapshot + dirty
      canvas.setActiveObject(final);
      setActiveTool('select');
    }
}

function buildArrow(from, to, props) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const len = APP_CONFIG.tools.arrowHeadLength * Math.sqrt(props.strokeWidth);
    const ux = dx / dist;
    const uy = dy / dist;
    const headCX = to.x - ux * (len / 2);
    const headCY = to.y - uy * (len / 2);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    const head = new fabric.Triangle({
      left: headCX, top: headCY,
      width: len, height: len,
      originX: 'center', originY: 'center',
      angle,
      fill: props.stroke
  });
  const shaft = new fabric.Line([from.x, from.y, to.x, to.y], {
    ...props,
    strokeUniform: true    // child-level, not group-level — the group option
                           // doesn't propagate, and scaling would fatten the shaft
  });
  const grp = new fabric.Group([shaft, head]);

  const toLocal = fabric.util.invertTransform(grp.calcTransformMatrix());
  grp.from = fabric.util.transformPoint(new fabric.Point(from.x, from.y), toLocal);
  grp.to = fabric.util.transformPoint(new fabric.Point(to.x, to.y), toLocal);
  return grp;
}


function rebuildArrowhead(group) {
    if (!group.from || !group.to) return;   

    const canvas = editorState.canvas;
    const m = group.calcTransformMatrix();
    const from = fabric.util.transformPoint(new fabric.Point(group.from.x, group.from.y), m);
    const to = fabric.util.transformPoint(new fabric.Point(group.to.x, group.to.y), m);

    const shaft = group.getObjects().find((o) => o instanceof fabric.Line);
    const props = {
        stroke: shaft ? shaft.stroke : $('strokeColorInput').value,
        strokeWidth: shaft ? shaft.strokeWidth : Math.max(1, Number($('strokeWidthInput').value) || 2)
    };

    const index = canvas.getObjects().indexOf(group);
    const wasActive = canvas.getActiveObject() === group;

    canvas.remove(group);                   // fires object:removed -> snapshot + dirty
    const fresh = buildArrow(from, to, props);
    canvas.insertAt(index, fresh);          // v7: index FIRST — keep the z-order
    if (wasActive) {
        canvas.setActiveObject(fresh);      // keep resizing feel: the arrow stays selected
    }
    canvas.requestRenderAll();
    return fresh;
}


function hasResidualScale(obj) {
    return Math.abs(obj.scaleX ?? 1) !== 1 || Math.abs(obj.scaleY ?? 1) !== 1;
}

function onObjectModified(opt) {
    const target = opt.target;
    if (target instanceof fabric.Group && hasResidualScale(target)) {
        rebuildArrowhead(target);
    }
}


function normalizeArrows() {
    if (editorState.isRestoring) return;
    editorState.canvas.getObjects().forEach((obj) => {
        if (obj instanceof fabric.Group && obj.from && obj.to && hasResidualScale(obj)) {
            rebuildArrowhead(obj);
        }
    });
}

function insertImage() {
    $('imageFileInput').click();
}

function handleImageFile(file) {
    if (!file) return; 
    const reader = new FileReader(); // the browser's sanctioned file reader
    reader.onload = (e) => {                 // A: "when the read finishes, run this"
          fabric.Image.fromURL(e.target.result).then((img) => {   // B: "when the image decodes, run this"
            const canvas = editorState.canvas;
            const vp = getViewport();
            const maxW = (canvas.getWidth() / vp.zoom) * 0.8;
            const maxH = (canvas.getHeight() / vp.zoom) * 0.8;
            if (img.width > maxW) {
                img.scaleToWidth(maxW);
            }
            if (img.getScaledHeight() > maxH) {
                img.scaleToHeight(maxH);
            }
            //center it in the view
            const cx = (canvas.getWidth() / 2 - vp.panX) / vp.zoom;   
            const cy = (canvas.getHeight() / 2 - vp.panY) / vp.zoom;

            img.set({
                left: cx - img.getScaledWidth() / 2,
                top: cy - img.getScaledHeight() / 2
            });
            canvas.add(img);
            canvas.setActiveObject(img);
          });
      };

      reader.readAsDataURL(file);              // C: the trigger — nothing above runs until this

}

// ================================================
// Selection-driven properties
// ================================================


function syncToolbarFromSelection() {
    const activeObjects = editorState.canvas.getActiveObjects();
    const hasSelection = activeObjects.length > 0;
    const obj = hasSelection ? activeObjects[0] : null;

    setToolGroupDisabled($('fontFamilySelect').closest('.tool-group'), !(obj instanceof fabric.IText));
    setToolGroupDisabled($('deleteBtn').closest('.tool-group'), !hasSelection);
    if (!hasSelection) return;

    // arrows keep colour/width on their shaft child, marker/spray strokes on
    // their first dot — read what the swatches show from there
    let propObj = obj;
    const dotsGroup = obj instanceof fabric.Group && !obj.from && isBrushDotGroup(obj);
    if (obj instanceof fabric.Group && obj.from) {
        propObj = obj.getObjects().find((o) => o instanceof fabric.Line) || obj;
    } else if (dotsGroup) {
        propObj = obj.getObjects()[0];
    }
    $('strokeColorInput').value = toHexOrNull(dotsGroup ? propObj.fill : propObj.stroke) || '#1f2937';
    $('fillColorInput').value = toHexOrNull(propObj.fill) || '#94a3b8';
    $('strokeWidthInput').value = propObj.strokeWidth || 2;
    $('opacityInput').value = Math.round((obj.opacity ?? 1) * 100);

    if (obj instanceof fabric.IText) {
        $('fontFamilySelect').value = obj.fontFamily;
        $('fontSizeInput').value = obj.fontSize;
        $('textBoldBtn').classList.toggle('active', obj.fontWeight === 700 || obj.fontWeight === '700');
        $('textItalicBtn').classList.toggle('active', obj.fontStyle === 'italic');
    }
}

function toHexOrNull(value) {
    return typeof value === 'string' && value.startsWith('#') ? value : null;
}

function setToolGroupDisabled(group, disabled) {
    group.querySelectorAll('button, input, select').forEach((el) => {
        el.disabled = disabled;
    });
}

function applyPropertyToSelection(prop, value) {
    const activeObjects = editorState.canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    const updated = activeObjects.map((obj) => setPropertyOnObject(obj, prop, value));

    const selection = editorState.canvas.getActiveObject();
    if (selection instanceof fabric.ActiveSelection) {
        selection.dirty = true;   // children changed under it — don't render from cache
        // width changes rebuild arrows as fresh objects — keep them selected
        if (updated.some((o, i) => o !== activeObjects[i])) {
            editorState.canvas.discardActiveObject();
            editorState.canvas.setActiveObject(new fabric.ActiveSelection(updated, { canvas: editorState.canvas }));
        }
    }

    editorState.canvas.requestRenderAll();
    recordUndoSnapshot();   // programmatic sets fire no object:modified — snapshot here
    markDirty();
}

function setPropertyOnObject(obj, prop, value) {
    if (!(obj instanceof fabric.Group)) {
        obj.set(prop, value);
        return obj;
    }
    if (obj.from) {   // arrow: shaft carries stroke/strokeWidth, head is painted with it
        if (prop === 'fill') return obj;   // arrows are stroke-only — they follow the stroke colour
        obj.getObjects().forEach((child) => {
            child.set(child instanceof fabric.Triangle ? 'fill' : 'stroke', value);
        });
        if (prop === 'strokeWidth') return rebuildArrowhead(obj);
        obj.dirty = true;
        return obj;
    }
    const dots = isBrushDotGroup(obj);
    obj.getObjects().forEach((child) => {
        child.set(dots && (prop === 'stroke' || prop === 'fill') ? 'fill' : prop, value);
    });
    obj.dirty = true;
    return obj;
}

/** Marker/spray strokes: many small outline-less dots (brush circles / spray rects). */
function isBrushDotGroup(obj) {
    const children = obj.getObjects();
    return children.length > 8 && children.every((c) =>
        (c instanceof fabric.Circle || c instanceof fabric.Rect) && !c.stroke);
}

// ================================================
// Arrange / operations
// ================================================

function deleteSelection() {
    const activeObjects = editorState.canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    editorState.canvas.discardActiveObject();

    activeObjects.forEach((obj) => editorState.canvas.remove(obj));
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

function bringForward() {
    const canvas = editorState.canvas;
    const obj = canvas.getActiveObject();

    // guard: nothing selected, or a multi-selection (a bundle of children,
    // not a single stackable object in the canvas stack)
    if (!obj || obj instanceof fabric.ActiveSelection) return;

    canvas.bringObjectForward(obj);     // v6+ name — was bringForward() in v5
    canvas.requestRenderAll();          // reordering fires no event -> repaint is on us
    markDirty();                        // ...and no event -> no automatic dirty flag either
}

function sendBackward() {
    const canvas = editorState.canvas;
    const obj = canvas.getActiveObject();

    if (!obj || obj instanceof fabric.ActiveSelection) return;

    canvas.sendObjectBackwards(obj);    // v6+ name 
    canvas.requestRenderAll();
    markDirty();
}

/** Group the ActiveSelection's items -> fabric.Group; ungroup reverses. */
function groupSelection() {
    const canvas = editorState.canvas;
    const activeObject = canvas.getActiveObject();

    // grouping needs a MULTI-selection — one object can't group with itself
    if (!activeObject || canvas.getActiveObjects().length < 2) return;

    const objects = activeObject.getObjects();      // unpack the wrapper's real members

    canvas.discardActiveObject();                   // release the selection machinery first
    objects.forEach((obj) => canvas.remove(obj));   // each fires object:removed -> snapshot + dirty

    const group = new fabric.Group(objects);        // children keep their absolute positions (v6+)
    canvas.add(group);                              // fires object:added
    canvas.setActiveObject(group);
}

function ungroupSelection() {
    const canvas = editorState.canvas;
    const group = canvas.getActiveObject();

    // instanceof, not isType('group'): asks the class, immune to fabric's
    // version-dependent type strings. Arrows are Groups too — ungrouping
    // one splits it into shaft + head, which is legitimate.
    if (!(group instanceof fabric.Group)) return;

    const objects = group.removeAll();              // detach children, absolute coords restored

    canvas.remove(group);                           // fires object:removed
    objects.forEach((obj) => canvas.add(obj));      // each fires object:added
    canvas.discardActiveObject();
}

/** Remove every object (confirm via confirm(); record undo snapshot first). */
function clearCanvas() {
    const canvas = editorState.canvas;

    if (!confirm('Remove every object from this drawing?')) return;

    recordUndoSnapshot();        // capture the FULL board before any removal —
                                 // the per-remove snapshots below only see partial states

    canvas.discardActiveObject();

    // [...copy] is required: getObjects() returns the LIVE internal array —
    // removing while iterating it makes the loop skip every other object
    [...canvas.getObjects()].forEach((obj) => canvas.remove(obj));

    canvas.requestRenderAll();
}

// ================================================
// Undo / redo
// ================================================

function recordUndoSnapshot() {
    if (editorState.isRestoring) return;

    clearTimeout(undoSnapshotTimer);
    undoSnapshotTimer = setTimeout(() => {
        const snapshot = JSON.stringify(editorState.canvas.toObject(EXTRA_SERIALIZED_PROPS).objects);

        editorState.undoStack.push(snapshot);
        if (editorState.undoStack.length > 50) {
            editorState.undoStack.shift();
        }
        editorState.redoStack = [];
    }, 300);
}

function undo() {
    if (editorState.isRestoring || editorState.undoStack.length === 0) return;

    const previousState = editorState.undoStack.pop();
    editorState.redoStack.push(JSON.stringify(editorState.canvas.toObject(EXTRA_SERIALIZED_PROPS).objects));

    restoreSnapshot(previousState);
}

function redo() {
    if (editorState.isRestoring || editorState.redoStack.length === 0) return;

    const nextState = editorState.redoStack.pop();
    editorState.undoStack.push(JSON.stringify(editorState.canvas.toObject(EXTRA_SERIALIZED_PROPS).objects));

    restoreSnapshot(nextState);
}

function restoreSnapshot(objectsJson) {
    editorState.isRestoring = true;

    // loadFromJSON clears the canvas (backgroundColor -> "") — carry the board across
    const boardColor = editorState.canvas.backgroundColor;
    editorState.canvas.loadFromJSON({ objects: JSON.parse(objectsJson) }).then(() => {
        editorState.canvas.backgroundColor = boardColor;
        editorState.canvas.discardActiveObject();
        editorState.canvas.requestRenderAll();

        editorState.isRestoring = false;

        markDirty();
    }).catch((err) => {
        console.error('[EDITOR] Snapshot restore failed:', err);
        editorState.isRestoring = false;
        showNotification('Undo/redo failed', true);
    });
}

// ================================================
// Persistence
// ================================================

/** Set isDirty, update #saveState ("Unsaved changes"), reset autoSaveTimer. */
function markDirty() {
    editorState.isDirty = true;
    $('saveState').textContent = 'Unsaved changes';

    // restart the autosave countdown — each change pushes the next save a
    // full interval away, so autosave fires 30s after the LAST edit
    clearInterval(editorState.autoSaveTimer);
    editorState.autoSaveTimer = setInterval(() => {
        if (editorState.isDirty) {
            saveDrawing();
        }
    }, APP_CONFIG.autoSave.interval);
}

async function saveDrawing() {
    if (editorState.isSaving || !editorState.isDirty) return false;

    editorState.isSaving = true;
    $('saveState').textContent = 'Saving…';

    const drawingData = {
        ...editorState.drawing,                          // keep every field the record already has
        background: editorState.canvas.backgroundColor,
        objects: editorState.canvas.toObject(EXTRA_SERIALIZED_PROPS).objects,
        viewport: getViewport(),
        name: $('drawingTitle').textContent
    };

    delete drawingData.sharedId;

    const ok = await drawStorage.saveDrawing(editorState.drawingId, drawingData);

    if (ok) {
        editorState.isDirty = false;

        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        $('saveState').textContent = `Saved · ${hh}:${mm}`;
    } else {
        showNotification('Save failed — will retry automatically', true);
    }

    editorState.isSaving = false;
    return ok;
}

function startAutoSave() {
    editorState.autoSaveTimer = setInterval(() => {
        if (editorState.isDirty) {
            saveDrawing();
        }
    }, APP_CONFIG.autoSave.interval);
}

function bindBeforeUnload() {
    window.addEventListener('beforeunload', (e) => {
        if (!editorState.isDirty) return;   // nothing to lose — close silently

        e.preventDefault();                 // modern browsers: request the dialog
        e.returnValue = '';                 // legacy Chrome: dialog only fires with a set value
    });
}


function offerRenameBeforeLeaving(proceed) {
    const name = $('drawingTitle').textContent.trim().toLowerCase();
    if (name !== '' && name !== 'untitled' && name !== 'untitled drawing') {
        proceed();   // named — nothing to remind about
        return;
    }
    editorState.renamePromptProceed = proceed;
    $('renamePromptInput').value = '';
    $('renamePromptModal').classList.add('open');   // modals show via .open (styles.css:665)
}

// ================================================
// Export
// ================================================

function exportPng() {
    const canvas = editorState.canvas;
    const objs = canvas.getObjects();
    if (objs.length === 0) {
        showNotification('Nothing to export', true);
        return;
    }

    // union bounding box — same accumulator as zoomToFit
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of objs) {
        const r = obj.getBoundingRect();
        minX = Math.min(minX, r.left);
        minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.left + r.width);
        maxY = Math.max(maxY, r.top + r.height);
    }

    // pad all four sides — new names aligned with toDataURL's option keys
    const pad = 24;
    const left = minX - pad;
    const top = minY - pad;
    const width = (maxX - minX) + pad * 2;
    const height = (maxY - minY) + pad * 2;

    const savedVpt = canvas.viewportTransform;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const dataUrl = canvas.toDataURL({
        format: 'png',
        multiplier: 2,      // 2x pixels — crisp on retina
        left,
        top,
        width,
        height
    });
    canvas.setViewportTransform(savedVpt);
    canvas.requestRenderAll();

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${$('drawingTitle').textContent || 'drawing'}.png`;
    link.click();
}

// ================================================
// Top nav / settings / modals
// ================================================

function goHome() {
    offerRenameBeforeLeaving(() => {
        saveDrawing();   // best-effort — must never block navigation
        goToWorkdeck();
    });
}

function openRenameModal() {
    $('renameInput').value = $('drawingTitle').textContent || '';
    $('renameModal').classList.add('open');
    $('renameInput').focus();
    $('renameInput').select();
}

function confirmRename() {
    const name = $('renameInput').value.trim() || 'Untitled Drawing';

    $('drawingTitle').textContent = name;
    closeModal($('renameModal'));

    markDirty();      // saveDrawing only runs when the doc is dirty
    saveDrawing();
}

async function openShareModal() {
    await saveDrawing();   // the share snapshots the SERVER copy — save first
                           // so viewers see what's on screen right now
    const result = await drawStorage.shareDrawing(editorState.drawingId);
    if (!result) {
        showNotification('Could not create share link', true);
        return;
    }

    $('shareDrawingName').textContent = $('drawingTitle').textContent;
    $('shareUrlInput').value = result.shareUrl;

    // reset any lingering "Copied" state from the last time it was open
    $('copyShareUrlBtn').classList.remove('copied');
    $('copyButtonText').textContent = 'Copy';

    $('shareModal').classList.add('open');
}

/** View My Key modal: #keyText = drawAuth.getUserKey() (or session helper). */
function openKeyModal() {
    $('keyText').textContent = drawAuth.getUserKey() || '-';
    $('keyModal').classList.add('open');
}

async function confirmDeleteAccount() {
    const result = await drawAuth.deleteAccount();
    if (!result.success) {
        showNotification(result.error || 'Failed to delete account', true);
    }
}

function applyThemeChoice(pref) {
    // Theme restyles chrome only
    drawThemeManager.setTheme(pref);
    $('themeText').textContent = 'Theme: ' + drawThemeManager.getDisplayLabel();
}

function openModal(el) {
    el.classList.add('open');
}

function closeModal(el) {
    el.classList.remove('open');
}

function bindTopNav() {
    $('homeBtn').addEventListener('click', goHome);
    $('saveBtn').addEventListener('click', saveDrawing);
    $('drawingTitle').addEventListener('click', openRenameModal);

    // --- dropdown toggles: opening one closes the other ---
    $('settingsBtn').addEventListener('click', () => {
        $('settingsDropdown').classList.toggle('open');
        $('exportDropdown').classList.remove('open');
    });
    $('exportBtn').addEventListener('click', () => {
        $('exportDropdown').classList.toggle('open');
        $('settingsDropdown').classList.remove('open');
    });

    $('exportPngBtn').addEventListener('click', () => {
        $('exportDropdown').classList.remove('open');
        exportPng();
    });

    // --- settings items ---
    $('themeText').textContent = 'Theme: ' + drawThemeManager.getDisplayLabel();

    $('themeToggleBtn').addEventListener('click', () => {
        $('themeSubmenu').classList.toggle('open');
    });

    document.querySelectorAll('.theme-option').forEach((option) => {
        option.addEventListener('click', () => applyThemeChoice(option.dataset.theme));
    });

    $('viewKeyBtn').addEventListener('click', openKeyModal);
    $('shareBtn').addEventListener('click', openShareModal);
    $('deleteAccountBtn').addEventListener('click', () => openModal($('deleteAccountModal')));

    $('logoutBtn').addEventListener('click', () => {
        offerRenameBeforeLeaving(() => {
            saveDrawing();            // best-effort
            clearUnifiedSession();    // config.js: logout = the WHOLE unified session
            goToWorkdeck();
        });
    });

    // --- a click anywhere else closes both sheets ---
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#exportBtn, #exportDropdown')) {
            $('exportDropdown').classList.remove('open');
        }
        if (!e.target.closest('#settingsBtn, #settingsDropdown')) {
            $('settingsDropdown').classList.remove('open');
        }
    });
}

function closeRenamePrompt(renamed) {
    closeModal($('renamePromptModal'));

    const proceed = editorState.renamePromptProceed;
    editorState.renamePromptProceed = null;

    const newName = $('renamePromptInput').value.trim();
    if (renamed && newName) {
        $('drawingTitle').textContent = newName;
        markDirty();
    }

    // finish the interrupted save, then continue the exit the user started
    setTimeout(() => {
        saveDrawing();
        if (proceed) proceed();
    }, 50);
}

function bindModals() {
    // --- rename modal ---
    $('renameModalClose').addEventListener('click', () => closeModal($('renameModal')));
    $('renameCancelBtn').addEventListener('click', () => closeModal($('renameModal')));
    $('renameConfirmBtn').addEventListener('click', confirmRename);
    $('renameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmRename();
        }
    });

    // --- rename reminder ---
    $('renamePromptConfirm').addEventListener('click', () => closeRenamePrompt(true));
    $('renamePromptLater').addEventListener('click', () => closeRenamePrompt(false));
    $('renamePromptClose').addEventListener('click', () => closeRenamePrompt(false));
    $('renamePromptModal').addEventListener('click', (e) => {
        if (e.target === $('renamePromptModal')) {
            closeRenamePrompt(false);   // clicking the dark backdrop counts as "Later"
        }
    });
    $('renamePromptInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            closeRenamePrompt(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeRenamePrompt(false);
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

    // --- delete account modal ---
    $('deleteAccountModalClose').addEventListener('click', () => closeModal($('deleteAccountModal')));
    $('cancelDeleteAccount').addEventListener('click', () => closeModal($('deleteAccountModal')));
    $('confirmDeleteAccount').addEventListener('click', confirmDeleteAccount);

    // --- share modal ---
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
            showNotification('Copy failed — select the link manually', true);
        }
    });
}

// ================================================
// Keyboard
// ================================================


function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
        // --- typing must never trigger shortcuts ---
        const tagName = (e.target.tagName || '').toLowerCase();
        const editingText = editorState.canvas.getActiveObject()?.isEditing;
        if (tagName === 'input' || tagName === 'select' || tagName === 'textarea' || editingText) {
            return;
        }

        const key = e.key.toLowerCase();
        const mod = e.ctrlKey || e.metaKey;   // Ctrl on Windows/Linux, Cmd on Mac

        // --- space (hold) = temporary pan ---
        if (e.key === ' ') {
            e.preventDefault();                // stop the page itself from scrolling
            editorState.isSpaceDown = true;    // onCanvasMouseDown checks this flag
            return;
        }

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
            saveDrawing();
        } else if (mod && key === 'g') {
            e.preventDefault();
            if (e.shiftKey) { ungroupSelection(); } else { groupSelection(); }
        } else if (mod && (key === '=' || key === '+')) {
            e.preventDefault();
            zoomIn();
        } else if (mod && key === '-') {
            e.preventDefault();
            zoomOut();
        } else if (mod && key === '0') {
            e.preventDefault();
            zoomToFit();
        } else if (e.shiftKey && (e.code === 'Digit0' || e.code === 'Numpad0')) {
            // e.code, not e.key: Shift+0 types ')' so the key never reads '0'
            e.preventDefault();
            zoomToActualSize();
        } else if (!mod && key && 'vpetroalms'.includes(key)) {
            // key guard: ''.includes('') is true, so a dead-key event with an
            // empty e.key would otherwise reach the map and hand setActiveTool undefined
            const toolFor = {
                v: 'select', p: 'draw', e: 'eraser', t: 'text',
                r: 'rect', o: 'ellipse', l: 'line', a: 'arrow',
                m: 'marker', s: 'spray'
            };
            setActiveTool(toolFor[key]);
        } else if (key === 'escape') {
            editorState.canvas.discardActiveObject();
        }
    });

    // keyup is the other half of the space-hold gesture
    document.addEventListener('keyup', (e) => {
        if (e.key === ' ') {
            editorState.isSpaceDown = false;
        }
    });
}

// ================================================
// Touch / mobile
// ================================================

function cancelPendingDrawAction() {
    const canvas = editorState.canvas;

    if (canvas._isCurrentlyDrawing) {
        canvas._isCurrentlyDrawing = false;   // __onMouseUp now skips the brush — no path is added
        canvas.clearContext(canvas.contextTop);   // wipe the live stroke preview
        canvas.contextTopDirty = false;           // renderAll's auto-clear skips drawing mode
    }

    if (editorState.draftLine) {
        canvas.remove(editorState.draftLine);   // object:removed fires while the guard is still up
        editorState.draftLine = null;
    }

    editorState.isErasing = false;

    // object drag / marquee: stop where the fingers left it.
    canvas._currentTransform = null;
    canvas._groupSelector = null;
}


function bindTouchGestures() {
    const stage = document.querySelector('.canvas-stage');
    let gesture = null;   // pinch state, re-anchored on every move (Round 17 discipline)

    let stageRect = null;

    // two-finger midpoint in CANVAS-element coordinates (clientX/Y are page coords)
    const pinchCenter = (touches) => ({
        x: (touches[0].clientX + touches[1].clientX) / 2 - stageRect.left,
        y: (touches[0].clientY + touches[1].clientY) / 2 - stageRect.top
    });

    stage.addEventListener('touchstart', (e) => {
        if (e.touches.length >= 2) {
            e.preventDefault();
            cancelPendingDrawAction();
            editorState.touchMode = 'pan-zoom';
            stageRect = editorState.canvas.upperCanvasEl.getBoundingClientRect();

            const t = e.touches;
            gesture = {
                lastDist: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY),
                lastMid: pinchCenter(t)
            };
            editorState.canvas.discardActiveObject();   // a selection shouldn't ride the pinch
            return;
        }

        editorState.touchMode = 'draw';
    }, { passive: false });

    stage.addEventListener('touchmove', (e) => {
        e.preventDefault();

        if (editorState.touchMode !== 'pan-zoom' || !gesture || e.touches.length < 2) return;

        const t = e.touches;
        const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        const mid = pinchCenter(t);

        const vp = getViewport();
        const factor = gesture.lastDist > 0 ? dist / gesture.lastDist : 1;
        const newZoom = Math.min(APP_CONFIG.canvas.maxZoom, Math.max(APP_CONFIG.canvas.minZoom, vp.zoom * factor));
        const ratio = newZoom / vp.zoom;
        applyViewport({
            zoom: newZoom,
            panX: mid.x - (mid.x - vp.panX) * ratio + (mid.x - gesture.lastMid.x),
            panY: mid.y - (mid.y - vp.panY) * ratio + (mid.y - gesture.lastMid.y)
        });

        gesture.lastDist = dist;   // re-anchor — forget these two lines and the pinch rockets
        gesture.lastMid = mid;
    }, { passive: false });

    const endGesture = () => {
        gesture = null;
        stageRect = null;
        editorState.touchMode = null;
    };
    stage.addEventListener('touchend', endGesture);
    stage.addEventListener('touchcancel', () => {
        cancelPendingDrawAction();
        endGesture();
    });
}

// ================================================
// Toolbar wiring
// ================================================

function positionToolbarDropdown(button, dropdown) {
    const r = button.getBoundingClientRect();
    dropdown.style.top = `${r.bottom + 6}px`;
    dropdown.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - dropdown.offsetWidth - 8))}px`;
}

function bindDropdownToggle(buttonId, dropdownId) {
    $(buttonId).addEventListener('click', () => {
        closeAllToolbarDropdowns(dropdownId);
        const dropdown = $(dropdownId);
        if (dropdown.classList.toggle('open')) {
            positionToolbarDropdown($(buttonId), dropdown);
        }
    });

    document.addEventListener('click', (e) => {
        // trigger included, so the very click that opened the menu doesn't close it
        if (!e.target.closest(`#${dropdownId}, #${buttonId}`)) {
            $(dropdownId).classList.remove('open');
        }
    });
}

function closeAllToolbarDropdowns(exceptId) {
    document.querySelectorAll('.tool-dropdown.open').forEach((menu) => {
        if (menu.id !== exceptId) {
            menu.classList.remove('open');
        }
    });
}

function toggleBold() {
    const obj = editorState.canvas.getActiveObject();
    const isBold = obj && (obj.fontWeight === 700 || obj.fontWeight === '700' || obj.fontWeight === 'bold');
    applyPropertyToSelection('fontWeight', isBold ? 400 : 700);
}

function toggleItalic() {
    const obj = editorState.canvas.getActiveObject();
    const isItalic = obj && obj.fontStyle === 'italic';
    applyPropertyToSelection('fontStyle', isItalic ? 'normal' : 'italic');
}

function bindToolbar() {
    Object.keys(TOOL_BUTTON_IDS).forEach((name) => {
        $(TOOL_BUTTON_IDS[name]).addEventListener('click', () => setActiveTool(name));
    });

    // --- Shapes dropdown ---
    bindDropdownToggle('toolShapeBtn', 'shapeDropdown');
    document.querySelectorAll('#shapeDropdown [data-tool]').forEach((item) => {
        item.addEventListener('click', () => {
            setActiveTool(item.dataset.tool);
            closeAllToolbarDropdowns();
        });
    });
    setShapeIcon('rect');   // the Shapes button's default face

    // --- Brushes dropdown ---
    bindDropdownToggle('toolDrawBtn', 'brushDropdown');
    document.querySelectorAll('#brushDropdown [data-tool]').forEach((item) => {
        item.addEventListener('click', () => {
            setActiveTool(item.dataset.tool);
            closeAllToolbarDropdowns();
        });
    });
    setBrushIcon('draw');   // the Brushes button's default face

    bindDropdownToggle('arrangeBtn', 'arrangeDropdown');
    const arrangeActions = {
        bringForwardBtn: bringForward,
        sendBackwardBtn: sendBackward,
        groupBtn: groupSelection,
        ungroupBtn: ungroupSelection,
        clearCanvasBtn: clearCanvas
    };
    Object.keys(arrangeActions).forEach((id) => {
        $(id).addEventListener('click', () => {
            closeAllToolbarDropdowns();
            arrangeActions[id]();
        });
    });

    // --- edit / history buttons ---
    $('duplicateBtn').addEventListener('click', duplicateSelection);
    $('deleteBtn').addEventListener('click', deleteSelection);
    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);

    // --- image insert (Round 20's hidden-file-input trick) ---
    $('imageBtn').addEventListener('click', insertImage);
    $('imageFileInput').addEventListener('change', () => {
        handleImageFile($('imageFileInput').files[0]);
        $('imageFileInput').value = '';   // re-inserting the SAME file must re-fire change
    });

    // --- text controls ---
    $('fontFamilySelect').addEventListener('change', () => {
        applyPropertyToSelection('fontFamily', $('fontFamilySelect').value);
    });
    $('fontSizeInput').addEventListener('change', () => {
        applyPropertyToSelection('fontSize', Number($('fontSizeInput').value));
    });
    $('textBoldBtn').addEventListener('click', toggleBold);
    $('textItalicBtn').addEventListener('click', toggleItalic);

    // --- style controls: selection first, brush follows mid-draw
    $('strokeColorInput').addEventListener('input', () => {
        applyPropertyToSelection('stroke', $('strokeColorInput').value);
        if (editorState.canvas.isDrawingMode) configureFreehandBrush();
    });
    $('fillColorInput').addEventListener('input', () => {
        applyPropertyToSelection('fill', $('fillColorInput').value);
    });
    $('strokeWidthInput').addEventListener('change', () => {
        applyPropertyToSelection('strokeWidth', Math.max(1, Number($('strokeWidthInput').value) || 2));
        if (editorState.canvas.isDrawingMode) configureFreehandBrush();
    });
    $('opacityInput').addEventListener('input', () => {
        applyPropertyToSelection('opacity', Number($('opacityInput').value) / 100);
    });

    // --- canvas colour: board = document data, never theme-derived ---
    $('canvasColorInput').addEventListener('input', () => {
        setCanvasBackground($('canvasColorInput').value);
    });

    // --- zoom ---
    $('zoomInBtn').addEventListener('click', zoomIn);
    $('zoomOutBtn').addEventListener('click', zoomOut);
    $('zoomFitBtn').addEventListener('click', zoomToFit);
    $('zoomValue').addEventListener('click', zoomToActualSize);
}

// ================================================
// Utilities (tiny — shared with shared.js conventions)
// ================================================

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
    return function(){
        clearTimeout(timer);
        timer = setTimeout(fn,waitMs);
    }
}

/** Full-screen loading overlay (#loadingOverlay) toggle. */
function setLoading(isLoading) {
    $('loadingOverlay').classList.toggle('hidden', !isLoading);
}
