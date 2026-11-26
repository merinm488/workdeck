/* Shared Workdeck tag controls. Callbacks retain each app's storage/filtering
   and drag/drop behavior; only the view and confirmation flow are shared. */
(() => {
  const colors = ['#FACC15', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4', '#F97316'];
  const icons = {
    edit: '<path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>',
    delete: '<path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>',
  };
  const svg = name => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  let dialogId = 0;
  function confirmDelete(tag, remove) {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'wd-tag-ui wd-tag-dialog wd-modal-content';
    const titleId = `wd-tag-delete-${++dialogId}`;
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.innerHTML = `<div class="wd-modal-header"><h3 class="wd-modal-title" id="${titleId}">Delete Tag</h3><button type="button" class="wd-modal-close" aria-label="Close">×</button></div><p class="wd-modal-text wd-tag-delete-name"></p><p class="wd-modal-text">Items with this tag in Docs, Sheets, Forms, Slides, Draw, Todo, Kanban, Blog, Minutes and Calendar will be deleted. Files and folders in Files keep existing but lose this tag. This cannot be undone.</p><p class="wd-tag-error" role="alert" hidden></p><div class="wd-modal-actions"><button type="button" class="wd-secondary-btn">Cancel</button><button type="button" class="wd-danger-btn">Delete Tag</button></div>`;
    dialog.querySelector('.wd-tag-delete-name').textContent = `Delete “${tag.name}”?`;
    document.body.append(dialog);
    let busy = false;
    const close = () => { if (!busy) dialog.close(); };
    dialog.querySelector('.wd-modal-close').onclick = close;
    dialog.querySelector('.wd-secondary-btn').onclick = close;
    dialog.oncancel = event => { if (busy) event.preventDefault(); };
    dialog.onclick = event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } };
    dialog.onclose = () => { dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus(); };
    dialog.querySelector('.wd-danger-btn').onclick = async () => {
      busy = true;
      const error = dialog.querySelector('.wd-tag-error');
      error.hidden = true;
      dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
      try {
        if (await remove(tag.id) === false) throw new Error('Could not delete tag. Please try again.');
        busy = false;
        dialog.close();
      } catch (err) { error.textContent = err.message; error.hidden = false; }
      finally { busy = false; dialog.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
    };
    dialog.showModal();
    dialog.querySelector('.wd-secondary-btn').focus();
    return dialog;
  }

  // The Workdeck home picker is the single item-tag editor for every app.
  // Keep draft selection local until Save; a failed write never dismisses it.
  function editTags({ name, tags = [], tagId = null, onSave, onClose, trigger = document.activeElement }) {
    const previousRecord = trigger?.closest('[data-id]')?.dataset.id;
    const dialog = document.createElement('dialog');
    const id = `wd-tag-edit-${++dialogId}`;
    dialog.className = 'wd-tag-ui wd-tag-dialog wd-tag-picker wd-modal-content';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.setAttribute('aria-describedby', `${id}-description`);
    dialog.innerHTML = `<form><div class="wd-modal-header"><h3 class="wd-modal-title" id="${id}-title">Edit tags</h3><button type="button" class="wd-modal-close" aria-label="Close">×</button></div><div class="wd-modal-body"><p class="wd-modal-text" id="${id}-description">Choose a tag for “<span class="wd-strong"></span>”.</p><div class="wd-move-select"><span class="wd-move-label" id="${id}-label">Tag</span><button type="button" class="wd-move-select-trigger" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-label ${id}-value" aria-controls="${id}-options"><span class="wd-move-select-value" id="${id}-value"></span><svg class="wd-move-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="wd-move-menu" id="${id}-options" role="listbox" aria-label="Tags"></div></div><p class="wd-tag-error" role="alert" hidden></p><div class="wd-modal-actions"><button type="button" class="wd-secondary-btn">Cancel</button><button type="submit" class="wd-primary-btn">Save</button></div></div></form>`;
    dialog.querySelector('.wd-strong').textContent = name || 'Untitled';
    const form = dialog.querySelector('form'), select = form.querySelector('.wd-move-select');
    const toggle = form.querySelector('.wd-move-select-trigger'), value = form.querySelector('.wd-move-select-value');
    const menu = form.querySelector('.wd-move-menu'), error = form.querySelector('.wd-tag-error');
    const submit = form.querySelector('[type=submit]');
    const options = [{ id: null, name: 'No tags', color: null }, ...tags];
    let selected = tagId || null, expanded = false, busy = false, saved = false;
    const dot = color => {
      const node = document.createElement('span');
      node.className = 'wd-dot' + (color ? '' : ' wd-dot-none');
      if (color) node.style.backgroundColor = color;
      return node;
    };
    function expand(open, index) {
      expanded = open;
      menu.classList.toggle('active', open); select.classList.toggle('active', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        const rows = [...menu.querySelectorAll('[role=option]')];
        const target = rows[index ?? Math.max(0, options.findIndex(option => option.id === selected))];
        target?.focus(); target?.scrollIntoView({ block: 'nearest' });
      }
    }
    function render() {
      menu.replaceChildren();
      const current = options.find(option => option.id === selected) || options[0];
      const label = document.createElement('span');
      label.className = current.color ? 'wd-move-select-name' : 'wd-move-select-placeholder';
      label.textContent = current.name;
      value.replaceChildren(dot(current.color), label);
      for (const option of options) {
        const row = document.createElement('button');
        row.type = 'button'; row.tabIndex = -1;
        row.className = 'wd-move-option' + (option.id === selected ? ' selected' : '');
        row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.id === selected));
        const label = document.createElement('span'); label.className = 'wd-move-option-name'; label.textContent = option.name;
        row.innerHTML = '<svg class="wd-move-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3 7 3 3 5-6"/></svg>';
        row.prepend(dot(option.color), label);
        row.onclick = () => { selected = option.id; render(); expand(false); toggle.focus(); };
        menu.append(row);
      }
      if (!tags.length) {
        const empty = document.createElement('p'); empty.className = 'wd-move-empty';
        empty.textContent = 'No tags yet — create one in the sidebar.'; menu.append(empty);
      }
    }
    toggle.onclick = () => expand(!expanded);
    toggle.onkeydown = event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); expand(true, event.key === 'ArrowUp' ? options.length - 1 : undefined);
      }
    };
    menu.onkeydown = event => {
      const rows = [...menu.querySelectorAll('[role=option]')], index = rows.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        rows[next].focus(); rows[next].scrollIntoView({ block: 'nearest' });
      }
      if (event.key === 'Tab') expand(false);
    };
    const close = () => { if (!busy) dialog.close(); };
    form.querySelector('.wd-modal-close').onclick = close;
    form.querySelector('.wd-secondary-btn').onclick = close;
    dialog.oncancel = event => { event.preventDefault(); close(); };
    dialog.onkeydown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (expanded) { expand(false); toggle.focus(); } else close();
    };
    dialog.onclick = event => {
      if (expanded && !select.contains(event.target)) expand(false);
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
    };
    dialog.onclose = () => {
      const restore = document.activeElement === trigger || document.activeElement === document.body || dialog.contains(document.activeElement);
      dialog.remove();
      const replacement = previousRecord && [...document.querySelectorAll(`[data-id="${CSS.escape(previousRecord)}"] :is(.wd-card-more,.wd-app-list-more,.fb-item-menu)`)].find(el => el.getClientRects().length);
      if (restore) (trigger?.isConnected ? trigger : replacement)?.focus({ preventScroll: true });
      onClose?.(saved);
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      if (selected === (tagId || null)) { close(); return; }
      busy = true; expand(false); error.hidden = true; dialog.setAttribute('aria-busy', 'true');
      submit.textContent = 'Saving…';
      form.querySelectorAll('button').forEach(button => { button.disabled = true; });
      try {
        if (await onSave(selected) === false) throw new Error('Could not save tags. Please try again.');
        saved = true; busy = false; dialog.close();
      } catch (err) {
        error.textContent = err.message || 'Could not save tags. Please try again.'; error.hidden = false;
      } finally {
        busy = false; dialog.setAttribute('aria-busy', 'false'); submit.textContent = 'Save';
        form.querySelectorAll('button').forEach(button => { button.disabled = false; });
        if (dialog.open) toggle.focus();
      }
    };
    render(); document.body.append(dialog); dialog.showModal(); toggle.focus();
    return dialog;
  }

  function mount(root, options) {
    root.classList.add('wd-tag-ui');
    root.innerHTML = '<div class="wd-side-header"><h2 class="wd-side-title">Tags</h2><button type="button" class="wd-side-add" aria-label="New tag" title="New tag"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v16m8-8H4"/></svg></button></div><form class="wd-project-form" hidden><input class="wd-input wd-project-input" type="text" maxlength="60" required placeholder="Tag name" aria-label="Tag name" autocomplete="off"><div class="wd-color-picker" role="group" aria-label="Tag color"></div><p class="wd-tag-error" role="alert" hidden></p><div class="wd-project-form-actions"><button type="submit" class="wd-primary-btn">Create</button><button type="button" class="wd-secondary-btn">Cancel</button></div></form><div class="wd-tag-rows"></div><p class="wd-side-empty" hidden>No tags yet. Create one to group your files.</p>';
    let props = options, editing = null, color = colors[0], busy = false, autosave = null;
    const form = root.querySelector('form'), input = form.querySelector('input'), picker = form.querySelector('.wd-color-picker');
    const error = form.querySelector('.wd-tag-error'), submit = form.querySelector('[type=submit]');
    const add = root.querySelector('.wd-side-add');
    const saveState = document.createElement('span');
    saveState.className = 'wd-save-status'; saveState.hidden = true;
    form.querySelector('.wd-project-form-actions').prepend(saveState);
    const changed = () => { if (editing && input.value.trim()) autosave?.change(); };
    input.addEventListener('input', changed);
    function renderColors() {
      picker.replaceChildren();
      for (const value of colors) {
        const swatch = document.createElement('button');
        swatch.type = 'button'; swatch.className = 'wd-color-swatch';
        swatch.style.background = value;
        swatch.classList.toggle('selected', value.toLowerCase() === color.toLowerCase());
        swatch.setAttribute('aria-label', `Pick color ${value}`);
        swatch.setAttribute('aria-pressed', String(value.toLowerCase() === color.toLowerCase()));
        swatch.onclick = () => { color = value; renderColors(); picker.children[colors.indexOf(value)].focus(); changed(); };
        picker.append(swatch);
      }
    }
    async function close() {
      if (busy || (editing && !input.reportValidity())) return;
      if (autosave && !await autosave.flush()) return;
      autosave?.dispose(); autosave = null;
      form.hidden = true; editing = null; add.focus();
    }
    async function open(tag = null) {
      if (busy || (autosave && !await autosave.flush())) return;
      autosave?.dispose(); autosave = null;
      editing = tag; input.value = tag?.name || ''; color = tag?.color || colors[0];
      submit.textContent = 'Create'; submit.hidden = !!tag; error.hidden = true;
      form.querySelector('.wd-secondary-btn').textContent = tag ? 'Done' : 'Cancel';
      saveState.hidden = !tag;
      if (tag) autosave = WDAutosave.create({
        save: async () => {
          const result = await props.onSave(tag.id, { name: input.value.trim(), color });
          return result !== false && result !== null;
        },
        onState: state => WDAutosave.status(state, saveState)
      });
      renderColors(); form.hidden = false; input.focus();
      form.scrollIntoView({ block: 'nearest' });
    }
    add.onclick = () => { if (form.hidden || editing) open(); else close(); };
    form.querySelector('.wd-secondary-btn').onclick = close;
    form.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    form.onsubmit = async event => {
      event.preventDefault();
      if (editing) { await close(); return; }
      if (busy || !input.value.trim()) return;
      busy = true; error.hidden = true;
      form.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
      try {
        const result = await props.onSave(editing?.id || null, { name: input.value.trim(), color });
        if (result === false || result === null) throw new Error('Could not save tag. Please try again.');
        busy = false; close();
      } catch (err) { error.textContent = err.message; error.hidden = false; }
      finally { busy = false; form.querySelectorAll('button, input').forEach(el => { el.disabled = false; }); }
    };
    function render() {
      const list = root.querySelector('.wd-tag-rows');
      list.replaceChildren();
      const tags = props.tags || [];
      root.querySelector('.wd-side-empty').hidden = tags.length > 0;
      for (const tag of tags) {
        const row = document.createElement('div');
        row.className = 'wd-side-row wd-project-row'; row.dataset.tag = tag.id;
        row.setAttribute('role', 'button'); row.tabIndex = 0;
        row.setAttribute('aria-label', tag.name);
        row.classList.toggle('active', props.active === tag.id);
        if (props.active === tag.id && /^#[\da-f]{6}$/i.test(tag.color)) row.style.background = `${tag.color}24`;
        row.innerHTML = `<span class="wd-dot"></span><span class="wd-side-row-name"></span><span class="wd-side-count"></span><span class="wd-side-actions"><button type="button" class="wd-side-action edit" title="Edit tag">${svg('edit')}</button><button type="button" class="wd-side-action danger" title="Delete tag">${svg('delete')}</button></span>`;
        row.querySelector('.wd-dot').style.background = tag.color;
        row.querySelector('.wd-side-row-name').textContent = tag.name;
        row.querySelector('.wd-side-count').textContent = props.count?.(tag.id) ?? 0;
        row.onclick = event => { if (!event.target.closest('button')) props.onSelect(tag.id); };
        row.onkeydown = event => { if (event.target === row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); props.onSelect(tag.id); } };
        const edit = row.querySelector('.edit'), remove = row.querySelector('.danger');
        edit.setAttribute('aria-label', `Edit ${tag.name}`); remove.setAttribute('aria-label', `Delete ${tag.name}`);
        edit.onclick = () => open(tag);
        remove.onclick = () => confirmDelete(tag, props.onDelete);
        props.onRow?.(row, tag.id);
        list.append(row);
      }
    }
    render();
    return { update(next) { props = next; render(); }, open, destroy() { autosave?.flush().then(() => autosave?.dispose()); root.replaceChildren(); } };
  }
  window.WDTagUI = { mount, confirmDelete, editTags };
})();
