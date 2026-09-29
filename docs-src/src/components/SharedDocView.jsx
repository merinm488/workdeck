import { useMemo } from 'react';
import MarkdownPreview from './MarkdownPreview';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';

/**
 * SharedDocView Component
 *
 * Read-only view of a shared doc:
 * - Shows doc title, content, metadata
 * - No edit/delete options
 * - Shows when user is not logged in
 * - Can also be shown when logged in (just viewing a shared doc)
 */
export function SharedDocView({ doc, sharedAt, onClose }) {
  if (!doc) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 max-w-md md:max-w-lg w-full p-6 rounded-xl shadow-xl text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Shared Doc Not Found
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            This shared doc may have been deleted or the link is invalid.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Memoize content conversion - only convert legacy HTML docs
  const docContent = useMemo(() => {
    if (!doc?.content) return '';
    // Only convert if it's legacy HTML format, not current markdown
    if (doc.contentType === 'richtext') {
      return htmlToMarkdown(doc.content);
    }
    return doc.content;
  }, [doc?.content, doc?.contentType]);

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          {/* Back/Close button */}
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Share icon */}
          <div className="w-8 h-8 rounded-lg bg-blue-400/10 dark:bg-white/10 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-500 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </div>

          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Shared Doc
            </h1>
            {(doc.contentType === 'richtext' || doc.contentType === 'markdown') && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                Markdown
              </span>
            )}
          </div>
        </div>

      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          {/* Shared badge */}
          <div className="mb-4">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Publicly Shared
            </span>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            {doc.title || 'Untitled'}
          </h1>

          {/* Metadata */}
          <div className="flex items-center gap-3 mb-6 text-sm text-gray-500 dark:text-gray-400">
            {/* Pin indicator */}
            {doc.pinned && (
              <span className="inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z" />
                </svg>
                Pinned
              </span>
            )}

            {/* Date */}
            <span>Updated {formatDate(doc.updatedAt)}</span>
          </div>

          {/* Content */}
          <div className="prose prose-sm sm:prose dark:prose-invert max-w-none">
            {doc.contentType === 'richtext' || doc.contentType === 'markdown' ? (
              <MarkdownPreview content={docContent} />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-gray-700 dark:text-gray-300">
                {doc.content || 'No content'}
              </pre>
            )}
          </div>

          {/* Shared timestamp */}
          {sharedAt && (
            <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Shared on {formatDate(sharedAt)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 sm:px-6 py-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onClose}
          className="w-full px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
