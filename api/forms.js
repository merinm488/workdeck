/**
 * ================================================
 * FORMS - Unified User API (Workdeck version)
 * ================================================
 *
 * Port of the Sheets API (api/users.js) for the Forms app, with one extra
 * capability: form RESPONSES. Anyone with the share link can fill out and
 * submit a form — responders never need an account.
 *
 * Storage (via api/_lib/store.js):
 *   development -> local JSON files under db/
 *   production  -> textdb.dev documents
 *
 * The unified user document gains a `forms` array:
 *   { docs, tags, sheets, forms, settings }
 * Saves are section-merged, so form writes never wipe docs/sheets.
 *
 * Request shapes:
 *   GET  ?hash=<hash>                       -> whole user document
 *   GET  ?shared=<shareId>                  -> { form, sharedAt }  (PUBLIC:
 *                                              questions only — never responses)
 *   POST { key, action: 'login'|'create' }  -> auth (same as Sheets)
 *   POST { shareId, action: 'submitResponse', data: { response } }
 *                                           -> PUBLIC: append a submission
 *   PUT  { hash, action, data }             -> owner operations (below)
 *   DELETE ?hash=<hash>                     -> delete account
 *
 * PUT actions:
 *   updateForm      { formId, formData }   -> upsert the form record
 *   deleteForm      { formId }             -> delete form + its shared copy
 *   updateSettings  { settings }           -> merge into user settings
 *   shareForm       { formId }             -> create/reuse the share link
 *   getResponses    { formId }             -> { responses, form } — the form
 *                                            is the SHARED snapshot, i.e. the
 *                                            exact questions responders saw.
 *                                            (OWNER ONLY — requires hash)
 *   deleteResponses { formId }             -> clear all responses for a form
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

/** Persist only the sections Forms owns (forms) + settings changes. */
async function saveFormsSections(hash, userData) {
  return saveOwnedSections(hash, {
    forms: userData.forms,
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
    // GET - user data, or a shared form (+ its responses)
    // ============================================================
    if (req.method === 'GET') {
      const { hash, shared } = req.query;

      // --- Shared form (public: responders have no hash) ---
      if (shared) {
        const doc = await getSharedDoc(shared);

        if (!doc || !doc.form) {
          return res.status(404).json({
            success: false,
            error: 'Shared form not found'
          });
        }

        // SECURITY: responses are NEVER sent over the public link — the
        // owner reads them via the authenticated `getResponses` PUT action.
        return res.status(200).json({
          success: true,
          form: doc.form,
          sharedAt: doc.sharedAt
        });
      }

      // --- Owner data (same contract as Sheets) ---
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
    // POST - login/create account, OR public response submission
    // ============================================================
    if (req.method === 'POST') {
      const { key, action, shareId, data } = req.body || {};

      // --- PUBLIC: append a response to a shared form ---
      // Distinguished from auth by the `submitResponse` action. No hash —
      // the shareId IS the authorization (same as opening the share link).
      if (action === 'submitResponse') {
        if (!shareId) {
          return res.status(400).json({
            success: false,
            error: 'shareId is required'
          });
        }
        if (!data || typeof data.response !== 'object' || data.response === null) {
          return res.status(400).json({
            success: false,
            error: 'response object is required'
          });
        }

        const sharedDoc = await getSharedDoc(shareId);
        if (!sharedDoc || !sharedDoc.form) {
          return res.status(404).json({
            success: false,
            error: 'Shared form not found'
          });
        }

        // Initialize the responses array and append this submission.
        sharedDoc.responses = sharedDoc.responses || [];
        sharedDoc.responses.push({
          id: generateId(),
          submittedAt: new Date().toISOString(),
          ...data.response
        });

        const stored = await putSharedDoc(shareId, sharedDoc);
        if (!stored) {
          return res.status(500).json({
            success: false,
            error: 'Failed to save response'
          });
        }

        return res.status(201).json({
          success: true,
          message: 'Response submitted'
        });
      }

      // --- AUTH (identical contract to Sheets) ---
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
        const result = await createUserDoc(hash, { theme: 'dark' });
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
        error: 'Invalid action. Use "login", "create" or "submitResponse"'
      });
    }

    // ============================================================
    // PUT - owner operations on the unified document
    // ============================================================
    if (req.method === 'PUT') {
      const { hash, action, data } = req.body || {};

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

      // UPDATE FORM DATA — upserts the whole form record (name, display,
      // components). 
      if (action === 'updateForm') {
        const { formId, formData } = data || {};

        if (!formId || !formData || typeof formData !== 'object') {
          return res.status(400).json({
            success: false,
            error: 'formId and formData are required'
          });
        }

        if (!userData.forms) {
          userData.forms = [];
        }

        const existingIndex = userData.forms.findIndex(f => f.id === formId);

        if (existingIndex >= 0) {
          userData.forms[existingIndex] = {
            ...userData.forms[existingIndex],
            ...formData,
            id: formId,
            updatedAt: new Date().toISOString()
          };
        } else {
          userData.forms.push({
            id: formId,
            sharedId: null,
            ...formData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }

        const saved = await saveFormsSections(hash, userData);
        if (saved) {
          return res.status(200).json({ success: true, data: userData });
        }
        return res.status(500).json({
          success: false,
          error: 'Failed to update form'
        });
      }

      // DELETE FORM — also removes the shared copy (and its responses).
      if (action === 'deleteForm') {
        const { formId } = data || {};

        const formToDelete = userData.forms.find(f => f.id === formId);

        if (formToDelete?.sharedId) {
          try {
            await deleteSharedDoc(formToDelete.sharedId);
          } catch (e) {
            console.error('[FORMS API] Failed to delete shared copy:', e);
          }
        }

        userData.forms = userData.forms.filter(f => f.id !== formId);

        const saved = await saveFormsSections(hash, userData);
        if (saved) {
          return res.status(200).json({ success: true, data: userData });
        }
        return res.status(500).json({
          success: false,
          error: 'Failed to delete form'
        });
      }

      // UPDATE SETTINGS (theme, etc.) — same as Sheets
      if (action === 'updateSettings') {
        userData.settings = {
          ...userData.settings,
          ...data.settings,
          updatedAt: new Date().toISOString()
        };

        const saved = await saveFormsSections(hash, userData);
        if (saved) {
          return res.status(200).json({ success: true, data: userData });
        }
        return res.status(500).json({
          success: false,
          error: 'Failed to update settings'
        });
      }

      // SHARE FORM — creates (or reuses) a public link. The shared doc holds
      // a snapshot of the form PLUS every response submitted against it.
      if (action === 'shareForm') {
        const { formId } = data || {};

        const formIndex = userData.forms.findIndex(f => f.id === formId);

        if (formIndex === -1) {
          return res.status(404).json({
            success: false,
            error: 'Form not found'
          });
        }

        const baseUrl = getBaseUrl(req);

        // Already shared: hand back the existing link.
        if (userData.forms[formIndex].sharedId) {
          const existingShareId = userData.forms[formIndex].sharedId;
          return res.status(200).json({
            success: true,
            shareId: existingShareId,
            shareUrl: `${baseUrl}/forms/shared.html?shared=${existingShareId}`,
            alreadyShared: true
          });
        }

        // New share: snapshot the form into a public document.
        const newShareId = generateId();
        const shareData = {
          form: userData.forms[formIndex],
          responses: [],
          sharedAt: new Date().toISOString()
        };

        const stored = await putSharedDoc(newShareId, shareData);
        if (!stored) {
          return res.status(500).json({
            success: false,
            error: 'Failed to create share'
          });
        }

        userData.forms[formIndex].sharedId = newShareId;
        const saved = await saveFormsSections(hash, userData);

        if (!saved) {
          return res.status(500).json({
            success: false,
            error: 'Failed to update form'
          });
        }

        return res.status(200).json({
          success: true,
          shareId: newShareId,
          shareUrl: `${baseUrl}/forms/shared.html?shared=${newShareId}`,
          alreadyShared: false
        });
      }

      // GET RESPONSES — the owner reads submissions for one of their forms.
      // Runs inside the PUT branch, so the hash above was already required
      // and checked: this is the OWNER-ONLY door to responses.
      if (action === 'getResponses') {
        const { formId } = data || {};

        // 1. Find this form in the user's own document.
        //    (Array.prototype.find returns the form record — which holds the
        //    form's `sharedId` — or undefined when formId isn't one of ours.)
        //    Guard: reject with 404 { success:false, error:'Form not found' }
        //    when it isn't found. Look at how `deleteForm` above does exactly
        //    this with `userData.forms.find(...)`.
        const form = userData.forms.find(f => f.id === formId);
        if (!form){
          return res.status(404).json({success:false, error:'Form not found'});
        }

        // 2. No share link yet -> the form was never shared, so it cannot
        //    have responses. Return success with an EMPTY array (that's not
        //    an error — the UI shows an empty state).
        if (!form.sharedId) {
          return res.status(200).json({
            success: true,
            responses: [],
            form: null
          });
        }

        // 3. Fetch the shared document: `getSharedDoc(form.sharedId)` is
        //    already imported at the top of this file.
        const sharedDoc = await getSharedDoc(form.sharedId);

        // 4. Send the responses back. Mimic the shape of the old public GET:
        //      res.status(200).json({
        //        success: true,
        //        responses: ...,
        //        form: ...
        //      });
        //    Responses come from `sharedDoc.responses` (may be undefined on an
        //    old share — use `|| []` so the client always gets an array).
        //    Also return `form: sharedDoc.form` — the SHARED snapshot, i.e.
        //    the exact questions responders saw (the owner may have edited
        //    the form since sharing; the summary must match what was asked).
        return res.status(200).json({
          success: true,
          responses: sharedDoc.responses || [],
          form: sharedDoc.form
        });
      }

      // DELETE RESPONSES — clear all submissions for a shared form while
      // keeping the form and its share link intact.
      if (action === 'deleteResponses') {
        const { formId } = data || {};

        const form = userData.forms.find(f => f.id === formId);
        if (!form) {
          return res.status(404).json({
            success: false,
            error: 'Form not found'
          });
        }

        if (form.sharedId) {
          const sharedDoc = await getSharedDoc(form.sharedId);
          if (sharedDoc) {
            sharedDoc.responses = [];
            const cleared = await putSharedDoc(form.sharedId, sharedDoc);
            if (!cleared) {
              return res.status(500).json({
                success: false,
                error: 'Failed to clear responses'
              });
            }
          }
        }

        return res.status(200).json({ success: true, message: 'Responses cleared' });
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
    console.error('[FORMS API] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}
