// Holm Draw: infinite-canvas drawings are private to the verified member.
// Only explicitly shared, unguessable-token snapshots live in app-wide DS.
const DRAWINGS = 'canvas_drawings';
const TAGS = 'workspace_tags';
const SHARES = 'drawing_public_shares';
const PREFS = 'workdeck_settings';
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const validId = value => typeof value === 'string' && ID.test(value);
const now = () => new Date().toISOString();
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status) => json({ success: false, error }, status);
const publicDrawing = drawing => ({ id: drawing.id, name: drawing.name,
  formatVersion: drawing.formatVersion, background: drawing.background,
  objects: drawing.objects, viewport: drawing.viewport,
  createdAt: drawing.createdAt, updatedAt: drawing.updatedAt });
const shareOf = (ds, token) => ds.find(SHARES, { token }, { limit: 1 })[0] || null;
const token = () => {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const view = (ds, kv) => ({ draws: ds.find(DRAWINGS, {}, { limit: 200, order: 'desc' }),
  tags: ds.find(TAGS, {}, { limit: 200, order: 'desc' }),
  settings: { theme: 'dark', ...(kv.get(PREFS) || {}) } });
function validDrawing(input) {
  return input && typeof input === 'object' && !Array.isArray(input) &&
    (input.name === undefined || typeof input.name === 'string' && !!input.name.trim() && input.name.trim().length <= 200) &&
    (input.formatVersion === undefined || input.formatVersion === 1) &&
    (input.background === undefined || typeof input.background === 'string' && input.background.length <= 100) &&
    (input.objects === undefined || Array.isArray(input.objects) && input.objects.length <= 8000 &&
      input.objects.every(object => object && typeof object === 'object' && !Array.isArray(object))) &&
    (input.viewport === undefined || input.viewport && typeof input.viewport === 'object' &&
      !Array.isArray(input.viewport) &&
      Number.isFinite(input.viewport.zoom) && input.viewport.zoom >= 0.05 && input.viewport.zoom <= 8 &&
      Number.isFinite(input.viewport.panX) && Number.isFinite(input.viewport.panY) &&
      Math.abs(input.viewport.panX) <= 1e9 && Math.abs(input.viewport.panY) <= 1e9);
}

export async function handleDraw(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/draw') return fail('Not found.', 404);
  const globalDS = env.holm.app.ds;
  if (request.method === 'GET' && url.searchParams.has('shared')) {
    const secret = url.searchParams.get('shared');
    if (!TOKEN.test(secret || '')) return fail('Shared drawing not found', 404);
    const copy = shareOf(globalDS, secret);
    return copy ? json({ success: true, drawing: publicDrawing(copy.drawing), sharedAt: copy.sharedAt }) :
      fail('Shared drawing not found', 404);
  }
  if (!env.holm.auth.getMember()) return fail('Sign in to continue.', 401);
  const { ds, kv } = env.holm.app.member;
  if (request.method === 'GET') return json({ success: true, data: view(ds, kv) });
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  if (raw.length > 15_000_000) return fail('Drawing too large.', 413);
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
  if (!validId(data.drawingId)) return fail('Invalid drawing ID.', 400);
  const owned = ds.findOne(DRAWINGS, data.drawingId);
  if (!owned) return fail('Drawing not found', 404);
  if (!Number.isSafeInteger(data.version) || data.version !== owned.version)
    return fail('Drawing changed in another tab. Reload before saving.', 409);
  if (action === 'deleteDrawing') {
    if (owned.sharedId) {
      const copy = shareOf(globalDS, owned.sharedId);
      if (copy) globalDS.delete(SHARES, { id: copy.id });
    }
    const removed = ds.transaction(tx => {
      const current = tx.findOne(DRAWINGS, data.drawingId);
      if (!current || current.version !== data.version) return false;
      tx.delete(DRAWINGS, { id: data.drawingId }); return true;
    });
    if (!removed) return fail('Drawing changed in another tab.', 409);
    const prefs = kv.get(PREFS) || {};
    const lastOpened = { ...(prefs.lastOpened || {}) };
    delete lastOpened[data.drawingId];
    kv.set(PREFS, { ...prefs, lastOpened });
    return json({ success: true, data: view(ds, kv) });
  }
  if (action === 'shareDrawing') {
    if (owned.sharedId) {
      const copy = shareOf(globalDS, owned.sharedId);
      if (!copy) return fail('Shared copy unavailable.', 503);
      globalDS.update(SHARES, { id: copy.id }, { $set: { drawing: publicDrawing(owned), sharedAt: now() } });
      return json({ success: true, shareId: owned.sharedId,
        shareUrl: `${url.origin}/draw/shared.html?shared=${owned.sharedId}`,
        alreadyShared: true, data: view(ds, kv) });
    }
    const secret = token();
    if (!secret) return fail('Secure sharing is unavailable.', 503);
    const publicId = globalDS.insert(SHARES, { token: secret, drawing: publicDrawing(owned), sharedAt: now() });
    const stored = ds.transaction(tx => {
      const current = tx.findOne(DRAWINGS, data.drawingId);
      if (!current || current.version !== data.version || current.sharedId) return false;
      tx.update(DRAWINGS, { id: data.drawingId }, { $set: { sharedId: secret, version: current.version + 1 } });
      return true;
    });
    if (!stored) { globalDS.delete(SHARES, { id: publicId }); return fail('Drawing changed in another tab.', 409); }
    return json({ success: true, shareId: secret,
      shareUrl: `${url.origin}/draw/shared.html?shared=${secret}`,
      alreadyShared: false, data: view(ds, kv) });
  }
  if (action !== 'updateDrawing' || !validDrawing(data.drawingData)) return fail('Invalid drawing.', 400);
  const input = data.drawingData;
  // Only editable fields are accepted. Cached sharedId, tagId, owner hints,
  // IDs and timestamps in the Fabric client cannot change ownership.
  const updated = ds.transaction(tx => {
    const current = tx.findOne(DRAWINGS, data.drawingId);
    if (!current || current.version !== data.version) return null;
    const patch = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.objects !== undefined ? { objects: input.objects } : {}),
      ...(input.background !== undefined ? { background: input.background } : {}),
      ...(input.viewport !== undefined ? { viewport: input.viewport } : {}),
      formatVersion: 1, version: current.version + 1, updatedAt: now(),
    };
    tx.update(DRAWINGS, { id: data.drawingId }, { $set: patch });
    return { ...current, ...patch };
  });
  if (!updated) return fail('Drawing changed in another tab. Reload before saving.', 409);
  if (updated.sharedId) {
    const copy = shareOf(globalDS, updated.sharedId);
    if (!copy) return fail('Could not update public drawing. Private edits were saved.', 503);
    globalDS.update(SHARES, { id: copy.id }, { $set: { drawing: publicDrawing(updated), sharedAt: now() } });
  }
  return json({ success: true, data: view(ds, kv) });
}
