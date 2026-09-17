/**
 * ================================================
 * SLIDES - Unified User API  
 * ================================================
 *
 * Storage (via api/_lib/store.js — already registered with the `slides`
 * section, so saves merge correctly and never wipe docs/sheets/forms):
 *   development -> local JSON files under db/users/{hash}.json
 *                  (NODE_ENV=development, server/dev-server.js)
 *   production  -> textdb.dev documents keyed by the user hash
 *                  (Vercel picks this file up as the /api/slides function
 *                  automatically — vercel.json's /api/* rewrite covers it)
 *
 * The unified user document's `slides` array holds DECK records — the
 * schema is documented at the top of slides/js/storage.js and is the same
 * shape slides/templates/*.json use:
 *
 *   { id, name, formatVersion, width, height,
 *     slides: [{ id, name, background, objects: [...] }],
 *     sharedId, createdAt, updatedAt }
 *
 * Request shapes (mirror forms.js):
 *   GET  ?hash=<hash>                       -> whole user document
 *   GET  ?shared=<shareId>                  -> { deck, sharedAt }  (PUBLIC:
 *                                              the deck snapshot only —
 *                                              NEVER the user hash or any
 *                                              owner data)
 *   POST { key, action: 'login'|'create' }  -> auth (copy from forms.js)
 *   PUT  { hash, action, data }             -> owner operations:
 *       updateDeck     { deckId, deckData }  -> upsert the deck record
 *                                              (deckData is the FULL deck
 *                                              incl. every slide's objects)
 *       deleteDeck     { deckId }            -> delete deck + its shared copy
 *       updateSettings { settings }          -> merge into user settings
 *       shareDeck      { deckId }            -> create/reuse the share link
 *                                              (snapshot = deep copy of the
 *                                              deck minus sharedId; add a
 *                                              'refreshShare' action later
 *                                              if you want re-sync)
 *   DELETE ?hash=<hash>                     -> delete account
 *
 * NOTE — the Workdeck landing page's "+ New deck" flow does NOT go through
 * this file; it hits api/workdeck.js with action 'createDeck' (you add that
 * case there, mirroring 'createForm' — snippet in the Slides README section).
 *
 * Every branch below currently answers 501 so server/dev-server.js boots
 * cleanly today; replace each stub with the forms.js equivalent.
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

async function saveSlidesSections(hash, userData) {
  return saveOwnedSections(hash, {
    slides: userData.slides,
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
    // GET - user data, or a shared deck snapshot
    // ============================================================
    if (req.method === 'GET') {
      const { hash, shared } = req.query;

      // --- Shared deck (public: viewers have no hash) ---

      if(shared){
        const doc = await getSharedDoc(shared);

        if(!doc || !doc.deck){
          return res.status(404).json({success:false, error: 'Shared deck not found'});
        }
        return res.status(200).json({success: true, deck: doc.deck, sharedAt: doc.sharedAt});
      }
      if(!hash){
        return res.status(400).json({success: false, error: 'Hash parameter is required'});
      }
      const userData = await getUserDoc(hash);
      if(!userData){
        return res.status(404).json({success: false, error: 'User not found'});
      }
      return res.status(200).json({success: true, data: userData});
    }

    // ============================================================
    // POST - login / create account
    // ============================================================
    if (req.method === 'POST') {
      const { key, action } = req.body || {};
      if(!key || typeof key != 'string'){
        return res.status(400).json({success: false, error: 'Invalid key format'});
      }

      const normalizedKey = key.trim();
      if(normalizedKey === ''){
        return res.status(400).json({success: false, error: 'Key cannot be empty'});
      }

      const hash = generateHash(normalizedKey);
      if (action === 'login'){
        const userData = await getUserDoc(hash);
        if(!userData){
          return res.status(404).json({success: false, error: 'User not found'});
        }
        return res.status(200).json({success: true, hash, data: userData, message: 'Login Successful'});
      }
      if (action === 'create'){
        const result = await createUserDoc(hash, {theme: 'dark'});
        if(!result.ok){
          if(result.code === 'USER_EXISTS'){
            return res.status(409).json({success:false,error: 'User already exists'});
          }
          return res.status(500).json({success: false, error: 'Failed to create account'});
        }
        return res.status(201).json({success: true, hash, data: result.doc, message: 'Account created successfully'});
      }
      return res.status(400).json({success: false, error: 'Invalid action. Use "login" or "create"'});
    } 


    // ============================================================
    // PUT - owner operations on the unified document
    // ============================================================
    if (req.method === 'PUT') {
      const { hash, action, data } = req.body || {};

      if(!hash){
        return res.status(400).json({success: false, error: 'Hash is required'});
      }
      const userData = await getUserDoc(hash);
      if(!userData){
        return res.status(404).json({success: false, error: 'User not found'});
      }

      // --- UPDATE DECK (the autosave / Ctrl+S path) ---
      if (action === 'updateDeck') {
        const {deckId, deckData} = data || {};

        if(!deckId || !deckData || typeof deckData !== 'object'){
         return res.status(400).json({success: false, error: 'deckId and deckData required'}); 
        }
        const existingIndex =  userData.slides.findIndex(d => d.id === deckId);
        if(existingIndex >=0){
          userData.slides[existingIndex] = {
            ...userData.slides[existingIndex],
            ...deckData,
            id: deckId,
            updatedAt: new Date().toISOString()
          }
        } else {
          userData.slides.push({
            id: deckId,
            sharedId: null,
            ...deckData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }

        const saved = await saveSlidesSections(hash, userData);
        if(!saved){
          return res.status(500).json({success: false, error: 'Failed to update deck'});
        }
        return res.status(200).json({success: true, data: userData});
      }

      // --- DELETE DECK (also removes the shared copy) ---
      if (action === 'deleteDeck') {
        const {deckId} = data || {};
        const deckToDelete = userData.slides.find(d => d.id === deckId);
        if(deckToDelete?.sharedId){
          try{
            await deleteSharedDoc(deckToDelete.sharedId)
          }catch(error){
            console.error('[SLIDES API] Failed to delete shared copy:', error);
          }
        }
        userData.slides = userData.slides.filter(d => d.id !== deckId);
        const saved = await saveSlidesSections(hash,userData);
        if(!saved){
          return res.status(500).json({success:false, error: 'Failed to delete deck'});
        }
        return res.status(200).json({success:true, data: userData});
      }

      // --- UPDATE SETTINGS (theme, etc.) ---
      if (action === 'updateSettings') {
        userData.settings = {
          ...userData.settings,
          ...data.settings,
          updatedAt: new Date().toISOString()
        };
        const saved = await saveSlidesSections(hash, userData);
        if (saved) {
          return res.status(200).json({ success: true, data: userData });
        }
        return res.status(500).json({
          success: false,
          error: 'Failed to update settings'
        });
      }

      // --- SHARE DECK (create or reuse the public view link) ---
      if (action === 'shareDeck') {
        const {deckId} = data || {};
        const deckIndex = userData.slides.findIndex(d => d.id === deckId);
        if (deckIndex === -1){
          return res.status(404).json({success:false, error: 'Deck not found'});
        }
        const baseUrl = getBaseUrl(req);
        if(userData.slides[deckIndex].sharedId){
          const existingShareId = userData.slides[deckIndex].sharedId;
          return res.status(200).json({success:true, shareId: existingShareId, shareUrl: `${baseUrl}/slides/shared.html?shared=${existingShareId}`, alreadyShared: true});
        }
        const newShareId = generateId();
        const snapshot = JSON.parse(JSON.stringify(userData.slides[deckIndex]));
        delete snapshot.sharedId;
        const sharedData = { deck: snapshot, sharedAt: new Date().toISOString() };
        
        const stored = await putSharedDoc(newShareId, sharedData);
        if (!stored) {
          return res.status(500).json({ success: false, error: 'Failed to create share' });
        }

        userData.slides[deckIndex].sharedId = newShareId;
        const saved = await saveSlidesSections(hash, userData);

        if (!saved) {
          return res.status(500).json({
            success: false,
            error: 'Failed to update deck'
          });
        }
        return res.status(200).json({
          success: true,
          shareId: newShareId,
          shareUrl: `${baseUrl}/slides/shared.html?shared=${newShareId}`, 
          alreadyShared: false
        })
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
    console.error('[SLIDES API] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}
