import { useState, useRef, useEffect } from 'react';

/**
 * DocActions Component
 *
 * Displays action buttons for docs:
 * - In sidebar: shows pin button and more options
 * - In card header: shows only more options (pin is separate)
 */
export function DocActions({ doc, onPin, onDelete, onRename, onShare }) {
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [renameValue, setRenameValue] = useState(doc.title || '');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [dialogPosition, setDialogPosition] = useState({ top: 0, left: 0, showAbove: false });
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const buttonRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showMenu]);

  // Keep the compact icon strip within the viewport, including on phones.
  const placeMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 156, height = 46;
    const left = rect.left - width - 6;
    const right = rect.right + 6;
    setMenuPosition({
      top: Math.max(8, Math.min(rect.top + (rect.height - height) / 2, window.innerHeight - height - 8)),
      left: left >= 8 ? left : right + width <= window.innerWidth - 8 ? right : Math.max(8, window.innerWidth - width - 8)
    });
  };

  useEffect(() => {
    if (!showMenu) return;
    const close = () => setShowMenu(false);
    const onEscape = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); buttonRef.current?.focus(); }
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onEscape);
    };
  }, [showMenu]);

  // Calculate dialog position when opening rename or delete
  useEffect(() => {
    if ((isRenaming || isDeleting) && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dialogHeight = 120; // Approximate dialog height
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      // Decide whether to show above or below based on available space
      const showAbove = spaceBelow < dialogHeight && spaceAbove > spaceBelow;

      setDialogPosition({
        top: showAbove ? rect.top - dialogHeight : rect.bottom + 4,
        left: rect.right - 180, // Align dialog to the right
        showAbove
      });
    }
  }, [isRenaming, isDeleting]);

  // Focus input when renaming starts
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handlePin = (e) => {
    e.stopPropagation();
    onPin(doc.id);
  };

  const handleMenuClick = (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (!showMenu) placeMenu();
    setShowMenu(!showMenu);
  };

  const handleAction = (action, e) => {
    e.stopPropagation();

    switch (action) {
      case 'rename':
        setShowMenu(false);
        // Calculate dialog position BEFORE showing to prevent flicker
        if (buttonRef.current) {
          const rect = buttonRef.current.getBoundingClientRect();
          const dialogHeight = 120; // Approximate dialog height
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;
          const showAbove = spaceBelow < dialogHeight && spaceAbove > spaceBelow;
          setDialogPosition({
            top: showAbove ? rect.top - dialogHeight : rect.bottom + 4,
            left: rect.right - 180, // Align dialog to the right
            showAbove
          });
        }
        setIsRenaming(true);
        setRenameValue(doc.title || '');
        break;
      case 'pin':
        setShowMenu(false);
        onPin(doc.id);
        break;
      case 'share':
        setShowMenu(false);
        onShare(doc);
        break;
      case 'delete':
        setShowMenu(false);
        // Calculate dialog position BEFORE showing to prevent flicker
        if (buttonRef.current) {
          const rect = buttonRef.current.getBoundingClientRect();
          const dialogHeight = 120; // Approximate dialog height
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;
          const showAbove = spaceBelow < dialogHeight && spaceAbove > spaceBelow;
          setDialogPosition({
            top: showAbove ? rect.top - dialogHeight : rect.bottom + 4,
            left: rect.right - 180, // Align dialog to the right
            showAbove
          });
        }
        setIsDeleting(true);
        break;
    }
  };

  const handleConfirmDelete = () => {
    setIsDeleting(false);
    onDelete(doc.id);
  };

  const handleCancelDelete = () => {
    setIsDeleting(false);
  };

  const handleRenameSubmit = () => {
    if (renameValue.trim() && renameValue !== doc.title) {
      onRename(doc, renameValue.trim());
    }
    setIsRenaming(false);
    setRenameValue(doc.title || '');
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur(); // Remove focus to prevent blur from triggering again
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setIsRenaming(false);
      setRenameValue(doc.title || '');
    }
  };

  const handleCancel = (e) => {
    e.preventDefault(); // Prevent blur from triggering
    setIsRenaming(false);
    setRenameValue(doc.title || '');
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Inline Rename Input */}
      {isRenaming && (
        <div
          className="fixed w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 z-[100]"
          style={{
            top: `${dialogPosition.top}px`,
            left: `${dialogPosition.left}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameSubmit}
            placeholder="Enter doc title..."
            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <div className="flex gap-1 mt-2">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleRenameSubmit}
              className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Save
            </button>
            <button
              onMouseDown={handleCancel}
              onClick={handleCancel}
              className="flex-1 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Inline Delete Confirmation */}
      {isDeleting && (
        <div
          className="fixed w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-[100]"
          style={{
            top: `${dialogPosition.top}px`,
            left: `${dialogPosition.left}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-gray-900 dark:text-gray-100 mb-3">
            Delete "{doc.title || 'Untitled'}"?
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleConfirmDelete}
              className="flex-1 px-2 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 font-medium"
            >
              Delete
            </button>
            <button
              onClick={handleCancelDelete}
              className="flex-1 px-2 py-1.5 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* More Options Button */}
      <button
        ref={buttonRef}
        onClick={handleMenuClick}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        title="More options"
        aria-label="More options"
        aria-haspopup="true"
        aria-expanded={showMenu}
      >
        <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {/* Compact icon actions, like the theme selector */}
      {showMenu && (
        <div className="fixed flex items-center gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-1 z-[100]" style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }} onClick={(e) => e.stopPropagation()}>
          <button onClick={(e) => handleAction('rename', e)} title="Rename" aria-label="Rename" className="w-8 h-8 grid place-items-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
          </button>
          <button onClick={(e) => handleAction('pin', e)} title={doc.pinned ? "Unpin" : "Pin"} aria-label={doc.pinned ? "Unpin" : "Pin"} className="w-8 h-8 grid place-items-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200">
            <svg className="w-4 h-4" fill="currentColor" stroke="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z" /></svg>
          </button>
          <button onClick={(e) => handleAction('share', e)} title="Share" aria-label="Share" className="w-8 h-8 grid place-items-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
          </button>
          <button onClick={(e) => handleAction('delete', e)} title="Delete" aria-label="Delete" className="w-8 h-8 grid place-items-center rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
