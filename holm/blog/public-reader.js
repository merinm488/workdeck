/**
 * ================================================
 * WORKDECK - Public blog reader (blog.js)
 * ================================================
 *
 * Renders published posts for visitors. A per-post link /<slug> (a
 * transparent rewrite of /blog.html?site=<slug>) opens straight onto
 * that article; a legacy blog address serves its post list with
 * articles at /<slug>/<post>. Everything comes from the public GET-only
 * /api/site — the visitor's browser never sees (and cannot learn) the
 * owning account's hash or storage address, and there is no write path
 * at all. Posts appear only once they are published from the editor
 * (per-post publish).
 *
 * The index loads once; article navigation is client-side via
 * history.pushState with popstate fallback, so back/forward work
 * without refetching the blog. Post bodies are Quill HTML scrubbed at
 * save time on the server and sanitized again here before rendering.
 */

(function () {
    'use strict';

    const API = '/api/site';

    const state = {
        slug: null,
        site: null,
        blog: null,
        posts: [],
        mode: 'blog',         // 'standalone': /<slug> IS one article
        articles: new Map()   // post slug -> post (fetched on demand)
    };

    const $ = (id) => document.getElementById(id);
    const show = (el) => { el.hidden = false; };
    const hide = (el) => { el.hidden = true; };
    function clone(id) {
        return $(id).content.firstElementChild.cloneNode(true);
    }

    // ================================================
    // Sanitizer (same threat list as the server-side scrub and the
    // launcher previews; the sanctioned innerHTML exception)
    // ================================================

    function sanitizeFragment(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('script,iframe,object,embed,link,style,meta').forEach(function (el) {
            el.remove();
        });
        tpl.content.querySelectorAll('*').forEach(function (el) {
            Array.from(el.attributes).forEach(function (attr) {
                const name = attr.name.toLowerCase();
                if (name.indexOf('on') === 0) el.removeAttribute(attr.name);
                else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        return tpl.content;
    }

    // ================================================
    // Addressing — /<slug> and /<slug>/<post>, with query fallbacks
    // ================================================

    function resolveLocation() {
        const params = new URLSearchParams(location.search);
        const match = /^\/([a-z0-9-]{3,40})(?:\/([a-z0-9-]{1,80}))?\/?$/.exec(location.pathname);
        return {
            slug: (match ? match[1] : params.get('site') || params.get('slug') || '').trim().toLowerCase(),
            post: ((match && match[2]) || params.get('post') || '').toLowerCase()
        };
    }

    // ================================================
    // Data
    // ================================================

    async function fetchJSON(url) {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        let body = null;
        try { body = await response.json(); } catch (err) { /* non-JSON error page */ }
        if (!response.ok || !body || body.success !== true) {
            const message = body && body.error ? body.error : 'Request failed';
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return body;
    }

    async function loadBlog() {
        const body = await fetchJSON(`${API}?slug=${encodeURIComponent(state.slug)}`);
        state.site = body.site;
        state.blog = body.blog;
        state.posts = Array.isArray(body.posts) ? body.posts : [];
        return body;
    }

    async function loadArticle(postSlug) {
        if (state.articles.has(postSlug)) return state.articles.get(postSlug);
        const body = await fetchJSON(
            `${API}?slug=${encodeURIComponent(state.slug)}&post=${encodeURIComponent(postSlug)}`);
        const post = body.post;
        post.publishedAt = post.publishedAt || post.updatedAt;
        state.articles.set(postSlug, post);
        return post;
    }

    // ================================================
    // Chrome
    // ================================================

    function setHeader() {
        const blog = state.blog || {};
        const title = blog.title || 'Blog';
        $('blogTitle').textContent = title;
        document.title = title;

        const description = blog.description || '';
        const descriptionEl = $('blogDescription');
        if (description) {
            descriptionEl.textContent = description;
            show(descriptionEl);
        } else {
            hide(descriptionEl);
        }

        const metaDescription = $('metaDescription');
        if (metaDescription) {
            metaDescription.setAttribute('content', description || `${title} — published with Workdeck`);
        }
    }

    function showReader() {
        hide($('blogLoading'));
        hide($('blogError'));
        show($('blogReader'));
    }

    function showError(error) {
        hide($('blogLoading'));
        hide($('blogReader'));
        show($('blogError'));
        if (error && error.status === 404) {
            const standalone = state.mode === 'standalone';
            $('errorTitle').textContent = (state.post || standalone) ? 'Post not found' : 'Blog not found';
            $('errorMessage').textContent = (state.post || standalone)
                ? 'Nothing is published at this address.'
                : "This address doesn't point to a published blog.";
        } else {
            $('errorTitle').textContent = 'Something went wrong';
            $('errorMessage').textContent = (error && error.message) || 'Please try again later.';
        }
    }

    // ================================================
    // Views
    // ================================================

    function formatDate(iso) {
        const date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }

    function renderList() {
        state.post = null;
        hide($('articleView'));
        const list = $('postList');
        list.innerHTML = '';
        show(list);

        if (!state.posts.length) {
            hide(list);
            show($('emptyState'));
            return;
        }

        hide($('emptyState'));
        show(list);
        state.posts.forEach(function (post) {
            const row = clone('wbPostRowTemplate');
            row.href = `/${state.slug}/${post.slug}`;
            row.querySelector('.wb-post-row-title').textContent = post.title || 'Untitled';
            const excerpt = post.excerpt || '';
            const excerptEl = row.querySelector('.wb-post-row-excerpt');
            if (excerpt) excerptEl.textContent = excerpt;
            else excerptEl.remove();
            row.querySelector('.wb-post-row-date').textContent = formatDate(post.publishedAt);
            row.addEventListener('click', function (event) {
                event.preventDefault();
                openPost(post.slug, { push: true });
            });
            list.appendChild(row);
        });
    }

    function renderArticle(post) {
        state.post = post.slug;
        hide($('postList'));
        hide($('emptyState'));
        show($('articleView'));
        $('postTitle').textContent = post.title || 'Untitled';
        $('postDate').textContent = formatDate(post.publishedAt);
        const body = $('postBody');
        body.innerHTML = '';
        body.appendChild(sanitizeFragment(post.html || ''));
        document.title = `${post.title || 'Untitled'} — ${state.blog?.title || 'Blog'}`;
        window.scrollTo(0, 0);
    }

    // Client-side navigation between the list and articles.
    async function openPost(postSlug, options = {}) {
        state.post = postSlug;   // lets the error view speak about posts
        try {
            const post = await loadArticle(postSlug);
            renderArticle(post);
            if (options.push) {
                history.pushState({ post: postSlug }, '', `/${state.slug}/${postSlug}`);
            }
        } catch (error) {
            showError(error);
        }
    }

    function openList(options = {}) {
        renderList();
        if (options.push) {
            history.pushState({ post: null }, '', `/${state.slug}`);
        }
    }

    // ================================================
    // Init
    // ================================================

    function wireChrome() {
        $('backLink').addEventListener('click', function (event) {
            event.preventDefault();
            openList({ push: true });
        });
        $('themeToggle').addEventListener('click', function () {
            if (window.wdThemeManager) window.wdThemeManager.toggleTheme();
        });
        window.addEventListener('popstate', function () {
            if (state.mode === 'standalone') return;   // /<slug> has one view
            const { post } = resolveLocation();
            if (post) openPost(post);
            else openList();
        });
    }

    async function init() {
        if (window.wdThemeManager) window.wdThemeManager.init();
        wireChrome();

        const { slug, post } = resolveLocation();
        if (!slug) {
            showError(new Error('No blog address given.'));
            return;
        }
        state.slug = slug;

        try {
            const body = await loadBlog();
            setHeader();
            showReader();
            if (body.post) {
                // Per-post link: /<slug> IS the article. Title + date sit in
                // the top bar (in place of the blog brand); just the body
                // follows below.
                state.mode = 'standalone';
                document.body.classList.add('wb-standalone');
                body.post.publishedAt = body.post.publishedAt || body.post.updatedAt;
                hide($('backLink'));
                $('blogTitle').textContent = body.post.title || 'Untitled';
                const when = formatDate(body.post.publishedAt);
                const barDate = $('blogDescription');
                if (when) {
                    barDate.textContent = when;
                    show(barDate);
                } else {
                    hide(barDate);
                }
                renderArticle(body.post);
                hide($('postTitle'));   // title + date live in the top bar
                hide($('postDate'));
                document.title = body.post.title || 'Untitled';
                const meta = $('metaDescription');
                if (meta) meta.setAttribute('content', body.post.excerpt || body.post.title || 'Published with Workdeck');
            } else if (post) {
                await openPost(post);
            } else {
                renderList();
            }
        } catch (error) {
            showError(error);
        }
    }

    init();
})();