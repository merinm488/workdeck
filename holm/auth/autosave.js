/* Shared, revision-aware autosave. Acknowledging one snapshot never clears newer edits. */
(() => {
  const messages = { saved: 'All changes saved', pending: 'Saving…', saving: 'Saving…', error: 'Not saved — retrying automatically' };
  function status(state, element = document.getElementById('saveState')) {
    if (!element) return;
    element.textContent = messages[state];
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.dataset.saveStatus = state;
  }
  const controllers = new Set();
  document.addEventListener('click', async event => {
    const link = event.target.closest?.('a[href]');
    if (![...controllers].some(queue => queue.dirty()) || event.defaultPrevented || !link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, location.href);
    if (!['http:', 'https:'].includes(url.protocol) || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if ((await Promise.all([...controllers].map(queue => queue.flush()))).every(Boolean)) location.assign(url.href);
  }, true);
  function create({ save, onState = status, delay = 800, retryDelay = 5000 }) {
    let revision = 0, savedRevision = 0, timer = null, running = null, disposed = false;
    const dirty = () => revision !== savedRevision;
    const report = state => { if (!disposed) onState(state, dirty()); };
    const schedule = wait => {
      // Bound the delay even during continuous typing, rather than postponing forever.
      if (!timer && !disposed) timer = setTimeout(() => { timer = null; flush(); }, wait);
    };
    async function flush() {
      clearTimeout(timer); timer = null;
      if (running) return running;
      if (!dirty()) return true;
      running = (async () => {
        while (dirty()) {
          const snapshotRevision = revision;
          report('saving');
          try {
            if (await save() === false) throw new Error('Save was not acknowledged');
            savedRevision = snapshotRevision;
          } catch (error) {
            console.warn('[AUTOSAVE]', error);
            report('error'); schedule(retryDelay);
            return false;
          }
        }
        report('saved');
        return true;
      })();
      try { return await running; } finally { running = null; }
    }
    const change = () => { revision++; report('pending'); schedule(delay); };
    const online = () => { if (dirty()) flush(); };
    const visibility = () => { if (document.visibilityState === 'hidden') online(); };
    const unload = event => {
      if (!dirty()) return;
      online(); event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', unload);
    document.addEventListener('visibilitychange', visibility);
    report('saved');
    const controller = { change, flush, dirty, dispose() {
      controllers.delete(controller);
      disposed = true; clearTimeout(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('visibilitychange', visibility);
    } };
    controllers.add(controller);
    return controller;
  }
  window.WDAutosave = { create, status };
})();
