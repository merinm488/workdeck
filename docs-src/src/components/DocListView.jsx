/**
 * DocListView Component
 *
 * Displays docs in a list/table view format
 */
import { DocActions } from './DocActions';

export function DocListView({ docs, onClick, onPin, onDelete, onRename, onShare, tags, currentTagId, isSearchResult }) {
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


  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Table header */}
      <div className="docs-list-grid px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400">
        <div>Title</div>
        <div className="docs-list-tag">Tag</div>
        <div>Updated</div>
        <div className="text-right">Actions</div>
      </div>

      {/* Table rows */}
      {docs.map(doc => (
        <div
          key={doc.id}
          onClick={() => onClick(doc)}
          className="docs-list-grid px-4 py-3 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
        >
          {/* Pin icon + Title */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPin(doc.id);
              }}
              className={`p-1 rounded flex-shrink-0 transition-colors ${
                doc.pinned
                  ? 'text-yellow-500'
                  : 'text-gray-300 hover:text-gray-500 dark:hover:text-gray-400'
              }`}
              title={doc.pinned ? 'Unpin doc' : 'Pin doc'}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z" />
              </svg>
            </button>
            <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
              {doc.title || 'Untitled'}
            </span>
          </div>

          {/* Tag badge */}
          <div className="docs-list-tag min-w-0">
            {doc.tagId ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{
                backgroundColor: tags.find(t => t.id === doc.tagId)?.color + '20' || '#f3f4f6',
                color: tags.find(t => t.id === doc.tagId)?.color || '#6b7280'
              }}>
                <div className="w-2 h-2 rounded-full" style={{
                  backgroundColor: tags.find(t => t.id === doc.tagId)?.color || '#9ca3af'
                }} />
                {tags.find(t => t.id === doc.tagId)?.name || 'Unknown'}
              </span>
            ) : (
              <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
            )}
          </div>

          {/* Date */}
          <div className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {formatDate(doc.updatedAt)}
          </div>

          {/* Actions */}
          <div className="text-right">
            <DocActions
              doc={doc}
              onPin={onPin}
              onDelete={onDelete}
              onRename={onRename}
              onShare={onShare}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
