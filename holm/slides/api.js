// Holm Slides: editable decks belong to the verified member. Only an
// explicit random-token snapshot is readable through the public share route.
const DECKS = 'slide_decks';
const TAGS = 'workspace_tags';
const SHARES = 'slide_public_shares';
const PREFS = 'workdeck_settings';
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const validId = id => typeof id === 'string' && ID.test(id);
const now = () => new Date().toISOString();
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status) => json({ success: false, error }, status);
const publicDeck = deck => ({ id: deck.id, name: deck.name, formatVersion: deck.formatVersion,
  width: deck.width, height: deck.height, slides: deck.slides,
  createdAt: deck.createdAt, updatedAt: deck.updatedAt });
const shareOf = (ds, token) => ds.find(SHARES, { token }, { limit: 1 })[0] || null;
const token = () => {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
};
const view = (ds, kv) => ({ slides: ds.find(DECKS, {}, { limit: 200, order: 'desc' }),
  tags: ds.find(TAGS, {}, { limit: 200, order: 'desc' }),
  settings: { theme: 'dark', ...(kv.get(PREFS) || {}) } });
function validateDeck(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 200) ||
      input.formatVersion !== undefined && input.formatVersion !== 1 ||
      input.width !== undefined && (!Number.isFinite(input.width) || input.width < 100 || input.width > 8192) ||
      input.height !== undefined && (!Number.isFinite(input.height) || input.height < 100 || input.height > 8192) ||
      input.slides !== undefined && (!Array.isArray(input.slides) || !input.slides.length || input.slides.length > 300)) return false;
  if (input.slides) {
    const ids = new Set();
    for (const slide of input.slides) {
      if (!slide || typeof slide !== 'object' || Array.isArray(slide) ||
          typeof slide.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(slide.id) || ids.has(slide.id) ||
          typeof slide.name !== 'string' || slide.name.length > 200 ||
          typeof slide.background !== 'string' || slide.background.length > 100 ||
          !Array.isArray(slide.objects) || slide.objects.length > 2000) return false;
      ids.add(slide.id);
    }
  }
  return true;
}

export async function handleSlides(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/slides') return fail('Not found.', 404);
  const globalDS = env.holm.app.ds;
  if (request.method === 'GET' && url.searchParams.has('shared')) {
    const secret = url.searchParams.get('shared');
    if (!TOKEN.test(secret || '')) return fail('Shared deck not found', 404);
    const copy = shareOf(globalDS, secret);
    return copy ? json({ success: true, deck: publicDeck(copy.deck), sharedAt: copy.sharedAt }) :
      fail('Shared deck not found', 404);
  }
  if (!env.holm.auth.getMember()) return fail('Sign in to continue.', 401);
  const { ds, kv } = env.holm.app.member;
  if (request.method === 'GET') return json({ success: true, data: view(ds, kv) });
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  if (raw.length > 15_000_000) return fail('Deck too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.data ||
      typeof body.data !== 'object' || Array.isArray(body.data) ||
      'hash' in body || 'key' in body || 'memberId' in body) return fail('Invalid request.', 400);
  const { action, data } = body;
  if (action === 'updateSettings') {
    const patch = data.settings;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
        Object.keys(patch).some(k => k !== 'theme') ||
        'theme' in patch && !['light', 'dark', 'system'].includes(patch.theme)) return fail('Invalid settings.', 400);
    kv.set(PREFS, { ...(kv.get(PREFS) || {}), ...patch });
    return json({ success: true, data: view(ds, kv) });
  }
  if (!validId(data.deckId)) return fail('Invalid deck ID.', 400);
  const owned = ds.findOne(DECKS, data.deckId);
  if (!owned) return fail('Deck not found', 404);
  if (!Number.isSafeInteger(data.version) || data.version !== owned.version)
    return fail('Deck changed in another tab. Reload before saving.', 409);
  if (action === 'deleteDeck') {
    if (owned.sharedId) {
      const copy = shareOf(globalDS, owned.sharedId);
      if (copy) globalDS.delete(SHARES, { id: copy.id });
    }
    const removed = ds.transaction(tx => {
      const current = tx.findOne(DECKS, data.deckId);
      if (!current || current.version !== data.version) return false;
      tx.delete(DECKS, { id: data.deckId }); return true;
    });
    if (!removed) return fail('Deck changed in another tab.', 409);
    const prefs = kv.get(PREFS) || {};
    const lastOpened = { ...(prefs.lastOpened || {}) };
    delete lastOpened[data.deckId];
    kv.set(PREFS, { ...prefs, lastOpened });
    return json({ success: true, data: view(ds, kv) });
  }
  if (action === 'shareDeck') {
    if (owned.sharedId) {
      const copy = shareOf(globalDS, owned.sharedId);
      if (!copy) return fail('Shared copy unavailable.', 503);
      globalDS.update(SHARES, { id: copy.id }, { $set: { deck: publicDeck(owned), sharedAt: now() } });
      return json({ success: true, shareId: owned.sharedId,
        shareUrl: `${url.origin}/slides/shared.html?shared=${owned.sharedId}`,
        alreadyShared: true, data: view(ds, kv) });
    }
    const secret = token();
    if (!secret) return fail('Secure sharing is unavailable.', 503);
    const publicId = globalDS.insert(SHARES, { token: secret, deck: publicDeck(owned), sharedAt: now() });
    const stored = ds.transaction(tx => {
      const current = tx.findOne(DECKS, data.deckId);
      if (!current || current.version !== data.version || current.sharedId) return false;
      tx.update(DECKS, { id: data.deckId }, { $set: { sharedId: secret, version: current.version + 1 } });
      return true;
    });
    if (!stored) { globalDS.delete(SHARES, { id: publicId }); return fail('Deck changed in another tab.', 409); }
    return json({ success: true, shareId: secret,
      shareUrl: `${url.origin}/slides/shared.html?shared=${secret}`,
      alreadyShared: false, data: view(ds, kv) });
  }
  if (action !== 'updateDeck' || !validateDeck(data.deckData)) return fail('Invalid deck.', 400);
  const input = data.deckData;
  // Client may send cached metadata (including stale sharedId); only copy
  // the editable fields. Preserve tags, identity, share token and dates.
  const updated = ds.transaction(tx => {
    const current = tx.findOne(DECKS, data.deckId);
    if (!current || current.version !== data.version) return null;
    const patch = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.slides !== undefined ? { slides: input.slides } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      formatVersion: 1, version: current.version + 1, updatedAt: now(),
    };
    tx.update(DECKS, { id: data.deckId }, { $set: patch });
    return { ...current, ...patch };
  });
  if (!updated) return fail('Deck changed in another tab. Reload before saving.', 409);
  if (updated.sharedId) {
    const copy = shareOf(globalDS, updated.sharedId);
    if (!copy) return fail('Could not update public deck. Private edits were saved.', 503);
    globalDS.update(SHARES, { id: copy.id }, { $set: { deck: publicDeck(updated), sharedAt: now() } });
  }
  return json({ success: true, data: view(ds, kv) });
}
