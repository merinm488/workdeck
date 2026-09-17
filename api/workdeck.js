/**
 * ================================================
 * WORKDECK - Unified API
 * ================================================
 *
 * Serves the Workdeck landing page. 
 *
 *   POST { key, action: 'login'  } -> hash + user data, 404 when unknown
 *   POST { key, action: 'create' } -> creates the unified account
 *
 * The hash is sha256(key.trim() + PEPPER_SECRET) - so one key resolves to the same account/document in all the apps.
 *
 * Data actions (PUT) operate on the unified document
 * and only touch their own sections (see api/_lib/store.js).
 */

import {
  IS_DEVELOPMENT,
  generateHash,
  generateId,
  getUserDoc,
  saveOwnedSections,
  createUserDoc,
  deleteUserDoc,
  deleteSharedDoc,
  getBaseUrl,
  applyCorsHeaders
} from './_lib/store.js';

const DEFAULT_SHEET_NAME = 'Untitled Sheet';
const DEFAULT_DOC_TITLE = 'Untitled';
const DEFAULT_FORM_TITLE = 'Untitled Form';
const DEFAULT_DECK_NAME = 'Untitled';

/**
 * Build a fresh Univer workbook snapshot (matches what sheets/js/home.js
 * creates client-side, so the editor loads it without any migration).
 */
