/* Shared home-page presentation. Editors are deliberately not selected here. */
(() => {
  const labels = { docs: 'Doc', sheets: 'Sheet', forms: 'Form', slides: 'Slide', draw: 'Draw', todo: 'Todo', kanban: 'Kanban', blog: 'Blog', minutes: 'Minutes' };
  function formatDate(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return minutes + 'm ago';
    if (minutes < 1440) return Math.floor(minutes / 60) + 'h ago';
    const days = Math.floor(minutes / 1440);
    if (days === 1) return 'Yesterday';
    return days < 7 ? days + 'd ago' : date.toLocaleDateString();
  }
  function decorateCard(card, app, record, tag, actionsSelector) {
    if (!record) return;
    card.classList.add('wd-home-card');
    let face = card.querySelector('.wd-home-card-face');
    if (!face) {
      face = document.createElement('div'); face.className = 'wd-home-card-face';
      face.innerHTML = '<div class="wd-file-card-top"><span class="wd-file-icon" aria-hidden="true"></span><h3 class="wd-file-title"></h3></div><div class="wd-file-preview" aria-hidden="true"><div class="wd-file-preview-page"><div class="wd-preview-skeleton"></div></div></div><div class="wd-file-meta"><span class="wd-file-app-badge"></span><span class="wd-file-project"><span class="wd-dot"></span><span class="wd-file-project-name"></span></span><span class="wd-home-card-date"></span></div>';
      // Trusted SVG templates from the reference home, generated at build time.
      face.querySelector('.wd-file-icon').innerHTML = window.WDHomeIcons?.[app] || '';
      card.append(face);
      let actions = card.querySelector(actionsSelector);
      if (!actions && app === 'minutes') {
        actions = document.createElement('div');
        card.querySelectorAll('.delete-meeting,.wd-app-card-tag').forEach(button => actions.append(button));
        const remove = actions.querySelector('.delete-meeting');
        if (remove) { remove.classList.add('danger'); remove.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M6 7l1 14h10l1-14M9 7V4h6v3M10 11v6m4-6v6"/></svg>'; }
      }
      if (actions && actions !== card) {
        actions.classList.add('wd-home-card-actions');
        face.querySelector('.wd-file-card-top').append(actions, WDActionMenu.createCardTrigger(() =>
          [...actions.querySelectorAll('button')].map(button => WDActionMenu.fromButton(button))));
      }
    }
    face.querySelector('.wd-file-title').textContent = record.name || record.title || `Untitled ${labels[app] || app}`;
    face.querySelector('.wd-file-app-badge').textContent = labels[app] || app;
    const stamp = record.updatedAt || record.createdAt;
    face.querySelector('.wd-home-card-date').textContent = formatDate(stamp);
    const chip = face.querySelector('.wd-file-project');
    chip.hidden = !tag;
    chip.querySelector('.wd-dot').style.background = tag?.color || '';
    chip.querySelector('.wd-file-project-name').textContent = tag?.name || '';
    const key = `${record.id}:${stamp || ''}`;
    if (face.dataset.preview !== key && window.WDPreviews) {
      face.dataset.preview = key;
      window.WDPreviews.mount(face.querySelector('.wd-file-preview-page'), { id: record.id, app, updatedAt: stamp, raw: record });
    }
  }
  function init() {
    const app = document.documentElement.dataset.wdApp;
    const searches = {
      sheets: ['#searchInput', '.home-header-content'],
      forms: ['#homeSearchInput', '.top-nav'], slides: ['#homeSearchInput', '.top-nav'], draw: ['#homeSearchInput', '.top-nav'],
      todo: ['#listsSearchInput', '.top-nav'], kanban: ['#listsSearchInput', '.top-nav'],
      blog: ['#postsSearch', '.blog-topbar'], files: ['#fbSearchInput', '.fb-header-content'],
      minutes: ['#search', '.topbar'], calendar: ['#searchInput', '.top-nav'],
    };
    const config = searches[app];
    if (!config) return;
    const input = document.querySelector(config[0]);
    if (!input) return;
    let box = input.parentElement;
    // Minutes had a bare input beside a filter rather than a search component.
    if (app === 'minutes') {
      box = document.createElement('div'); input.before(box); box.append(input);
      box.innerHTML = '<svg class="wd-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>';
      box.append(input);
      document.querySelector(config[1])?.prepend(box);
    }
    box.classList.add('wd-home-search-box');
    const outer = box.closest('.home-search-container') || box;
    outer.classList.add('wd-home-search');
    input.classList.add('wd-search-input'); input.placeholder = 'Search';
    if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', `Search ${app}`);
    box.querySelector(':scope > svg')?.classList.add('wd-search-icon');
    box.querySelector('button')?.classList.add('wd-search-clear');
    const nav = document.querySelector(config[1]);
    if (nav && app !== 'calendar') {
      const home = document.querySelector({ todo: '#listsView', kanban: '#boardsView', blog: '#postsView', minutes: '#home' }[app] || '.home-main');
      const syncHeader = () => nav.classList.toggle('wd-home-header', !home?.classList.contains('hidden'));
      syncHeader();
      if (home) new MutationObserver(syncHeader).observe(home, { attributes: true, attributeFilter: ['class'] });
    }
    for (const selector of ['.home-main', '#listsView', '#boardsView', '#postsView', '#home']) {
      const main = document.querySelector(selector);
      if (main && main.querySelector('#homeGrid, #listsGrid, #boardsGrid, #postsList, #meetingList')) main.classList.add('wd-home-content');
    }
    const grids = ['#homeGrid', '#listsGrid', '#boardsGrid', '#postsList', '#meetingList', '#spreadsheetsContainer'];
    grids.forEach(selector => document.querySelector(selector)?.classList.add('wd-home-grid'));
  }
  window.WDHomeUI = { decorateCard, formatDate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
