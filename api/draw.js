/**
 * ================================================
 * DRAW - Unified User API
 * ================================================
 *
 * Storage (via api/_lib/store.js — 'draws' is a registered section, so
 * saves merge correctly and never wipe the other sections):
 *   development -> local JSON files under db/users/{hash}.json
 *                  (NODE_ENV=development, server/dev-server.js)
 *   production  -> textdb.dev documents keyed by the user hash
 *                  (Vercel picks this file up as the /api/draw function
 *                  automatically — vercel.json's /api/* rewrite covers it)
 *
 * The unified user document's `draws` array holds DRAWING records — the
 * schema is documented at the top of draw/js/storage.js:
 *
 *   { id, name, formatVersion, background,
 *     objects: [ ...fabric object JSON (canvas.toObject().objects) ],
 *     viewport: { zoom, panX, panY },
 *     sharedId, createdAt, updatedAt }
 *
 * Request shapes:
 *   GET  ?hash=<hash>                       -> whole user document
 *   GET  ?shared=<shareId>                  -> { drawing, sharedAt } (PUBLIC:
 *                                              the drawing snapshot only —
 *                                              NEVER the user hash or any
 *                                              owner data)
 *   POST { key, action: 'login'|'create' }  -> auth 
 *   PUT  { hash, action, data }             -> owner operations:
 *       updateDrawing   { drawingId, drawingData } -> upsert the drawing
 *                                              record (drawingData is the
 *                                              FULL record incl. objects
 *                                              and viewport)
 *       deleteDrawing   { drawingId }       -> delete drawing + its shared copy
 *       updateSettings  { settings }        -> merge into user settings
 *       shareDrawing    { drawingId }       -> create/reuse the share link
 *                                              (snapshot = deep copy of the
 *                                              drawing minus sharedId; add a
 *                                              'refreshShare' action later
 *                                              if you want re-sync)
 *   DELETE ?hash=<hash>                     -> delete account
 *
 * NOTE — the landing page's "+ New drawing" flow does NOT go through
 * this file; it uses a separate createDrawing action
 * ================================================
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

async function saveDrawSections(hash, userData) {
  return saveOwnedSections(hash, {
    draws: userData.draws,
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
    // GET - user data, or a shared drawing snapshot
    // ============================================================
    if (req.method === 'GET') {
      const { hash, shared } = req.query;

      // --- Shared drawing (public: viewers have no hash) ---
      if (shared) {
        const doc = await getSharedDoc(shared);

        if (!doc || !doc.drawing) {
          return res.status(404).json({ success: false, error: 'Shared drawing not found' });
        }
        return res.status(200).json({ success: true, drawing: doc.drawing, sharedAt: doc.sharedAt });
      }

      if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash parameter is required' });
      }
      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      return res.status(200).json({ success: true, data: userData });
    }

    // ============================================================
    // POST - login / create account
    // ============================================================
    if (req.method === 'POST') {
      const { key, action } = req.body || {};
      if (!key || typeof key !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid key format' });
      }

      const normalizedKey = key.trim();
      if (normalizedKey === '') {
        return res.status(400).json({ success: false, error: 'Key cannot be empty' });
      }

      const hash = generateHash(normalizedKey);
      if (action === 'login') {
        const userData = await getUserDoc(hash);
        if (!userData) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        return res.status(200).json({ success: true, hash, data: userData, message: 'Login Successful' });
      }
      if (action === 'create') {
        const result = await createUserDoc(hash, { theme: 'dark' });
        if (!result.ok) {
          if (result.code === 'USER_EXISTS') {
            return res.status(409).json({ success: false, error: 'User already exists' });
          }
          return res.status(500).json({ success: false, error: 'Failed to create account' });
        }
        return res.status(201).json({ success: true, hash, data: result.doc, message: 'Account created successfully' });
      }
      return res.status(400).json({ success: false, error: 'Invalid action. Use "login" or "create"' });
    }

    // ============================================================
    // PUT - owner operations on the unified document
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

      // --- UPDATE DRAWING (the autosave / Ctrl+S path) ---
      if (action === 'updateDrawing') {
        const { drawingId, drawingData } = data || {};

        if (!drawingId || !drawingData || typeof drawingData !== 'object') {
          return res.status(400).json({ success: false, error: 'drawingId and drawingData required' });
        }
        const existingIndex = userData.draws.findIndex(d => d.id === drawingId);
        if (existingIndex >= 0) {
          userData.draws[existingIndex] = {
            ...userData.draws[existingIndex],
            ...drawingData,
            id: drawingId,
            updatedAt: new Date().toISOString()
          };
        } else {
          userData.draws.push({
            id: drawingId,
            sharedId: null,
            ...drawingData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }

        const saved = await saveDrawSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update drawing' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // --- DELETE DRAWING (also removes the shared copy) ---
      if (action === 'deleteDrawing') {
        const { drawingId } = data || {};
        const drawingToDelete = userData.draws.find(d => d.id === drawingId);
        if (drawingToDelete?.sharedId) {
          try {
            await deleteSharedDoc(drawingToDelete.sharedId);
          } catch (error) {
            console.error('[DRAW API] Failed to delete shared copy:', error);
          }
        }
        userData.draws = userData.draws.filter(d => d.id !== drawingId);
        const saved = await saveDrawSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to delete drawing' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // --- UPDATE SETTINGS (theme, etc.) ---
      if (action === 'updateSettings') {
        userData.settings = {
          ...userData.settings,
          ...data.settings,
          updatedAt: new Date().toISOString()
        };
        const saved = await saveDrawSections(hash, userData);
        if (saved) {
          return res.status(200).json({ success: true, data: userData });
        }
        return res.status(500).json({
          success: false,
          error: 'Failed to update settings'
        });
      }

      // --- SHARE DRAWING (create or reuse the public view link) ---
      if (action === 'shareDrawing') {
        const { drawingId } = data || {};
        const drawingIndex = userData.draws.findIndex(d => d.id === drawingId);
        if (drawingIndex === -1) {
          return res.status(404).json({ success: false, error: 'Drawing not found' });
        }
        const baseUrl = getBaseUrl(req);
        if (userData.draws[drawingIndex].sharedId) {
          const existingShareId = userData.draws[drawingIndex].sharedId;
          return res.status(200).json({ success: true, shareId: existingShareId, shareUrl: `${baseUrl}/draw/shared.html?shared=${existingShareId}`, alreadyShared: true });
        }
        const newShareId = generateId();
        const snapshot = JSON.parse(JSON.stringify(userData.draws[drawingIndex]));
        delete snapshot.sharedId;
        const sharedData = { drawing: snapshot, sharedAt: new Date().toISOString() };

        const stored = await putSharedDoc(newShareId, sharedData);
        if (!stored) {
          return res.status(500).json({ success: false, error: 'Failed to create share' });
        }

        userData.draws[drawingIndex].sharedId = newShareId;
        const saved = await saveDrawSections(hash, userData);

        if (!saved) {
          return res.status(500).json({
            success: false,
            error: 'Failed to update drawing'
          });
        }
        return res.status(200).json({
          success: true,
          shareId: newShareId,
          shareUrl: `${baseUrl}/draw/shared.html?shared=${newShareId}`,
          alreadyShared: false
        });
      }
      return res.status(400).json({
        success: false,
        error: 'Invalid action'
      });
    }

    // ============================================================
    // DELETE - delete user account
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
    console.error('[DRAW API] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}