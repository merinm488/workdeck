/**
 * ================================================
 * BLOG - Application (home + chrome)
 * ================================================
 *
 * Posts home (list + search + create), the settings menu (themes, view
 * key, account actions), and routing between /blog/ and /blog/<id>. The
 * editor (and the per-post publish modal) lives in editor.js.
 */

const state = {
    posts: [],
    settings: {},          // the full settings object (mirrors the doc)
    searchQuery: '',
    editingId: null
};

const $ = (id) => document.getElementById(id);

// ================================================
// Boot
// ================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    blogThemeManager.init();
    wireChrome();
    BlogEditor.init();

    if (!await blogAuth.verifySession()) {
        window.location.href = '/';
        return;
    }

    showLoading(true);
    const doc = await blogStorage.loadUserData();
    showLoading(false);

    if (!doc) {
        window.location.href = '/account';
        return;
    }

    blogThemeManager.applyFromServer(doc.settings && doc.settings.theme);
    state.settings = doc.settings || {};
    state.posts = doc.posts || [];

    const pathId = (/^\/blog\/([a-z0-9]{14,})\/?$/.exec(window.location.pathname) || [])[1];
    const postId = pathId || new URLSearchParams(window.location.search).get('post');
    if (postId) {
        openPost(postId);
    } else {
        showPostsView();
        renderPosts();
    }
}

// ================================================
// Views
// ================================================

function setBackLink(inEditor) {
    const link = document.querySelector('.blog-home-link');
    link.href = inEditor ? '/blog/' : '/';
    link.title = inEditor ? 'Back to Blog' : 'Back to Workdeck';
    link.setAttribute('aria-label', link.title);
}

function showPostsView() {
    state.editingId = null;
    setBackLink(false);
    $('postsView').classList.remove('hidden');
    $('editorView').classList.add('hidden');
    $('newPostBtn').classList.remove('hidden');
    $('postsSearchWrap').classList.remove('hidden');
    $('postsSearchToggle').classList.remove('hidden');
    $('pageTitle').textContent = 'Blog';
    // Drop the post id — the posts home is always plain /blog/.
    history.replaceState({}, '', '/blog/');
    renderPosts();
    refreshPublishMenu();
}

function showEditorView() {
    setBackLink(true);
    $('postsView').classList.add('hidden');
    $('editorView').classList.remove('hidden');
    $('newPostBtn').classList.add('hidden');
    $('postsSearchWrap').classList.add('hidden');
    $('postsSearchToggle').classList.add('hidden');
    document.querySelector('.blog-topbar').classList.remove('search-open');
    $('postsSearchToggle').setAttribute('aria-expanded', 'false');
    $('pageTitle').textContent = 'Edit Post';
}

// ================================================
// Posts home
// ================================================

/**
 * The settings menu is context-sensitive: the publish group appears only
 * while a post is open in the editor, and its published items only while
 * that post is public.
 */
function refreshPublishMenu() {
    const post = (window.BlogEditor && window.BlogEditor.post) || null;
    const inEditor = Boolean(state.editingId && post);
    const published = Boolean(post && post.publishedAt);
    const path = published ? postPublicPath(post) : '';

    $('publishPostMenuItem').classList.toggle('hidden', !inEditor || published);
    $('pubPostLive').classList.toggle('hidden', !published);
    $('pubPostMenuUrl').textContent = path;
    $('copyPostLinkItem').classList.toggle('hidden', !published);
    $('openPostLinkItem').classList.toggle('hidden', !published);
    if (published) $('openPostLinkItem').href = location.origin + path;
    $('unpublishPostMenuItem').classList.toggle('hidden', !published);
    $('publishMenuDivider').classList.toggle('hidden', !inEditor);
}

