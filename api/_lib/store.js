/**
 * ================================================
 * Shared Storage Layer (Workdeck / Docs / Sheets)
 * ================================================
 *
 * All three API routes (/api/workdeck, /api/docs, /api/users) share this
 * module so that they operate on the SAME document per user, in both
 * environments:
 *
 *   development -> local JSON files under db/users/{hash}.json
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
 *     settings:     { theme, viewMode, lastOpened, createdAt, ... }
 *   }
 *
 * Each app only "owns" its own section(s). saveOwnedSections() merges writes
 * at the section level (settings merge at the key level) so that, for
 * example, a doc save from Docs never wipes a user's sheets or forms.
 *
 * Environment detection mirrors the original projects:
 * - NODE_ENV === 'development' -> local files
 * - otherwise                  -> textdb.dev
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', 'db');
const USERS_DIR = path.join(DB_DIR, 'users');

export const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

const PEPPER_SECRET = process.env.PEPPER_SECRET || 'dev-pepper-change-in-production-9F2a-5xK8';
const TEXTDB_API_BASE = 'https://textdb.dev/api/data';

// ================================================
// Hashing / IDs
// ================================================

/**
 * Generate SHA-256 hash with pepper (same scheme as the original Docs & Sheets
 * projects: sha256(key.trim() + PEPPER_SECRET) as hex).
 */
export function generateHash(input) {
  const normalized = input ? String(input).trim() : '';
  return crypto.createHash('sha256').update(normalized + PEPPER_SECRET).digest('hex');
}

/**
 * Generate unique ID (same format the original projects use).
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

/** Parse a stored document, handling textdb.dev's double-encoded JSON quirk. */
function parseDocText(text) {
  let parsed = JSON.parse(text);
  if (typeof parsed === 'string') {
    parsed = JSON.parse(parsed);
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
  const response = await fetch(`${TEXTDB_API_BASE}/${id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(value)
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

const KNOWN_SECTIONS = ['docs', 'tags', 'sheets', 'forms', 'slides', 'settings'];

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
 * stored. `owned.settings` is merged at the key level so that Docs (theme) and
 * Workdeck (theme, viewMode, lastOpened) can share one settings object
 * without clobbering each other.
 *
 * @param {string} hash
 * @param {{docs?:Array, tags?:Array, sheets?:Array, forms?:Array, slides?:Array, settings?:Object}} owned
 * @returns {Promise<boolean>}
 */
export async function saveOwnedSections(hash, owned) {
  let existing = null;
  try {
    existing = IS_DEVELOPMENT ? readLocalDoc(getUserFilePath(hash)) : await getTextdbDoc(hash);
  } catch (error) {
    console.error('[STORE] Error reading before merge:', error);
  }

  const next = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};

  for (const key of ['docs', 'tags', 'sheets', 'forms', 'slides']) {
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
// Shared (public) documents
// ================================================

export async function putSharedDoc(shareId, value) {
  try {
    if (IS_DEVELOPMENT) {
      return writeLocalDoc(getSharedFilePath(shareId), value);
    }
    return await postTextdbDoc(`shared_${shareId}`, value);
  } catch (error) {
    console.error('[STORE] Error saving shared doc:', error);
    return false;
  }
}

export async function getSharedDoc(shareId) {
  try {
    const doc = IS_DEVELOPMENT
      ? readLocalDoc(getSharedFilePath(shareId))
      : await getTextdbDoc(`shared_${shareId}`);
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
    return await postTextdbDoc(`shared_${shareId}`, null);
  } catch (error) {
    console.error('[STORE] Error deleting shared doc:', error);
    return false;
  }
}

// ================================================
// Request helpers
// ================================================

/**
 * Read a request header regardless of whether the handler received a Web
 * fetch `Request` (a `Headers` instance, as used by api/docs.js) or an
 * Express/Vercel `req` (a plain object, as used by api/users.js). Bracket
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
