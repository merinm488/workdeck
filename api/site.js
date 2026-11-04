/**
 * ================================================
 * SITE - Public blog API
 * ================================================
 *
 * Serves posts published from the Blog app (see the publishPost action in
 * api/blog.js). A slug resolves to the owning account through a
 * pepper-HMAC'd pointer record, so the account hash — which IS the write
 * credential on textdb — never appears in any public page, URL or
 * response. There are deliberately NO write methods: everything except
 * GET answers 405.
 *
 *   GET ?slug=<post-slug>         -> { site, blog, post } (a per-post
 *                                    pointer: /<slug> IS the article)
 *   GET ?slug=<address>           -> { site, blog, posts } (legacy blog
 *                                    home: published posts only, newest
 *                                    first, sans html)
 *   GET ?slug=<address>&post=<slug> -> { ..., post } (legacy article)
 *
 * Publishing is per post in the Blog app: post.publishedAt set = public,
 * null = private. The projection is a whitelist: only blog settings
 * (title/description) and published posts leave the account. Tags,
 * responses and every other app section never leave the server. Post HTML
 * was scrubbed at save time (api/_lib/posts.js); the reader sanitizes
 * again client-side.
 *
 * Reads are edge-cacheable: visitors mostly hit the Vercel cache, so
 * textdb is contacted at most once per minute per URL.
 */

import {
  getSitePointer,
  getUserDoc,
  isValidSiteSlug,
  applyCorsHeaders
} from './_lib/store.js';

/** Public post: everything except the body (the list stays light). */
function publicPostMeta(post) {
  return {
    id: post.id,
    title: post.title || 'Untitled',
    slug: post.slug,
    excerpt: post.excerpt || '',
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt
  };
}

/** Public post with body — served one at a time for the article view. */
function publicPost(post) {
  return { ...publicPostMeta(post), html: post.html || '' };
}

/** Newest first by publish date. */
function byNewest(a, b) {
  return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
}

export default async function handler(req, res) {
  applyCorsHeaders(req, res);

  // Public data: let the CDN serve repeat visits (api-wide no-store from
  // applyCorsHeaders is replaced here for this read-only route).
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'This API is read-only' });
  }

  try {
    const { slug, post: postSlug } = req.query;

    if (!isValidSiteSlug(slug)) {
      return res.status(400).json({ success: false, error: 'slug is required' });
    }

    const pointer = await getSitePointer(slug);
    const userData = pointer ? await getUserDoc(pointer.hash) : null;
    if (!pointer || !userData) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    const site = { slug: pointer.slug, publishedAt: pointer.publishedAt };
    const blog = {
      title: (userData.settings?.blog?.title || '').trim() || 'Blog',
      description: (userData.settings?.blog?.description || '').trim()
    };

    // --- Standalone post (per-post pointer): /<slug> IS the article ---
    if (pointer.postId) {
      const post = userData.posts.find(p => p && p.id === pointer.postId && p.publishedAt);
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }
      return res.status(200).json({ success: true, site, blog, post: publicPost(post) });
    }

    // --- One article under a legacy blog address (must be published) ---
    if (postSlug) {
      const post = userData.posts.find(p => p && p.slug === postSlug && p.publishedAt);
      if (!post) {
        return res.status(404).json({ success: false, error: 'Post not found' });
      }
      return res.status(200).json({ success: true, site, blog, post: publicPost(post) });
    }

    // --- Legacy blog home: published posts only, newest first, sans html ---
    const posts = userData.posts
      .filter(p => p && p.slug && p.publishedAt)
      .sort(byNewest)
      .map(publicPostMeta);

    return res.status(200).json({ success: true, site, blog, posts });
  } catch (error) {
    console.error('[SITE API] Error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}