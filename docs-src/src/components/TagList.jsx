import { useState } from 'react';

/**
 * TagList Component
 *
 * Displays and manages tags like Gmail labels:
 * - List all tags with colors
 * - Active tag indicator
 * - Create new tag with color picker
 * - Delete tag (with confirmation)
 * - "All Docs" special view at top
 */
export function TagList({
  tags,
  activeTag,
  onTagSelect,
  onCreateTag,
  onDeleteTag
}) {
  const [showNewTag, setShowNewTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#FACC15');

  /**
   * Handle creating a new tag
   */
  const handleCreateTag = (e) => {
    e.preventDefault();
    if (newTagName.trim()) {
      onCreateTag({
        name: newTagName.trim(),
        color: newTagColor
      });
      setNewTagName('');
      setShowNewTag(false);
    }
  };

  /**
   * Handle deleting a tag
   */
  const handleDeleteTag = (tagId, e) => {
    e.stopPropagation();
    const tag = tags.find(t => t.id === tagId);
    if (tag) {
      if (confirm(`Delete "${tag.name}"? Docs will only appear in All Docs.`)) {
        onDeleteTag(tagId);
      }
    }
  };

  // Predefined colors for tag creation (same as folder colors)
  const tagColors = [
    '#FACC15', // Yellow
    '#3B82F6', // Blue
    '#10B981', // Green
    '#8B5CF6', // Purple
    '#EF4444', // Red
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#F97316', // Orange
  ];

  return (
    <div className="space-y-1">
      {/* All Docs - always at top */}
      <div
        onClick={() => onTagSelect(null)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          activeTag === null
            ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
            : 'hover:bg-bg-tertiary/50 text-text-primary'
        }`}
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span className="flex-1 truncate text-sm font-medium">
          All Docs
        </span>
      </div>

      {/* Tags Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
          Tags
        </h2>
        <button
          onClick={() => setShowNewTag(!showNewTag)}
          className="p-1 rounded hover:bg-bg-tertiary transition-colors"
          title="New tag"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* New Tag Form */}
      {showNewTag && (
        <form onSubmit={handleCreateTag} className="p-3 space-y-2 bg-bg-tertiary/50 rounded-lg mb-2 animate-fade-in">
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            placeholder="Tag name"
            className="input-base text-sm py-1.5"
            autoFocus
          />

          {/* Color picker */}
          <div className="flex gap-1 flex-wrap">
            {tagColors.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => setNewTagColor(color)}
                className={`w-6 h-6 rounded-full transition-transform ${
                  newTagColor === color ? 'ring-2 ring-offset-1 ring-offset-bg-secondary' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-xs py-1.5 flex-1">
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewTag(false);
                setNewTagName('');
              }}
              className="btn-ghost text-xs py-1.5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Tag List */}
      <div className="space-y-0.5">
        {tags.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
            No tags yet. Create one to organize your docs!
          </div>
        ) : (
          tags.map(tag => (
            <div
              key={tag.id}
              onClick={() => onTagSelect(tag.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors group ${
                activeTag === tag.id
                  ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'hover:bg-bg-tertiary/50 text-text-primary'
              }`}
            >
              {/* Tag icon with color */}
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: tag.color }}
              />

              {/* Tag name */}
              <span className="flex-1 truncate text-sm font-medium">
                {tag.name}
              </span>

              {/* Delete button */}
              <button
                onClick={(e) => handleDeleteTag(tag.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg-tertiary transition-all"
                title="Delete tag"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
