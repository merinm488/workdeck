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
 *   getResponses    { formId }             -> { responses, form, linkedSheet }
 *                                            — the form is the SHARED snapshot,
 *                                            i.e. the exact questions responders
 *                                            saw. Also mirrors any new
 *                                            responses into the linked
 *                                            spreadsheet (sync-on-open).
 *                                            (OWNER ONLY — requires hash)
 *   deleteResponses { formId }             -> clear all responses for a form
 *                                            (spreadsheet rows are kept)
 *   linkSheet       { formId }             -> create a spreadsheet in the
 *                                            user's Sheets app named
 *                                            "<Form> (Responses)", backfill
 *                                            existing responses, and record
 *                                            form.linkedSheet
 *   unlinkSheet     { formId }             -> drop form.linkedSheet; the
 *                                            spreadsheet and its rows stay
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
// Linked spreadsheet (Google-Forms-style "Link to Sheets")
// A form can be linked to one spreadsheet in the user's `sheets[]`. The
// link state lives ONLY on the private form record — never in the public
// shared doc, which anyone with the share link can read (the user hash IS
// the account credential). Sync therefore runs exclusively inside
// owner-authenticated PUT actions: at link time and on every `getResponses`.
// ================================================

/** Component types that carry no answer and get no spreadsheet column. */
const SHEET_SKIP_TYPES = new Set([
  'button', 'hidden',
  // presentation-only components
  'text', 'image', 'html', 'separator', 'spacer', 'documentPreview',
  'iframe', 'table'
]);

/** Univer cell type codes (@univerjs/core CellValueType). */
const CELL_STRING = 1;
const CELL_NUMBER = 2;

/**
 * Depth-first walk of the form-js component tree — same traversal as
 * FormsResponsesView.flattenComponents() in forms/js/responses.js.
 */
function flattenComponents(components) {
  const out = [];
  const walk = (list) => {
    for (const c of list || []) {
      if (!c) continue;
      if (c.components) {
        walk(c.components);
      } else {
        out.push(c);
      }
    }
  };
  walk(components || []);
  return out;
}

/**
 * Ordered spreadsheet columns for a form snapshot: Timestamp first, then
 * one column per answerable question. Columns are APPEND-ONLY across
 * syncs (see syncFormResponsesToSheet) — never reordered — so existing
 * rows stay aligned when the owner edits the form.
 * @returns {Array<{key: string, label: string}>}
 */
function buildColumns(components) {
  return flattenComponents(components)
    .filter(c => c.type && c.key && !SHEET_SKIP_TYPES.has(c.type))
    .map(c => ({ key: c.key, label: c.label || c.key }));
}

/**
 * Map of questionKey -> options array, so submitted option VALUES ('red')
 * can be written as their human LABELS ('Red') — the same resolution the
 * responses view does client-side. Options live top-level on form-js
 * components and under data.values on legacy survey fields.
 */
function buildOptionsByKey(components) {
  const map = {};
  for (const c of flattenComponents(components)) {
    if (!c || !c.key) continue;
    const options = c.values || c.data?.values;
    if (Array.isArray(options) && options.length > 0) {
      map[c.key] = options;
    }
  }
  return map;
}

/**
 * One submitted answer -> a Univer cell ({v, t}) or null for "no answer".
 * Multi-select arrays join with ", "; booleans read as Yes/No; numbers
 * stay numeric so the sheet can sort them; option values resolve to
 * labels when `options` is supplied.
 */
function cellValueFor(answer, options) {
  if (answer === undefined || answer === null || answer === '') return null;
  if (Array.isArray(answer)) {
    const text = answer
      .map(item => {
        const cell = cellValueFor(item, options);
        return cell === null ? '' : String(cell.v);
      })
      .filter(s => s !== '')
      .join(', ');
    return { v: text, t: CELL_STRING };
  }
  if (typeof answer === 'boolean') {
    return { v: answer ? 'Yes' : 'No', t: CELL_STRING };
  }
  if (typeof answer === 'number' && Number.isFinite(answer)) {
    return { v: answer, t: CELL_NUMBER };
  }
  if (typeof answer === 'object') {
    return { v: JSON.stringify(answer), t: CELL_STRING };
  }
  if (options) {
    const match = options.find(
      opt => opt && (opt.value === answer || opt.label === answer)
    );
    if (match) {
      return { v: match.label, t: CELL_STRING };
    }
  }
  return { v: String(answer), t: CELL_STRING };
}

/**
 * Cell matrix for a set of responses, oldest first so the sheet reads
 * chronologically. Row = [Timestamp, ...one cell per column].
 */
function responseRows(columns, responses, optionsByKey = {}) {
  const ordered = [...(responses || [])].sort((a, b) =>
    String((a && a.submittedAt) || '').localeCompare(String((b && b.submittedAt) || ''))
  );
  return ordered.map(response => [
    { v: (response && response.submittedAt) || '', t: CELL_STRING },
    ...columns.map(col =>
      cellValueFor(
        response && response.data ? response.data[col.key] : undefined,
        optionsByKey[col.key]
      ))
  ]);
}

