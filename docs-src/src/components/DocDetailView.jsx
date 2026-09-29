import { useState, useEffect, useCallback } from 'react';
import { MarkdownEditor } from './DocEditor';
import MarkdownPreview from './MarkdownPreview';
import { SettingsDropdown } from './SettingsDropdown';
import { useDebounce } from '../hooks/useDebounce';
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
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved'
  const [showSavedToast, setShowSavedToast] = useState(false);
  // Rename reminder: shown on explicit save when the user hasn't named the doc
  const [renamePromptOpen, setRenamePromptOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renamePromptDismissed, setRenamePromptDismissed] = useState(false);
  const [lastSavedValues, setLastSavedValues] = useState(() => {
    return {
      title: doc?.title || '',
      content: getContent(doc?.content, doc?.contentType),
      tagId: doc?.tagId || activeTag || null
    };
  });

  // Debounce content changes for auto-save (1000ms delay)
  const debouncedContent = useDebounce(content, 1000);
  const debouncedTitle = useDebounce(title, 1000);

  /**
   * Update lastSavedValues when doc changes (e.g., switching docs)
   */
  useEffect(() => {
    if (doc?.id) {
      setLastSavedValues({
        title: doc.title || '',
        content: getContent(doc.content, doc.contentType),
        tagId: doc.tagId || activeTag || null
      });
      setSaveStatus('saved');
      // The rename reminder is per-doc: a "Later" on one doc must not
      // suppress the reminder for the next untitled doc the user saves.
      setRenamePromptDismissed(false);

      // Deep links open the view from a stub { id } before the docs fetch
      // resolves, so the real title/content/tag arrive as a prop update
      // after mount — adopt them into local state here (state initializers
      // only ran once, against the stub). In view mode there are no user
      // edits to overwrite; in edit mode only fill fields the user hasn't
      // touched yet (title untouched, content still empty).
      if (mode === 'view') {
        setTitle(doc.title || '');
        setContent(getContent(doc.content, doc.contentType));
        setTagId(doc.tagId || activeTag || null);
      } else if (!title) {
        setTitle(doc.title || '');
        if (!content) {
          setContent(getContent(doc.content, doc.contentType));
        }
        if (!tagId) {
          setTagId(doc.tagId || activeTag || null);
        }
      }
    }
  }, [doc?.id, doc?.title, doc?.content, doc?.contentType, doc?.tagId, activeTag]);

  /**
   * Auto-save effect: Trigger save when debounced values change
   * Only auto-save existing docs (has doc.id)
   * Doc: Auto-save happens silently without changing UI to 'saved'
   */
  useEffect(() => {
    if (!doc?.id) return; // Don't auto-save new docs
    if (mode === 'view') return; // Don't auto-save in view mode

    const hasChanges =
      debouncedTitle !== lastSavedValues.title ||
      debouncedContent !== lastSavedValues.content ||
      tagId !== lastSavedValues.tagId;

    if (hasChanges) {
      // Don't change UI status for auto-save - keep it as 'unsaved'
      // Only update lastSavedValues in the background
      let isMounted = true;

      onUpdateDoc(doc.id, {
        title: debouncedTitle.trim() || 'Untitled',
        content: debouncedContent.trim(),
        tagId
      }).then(() => {
        if (isMounted) {
          // Update the reference point silently
          setLastSavedValues({
            title: debouncedTitle,
            content: debouncedContent,
            tagId
          });
        }
      }).catch((error) => {
        console.error('Auto-save failed:', error);
      });

      return () => {
        isMounted = false;
      };
    }
  }, [debouncedContent, debouncedTitle, tagId, mode, doc?.id, lastSavedValues, onUpdateDoc]);

  /**
   * Update save status when user makes changes
   */
  useEffect(() => {
    if (mode === 'view') return;

    const hasChanges =
      title !== lastSavedValues.title ||
      content !== lastSavedValues.content ||
      tagId !== lastSavedValues.tagId;

    if (hasChanges && saveStatus === 'saved') {
      setSaveStatus('unsaved');
    }
  }, [title, content, tagId, mode, lastSavedValues, saveStatus]);

  /**
   * Handle keyboard shortcuts
   * - Cmd/Ctrl + E: Toggle edit/view mode
   * - Escape: Go back
   * - Cmd/Ctrl + S: Explicit save (for new docs)
   */
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd/Ctrl + E: Toggle edit mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setMode(mode === 'view' ? 'edit' : 'view');
      }

      // Escape: Go back
      if (e.key === 'Escape') {
        // Don't go back if user is in the middle of editing
        if (saveStatus === 'unsaved') {
          const confirmed = confirm('You have unsaved changes. Are you sure you want to go back?');
          if (!confirmed) return;
        }
        onBack();
      }

      // Cmd/Ctrl + S: Explicit save (for new docs)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleExplicitSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, saveStatus, onBack]);

  /**
   * Handle content changes from editor
   */
  const handleContentChange = useCallback((newContent) => {
    setContent(newContent);
  }, []);

  /**
   * Perform the actual save (for both new and existing docs).
   * Accepts an optional title override (used by the rename reminder, where
   * the typed title hasn't flushed through setTitle state yet).
   * Untitled docs save as 'Untitled', exactly as before.
   */
  const performSave = useCallback((titleOverride) => {
    const effectiveTitle = (titleOverride !== undefined ? titleOverride : title).trim() || 'Untitled';

    if (doc?.id) {
      // Existing doc - trigger immediate save
      setSaveStatus('saving');
      let isMounted = true;

      // Add a timeout fallback to ensure status doesn't get stuck
      const timeoutId = setTimeout(() => {
        if (isMounted) {
          console.warn('Explicit save timeout - resetting to unsaved');
          setSaveStatus('unsaved');
        }
      }, 5000); // 5 second timeout

      const saveData = {
        title: effectiveTitle,
        content: content.trim(),
        tagId
      };

      onUpdateDoc(doc.id, saveData).then(() => {
        clearTimeout(timeoutId);
        if (isMounted) {
          setSaveStatus('saved');
          setLastSavedValues({
            title: effectiveTitle,
            content: content,
            tagId
          });
          // Show saved toast
          setShowSavedToast(true);
          setTimeout(() => setShowSavedToast(false), 1000);
        }
      }).catch((error) => {
        clearTimeout(timeoutId);
        console.error('Explicit save failed:', error);
        if (isMounted) {
          setSaveStatus('unsaved');
        }
      });

      return;
    }

    // New doc - create it
    const newDocData = {
      title: effectiveTitle,
      content: content.trim(),
      contentType: 'markdown',
      tagId: tagId || activeTag || null
    };

    // This will be handled by parent component
    setSaveStatus('saving');
    onUpdateDoc(null, newDocData);
  }, [doc?.id, title, content, tagId, activeTag, onUpdateDoc]);

  /**
   * Handle explicit save (Save button / Cmd/Ctrl+S).
   * If the user never named the doc, show a rename reminder first with
   * Rename (jump straight into renaming) and Later (save as Untitled).
   */
  const handleExplicitSave = useCallback(() => {
    const isDefaultTitle = !title.trim() || title.trim().toLowerCase() === 'untitled';

    if (isDefaultTitle && !renamePromptDismissed) {
      setRenameValue(title.trim() ? title : '');
      setRenamePromptOpen(true);
      return;
    }

    performSave();
  }, [title, renamePromptDismissed, performSave]);

  /**
   * Handle delete with confirmation
   */
  const handleDelete = useCallback(() => {
    if (doc?.id && confirm('Delete this doc? This cannot be undone.')) {
      onDelete(doc.id);
      onBack();
    }
  }, [doc?.id, onDelete, onBack]);

  /**
   * Handle share action
   */
  const handleShare = useCallback(() => {
    if (doc && onShare) {
      onShare(doc);
    }
  }, [doc, onShare]);

  /**
   * Rename reminder actions.
   * Rename: apply the typed title and continue the save that was interrupted.
   * Later: save as 'Untitled' now; the reminder won't nag again this session.
   */
  const handleRenameConfirm = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      setTitle(trimmed);
    }
    setRenamePromptOpen(false);
    setRenamePromptDismissed(true);
    // Continue the save that triggered the reminder, under the new title
    performSave(trimmed || undefined);
  }, [renameValue, performSave]);

  const handleRenameLater = useCallback(() => {
    setRenamePromptOpen(false);
    setRenamePromptDismissed(true);
    // "Later" still completes the save the user asked for, as 'Untitled'
    performSave();
  }, [performSave]);

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
          onClick={onBack}
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
          onTagSelect={setTagId}
          onCreateTag={onCreateTag}
          onShare={handleShare}
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
          onClick={onBack}
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
          onChange={(e) => setTitle(e.target.value)}
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
            onTagSelect={setTagId}
            onCreateTag={onCreateTag}
            onShare={handleShare}
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
          />
        </div>
      </div>
    </div>
  );

  /**
   * Render edit mode content
   */
  const renderEditContent = () => (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
      {/* Editor with built-in preview toggle */}
      <MarkdownEditor
        value={content}
        onChange={handleContentChange}
        placeholder="Start writing your doc..."
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

        {/* Save button (right) */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {mode === 'edit' && (
            <button
              type="button"
              onClick={handleExplicitSave}
              disabled={saveStatus === 'saving'}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {saveStatus === 'saving' ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Save Changes
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  /**
   * Render saved toast notification
   */
  const renderSavedToast = () => {
    if (!showSavedToast) return null;

    return (
      <div className="fixed bottom-4 right-4 sm:right-6 z-50">
        <div className="bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">Saved!</span>
        </div>
      </div>
    );
  };

  /**
   * Render rename reminder modal.
   * Shown when the user saves without ever naming the doc:
   * - Rename: apply the typed name and save under it
   * - Later: save as 'Untitled' as usual
   */
  const renderRenamePrompt = () => {
    if (!renamePromptOpen) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg w-full max-w-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Add a title?
          </h3>

          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleRenameConfirm();
              }
            }}
            placeholder="Doc title..."
            autoFocus
            className="input-base mb-4"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleRenameLater}
              className="px-4 py-2 rounded-lg font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Later
            </button>
            <button
              type="button"
              onClick={handleRenameConfirm}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
            >
              Rename
            </button>
          </div>
        </div>
      </div>
    );
  };

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

      {/* Saved toast notification */}
      {renderSavedToast()}

      {/* Rename reminder modal (save without a title) */}
      {renderRenamePrompt()}
    </div>
  );
}
