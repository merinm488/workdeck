/**
 * ================================================
 * FILEBOX - File Content API
 * ================================================
 *
 * This route only moves FILE BYTES. All metadata lives in the unified 
 * document and is handled by api/workdeck.js.
 *
 * Storage (via api/_lib/store.js):
 *   development -> db/<storageKey>.json          (server/dev-server.js)
 *   production  -> textdb.dev doc <storageKey>   (gzip envelope handled by
 *                                                  store.js transparently)
 *
 * Content record shape (one per file, keyed `file_<fileId>`):
 *   { "bytes": "<base64>" }
 *
 * Request shapes:
 *   GET  ?hash=<hash>                 -> whole unified user document
 *                                        (same response shape as
 *                                        GET /api/workdeck?hash=)
 *   GET  ?fileId=<id>&hash=<hash>     -> raw bytes, served with the file's
 *                                        mime type. `&dl=1` switches
 *                                        Content-Disposition to attachment.
 *   PUT  { hash, action: 'uploadFile',
 *          data: { name, mime, base64,
 *                  folderId?, tags?,
 *                  thumbnail? } }      -> stores bytes, then unshifts the
 *                                        metadata record; returns { file }.
 *
 *   No POST — Filebox has no login page of its own; auth is handled by
 *   POST /api/workdeck (login/create), and DELETE /account by
 *   DELETE /api/workdeck?hash= (which also loops deleteRawDoc over files).
 * ================================================
 */

import {
  getUserDoc,
  saveOwnedSections,
  generateId,
  putRawDoc,
  getRawDoc,
  applyCorsHeaders
} from './_lib/store.js';

// Hard cap on decoded file size.
const MAX_FILE_SIZE = 300 * 1024;

// Thumbnails ride INSIDE the ~1 MB unified user doc, so each data URL must
// stay small. Larger values are nulled, never rejected — an upload must not
// fail because its preview is heavy.
const MAX_THUMBNAIL_CHARS = 60000;

// ================================================
// Helpers
// ================================================

/** data URLs only, and small enough to live in the user doc. */
function sanitizeThumbnail(thumbnail) {
  return typeof thumbnail === 'string' &&
    thumbnail.startsWith('data:image/') &&
    thumbnail.length <= MAX_THUMBNAIL_CHARS
    ? thumbnail
    : null;
}

function sanitizeTags(tags, userData) {
  if (!Array.isArray(tags)) return [];
  const known = new Set((userData.tags || []).map(t => t.id));
  const seen = new Set();
  return tags.filter(id => {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** The files[] metadata record for a fresh upload. */
function buildFileRecord(data, tagIds, size) {
  const id = generateId();
  const now = new Date().toISOString();
  const thumbnail = sanitizeThumbnail(data.thumbnail);
  return {
    id,
    name: data.name,
    mime: data.mime,
    size,
    folderId: data.folderId || null,
    tags: tagIds,
    thumbnail,
    thumbnailCover: thumbnail ? data.thumbnailCover === true : false,
    thumbVer: thumbnail && data.thumbVer > 0 ? data.thumbVer : 0,
    storage: 'textdb',
    storageKey: `file_${id}`,
    createdAt: now,
    updatedAt: now
  };
}

/** filename= (ASCII-safe) + filename*=UTF-8'' pair for Content-Disposition. */
function contentDispositionNames(file) {
  const raw = String(file.name || 'file');
  const ascii = raw
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'file';
  return { asciiName: ascii, utf8Name: raw };
}

// ================================================
// API Handler
// ================================================

export default async function handler(req, res) {
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // ============================================================
    // GET - whole user doc, or one file's bytes
    // ============================================================
    if (req.method === 'GET') {
      const { hash, fileId, dl } = req.query;

      // --- Whole user document (app bootstrap / poll) ---
      if (!fileId) {
        if (!hash) {
          return res.status(400).json({ success: false, error: 'Hash parameter is required' });
        }
        const userData = await getUserDoc(hash);
        if (!userData) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // --- One file's bytes ---
      if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash parameter is required' });
      }
      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      const file = (userData.files || []).find(f => f.id === fileId);
      if (!file) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
      if (file.storage !== 'textdb') {
        return res.status(400).json({ success: false, error: 'Unsupported storage backend' });
      }

      const doc = await getRawDoc(file.storageKey);
      // Tolerate a bare base64 string; the canonical shape is { bytes }.
      const base64 = doc && typeof doc === 'object' ? doc.bytes : (typeof doc === 'string' ? doc : null);
      if (!base64) {
        return res.status(404).json({ success: false, error: 'File content not found' });
      }

      const buffer = Buffer.from(base64, 'base64');
      const { asciiName, utf8Name } = contentDispositionNames(file);

      res.setHeader('Content-Type', file.mime || 'application/octet-stream');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Content-Disposition', (dl ? 'attachment' : 'inline')
        + `; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`);
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.status(200).send(buffer);
    }

    // ============================================================
    // PUT - uploadFile (the only action)
    // ============================================================
    if (req.method === 'PUT') {
      const { hash, action, data } = req.body || {};

      if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash is required' });
      }
      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // --- UPLOAD FILE ---
      if (action !== 'uploadFile') {
        return res.status(400).json({ success: false, error: 'Invalid action. Use "uploadFile"' });
      }

      // Validate in order so the client sees the specific problem.
      const name = typeof data?.name === 'string' ? data.name.trim() : '';
      if (!name || name.length > 255) {
        return res.status(400).json({ success: false, error: 'name is required (1-255 characters)' });
      }
      const mime = typeof data?.mime === 'string' && data.mime ? data.mime : 'application/octet-stream';
      if (typeof data?.base64 !== 'string' || !data.base64) {
        return res.status(400).json({ success: false, error: 'base64 content is required' });
      }
      if (data.folderId && !(userData.folders || []).some(f => f.id === data.folderId)) {
        return res.status(404).json({ success: false, error: 'Folder not found' });
      }

      const buffer = Buffer.from(data.base64, 'base64');
      if (buffer.length > MAX_FILE_SIZE) {
        return res.status(413).json({
          success: false,
          error: 'FILE_TOO_LARGE',
          message: `File exceeds the ${Math.floor(MAX_FILE_SIZE / 1024)} KB limit`
        });
      }

      const record = buildFileRecord(
        { ...data, name, mime },
        sanitizeTags(data.tags, userData),
        buffer.length
      );

      // ORPHAN GUARD — bytes go first; a failed write must not leave
      // metadata pointing at nothing.
      const stored = await putRawDoc(record.storageKey, { bytes: data.base64 });
      if (!stored) {
        return res.status(502).json({ success: false, error: 'Failed to store file content' });
      }

      userData.files.unshift(record);
      const saved = await saveOwnedSections(hash, {
        files: userData.files,
        folders: userData.folders
      });
      if (!saved) {
        return res.status(500).json({ success: false, error: 'Failed to save file' });
      }

      return res.status(201).json({ success: true, file: record });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[FILEBOX API] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}