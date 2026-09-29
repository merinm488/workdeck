import { useState, useRef, useEffect } from 'react';

/**
 * Settings Dropdown Component
 *
 * Combines theme, tags, share, and delete options into a single settings menu.
 * Features:
 * - Settings (gear) icon that opens a dropdown menu
 * - Theme selection with expandable submenu (Dark, Light, System)
 * - Tag selection with expandable submenu and create new tag option
 * - Share button
 * - Delete button (for existing docs only)
 * - Viewport-aware dropdown positioning that works on all screen sizes
 */
export function SettingsDropdown({
  theme,
  systemTheme,
  onSetTheme,
  tags,
  selectedTag,
  onTagSelect,
  onCreateTag,
  onShare,
  onDelete,
  hasDoc,
  doc
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showThemeSubmenu, setShowThemeSubmenu] = useState(false);
  const [showTagSubmenu, setShowTagSubmenu] = useState(false);
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#FACC15');
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, right: 0 });
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  // Calculate dropdown position when opening
  const updateDropdownPosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Position dropdown below the button, aligned to the right edge
      // Add 8px margin (mt-2 = 0.5rem = 8px)
      setDropdownPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right
      });
    }
  };

  // Update position when dropdown opens
  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
      // Recalculate on window resize while open
      const handleResize = () => {
        if (isOpen) updateDropdownPosition();
      };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target) &&
          buttonRef.current && !buttonRef.current.contains(event.target)) {
        setIsOpen(false);
        setShowThemeSubmenu(false);
        setShowTagSubmenu(false);
        if (showNewTagForm) {
          setShowNewTagForm(false);
          setNewTagName('');
          setNewTagColor('#FACC15');
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNewTagForm]);

  // Toggle dropdown and calculate position
  const toggleDropdown = () => {
    const willOpen = !isOpen;
    setIsOpen(willOpen);
    if (willOpen) {
      // Small delay to ensure DOM has updated
      setTimeout(updateDropdownPosition, 0);
    }
  };

  // Get effective theme (resolves 'system' to actual theme)
  const effectiveTheme = theme === 'system' ? systemTheme : theme;

  const handleThemeSelect = (selectedTheme) => {
    onSetTheme(selectedTheme);
    setShowThemeSubmenu(false);
    setIsOpen(false);
  };

  const handleTagSelect = (tagId) => {
    onTagSelect(tagId);
    setShowTagSubmenu(false);
    setIsOpen(false);
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim() || !onCreateTag || isCreatingTag) return;

    setIsCreatingTag(true);
    try {
      const newTag = await onCreateTag({
        name: newTagName.trim(),
        color: newTagColor
      });
      if (newTag) {
        onTagSelect(newTag.id);
        setNewTagName('');
        setNewTagColor('#FACC15');
        setShowNewTagForm(false);
        setShowTagSubmenu(false);
        setIsOpen(false);
      }
    } catch (error) {
      console.error('Failed to create tag:', error);
    } finally {
      setIsCreatingTag(false);
    }
  };

  const handleShare = () => {
    if (onShare && doc) {
      onShare(doc);
      setIsOpen(false);
    }
  };

  const handleDelete = () => {
    if (onDelete && confirm('Delete this doc? This cannot be undone.')) {
      onDelete();
      setIsOpen(false);
    }
  };

  // Predefined colors for tag creation
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

  // Get current theme label
  const getThemeLabel = () => {
    if (theme === 'system') return 'System';
    if (theme === 'dark') return 'Dark';
    return 'Light';
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggleDropdown}
        className={`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${isOpen ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
        aria-label="Settings"
        aria-expanded={isOpen}
        title="Settings"
      >
        <svg
          className="w-5 h-5 text-gray-600 dark:text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>

      {/* Dropdown Menu - Fixed positioning for viewport awareness */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="fixed bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-xl z-50"
          style={{
            top: `${dropdownPosition.top}px`,
            right: `${dropdownPosition.right}px`,
            maxHeight: `calc(100vh - ${dropdownPosition.top + 16}px)`, // 16px bottom margin
            width: '320px', // Increased to fit color palette in single row
            maxWidth: 'calc(100vw - 32px)', // 16px margin on each side
          }}
        >
          <div className="py-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 80px)' }}>
            {/* Theme Section */}
            <div>
              <button
                onClick={() => setShowThemeSubmenu(!showThemeSubmenu)}
                className="w-full px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between"
              >
                <span>Theme: {getThemeLabel()}</span>
                <svg
                  className={`w-4 h-4 transition-transform ${showThemeSubmenu ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {showThemeSubmenu && (
                <div className="bg-gray-50 dark:bg-gray-900/50">
                  <button
                    onClick={() => handleThemeSelect('dark')}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                      theme === 'dark' ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <svg
                      className="w-4 h-4 text-gray-600 dark:text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                      />
                    </svg>
                    <span className="text-gray-900 dark:text-gray-100">Dark</span>
                    {theme === 'dark' && (
                      <svg className="w-4 h-4 text-blue-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>

                  <button
                    onClick={() => handleThemeSelect('light')}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                      theme === 'light' ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <svg
                      className="w-4 h-4 text-gray-600 dark:text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                      />
                    </svg>
                    <span className="text-gray-900 dark:text-gray-100">Light</span>
                    {theme === 'light' && (
                      <svg className="w-4 h-4 text-blue-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>

                  <button
                    onClick={() => handleThemeSelect('system')}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                      theme === 'system' ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <svg
                      className="w-4 h-4 text-gray-600 dark:text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    <span className="text-gray-900 dark:text-gray-100">System</span>
                    {theme === 'system' && (
                      <svg className="w-4 h-4 text-blue-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Tags Section */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowTagSubmenu(!showTagSubmenu)}
                className="w-full px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between"
              >
                <span>Tags</span>
                <svg
                  className={`w-4 h-4 transition-transform ${showTagSubmenu ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {showTagSubmenu && (
                <div className="bg-gray-50 dark:bg-gray-900/50">
                  {/* No Tag Option */}
                  <button
                    onClick={() => handleTagSelect(null)}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                      selectedTag === null
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    No tag
                  </button>

                  {/* Existing Tags */}
                  {tags.map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => handleTagSelect(tag.id)}
                      className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                        selectedTag === tag.id
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </button>
                  ))}

                  {/* Create New Tag */}
                  {!showNewTagForm ? (
                    <button
                      onClick={() => setShowNewTagForm(true)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Create new tag
                    </button>
                  ) : (
                    <div className="p-3 space-y-2 border-t border-gray-200 dark:border-gray-700">
                      <input
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="Tag name"
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newTagName.trim()) {
                            handleCreateTag();
                          } else if (e.key === 'Escape') {
                            setShowNewTagForm(false);
                            setNewTagName('');
                            setNewTagColor('#FACC15');
                          }
                        }}
                      />

                      {/* Color picker */}
                      <div className="flex gap-1 flex-wrap sm:flex-nowrap justify-center">
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
                        <button
                          onClick={handleCreateTag}
                          disabled={isCreatingTag || !newTagName.trim()}
                          className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white disabled:cursor-not-allowed rounded-lg font-medium text-sm transition-colors"
                        >
                          {isCreatingTag ? 'Creating...' : 'Create'}
                        </button>
                        <button
                          onClick={() => {
                            setShowNewTagForm(false);
                            setNewTagName('');
                            setNewTagColor('#FACC15');
                          }}
                          className="px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Share Section */}
            {onShare && (
              <div className="border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleShare}
                  className="w-full px-4 py-2 text-left text-sm flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-900 dark:text-gray-100"
                >
                  <svg
                    className="w-4 h-4 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                    />
                  </svg>
                  Share
                </button>
              </div>
            )}

            {/* Delete Section */}
            {hasDoc && (
              <div className="border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleDelete}
                  className="w-full px-4 py-2 text-left text-sm flex items-center gap-3 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-red-600 dark:text-red-400"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
