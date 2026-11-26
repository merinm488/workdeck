/* Inline title completion for app-home searches. Titles come from the app's
   existing results, never another request or another app's private records. */
(() => {
  let sequence = 0;
  function match(value, titles) {
    if (!value.trim()) return null;
    const query = value.toLowerCase();
    const names = titles.filter(title => typeof title === 'string');
    // An exact filename is already complete; the next Tab must leave the field.
    if (names.some(title => title.toLowerCase() === query)) return null;
    return names.find(title => title.length > value.length && title.toLowerCase().startsWith(query)) || null;
  }

  function mount(input, { getTitles, onAccept } = {}) {
    const box = input.parentElement;
    const ghost = document.createElement('span');
    ghost.className = 'wd-search-completion'; ghost.hidden = true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = '<span class="wd-search-completion-anchor"><span class="wd-search-completion-prefix"></span><span class="wd-search-completion-rest"></span></span>';
    const anchor = ghost.firstElementChild, prefix = anchor.firstElementChild, rest = anchor.lastElementChild;
    const hint = document.createElement('span');
    hint.className = 'wd-search-completion-hint'; hint.id = `wd-search-completion-${++sequence}`;
    hint.setAttribute('role', 'status'); hint.setAttribute('aria-live', 'polite'); hint.setAttribute('aria-atomic', 'true');
    box.append(ghost, hint);
    const previous = { autocomplete: input.getAttribute('autocomplete'), aria: input.getAttribute('aria-autocomplete'), description: input.getAttribute('aria-describedby') };
    input.setAttribute('autocomplete', 'off'); input.setAttribute('aria-autocomplete', 'inline');
    input.setAttribute('aria-describedby', [previous.description, hint.id].filter(Boolean).join(' '));
    let suggestion = null, composing = false, disposed = false;
    const listeners = [];
    const listen = (target, name, fn, capture = false) => {
      target.addEventListener(name, fn, capture); listeners.push(() => target.removeEventListener(name, fn, capture));
    };
    const position = () => {
      if (ghost.hidden) return;
      // Preserve the real input text/caret. Only the untyped suffix is overlaid.
      const overflow = Math.max(0, anchor.offsetWidth - ghost.clientWidth);
      anchor.style.transform = `translateX(${overflow / 2 - input.scrollLeft}px)`;
    };
    function refresh() {
      if (disposed) return;
      const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
      suggestion = document.activeElement === input && !composing && atEnd && !input.disabled && !input.readOnly
        ? match(input.value, getTitles?.() || []) : null;
      ghost.hidden = !suggestion;
      prefix.textContent = suggestion ? input.value : '';
      rest.textContent = suggestion ? suggestion.slice(input.value.length) : '';
      const message = suggestion ? `Suggested: ${suggestion}. Press Tab to complete.` : '';
      if (hint.textContent !== message) hint.textContent = message;
      position();
    }
    listen(input, 'input', refresh);
    listen(input, 'focus', refresh);
    listen(input, 'blur', refresh);
    listen(input, 'click', refresh);
    listen(input, 'keyup', refresh);
    listen(input, 'select', refresh);
    listen(input, 'scroll', position);
    listen(document, 'selectionchange', () => { if (document.activeElement === input) refresh(); });
    listen(input, 'compositionstart', () => { composing = true; refresh(); });
    listen(input, 'compositionend', () => { composing = false; refresh(); });
    listen(input, 'keydown', event => {
      if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || composing) return;
      refresh(); // Never accept a stale match after a filter, rename or selection change.
      if (!suggestion) return;
      event.preventDefault(); event.stopPropagation();
      const value = suggestion;
      ghost.hidden = true; hint.textContent = ''; suggestion = null;
      if (onAccept) onAccept(value); // React owns its controlled input value.
      else {
        input.value = value;
        input.setSelectionRange(value.length, value.length);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const resize = new ResizeObserver(position); resize.observe(input); resize.observe(anchor);
    refresh();
    return { refresh, destroy() {
      disposed = true; resize.disconnect(); listeners.forEach(remove => remove()); ghost.remove(); hint.remove();
      for (const [name, value] of [['autocomplete', previous.autocomplete], ['aria-autocomplete', previous.aria], ['aria-describedby', previous.description]]) {
        if (value === null) input.removeAttribute(name); else input.setAttribute(name, value);
      }
    } };
  }
  window.WDSearchSuggestions = { match, mount };
})();
