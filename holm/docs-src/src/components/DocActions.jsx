import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDocTags } from './DocTags';

/**
 * DocActions Component
 *
 * Shared action menu for docs in cards, lists and the sidebar.
 */
export function DocActions({ doc, onDelete, onRename, onShare, card = false }) {
  const editTags = useDocTags();
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [renameValue, setRenameValue] = useState(doc.title || '');
  const [dialogPosition, setDialogPosition] = useState({ top: 0, left: 0, showAbove: false });
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => () => dropdownRef.current?.close(), []);

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

  const handleMenuClick = (event, focusLast = false) => {
    event.preventDefault(); event.stopPropagation();
    const icon = (path, fill = 'none') => '<svg viewBox="0 0 24 24" fill="' + fill + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"/></svg>';
    const items = [
      { label: 'Rename', icon: icon('M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z'), onSelect: () => handleAction('rename') },
      { label: 'Edit tags', icon: icon('M20 13l-7 7a2 2 0 0 1-3 0l-8-8V2h10l8 8a2 2 0 0 1 0 3zM7 7h.01'), onSelect: () => editTags(doc, buttonRef.current) },
      { label: 'Share', icon: icon('M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7'), onSelect: () => handleAction('share') },
      { label: 'Delete', icon: icon('M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'), danger: true, onSelect: () => handleAction('delete') },
    ];
    dropdownRef.current = window.WDActionMenu.open(buttonRef.current, items, {
      focusLast, onClose: () => { dropdownRef.current = null; setShowMenu(false); },
    });
    setShowMenu(!!dropdownRef.current);
  };

  const handleAction = (action) => {

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
    <div className="relative">
      {/* Inline Rename Input */}
      {isRenaming && createPortal(
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
              onMouseDown={handleCancel}
              onClick={handleCancel}
              className="flex-1 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>, document.body
      )}

      {/* Inline Delete Confirmation */}
      {isDeleting && createPortal(
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
        </div>, document.body
      )}

      {/* More Options Button */}
      <button
        ref={buttonRef}
        onClick={handleMenuClick}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') handleMenuClick(event, event.key === 'ArrowUp');
        }}
        className={card ? 'wd-card-more' : 'p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'}
        title={card ? 'More actions' : 'More options'}
        aria-label={card ? 'More actions' : 'More options'}
        aria-haspopup="menu"
        aria-expanded={showMenu}
      >
        <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

    </div>
  );
}
