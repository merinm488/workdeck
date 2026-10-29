/**
 * ================================================
 * SHEETS - Unified User API
 * ================================================
 *
 * Shared storage (local files in dev, textdb.dev in prod) and
 * section-merged saves so sheet writes never wipe docs.
 */

import {
  generateHash,
  generateId,
  getUserDoc,
  saveOwnedSections,
  createUserDoc,
  changeUserKey,
  deleteUserDoc,
  putSharedDoc,
  getSharedDoc,
  deleteSharedDoc,
  getSheetBody,
  putSheetBody,
  deleteSheetBody,
  getThumb,
  putThumb,
  deleteThumb,
  getBaseUrl,
  applyCorsHeaders,
  accountHash
} from './_lib/store.js';

const VALID_THUMB = t =>
  typeof t === 'string' && t.startsWith('data:image/') && t.length <= 600000;

/** Persist only the sections Sheets owns (sheets) + settings changes. */
async function saveSheetsSections(hash, userData) {
  return saveOwnedSections(hash, {
    sheets: userData.sheets,
    settings: userData.settings
  });
}

/** Move legacy inline workbook bodies and thumbnails into their own records. */
async function migrateSheetBodies(userData) {
  await Promise.all((userData.sheets || []).map(async sheet => {
    if (!sheet) return;
    if (sheet.data !== undefined && await putSheetBody(sheet.id, sheet.data)) {
      delete sheet.data;
    }
    if (sheet.thumbnail && !sheet.thumbRef && await putThumb(sheet.id, sheet.thumbnail)) {
      delete sheet.thumbnail;
      sheet.thumbRef = 1;
    }
  }));
}

