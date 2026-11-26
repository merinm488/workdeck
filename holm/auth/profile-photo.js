// One enhancement for static pages and React's dynamically mounted account
// controls. Own only the extra image nodes; leave app menus and handlers intact.
(() => {
  const triggers = '.wd-account-trigger, #landingMenuToggle';
  let member = null, refreshId = 0;
  const images = new WeakMap();
  const safePicture = value => {
    if (typeof value !== 'string') return '';
    if (/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length <= 60000) return value;
    try {
      const url = new URL(value, location.origin);
      return value && url.origin === location.origin && /^\/(?:_holm\/members\/[^/]+\/avatar|auth\/avatar)$/.test(url.pathname) ? value : '';
    } catch { return ''; }
  };
  function paintPhoto(target, source) {
    if (images.get(target) === source) return;
    images.set(target, source);
    target.querySelector('.wd-profile-image')?.remove();
    target.classList.remove('wd-photo-loaded');
    if (!source) return;
    const img = document.createElement('img');
    img.className = 'wd-profile-image'; img.alt = ''; img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => { if (img.parentElement === target) target.classList.add('wd-photo-loaded'); });
    img.addEventListener('error', () => { if (img.parentElement === target) { target.classList.remove('wd-photo-loaded'); img.remove(); } });
    img.src = source; target.append(img);
  }
  function render() {
    const picture = safePicture(member?.picture);
    document.querySelectorAll(triggers).forEach(el => paintPhoto(el, picture));

  }
  async function refresh() {
    const id = ++refreshId;
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const session = await response.json();
      if (id !== refreshId) return;
      member = session.member; render();
    } catch { /* A failed session/photo request must not block the app. */ }
  }
  function init() {
    new MutationObserver(records => {
      const selector = triggers;
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
          (node.matches(selector) || node.querySelector(selector))))) render();
    }).observe(document.body, { childList: true, subtree: true });
    refresh();
    // Pick up changes made in another Workdeck tab, without persisting photos
    // or member identity in localStorage or a service-worker cache.
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
