import { useMemo, useState, useEffect, useRef } from 'react';

/**
 * BacklinksPanel — "Referenced by" list for a file, computed live by
 * scanning every app's content for mentions of targetId.
 *
 * Full variant: a titled section (doc view mode).
 * Compact variant: a count pill with a popover (doc edit mode footer).
 */
export function BacklinksPanel({ targetId, userData, onOpen, compact = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const backlinks = useMemo(() => {
    if (!targetId || !window.WDMentions) return [];
    return WDMentions.findBacklinks(targetId, userData || {});
  }, [targetId, userData]);

  // Close the compact popover on outside clicks.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!backlinks.length) return null;

  const chip = (b) => (
    <button
      key={b.app + ':' + b.id}
      type="button"
      className="wd-mention-chip"
      title={'Open ' + b.name}
      onClick={() => onOpen && onOpen({ app: b.app, id: b.id })}
    >
      <span
        className={`wdm-app-icon wdm-app-${b.app}`}
        dangerouslySetInnerHTML={{ __html: window.WDLinks ? WDLinks.icon(b.app, 13) : '' }}
      />
      <span>{b.name}</span>
    </button>
  );

  if (compact) {
    return (
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-[11.5px] leading-none text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 select-none"
          title="Files that mention this doc"
        >
          {backlinks.length} linked reference{backlinks.length === 1 ? '' : 's'}
        </button>
        {open && (
          <div className="absolute bottom-6 left-0 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 flex flex-col gap-1 min-w-[220px]">
            {backlinks.map(chip)}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-700">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
        Referenced by
      </h2>
      <div className="flex flex-wrap gap-2">
        {backlinks.map(chip)}
      </div>
    </section>
  );
}
