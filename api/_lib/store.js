/**
 * ================================================
 * Shared Storage Layer (Workdeck / Docs / Sheets)
 * ================================================
 *
 * All API routes share this module so that 
 * they operate on the SAME document per user, in both
 * environments:
 *
 *   development -> local JSON files 
 *   production  -> textdb.dev documents keyed by the user hash
 *
 * The unified document shape is:
 *
 *   {
 *     docs:        [ ...docs... ],
 *     tags:        [ ...tags... ],
 *     sheets:       [ ...sheets... ],
 *     forms:        [ ...forms... ],
 *     slides:       [ ...slide decks... ],
 *     draws:        [ ...drawings... ],
 *     files:        [ ...Filebox file metadata (bytes live in raw docs below) ],
 *     folders:      [ ...Filebox folders... ],
 *     todo:         [ ...Todo task lists... ],
 *     settings:     { theme, viewMode, lastOpened, createdAt, ... }
 *   }
 *
 * Each app only "owns" its own section(s). saveOwnedSections() merges writes
 * at the section level (settings merge at the key level) so that, for
 * example, a doc save from Docs never wipes a user's sheets or forms.
 *
 * Environment detection:
 * - NODE_ENV === 'development' -> local files
 * - otherwise                  -> textdb.dev
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', 'db');
const USERS_DIR = path.join(DB_DIR, 'users');

export const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

const PEPPER_SECRET = process.env.PEPPER_SECRET || 'dev-pepper-change-in-production-9F2a-5xK8';
const TEXTDB_API_BASE = 'https://textdb.dev/api/data';

// textdb.dev rejects stored documents over 1MB —  Writes larger than 
// COMPRESS_OVER_BYTES are gzipped and stored as {"__wdz":1,"data":"<base64>"}; 
// parseDocText detects the wrapper and unpacks it on read, so pre-existing plain documents keep
// working untouched. Base64 inflates by 4/3, so at JSON's typical gzip
// ratios this lifts the practical ceiling to several MB of raw JSON; a
// record still too big after compression is refused with a clear log line.
const TEXTDB_MAX_BYTES = 1024 * 1024;
const COMPRESS_OVER_BYTES = 256 * 1024;
const COMPRESSED_FLAG = '__wdz';

// ================================================
// Hashing / IDs
// ================================================

/**
 * Generate SHA-256 hash with pepper
 */
export function generateHash(input) {
  const normalized = input ? String(input).trim() : '';
  return crypto.createHash('sha256').update(normalized + PEPPER_SECRET).digest('hex');
}

/** Account hash from a raw key (agents) or an explicit hash (browser). */
export function accountHash(params) {
  const { key, hash } = params || {};
  return key ? generateHash(key) : hash;
}

/**
 * Generate unique ID.
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// ================================================
// Low-level document IO
// ================================================

function isDefaultTextdbContent(text) {
  return !text || text.trim() === '' || text.includes('hello world from textdb') || text.length < 10;
}

/**
 * Parse a stored document, handling textdb.dev's double-encoded JSON quirk
 * and the gzip wrapper postTextdbDoc writes for large payloads. A null
 * write comes back as textdb's {"_json":null} envelope — normalize to null
 * so deleted records read as deleted.
 */
function parseDocText(text) {
  let parsed = JSON.parse(text);
  while (typeof parsed === 'string') {
    parsed = JSON.parse(parsed);
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[COMPRESSED_FLAG]) {
    parsed = JSON.parse(zlib.gunzipSync(Buffer.from(parsed.data, 'base64')).toString('utf8'));
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 && parsed._json === null) {
    return null;
  }
  return parsed;
}

function getUserFilePath(hash) {
  return path.join(USERS_DIR, `${hash}.json`);
}

function getSharedFilePath(shareId) {
  return path.join(DB_DIR, `shared_${shareId}.json`);
}

function ensureDirectories() {
  if (!fs.existsSync(USERS_DIR)) {
    fs.mkdirSync(USERS_DIR, { recursive: true });
  }
}

function readLocalDoc(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error('[STORE] Error reading local doc:', error);
    return null;
  }
}

function writeLocalDoc(filePath, value) {
  ensureDirectories();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  return true;
}

async function getTextdbDoc(id) {
  const response = await fetch(`${TEXTDB_API_BASE}/${id}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch data: ${response.status}`);
  }

  const text = await response.text();
  if (isDefaultTextdbContent(text)) return null;

  try {
    return parseDocText(text);
  } catch (error) {
    console.error('[STORE] JSON parse error:', error.message);
    return null;
  }
}

