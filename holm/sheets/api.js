// Holm Sheets: workbook bodies, metadata and thumbnails live only in the
// current verified member's DS. Explicit public snapshots have random tokens
// in the app-wide DS. No client hash/key can select a storage realm.
const SHEETS = 'sheet_records';
const BODIES = 'sheet_bodies';
const THUMBS = 'sheet_thumbs';
const FILES = 'file_records';
const FILE_THUMBS = 'file_thumbs';
const SHARES = 'sheet_public_shares';
const TAGS = 'workspace_tags';
const SETTINGS = 'workdeck_settings';
const MAX_SHEETS = 200;
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const validId = value => typeof value === 'string' && ID.test(value);
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status) => json({ success: false, error }, status);
const now = () => new Date().toISOString();
const getRow = (ds, collection, sheetId) => ds.find(collection, { sheetId }, { limit: 1 })[0] || null;
const shared = (ds, token) => ds.find(SHARES, { token }, { limit: 1 })[0] || null;
function token() {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function defaultWorkbook(id) {
  const tab = `sheet-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { id: `wb_${id}`, name: 'Untitled Sheet', appVersion: '0.25.1', locale: 'enUS',
    styles: {}, sheetOrder: [tab], sheets: { [tab]: {
      id: tab, name: 'Sheet1', tabColor: '', hidden: 0,
      freeze: { xOffset: 0, yOffset: 0, startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
      rowCount: 84, columnCount: 60, zoomRatio: 1, scrollTop: 0, scrollLeft: 0,
      defaultColumnWidth: 73, defaultRowHeight: 19, mergeData: [], cellData: {}, rowData: {}, columnData: {},
    } } };
}
export function createSheet(tx, tagId = null) {
  if (tx.count(SHEETS, {}) >= MAX_SHEETS) return null;
  const stamp = now();
  const record = { name: 'Untitled Sheet', formatVersion: 2, tagId,
    version: 1, createdAt: stamp, updatedAt: stamp };
  const id = tx.insert(SHEETS, record);
  const bodyId = tx.insert(BODIES, { sheetId: id, data: defaultWorkbook(id) });
  if (!bodyId) throw new Error('Workbook creation failed');
  return { id, ...record };
}
function sheetView(ds, kv) {
  return { sheets: ds.find(SHEETS, {}, { limit: MAX_SHEETS, order: 'desc' }),
    tags: ds.find(TAGS, {}, { limit: 200, order: 'desc' }),
    settings: { theme: 'dark', ...(kv.get(SETTINGS) || {}) } };
}
function publicSheet(record, workbook) {
  return { id: record.id, name: record.name, formatVersion: record.formatVersion || 2,
    createdAt: record.createdAt, updatedAt: record.updatedAt, data: workbook };
}
function checkWorkbook(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  // Preserve the complete Univer workbook structure; check the stable root
  // only. Engine-owned styles, sheets, formulas, merges, filters, etc. roundtrip.
  return typeof value.id === 'string' && value.id.length <= 150 &&
    value.sheets && typeof value.sheets === 'object' && !Array.isArray(value.sheets) &&
    Object.keys(value.sheets).length <= 100;
}
function viewThumb(ds, record) {
  return record?.thumbnail || getRow(ds, THUMBS, record.id)?.image || null;
}
export async function handleSheets(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/users') return fail('Not found.', 404);
  const publicDS = env.holm.app.ds;
  if (request.method === 'GET' && url.searchParams.has('shared')) {
    const secret = url.searchParams.get('shared');
    if (!TOKEN.test(secret || '')) return fail('Shared sheet not found', 404);
    const row = shared(publicDS, secret);
    return row ? json({ success: true, sheet: row.sheet, sharedAt: row.sharedAt }) : fail('Shared sheet not found', 404);
  }
  if (!env.holm.auth.getMember()) return fail('Sign in to continue.', 401);
  const { ds, kv } = env.holm.app.member;
  if (request.method === 'GET') {
    const sheetId = url.searchParams.get('sheet');
    const thumbs = url.searchParams.get('thumbs');
    if (sheetId) {
      const record = validId(sheetId) && ds.findOne(SHEETS, sheetId);
      if (!record) return fail('Sheet not found', 404);
      return json({ success: true, data: getRow(ds, BODIES, sheetId)?.data || null });
    }
    if (thumbs) {
      const thumbnails = {};
      for (const id of [...new Set(thumbs.split(',').slice(0, 40))]) {
        if (!validId(id)) continue;
        const record = ds.findOne(SHEETS, id);
        if (record) thumbnails[id] = viewThumb(ds, record);
        else {
          const file = ds.findOne(FILES, id);
          if (file) thumbnails[id] = file.thumbnail || ds.find(FILE_THUMBS, { fileId: id }, { limit: 1 })[0]?.image || null;
        }
      }
      return json({ success: true, thumbnails });
    }
    return json({ success: true, data: sheetView(ds, kv) });
  }
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  if (raw.length > 16_000_000) return fail('Workbook too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.data ||
      typeof body.data !== 'object' || Array.isArray(body.data) ||
      'hash' in body || 'key' in body || 'memberId' in body) return fail('Invalid request.', 400);
  const { action, data } = body;
  if (action === 'updateSettings') {
    const patch = data.settings;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
        Object.keys(patch).some(key => key !== 'theme') ||
        ('theme' in patch && !['dark', 'light', 'system'].includes(patch.theme))) return fail('Invalid settings.', 400);
    kv.set(SETTINGS, { ...(kv.get(SETTINGS) || {}), ...patch });
    return json({ success: true, data: sheetView(ds, kv) });
  }
  if (action === 'createSheet') {
    const record = ds.transaction(tx => createSheet(tx));
    return record ? json({ success: true, sheet: record, data: sheetView(ds, kv) }) : fail('Sheet limit reached.', 409);
  }
  if (!validId(data.sheetId) || !Number.isSafeInteger(data.version) || data.version < 1)
    return fail('Invalid sheet ID or version.', 400);
  const owned = ds.findOne(SHEETS, data.sheetId);
  if (!owned) return fail('Sheet not found', 404);
  if (owned.version !== data.version) return fail('Sheet changed in another tab. Reload before saving.', 409);
  if (action === 'shareSheet') {
    const workbook = getRow(ds, BODIES, data.sheetId)?.data;
    if (!workbook) return fail('Workbook not found.', 404);
    if (owned.sharedId) {
      const row = shared(publicDS, owned.sharedId);
      if (!row) return fail('Shared copy unavailable.', 503);
      publicDS.update(SHARES, { id: row.id }, { $set: { sheet: publicSheet(owned, workbook), sharedAt: now() } });
      return json({ success: true, shareId: owned.sharedId,
        shareUrl: `${url.origin}/sheets/shared.html?shared=${owned.sharedId}`,
        alreadyShared: true, version: owned.version, data: sheetView(ds, kv) });
    }
    const secret = token();
    if (!secret) return fail('Secure sharing is unavailable.', 503);
    const sharedAt = now();
    const publicId = publicDS.insert(SHARES, { token: secret, sheet: publicSheet(owned, workbook), sharedAt });
    const ok = ds.transaction(tx => {
      const current = tx.findOne(SHEETS, data.sheetId);
      if (!current || current.version !== data.version || current.sharedId) return false;
      tx.update(SHEETS, { id: data.sheetId }, { $set: { sharedId: secret, version: current.version + 1 } });
      return true;
    });
    if (!ok) { publicDS.delete(SHARES, { id: publicId }); return fail('Sheet changed in another tab.', 409); }
    return json({ success: true, shareId: secret,
      shareUrl: `${url.origin}/sheets/shared.html?shared=${secret}`,
      alreadyShared: false, version: owned.version + 1, data: sheetView(ds, kv) });
  }
  if (action === 'deleteSheet') {
    // Revoke public access before touching the owner record; a failed member
    // transaction leaves a private sheet but never an orphaned public copy.
    if (owned.sharedId) {
      const row = shared(publicDS, owned.sharedId);
      if (row) publicDS.delete(SHARES, { id: row.id });
    }
    const removed = ds.transaction(tx => {
      const current = tx.findOne(SHEETS, data.sheetId);
      if (!current || current.version !== data.version) return false;
      const workbook = getRow(tx, BODIES, data.sheetId);
      const thumb = getRow(tx, THUMBS, data.sheetId);
      if (workbook) tx.delete(BODIES, { id: workbook.id });
      if (thumb) tx.delete(THUMBS, { id: thumb.id });
      tx.delete(SHEETS, { id: data.sheetId });
      return true;
    });
    if (!removed) return fail('Sheet changed in another tab.', 409);
    const prefs = kv.get(SETTINGS) || {};
    const lastOpened = { ...(prefs.lastOpened || {}) };
    delete lastOpened[data.sheetId];
    kv.set(SETTINGS, { ...prefs, lastOpened });
    return json({ success: true, data: sheetView(ds, kv) });
  }
  if (action !== 'updateSheet' || !data.sheetData || typeof data.sheetData !== 'object' ||
      Array.isArray(data.sheetData)) return fail('Invalid action or sheet.', 400);
  const payload = data.sheetData;
  if (payload.name !== undefined && (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 200) ||
      payload.formatVersion !== undefined && payload.formatVersion !== 2 ||
      payload.data !== undefined && !checkWorkbook(payload.data) ||
      payload.thumbnail !== undefined && (typeof payload.thumbnail !== 'string' ||
        !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(payload.thumbnail) || payload.thumbnail.length > 600_000))
    return fail('Invalid sheet data.', 400);
  const updated = ds.transaction(tx => {
    const current = tx.findOne(SHEETS, data.sheetId);
    if (!current) return null;
    if (current.version !== data.version) return 'conflict';
    const next = { name: payload.name?.trim() || current.name,
      formatVersion: 2, updatedAt: now(), version: current.version + 1 };
    if (payload.data !== undefined) {
      const old = getRow(tx, BODIES, data.sheetId);
      if (old) tx.update(BODIES, { id: old.id }, { $set: { data: payload.data } });
      else tx.insert(BODIES, { sheetId: data.sheetId, data: payload.data });
    }
    if (payload.thumbnail) {
      const old = getRow(tx, THUMBS, data.sheetId);
      if (old) tx.update(THUMBS, { id: old.id }, { $set: { image: payload.thumbnail } });
      else tx.insert(THUMBS, { sheetId: data.sheetId, image: payload.thumbnail });
      next.thumbRef = 1;
    }
    tx.update(SHEETS, { id: data.sheetId }, { $set: next });
    return { ...current, ...next };
  });
  if (updated === 'conflict') return fail('Sheet changed in another tab. Reload before saving.', 409);
  if (!updated) return fail('Sheet not found', 404);
  if (updated.sharedId) {
    const row = shared(publicDS, updated.sharedId);
    if (!row) return fail('Could not update shared copy. Private changes were saved.', 503);
    publicDS.update(SHARES, { id: row.id }, { $set: {
      sheet: publicSheet(updated, payload.data || getRow(ds, BODIES, data.sheetId)?.data), sharedAt: now(),
    } });
  }
  return json({ success: true, data: sheetView(ds, kv) });
}