function renderPosts() {
    const list = $('postsList');
    list.innerHTML = '';

    const q = state.searchQuery.toLowerCase().trim();
    const visible = state.posts.filter(p =>
        !q ||
        (p.title || '').toLowerCase().includes(q) ||
        (p.excerpt || '').toLowerCase().includes(q)
    );

    $('postsEmpty').classList.toggle('hidden', state.posts.length > 0);
    $('postsEmptySearch').classList.toggle('hidden', state.posts.length === 0 || visible.length > 0);
    list.classList.toggle('hidden', visible.length === 0);

    const lastOpened = (state.settings && state.settings.lastOpened) || {};

    visible.forEach(post => {
        const row = $('blogPostRowTemplate').content.firstElementChild.cloneNode(true);
        row.dataset.id = post.id;
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        const icon = document.createElement('span');
        icon.className = 'blog-post-row-icon';
        icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
        row.querySelector('.blog-post-row-head').prepend(icon);
        row.querySelector('.blog-post-row-title').textContent = post.title || 'Untitled';
        row.querySelector('.blog-post-row-public').hidden = !post.publishedAt;
        const excerpt = post.excerpt || '';
        const excerptEl = row.querySelector('.blog-post-row-excerpt');
        if (excerpt) excerptEl.textContent = excerpt;
        else excerptEl.remove();
        row.querySelector('.blog-post-row-date').textContent =
            formatWhen(post.updatedAt, lastOpened[post.id]);
        row.addEventListener('click', () => openPost(post.id));
        row.addEventListener('keydown', (event) => {
            if (event.target !== row || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            openPost(post.id);
        });
        const actions = document.createElement('div');
        actions.className = 'blog-post-row-actions';
        const rename = document.createElement('button');
        rename.type = 'button'; rename.title = 'Rename'; rename.setAttribute('aria-label', 'Rename');
        rename.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
        rename.addEventListener('click', (event) => { event.stopPropagation(); renamePost(post); });
        const remove = document.createElement('button');
        remove.type = 'button'; remove.title = 'Delete'; remove.setAttribute('aria-label', 'Delete');
        remove.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        remove.addEventListener('click', (event) => { event.stopPropagation(); deletePostFromHome(post); });
        actions.addEventListener('keydown', (event) => event.stopPropagation());
        actions.append(rename, remove);
        row.append(actions);
        list.appendChild(row);
    });
}

async function renamePost(post) {
    const name = prompt('Rename post', post.title || 'Untitled');
    if (name === null || !name.trim() || name.trim() === post.title) return;
    if (name.trim().length > 200) { showToast('Post title must be 200 characters or less', true); return; }
    const result = await blogStorage.request('updatePost', { id: post.id, title: name.trim() });
    if (!result.success) { showToast(result.error || 'Could not rename the post', true); return; }
    // Reload the records used by the shared tag sidebar as well as the cards.
    window.location.reload();
}

async function deletePostFromHome(post) {
    if (!confirm(`Delete "${post.title || 'Untitled'}"? This cannot be undone.`)) return;
    const result = await blogStorage.deletePost(post.id);
    if (!result) { showToast('Could not delete the post', true); return; }
    window.location.reload();
}

function formatWhen(updatedAt, lastOpenedAt) {
    const ts = Date.parse(updatedAt || '');
    if (isNaN(ts)) return '';
    const edited = Date.now() - ts < 60000;
    if (edited) return 'Edited just now';
    return 'Edited ' + new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function createPost() {
    $('newPostBtn').disabled = true;
    $('emptyNewPostBtn').disabled = true;
    const result = await blogStorage.createPost({});
    $('newPostBtn').disabled = false;
    $('emptyNewPostBtn').disabled = false;

    if (!result) {
        showToast('Could not create the post', true);
        return;
    }
    state.posts.unshift(result.post);
    openPost(result.post.id);
}

function openPost(postId) {
    const post = state.posts.find(p => p && p.id === postId);
    if (!post) {
        showToast('Post not found', true);
        window.location.href = '/blog/';
        return;
    }
    state.editingId = postId;
    showEditorView();
    BlogEditor.open(post);
    bumpLastOpened(postId);
    // Keep the post link reload-safe on Holm's canonical static routes.
    const url = new URL('/blog/', window.location.origin);
    url.searchParams.set('post', postId);
    history.replaceState({}, '', url);
}

function bumpLastOpened(postId) {
    state.settings.lastOpened = { ...(state.settings.lastOpened || {}), [postId]: new Date().toISOString() };
    blogStorage.saveSettings({ lastOpened: state.settings.lastOpened }).catch(console.error);
}

// The blog's identity (name + claimed address), read from settings.
// Publish lives per post — see BlogEditor in editor.js.
function blogConfig() {
    const blog = state.settings.blog && typeof state.settings.blog === 'object'
        ? state.settings.blog
        : {};
    return {
        title: blog.title || '',
        description: blog.description || '',
        address: blog.address
            || (blog.publish ? { slug: blog.publish.slug, publishedAt: blog.publish.publishedAt } : null)
    };
}

// Public path of a published post. Posts published since per-post links
// carry their own `path` ("/<slug>"); older ones live under the blog's
// claimed address.
function postPublicPath(post) {
    if (post.path) return post.path;
    const blog = blogConfig();
    return blog.address ? `/${blog.address.slug}/${post.slug}` : `/${post.slug}`;
}

// The PUT response carries the saved doc; take only the settings from it
// (posts may have changed elsewhere in flight).
function mergeSettings(local, savedDoc) {
    return savedDoc && savedDoc.settings ? savedDoc.settings : local;
}

// Clipboard fallback for non-secure contexts (http://localhost aside).
function fallbackCopy(text, done) {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    try { document.execCommand('copy'); done(); } catch (err) { /* clipboard unavailable */ }
    input.remove();
}

// ================================================
// Chrome wiring
// ================================================

function closeSettingsMenu() {
    $('settingsMenu').classList.add('hidden');
    $('settingsBtn').setAttribute('aria-expanded', 'false');
}

function handleHomeLinkClick(event) {
    if (!state.editingId || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // Use the same return path as the editor's Posts button so pending
    // autosaves are flushed before showing the blog's post list.
    BlogEditor.close();
}

function wireChrome() {
    document.querySelector('.blog-home-link').addEventListener('click', handleHomeLinkClick);
    $('newPostBtn').addEventListener('click', createPost);
    $('emptyNewPostBtn').addEventListener('click', createPost);
    $('postsSearchToggle').addEventListener('click', () => {
        const nav = document.querySelector('.blog-topbar');
        const open = nav.classList.toggle('search-open');
        $('postsSearchToggle').setAttribute('aria-expanded', String(open));
        if (open) $('postsSearch').focus();
    });
    $('postsSearch').addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderPosts();
    });

    // Settings menu (gear) — publish, themes, account link
    const settingsBtn = $('settingsBtn');
    const settingsMenu = $('settingsMenu');
    const themeBtn = $('themeMenuBtn');
    const themeMenu = $('themeMenu');
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
        settingsBtn.setAttribute('aria-expanded', String(!settingsMenu.classList.contains('hidden')));
    });
    themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        themeMenu.classList.toggle('hidden');
        themeBtn.setAttribute('aria-expanded', String(!themeMenu.classList.contains('hidden')));
    });
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            blogThemeManager.setTheme(btn.dataset.theme);
            themeMenu.classList.add('hidden');
            themeBtn.setAttribute('aria-expanded', 'false');
        });
    });
    $('publishPostMenuItem').addEventListener('click', () => {
        closeSettingsMenu();
        BlogEditor.openPublishPostModal();
    });
    $('unpublishPostMenuItem').addEventListener('click', () => {
        closeSettingsMenu();
        BlogEditor.openPublishPostModal();
    });
    $('copyPostLinkItem').addEventListener('click', () => {
        closeSettingsMenu();
        BlogEditor.copyPostLink();
    });
    $('openPostLinkItem').addEventListener('click', () => closeSettingsMenu());
    $('logoutBtn').addEventListener('click', () => blogAuth.logout());
    document.addEventListener('click', (e) => {
        if (e.target.closest('.blog-menu-wrap')) return;
        settingsMenu.classList.add('hidden');
        settingsBtn.setAttribute('aria-expanded', 'false');
        themeMenu.classList.add('hidden');
        themeBtn.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        settingsMenu.classList.add('hidden');
        themeMenu.classList.add('hidden');
    });

    // Image modal (wired by the editor's insert handler)
    $('imageModalClose').addEventListener('click', () => BlogEditor.closeImageModal());
    $('cancelImage').addEventListener('click', () => BlogEditor.closeImageModal());
    $('confirmImage').addEventListener('click', () => BlogEditor.confirmImage());
    $('imageModal').addEventListener('click', (e) => {
        if (e.target === $('imageModal')) BlogEditor.closeImageModal();
    });
}

function showLoading(loading) {
    $('loadingOverlay').classList.toggle('hidden', !loading);
}

function showToast(message, isError) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('error', Boolean(isError));
    toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { toast.hidden = true; }, 2600);
}

// Exposed for editor.js (single global, plain script tags)
window.BlogApp = {
    showPostsView,
    showToast,
    get posts() { return state.posts; }
};