/** Shared-copy snapshot: sheet metadata minus sharedId, with the workbook embedded. */
async function buildSharedSheetRecord(record, body) {
  const { sharedId, ...sheet } = record;
  if (sheet.data === undefined) {
    sheet.data = body !== undefined ? body : await getSheetBody(record.id);
  }
  return sheet;
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
    // GET - Retrieve user data or shared sheet
    // ============================================================
    if (req.method === 'GET') {
      const { shared, sheet: sheetId, thumbs: thumbIds } = req.query;
      const hash = accountHash(req.query);

      if (shared) {
        console.log(`[API] GET fetching shared sheet: ${shared}`);
        const doc = await getSharedDoc(shared);

        if (!doc || !doc.sheet) {
          return res.status(404).json({
            success: false,
            error: 'Shared sheet not found'
          });
        }

        return res.status(200).json({
          success: true,
          sheet: doc.sheet,
          sharedAt: doc.sharedAt
        });
      }

      if (!hash) {
        return res.status(400).json({
          success: false,
          error: 'Hash parameter is required'
        });
      }

      // Batched card thumbnails — one auth check, N records. Only ids the
      // account owns are served.
      if (thumbIds) {
        const userData = await getUserDoc(hash);
        if (!userData) {
          return res.status(404).json({
            success: false,
            error: 'User not found'
          });
        }

        const owned = new Map();
        for (const r of [...(userData.sheets || []), ...(userData.files || [])]) {
          if (r && r.id) owned.set(r.id, r);
        }

        const thumbnails = {};
        await Promise.all(thumbIds.split(',').slice(0, 100).map(async id => {
          if (!owned.has(id)) return;
          const record = owned.get(id);
          thumbnails[id] = record.thumbnail || await getThumb(id);
        }));

        return res.status(200).json({ success: true, thumbnails });
      }

      // A sheet's workbook body — the user doc only carries sheet metadata.
      if (sheetId) {
        const userData = await getUserDoc(hash);
        if (!userData) {
          return res.status(404).json({
            success: false,
            error: 'User not found'
          });
        }

        const record = (userData.sheets || []).find(s => s.id === sheetId);
        if (!record) {
          return res.status(404).json({
            success: false,
            error: 'Sheet not found'
          });
        }

        const body = record.data !== undefined
          ? record.data
          : await getSheetBody(sheetId);

        return res.status(200).json({ success: true, data: body });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      return res.status(200).json({ success: true, data: userData });
    }

    // ============================================================
    // POST - Login or Create Account
    // ============================================================
    if (req.method === 'POST') {
      const { key, action } = req.body;

      // CHANGE KEY — current key or hash identifies the account;
      // data.newKey becomes the login key.
      if (action === 'changeKey') {
        const currentHash = accountHash(req.body);
        if (!currentHash) {
          return res.status(400).json({
            success: false,
            error: 'Key or hash is required'
          });
        }

        const newKey = req.body?.data?.newKey;
        if (!newKey || typeof newKey !== 'string' || !newKey.trim()) {
          return res.status(400).json({
            success: false,
            error: 'New key is required'
          });
        }

        const result = await changeUserKey(currentHash, newKey.trim());
        if (!result.ok) {
          const failure = {
            SAME_KEY: [400, 'New key must be different from the current key'],
            NOT_FOUND: [404, 'User not found'],
            KEY_TAKEN: [409, 'That key is already in use by another account'],
            SAVE_FAILED: [500, 'Failed to change key']
          }[result.code] || [500, 'Failed to change key'];
          return res.status(failure[0]).json({ success: false, error: failure[1] });
        }
        return res.status(200).json({
          success: true,
          hash: result.hash,
          data: result.doc,
          message: 'Key changed successfully'
        });
      }

      if (!key || typeof key !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Invalid key format'
        });
      }

      const normalizedKey = key.trim();
      if (normalizedKey === '') {
        return res.status(400).json({
          success: false,
          error: 'Key cannot be empty'
        });
      }

      const hash = generateHash(normalizedKey);

      if (action === 'login') {
        const userData = await getUserDoc(hash);
        if (!userData) {
          return res.status(404).json({
            success: false,
            error: 'User not found'
          });
        }
        return res.status(200).json({
          success: true,
          hash,
          data: userData,
          message: 'Login successful'
        });
      }

      if (action === 'create') {
        const result = await createUserDoc(hash, { theme: 'light' });
        if (!result.ok) {
          if (result.code === 'USER_EXISTS') {
            return res.status(409).json({
              success: false,
              error: 'User already exists'
            });
          }
          return res.status(500).json({
            success: false,
            error: 'Failed to create account'
          });
        }
        return res.status(201).json({
          success: true,
          hash,
          data: result.doc,
          message: 'Account created successfully'
        });
      }

      return res.status(400).json({
        success: false,
        error: 'Invalid action. Use "login" or "create"'
      });
    }

    // ============================================================
    // PUT - Update user data
    // ============================================================
    if (req.method === 'PUT') {
      const { action, data } = req.body;
      const hash = accountHash(req.body);

      if (!hash) {
        return res.status(400).json({
          success: false,
          error: 'Hash is required'
        });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // UPDATE SPREADSHEET DATA
      if (action === 'updateSheet') {
        const { sheetId, sheetData } = data;

        if (!userData.sheets) {
          userData.sheets = [];
        }

        // The workbook body goes to its own record; the user doc keeps
        // metadata. Legacy inline bodies migrate here too, so the first
        // save after this change shrinks the account document.
        await migrateSheetBodies(userData);

        const { data: body, thumbnail, ...sheetMeta } = sheetData || {};
        if (body !== undefined && !(await putSheetBody(sheetId, body))) {
          return res.status(500).json({
            success: false,
            error: 'Failed to update sheet'
          });
        }

        // Thumbnails live in their own record. An omitted thumbnail keeps
        // the previous one (the editor omits it when capture fails).
        let thumbSaved = true;
        if (VALID_THUMB(thumbnail)) {
          thumbSaved = await putThumb(sheetId, thumbnail);
          sheetMeta.thumbRef = 1;
        }

        const existingIndex = userData.sheets.findIndex(
          s => s.id === sheetId
        );

        let sheetRecord;
        if (existingIndex >= 0) {
          sheetRecord = {
            ...userData.sheets[existingIndex],
            ...sheetMeta,
            id: sheetId,
            updatedAt: new Date().toISOString()
          };
          userData.sheets[existingIndex] = sheetRecord;
        } else {
          sheetRecord = {
            id: sheetId,
            ...sheetMeta,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          userData.sheets.push(sheetRecord);
        }

        // Keep any existing share link in step with the edit (docs-style
        // mirror). A failed re-sync must not fail the save.
        if (sheetRecord.sharedId) {
          try {
            const synced = await putSharedDoc(sheetRecord.sharedId, {
              sheet: await buildSharedSheetRecord(sheetRecord, body),
              sharedAt: new Date().toISOString()
            });
            if (!synced) console.error('[API] Failed to update shared copy');
          } catch (e) {
            console.error('[API] Failed to update shared copy:', e);
          }
        }

        const saved = thumbSaved && await saveSheetsSections(hash, userData);
        if (saved) {
          return res.status(200).json({ success: true, data: userData });
        }
        return res.status(500).json({
          success: false,
          error: 'Failed to update sheet'
        });
      }

      // DELETE SPREADSHEET
      if (action === 'deleteSheet') {
        const { sheetId } = data;

        const sheetToDelete = userData.sheets.find(
          s => s.id === sheetId
        );

        if (sheetToDelete?.sharedId) {
          try {
            await deleteSharedDoc(sheetToDelete.sharedId);
          } catch (e) {
            console.error('[API] Failed to delete shared copy:', e);
          }
        }

        try {
          await deleteSheetBody(sheetId);
        } catch (e) {
          console.error('[API] Failed to delete sheet body:', e);
        }

        try {
          await deleteThumb(sheetId);
        } catch (e) {
          console.error('[API] Failed to delete sheet thumbnail:', e);
        }

        userData.sheets = userData.sheets.filter(
          s => s.id !== sheetId
        );

        const saved = await saveSheetsSections(hash, userData);
        if (saved) {
          return res.status(200).json({ success: true, data: userData });
        }
        return res.status(500).json({
          success: false,
          error: 'Failed to delete sheet'
        });
      }

      // UPDATE SETTINGS
      if (action === 'updateSettings') {
        userData.settings = {
          ...userData.settings,
          ...data.settings,
          updatedAt: new Date().toISOString()
        };

        const saved = await saveSheetsSections(hash, userData);
        if (saved) {
          return res.status(200).json({ success: true, data: userData });
        }
        return res.status(500).json({
          success: false,
          error: 'Failed to update settings'
        });
      }

      // SHARE SPREADSHEET
      if (action === 'shareSheet') {
        const { sheetId } = data;

        const sheetIndex = userData.sheets.findIndex(
          s => s.id === sheetId
        );

        if (sheetIndex === -1) {
          return res.status(404).json({
            success: false,
            error: 'Sheet not found'
          });
        }

        const baseUrl = getBaseUrl(req);

        if (userData.sheets[sheetIndex].sharedId) {
          const existingShareId = userData.sheets[sheetIndex].sharedId;
          return res.status(200).json({
            success: true,
            shareId: existingShareId,
            shareUrl: `${baseUrl}/sheets/shared.html?shared=${existingShareId}`,
            alreadyShared: true
          });
        }

        const newShareId = generateId();
        const shareData = {
          sheet: await buildSharedSheetRecord(userData.sheets[sheetIndex]),
          sharedAt: new Date().toISOString()
        };

        const stored = await putSharedDoc(newShareId, shareData);
        if (!stored) {
          return res.status(500).json({
            success: false,
            error: 'Failed to create share'
          });
        }

        userData.sheets[sheetIndex].sharedId = newShareId;
        const saved = await saveSheetsSections(hash, userData);

        if (!saved) {
          return res.status(500).json({
            success: false,
            error: 'Failed to update sheet'
          });
        }

        return res.status(200).json({
          success: true,
          shareId: newShareId,
          shareUrl: `${baseUrl}/sheets/shared.html?shared=${newShareId}`,
          alreadyShared: false
        });
      }

      return res.status(400).json({
        success: false,
        error: 'Invalid action'
      });
    }

    // ============================================================
    // DELETE - Delete user account
    // ============================================================
    if (req.method === 'DELETE') {
      const hash = accountHash(req.query);

      if (!hash) {
        return res.status(400).json({
          success: false,
          error: 'Hash is required'
        });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const deleted = await deleteUserDoc(hash);
      if (deleted) {
        return res.status(200).json({
          success: true,
          message: 'Account deleted successfully'
        });
      }
      return res.status(500).json({
        success: false,
        error: 'Failed to delete account'
      });
    }

    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  } catch (error) {
    console.error('[API] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}
