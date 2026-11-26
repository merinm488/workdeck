/* Shared tag sidebar for Holm app home pages. The tag pool and assignments are
 * the same member-private ones used by Workdeck, Docs and Files. */
(() => {
  const script = document.currentScript;
  const app = script?.dataset.app;
  const configs = {
    sheets: { key: 'sheets', grid: '#spreadsheetsContainer', home: '.home-main', nav: '.home-header-content', actions: '.spreadsheet-card-actions' },
    forms: { key: 'forms', grid: '#homeGrid', home: '.home-main', nav: '.top-nav-left', actions: '.home-card-actions' },
    slides: { key: 'slides', grid: '#homeGrid', home: '.home-main', nav: '.top-nav-left', actions: '.home-card-actions' },
    draw: { key: 'draws', grid: '#homeGrid', home: '.home-main', nav: '.top-nav-left', actions: '.home-card-actions' },
    todo: { key: 'todo', grid: '#listsGrid', home: '#listsView', nav: '.top-nav-left', actions: '.td-list-card-actions' },
    kanban: { key: 'kanban', grid: '#boardsGrid', home: '#boardsView', nav: '.top-nav-left', actions: '.kb-board-card-actions' },
    minutes: { key: 'minutes', grid: '#meetingList', home: '#home', nav: '.topbar', actions: '.meeting-card' },
    blog: { key: 'posts', grid: '#postsList', home: '#postsView', nav: '.blog-topbar', actions: '.blog-post-row-actions' },
  };
  const config = configs[app];
  if (!config) return;
  const $ = selector => document.querySelector(selector);
  const storageKey = `wd_${app}_home_tag`;
  let tags = [], records = [], active = null, open = matchMedia('(min-width: 1024px)').matches;
  try { active = sessionStorage.getItem(storageKey) || null; } catch (_) { /* private mode */ }

  function formatUpdatedAt(iso) {
    const stamp = Date.parse(iso || '');
    if (!Number.isFinite(stamp)) return '—';
    const minutes = Math.floor(Math.max(0, Date.now() - stamp) / 60_000);
    if (minutes === 0) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
  }

  async function request(action, data) {
    const response = await (window.WDBoot?.fetch || fetch)(action ? '/api/workdeck' : ({ sheets: '/api/users', forms: '/api/forms', slides: '/api/slides', draw: '/api/draw', todo: '/api/todo/lists', kanban: '/api/kanban', minutes: '/api/minutes', blog: '/api/blog' })[app], {
      method: action ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(action ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) } : {}),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not load tags');
    const result = await response.json();
    return !action && app === 'todo' ? { todo: result.lists, tags: result.tags, settings: result.settings } : result.data;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const grid = $(config.grid), home = $(config.home), nav = $(config.nav);
    if (!grid || !home || !nav) return;
    // Mount the empty shell and restore presentation synchronously. Neither
    // sidebar geometry nor the saved layout may depend on a network response.
    const layoutKeys = { sheets: 'sheets_home_layout', forms: 'forms_home_layout', slides: 'slides_home_layout', draw: 'draw_home_layout', todo: 'todo_lists_layout' };
    try { grid.classList.toggle('as-list', localStorage.getItem(layoutKeys[app] || `wd_${app}_layout`) === 'list'); }
    catch (_) { /* private mode */ }
    const loading = document.createElement('p');
    loading.className = 'wd-home-loading';
    loading.setAttribute('role', 'status');
    loading.textContent = 'Loading…';
    grid.before(loading);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wd-app-side-toggle';
    toggle.setAttribute('aria-label', 'Close sidebar');
    toggle.setAttribute('aria-controls', 'wdAppSidebar');
    toggle.title = 'Close sidebar';
    toggle.innerHTML = '<svg class="wd-app-side-collapse" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 6-6 6 6 6m8-12-6 6 6 6"/></svg><svg class="wd-app-side-expand" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 6 6 6-6 6m8-12 6 6-6 6"/></svg>';
    nav.prepend(toggle);
    const scrim = document.createElement('div');
    scrim.className = 'wd-app-side-scrim';
    const aside = document.createElement('aside');
    aside.className = 'wd-app-sidebar';
    aside.id = 'wdAppSidebar';
    aside.setAttribute('aria-label', `${app} tags`);
    aside.innerHTML = `<div class="wd-app-side-brand wd-sidebar-brand">${window.WDHomeLink}</div>
      <nav aria-label="Filter by tag"><button type="button" class="wd-app-side-all">All items</button>
        <div class="wd-app-side-tags"></div></nav>`;
    document.body.append(scrim, aside);
    home.classList.add('wd-app-side-home');
    const all = $('.wd-app-side-all'), list = $('.wd-app-side-tags');
    let tagUI;
    const brand = aside.querySelector('.wd-app-side-brand');
    const sync = () => {
      const visible = !home.classList.contains('hidden');
      const expanded = visible && open;
      // In the mobile drawer the header is covered, so keep the same toggle
      // inside the panel where it can close it (no second close button).
      if (expanded && !matchMedia('(min-width: 1024px)').matches) brand.append(toggle);
      else if (toggle.parentNode !== nav) nav.prepend(toggle);
      document.body.classList.toggle('wd-app-side-available', visible);
      document.body.classList.toggle('wd-app-side-open', expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', expanded ? 'Close sidebar' : 'Open sidebar');
      toggle.title = expanded ? 'Close sidebar' : 'Open sidebar';
      aside.inert = !expanded;
    };
    const setOpen = value => {
      const restoreFocus = document.activeElement === toggle || (open && !value && aside.contains(document.activeElement));
      open = value; sync();
      if (restoreFocus) toggle.focus({ preventScroll: true });
    };
    toggle.onclick = () => setOpen(!open);
    scrim.onclick = () => setOpen(false);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !open || matchMedia('(min-width: 1024px)').matches ||
          document.querySelector('dialog[open], .wd-action-menu')) return;
      if (aside.querySelector('form:not([hidden])')) return;
      event.preventDefault(); setOpen(false); toggle.focus({ preventScroll: true });
    });
    const choose = id => {
      active = id;
      try { if (id) sessionStorage.setItem(storageKey, id); else sessionStorage.removeItem(storageKey); } catch (_) { /* private mode */ }
      drawTags(); filterCards();
      if (!matchMedia('(min-width: 1024px)').matches) setOpen(false);
    };
    all.onclick = () => choose(null);
    function drawTags() {
      all.classList.toggle('active', !active);
      all.setAttribute('aria-current', String(!active));
      const options = {
        tags, active, count: id => records.filter(record => record.tagId === id).length,
        onSelect: choose,
        onSave: async (id, values) => {
          const result = await request(id ? 'updateTag' : 'createTag', id ? { tagId: id, updates: values } : values);
          tags = result.tags || []; drawTags(); filterCards();
        },
        onDelete: async id => { await request('deleteTag', { tagId: id }); location.reload(); },
      };
      if (tagUI) tagUI.update(options);
      else tagUI = window.WDTagUI.mount(list, options);
    }
    grid.classList.add('wd-app-items');
    const tableHead = document.createElement('div');
    tableHead.className = 'wd-app-table-head';
    tableHead.setAttribute('aria-hidden', 'true');
    tableHead.innerHTML = '<span>Title</span><span>Tag</span><span>Updated</span><span>Actions</span>';
    grid.before(tableHead);
    // Kanban, Blog and Minutes had no view switch. Keep their existing cards
    // as the default, but offer the same list view as the other app homes.
    if (['kanban', 'blog', 'minutes'].includes(app)) {
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'wd-app-view-toggle';
      view.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
      const syncView = () => {
        const listView = grid.classList.contains('as-list');
        view.setAttribute('aria-label', listView ? 'Switch to card view' : 'Switch to list view');
        view.title = view.getAttribute('aria-label');
        view.setAttribute('aria-pressed', String(listView));
      };
      syncView();
      view.onclick = () => {
        grid.classList.toggle('as-list'); syncView();
        try { localStorage.setItem(`wd_${app}_layout`, grid.classList.contains('as-list') ? 'list' : 'cards'); } catch (_) { /* private mode */ }
      };
      const viewNav = app === 'blog' ? nav.querySelector('.blog-topbar-actions')
        : app === 'kanban' ? document.querySelector('.top-nav-right')
        : app === 'minutes' ? nav.querySelector('.minutes-home-actions') || nav : nav;
      if (app === 'minutes') viewNav.insertBefore(view, viewNav.querySelector('#newBtn'));
      else viewNav.prepend(view);
    }
    let actionMenu = null;
    const closeActions = () => { actionMenu?.close(); actionMenu = null; };
    const showActions = (card, trigger, focusLast = false) => {
      const source = card.querySelector('.wd-home-card-actions') || card.querySelector(config.actions) || card;
      const originals = [...source.querySelectorAll('button')];
      const items = originals.filter(button => button !== trigger && !button.matches('.wd-app-list-more, .wd-card-more'))
        .map(button => WDActionMenu.fromButton(button));
      actionMenu = WDActionMenu.open(trigger, items, { focusLast, onClose: () => { actionMenu = null; } });
    };
    function decorateRow(card, assignedTag, record) {
      let badge = card.querySelector(':scope > .wd-app-row-tag');
      if (!badge) {
        badge = document.createElement('span'); badge.className = 'wd-app-row-tag';
        const date = document.createElement('time'); date.className = 'wd-app-row-date';
        const more = document.createElement('button');
        more.type = 'button'; more.className = 'wd-app-list-more';
        more.setAttribute('aria-label', 'More actions'); more.title = 'More actions';
        more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
        more.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';
        more.onclick = event => { event.preventDefault(); event.stopPropagation(); showActions(card, more); };
        more.onkeydown = event => {
          event.stopPropagation();
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); showActions(card, more, event.key === 'ArrowUp'); }
        };
        card.append(badge, date, more);
      }
      badge.replaceChildren();
      if (assignedTag) {
        const dot = document.createElement('span'); dot.className = 'wd-app-side-dot';
        dot.style.backgroundColor = assignedTag.color || '#facc15';
        badge.append(dot, document.createTextNode(assignedTag.name));
        badge.title = assignedTag.name;
      } else { badge.textContent = '—'; badge.removeAttribute('title'); }
      const date = card.querySelector(':scope > .wd-app-row-date');
      const stamp = record?.updatedAt || record?.createdAt;
      const parsed = stamp && new Date(stamp);
      date.textContent = formatUpdatedAt(stamp);
      if (parsed && !isNaN(parsed.getTime())) {
        date.dateTime = parsed.toISOString();
      } else {
        date.removeAttribute('datetime');
      }
    }
    function syncCardDot(card, assignedTag) {
      let dot = card.querySelector(':scope > .wd-app-card-dot');
      if (!assignedTag) { dot?.remove(); card.classList.remove('wd-app-card-tagged'); return; }
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'wd-app-card-dot';
        dot.setAttribute('aria-hidden', 'true');
        card.append(dot);
      }
      card.classList.add('wd-app-card-tagged');
      dot.style.backgroundColor = assignedTag.color || '#facc15';
      dot.title = assignedTag.name;
    }
    function filterCards() {
      const byId = new Map(records.map(record => [record.id, record]));
      let shown = 0;
      const searchTitles = [];
      for (const card of grid.children) {
        if (!card.dataset.id) continue;
        const visible = !active || byId.get(card.dataset.id)?.tagId === active;
        card.classList.toggle('wd-app-tag-hidden', !visible);
        if (visible) shown++;
        const record = byId.get(card.dataset.id);
        if (visible && record) searchTitles.push(record.name || record.title || '');
        const assignedTag = tags.find(tag => tag.id === record?.tagId);
        syncCardDot(card, assignedTag);
        const existingButton = card.querySelector('.wd-app-card-tag');
        if (existingButton) {
          const label = assignedTag ? `Set tag (currently ${assignedTag.name})` : 'Set tag';
          existingButton.setAttribute('aria-label', label);
          existingButton.title = label;
          decorateRow(card, assignedTag, record);
          window.WDHomeUI?.decorateCard(card, app, record, assignedTag, config.actions);
          continue;
        }
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'wd-app-card-tag';
        const label = assignedTag ? `Set tag (currently ${assignedTag.name})` : 'Set tag';
        button.setAttribute('aria-label', label); button.title = label;
        button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12 12 20 2 10V2h8l10 10Z"/><circle cx="7" cy="7" r="1"/></svg>';
        button.addEventListener('keydown', event => event.stopPropagation());
        // Keep the parent card's open/keyboard handlers from firing.
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          const current = records.find(item => item.id === card.dataset.id);
          let changed = false;
          WDDialog.open({
            title: 'Edit Tags',
            message: tags.length ? 'Choose a tag for this item. Changes are saved automatically.' : 'No tags yet. Create one in the sidebar to group your files.',
            field: { label: 'Tag', value: current?.tagId || '', choices: [
              { value: '', label: 'No tags' }, ...tags.map(tag => ({ value: tag.id, label: tag.name })),
            ] },
            autosave: true,
            onSubmit: async value => {
              await request('setFileTag', { app, fileId: card.dataset.id, tagId: value || null });
              changed = true;
            },
            // Fetch the new revision before entering any versioned editor.
            onClose: () => { if (changed) location.reload(); },
          });
        });
        (card.querySelector(config.actions) || card).append(button);
        decorateRow(card, assignedTag, record);
        window.WDHomeUI?.decorateCard(card, app, record, assignedTag, config.actions);
      }
      window.WDHomeUI?.setSearchTitles?.(searchTitles);
      const noResults = aside.querySelector('.wd-app-side-no-results');
      if (noResults) noResults.remove();
      if (active && shown === 0) {
        const empty = document.createElement('p');
        empty.className = 'wd-app-side-no-results'; empty.textContent = 'No items in this tag.';
        list.append(empty);
      }
    }
    function applyData(data) {
      tags = data.tags || [];
      records = data[config.key] || [];
      if (active && !tags.some(tag => tag.id === active)) active = null;
      drawTags(); filterCards();
      loading.remove();
      delete document.documentElement.dataset.wdHomePending;
    }
    document.addEventListener('wd:home-data', event => {
      if (event.detail?.app === app) applyData(event.detail.data);
    });
    drawTags(); filterCards(); sync();
    // Relative labels change while the home page remains open.
    setInterval(() => {
      for (const date of grid.querySelectorAll('.wd-app-row-date')) {
        date.textContent = formatUpdatedAt(date.getAttribute('datetime'));
      }
    }, 60_000);
    let refreshTimer;
    // Repainting/searching is not a data mutation. Never download the entire
    // workspace just because results changed or a user returned from an editor.
    document.addEventListener('wd:data-changed', event => {
      if (event.detail?.app !== app || app === 'kanban') return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        try { applyData(await request()); } catch (_) { /* Keep the last view when offline. */ }
      }, 100);
    });
    new MutationObserver(() => {
      if (actionMenu && !actionMenu.trigger.isConnected) closeActions();
      filterCards();
    }).observe(grid, { childList: true });
    new MutationObserver(sync).observe(home, { attributes: true, attributeFilter: ['class'] });
    const desktop = matchMedia('(min-width: 1024px)');
    desktop.addEventListener('change', () => setOpen(desktop.matches));
    window.addEventListener('resize', sync);
    window.addEventListener('pageshow', async event => {
      if (!event.persisted) return;
      try { applyData(await request()); } catch (_) { /* no session */ }
    });
    const load = async () => {
      loading.textContent = 'Loading…';
      try {
        const data = app === 'kanban' && window.WDKanbanData ? await window.WDKanbanData
          : window.WDBoot ? await window.WDBoot.homeData(true) : await request();
        if (!data) throw new Error('Could not load items');
        applyData(data);
      } catch (error) {
        loading.textContent = 'Could not load this view. ';
        const retry = document.createElement('button');
        retry.type = 'button'; retry.textContent = 'Retry';
        retry.onclick = () => location.reload();
        loading.append(retry);
        console.warn('App home:', error);
      }
    };
    await load();
  });
})();
