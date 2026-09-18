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
  deleteUserDoc,
  putSharedDoc,
  getSharedDoc,
  deleteSharedDoc,
  getBaseUrl,
  applyCorsHeaders
} from './_lib/store.js';

/** Persist only the sections Sheets owns (sheets) + settings changes. */
async function saveSheetsSections(hash, userData) {
  return saveOwnedSections(hash, {
    sheets: userData.sheets,
    settings: userData.settings
  });
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
      const { hash, shared } = req.query;

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
      const { hash, action, data } = req.body;

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

        const existingIndex = userData.sheets.findIndex(
          s => s.id === sheetId
        );

        if (existingIndex >= 0) {
          userData.sheets[existingIndex] = {
            ...userData.sheets[existingIndex],
            ...sheetData,
            id: sheetId,
            updatedAt: new Date().toISOString()
          };
        } else {
          userData.sheets.push({
            id: sheetId,
            ...sheetData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }

        const saved = await saveSheetsSections(hash, userData);
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
          sheet: userData.sheets[sheetIndex],
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
      const { hash } = req.query;

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
