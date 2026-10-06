import { useState, useEffect, useCallback, useRef } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { caretRect } from '../utils/mentions';

/**
 * MarkdownEditor Component
 *
 * All-in-one markdown editor using @uiw/react-md-editor:
 * - Built-in toolbar with all markdown formatting options
 * - Split-view: editor on left, live preview on right
 * - GitHub Flavored Markdown support
 * - Syntax highlighting for code blocks
 * - Dark mode support
 * - Responsive design
 * - Scrollable editor and preview panels
 *
 * Plus Workdeck mentions: typing "@" opens a file picker over every app
 * (WDMentions) and inserts a live hard link [@Name](/app/<id>). The "@ Link"
 * toolbar button links the current selection instead.
 */
export function MarkdownEditor({
  value = '',
  onChange,
  placeholder = 'Start writing your doc...',
  mentionExcludeId = null,
  enableMentions = true
}) {
  const [isDark, setIsDark] = useState(false);

  // Check for dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    checkDarkMode();

    // Watch for theme changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  // ===== Mentions =====
  const containerRef = useRef(null);
  // { handle, range: {from, to, query, label}, dismissedQuery }
  const mention = useRef({ handle: null, range: null, dismissedQuery: null });

  const pickRef = useRef(null);
  const syncRef = useRef(null);

  const findTextarea = useCallback(() => {
    return containerRef.current ? containerRef.current.querySelector('textarea') : null;
  }, []);

  const closeMention = useCallback((dismiss) => {
    if (mention.current.handle) {
      mention.current.handle.close();
      mention.current.handle = null;
    }
    if (dismiss && mention.current.range) {
      // Stay closed until the query text changes (Escape / outside click),
      // otherwise the next keyup would instantly reopen the picker.
      mention.current.dismissedQuery = mention.current.range.query;
    }
    mention.current.range = null;
  }, []);

  const pickMention = useCallback((entry) => {
    const range = mention.current.range;
    mention.current.handle = null;
    mention.current.range = null;
    if (!range) return;
    mention.current.dismissedQuery = '';
    // Read the CURRENT textarea content — the value prop may be stale if
    // the user kept typing after the picker opened.
    const ta = findTextarea();
    const current = ta ? ta.value : value;
    const markdown = WDMentions.mentionMarkdown(entry.app, entry.id, range.label || entry.name);
    onChange(insertRange(current, range, markdown));
    const caret = range.from + markdown.length;
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    });
  }, [value, onChange, findTextarea]);
  pickRef.current = pickMention;

  const openMention = useCallback((range, anchor) => {
    mention.current.range = range;
    mention.current.handle = WDMentions.open({
      anchor,
      mode: 'external',
      query: range.query,
      excludeIds: mentionExcludeId ? [mentionExcludeId] : [],
      onPick: (entry) => { if (pickRef.current) pickRef.current(entry); }
    });
  }, [mentionExcludeId]);

  /** Detect "@query" before the caret and sync the picker with it. */
  const syncMention = useCallback(() => {
    if (!enableMentions || !window.WDMentions) return;
    const ta = findTextarea();
    if (!ta) return;

    const pos = ta.selectionStart;
    const before = ta.value.slice(Math.max(0, pos - 200), pos);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (!match) {
      closeMention(false);
      return;
    }

    const query = match[1];
    if (mention.current.dismissedQuery === query) return;
    mention.current.dismissedQuery = null;

    const range = { from: pos - query.length - 1, to: pos, query, label: null };
    const anchor = caretRect(ta);
    const handle = mention.current.handle;
    if (handle && handle.visible()) {
      mention.current.range = range;
      if (query !== (handle.lastQuery || '')) {
        handle.lastQuery = query;
        handle.setFilter(query);
      }
      handle.reposition(anchor);
    } else {
      closeMention(false);
      openMention(range, anchor);
    }
  }, [enableMentions, closeMention, openMention, findTextarea]);

  /** "@ Link" button: link the selected text (or insert a fresh mention). */
  const linkSelection = useCallback(() => {
    if (!window.WDMentions) return;
    const ta = findTextarea();
    if (!ta) return;
    const label = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim() || null;
    const range = { from: ta.selectionStart, to: ta.selectionEnd, query: '', label };
    closeMention(false);
    openMention(range, caretRect(ta));
  }, [closeMention, openMention, findTextarea]);
  syncRef.current = syncMention;

  useEffect(() => {
    if (!enableMentions) return;
    const ta = findTextarea();
    if (!ta) {
      if (containerRef.current) containerRef.current.dataset.wdMentionReady = 'no-textarea';
      return;
    }
    if (containerRef.current) containerRef.current.dataset.wdMentionReady = 'attached';

    // Capture-phase keydown: runs before the editor's own shortcut handler
    // so Arrow keys / Enter / Escape steer the picker, not the text.
    const onKeyDown = (e) => {
      const handle = mention.current.handle;
      if (!handle || !handle.visible()) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation(); handle.move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation(); handle.move(-1);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation(); handle.pick();
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); closeMention(true);
      }
    };
    const onSync = () => { if (syncRef.current) syncRef.current(); };
    const onDocMouseDown = (e) => {
      const handle = mention.current.handle;
      if (!handle) return;
      const pop = document.querySelector('.wdm-pop');
      if (!pop || !pop.contains(e.target)) closeMention(true);
    };

    ta.addEventListener('keydown', onKeyDown, true);
    ta.addEventListener('input', onSync);
    ta.addEventListener('click', onSync);
    ta.addEventListener('keyup', onSync);
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => {
      ta.removeEventListener('keydown', onKeyDown, true);
      ta.removeEventListener('input', onSync);
      ta.removeEventListener('click', onSync);
      ta.removeEventListener('keyup', onSync);
      document.removeEventListener('mousedown', onDocMouseDown, true);
      closeMention(false);
    };
  }, [enableMentions, closeMention, findTextarea]);

  return (
    // wmd-container activates the full-height editor overrides in index.css
    <div ref={containerRef} data-color-mode={isDark ? 'dark' : 'light'} className="wmd-container h-full flex flex-col overflow-hidden">
      <MDEditor
        value={value}
        onChange={onChange}
        preview="live"
        height="100%"
        // The built-in drag-resize bar replaces height="100%" with a numeric
        // pixel height once dragged, leaving the editor stuck at that height
        // instead of filling the page — disable it, this editor is full-screen.
        visibleDragbar={false}
        textareaProps={{
          placeholder: placeholder
        }}
        hideToolbar={false}
        extra={[
          enableMentions && window.WDMentions ? (
            <button
              key="wd-mention"
              type="button"
              onClick={linkSelection}
              className="wd-mention-toolbar-btn"
              title="Link to another file (@)"
            >
              @ Link
            </button>
          ) : null
        ]}
      />
    </div>
  );
}

/** Splice markdown into the value at the mention range. */
function insertRange(value, range, markdown) {
  return value.slice(0, range.from) + markdown + value.slice(range.to);
}