async function postTextdbDoc(id, value) {
  let body = JSON.stringify(value);
  if (body.length > COMPRESS_OVER_BYTES) {
    body = JSON.stringify({
      [COMPRESSED_FLAG]: 1,
      data: zlib.gzipSync(Buffer.from(body, 'utf8')).toString('base64')
    });
    if (body.length > TEXTDB_MAX_BYTES) {
      console.error(`[STORE] textdb save failed: ${body.length} bytes even gzipped (textdb.dev limit is ${TEXTDB_MAX_BYTES}). The record must shrink or move to a larger store.`);
      return false;
    }
  }
  const response = await fetch(`${TEXTDB_API_BASE}/${id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error(`[STORE] textdb save failed (${response.status}): ${detail}`);
    return false;
  }
  return true;
}

// ================================================
// User documents
// ================================================

const KNOWN_SECTIONS = ['docs', 'tags', 'sheets', 'forms', 'slides', 'draws', 'files', 'folders', 'todo', 'calendars', 'events', 'kanban', 'settings'];

/** A stored doc counts as an existing account if it has any known section. */
export function isValidUserDoc(doc) {
  return Boolean(
    doc &&
    typeof doc === 'object' &&
    !Array.isArray(doc) &&
    KNOWN_SECTIONS.some(key => Object.prototype.hasOwnProperty.call(doc, key) && doc[key] != null)
  );
}

/**
 * Get the unified user document with every section normalized to a default.
 * Returns null when the account does not exist.
 */
export async function getUserDoc(hash) {
  let doc;
  try {
    doc = IS_DEVELOPMENT ? readLocalDoc(getUserFilePath(hash)) : await getTextdbDoc(hash);
  } catch (error) {
    console.error('[STORE] Error reading user data:', error);
    return null;
  }

  if (!isValidUserDoc(doc)) return null;

  if (!Array.isArray(doc.docs)) doc.docs = [];
  if (!Array.isArray(doc.tags)) doc.tags = [];
  if (!Array.isArray(doc.sheets)) doc.sheets = [];
  if (!Array.isArray(doc.forms)) doc.forms = [];
  if (!Array.isArray(doc.slides)) doc.slides = [];
  if (!Array.isArray(doc.draws)) doc.draws = [];
  if (!Array.isArray(doc.files)) doc.files = [];
  if (!Array.isArray(doc.folders)) doc.folders = [];
  if (!Array.isArray(doc.todo)) doc.todo = [];
  if (!Array.isArray(doc.calendars)) doc.calendars = [];
  if (!Array.isArray(doc.events)) doc.events = [];
  if (!Array.isArray(doc.kanban)) doc.kanban = [];
  if (!doc.settings || typeof doc.settings !== 'object') doc.settings = {};

  return doc;
}

/** Overwrite the entire document (used internally and for account deletion). */
export async function overwriteDoc(hash, doc) {
  try {
    if (IS_DEVELOPMENT) {
      return writeLocalDoc(getUserFilePath(hash), doc);
    }
    return await postTextdbDoc(hash, doc);
  } catch (error) {
    console.error('[STORE] Error saving user data:', error);
    return false;
  }
}

/**
 * Save only the sections the caller owns, merging over whatever else is
 * stored. `owned.settings` is merged at the key level so that apps (theme) and
 * Workdeck (theme, viewMode, lastOpened) can share one settings object
 * without clobbering each other.
 *
 * @param {string} hash
 * @param {{docs?:Array, tags?:Array, sheets?:Array, forms?:Array, slides?:Array, draws?:Array, files?:Array, folders?:Array, todo?:Array, calendars?:Array, events?:Array, kanban?:Array, settings?:Object}} owned
 * @returns {Promise<boolean>}
 */
export async function saveOwnedSections(hash, owned) {
  let existing = null;
  try {
    existing = IS_DEVELOPMENT ? readLocalDoc(getUserFilePath(hash)) : await getTextdbDoc(hash);
  } catch (error) {
    // A failed read is NOT the same as "no document yet": merging into {}
    // would store only this caller's sections and silently wipe the rest of
    // the user's data (docs, sheets, forms...). Hence fail the save instead 
    console.error('[STORE] Error reading before merge:', error);
    return false;
  }

  const next = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};

  for (const key of ['docs', 'tags', 'sheets', 'forms', 'slides', 'draws', 'files', 'folders', 'todo', 'calendars', 'events', 'kanban']) {
    if (owned[key] !== undefined) next[key] = owned[key];
  }

  if (owned.settings) {
    next.settings = { ...(next.settings || {}), ...owned.settings };
  }

  return overwriteDoc(hash, next);
}

/** Create the unified account document (fails if one already exists). */
export async function createUserDoc(hash, defaults = {}) {
  const existing = await getUserDoc(hash);
  if (existing) return { ok: false, code: 'USER_EXISTS' };

  const doc = {
    docs: [],
    tags: [],
    sheets: [],
    forms: [],
    slides: [],
    draws: [],
    files: [],
    folders: [],
    todo: [],
    calendars: [],
    events: [],
    kanban: [],
    settings: {
      theme: 'dark',
      viewMode: 'grid',
      lastOpened: {},
      createdAt: new Date().toISOString(),
      ...defaults
    }
  };

  const saved = await overwriteDoc(hash, doc);
  return saved ? { ok: true, doc } : { ok: false, code: 'SAVE_FAILED' };
}

/**
 * Move the account document from `oldHash` to the hash of `newKey`.
 * The copy to the new address happens first — if it fails, the account
 * is untouched under the old key. Fails with KEY_TAKEN when the new
 * key already has an account of its own.
 */
export async function changeUserKey(oldHash, newKey) {
  const newHash = generateHash(newKey);
  if (newHash === oldHash) return { ok: false, code: 'SAME_KEY' };

  const doc = await getUserDoc(oldHash);
  if (!doc) return { ok: false, code: 'NOT_FOUND' };

  if (await getUserDoc(newHash)) return { ok: false, code: 'KEY_TAKEN' };

  const saved = await overwriteDoc(newHash, doc);
  if (!saved) return { ok: false, code: 'SAVE_FAILED' };

  await deleteUserDoc(oldHash);
  return { ok: true, hash: newHash, doc };
}

/** Delete the account document. */
export async function deleteUserDoc(hash) {
  try {
    if (IS_DEVELOPMENT) {
      const filePath = getUserFilePath(hash);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    }
    // textdb.dev has no delete; writing null empties the document.
    return await postTextdbDoc(hash, null);
  } catch (error) {
    console.error('[STORE] Error deleting user data:', error);
    return false;
  }
}

// ================================================
// Record addressing (production)
// ================================================

// textdb.dev has no authentication — knowing a record's address IS write
// access, and record ids surface in URLs (deep links, share links). So raw
// and shared records live at pepper-derived addresses no client can compute;
// only this module resolves logical key -> address. Records still stored at
// the bare logical key migrate lazily on first read.
function deriveRecordKey(key) {
  return 'wd1_' + crypto.createHash('sha256')
    .update(`wdraw1:${key}:${PEPPER_SECRET}`)
    .digest('hex');
}

async function getTextdbRecord(key) {
  const derived = deriveRecordKey(key);
  const doc = await getTextdbDoc(derived);
  if (doc !== null) return doc;

  const legacy = await getTextdbDoc(key);
  if (legacy === null) return null;

  if (await postTextdbDoc(derived, legacy)) {
    await postTextdbDoc(key, null);
  }
  return legacy;
}

// ================================================
// Shared (public) documents
// ================================================

export async function putSharedDoc(shareId, value) {
  try {
    if (IS_DEVELOPMENT) {
      return writeLocalDoc(getSharedFilePath(shareId), value);
    }
    return await postTextdbDoc(deriveRecordKey(`shared_${shareId}`), value);
  } catch (error) {
    console.error('[STORE] Error saving shared doc:', error);
    return false;
  }
}

export async function getSharedDoc(shareId) {
  try {
    const doc = IS_DEVELOPMENT
      ? readLocalDoc(getSharedFilePath(shareId))
      : await getTextdbRecord(`shared_${shareId}`);
    if (!doc || typeof doc !== 'object') return null;
    return doc;
  } catch (error) {
    console.error('[STORE] Error reading shared doc:', error);
    return null;
  }
}

export async function deleteSharedDoc(shareId) {
  try {
    if (IS_DEVELOPMENT) {
      const filePath = getSharedFilePath(shareId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    }
    // textdb.dev has no delete; writing null empties the document.
    // Both addresses: the record may not have migrated yet.
    const key = `shared_${shareId}`;
    const derived = await postTextdbDoc(deriveRecordKey(key), null);
    const legacy = await postTextdbDoc(key, null);
    return derived && legacy;
  } catch (error) {
    console.error('[STORE] Error deleting shared doc:', error);
    return false;
  }
}

// ================================================
// Raw documents (Filebox file bytes)
// ================================================

function getRawFilePath(key) {
  return path.join(DB_DIR, `${key}.json`);
}

/** Store an arbitrary JSON value under `key` exactly as given. */
export async function putRawDoc(key, value) {
  try {
    if (IS_DEVELOPMENT) {
      return writeLocalDoc(getRawFilePath(key), value);
    }
    return await postTextdbDoc(deriveRecordKey(key), value);
  } catch (error) {
    console.error('[STORE] Error saving raw doc:', error);
    return false;
  }
}

/** Read the raw document stored under `key`, or null. */
export async function getRawDoc(key) {
  try {
    const doc = IS_DEVELOPMENT
      ? readLocalDoc(getRawFilePath(key))
      : await getTextdbRecord(key);
    if (doc === null || doc === undefined) return null;
    return doc;
  } catch (error) {
    console.error('[STORE] Error reading raw doc:', error);
    return null;
  }
}

/** Delete the raw document stored under `key`. */
export async function deleteRawDoc(key) {
  try {
    if (IS_DEVELOPMENT) {
      const filePath = getRawFilePath(key);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    }
    // textdb.dev has no delete; writing null empties the document.
    // Both addresses: the record may not have migrated yet.
    const derived = await postTextdbDoc(deriveRecordKey(key), null);
    const legacy = await postTextdbDoc(key, null);
    return derived && legacy;
  } catch (error) {
    console.error('[STORE] Error deleting raw doc:', error);
    return false;
  }
}

// ================================================
// Spreadsheet bodies (Sheets app workbooks)
// ================================================

// A workbook grows without bound, so — like Filebox file bytes — it gets its
// own record and the user document keeps only sheet metadata.
const sheetBodyKey = sheetId => `sheet_${sheetId}`;

/** Read a sheet's workbook body, or null. */
export async function getSheetBody(sheetId) {
  return getRawDoc(sheetBodyKey(sheetId));
}

/** Store a sheet's workbook body. */
export async function putSheetBody(sheetId, body) {
  return putRawDoc(sheetBodyKey(sheetId), body);
}

/** Delete a sheet's workbook body record. */
export async function deleteSheetBody(sheetId) {
  return deleteRawDoc(sheetBodyKey(sheetId));
}

// ================================================
// Card thumbnails (Filebox files, Sheets, ...)
// ================================================

// Same pattern as sheet bodies: thumbnails are data URLs that would
// otherwise dominate the account record. The value is wrapped in an object
// because a bare JSON string would trip parseDocText's unwrap loop.
const thumbKey = recordId => `thumb_${recordId}`;

/** Read a record's thumbnail data URL, or null. */
export async function getThumb(recordId) {
  const doc = await getRawDoc(thumbKey(recordId));
  return doc && typeof doc === 'object' ? doc.thumb || null : null;
}

/** Store a record's thumbnail data URL. */
export async function putThumb(recordId, dataUrl) {
  return putRawDoc(thumbKey(recordId), { thumb: dataUrl });
}

/** Delete a record's thumbnail. */
export async function deleteThumb(recordId) {
  return deleteRawDoc(thumbKey(recordId));
}

// ================================================
// Request helpers
// ================================================

/**
 * Read a request header regardless of whether the handler received a Web
 * fetch `Request` or an Express/Vercel `req`. Bracket
 * access on a Headers instance always yields undefined, which is how
 * `https://localhost` ended up in production share links.
 */
function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return value === null ? undefined : value;
  }
  return headers[name];
}

/** First entry of a possibly comma-separated header value. */
function firstHeaderValue(value) {
  if (!value) return undefined;
  return String(value).split(',')[0].trim() || undefined;
}

/** Build the deployment base URL from request headers. */
export function getBaseUrl(req) {
  const headers = req && req.headers;
  if (IS_DEVELOPMENT) {
    const host = firstHeaderValue(readHeader(headers, 'host')) || 'localhost:4000';
    return `http://${host}`;
  }
  const protocol = firstHeaderValue(readHeader(headers, 'x-forwarded-proto')) || 'https';
  const host =
    firstHeaderValue(readHeader(headers, 'host')) ||
    firstHeaderValue(readHeader(headers, 'x-forwarded-host')) ||
    'localhost';
  return `${protocol}://${host}`;
}

/** Standard CORS/no-cache headers shared by every API route. */
export function applyCorsHeaders(req, res) {
  const origin = req.headers['origin'] || '*';
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
}
