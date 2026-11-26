import { useState, useEffect, useCallback, useRef } from 'react';
import { MarkdownEditor } from './DocEditor';
import MarkdownPreview from './MarkdownPreview';
import { SettingsDropdown } from './SettingsDropdown';
import { BacklinksPanel } from './BacklinksPanel';
import { useUnifiedDoc } from '../hooks/useUnifiedDoc';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';

/**
 * DocDetailView Component
 *
 * Full-screen doc view with split-view/tabbed editing.
 * Features:
 * - View mode: Read-only preview with metadata
 * - Edit mode: Split-view on desktop (≥1024px), tabbed on mobile (<1024px)
 * - Auto-save with debouncing (1000ms)
 * - Keyboard shortcuts (Cmd/Ctrl+E for edit, Escape to go back)
 * - Tag selector integration
 * - Title editing (only in edit mode)
 * - Responsive design
 */
export function DocDetailView({
  doc,
  initialMode,
  tags,
  userHash,
  activeTag,
  onBack,
  onDelete,
  onUpdateDoc,
  onShare,
  onOpenDocLink,
  onCreateTag,
  theme,
  systemTheme,
  onSetTheme
}) {
  // 'view' | 'edit'. Deep links from the workdeck pass the mode they want
  // (created docs open straight into the editor); otherwise existing docs
  // open in preview, new ones in the editor.
  const [mode, setMode] = useState(initialMode || (doc?.id ? 'view' : 'edit')); // 'view' | 'edit'
  const [title, setTitle] = useState(doc?.title || '');

  useEffect(() => {
    window.WDPageTitle?.file(title);
    return () => window.WDPageTitle?.home();
  }, [title]);

  // Helper function to get content - only convert if it's legacy HTML format
  const getContent = (docContent, contentType = 'markdown') => {
    if (!docContent) return '';
    // Only convert legacy HTML docs, not current markdown docs
    if (contentType === 'richtext') {
      return htmlToMarkdown(docContent);
    }
    return docContent;
  };

  const [content, setContent] = useState(() => {
    return getContent(doc?.content, doc?.contentType);
  });
  const [tagId, setTagId] = useState(doc?.tagId || activeTag || null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const autosave = useRef(null);
  const latest = useRef({ id: doc?.id, title, content, tagId, onUpdateDoc });
  latest.current = { ...latest.current, title, content, tagId, onUpdateDoc };

  // Every app's files (mention picker, chip names, backlinks).
  const unifiedDoc = useUnifiedDoc(userHash);
  const handleInternalNavigate = useCallback(async (ref) => {
    if (autosave.current && !await autosave.current.flush()) return;
    if (ref.app === 'docs') {
      if (onOpenDocLink) onOpenDocLink(ref.id);
      return;
    }
    if (window.WDLinks) WDLinks.open(ref.app, ref.id);
  }, [onOpenDocLink]);

  /** Copy this doc's canonical hard link. */
  const handleCopyLink = useCallback(() => {
    if (!doc?.id || !window.WDLinks) return;
    const url = window.location.origin + WDLinks.url('docs', doc.id);
    const done = (ok) => window.alert(ok ? 'Link copied to clipboard' : 'Could not copy link');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
    } else {
      done(false);
    }
  }, [doc?.id]);

  // Create one serialized autosave queue for this editor. New documents get
  // their server id on the first write; subsequent edits reuse it.
  useEffect(() => {
    const queue = window.WDAutosave.create({
      save: async () => {
        const values = { ...latest.current };
        const result = await values.onUpdateDoc(values.id || null, {
          title: values.title.trim() || 'Untitled', content: values.content,
          contentType: 'markdown', tagId: values.tagId
        });
        if (!result) return false;
        latest.current.id = result.id || values.id;
        return true;
      },
      onState: setSaveStatus
    });
    autosave.current = queue;
    return () => { queue.flush().then(() => queue.dispose()); };
  }, []);

  // Hydrate deep-link stubs, but never overwrite text typed during a request.
  useEffect(() => {
    if (!doc || autosave.current?.dirty()) return;
    latest.current.id = doc.id;
    setTitle(doc.title || '');
    setContent(getContent(doc.content, doc.contentType));
    setTagId(doc.tagId || activeTag || null);
  }, [doc?.id, doc?.title, doc?.content, doc?.tagId]);

  const change = (field, value, setter) => {
    latest.current[field] = value;
    setter(value);
    autosave.current?.change();
  };
  const handleContentChange = value => change('content', value, setContent);
  const handleTagChange = value => change('tagId', value, setTagId);
  const handleBack = async () => { if (await autosave.current.flush()) onBack(); };
  const handleShare = async () => {
    if (await autosave.current.flush()) onShare?.({ ...doc, ...latest.current });
  };
  const handleDelete = async () => {
    if (latest.current.id && confirm('Delete this doc? This cannot be undone.')) {
      if (!await autosave.current.flush()) return;
      onDelete(latest.current.id); onBack();
    }
  };
  useEffect(() => {
    const keydown = async event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault(); await autosave.current.flush();
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'e') {
        event.preventDefault();
        if (await autosave.current.flush()) setMode(mode === 'view' ? 'edit' : 'view');
      } else if (event.key === 'Escape') {
        event.preventDefault(); await handleBack();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [mode, onBack]);

  // Get selected tag object
  const selectedTag = tags.find(t => t.id === tagId);

  /**
   * Render view mode header
   */
  const renderViewHeader = () => (
    <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-3">
        {/* Back button */}
        <button
          onClick={handleBack}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Go back"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Doc icon */}
        <div className="w-8 h-8 rounded-lg bg-blue-400/10 dark:bg-white/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-blue-500 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
          {doc?.title || 'Untitled'}
        </h1>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Edit button */}
        <button
          onClick={() => setMode('edit')}
          className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors flex items-center gap-2"
          title="Edit doc (Cmd/Ctrl+E)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <span className="hidden sm:inline">Edit</span>
        </button>

        {/* Settings dropdown */}
        <SettingsDropdown
          theme={theme}
          systemTheme={systemTheme}
          onSetTheme={onSetTheme}
          tags={tags}
          selectedTag={selectedTag?.id || null}
          onTagSelect={handleTagChange}
          onCreateTag={onCreateTag}
          onShare={handleShare}
          onCopyLink={handleCopyLink}
          onDelete={handleDelete}
          hasDoc={!!doc?.id}
          doc={doc}
        />
      </div>
    </div>
  );

  /**
   * Render edit mode header
   */
  const renderEditHeader = () => (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700 relative">
      {/* Left section - back button and title */}
      <div className="flex items-center gap-3 w-full sm:w-auto flex-1 min-w-0">
        {/* Back button */}
        <button
          onClick={handleBack}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
          aria-label="Go back"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Title input */}
        <input
          type="text"
          value={title}
          onChange={(e) => change('title', e.target.value, setTitle)}
          placeholder="Doc title..."
          className="flex-1 min-w-0 text-lg font-semibold bg-transparent border-0 focus:ring-0 p-0 placeholder-gray-400 dark:placeholder-gray-500 text-gray-900 dark:text-gray-100"
        />

        {/* Settings dropdown - positioned absolutely on mobile, inline on desktop */}
        <div className="absolute right-4 top-4 sm:static sm:right-auto sm:top-auto">
          <SettingsDropdown
            theme={theme}
            systemTheme={systemTheme}
            onSetTheme={onSetTheme}
            tags={tags}
            selectedTag={selectedTag?.id || null}
            onTagSelect={handleTagChange}
            onCreateTag={onCreateTag}
            onShare={handleShare}
            onCopyLink={handleCopyLink}
            onDelete={handleDelete}
            hasDoc={!!doc?.id}
            doc={doc}
          />
        </div>
      </div>
    </div>
  );

  /**
   * Render view mode content
   */
  const renderViewContent = () => (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Title */}
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          {doc?.title || 'Untitled'}
        </h1>

        {/* Metadata */}
        <div className="flex items-center gap-3 mb-6 text-sm text-gray-500 dark:text-gray-400 flex-wrap">
          {/* Tag badge */}
          {selectedTag ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{
              backgroundColor: selectedTag.color + '20',
              color: selectedTag.color
            }}>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedTag.color }} />
              {selectedTag.name}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              All Docs
            </span>
          )}

          {/* Pin indicator */}
          {doc?.pinned && (
            <span className="inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z" />
              </svg>
              Pinned
            </span>
          )}

          {/* Date */}
          <span>Updated {doc?.updatedAt ? new Date(doc.updatedAt).toLocaleDateString() : 'Just now'}</span>
        </div>

        {/* Content */}
        <div className="prose prose-sm sm:prose dark:prose-invert max-w-none">
          <MarkdownPreview
            content={content}
            readOnly={true}
            userData={unifiedDoc}
            onInternalNavigate={handleInternalNavigate}
          />
        </div>

        {/* Files that mention this doc */}
        <BacklinksPanel
          targetId={doc?.id}
          userData={unifiedDoc}
          onOpen={handleInternalNavigate}
        />
      </div>
    </div>
  );

  /**
   * Render edit mode content
   */
  const renderEditContent = () => (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
      {/* Editor with built-in preview toggle. Mentions are enabled for every
          doc — the launcher's createDoc defaults to contentType 'plain-text',
          but the app renders all docs as markdown, so links display fine. */}
      <MarkdownEditor
        value={content}
        onChange={handleContentChange}
        placeholder="Start writing your doc..."
        mentionExcludeId={doc?.id || null}
      />
    </div>
  );

  /**
   * Render save status footer (edit mode only)
   */
  const renderSaveStatus = () => {
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const charCount = content.length;
    const readMinutes = wordCount ? Math.max(1, Math.round(wordCount / 200)) : 0;

    return (
      <div className="px-4 sm:px-6 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between gap-4">
        {/* Doc stats (left) */}
        <span className="text-[11.5px] leading-none text-gray-400 dark:text-gray-500 tabular-nums select-none truncate">
          {wordCount.toLocaleString()} words · {charCount.toLocaleString()} characters{readMinutes ? ` · ${readMinutes} min read` : ''}
        </span>

        {/* Backlinks pill (edit mode) */}
        <BacklinksPanel
          compact
          targetId={doc?.id}
          userData={unifiedDoc}
          onOpen={handleInternalNavigate}
        />

        <span role="status" aria-live="polite" data-save-status={saveStatus} className="text-xs text-gray-500 shrink-0">
          {saveStatus === 'saved' ? 'All changes saved' : saveStatus === 'error' ? 'Not saved — retrying automatically' : 'Saving…'}
        </span>
      </div>
    );
  };

  if (doc?.id && doc.content === undefined) return <div className="fixed inset-0 z-50 grid place-items-center bg-[rgb(var(--bg-primary))] text-gray-600 dark:text-gray-300" role="status">Loading doc…</div>;

  return (
    <div
      className="fixed inset-0 z-40 bg-white dark:bg-gray-900 flex flex-col"
    >
      {/* Header */}
      {mode === 'view' ? renderViewHeader() : renderEditHeader()}

      {/* Content */}
      {mode === 'view' ? renderViewContent() : renderEditContent()}

      {/* Save status footer (edit mode only) */}
      {renderSaveStatus()}

    </div>
  );
}
