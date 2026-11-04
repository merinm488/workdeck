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
    userHash: null,
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

    const session = blogAuth.getSession();
    if (!session) {
        window.location.href = '/';
        return;
    }
    state.userHash = session.hash;

    showLoading(true);
    const doc = await blogStorage.loadUserData();
    showLoading(false);

    if (!doc) {
        blogAuth.logout();
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

function showPostsView() {
    state.editingId = null;
    $('postsView').classList.remove('hidden');
    $('editorView').classList.add('hidden');
    $('newPostBtn').classList.remove('hidden');
    $('postsSearchWrap').classList.remove('hidden');
    $('pageTitle').textContent = 'Blog';
    // Drop the post id — the posts home is always plain /blog/.
    history.replaceState({}, '', '/blog/');
    renderPosts();
    refreshPublishMenu();
}

function showEditorView() {
    $('postsView').classList.add('hidden');
    $('editorView').classList.remove('hidden');
    $('newPostBtn').classList.add('hidden');
    $('postsSearchWrap').classList.add('hidden');
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
        row.querySelector('.blog-post-row-title').textContent = post.title || 'Untitled';
        row.querySelector('.blog-post-row-public').hidden = !post.publishedAt;
        const excerpt = post.excerpt || '';
        const excerptEl = row.querySelector('.blog-post-row-excerpt');
        if (excerpt) excerptEl.textContent = excerpt;
        else excerptEl.remove();
        row.querySelector('.blog-post-row-date').textContent =
            formatWhen(post.updatedAt, lastOpened[post.id]);
        row.addEventListener('click', () => openPost(post.id));
        list.appendChild(row);
    });
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
    // Keep /blog/<id> in the address bar for pasteable deep links.
    const url = new URL(window.location.href);
    url.pathname = '/blog/' + postId;
    url.search = '';
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

function copyKey() {
    const key = $('keyText').textContent;
    const done = () => {
        const note = $('keyCopyFeedback');
        note.hidden = false;
        setTimeout(() => { note.hidden = true; }, 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(key).then(done).catch(() => fallbackCopy(key, done));
    } else {
        fallbackCopy(key, done);
    }
}

// On success blogAuth.deleteAccount() clears the session and redirects.
async function confirmDeleteAccount() {
    const btn = $('confirmDeleteAccount');
    btn.disabled = true;
    const result = await blogAuth.deleteAccount();
    btn.disabled = false;
    if (!result.success) {
        $('deleteAccountModal').classList.add('hidden');
        showToast(result.error || 'Could not delete the account', true);
    }
}

// ================================================
// Chrome wiring
// ================================================

function closeSettingsMenu() {
    $('settingsMenu').classList.add('hidden');
    $('settingsBtn').setAttribute('aria-expanded', 'false');
}

function wireChrome() {
    $('newPostBtn').addEventListener('click', createPost);
    $('emptyNewPostBtn').addEventListener('click', createPost);
    $('postsSearch').addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderPosts();
    });

    // Settings menu (gear) — per-post publish (editor only), themes,
    // key, account actions
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
    $('viewKeyBtn').addEventListener('click', () => {
        settingsMenu.classList.add('hidden');
        settingsBtn.setAttribute('aria-expanded', 'false');
        $('keyText').textContent = blogAuth.getUserKey() || '-';
        $('keyCopyFeedback').hidden = true;
        $('keyModal').classList.remove('hidden');
    });
    $('logoutBtn').addEventListener('click', () => blogAuth.logout());
    $('deleteAccountBtn').addEventListener('click', () => {
        settingsMenu.classList.add('hidden');
        settingsBtn.setAttribute('aria-expanded', 'false');
        $('deleteAccountModal').classList.remove('hidden');
    });
    document.addEventListener('click', (e) => {
        if (e.target.closest('.blog-menu-wrap')) return;
        settingsMenu.classList.add('hidden');
        settingsBtn.setAttribute('aria-expanded', 'false');
        themeMenu.classList.add('hidden');
        themeBtn.setAttribute('aria-expanded', 'false');
    });

    // View key + delete account modals
    $('keyModalClose').addEventListener('click', () => $('keyModal').classList.add('hidden'));
    $('keyModalCloseBtn').addEventListener('click', () => $('keyModal').classList.add('hidden'));
    $('keyCopyBtn').addEventListener('click', copyKey);
    $('keyModal').addEventListener('click', (e) => {
        if (e.target === $('keyModal')) $('keyModal').classList.add('hidden');
    });
    $('deleteAccountModalClose').addEventListener('click', () => $('deleteAccountModal').classList.add('hidden'));
    $('cancelDeleteAccount').addEventListener('click', () => $('deleteAccountModal').classList.add('hidden'));
    $('confirmDeleteAccount').addEventListener('click', confirmDeleteAccount);
    $('deleteAccountModal').addEventListener('click', (e) => {
        if (e.target === $('deleteAccountModal')) $('deleteAccountModal').classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        settingsMenu.classList.add('hidden');
        themeMenu.classList.add('hidden');
        $('keyModal').classList.add('hidden');
        $('deleteAccountModal').classList.add('hidden');
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
