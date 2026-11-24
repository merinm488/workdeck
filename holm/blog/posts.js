/**
 * Shared Blog post helpers, used by both api/workdeck.js (the launcher's
 * createPost) and api/blog.js (the Blog app's CRUD). Post bodies are Quill
 * HTML stored inline on the record; the server scrubs them on every save
 * (same threat list as the client's sanitizeFragment) so the public site
 * never serves anything the owner didn't author through the editor.
 */

const POST_SLUG_MAX = 80;
const DEFAULT_TITLE = 'Untitled';

/** Lowercase [a-z0-9-] slug from a title; 'post' when nothing survives. */
export function slugifyTitle(title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, POST_SLUG_MAX)
    .replace(/-$/g, '');
  return slug || 'post';
}

/** First free `slug` (then -2, -3, …) among the account's posts. */
export function uniquePostSlug(posts, slug, ignoreId = null) {
  if (!posts.some(p => p && p.slug === slug && p.id !== ignoreId)) return slug;
  let n = 2;
  while (posts.some(p => p && p.slug === `${slug}-${n}` && p.id !== ignoreId)) n += 1;
  return `${slug}-${n}`;
}

/** Plain-text first `max` chars of a (already scrubbed) post body. */
export function deriveExcerpt(html, max = 160) {
  const text = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/**
 * Blacklist scrub for owner-authored Quill HTML — the server-side twin of
 * sanitizeFragment() in public/js/previews.js: script/style bodies removed,
 * dangerous tags stripped, on* handlers and javascript: URLs dropped.
 * The public reader runs sanitizeFragment again as defense in depth.
 */
export function scrubPostHtml(html) {
  let out = String(html || '');
  out = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  out = out.replace(/<\/?(?:script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '');
  out = out.replace(/\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/(\s(?:href|src)\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, lead, value) => {
    const bare = value.replace(/^["']|["']$/g, '');
    return /^\s*javascript:/i.test(bare) ? '' : match;
  });
  return out;
}

/** Normalized post record (launcher "New post" and the Blog app). */
export function createPostRecord(id, data = {}) {
  const now = new Date().toISOString();
  const title = String(data.title || '').trim() || DEFAULT_TITLE;
  const html = scrubPostHtml(data.html || '');
  return {
    id,
    title,
    slug: uniquePostSlug(data.posts || [], slugifyTitle(title)),
    html,
    excerpt: deriveExcerpt(html),
    tagId: data.tagId || null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now
  };
}