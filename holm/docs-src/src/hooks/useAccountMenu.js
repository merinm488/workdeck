import { useEffect, useRef } from 'react';

// React counterpart of the static account-menu keyboard behavior. Keep Tab
// native; dismiss on exit, and reserve arrows for menu controls, not text fields.
export function useAccountMenu(open, setOpen, triggerRef, panelRef) {
  const requestedFocus = useRef(null);
  useEffect(() => {
    const trigger = triggerRef.current;
    const controls = () => [...(panelRef.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled)') || [])]
      .filter(control => control.getClientRects().length);
    const focus = edge => (edge === 'last' ? controls().at(-1) : controls()[0])?.focus();
    if (open && requestedFocus.current) { focus(requestedFocus.current); requestedFocus.current = null; }
    const triggerKey = event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const edge = event.key === 'ArrowUp' ? 'last' : 'first';
      if (open) focus(edge); else { requestedFocus.current = edge; setOpen(true); }
    };
    const triggerClick = event => { if (!open && event.detail === 0) requestedFocus.current = 'first'; };
    const key = event => {
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger?.focus();
      } else if (panelRef.current?.contains(event.target) && !event.target.matches('input,textarea,select') &&
          ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const items = controls(), index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    const outside = event => {
      if (open && !panelRef.current?.contains(event.target) && !trigger?.contains(event.target)) setOpen(false);
    };
    trigger?.addEventListener('keydown', triggerKey);
    trigger?.addEventListener('click', triggerClick);
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      trigger?.removeEventListener('keydown', triggerKey); trigger?.removeEventListener('click', triggerClick);
      document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside);
    };
  }, [open, setOpen, triggerRef, panelRef]);
}
