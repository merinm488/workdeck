/* Page-local startup only: no member data is persisted or reused across pages.
   Start cookie-authorized reads while styles/editor libraries download. Each
   adapter consumes its prefetched response once; later reads stay fresh. */
(() => {
  const app = document.documentElement.dataset.wdApp;
  const endpoints = { home: '/api/workdeck', docs: '/api/docs', sheets: '/api/users',
    forms: '/api/forms', slides: '/api/slides', draw: '/api/draw', files: '/api/workdeck',
    calendar: '/api/calendar', kanban: '/api/kanban', todo: '/api/todo/lists',
    minutes: '/api/minutes', blog: '/api/blog' };
  const params = new URLSearchParams(location.search);
  const shared = /\/shared(?:\.html)?\/?$/.test(location.pathname) || params.has('shared');
  const endpoint = shared ? null : endpoints[app];
  const initial = new Map();
  function start(url) {
    const promise = fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) })
      .then(response => ({ response }), error => ({ error }));
    initial.set(url, promise);
    return promise;
  }
  let data = endpoint ? start(endpoint) : null;
  if (endpoint && !['todo', 'minutes', 'kanban'].includes(app)) start('/api/me');
  if (endpoint && app === 'sheets') {
    const id = params.get('id') || /^\/sheets\/([\w-]{8,128})\/?$/.exec(location.pathname)?.[1];
    if (id) start('/api/users?sheet=' + encodeURIComponent(id));
  }
  async function request(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      initial.clear();
      data = null;
    }
    const pending = method === 'GET' && initial.get(url);
    let response;
    if (pending) {
      initial.delete(url);
      const result = await pending;
      if (result.error) throw result.error;
      response = result.response.clone();
    } else response = await fetch(url, options);
    if (method !== 'GET' && response.ok) {
      let action;
      try { action = JSON.parse(options.body).action; } catch (_) { /* Todo uses REST */ }
      if (action !== 'recordOpen' && action !== 'updateSettings') {
        document.dispatchEvent(new CustomEvent('wd:data-changed', { detail: { app } }));
      }
    }
    return response;
  }
  const normalize = result => app === 'todo'
    ? { todo: result.lists || [], tags: result.tags || [], settings: result.settings || {} }
    : result.data;
  async function homeData(first = false) {
    const pending = first && data;
    data = null;
    const result = pending ? await pending : { response: await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' }) };
    if (result.error) throw result.error;
    if (!result.response?.ok) throw new Error('Could not load items');
    return normalize(await result.response.clone().json());
  }
  window.WDBoot = { fetch: request, homeData };
  // Never carry a settled response into a restored page or a later edit.
  addEventListener('pagehide', () => { initial.clear(); data = null; });
  setTimeout(() => { initial.clear(); data = null; }, 30000);
})();
