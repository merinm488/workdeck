/* Native, focus-contained dialogs for suite-owned actions. App callbacks retain
   validation/storage; text and choices are never interpreted as HTML. */
(() => {
  let sequence = 0;
  function open({ title, message, field, confirmLabel = 'Done', danger = false, autosave = false, onSubmit, onClose }) {
    const previousFocus = document.activeElement;
    const previousRecord = previousFocus?.closest('[data-id]')?.dataset.id;
    const dialog = document.createElement('dialog');
    const id = `wd-dialog-${++sequence}`;
    dialog.className = 'wd-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.innerHTML = `<form><div class="wd-dialog-heading"><h2 id="${id}-title"></h2><button type="button" class="wd-dialog-close" aria-label="Close">×</button></div><p class="wd-dialog-message" id="${id}-message"></p><div class="wd-dialog-field"></div><p class="wd-dialog-status" role="status" aria-live="polite"></p><p class="wd-dialog-error" role="alert" hidden></p><div class="wd-dialog-actions"><button type="button" class="wd-secondary-btn wd-dialog-cancel">Cancel</button><button type="submit" class="${danger ? 'wd-danger-btn' : 'wd-primary-btn'}"></button></div></form>`;
    dialog.querySelector('h2').textContent = title;
    const description = dialog.querySelector('.wd-dialog-message');
    description.textContent = message || ''; description.hidden = !message;
    if (message) dialog.setAttribute('aria-describedby', description.id);
    const form = dialog.querySelector('form'), submit = form.querySelector('[type=submit]');
    const cancel = form.querySelector('.wd-dialog-cancel'), status = form.querySelector('.wd-dialog-status');
    const error = form.querySelector('.wd-dialog-error');
    submit.textContent = confirmLabel;
    cancel.hidden = autosave;
    let input, busy = false, savedValue = field?.value ?? '';
    if (field) {
      const label = document.createElement('label'); label.textContent = field.label;
      input = document.createElement(field.choices ? 'select' : 'input');
      if (field.choices) {
        for (const choice of field.choices) {
          const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; input.append(option);
        }
      } else {
        input.type = 'text'; input.required = true; input.autocomplete = 'off';
        if (field.maxLength) input.maxLength = field.maxLength;
      }
      input.value = savedValue;
      input.id = `${id}-field`; label.htmlFor = input.id;
      form.querySelector('.wd-dialog-field').append(label, input);
      input.addEventListener('input', () => input.setCustomValidity(''));
    }
    function close() { if (!busy) dialog.close(); }
    cancel.onclick = close;
    form.querySelector('.wd-dialog-close').onclick = close;
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    dialog.addEventListener('close', () => {
      // The native close step may already have restored focus. Do not steal it
      // back if the user has moved to another control before this event runs.
      const restoreFocus = document.activeElement === previousFocus || document.activeElement === document.body || dialog.contains(document.activeElement);
      dialog.remove();
      const replacement = previousRecord && [...document.querySelectorAll(`[data-id="${CSS.escape(previousRecord)}"] :is(.wd-card-more,.wd-app-list-more)`)]
        .find(control => control.getClientRects().length);
      const target = previousFocus?.isConnected ? previousFocus : replacement;
      if (restoreFocus) target?.focus({ preventScroll: true });
      onClose?.();
    });
    async function save(closeAfter) {
      if (busy) return;
      const value = input?.value.trim();
      if (input && !field.choices && !value) input.setCustomValidity('Enter a name.');
      if (!form.reportValidity()) return;
      if (autosave && value === savedValue) { if (closeAfter) close(); return; }
      busy = true; dialog.setAttribute('aria-busy', 'true'); error.hidden = true; status.textContent = autosave ? 'Saving…' : 'Working…';
      form.querySelectorAll('button,input,select').forEach(control => { control.disabled = true; });
      try {
        if (await onSubmit(value) === false) throw new Error('Could not save changes. Please try again.');
        savedValue = value; status.textContent = autosave ? 'All changes saved' : '';
        busy = false;
        if (closeAfter) dialog.close();
      } catch (err) {
        status.textContent = ''; error.textContent = err.message || 'Something went wrong. Please try again.'; error.hidden = false;
      } finally {
        busy = false; dialog.setAttribute('aria-busy', 'false');
        form.querySelectorAll('button,input,select').forEach(control => { control.disabled = false; });
        if (dialog.open) input?.focus();
      }
    }
    form.onsubmit = event => { event.preventDefault(); save(true); };
    if (autosave && input) input.addEventListener('change', () => save(false));
    document.body.append(dialog); dialog.showModal();
    (danger ? cancel : input || submit).focus();
    if (input?.tagName === 'INPUT') input.select();
    return dialog;
  }
  window.WDDialog = { open };
})();
