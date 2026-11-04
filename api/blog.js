/**
 * ================================================
 * BLOG - Unified User API
 * ================================================
 *
 * The unified user document gains a `posts` array of blog post records and
 * a settings.blog object:
 *
 *   post:    { id, title, slug, html, excerpt, tagId,
 *              publishedAt, createdAt, updatedAt }
 *   settings.blog: { title, description,
 *                    address: { slug, publishedAt } | null }
 *
 * html is Quill output scrubbed on every save (api/_lib/posts.js) — the
 * owner is the only writer, but scrubbing keeps the public site inert.
 * Publishing is per post and the author picks the post's public link in
 * the publish modal: publishedAt set = public at /<slug> (also mirrored
 * to post.path), null = private. The chosen slug is checked against the
 * global pointer registry — every published post occupies its own root
 * path across all accounts — and stored as a pepper-HMAC'd pointer
 * record (getSitePointer) pointing at this account's hash; the public
 * reader resolves it through /api/site. Unpublishing or deleting the
 * post frees the slug again. Posts published before per-post links keep
 * living under the blog's claimed address (settings.blog.address) and
 * its single pointer. There is exactly one blog per account.
 *
 * (settings.blog.publish — the old blog-level publish — is still read as
 * an alias for address so existing docs need no migration.)
 *
 * (This file previously hosted the whole-account public site API — that
 * feature moved to /api/site as the blog-only reader endpoint.)
 */

import {
  generateHash,
  generateId,
  getUserDoc,
  saveOwnedSections,
  createUserDoc,
  deleteUserDoc,
  applyCorsHeaders,
  accountHash,
  getBaseUrl,
  getSitePointer,
  putSitePointer,
  deleteSitePointer,
  isValidSiteSlug,
  isReservedSiteSlug
} from './_lib/store.js';
import {
  slugifyTitle,
  uniquePostSlug,
  deriveExcerpt,
  scrubPostHtml,
  createPostRecord
} from './_lib/posts.js';

const DEFAULT_TITLE = 'Untitled';
const DEFAULT_BLOG_TITLE = 'Blog';

/** Persist only the sections Blog owns (posts) + settings changes. */
async function saveBlogSections(hash, userData) {
  return saveOwnedSections(hash, {
    posts: userData.posts,
    settings: userData.settings
  });
}

function blogSettings(userData) {
  const blog = userData.settings.blog && typeof userData.settings.blog === 'object'
    ? userData.settings.blog
    : {};
  return {
    title: String(blog.title || '').trim() || DEFAULT_BLOG_TITLE,
    description: String(blog.description || '').trim(),
    // Old docs carry the claim under `publish`; `address` is its new name.
    address: blog.address
      || (blog.publish ? { slug: blog.publish.slug, publishedAt: blog.publish.publishedAt } : null)
  };
}

// ================================================
// Handler
// ================================================

