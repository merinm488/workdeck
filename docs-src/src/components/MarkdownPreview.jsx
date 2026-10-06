import { memo, useState, useEffect, useRef } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { escapeHtml } from '../utils/mentions';

/**
 * MarkdownPreview Component
 *
 * Renders markdown content with:
 * - GitHub Flavored Markdown (tables, task lists, strikethrough)
 * - Syntax highlighting for code blocks
 * - Dark/light theme support
 * - Responsive typography
 *
 * Plus Workdeck mentions: internal hard links (@/app/<id>) render as chips
 * with the target's current name and app icon. Clicks go through
 * onInternalNavigate (same-tab); pass inertLinks for public share views,
 * where targets are private and links must not navigate.
 */
function MarkdownPreview({ content, readOnly = false, userData = null, onInternalNavigate = null, inertLinks = false }) {
  const [isDark, setIsDark] = useState(false);
  const rootRef = useRef(null);
  const navigateRef = useRef(onInternalNavigate);
  navigateRef.current = onInternalNavigate;

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

  // Turn internal hard links into mention chips (runs after each render of
  // the markdown HTML). Names resolve live from the unified doc, so renames
  // propagate; deleted targets render struck-through.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !window.WDLinks || !window.WDMentions) return;

    root.querySelectorAll('a[href]').forEach((a) => {
      const ref = WDLinks.parseHref(a.getAttribute('href'));
      if (!ref) return;

      const resolved = WDMentions.resolveRef(ref, userData || {});
      const fallbackLabel = a.textContent.replace(/^@\s*/, '') || 'Untitled';
      const name = resolved.missing ? fallbackLabel : resolved.name;

      a.dataset.wdRef = JSON.stringify(ref);
      a.classList.add('wd-mention-chip');
      if (resolved.missing || inertLinks) {
        a.classList.add('missing');
        a.removeAttribute('href');
        a.setAttribute('title', resolved.missing
          ? 'File no longer exists'
          : 'Private link — sign in to open');
      } else {
        a.setAttribute('title', (WDLinks.APPS[ref.app] || {}).name + ' — ' + name);
      }
      a.innerHTML = '<span class="wdm-app-icon wdm-app-' + ref.app + '">'
        + WDLinks.icon(ref.app, 13)
        + '</span><span>' + escapeHtml(name) + '</span>';
    });
  }, [content, userData, inertLinks]);

  // Same-tab navigation for internal chips (delegated; external links pass).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (e) => {
      const anchor = e.target.closest('a');
      if (!anchor) return;
      let ref = null;
      try {
        ref = anchor.dataset.wdRef ? JSON.parse(anchor.dataset.wdRef) : WDLinks.parseHref(anchor.getAttribute('href'));
      } catch (err) { ref = null; }
      if (!ref) return; // regular external link
      e.preventDefault();
      if (!inertLinks && navigateRef.current) navigateRef.current(ref);
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [inertLinks]);

  // Use MDEditor.Markdown for preview-only mode (cleaner, no extra DOM elements)
  return (
    <div ref={rootRef} data-color-mode={isDark ? 'dark' : 'light'} className="prose prose-sm sm:prose dark:prose-invert max-w-none w-full">
      <MDEditor.Markdown
        source={content}
        style={{
          backgroundColor: 'transparent'
        }}
      />
    </div>
  );
}

// Memoize the component to prevent unnecessary re-renders
export default memo(MarkdownPreview);