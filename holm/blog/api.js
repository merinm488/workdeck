// Holm Blog: drafts belong to the verified member. The only public data is
// an explicit, whitelisted article snapshot in app-wide storage. Visitors
// cannot access another member's DS, even when given a post id or old hash.
import { createPostRecord, slugifyTitle, uniquePostSlug, scrubPostHtml, deriveExcerpt } from './posts.js';

export const POSTS = 'blog_posts';
export const PUBLIC = 'blog_public_posts';
const TAGS = 'workspace_tags';
const SETTINGS = 'workdeck_settings';
const MAX_POSTS = 200;
const MAX_HTML = 180_000;
const RESERVED = new Set([
  'api', 'account', 'apps', 'auth', 'blog', 'blog-public', 'calendar', 'css', 'docs',
  'draw', 'files', 'forms', 'home', 'index', 'js', 'kanban', 'login', 'minutes',
  'sheets', 'site', 'slides', 'todo', 'workdeck', 'favicon', 'icons', 'manifest',
  'robots', 'settings', 'landing', 'account', 'home',
]);
export const validSlug = slug => typeof slug === 'string' &&
  /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !RESERVED.has(slug);
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const response = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status) => response({ success: false, error }, status);
const findClaim = (ds, slug) => ds.find(PUBLIC, { slug }, { limit: 1 })[0] || null;
const blogConfig = kv => {
  const blog = kv.get(SETTINGS)?.blog || {};
  return { title: String(blog.title || '').trim() || 'Blog',
    description: String(blog.description || '').trim().slice(0, 300) };
};
const sitePost = post => ({ id: post.id, title: post.title, slug: post.slug,
  excerpt: post.excerpt, publishedAt: post.publishedAt, updatedAt: post.updatedAt, html: post.html });
function ownerData(ds, kv) {
  return { posts: ds.find(POSTS, {}, { limit: MAX_POSTS, order: 'desc' }),
    settings: { theme: 'dark', lastOpened: {}, ...(kv.get(SETTINGS) || {}) },
    tags: ds.find(TAGS, {}, { limit: 200 }) };
}

// Used by /api/site and by the root URL shell. No private record, owner ID,
// tag, or draft is ever returned by this projection.
export function publicArticle(env, slug) {
  if (!validSlug(slug)) return null;
  const row = findClaim(env.holm.app.ds, slug);
  if (!row || row.status !== 'published' || !row.post?.publishedAt) return null;
  return { site: { slug, publishedAt: row.post.publishedAt },
    blog: { title: row.blog.title, description: row.blog.description }, post: row.post };
}

export function refreshPublishedBlogPost(globalDS, memberId, post) {
  if (!post?.publishedAt || !post.slug) return;
  globalDS.transaction(tx => {
    const claim = findClaim(tx, post.slug);
    if (claim?.ownerMemberId === memberId && claim.postId === post.id && claim.status === 'published')
      tx.update(PUBLIC, { id: claim.id }, { $set: { post: sitePost(post) } });
  });
}

export function revokeBlogPost(globalDS, memberId, post) {
  if (!post?.slug) return;
  globalDS.transaction(tx => {
    const claim = findClaim(tx, post.slug);
    if (claim && claim.ownerMemberId === memberId && claim.postId === post.id)
      tx.delete(PUBLIC, { id: claim.id });
  });
}

export async function handleSite(request, env) {
  if (request.method !== 'GET') return fail('This API is read-only.', 405);
  const url = new URL(request.url);
  const article = publicArticle(env, url.searchParams.get('slug'));
  return article ? response({ success: true, ...article }) : fail('Site not found.', 404);
}