function createDefaultSheet(id) {
  const sheetId = `sheet-${Date.now().toString(36)}`;
  return {
    id,
    name: DEFAULT_SHEET_NAME,
    formatVersion: 2,
    data: {
      id: `wb_${id}`,
      name: DEFAULT_SHEET_NAME,
      appVersion: '0.25.1',
      locale: 'enUS',
      styles: {},
      sheetOrder: [sheetId],
      sheets: {
        [sheetId]: {
          id: sheetId,
          name: 'Sheet1',
          tabColor: '',
          hidden: 0,
          freeze: { xOffset: 0, yOffset: 0, startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
          rowCount: 84,
          columnCount: 60,
          zoomRatio: 1,
          scrollTop: 0,
          scrollLeft: 0,
          defaultColumnWidth: 73,
          defaultRowHeight: 19,
          mergeData: [],
          cellData: {},
          rowData: {},
          columnData: {}
        }
      }
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createDefaultDeck(id){
    return {id,                                    // passed in
    name: DEFAULT_DECK_NAME,
    formatVersion: 1,                      // schema version — lets migrate old decks
    width: 960,                            // the logical slide size every deck uses
    height: 540,
    slides: [{ id: 's1', name: 'Slide 1', background: '#ffffff', objects: [] }],
    sharedId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    }
}

function createDefaultForm(id) {
  return {
    id,
    name: DEFAULT_FORM_TITLE,
    display: 'form',
    components: [],
    sharedId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Merge settings and stamp defaults so clients can rely on the shape.
 */
function withSettingsDefaults(userData) {
  userData.settings = {
    theme: 'dark',
    viewMode: 'grid',
    lastOpened: {},
    ...(userData.settings || {})
  };
  return userData;
}

// ================================================
// Handler
// ================================================

export default async function handler(req, res) {
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // ============================================================
    // GET - user data (session check / initial load)
    // ============================================================
    if (req.method === 'GET') {
      const { hash } = req.query;

      if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash is required' });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      return res.status(200).json({ success: true, data: withSettingsDefaults(userData) });
    }

    // ============================================================
    // POST - login / create account
    // ============================================================
    if (req.method === 'POST') {
      const { key, action } = req.body || {};

      if (!key || typeof key !== 'string') {
        return res.status(400).json({ success: false, error: 'Key is required' });
      }

      const normalizedKey = key.trim();
      if (normalizedKey.length === 0) {
        return res.status(400).json({ success: false, error: 'Key cannot be empty' });
      }

      const hash = generateHash(normalizedKey);

      // LOGIN — mirrors Docs: 404 lets the client fall back to auto-create.
      if (action === 'login') {
        const userData = await getUserDoc(hash);
        if (!userData) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        return res.status(200).json({ success: true, hash, data: withSettingsDefaults(userData) });
      }

      // CREATE — fails with 409 when the key already has an account.
      if (action === 'create' || action === undefined) {
        const result = await createUserDoc(hash);
        if (!result.ok) {
          if (result.code === 'USER_EXISTS') {
            return res.status(409).json({ success: false, error: 'User already exists', code: 'USER_EXISTS' });
          }
          return res.status(500).json({ success: false, error: 'Failed to create account' });
        }
        return res.status(201).json({ success: true, hash, data: withSettingsDefaults(result.doc) });
      }

      return res.status(400).json({ success: false, error: 'Invalid action. Use "login" or "create"' });
    }

    // ============================================================
    // PUT - file operations on the unified document
    // ============================================================
    if (req.method === 'PUT') {
      const { hash, action, data } = req.body || {};

      if (!hash || !action) {
        return res.status(400).json({ success: false, error: 'Hash and action are required' });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      switch (action) {
        // ---- Create a doc (same shape Docs creates) ----
        case 'createDoc': {
          const now = new Date().toISOString();
          userData.docs.unshift({
            id: generateId(),
            title: data?.title || DEFAULT_DOC_TITLE,
            content: data?.content || '',
            contentType: data?.contentType || 'plain-text',
            tagId: data?.tagId || null,
            createdAt: now,
            updatedAt: now,
            pinned: false,
            archived: false
          });
          break;
        }

        // ---- Create a sheet (same shape Sheets creates) ----
        case 'createSheet': {
          const id = data?.id || generateId();
          const sheet = createDefaultSheet(id);
          if (data?.name) sheet.name = data.name;
          userData.sheets.push(sheet);
          break;
        }

        // ---- Create a form  ----
        case 'createForm': {
          const id = data?.id || generateId();
          const form = createDefaultForm(id);
          if (data?.name) form.name = data.name;
          userData.forms.unshift(form);
          break;
        }

        // Create empty deck
        case 'createDeck': {
          const id = data?.id || generateId();
          const deck = createDefaultDeck(id);
          if (data?.name) deck.name = data.name;
          userData.slides.unshift(deck);
          break;
        }

        // ---- Record that a file was just opened (recents ordering) ----
        case 'recordOpen': {
          const { fileId, app } = data || {};
          if (!fileId) {
            return res.status(400).json({ success: false, error: 'fileId is required' });
          }
          const target = app === 'sheets'
            ? userData.sheets.find(s => s.id === fileId)
            : app === 'forms'
              ? userData.forms.find(f => f.id === fileId)
              : app === 'slides'
              ? userData.slides.find(d => d.id === fileId)
              : userData.docs.find(n => n.id === fileId);

          if (!target) {
            return res.status(404).json({ success: false, error: 'File not found' });
          }

          userData.settings = userData.settings || {};
          userData.settings.lastOpened = userData.settings.lastOpened || {};
          userData.settings.lastOpened[fileId] = new Date().toISOString();
          break;
        }

        // ---- Rename a file from the landing page ----
        case 'renameFile': {
          const { fileId, app, name } = data || {};
          if (!fileId || !name || !String(name).trim()) {
            return res.status(400).json({ success: false, error: 'fileId and name are required' });
          }
          // Docs keep their name in `title`, sheets & forms in `name`
          const isSheet = app === "sheets";
          const isForm = app === "forms";
          const isDeck = app === "slides";
          const collection = isSheet ? userData.sheets : isForm ? userData.forms : isDeck ? userData.slides : userData.docs;
          const target = collection.find(f => f.id === fileId);
          if (!target) {
            return res.status(404).json({ success: false, error: 'File not found' });
          }
          const cleanName = String(name).trim();
          if (isSheet) {
            target.name = cleanName;
            if (target.data) target.data.name = cleanName;
          } else if (isForm) {
            target.name = cleanName;
          } else if (isDeck){
            target.name = cleanName;
          } else {
            target.title = cleanName;
          }
          target.updatedAt = new Date().toISOString();
          break;
        }

        // ---- Delete a file (and its shared copy, like the apps do) ----
        case 'deleteFile': {
          const { fileId, app } = data || {};
          if (!fileId) {
            return res.status(400).json({ success: false, error: 'fileId is required' });
          }

          if (app === 'sheets') {
            const sheet = userData.sheets.find(s => s.id === fileId);
            if (sheet?.sharedId) {
              await deleteSharedDoc(sheet.sharedId);
            }
            userData.sheets = userData.sheets.filter(s => s.id !== fileId);
          } else if (app === 'forms') {
            const form = userData.forms.find(f => f.id === fileId);
            if (form?.sharedId) {
              await deleteSharedDoc(form.sharedId);
            }
            userData.forms = userData.forms.filter(f => f.id !== fileId);
          } else if (app === 'slides') {
            const deck = userData.slides.find(f => f.id === fileId);
            if (deck?.sharedId) {
              await deleteSharedDoc(deck.sharedId);
            }
            userData.slides = userData.slides.filter(d => d.id !== fileId);
          } else {
            const doc = userData.docs.find(n => n.id === fileId);
            if (doc?.sharedId) {
              await deleteSharedDoc(doc.sharedId);
            }
            userData.docs = userData.docs.filter(n => n.id !== fileId);
          }

          if (userData.settings?.lastOpened) {
            delete userData.settings.lastOpened[fileId];
          }
          break;
        }

        // ---- Theme / viewMode / misc settings ----
        case 'updateSettings': {
          if (!data?.settings || typeof data.settings !== 'object') {
            return res.status(400).json({ success: false, error: 'settings object is required' });
          }
          userData.settings = { ...(userData.settings || {}), ...data.settings };
          break;
        }

        default:
          return res.status(400).json({ success: false, error: 'Invalid action' });
      }

      const saved = await saveOwnedSections(hash, {
        docs: userData.docs,
        tags: userData.tags,
        sheets: userData.sheets,
        forms: userData.forms,
        slides: userData.slides,
        settings: userData.settings
      });

      if (!saved) {
        return res.status(500).json({ success: false, error: 'Failed to save data' });
      }

      return res.status(200).json({ success: true, data: withSettingsDefaults(userData) });
    }

    // ============================================================
    // DELETE - delete account (clears the unified document)
    // ============================================================
    if (req.method === 'DELETE') {
      const { hash } = req.query;

      if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash is required' });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const deleted = await deleteUserDoc(hash);
      if (!deleted) {
        return res.status(500).json({ success: false, error: 'Failed to delete account' });
      }

      return res.status(200).json({ success: true, message: 'Account deleted' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[WORKDECK API] Error:', error);
    return res.status(500).json({ success: false, error: 'Server error', message: error.message });
  }
}

// Exposed for the dev server logging only.
export { IS_DEVELOPMENT, getBaseUrl };