export default async function handler(req, res) {
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // ============================================================
    // GET - user data (session check / initial load)
    // ============================================================
    if (req.method === 'GET') {
      const hash = accountHash(req.query);

      if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash is required' });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      return res.status(200).json({ success: true, data: userData });
    }

    // ============================================================
    // POST - login / create account
    // ============================================================
    if (req.method === 'POST') {
      const { key, action } = req.body || {};

      if (!key || typeof key !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid key format' });
      }

      const normalizedKey = key.trim();
      if (normalizedKey === '') {
        return res.status(400).json({ success: false, error: 'Key cannot be empty' });
      }

      const hash = generateHash(normalizedKey);

      if (action === 'login') {
        const userData = await getUserDoc(hash);
        if (!userData) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        return res.status(200).json({ success: true, hash, data: userData });
      }

      if (action === 'create') {
        const result = await createUserDoc(hash, { theme: 'dark' });
        if (!result.ok) {
          if (result.code === 'USER_EXISTS') {
            return res.status(409).json({ success: false, error: 'User already exists' });
          }
          return res.status(500).json({ success: false, error: 'Failed to create account' });
        }
        return res.status(201).json({ success: true, hash, data: result.doc });
      }

      return res.status(400).json({ success: false, error: 'Invalid action. Use "login" or "create"' });
    }

    // ============================================================
    // PUT - owner operations on the unified document
    // ============================================================
    if (req.method === 'PUT') {
      const { action, data } = req.body || {};
      const hash = accountHash(req.body);

      if (!hash || !action) {
        return res.status(400).json({ success: false, error: 'Hash and action are required' });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // CREATE POST — new draft (server-generated id, newest first).
      if (action === 'createPost') {
        let id = data?.id || generateId();
        while (userData.posts.some(p => p && p.id === id)) {
          id = generateId();
        }

        const post = createPostRecord(id, { ...data, posts: userData.posts });
        userData.posts.unshift(post);

        const saved = await saveBlogSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to create post' });
        }
        return res.status(200).json({ success: true, post, data: userData });
      }

      // UPDATE POST — the editor saves the whole body after every change.
      // html is scrubbed; title edits re-slug only while that post is
      // unpublished, so its live URL stays stable; the excerpt is re-derived.
      if (action === 'updatePost') {
        const { id } = data || {};
        const target = userData.posts.find(p => p && p.id === id);
        if (!target) {
          return res.status(404).json({ success: false, error: 'Post not found' });
        }

        if (data.title !== undefined) {
          target.title = String(data.title).trim() || DEFAULT_TITLE;
          if (!target.publishedAt) {
            target.slug = uniquePostSlug(userData.posts, slugifyTitle(target.title), target.id);
          }
        }
        if (data.html !== undefined) {
          target.html = scrubPostHtml(data.html);
          target.excerpt = deriveExcerpt(target.html);
        }
        if (data.tagId !== undefined) {
          target.tagId = data.tagId || null;
        }
        target.updatedAt = new Date().toISOString();

        const saved = await saveBlogSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update post' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // DELETE POST. Frees the post's public slug with it.
      if (action === 'deletePost') {
        const { id } = data || {};
        if (!id) {
          return res.status(400).json({ success: false, error: 'id is required' });
        }

        const doomed = userData.posts.find(p => p && p.id === id);
        if (doomed && doomed.slug) {
          const pointer = await getSitePointer(doomed.slug);
          if (pointer && pointer.hash === hash && pointer.postId === id) {
            await deleteSitePointer(doomed.slug);
          }
        }

        userData.posts = userData.posts.filter(p => p && p.id !== id);
        if (userData.settings?.lastOpened) {
          delete userData.settings.lastOpened[id];
        }

        const saved = await saveBlogSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to delete post' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // BLOG SETTINGS — title/description of the blog itself; the claimed
      // address is carried through untouched.
      if (action === 'updateBlogSettings') {
        const blog = blogSettings(userData);
        if (data?.title !== undefined) blog.title = String(data.title).trim() || DEFAULT_BLOG_TITLE;
        if (data?.description !== undefined) blog.description = String(data.description).trim().slice(0, 300);
        userData.settings.blog = blog;

        const saved = await saveBlogSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update blog settings' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // PUBLISH POST — make this one post public at /<slug>, the link the
      // author picks in the publish modal. Unique across all accounts via
      // the pointer registry; freed again by unpublish/delete.
      if (action === 'publishPost') {
        const target = userData.posts.find(p => p && p.id === data?.id);
        if (!target) {
          return res.status(404).json({ success: false, error: 'Post not found' });
        }

        const slug = String(data?.slug || '').trim().toLowerCase();
        if (!isValidSiteSlug(slug)) {
          return res.status(400).json({ success: false, error: 'Use 3-40 lowercase letters, digits or hyphens' });
        }
        if (isReservedSiteSlug(slug)) {
          return res.status(400).json({ success: false, error: 'That address is reserved' });
        }
        const existing = await getSitePointer(slug);
        if (existing && (existing.hash !== hash || existing.postId !== target.id)) {
          return res.status(409).json({ success: false, error: 'That address is already taken' });
        }

        const now = new Date().toISOString();
        if (!(await putSitePointer(slug, { hash, slug, postId: target.id, title: target.title || null, publishedAt: now }))) {
          return res.status(500).json({ success: false, error: 'Failed to publish post' });
        }

        target.slug = slug;
        target.path = `/${slug}`;
        target.publishedAt = now;

        const saved = await saveBlogSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to publish post' });
        }
        return res.status(200).json({
          success: true,
          blog: { postUrl: `${getBaseUrl(req)}${target.path}`, slug: target.slug, path: target.path, publishedAt: target.publishedAt },
          data: userData
        });
      }

      // UNPUBLISH POST — take one post offline. Frees its public slug
      // (per-post pointers only; the legacy address pointer stays).
      if (action === 'unpublishPost') {
        const target = userData.posts.find(p => p && p.id === data?.id);
        if (!target) {
          return res.status(404).json({ success: false, error: 'Post not found' });
        }
        if (target.publishedAt && target.slug) {
          const pointer = await getSitePointer(target.slug);
          if (pointer && pointer.hash === hash && pointer.postId === target.id) {
            await deleteSitePointer(target.slug);
          }
        }
        target.publishedAt = null;

        const saved = await saveBlogSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to unpublish post' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // UPDATE SETTINGS (theme, etc.)
      if (action === 'updateSettings') {
        if (!data?.settings || typeof data.settings !== 'object') {
          return res.status(400).json({ success: false, error: 'settings object is required' });
        }
        userData.settings = { ...userData.settings, ...data.settings };

        const saved = await saveBlogSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update settings' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    // ============================================================
    // DELETE - delete account (clears the unified document)
    // ============================================================
    if (req.method === 'DELETE') {
      const hash = accountHash(req.query);

      if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash is required' });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // Taking the account down takes its published posts with it.
      const addressSlug = userData.settings?.blog?.address?.slug || userData.settings?.blog?.publish?.slug;
      if (addressSlug) {
        await deleteSitePointer(addressSlug);
      }
      for (const post of userData.posts || []) {
        if (!post || !post.slug) continue;
        const pointer = await getSitePointer(post.slug);
        if (pointer && pointer.hash === hash && pointer.postId === post.id) {
          await deleteSitePointer(post.slug);
        }
      }

      const deleted = await deleteUserDoc(hash);
      if (!deleted) {
        return res.status(500).json({ success: false, error: 'Failed to delete account' });
      }

      return res.status(200).json({ success: true, message: 'Account deleted' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[BLOG API] Error:', error);
    return res.status(500).json({ success: false, error: 'Server error', message: error.message });
  }
}