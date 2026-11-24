// Holm Files upload/download. Metadata, bytes and thumbnails are separate
// records in the verified member's DS. Nothing is written to app-wide DS and
// no client-selected hash, member ID or storageKey is ever trusted.
const FILES = 'file_records';
const FOLDERS = 'file_folders';
const BYTES = 'file_contents';
const THUMBS = 'file_thumbs';
const TAGS = 'workspace_tags';
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/i;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status) => json({ success: false, error }, status);
const now = () => new Date().toISOString();
const validId = value => typeof value === 'string' && ID.test(value);
const findContent = (ds, fileId) => ds.find(BYTES, { fileId }, { limit: 1 })[0] || null;
function maxFileSize(env) {
  let raw;
  try { raw = env.holm.env?.get('FILES_MAX_FILE_SIZE'); } catch (_) { /* optional app setting */ }
  const m = /^(\d+)\s*(b|kb|mb)?$/i.exec(String(raw || '').trim());
  if (!m) return 300 * 1024;
  const parsed = Number(m[1]) * ({ b: 1, kb: 1024, mb: 1024 * 1024 }[(m[2] || 'b').toLowerCase()]);
  return parsed > 0 && parsed <= 12 * 1024 * 1024 ? parsed : 300 * 1024;
}
function decodedLength(base64) {
  if (typeof base64 !== 'string' || !BASE64.test(base64) || base64.length % 4 !== 0) return null;
  return base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}
function decode(base64, size) {
  const out = new Uint8Array(size);
  let pos = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const a = ALPHABET.indexOf(base64[i]), b = ALPHABET.indexOf(base64[i + 1]);
    const c = base64[i + 2] === '=' ? 0 : ALPHABET.indexOf(base64[i + 2]);
    const d = base64[i + 3] === '=' ? 0 : ALPHABET.indexOf(base64[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const bits = a << 18 | b << 12 | c << 6 | d;
    if (pos < size) out[pos++] = bits >>> 16 & 255;
    if (pos < size) out[pos++] = bits >>> 8 & 255;
    if (pos < size) out[pos++] = bits & 255;
  }
  return out;
}
function validMime(mime) {
  return typeof mime === 'string' && mime.length < 120 &&
    /^[a-z0-9][a-z0-9.+_-]*\/[a-z0-9][a-z0-9.+_-]*$/i.test(mime);
}
function disposition(file, dl) {
  const name = String(file.name || 'file');
  const safe = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').trim() || 'file';
  return `${dl ? 'attachment' : 'inline'}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
export async function handleFilebox(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/filebox') return fail('Not found.', 404);
  if (request.method === 'GET' && url.searchParams.has('limits'))
    return json({ success: true, limits: { maxFileSize: maxFileSize(env) } });
  if (!env.holm.auth.getMember()) return fail('Sign in to continue.', 401);
  const ds = env.holm.app.member.ds;
  if (request.method === 'GET') {
    const uploadId = url.searchParams.get('uploadId');
    if (uploadId !== null) {
      if (!validId(uploadId)) return fail('Invalid upload ID.', 400);
      const file = ds.find(FILES, { uploadId }, { limit: 1 })[0];
      return file ? json({ success: true, file }) : fail('File not found', 404);
    }
    const fileId = url.searchParams.get('fileId');
    if (!fileId) return fail('File ID required.', 400);
    const meta = validId(fileId) && ds.findOne(FILES, fileId);
    if (!meta) return fail('File not found', 404);
    const content = findContent(ds, fileId);
    if (!content) return fail('File content not found', 404);
    const size = decodedLength(content.base64);
    if (size === null || size !== meta.size) return fail('File content damaged.', 503);
    const bytes = decode(content.base64, size);
    if (!bytes) return fail('File content damaged.', 503);
    return new Response(bytes, { status: 200, headers: {
      'Content-Type': meta.mime || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Content-Disposition': disposition(meta, url.searchParams.get('dl') === '1'),
      // Uploaded HTML/SVG must never execute same-origin scripts with the
      // member's cookie. Previews use fetch/Blob; sandbox only applies when
      // a user navigates directly to this response as a document.
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    } });
  }
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  const max = maxFileSize(env);
  if (raw.length > Math.ceil(max * 4 / 3) + 100_000) return fail('FILE_TOO_LARGE', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.action !== 'uploadFile' ||
      !body.data || typeof body.data !== 'object' || Array.isArray(body.data) ||
      'hash' in body || 'key' in body || 'memberId' in body) return fail('Invalid upload.', 400);
  const data = body.data;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name || name.length > 255) return fail('name is required (1-255 characters)', 400);
  const mime = validMime(data.mime) ? data.mime : 'application/octet-stream';
  const size = decodedLength(data.base64);
  if (size === null) return fail('base64 content is required', 400);
  if (size > max) return json({ success: false, error: 'FILE_TOO_LARGE',
    message: `File exceeds the ${Math.floor(max / 1024)} KB limit` }, 413);
  if (data.tags != null && (!Array.isArray(data.tags) || data.tags.length > 1))
    return fail('Choose at most one tag.', 400);
  if (data.uploadId !== undefined && !validId(data.uploadId)) return fail('Invalid upload ID.', 400);
  if (data.folderId != null && (!validId(data.folderId) || !ds.findOne(FOLDERS, data.folderId)))
    return fail('Folder not found', 404);
  const thumb = typeof data.thumbnail === 'string' && data.thumbnail.length <= 60_000 && IMAGE.test(data.thumbnail)
    ? data.thumbnail : null;
  // Verify the payload really decodes before creating any metadata.
  if (!decode(data.base64, size)) return fail('Invalid base64 content.', 400);
  const record = ds.transaction(tx => {
    // A retry after a lost HTTP response must not create a second file.
    if (data.uploadId) {
      const existing = tx.find(FILES, { uploadId: data.uploadId }, { limit: 1 })[0];
      if (existing) return existing.name === name && existing.size === size
        ? { file: existing, created: false } : 'conflict';
    }
    if (tx.count(FILES, {}) >= 2000) return null;
    if (data.folderId && !tx.findOne(FOLDERS, data.folderId)) return null;
    const tags = [];
    for (const tag of Array.isArray(data.tags) ? data.tags : [])
      if (validId(tag) && tx.findOne(TAGS, tag)) tags.push(tag);
    const stamp = now();
    const fields = { name, mime, size, folderId: data.folderId || null, tags,
      ...(data.uploadId ? { uploadId: data.uploadId } : {}),
      thumbnailCover: thumb ? data.thumbnailCover === true : false,
      thumbVer: thumb && Number.isSafeInteger(data.thumbVer) && data.thumbVer > 0 ? data.thumbVer : 0,
      thumbRef: thumb ? 1 : 0, createdAt: stamp, updatedAt: stamp };
    const id = tx.insert(FILES, fields);
    tx.insert(BYTES, { fileId: id, base64: data.base64 });
    if (thumb) tx.insert(THUMBS, { fileId: id, image: thumb });
    return { file: { id, storageKey: `file_${id}`, ...fields }, created: true };
  });
  if (record === 'conflict') return fail('Upload ID already belongs to another file.', 409);
  return record ? json({ success: true, file: record.file }, record.created ? 201 : 200)
    : fail('File limit or folder unavailable.', 409);
}
