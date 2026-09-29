import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './hooks/useAuth';
import { useDocs } from './hooks/useDocs';
import { useTheme } from './hooks/useTheme';
import { Login } from './components/Login';
import { ThemeToggle } from './components/ThemeToggle';
import { UserDisplay } from './components/UserDisplay';
import { TagList } from './components/TagList';
import { SearchBar } from './components/SearchBar';
import DocCard from './components/DocCard';
import { DocListView } from './components/DocListView';
import { DocActions } from './components/DocActions';
import { DocDetailView } from './components/DocDetailView';
import { ShareModal } from './components/ShareModal';
import { SharedDocView } from './components/SharedDocView';
import { Tooltip } from './components/Tooltip';
import * as db from './lib/db';

/**
 * Main Application Component
 *
 * This is the heart of the application that:
 * 1. Manages authentication state
 * 2. Handles all doc operations
 * 3. Coordinates between all components
 * 4. Manages theme switching
 */
function App() {
  // Auth state
  const {
    userHash,
    isAuthenticated,
    isLoading: authLoading,
    error: authError,
    errorCode,
    login,
    createAccount,
    logout,
    deleteAccount,
    getUserKey,
    checkSession
  } = useAuth();

  // Theme state
  const { theme, systemTheme, setTheme, getEffectiveTheme } = useTheme();

  // Docs state
  const {
    docs,
    tags,
    activeTag,
    searchQuery,
    showArchived,
    filteredDocs,
    isLoading,
    hasLoaded,
    setActiveTag,
    setSearchQuery,
    setShowArchived,
    createDoc,
    updateDoc,
    deleteDoc,
    togglePin,
    toggleArchive,
    createTag,
    updateTag,
    deleteTag,
    refreshData
  } = useDocs(userHash);

  // Doc detail view state - simplified from separate editing/viewing/creating states
  // Workdeck deep links (?doc=<id>) open the doc on the very first paint:
  // view links start the preview immediately from a stub { id } (real
  // title/content fill in once the docs fetch resolves), so the state is
  // parsed synchronously here rather than in an effect (effects run after
  // the first paint and would flash the home page for a frame).
  const [activeDoc, setActiveDoc] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('doc');
    if (id && params.get('edit') !== '1') {
      return { id, mode: 'view', doc: { id }, isStub: true };
    }
    return null; // { id, mode: 'view' | 'edit' | 'create', doc?, isStub? }
  });
  const [isDocViewOpen, setIsDocViewOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('doc')) && params.get('edit') !== '1';
  });

  // Share state
  const [sharingDoc, setSharingDoc] = useState(null);
  const [shareUrl, setShareUrl] = useState(null);
  const [alreadyShared, setAlreadyShared] = useState(false);
  const [sharedDoc, setSharedDoc] = useState(null);
  const [sharedAt, setSharedAt] = useState(null);

  // Mobile sidebar state - show by default on desktop, hidden on mobile/tablet
  const [showSidebar, setShowSidebar] = useState(() => {
    const width = window.innerWidth;
    // Show sidebar on large screens (lg: 1024px+), hide on smaller
    return width >= 1024;
  });

  // Mobile search expanded state
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  // View mode state with persistence
  const [viewMode, setViewMode] = useState(() => {
    // Load from localStorage on initial render (legacy key fallback for existing users)
    return localStorage.getItem('docs_view_mode') || localStorage.getItem('docs_view_mode') || 'card';
  });

  // Save view mode to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('docs_view_mode', viewMode);
  }, [viewMode]);

  // Handle window resize - only auto-show sidebar on large screens
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      // Only auto-show sidebar on large screens (don't auto-hide)
      if (width >= 1024 && !showSidebar) {
        setShowSidebar(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [showSidebar]);

  // Check for existing session on mount
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Check for shared doc URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('shared');
    if (sharedId) {
      fetchSharedDoc(sharedId);
    }
  }, []);

  // Workdeck deep links: /docs/?doc=<id> opens that doc on the very first
  // paint — no home-page or login flash in between. &edit=1 (sent when the
  // file was just created) opens the editor; without it the preview opens.
  // Both start from a stub { id }: the doc already exists server-side (the
  // workdeck created it before redirecting / it was fetched when the file
  // was listed), and edit mode only needs the id to save. The preview fills
  // in the real title/content as soon as the docs fetch resolves (see the
  // stub fill-in effect below).
  const [pendingDocLink] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('doc');
    return id ? { id, edit: params.get('edit') === '1' } : null;
  });

  const [editLinkDoc, setEditLinkDoc] = useState(null);

  useEffect(() => {
    if (!pendingDocLink) return;
    // Clean the URL so refresh/back don't re-trigger the deep link
    window.history.replaceState({}, '', window.location.pathname);

    if (pendingDocLink.edit) {
      // Editor on first paint: DocDetailView only needs the id in edit mode
      // (auto-save targets it); title/content start empty like a fresh doc.
      setEditLinkDoc({ id: pendingDocLink.id });
    }
    // View links are already opened synchronously by the useState
    // initializers above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fill in a stubbed deep-link doc once the docs fetch has resolved.
  // A doc that no longer exists (deleted / bad link) closes the view and
  // falls through to the normal app.
  useEffect(() => {
    if (!isDocViewOpen || !activeDoc?.isStub || !hasLoaded) return;
    const doc = docs.find(n => n.id === activeDoc.id);
    if (doc) {
      setActiveDoc({ id: doc.id, mode: activeDoc.mode, doc });
    } else {
      setIsDocViewOpen(false);
      setActiveDoc(null);
    }
  }, [isDocViewOpen, activeDoc, docs, hasLoaded]);

  /**
   * Fetch shared doc by ID
   */
  const fetchSharedDoc = useCallback(async (sharedId) => {
    try {
      const result = await db.getSharedDoc(sharedId);
      if (result && result.doc) {
        setSharedDoc(result.doc);
        setSharedAt(result.sharedAt);
      } else {
        // Doc not found or deleted
        setSharedDoc(null);
        setSharedAt(null);
      }
    } catch (error) {
      console.error('Failed to fetch shared doc:', error);
      setSharedDoc(null);
      setSharedAt(null);
    }
  }, []);

  /**
   * Handle share action
   */
  const handleShare = useCallback(async (doc) => {
    if (!userHash || !doc) return;

    try {
      const result = await db.shareDoc(userHash, doc.id);
      setShareUrl(result.shareUrl);
      setAlreadyShared(result.alreadyShared || false);
      setSharingDoc(doc);

      // Refresh docs to get the updated sharedId
      // This ensures subsequent edits will update the shared copy
      refreshData();
    } catch (error) {
      console.error('Failed to share doc:', error);
    }
  }, [userHash, refreshData]);

  /**
   * Handle doc card click - open full-screen doc view (or straight into
   * the editor when the caller requests it, e.g. workdeck-created docs).
   */
  const handleDocClick = useCallback((doc, initialMode = 'view') => {
    setActiveDoc({ id: doc.id, mode: initialMode, doc });
    setIsDocViewOpen(true);
    // Close sidebar on mobile after selecting a doc
    if (window.innerWidth < 1024) {
      setShowSidebar(false);
    }
  }, []);

  /**
   * Handle creating a new doc
   */
  const handleCreateDoc = useCallback(() => {
    setActiveDoc({ id: null, mode: 'create' });
    setIsDocViewOpen(true);
  }, []);

  /**
   * Handle tag selection - switch to active view if in archived mode
   */
  const handleTagSelect = useCallback((tagId) => {
    setActiveTag(tagId);
    if (showArchived) {
      setShowArchived(false);
    }
    // Close sidebar on mobile after selecting a tag
    if (window.innerWidth < 1024) {
      setShowSidebar(false);
    }
  }, [showArchived, setActiveTag, setShowArchived]);

  /**
   * Generate unique ID for new docs
   */
  const generateId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  };

  /**
   * Handle saving doc (create or update) - called from DocDetailView
   */
  const handleSaveDoc = useCallback((docId, docData) => {
    if (docId) {
      // Update existing doc
      return updateDoc(docId, docData);
    } else {
      // Create new doc - pass the doc data to API
      // The API will generate the ID and other fields
      return createDoc(docData).then((createdDoc) => {
        // Switch to view mode after creating with the returned doc
        setActiveDoc({ id: createdDoc.id, mode: 'view', doc: createdDoc });
        return createdDoc;
      });
    }
  }, [updateDoc, createDoc, activeTag]);

  /**
   * Handle deleting a doc from DocDetailView
   */
  const handleDeleteDoc = useCallback((docId) => {
    deleteDoc(docId);
    setIsDocViewOpen(false);
    setActiveDoc(null);
  }, [deleteDoc]);

  /**
   * Handle going back from doc detail view
   */
  const handleBackDocView = useCallback(() => {
    setIsDocViewOpen(false);
    setActiveDoc(null);
  }, []);

  /**
   * Handle going back from an editor opened directly by a workdeck create
   * link (editLinkDoc): close the editor and fall through to the normal app.
   */
  const handleBackEditLink = useCallback(() => {
    setEditLinkDoc(null);
  }, []);

  // ===== SHARED DOC VIEW - Works without login =====
  if (sharedDoc !== null) {
    const sharedEffectiveTheme = getEffectiveTheme();
    return (
      <div className={`min-h-screen ${sharedEffectiveTheme === 'dark' ? 'dark' : ''}`}>
        <SharedDocView
          doc={sharedDoc}
          sharedAt={sharedAt}
          onClose={() => {
            setSharedDoc(null);
            setSharedAt(null);
            // Clear the shared param from URL
            window.history.replaceState({}, '', window.location.pathname);
          }}
        />
        <div className="fixed top-4 right-4 z-50">
          <ThemeToggle theme={theme} systemTheme={systemTheme} onSetTheme={setTheme} />
        </div>
      </div>
    );
  }

  // ===== LOGIN SCREEN =====
  if (!isAuthenticated) {
    const loginEffectiveTheme = getEffectiveTheme();

    return (
      <div className={`min-h-screen ${loginEffectiveTheme === 'dark' ? 'dark' : ''}`}>
        <Login
          onLogin={login}
          isLoading={authLoading}
          error={authError}
        />
        <div className="fixed top-4 right-4 z-50">
          <ThemeToggle theme={theme} systemTheme={systemTheme} onSetTheme={setTheme} />
        </div>
      </div>
    );
  }

  // ===== MAIN APPLICATION =====
  const effectiveTheme = getEffectiveTheme();

  return (
    <div className={`min-h-screen ${effectiveTheme === 'dark' ? 'dark' : ''}`}>
      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-400/5 rounded-full blur-3xl" />
      </div>

      <div className="relative min-h-screen flex">
        {/* ===== SIDEBAR ===== */}
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-72 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out ${
            showSidebar ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex flex-col h-full">
            {/* Logo */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-400/10 dark:bg-white/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-500 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <span className="font-bold text-lg">Docs</span>
              </div>
              {/* Close sidebar - mobile and desktop */}
              <button
                onClick={() => setShowSidebar(false)}
                className="p-1 rounded hover:bg-gray-100 dark:bg-gray-700 transition-colors"
                aria-label="Close sidebar"
                title="Close sidebar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Tags */}
              <TagList
                tags={tags}
                activeTag={activeTag}
                onTagSelect={handleTagSelect}
                onCreateTag={createTag}
                onDeleteTag={deleteTag}
              />

              {/* Docs in Sidebar */}
              {(activeTag !== null || showArchived) && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                    Docs
                  </h3>
                  <div className="space-y-1">
                    {docs
                      .filter(n => showArchived ? n.archived === true : n.tagId === activeTag && n.archived !== true)
                      .sort((a, b) => {
                        // Pinned docs first
                        if (a.pinned && !b.pinned) return -1;
                        if (!a.pinned && b.pinned) return 1;
                        // Then by date
                        return new Date(b.updatedAt) - new Date(a.updatedAt);
                      })
                      .map(doc => (
                      <div
                        key={doc.id}
                        onClick={() => handleDocClick(doc)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors group ${
                          activeDoc?.id === doc.id && isDocViewOpen
                            ? 'bg-blue-100 dark:bg-blue-900/20'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {/* Doc icon */}
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>

                        {/* Doc title */}
                        <span className="flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                          {doc.title || 'Untitled'}
                        </span>

                        {/* Doc Actions */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePin(doc.id);
                            }}
                            className={`p-1.5 rounded-lg transition-colors ${
                              doc.pinned
                                ? 'text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
                                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                            title={doc.pinned ? 'Unpin doc' : 'Pin doc'}
                          >
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z" />
                            </svg>
                          </button>

                          <DocActions
                            doc={doc}
                            onPin={togglePin}
                            onDelete={deleteDoc}
                            onRename={(doc, newTitle) => {
                              updateDoc(doc.id, { title: newTitle });
                            }}
                            onArchive={(n) => {
                              toggleArchive(n.id);
                            }}
                            onShare={handleShare}
                            isArchivedView={showArchived}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* User info */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
              <UserDisplay
                userHash={userHash}
                onLogout={logout}
                onDeleteAccount={() => deleteAccount(userHash)}
                onShowKey={getUserKey}
              />
            </div>
          </div>
        </aside>

        {/* ===== OVERLAY for mobile ===== */}
        {showSidebar && (
          <div
            className="fixed inset-y-0 right-0 left-0 bg-black/50 z-20 lg:hidden"
            style={{ left: '18rem' }} // w-72 = 18rem, start overlay after sidebar
            onClick={() => setShowSidebar(false)}
          />
        )}

        {/* ===== MAIN CONTENT ===== */}
        <main className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${showSidebar ? 'lg:ml-72' : 'lg:ml-0'}`}>
          {/* Header */}
          <header className="sticky top-0 z-10 bg-bg-primary/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between px-4 py-3 gap-2 sm:gap-4">
              {/* Mobile search expanded mode */}
              {isSearchExpanded ? (
                <>
                  {/* Back button */}
                  <button
                    onClick={() => {
                      setIsSearchExpanded(false);
                      setSearchQuery('');
                    }}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:bg-gray-700"
                    aria-label="Close search"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  {/* Expanded search input */}
                  <div className="flex-1 mx-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search docs..."
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>

                  {/* Clear button */}
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:bg-gray-700"
                      aria-label="Clear search"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </>
              ) : (
                <>
                  {/* Mobile menu button */}
                  <button
                    onClick={() => setShowSidebar(true)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:bg-gray-700 lg:hidden"
                    aria-label="Open sidebar"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>

                  {/* Desktop/tablet sidebar toggle button */}
                  <button
                    onClick={() => setShowSidebar(!showSidebar)}
                    className="hidden lg:flex p-2 rounded-lg hover:bg-gray-100 dark:bg-gray-700 items-center justify-center transition-all duration-200"
                    aria-label={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
                  >
                    <div className={`transition-transform duration-200 ${showSidebar ? '' : 'rotate-180'}`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Search - desktop/tablet */}
                  <div className="hidden md:block flex-1 max-w-md mx-4 min-w-0">
                    <SearchBar
                      value={searchQuery}
                      onChange={setSearchQuery}
                      resultCount={filteredDocs.length}
                    />
                  </div>

                  {/* Mobile search icon */}
                  <button
                    onClick={() => setIsSearchExpanded(true)}
                    className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:bg-gray-700"
                    aria-label="Search"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>

                  {/* Actions - hidden only when search is expanded on mobile */}
                  <div className={`${isSearchExpanded ? 'hidden' : ''} flex items-center gap-2 sm:gap-2`}>
                    <ThemeToggle theme={theme} systemTheme={systemTheme} onSetTheme={setTheme} />
                    <Tooltip text={viewMode === 'card' ? 'Switch to list view' : 'Switch to card view'}>
                      <button
                        onClick={() => setViewMode(viewMode === 'card' ? 'list' : 'card')}
                        className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        {viewMode === 'card' ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                          </svg>
                        )}
                      </button>
                    </Tooltip>
                    <Tooltip text={showArchived ? 'Show active docs' : 'Show archived docs'}>
                      <button
                        onClick={() => setShowArchived(!showArchived)}
                        className={`p-2 rounded-lg transition-colors ${
                          showArchived
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                        </svg>
                      </button>
                    </Tooltip>
                    {!showArchived && (
                      <Tooltip text="Create new doc">
                        <button
                          onClick={handleCreateDoc}
                          className="btn-primary flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <span className="hidden sm:inline">New Doc</span>
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </>
              )}
            </div>
          </header>

          {/* Folder/View indicator */}
          <div className="px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {showArchived ? 'Archived Docs' : (activeTag ? (tags.find(t => t.id === activeTag)?.name || 'Unknown Tag') : 'All Docs')}
            </h2>
          </div>

          {/* Docs Grid */}
          <div className="p-4 sm:p-6">
            {filteredDocs.length === 0 ? (
              // Empty state
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700/30 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-1">
                  {searchQuery ? 'No docs found' : showArchived ? '' : 'No docs yet'}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  {searchQuery
                    ? 'Try a different search term'
                    : showArchived
                      ? 'No docs in archive'
                      : 'Welcome! Create your first doc to get started'}
                </p>
                {!searchQuery && !showArchived && (
                  <button onClick={handleCreateDoc} className="btn-primary">
                    Create First Doc
                  </button>
                )}
              </div>
            ) : (
              // Docs view - card or list
              viewMode === 'card' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
                  {filteredDocs.map(doc => (
                    <DocCard
                      key={doc.id}
                      doc={doc}
                      onClick={handleDocClick}
                      onPin={togglePin}
                      isPinned={doc.pinned}
                      onDelete={deleteDoc}
                      onRename={(doc, newTitle) => {
                        updateDoc(doc.id, { title: newTitle });
                      }}
                      onArchive={(n) => {
                        toggleArchive(n.id);
                      }}
                      onShare={handleShare}
                      isArchivedView={showArchived}
                      tags={tags}
                      currentTagId={activeTag}
                      isSearchResult={searchQuery.length > 0}
                    />
                  ))}
                </div>
              ) : (
                <div className="max-w-5xl mx-auto">
                  <DocListView
                    docs={filteredDocs}
                    onClick={handleDocClick}
                    onPin={togglePin}
                    onDelete={deleteDoc}
                    onRename={(doc, newTitle) => {
                      updateDoc(doc.id, { title: newTitle });
                    }}
                    onArchive={(n) => {
                      toggleArchive(n.id);
                    }}
                    onShare={handleShare}
                    isArchivedView={showArchived}
                    tags={tags}
                    currentTagId={activeTag}
                    isSearchResult={searchQuery.length > 0}
                  />
                </div>
              )
            )}
          </div>

          {/* Status footer: file stats. Sticky so it stays pinned
              to the viewport bottom while the list scrolls. */}
          <footer className="sticky bottom-0 z-20 mt-auto px-4 sm:px-6 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-gray-200 dark:border-gray-700 bg-[rgb(var(--bg-primary))] flex items-center justify-between gap-4 text-[11.5px] leading-none text-gray-400 dark:text-gray-500 tabular-nums select-none">
            <span className="truncate">
              {searchQuery
                ? `${filteredDocs.length} of ${docs.filter(n => !n.archived).length} files`
                : `${docs.filter(n => !n.archived).length} files · ${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`}
            </span>
          </footer>
        </main>
      </div>

      {/* ===== DOC DETAIL VIEW ===== */}
      {(editLinkDoc || (isDocViewOpen && activeDoc)) && (
        <DocDetailView
          doc={editLinkDoc
            ? editLinkDoc
            : (activeDoc.mode === 'create' ? null : activeDoc.doc)}
          initialMode={editLinkDoc ? 'edit'
            : (activeDoc.mode === 'create' ? 'edit' : activeDoc.mode)}
          tags={tags}
          userHash={userHash}
          activeTag={activeTag}
          onBack={editLinkDoc ? handleBackEditLink : handleBackDocView}
          onDelete={handleDeleteDoc}
          onUpdateDoc={handleSaveDoc}
          onShare={handleShare}
          onCreateTag={createTag}
          theme={theme}
          systemTheme={systemTheme}
          onSetTheme={setTheme}
        />
      )}

      {/* Share Modal */}
      {sharingDoc && (
        <ShareModal
          doc={sharingDoc}
          shareUrl={shareUrl}
          alreadyShared={alreadyShared}
          onClose={() => {
            setSharingDoc(null);
            setShareUrl(null);
            setAlreadyShared(false);
          }}
        />
      )}
    </div>
  );
}

export default App;
