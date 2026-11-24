/**
 * DocCard Component
 *
 * Displays a single doc in the docs list with:
 * - Title and preview
 * - Date info
 * - Tag badge (when in filtered view or search)
 * - Pin indicator
 * - Click to edit
 * - Actions menu
 */
import { DocActions } from './DocActions';
import { memo } from 'react';

function DocCard({ doc, onClick, onPin, isPinned, onDelete, onRename, onShare, tags = [] }) {
  // Format date for display
  const formatDate = (dateString) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  // Get preview of content (first 100 chars)
  const getPreview = (content, contentType = 'plain-text') => {
    if (!content) return 'No content';

    if (contentType === 'markdown') {
      // Strip markdown syntax for preview (legacy support)
      let stripped = content
        .replace(/^#{1,6}\s+/gm, '') // Headers: # ## ### etc.
        .replace(/\*\*\*([^*]+)\*\*\*/g, '$1') // Bold + Italic
        .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
        .replace(/\*([^*]+)\*/g, '$1') // Italic
        .replace(/~~([^~]+)~~/g, '$1') // Strikethrough
        .replace(/`([^`]+)`/g, '$1') // Inline code
        .replace(/```[\s\S]*?```/g, '[code block]') // Code blocks
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links: [text](url) -> text
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // Images
        .replace(/^>\s+/gm, '') // Blockquotes
        .replace(/^\s*[-*+]\s+/gm, '') // Bulleted lists
        .replace(/^\s*\d+\.\s+/gm, '') // Numbered lists
        .replace(/^\s*-\s*\[\s*\]\s+/gm, '') // Task lists
        .replace(/^---$/gm, '') // Horizontal rules
        .replace(/\|.*\|/g, '') // Tables (basic)
        .replace(/\n/g, ' ') // Newlines to spaces
        .trim();

      return stripped.length > 100
        ? stripped.substring(0, 100) + '...'
        : stripped;
    }

    if (contentType === 'richtext') {
      // Strip HTML tags for rich text content
      let stripped = content
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
        .replace(/&amp;/g, '&') // Replace HTML entities
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ') // Collapse multiple spaces
        .trim();

      return stripped.length > 100
        ? stripped.substring(0, 100) + '...'
        : stripped;
    }

    // Original plain text handling
    const stripped = content.replace(/[#*`\-\[\]]/g, '').trim();
    return stripped.length > 100
      ? stripped.substring(0, 100) + '...'
      : stripped;
  };

  return (
    <div
      className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm cursor-pointer hover:shadow-md relative flex flex-col min-h-[160px]"
      onClick={() => onClick(doc)}
    >
      {/* Header with title and action buttons */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-lg line-clamp-1 flex-1 text-gray-900 dark:text-gray-100 pr-2">
          {doc.title || 'Untitled'}
        </h3>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Pin Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPin(doc.id);
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              isPinned
                ? 'text-yellow-500 bg-yellow-100 dark:bg-yellow-900/20'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={isPinned ? 'Unpin doc' : 'Pin doc'}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z" />
            </svg>
          </button>

          {/* Actions Menu */}
          <DocActions
            doc={doc}
            onPin={onPin}
            onDelete={onDelete}
            onRename={onRename}
            onShare={onShare}
          />
        </div>
      </div>

      {/* Content preview - takes available space */}
      <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-2 mb-3 flex-grow">
        {getPreview(doc.content, doc.contentType)}
      </p>

      {/* Footer - fixed at bottom; always show the assigned tag color */}
      <div className="mt-auto">
        <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex-shrink-0">{formatDate(doc.updatedAt)}</span>
          {doc.tagId && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium min-w-0 max-w-[60%]"
              title={tags.find(t => t.id === doc.tagId)?.name || 'Unknown Tag'}
              style={{
                backgroundColor: (tags.find(t => t.id === doc.tagId)?.color || '#9ca3af') + '20',
                color: tags.find(t => t.id === doc.tagId)?.color || '#6b7280'
              }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{
                backgroundColor: tags.find(t => t.id === doc.tagId)?.color || '#9ca3af'
              }} />
              <span className="truncate">{tags.find(t => t.id === doc.tagId)?.name || 'Unknown Tag'}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export default memo(DocCard);
