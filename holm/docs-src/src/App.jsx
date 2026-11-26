import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense, Component } from 'react';
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
import { DocTagsProvider } from './components/DocTags';
const DocDetailView = lazy(() => import('./components/DocDetailView').then(module => ({ default: module.DocDetailView })));
import { ShareModal } from './components/ShareModal';
const SharedDocView = lazy(() => import('./components/SharedDocView').then(module => ({ default: module.SharedDocView })));
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
function DocLoading({ message = 'Loading document…' }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[rgb(var(--bg-primary))] text-gray-600 dark:text-gray-300" role="status">{message}</div>;
}
class DocLoadBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div className="fixed inset-0 z-50 grid place-items-center bg-[rgb(var(--bg-primary))]"><div role="alert">Could not load the document editor. <button onClick={() => location.reload()}>Retry</button></div></div>
      : this.props.children;
  }
}

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
    filteredDocs,
    isLoading,
    hasLoaded,
    loadError,
    setActiveTag,
    setSearchQuery,
    createDoc,
    updateDoc,
    deleteDoc,
    createTag,
    updateTag,
    deleteTag,
    refreshData
  } = useDocs(userHash);

  const parseDocLink = () => {
    if (window.WDLinks) {
      const loc = WDLinks.parseLocation();
      if (loc && loc.app === 'docs') return loc.id;
    }
    return new URLSearchParams(window.location.search).get('doc');
  };

  const [activeDoc, setActiveDoc] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const id = parseDocLink();
    if (id && params.get('edit') !== '1') {
      return { id, mode: 'view', doc: { id }, isStub: true };
    }
    return null; // { id, mode: 'view' | 'edit' | 'create', doc?, isStub? }
  });
  const [isDocViewOpen, setIsDocViewOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(parseDocLink()) && params.get('edit') !== '1';
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

  // Search uses the same always-visible, responsive field as Workdeck.

  // View mode state with persistence
  const [viewMode, setViewMode] = useState(() => {
    // Load from localStorage on initial render (legacy key fallback for existing users)
    try { return localStorage.getItem('docs_view_mode') === 'list' ? 'list' : 'card'; }
    catch (_) { return 'card'; }
  });

  // Save view mode to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem('docs_view_mode', viewMode); } catch (_) { /* private mode */ }
  }, [viewMode]);

  const sidebarOpener = useRef(null);
  const closeSidebar = useCallback(() => {
    setShowSidebar(false);
    sidebarOpener.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!showSidebar) return;
    const escape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || window.innerWidth >= 1024 ||
          document.querySelector('dialog[open], .wd-action-menu')) return;
      event.preventDefault(); closeSidebar();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [showSidebar, closeSidebar]);

  // Keep the user's collapsed state during desktop resizes; reset only when
  // crossing between a desktop sidebar and a mobile drawer.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onBreakpointChange = event => setShowSidebar(event.matches);
    desktop.addEventListener('change', onBreakpointChange);
    return () => desktop.removeEventListener('change', onBreakpointChange);
  }, []);

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

  const [pendingDocLink] = useState(() => {
    const id = parseDocLink();
    return id ? { id, edit: new URLSearchParams(window.location.search).get('edit') === '1' } : null;
  });

  const [editLinkDoc, setEditLinkDoc] = useState(() => pendingDocLink?.edit ? { id: pendingDocLink.id } : null);

  useEffect(() => {
    if (!pendingDocLink) return;
    // Holm's static router canonicalizes /docs/<id> to /docs/ on reload.
    window.history.replaceState({}, '', '/docs/?doc=' + encodeURIComponent(pendingDocLink.id));

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
   * The address bar tracks the open doc's hard link.
   */
  const handleDocClick = useCallback((doc, initialMode = 'view') => {
    setActiveDoc({ id: doc.id, mode: initialMode, doc });
    setIsDocViewOpen(true);
    window.history.pushState({}, '', '/docs/?doc=' + encodeURIComponent(doc.id));
    // Close sidebar on mobile after selecting a doc
    if (window.innerWidth < 1024) {
      setShowSidebar(false);
    }
  }, []);

  /**
   * Open a doc mentioned by another doc (mention chip / backlink click)
   */
  const handleOpenDocLink = useCallback((docId) => {
    const doc = docs.find(n => n.id === docId);
    setActiveDoc(doc
      ? { id: docId, mode: 'view', doc }
      : { id: docId, mode: 'view', doc: { id: docId }, isStub: true });
    setIsDocViewOpen(true);
    window.history.pushState({}, '', '/docs/?doc=' + encodeURIComponent(docId));
  }, [docs]);

  // Browser back/forward syncs the doc view to the address bar.
  useEffect(() => {
    const onPopState = () => {
      const id = window.WDLinks ? (WDLinks.parseLocation() || {}).app === 'docs' && WDLinks.parseLocation().id : null;
      if (id) {
        const doc = docs.find(n => n.id === id);
        setActiveDoc(doc
          ? { id, mode: 'view', doc }
          : { id, mode: 'view', doc: { id }, isStub: true });
        setIsDocViewOpen(true);
      } else {
        setIsDocViewOpen(false);
        setActiveDoc(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [docs]);

  /**
   * Handle creating a new doc
   */
  const handleCreateDoc = useCallback(() => {
    setActiveDoc({ id: null, mode: 'create' });
    setIsDocViewOpen(true);
  }, []);

  /**
   * Handle tag selection
   */
  const handleTagSelect = useCallback((tagId) => {
    setActiveTag(tagId);
    // Close sidebar on mobile after selecting a tag
    if (window.innerWidth < 1024) {
      setShowSidebar(false);
    }
  }, [setActiveTag]);

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
        // Keep typing after the first automatic save creates the document.
        setActiveDoc({ id: createdDoc.id, mode: 'edit', doc: createdDoc });
        window.history.pushState({}, '', '/docs/?doc=' + encodeURIComponent(createdDoc.id));
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
    // Track the closed state in history so Back reopens the doc.
    window.history.pushState({}, '', '/docs/');
  }, []);

  /**
   * Handle going back from an editor opened directly by a workdeck create
   * link (editLinkDoc): close the editor and fall through to the normal app.
   */
  const handleBackEditLink = useCallback(() => {
    setEditLinkDoc(null);
    window.history.pushState({}, '', '/docs/');
  }, []);

  // ===== SHARED DOC VIEW - Works without login =====
  if (sharedDoc !== null) {
    const sharedEffectiveTheme = getEffectiveTheme();
    return (
      <div className={`min-h-screen ${sharedEffectiveTheme === 'dark' ? 'dark' : ''}`}>
        <DocLoadBoundary><Suspense fallback={<DocLoading />}><SharedDocView
          doc={sharedDoc}
          sharedAt={sharedAt}
          onClose={() => {
            setSharedDoc(null);
            setSharedAt(null);
            // Clear the shared param from URL
            window.history.replaceState({}, '', window.location.pathname);
          }}
        /></Suspense></DocLoadBoundary>
        <div className="fixed top-4 right-4 z-50">
          <ThemeToggle theme={theme} systemTheme={systemTheme} onSetTheme={setTheme} />
        </div>
      </div>
    );
  }

  // ===== LOGIN SCREEN =====
  if (!isAuthenticated) {
    // Never paint sign-in controls or the home beneath a pending direct link.
    if (authLoading) return <DocLoading message="Loading workspace…" />;
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
    <DocTagsProvider tags={tags} onUpdateDoc={updateDoc} onCreateTag={createTag}>
    <div className={`min-h-screen ${effectiveTheme === 'dark' ? 'dark' : ''}`}>
      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-400/5 rounded-full blur-3xl" />
      </div>

      <div className="relative min-h-screen flex"
        inert={editLinkDoc || (isDocViewOpen && activeDoc) ? '' : undefined}
        aria-hidden={!!(editLinkDoc || (isDocViewOpen && activeDoc))}>
        {/* ===== SIDEBAR ===== */}
        <aside
          id="docsSidebar"
          inert={showSidebar ? undefined : ''}
          aria-hidden={!showSidebar}
          className={`wd-docs-sidebar fixed inset-y-0 left-0 z-30 w-[280px] bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out ${
            showSidebar ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex flex-col h-full">
            {/* Logo */}
            <div className="wd-sidebar-brand">
              <a className="wd-sidebar-home" href="/home" aria-label="Workdeck home" title="Workdeck home">
                <span className="wd-sidebar-home-icon" dangerouslySetInnerHTML={{ __html: window.WDHomeIcons.workdeck }} />
                <span className="wd-sidebar-home-text">Workdeck</span>
              </a>
              {/* On mobile the header toggle is covered by the drawer; keep its close action here. */}
              <button
                onClick={closeSidebar}
                className="lg:hidden w-[38px] h-[38px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:bg-gray-700 transition-colors"
                aria-label="Close sidebar"
                aria-controls="docsSidebar"
                aria-expanded={showSidebar}
                title="Close sidebar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m11 6-6 6 6 6m8-12-6 6 6 6" />
                </svg>
              </button>
            </div>

            {/* Scrollable content */}
            <div className="wd-home-sidebar-scroll flex-1 overflow-y-auto p-4 space-y-6">
              {/* Tags */}
              <TagList
                tags={tags}
                docs={docs}
                activeTag={activeTag}
                onTagSelect={handleTagSelect}
                onCreateTag={createTag}
                onUpdateTag={updateTag}
                onDeleteTag={deleteTag}
              />

              {/* Docs in Sidebar */}
              {activeTag !== null && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                    Docs
                  </h3>
                  <div className="space-y-1">
                    {docs
                      .filter(n => n.tagId === activeTag)
                      .sort((a, b) => {
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
                          <DocActions
                            doc={doc}
                            onDelete={deleteDoc}
                            onRename={(doc, newTitle) => {
                              updateDoc(doc.id, { title: newTitle });
                            }}
                            onShare={handleShare}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ===== OVERLAY for mobile ===== */}
        {showSidebar && (
          <div
            className="fixed inset-y-0 right-0 left-0 bg-black/50 z-20 lg:hidden"
            style={{ left: '280px' }} // Match the sidebar width so its drawer overlay starts at the edge
            onClick={closeSidebar}
          />
        )}

        {/* ===== MAIN CONTENT ===== */}
        <main className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${showSidebar ? 'lg:ml-[280px]' : 'lg:ml-0'}`}>
          {/* Header */}
          <header className="sticky top-0 z-10 bg-bg-primary/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700">
            <div className="wd-home-header">
                  {/* Mobile menu button */}
                  <button
                    ref={sidebarOpener}
                    onClick={() => setShowSidebar(true)}
                    className="w-[38px] h-[38px] p-0 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:bg-gray-700 lg:hidden"
                    aria-label="Open sidebar"
                    aria-controls="docsSidebar"
                    aria-expanded={showSidebar}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m5 6 6 6-6 6m8-12 6 6-6 6" />
                    </svg>
                  </button>

                  {/* Desktop/tablet sidebar toggle button */}
                  <button
                    onClick={() => setShowSidebar(!showSidebar)}
                    className="hidden lg:flex w-[38px] h-[38px] rounded-lg hover:bg-gray-100 dark:bg-gray-700 items-center justify-center transition-colors"
                    aria-label={showSidebar ? "Close sidebar" : "Open sidebar"}
                    aria-controls="docsSidebar"
                    aria-expanded={showSidebar}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                      <path d={showSidebar ? "m11 6-6 6 6 6m8-12-6 6 6 6" : "m5 6 6 6-6 6m8-12 6 6-6 6"} />
                    </svg>
                  </button>

                  {/* Search - desktop/tablet */}
                  <div className="wd-home-search">
                    <SearchBar
                      value={searchQuery}
                      onChange={setSearchQuery}
                      titles={filteredDocs.map(doc => doc.title)}
                    />
                  </div>

                  <div className="wd-docs-actions flex items-center gap-2">
                    <Tooltip text={viewMode === 'card' ? 'Switch to list view' : 'Switch to card view'}>
                      <button
                        onClick={() => setViewMode(viewMode === 'card' ? 'list' : 'card')}
                        aria-label={viewMode === 'card' ? 'Switch to list view' : 'Switch to card view'}
                        aria-pressed={viewMode === 'list'}
                        className="w-[38px] h-[38px] p-0 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        {viewMode === 'card' ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2} /><rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2} /><rect x="14" y="14" width="7" height="7" rx="1" strokeWidth={2} /><rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2} />
                          </svg>
                        )}
                      </button>
                    </Tooltip>
                    <Tooltip text="Create new doc">
                      <button
                        onClick={handleCreateDoc}
                        className="btn-primary flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
                        </svg>
                        <span className="hidden sm:inline">New Doc</span>
                      </button>
                    </Tooltip>
                    <UserDisplay onLogout={logout} theme={theme} onSetTheme={setTheme} />
                  </div>
            </div>
          </header>

          {/* Docs Grid */}
          <div className="wd-home-content">
            {!hasLoaded || isLoading ? (
              <p role="status" className="py-8 text-gray-500 dark:text-gray-400">Loading docs…</p>
            ) : loadError ? (
              <div role="alert" className="py-8">
                <p>{loadError}</p>
                <button onClick={refreshData} className="btn-primary mt-3">Retry</button>
              </div>
            ) : filteredDocs.length === 0 ? (
              // Empty state
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700/30 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-1">
                  {searchQuery ? 'No docs found' : 'No docs yet'}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  {searchQuery ? 'Try a different search term' : 'Welcome! Create your first doc to get started'}
                </p>
                {!searchQuery && (
                  <button onClick={handleCreateDoc} className="btn-primary">
                    Create First Doc
                  </button>
                )}
              </div>
            ) : (
              // Docs view - card or list
              viewMode === 'card' ? (
                <div className="wd-home-grid">
                  {filteredDocs.map(doc => (
                    <DocCard
                      key={doc.id}
                      doc={doc}
                      onClick={handleDocClick}
                      onDelete={deleteDoc}
                      onRename={(doc, newTitle) => {
                        updateDoc(doc.id, { title: newTitle });
                      }}
                      onShare={handleShare}
                      tags={tags}
                      currentTagId={activeTag}
                      isSearchResult={searchQuery.length > 0}
                    />
                  ))}
                </div>
              ) : (
                <div className="wd-home-list max-w-5xl mx-auto">
                  <DocListView
                    docs={filteredDocs}
                    onClick={handleDocClick}
                    onDelete={deleteDoc}
                    onRename={(doc, newTitle) => {
                      updateDoc(doc.id, { title: newTitle });
                    }}
                    onShare={handleShare}
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
                ? `${filteredDocs.length} of ${docs.length} files`
                : `${docs.length} files · ${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`}
            </span>
          </footer>
        </main>
      </div>

      {/* ===== DOC DETAIL VIEW ===== */}
      {(editLinkDoc || (isDocViewOpen && activeDoc)) && (
        <DocLoadBoundary><Suspense fallback={<DocLoading />}><DocDetailView
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
          onOpenDocLink={handleOpenDocLink}
          onCreateTag={createTag}
          theme={theme}
          systemTheme={systemTheme}
          onSetTheme={setTheme}
        /></Suspense></DocLoadBoundary>
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
    </DocTagsProvider>
  );
}

export default App;
