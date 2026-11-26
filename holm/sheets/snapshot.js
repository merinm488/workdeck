// Retain the original Workdeck canvas snapshot (334bd81), with a light-only
// render pass. Never rebuild cells, invert screenshot pixels or boot a second
// workbook. The light pass and restoration finish in ONE synchronous task so
// the editor never paints a theme flash or accepts edits between the two.
(() => {
  function repaint(render) {
    for (const component of render.components.values()) {
      component.makeForceDirty(true);
      component.makeDirty(true);
    }
    // Components normally defer dirty layers to a later frame. Force those
    // layers now so we copy the light canvas, not the previous dark frame.
    render.scene.makeDirtyNoParent(true);
    render.scene.render();
  }

  function capture(manager, copyCanvas) {
    let theme, render, wasDark;
    try {
      if (!manager.isInitialized || !manager.fWorkbook) return null;
      // These services belong to the pinned Univer 0.25.1 engine. Read its
      // real theme, rather than assuming the app preference was applied.
      const injector = manager.univerAPI._injector;
      theme = injector.get(UniverCore.ThemeService);
      render = injector.get(UniverEngineRender.IRenderManagerService)
        .getRenderById(manager.fWorkbook.getId());
      if (!render?.scene) return null;
      wasDark = theme.darkMode;
      if (wasDark) theme.setDarkMode(false);
      repaint(render);
      // The unchanged pre-migration capture copies Univer's actual canvases,
      // including text, formulas, merges, dimensions and authored formatting.
      return copyCanvas();
    } catch (error) {
      // A preview failure must not prevent saving the workbook or publish a
      // dark/custom approximation in place of the previous good snapshot.
      console.warn('[SHEETS] Light snapshot unavailable:', error);
      return null;
    } finally {
      if (wasDark) {
        try { theme.setDarkMode(wasDark); repaint(render); }
        catch (error) { console.warn('[SHEETS] Preview restoration deferred:', error); }
      }
    }
  }

  // Give pending cell edits/formula results a paint before serializing a save.
  // A background tab must not hold up the workbook waiting for rAF.
  function nextPaint() {
    if (document.hidden) return Promise.resolve();
    return new Promise(resolve => {
      const timeout = setTimeout(resolve, 100);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve(); }));
    });
  }
  // Upgrade old/dark images from the just-loaded SAVED checkpoint. This does
  // not create a content save, update modified dates, or run on view changes.
  async function refreshSavedPreview(manager, storage, isDirty) {
    const id = manager.currentSheetId;
    const record = storage.lastUserData?.sheets?.find(sheet => sheet.id === id);
    if (!record || (record.thumbnailStyle === 'univer-light-v1' && record.thumbnailContentVersion === record.version)) return false;
    const version = storage.versions.get(id);
    await nextPaint();
    if (!manager.isInitialized || manager.currentSheetId !== id || isDirty()) return false;
    const image = manager.captureThumbnail();
    if (!image) return false;
    return storage.savePreview(id, version, image);
  }
  window.WDSheetSnapshots = { capture, nextPaint, refreshSavedPreview };
})();
