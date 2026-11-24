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
    const response = await fetch('/api/workdeck', {
      method: action ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(action ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) } : {}),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not load tags');
    return (await response.json()).data;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const grid = $(config.grid), home = $(config.home), nav = $(config.nav);
    if (!grid || !home || !nav) return;
    // Only show the panel once the member session has been verified.
    let data;
    try { data = await request(); } catch (error) { console.warn('Tag sidebar:', error); return; }
    tags = data.tags || [];
    records = data[config.key] || [];
    if (active && !tags.some(tag => tag.id === active)) active = null;

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
    aside.innerHTML = `<div class="wd-app-side-brand"><strong>${app === 'draw' ? 'Draw' : app[0].toUpperCase() + app.slice(1)}</strong></div>
      <nav aria-label="Filter by tag"><button type="button" class="wd-app-side-all">All items</button>
        <div class="wd-app-side-heading"><span>Tags</span><button type="button" class="wd-app-side-add" aria-label="New tag" title="New tag"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg></button></div>
        <form class="wd-app-side-form" hidden><input type="text" maxlength="60" required placeholder="Tag name" aria-label="Tag name" autocomplete="off"><div class="wd-app-side-colors" role="group" aria-label="Tag color"></div><div class="wd-app-side-form-actions"><button type="submit" class="wd-app-side-submit">Create</button><button type="button" class="wd-app-side-cancel">Cancel</button></div><button type="button" class="wd-app-side-delete" hidden>Delete tag</button><p class="wd-app-side-error" role="alert" hidden></p></form>
        <div class="wd-app-side-tags"></div></nav>`;
    document.body.append(scrim, aside);
    home.classList.add('wd-app-side-home');
    const all = $('.wd-app-side-all'), list = $('.wd-app-side-tags'), form = $('.wd-app-side-form');
    const nameInput = form.querySelector('input[type=text]'), colors = form.querySelector('.wd-app-side-colors');
    const submit = form.querySelector('.wd-app-side-submit'), deleteButton = form.querySelector('.wd-app-side-delete');
    const errorText = form.querySelector('.wd-app-side-error');
    const palette = ['#FACC15', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4', '#F97316'];
    let editing = null, selectedColor = palette[0];
    function renderColors() {
      colors.replaceChildren();
      for (const color of palette) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'wd-app-side-swatch';
        swatch.style.background = color;
        swatch.setAttribute('aria-label', 'Pick color ' + color);
        swatch.setAttribute('aria-pressed', String(selectedColor.toLowerCase() === color.toLowerCase()));
        swatch.onclick = () => { selectedColor = color; renderColors(); };
        colors.append(swatch);
      }
    }
    function closeForm() {
      form.hidden = true;
      form.reset();
      editing = null;
      errorText.hidden = true;
    }
    function openForm(tag = null) {
      editing = tag;
      nameInput.value = tag ? tag.name : '';
      selectedColor = tag?.color || palette[0];
      submit.textContent = tag ? 'Save' : 'Create';
      deleteButton.hidden = !tag;
      errorText.hidden = true;
      renderColors();
      form.hidden = false;
      form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      nameInput.focus();
    }
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
    };
    const setOpen = value => { open = value; sync(); };
    toggle.onclick = () => setOpen(!open);
    scrim.onclick = () => setOpen(false);
    const choose = id => {
      active = id;
      try { if (id) sessionStorage.setItem(storageKey, id); else sessionStorage.removeItem(storageKey); } catch (_) { /* private mode */ }
      drawTags(); filterCards();
      if (!matchMedia('(min-width: 1024px)').matches) setOpen(false);
    };
    all.onclick = () => choose(null);
    aside.querySelector('.wd-app-side-add').onclick = () => { if (form.hidden || editing) openForm(); else closeForm(); };
    aside.querySelector('.wd-app-side-cancel').onclick = closeForm;
    deleteButton.onclick = async () => {
      if (!editing || !confirm(`Delete “${editing.name}” and every tagged item in ALL apps? This cannot be undone.`)) return;
      deleteButton.disabled = true;
      errorText.hidden = true;
      try {
        await request('deleteTag', { tagId: editing.id });
        // A suite tag can contain items in other apps. Reload their cards too.
        choose(null); location.reload();
      } catch (error) { errorText.textContent = error.message; errorText.hidden = false; }
      finally { deleteButton.disabled = false; }
    };
    nameInput.onkeydown = event => { if (event.key === 'Escape') closeForm(); };
    form.onsubmit = async event => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      submit.disabled = true;
      errorText.hidden = true;
      try {
        const result = editing
          ? await request('updateTag', { tagId: editing.id, updates: { name, color: selectedColor } })
          : await request('createTag', { name, color: selectedColor });
        tags = result.tags || [];
        closeForm(); drawTags(); filterCards();
      } catch (error) { errorText.textContent = error.message; errorText.hidden = false; }
      finally { submit.disabled = false; }
    };
    function drawTags() {
      all.classList.toggle('active', !active);
      all.setAttribute('aria-current', String(!active));
      list.replaceChildren();
      for (const tag of tags) {
        const row = document.createElement('div');
        row.className = 'wd-app-side-tag';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wd-app-side-tag-name';
        button.classList.toggle('active', active === tag.id);
        button.setAttribute('aria-current', String(active === tag.id));
        const dot = document.createElement('span');
        dot.className = 'wd-app-side-dot';
        dot.style.backgroundColor = tag.color || '#facc15';
        button.append(dot, document.createTextNode(tag.name));
        const count = document.createElement('span');
        count.className = 'wd-app-side-count';
        count.textContent = String(records.filter(record => record.tagId === tag.id).length);
        button.append(count);
        button.onclick = () => choose(tag.id);
        const rename = document.createElement('button');
        rename.type = 'button'; rename.textContent = '···'; rename.title = `Edit or delete ${tag.name}`;
        rename.setAttribute('aria-label', `Edit or delete ${tag.name}`);
        rename.className = 'wd-app-side-more';
        rename.onclick = () => openForm(tag);
        row.append(button, rename); list.append(row);
      }
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
      try { grid.classList.toggle('as-list', localStorage.getItem(`wd_${app}_layout`) === 'list'); } catch (_) { /* private mode */ }
      syncView();
      view.onclick = () => {
        grid.classList.toggle('as-list'); syncView();
        try { localStorage.setItem(`wd_${app}_layout`, grid.classList.contains('as-list') ? 'list' : 'cards'); } catch (_) { /* private mode */ }
      };
      const viewNav = app === 'blog' ? nav.querySelector('.blog-topbar-actions')
        : app === 'kanban' ? document.querySelector('.top-nav-right') : nav;
      if (app === 'minutes') viewNav.insertBefore(view, nav.querySelector('#newBtn'));
      else viewNav.prepend(view);
    }
    let actionStrip = null, actionTrigger = null;
    const closeActions = () => {
      actionStrip?.remove(); actionStrip = null;
      actionTrigger?.setAttribute('aria-expanded', 'false'); actionTrigger = null;
    };
    const showActions = (card, trigger) => {
      if (actionTrigger === trigger) { closeActions(); return; }
      closeActions();
      actionTrigger = trigger;
      trigger.setAttribute('aria-expanded', 'true');
      const strip = document.createElement('div');
      strip.className = 'wd-app-action-strip';
      strip.setAttribute('role', 'group');
      strip.setAttribute('aria-label', 'File actions');
      const originals = (card.querySelector(config.actions) || card).querySelectorAll('button');
      for (const original of originals) {
        if (original === trigger || original.classList.contains('wd-app-list-more')) continue;
        const proxy = document.createElement('button');
        proxy.type = 'button';
        const label = original.getAttribute('aria-label') || original.title || original.textContent.trim();
        proxy.setAttribute('aria-label', label); proxy.title = label;
        proxy.innerHTML = original.classList.contains('delete-meeting')
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>'
          : original.innerHTML;
        proxy.classList.toggle('danger', /delete/i.test(label));
        proxy.onclick = event => { event.preventDefault(); event.stopPropagation(); closeActions(); original.click(); };
        strip.append(proxy);
      }
      if (!strip.childElementCount) { closeActions(); return; }
      document.body.append(strip);
      const rect = trigger.getBoundingClientRect(), width = strip.offsetWidth, height = strip.offsetHeight;
      const left = rect.left - width - 6, right = rect.right + 6;
      strip.style.left = `${left >= 8 ? left : right + width <= innerWidth - 8 ? right : Math.max(8, innerWidth - width - 8)}px`;
      strip.style.top = `${Math.max(8, Math.min(rect.top + (rect.height - height) / 2, innerHeight - height - 8))}px`;
      actionStrip = strip;
    };
    document.addEventListener('pointerdown', event => {
      if (actionStrip && !actionStrip.contains(event.target) && !actionTrigger?.contains(event.target)) closeActions();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && actionStrip) { const trigger = actionTrigger; closeActions(); trigger?.focus(); }
    });
    window.addEventListener('scroll', closeActions, true);
    window.addEventListener('resize', closeActions);
    function decorateRow(card, assignedTag, record) {
      let badge = card.querySelector(':scope > .wd-app-row-tag');
      if (!badge) {
        badge = document.createElement('span'); badge.className = 'wd-app-row-tag';
        const date = document.createElement('time'); date.className = 'wd-app-row-date';
        const more = document.createElement('button');
        more.type = 'button'; more.className = 'wd-app-list-more';
        more.setAttribute('aria-label', 'More actions'); more.title = 'More actions';
        more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false');
        more.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';
        more.onclick = event => { event.preventDefault(); event.stopPropagation(); showActions(card, more); };
        more.onkeydown = event => event.stopPropagation();
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
      for (const card of grid.children) {
        if (!card.dataset.id) continue;
        const visible = !active || byId.get(card.dataset.id)?.tagId === active;
        card.classList.toggle('wd-app-tag-hidden', !visible);
        if (visible) shown++;
        const record = byId.get(card.dataset.id);
        const assignedTag = tags.find(tag => tag.id === record?.tagId);
        syncCardDot(card, assignedTag);
        const existingButton = card.querySelector('.wd-app-card-tag');
        if (existingButton) {
          const label = assignedTag ? `Set tag (currently ${assignedTag.name})` : 'Set tag';
          existingButton.setAttribute('aria-label', label);
          existingButton.title = label;
          decorateRow(card, assignedTag, record);
          continue;
        }
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'wd-app-card-tag';
        const label = assignedTag ? `Set tag (currently ${assignedTag.name})` : 'Set tag';
        button.setAttribute('aria-label', label); button.title = label;
        button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12 12 20 2 10V2h8l10 10Z"/><circle cx="7" cy="7" r="1"/></svg>';
        button.addEventListener('keydown', event => event.stopPropagation());
        // Keep the parent card's open/keyboard handlers from firing.
        button.addEventListener('click', async event => {
          event.preventDefault(); event.stopPropagation();
          const selected = prompt(`Tag for this ${app} item (enter a tag name, or leave blank to remove):`,
            tags.find(tag => tag.id === byId.get(card.dataset.id)?.tagId)?.name || '');
          if (selected === null) return;
          const tag = tags.find(t => t.name.toLowerCase() === selected.trim().toLowerCase());
          if (selected.trim() && !tag) { alert('Choose an existing tag in the sidebar first.'); return; }
          try {
            await request('setFileTag', { app: app === 'draw' ? 'draw' : app === 'blog' ? 'blog' : app, fileId: card.dataset.id, tagId: tag?.id || null });
            location.reload(); // versioned editors must fetch the new revision
          } catch (error) { alert(error.message); }
        });
        (card.querySelector(config.actions) || card).append(button);
        decorateRow(card, assignedTag, record);
      }
      const noResults = aside.querySelector('.wd-app-side-no-results');
      if (noResults) noResults.remove();
      if (active && shown === 0) {
        const empty = document.createElement('p');
        empty.className = 'wd-app-side-no-results'; empty.textContent = 'No items in this tag.';
        list.append(empty);
      }
    }
    drawTags(); filterCards(); sync();
    // Relative labels change while the home page remains open.
    setInterval(() => {
      for (const date of grid.querySelectorAll('.wd-app-row-date')) {
        date.textContent = formatUpdatedAt(date.getAttribute('datetime'));
      }
    }, 60_000);
    new MutationObserver(() => { if (actionTrigger && !actionTrigger.isConnected) closeActions(); filterCards(); }).observe(grid, { childList: true });
    new MutationObserver(sync).observe(home, { attributes: true, attributeFilter: ['class'] });
    const desktop = matchMedia('(min-width: 1024px)');
    desktop.addEventListener('change', () => setOpen(desktop.matches));
    window.addEventListener('resize', sync);
    window.addEventListener('pageshow', async () => {
      try { const fresh = await request(); tags = fresh.tags || []; records = fresh[config.key] || []; drawTags(); filterCards(); } catch (_) { /* no session */ }
    });
  });
})();