export async function handleBlog(request, env) {
  const member = env.holm.auth.getMember();
  if (!member) return fail('Sign in to continue.', 401);
  const { ds, kv } = env.holm.app.member;
  const globalDS = env.holm.app.ds;
  if (request.method === 'GET') return response({ success: true, data: ownerData(ds, kv) });
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  if (raw.length > MAX_HTML + 8000) return fail('Post too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      'hash' in body || 'key' in body || 'memberId' in body ||
      !body.data || typeof body.data !== 'object' || Array.isArray(body.data) ||
      'hash' in body.data || 'key' in body.data || 'memberId' in body.data)
    return fail('Invalid data.', 400);
  const { action, data } = body;
  if (action === 'createPost') {
    if (data.title != null && (typeof data.title !== 'string' || data.title.length > 200) ||
        data.html != null && (typeof data.html !== 'string' || data.html.length > MAX_HTML) ||
        data.tagId != null && (!validId(data.tagId) || !ds.findOne(TAGS, data.tagId))) return fail('Invalid post.', 400);
    const created = ds.transaction(tx => {
      if (tx.count(POSTS, {}) >= MAX_POSTS) return null;
      const post = createPostRecord(null, { title: data.title, html: data.html,
        tagId: data.tagId, posts: tx.find(POSTS, {}, { limit: MAX_POSTS }) });
      const { id: ignored, ...fields } = post;
      const id = tx.insert(POSTS, { ...fields, version: 1 });
      return tx.findOne(POSTS, id);
    });
    return created ? response({ success: true, post: created, data: ownerData(ds, kv) }) : fail('Post limit reached.', 409);
  }
  if (action === 'updatePost') {
    if (!validId(data.id) || data.title !== undefined && (typeof data.title !== 'string' || data.title.length > 200) ||
        data.html !== undefined && (typeof data.html !== 'string' || data.html.length > MAX_HTML) ||
        data.tagId !== undefined && data.tagId !== null && (data.tagId !== '' && (!validId(data.tagId) || !ds.findOne(TAGS, data.tagId))))
      return fail('Invalid post.', 400);
    const updated = ds.transaction(tx => {
      const post = tx.findOne(POSTS, data.id);
      if (!post) return null;
      const patch = { updatedAt: new Date().toISOString(), version: (post.version || 0) + 1 };
      if (data.title !== undefined) {
        patch.title = data.title.trim() || 'Untitled';
        if (!post.publishedAt && !post.path)
          patch.slug = uniquePostSlug(tx.find(POSTS, {}, { limit: MAX_POSTS }), slugifyTitle(patch.title), post.id);
      }
      if (data.html !== undefined) {
        patch.html = scrubPostHtml(data.html);
        patch.excerpt = deriveExcerpt(patch.html);
      }
      if (data.tagId !== undefined) patch.tagId = data.tagId || null;
      tx.update(POSTS, { id: post.id }, { $set: patch });
      return tx.findOne(POSTS, post.id);
    });
    if (!updated) return fail('Post not found.', 404);
    // Only refresh an already-live claim that still belongs to this post.
    // An update racing an unpublish must not turn the URL back on.
    refreshPublishedBlogPost(globalDS, member.id, updated);
    return response({ success: true, data: ownerData(ds, kv) });
  }
  if (action === 'publishPost') {
    if (!validId(data.id) || typeof data.slug !== 'string') return fail('Invalid post.', 400);
    const slug = data.slug.trim().toLowerCase();
    if (!validSlug(slug)) return fail('Use a non-reserved address of 3–40 lowercase letters, digits or hyphens.', 400);
    const previous = ds.findOne(POSTS, data.id);
    if (!previous) return fail('Post not found.', 404);
    if (previous.publishedAt && previous.slug !== slug) return fail('Unpublish before changing the link.', 409);
    // Reserve atomically across all members. The pending claim is not public;
    // if the private write fails, an address may be reserved, never leaked.
    const nonce = crypto.randomUUID();
    const claimed = globalDS.transaction(tx => {
      const existing = findClaim(tx, slug);
      if (existing && (existing.ownerMemberId !== member.id || existing.postId !== previous.id)) return false;
      if (existing) tx.update(PUBLIC, { id: existing.id }, { $set: { status: 'pending', nonce } });
      else tx.insert(PUBLIC, { slug, ownerMemberId: member.id, postId: previous.id, status: 'pending', nonce });
      if (previous.slug && previous.slug !== slug) {
        const old = findClaim(tx, previous.slug);
        if (old && old.ownerMemberId === member.id && old.postId === previous.id)
          tx.delete(PUBLIC, { id: old.id });
      }
      return true;
    });
    if (!claimed) return fail('That address is already taken.', 409);
    const now = new Date().toISOString();
    const updated = ds.transaction(tx => {
      const post = tx.findOne(POSTS, previous.id);
      if (!post) return null;
      tx.update(POSTS, { id: post.id }, { $set: { slug, path: `/${slug}`,
        publishedAt: now, updatedAt: now, version: (post.version || 0) + 1 } });
      return tx.findOne(POSTS, post.id);
    });
    if (!updated) return fail('Post not found.', 404);
    let madePublic = false;
    globalDS.transaction(tx => {
      const claim = findClaim(tx, slug);
      if (claim?.ownerMemberId === member.id && claim.postId === updated.id &&
          claim.status === 'pending' && claim.nonce === nonce) {
        tx.update(PUBLIC, { id: claim.id }, { $set: { status: 'published', nonce: null,
          post: sitePost(updated), blog: blogConfig(kv) } });
        madePublic = true;
      }
    });
    if (!madePublic) return fail('Publication was interrupted. Please try again.', 409);
    return response({ success: true, blog: { postUrl: `${url.origin}/${slug}`, slug,
      path: `/${slug}`, publishedAt: now }, data: ownerData(ds, kv) });
  }
  if (action === 'unpublishPost') {
    if (!validId(data.id)) return fail('Invalid post.', 400);
    const previous = ds.findOne(POSTS, data.id);
    if (!previous) return fail('Post not found.', 404);
    // First revoke the public snapshot. Retain the claim so only this owner
    // can republish at the same link until the post is deleted or moved.
    if (previous.slug) globalDS.transaction(tx => {
      const claim = findClaim(tx, previous.slug);
      if (claim?.ownerMemberId === member.id && claim.postId === previous.id)
        tx.update(PUBLIC, { id: claim.id }, { $set: { status: 'unpublished', post: null, nonce: null } });
    });
    ds.transaction(tx => {
      const post = tx.findOne(POSTS, previous.id);
      if (post) tx.update(POSTS, { id: post.id }, { $set: { publishedAt: null,
        version: (post.version || 0) + 1 } });
    });
    return response({ success: true, data: ownerData(ds, kv) });
  }
  if (action === 'deletePost') {
    if (!validId(data.id)) return fail('Invalid post.', 400);
    const post = ds.findOne(POSTS, data.id);
    if (!post) return fail('Post not found.', 404);
    revokeBlogPost(globalDS, member.id, post);
    ds.delete(POSTS, { id: post.id });
    const prefs = kv.get(SETTINGS) || {};
    if (prefs.lastOpened) { delete prefs.lastOpened[post.id]; kv.set(SETTINGS, prefs); }
    return response({ success: true, data: ownerData(ds, kv) });
  }
  if (action === 'updateBlogSettings') {
    if (data.title !== undefined && (typeof data.title !== 'string' || data.title.length > 200) ||
        data.description !== undefined && (typeof data.description !== 'string' || data.description.length > 300))
      return fail('Invalid blog settings.', 400);
    const prefs = kv.get(SETTINGS) || {};
    const blog = { ...(prefs.blog || {}) };
    if (data.title !== undefined) blog.title = data.title.trim() || 'Blog';
    if (data.description !== undefined) blog.description = data.description.trim();
    kv.set(SETTINGS, { ...prefs, blog });
    const config = blogConfig(kv);
    for (const post of ds.find(POSTS, {}, { limit: MAX_POSTS })) if (post.publishedAt && post.slug)
      globalDS.transaction(tx => {
        const claim = findClaim(tx, post.slug);
        if (claim?.ownerMemberId === member.id && claim.postId === post.id && claim.status === 'published')
          tx.update(PUBLIC, { id: claim.id }, { $set: { blog: config } });
      });
    return response({ success: true, data: ownerData(ds, kv) });
  }
  return fail('Invalid action.', 400);
}
