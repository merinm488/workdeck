/* One labelled dropdown for list/card actions throughout the Holm suite.
 * Icons must be trusted, app-owned SVG nodes/markup; labels are always text. */
(() => {
  let active = null, sequence = 0;
  function position(rect, width, height, viewportWidth, viewportHeight) {
    const margin = 8, gap = 6;
    const below = Math.max(0, viewportHeight - rect.bottom - gap - margin);
    const above = Math.max(0, rect.top - gap - margin);
    const opensAbove = below < height && above > below;
    const maxHeight = Math.max(0, opensAbove ? above : below);
    return {
      left: Math.max(margin, Math.min(rect.right - width, viewportWidth - width - margin)),
      top: opensAbove ? Math.max(margin, rect.top - gap - Math.min(height, maxHeight)) : rect.bottom + gap,
      maxHeight,
    };
  }
  function open(trigger, items, options = {}) {
    if (active?.trigger === trigger) { active.close({ restoreFocus: true }); return null; }
    active?.close();
    items = items.filter(item => !item.hidden);
    // Keep destructive actions together at the bottom regardless of the order
    // of the original card buttons (tag actions are often appended last).
    items = [...items.filter(item => !item.danger), ...items.filter(item => item.danger)];
    if (!items.length) return null;
    const menu = document.createElement('div');
    menu.id = `wd-action-menu-${++sequence}`;
    menu.className = 'wd-action-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', options.label || 'File actions');
    const buttons = [];
    let previousDanger = false;
    for (const item of items) {
      if (buttons.length && item.danger && !previousDanger) {
        const divider = document.createElement('div');
        divider.className = 'wd-action-menu-divider'; divider.setAttribute('role', 'separator'); menu.append(divider);
      }
      previousDanger = !!item.danger;
      const button = document.createElement('button');
      button.type = 'button'; button.tabIndex = -1; button.setAttribute('role', 'menuitem');
      button.className = 'wd-action-menu-item';
      button.classList.toggle('danger', !!item.danger);
      button.disabled = !!item.disabled;
      const icon = document.createElement('span'); icon.className = 'wd-action-menu-icon'; icon.setAttribute('aria-hidden', 'true');
      if (typeof item.icon === 'string') icon.innerHTML = item.icon;
      else if (item.icon) icon.append(item.icon.cloneNode(true));
      const label = document.createElement('span'); label.className = 'wd-action-menu-label'; label.textContent = item.label;
      button.append(icon, label);
      button.onclick = event => {
        event.preventDefault(); event.stopPropagation();
        handle.close({ restoreFocus: true });
        item.onSelect();
      };
      menu.append(button); buttons.push(button);
    }
    menu.onclick = event => event.stopPropagation();
    menu.onkeydown = event => event.stopPropagation();
    document.body.append(menu);
    const bounds = position(trigger.getBoundingClientRect(), menu.offsetWidth, menu.scrollHeight, innerWidth, innerHeight);
    Object.assign(menu.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, maxHeight: `${bounds.maxHeight}px` });
    trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', menu.id);
    const enabled = buttons.filter(button => !button.disabled);
    const focus = index => enabled[(index + enabled.length) % enabled.length]?.focus({ preventScroll: true });
    const outside = event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) handle.close(); };
    const scroll = event => { if (!menu.contains(event.target)) handle.close(); };
    const resize = () => handle.close();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); handle.close({ restoreFocus: true }); }
      else if (event.key === 'Tab') handle.close({ restoreFocus: true });
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const index = enabled.indexOf(document.activeElement);
        focus(event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1));
        document.activeElement?.scrollIntoView({ block: 'nearest' });
      }
    };
    // Cards may be replaced by search, filtering or an async refresh while a
    // menu is open. Never leave an orphaned dropdown targeting an old record.
    const observer = new MutationObserver(() => { if (!trigger.isConnected) handle.close(); });
    let closed = false;
    const handle = {
      trigger, element: menu,
      close({ restoreFocus = false } = {}) {
        if (closed) return;
        closed = true; observer.disconnect(); menu.remove();
        trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls');
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', keydown, true);
        window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize);
        if (active === handle) active = null;
        if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
        options.onClose?.();
      },
    };
    active = handle;
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('scroll', scroll, true); window.addEventListener('resize', resize);
    focus(options.focusLast ? enabled.length - 1 : 0);
    return handle;
  }
  function fromButton(button, overrides = {}) {
    return {
      label: button.classList.contains('wd-app-card-tag') ? 'Edit Tags' : button.classList.contains('delete-meeting') ? 'Delete' : (button.title || button.getAttribute('aria-label') || button.textContent.trim()),
      icon: button.querySelector('svg'), disabled: button.disabled,
      danger: button.classList.contains('danger') || button.classList.contains('delete-meeting') || /delete/i.test(button.title || button.getAttribute('aria-label') || ''),
      onSelect: () => button.click(), ...overrides,
    };
  }
  function createCardTrigger(getItems) {
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'wd-card-more';
    trigger.title = 'More actions'; trigger.setAttribute('aria-label', 'More actions');
    trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';
    trigger.onclick = event => { event.preventDefault(); event.stopPropagation(); open(trigger, getItems()); };
    trigger.onkeydown = event => {
      event.stopPropagation();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); open(trigger, getItems(), { focusLast: event.key === 'ArrowUp' });
      }
    };
    return trigger;
  }
  window.WDActionMenu = { open, fromButton, position, createCardTrigger };
})();
