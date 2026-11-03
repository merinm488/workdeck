/**
 * ================================================
 * BLOG - Public read-only site API
 * ================================================
 *
 * Serves a published site (see the publishSite action in api/workdeck.js)
 * at /<slug>. The slug resolves to the owning account through a
 * pepper-HMAC'd pointer record, so the account hash — which IS the write
 * credential on textdb — never appears in any public page, URL or
 * response. There are deliberately NO write methods: everything except
 * GET answers 405.
 *
 *   GET ?slug=<slug>            -> { site, docs, tags, sheets, forms, slides }
 *   GET ?slug=<slug>&sheet=<id> -> { sheetId, data }  (Univer workbook body)
 *
 * The projection is a whitelist. Never included: settings, lastOpened,
 * form responses, form<->sheet links, Filebox files/folders/bytes, todo,
 * calendars, events, kanban and draws. Archived docs are treated as
 * "not public" — archiving is the owner's per-doc opt-out.
 *
 * Reads are edge-cacheable: visitors mostly hit the Vercel cache, so
 * textdb is contacted at most once per minute per URL.
 */

import {
  getSitePointer,
  getUserDoc,
  getSheetBody,
  isValidSiteSlug,
  applyCorsHeaders
} from './_lib/store.js';

/** Public doc record: content fields only. */
function publicDoc(doc) {
  return {
    id: doc.id,
    title: doc.title || 'Untitled',
    content: doc.content || '',
    contentType: doc.contentType || 'plain-text',
    tagId: doc.tagId || null,
    pinned: Boolean(doc.pinned),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

/** Public sheet record: metadata only — workbooks load per-sheet. */
function publicSheet(sheet) {
  return {
    id: sheet.id,
    name: sheet.name || 'Untitled Sheet',
    tagId: sheet.tagId || null,
    createdAt: sheet.createdAt,
    updatedAt: sheet.updatedAt
  };
}

/** Public form record: questions only — responses and the linked
 *  spreadsheet stay private (same contract as the shared-form GET). */
function publicForm(form) {
  return {
    id: form.id,
    name: form.name || 'Untitled Form',
    display: form.display || 'form',
    components: Array.isArray(form.components) ? form.components : [],
    tagId: form.tagId || null,
    sharedId: form.sharedId || null,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt
  };
}

/** Public deck record: the deck IS the content; sharedId lets the site
 *  embed the existing slides share viewer. */
function publicDeck(deck) {
  return {
    id: deck.id,
    name: deck.name || 'Untitled',
    formatVersion: deck.formatVersion || 1,
    width: deck.width,
    height: deck.height,
    slides: Array.isArray(deck.slides) ? deck.slides : [],
    sharedId: deck.sharedId || null,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt
  };
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
    const { slug, sheet } = req.query;

    if (!isValidSiteSlug(slug)) {
      return res.status(400).json({ success: false, error: 'slug is required' });
    }

    const pointer = await getSitePointer(slug);
    const userData = pointer ? await getUserDoc(pointer.hash) : null;
    if (!pointer || !userData) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    // --- Workbook body for one sheet (must belong to this account) ---
    if (sheet) {
      if (!userData.sheets.some(s => s.id === sheet)) {
        return res.status(404).json({ success: false, error: 'Sheet not found' });
      }
      const body = await getSheetBody(sheet);
      if (!body) {
        return res.status(404).json({ success: false, error: 'Sheet not found' });
      }
      return res.status(200).json({ success: true, sheetId: sheet, data: body });
    }

    // --- Site projection ---
    return res.status(200).json({
      success: true,
      site: {
        slug: pointer.slug,
        title: pointer.title || null,
        publishedAt: pointer.publishedAt
      },
      docs: userData.docs.filter(d => d && !d.archived).map(publicDoc),
      tags: userData.tags.map(t => ({ id: t.id, name: t.name, color: t.color })),
      sheets: userData.sheets.map(publicSheet),
      forms: userData.forms.map(publicForm),
      slides: userData.slides.map(publicDeck)
    });
  } catch (error) {
    console.error('[BLOG API] Error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}