/** Write one row of cells into Univer's cellData (string keys, sparse). */
function writeRow(cellData, rowIndex, cells) {
  const row = {};
  cells.forEach((cell, colIndex) => {
    if (cell !== null) {
      row[String(colIndex)] = cell;
    }
  });
  if (Object.keys(row).length > 0) {
    cellData[String(rowIndex)] = row;
  }
}

/** Grow the worksheet grid so an append can never be silently clipped. */
function ensureSheetCapacity(worksheet, rowCount, columnCount) {
  worksheet.rowCount = Math.max(worksheet.rowCount || 84, rowCount);
  worksheet.columnCount = Math.max(worksheet.columnCount || 60, columnCount);
}

/**
 * Build a sheets-app spreadsheet record holding the header row + one row
 * per response. The snapshot shape matches what sheets/js/home.js creates
 * client-side (and api/workdeck.js server-side), so the Sheets editor
 * loads it without migration; `resources` is optional and omitted.
 */
function buildResponsesSheetRecord(sheetId, name, columns, responses, components) {
  const worksheetId = `sheet-${Date.now().toString(36)}`;
  const headers = ['Timestamp', ...columns.map(c => c.label)];
  const rows = responseRows(columns, responses, buildOptionsByKey(components));

  const cellData = {};
  writeRow(cellData, 0, headers.map(h => ({ v: h, t: CELL_STRING })));
  rows.forEach((cells, index) => writeRow(cellData, index + 1, cells));

  return {
    id: sheetId,
    name,
    formatVersion: 2,
    data: {
      id: `wb_${sheetId}`,
      name,
      appVersion: '0.25.1',
      locale: 'enUS',
      styles: {},
      sheetOrder: [worksheetId],
      sheets: {
        [worksheetId]: {
          id: worksheetId,
          name: 'Sheet1',
          tabColor: '',
          hidden: 0,
          freeze: { xOffset: 0, yOffset: 0, startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
          rowCount: Math.max(84, rows.length + 26),
          columnCount: Math.max(60, headers.length + 3),
          zoomRatio: 1,
          scrollTop: 0,
          scrollLeft: 0,
          defaultColumnWidth: 73,
          defaultRowHeight: 19,
          mergeData: [],
          cellData,
          rowData: {},
          columnData: {}
        }
      }
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Append responses that arrived since the last sync into the form's
 * linked spreadsheet. Mutates `userData` (form record + sheet record);
 * the caller saves once. Returns true when anything changed.
 *
 * Columns are append-only: keys already in link.sheetColumns keep their
 * index, question keys the sheet has never seen go to the end. If the
 * spreadsheet was deleted from the Sheets app, the stale link is dropped.
 */
function syncFormResponsesToSheet(userData, form, sharedResponses, sharedForm) {
  const link = form.linkedSheet;
  if (!link || !link.sheetId) return false;

  const sheetRecord = (userData.sheets || []).find(s => s.id === link.sheetId);
  if (!sheetRecord || !sheetRecord.data || !sheetRecord.data.sheets) {
    delete form.linkedSheet;
    return true;
  }

  const worksheet = sheetRecord.data.sheets[sheetRecord.data.sheetOrder?.[0]];
  if (!worksheet || !worksheet.cellData) return false;

  if (!Array.isArray(link.syncedResponseIds)) {
    link.syncedResponseIds = [];
  }
  const synced = new Set(link.syncedResponseIds);
  const missing = (sharedResponses || []).filter(r => r && r.id && !synced.has(r.id));

  // Merge in columns for questions the sheet has never seen.
  const columns = [...(link.sheetColumns || [])];
  for (const col of buildColumns(sharedForm ? sharedForm.components || [] : [])) {
    if (!columns.some(c => c.key === col.key)) {
      columns.push(col);
    }
  }

  if (missing.length === 0 && columns.length === (link.sheetColumns || []).length) {
    return false;
  }

  // Append below the last used row (headers live at row 0) so rows the
  // owner added by hand are never overwritten.
  const usedRows = Object.keys(worksheet.cellData)
    .map(Number)
    .filter(n => Number.isFinite(n));
  let nextRow = usedRows.length > 0 ? Math.max(...usedRows) + 1 : 0;

  for (const cells of responseRows(
      columns, missing, buildOptionsByKey(sharedForm ? sharedForm.components || [] : []))) {
    writeRow(worksheet.cellData, nextRow, cells);
    nextRow += 1;
  }
  link.syncedResponseIds.push(...missing.map(r => r.id));
  link.sheetColumns = columns;

  ensureSheetCapacity(worksheet, nextRow + 25, columns.length + 4);
  sheetRecord.updatedAt = new Date().toISOString();
  return true;
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
      // and checked: this is the OWNER-ONLY door to responses. Also the
      // sync point for the linked spreadsheet (sync-on-open).
      if (action === 'getResponses') {
        const { formId } = data || {};

        const form = userData.forms.find(f => f.id === formId);
        if (!form){
          return res.status(404).json({success:false, error:'Form not found'});
        }

        // No share link yet -> the form was never shared, so it cannot have
        // responses. Success with an EMPTY array (the UI shows an empty
        // state), plus the link state so the header renders correctly.
        if (!form.sharedId) {
          return res.status(200).json({
            success: true,
            responses: [],
            form: null,
            linkedSheet: form.linkedSheet || null
          });
        }

        const sharedDoc = await getSharedDoc(form.sharedId);

        // Dangling share (deleted outside the app): respond empty instead
        // of crashing on a null doc.
        if (!sharedDoc || !sharedDoc.form) {
          return res.status(200).json({
            success: true,
            responses: [],
            form: null,
            linkedSheet: form.linkedSheet || null
          });
        }

        const responses = sharedDoc.responses || [];

        // Mirror any responses that arrived since the last sync into the
        // linked spreadsheet. Best-effort: a failed sheet write must never
        // fail the read.
        if (form.linkedSheet) {
          try {
            const changed = syncFormResponsesToSheet(
              userData, form, responses, sharedDoc.form
            );
            if (changed) {
              await saveOwnedSections(hash, {
                forms: userData.forms,
                sheets: userData.sheets
              });
            }
          } catch (syncError) {
            console.error('[FORMS API] Sheet sync failed:', syncError);
          }
        }

        return res.status(200).json({
          success: true,
          responses,
          form: sharedDoc.form,
          linkedSheet: form.linkedSheet || null
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

      // LINK SHEET — create a spreadsheet in the user's Sheets app holding
      // the form's responses (headers + one row per response), and record
      // the link on the form. Requires the form to be shared (that's where
      // responses live). Idempotent: an existing live link is returned as-is.
      if (action === 'linkSheet') {
        const { formId } = data || {};

        const form = userData.forms.find(f => f.id === formId);
        if (!form) {
          return res.status(404).json({
            success: false,
            error: 'Form not found'
          });
        }

        if (!form.sharedId) {
          return res.status(400).json({
            success: false,
            error: 'Share the form before linking it to a spreadsheet'
          });
        }

        // Already linked and the spreadsheet still exists: hand it back.
        if (form.linkedSheet && form.linkedSheet.sheetId) {
          const existing = (userData.sheets || []).find(
            s => s.id === form.linkedSheet.sheetId
          );
          if (existing) {
            return res.status(200).json({
              success: true,
              sheetId: existing.id,
              sheetUrl: `${getBaseUrl(req)}/sheets/editor.html?id=${existing.id}`,
              alreadyLinked: true
            });
          }
          // The spreadsheet was deleted from the Sheets app — drop the
          // stale link and create a fresh spreadsheet below.
          delete form.linkedSheet;
        }

        const sharedDoc = await getSharedDoc(form.sharedId);
        if (!sharedDoc || !sharedDoc.form) {
          return res.status(400).json({
            success: false,
            error: 'Shared form not found — re-share the form first'
          });
        }

        const responses = sharedDoc.responses || [];
        const columns = buildColumns(sharedDoc.form.components || []);
        const sheetId = generateId();
        const sheetName = `${form.name || 'Untitled Form'} (Responses)`;

        if (!userData.sheets) {
          userData.sheets = [];
        }
        userData.sheets.push(
          buildResponsesSheetRecord(
            sheetId, sheetName, columns, responses, sharedDoc.form.components || []
          )
        );

        form.linkedSheet = {
          sheetId,
          sheetColumns: columns,
          syncedResponseIds: responses.filter(r => r && r.id).map(r => r.id),
          linkedAt: new Date().toISOString()
        };

        const saved = await saveOwnedSections(hash, {
          forms: userData.forms,
          sheets: userData.sheets
        });
        if (!saved) {
          return res.status(500).json({
            success: false,
            error: 'Failed to link spreadsheet'
          });
        }

        return res.status(200).json({
          success: true,
          sheetId,
          sheetUrl: `${getBaseUrl(req)}/sheets/editor.html?id=${sheetId}`,
          alreadyLinked: false
        });
      }

      // UNLINK SHEET — drop the link; the spreadsheet and its rows are kept
      // (matches Google Forms, which leaves the linked sheet behind).
      if (action === 'unlinkSheet') {
        const { formId } = data || {};

        const form = userData.forms.find(f => f.id === formId);
        if (!form) {
          return res.status(404).json({
            success: false,
            error: 'Form not found'
          });
        }

        if (form.linkedSheet) {
          delete form.linkedSheet;
          const saved = await saveFormsSections(hash, userData);
          if (!saved) {
            return res.status(500).json({
              success: false,
              error: 'Failed to unlink spreadsheet'
            });
          }
        }

        return res.status(200).json({ success: true, message: 'Form unlinked' });
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
