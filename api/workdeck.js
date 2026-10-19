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
  deleteRawDoc,
  getBaseUrl,
  applyCorsHeaders
} from './_lib/store.js';

const DEFAULT_SHEET_NAME = 'Untitled Sheet';
const DEFAULT_DOC_TITLE = 'Untitled';
const DEFAULT_FORM_TITLE = 'Untitled Form';
const DEFAULT_DECK_NAME = 'Untitled';
const DEFAULT_DRAWING_NAME = 'Untitled Drawing';
const DEFAULT_FOLDER_NAME = 'Untitled';
const DEFAULT_TODO_LIST_NAME = 'Untitled List';

/**
 * Filebox tags are multi-valued
 */
function sanitizeTagIds(tagIds, userData) {
  if (!Array.isArray(tagIds)) return [];
  const known = new Set((userData.tags || []).map(t => t.id));
  const seen = new Set();
  return tagIds.filter(id => {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * All folder ids in the subtree rooted at rootId (inclusive). Walks
 * parentId chains to arbitrary depth — Filebox folders nest unlimited.
 */
function collectFolderTree(folders, rootId) {
  const doomed = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder && folder.parentId && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
        doomed.add(folder.id);
        grew = true;
      }
    }
  }
  return doomed;
}

/**
 * Build a fresh Univer workbook snapshot 
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
 * Create an empty drawing (same shape Draw creates client-side — see the
 * record schema at the top of draw/js/storage.js). The canvas is infinite,
 * so there is no fixed width/height; `viewport` remembers the last
 * pan/zoom so reopening feels continuous.
 */
function createDefaultDrawing(id) {
  return {
    id,
    name: DEFAULT_DRAWING_NAME,
    formatVersion: 1,
    background: '#ffffff',
    objects: [],
    viewport: { zoom: 1, panX: 0, panY: 0 },
    sharedId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createDefaultTodoList(id) {
  return {
    id,
    name: DEFAULT_TODO_LIST_NAME,
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createDefaultKanbanBoard(id) {
  const now = new Date().toISOString();
  return {
    id,
    name: 'Untitled Board',
    columns: [
      { id: 'todo', label: 'To Do' },
      { id: 'progress', label: 'In Progress' },
      { id: 'done', label: 'Done' }
    ],
    rows: [],
    cards: [],
    links: [],
    createdAt: now,
    updatedAt: now
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

      // LOGIN — 404 lets the client fall back to auto-create.
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
          if (data?.tagId) sheet.tagId = data.tagId;
          userData.sheets.push(sheet);
          break;
        }

        // ---- Create a form  ----
        case 'createForm': {
          const id = data?.id || generateId();
          const form = createDefaultForm(id);
          if (data?.name) form.name = data.name;
          if (data?.tagId) form.tagId = data.tagId;
          userData.forms.unshift(form);
          break;
        }

        // Create empty deck
        case 'createDeck': {
          const id = data?.id || generateId();
          const deck = createDefaultDeck(id);
          if (data?.name) deck.name = data.name;
          if (data?.tagId) deck.tagId = data.tagId;
          userData.slides.unshift(deck);
          break;
        }

        // Create empty drawing
        case 'createDrawing': {
          const id = data?.id || generateId();
          const drawing = createDefaultDrawing(id);
          if (data?.name) drawing.name = data.name;
          if (data?.tagId) drawing.tagId = data.tagId;
          userData.draws.unshift(drawing);
          break;
        }

        // Create empty task list
        case 'createTodo': {
          const id = data?.id || generateId();
          const list = createDefaultTodoList(id);
          if (data?.name) list.name = data.name;
          if (data?.tagId) list.tagId = data.tagId;
          userData.todo.unshift(list);
          break;
        }

        // Create empty kanban board
        case 'createKanban': {
          const id = data?.id || generateId();
          const board = createDefaultKanbanBoard(id);
          if (data?.name) board.name = data.name;
          if (data?.tagId) board.tagId = data.tagId;
          userData.kanban = userData.kanban || [];
          userData.kanban.unshift(board);
          break;
        }

        // Create empty calendar
        case 'createCalendar': {
          const id = data?.id || generateId();
          const now = new Date().toISOString();
          userData.calendars = userData.calendars || [];
          userData.calendars.unshift({
            id,
            name: (data?.name || '').trim() || 'Untitled Calendar',
            color: data?.color || '#0284c7',
            visible: true,
            tagId: data?.tagId || null,
            createdAt: now,
            updatedAt: now
          });
          break;
        }

        // ---- Projects (tags) ----
        // origin marks where a tag was born. All tags list in Workdeck;
        // Filebox lists its own plus any tag currently carried by at least
        // one Files item, so Workdeck-created tags appear there once used.
        case 'createTag': {
          if (!Array.isArray(userData.tags)) userData.tags = [];
          const tag = {
            id: generateId(),
            name: data?.name || 'New Project',
            color: data?.color || '#FACC15'
          };
          if (data?.origin === 'filebox') tag.origin = 'filebox';
          userData.tags.push(tag);
          break;
        }

        case 'updateTag': {
          const tagIndex = (userData.tags || []).findIndex(t => t.id === data?.tagId);
          if (tagIndex === -1) {
            return res.status(404).json({ success: false, error: 'Tag not found' });
          }
          userData.tags[tagIndex] = {
            ...userData.tags[tagIndex],
            ...(data?.updates || {}),
            id: data.tagId
          };
          break;
        }

        // Deleting a tag deletes its files in docs/sheets/forms/slides/draws
        // (shared copies + lastOpened, like deleteFile). Filebox items are
        // multi-tag — they only lose the tag id, never their bytes.
        case 'deleteTag': {
          const tagId = data?.tagId;
          if (!tagId) {
            return res.status(400).json({ success: false, error: 'tagId is required' });
          }
          const taggedIn = collection => collection.filter(f => f && f.tagId === tagId);
          const doomed = [
            ...taggedIn(userData.docs),
            ...taggedIn(userData.sheets),
            ...taggedIn(userData.forms),
            ...taggedIn(userData.slides),
            ...taggedIn(userData.draws),
            ...taggedIn(userData.todo || []),
            ...taggedIn(userData.calendars || [])
          ];
          for (const file of doomed) {
            if (file.sharedId) {
              try {
                await deleteSharedDoc(file.sharedId);
              } catch (error) {
                console.error('[WORKDECK API] Failed to delete shared copy:', error);
              }
            }
            if (userData.settings?.lastOpened) {
              delete userData.settings.lastOpened[file.id];
            }
          }
          userData.docs = userData.docs.filter(f => !f || f.tagId !== tagId);
          userData.sheets = userData.sheets.filter(f => !f || f.tagId !== tagId);
          userData.forms = userData.forms.filter(f => !f || f.tagId !== tagId);
          userData.slides = userData.slides.filter(f => !f || f.tagId !== tagId);
          userData.draws = userData.draws.filter(f => !f || f.tagId !== tagId);
          userData.todo = (userData.todo || []).filter(f => !f || f.tagId !== tagId);
          // Deleting a calendar takes its events with it.
          const doomedCalIds = new Set(doomed.filter(f => (userData.calendars || []).includes(f)).map(f => f.id));
          if (doomedCalIds.size) {
            userData.events = (userData.events || []).filter(e => !e || !doomedCalIds.has(e.calId));
          }
          userData.calendars = (userData.calendars || []).filter(f => !f || f.tagId !== tagId);
          (userData.files || []).forEach(f => {
            if (Array.isArray(f.tags)) f.tags = f.tags.filter(id => id !== tagId);
          });
          (userData.folders || []).forEach(f => {
            if (Array.isArray(f.tags)) f.tags = f.tags.filter(id => id !== tagId);
          });
          userData.tags = (userData.tags || []).filter(t => t.id !== tagId);
          break;
        }

        // ---- Filebox: nested folders + multi-tag files/folders ----
        case 'createFolder': {
          const name = String(data?.name || '').trim();
          if (!name) {
            return res.status(400).json({ success: false, error: 'name is required' });
          }
          if (data?.parentId && !(userData.folders || []).some(f => f.id === data.parentId)) {
            return res.status(404).json({ success: false, error: 'Parent folder not found' });
          }
          const now = new Date().toISOString();
          userData.folders.push({
            id: generateId(),
            name,
            color: data?.color || '#FACC15',
            parentId: data?.parentId || null,
            tags: sanitizeTagIds(data?.tags, userData),
            createdAt: now,
            updatedAt: now
          });
          break;
        }

        case 'updateFolder': {
          const folderIndex = (userData.folders || []).findIndex(f => f.id === data?.folderId);
          if (folderIndex === -1) {
            return res.status(404).json({ success: false, error: 'Folder not found' });
          }
          userData.folders[folderIndex] = {
            ...userData.folders[folderIndex],
            ...(data?.updates || {}),
            id: data.folderId,
            updatedAt: new Date().toISOString()
          };
          break;
        }

        // Destructive cascade: the folder, every descendant folder, and all
        // contained files (bytes + metadata) are permanently deleted.
        case 'deleteFolder': {
          const folderId = data?.folderId;
          if (!folderId) {
            return res.status(400).json({ success: false, error: 'folderId is required' });
          }
          if (!(userData.folders || []).some(f => f.id === folderId)) {
            return res.status(404).json({ success: false, error: 'Folder not found' });
          }
          const doomed = collectFolderTree(userData.folders || [], folderId);
          const removedFiles = (userData.files || []).filter(f => f && doomed.has(f.folderId));
          for (const file of removedFiles) {
            if (file.storageKey) {
              try {
                await deleteRawDoc(file.storageKey);
              } catch (error) {
                console.error('[WORKDECK API] Failed to delete file content:', error);
              }
            }
            if (userData.settings?.lastOpened) {
              delete userData.settings.lastOpened[file.id];
            }
          }
          userData.files = (userData.files || []).filter(f => !f || !doomed.has(f.folderId));
          userData.folders = (userData.folders || []).filter(f => f && !doomed.has(f.id));
          break;
        }

        // Moving a file = one pointer change.
        case 'setFileFolder': {
          const target = (userData.files || []).find(f => f.id === data?.fileId);
          if (!target) {
            return res.status(404).json({ success: false, error: 'File not found' });
          }
          if (data?.folderId && !(userData.folders || []).some(f => f.id === data.folderId)) {
            return res.status(404).json({ success: false, error: 'Folder not found' });
          }
          target.folderId = data.folderId || null;
          target.updatedAt = new Date().toISOString();
          break;
        }

        // Moving a folder = reparenting. parentId may not be the folder
        // itself or one of its descendants, or the tree would cycle.
        case 'setFolderParent': {
          const target = (userData.folders || []).find(f => f.id === data?.folderId);
          if (!target) {
            return res.status(404).json({ success: false, error: 'Folder not found' });
          }
          const parentId = data?.parentId || null;
          if (parentId) {
            if (parentId === target.id) {
              return res.status(400).json({ success: false, error: 'Cannot move a folder into itself' });
            }
            if (!(userData.folders || []).some(f => f.id === parentId)) {
              return res.status(404).json({ success: false, error: 'Parent folder not found' });
            }
            if (collectFolderTree(userData.folders || [], target.id).has(parentId)) {
              return res.status(400).json({ success: false, error: 'Cannot move a folder into its own subfolder' });
            }
          }
          target.parentId = parentId;
          target.updatedAt = new Date().toISOString();
          break;
        }
        
        case 'setFileThumbnail': {
          const target = (userData.files || []).find(f => f.id === data?.fileId);
          if (!target) {
            return res.status(404).json({ success: false, error: 'File not found' });
          }
          const thumb = data?.thumbnail;
          const valid = typeof thumb === 'string' &&
            thumb.startsWith('data:image/') && thumb.length <= 60000;
          target.thumbnail = valid ? thumb : null;
          target.thumbnailCover = valid ? data?.thumbnailCover === true : false;
          target.thumbVer = valid && data?.thumbVer > 0 ? data.thumbVer : 0;
          break;
        }

        // Full-array replace, so one call both adds and removes tags.
        case 'setFileTags': {
          const target = (userData.files || []).find(f => f.id === data?.fileId);
          if (!target) {
            return res.status(404).json({ success: false, error: 'File not found' });
          }
          target.tags = sanitizeTagIds(data?.tagIds, userData);
          target.updatedAt = new Date().toISOString();
          break;
        }

        case 'setFolderTags': {
          const target = (userData.folders || []).find(f => f.id === data?.folderId);
          if (!target) {
            return res.status(404).json({ success: false, error: 'Folder not found' });
          }
          target.tags = sanitizeTagIds(data?.tagIds, userData);
          target.updatedAt = new Date().toISOString();
          break;
        }

        // ---- Move a file into / out of a project ----
        case 'setFileTag': {
          const { fileId, app, tagId } = data || {};
          if (!fileId) {
            return res.status(400).json({ success: false, error: 'fileId is required' });
          }
          if (tagId && !(userData.tags || []).some(t => t.id === tagId)) {
            return res.status(404).json({ success: false, error: 'Tag not found' });
          }
          const isSheet = app === 'sheets';
          const isForm = app === 'forms';
          const isDeck = app === 'slides';
          const isDrawing = app === 'draw';
          const isTodo = app === 'todo';
          const isCalendar = app === 'calendar';
          const collection = isSheet ? userData.sheets : isForm ? userData.forms : isDeck ? userData.slides : isDrawing ? userData.draws : isTodo ? (userData.todo || []) : isCalendar ? (userData.calendars || []) : userData.docs;
          const target = collection.find(f => f.id === fileId);
          if (!target) {
            return res.status(404).json({ success: false, error: 'File not found' });
          }
          target.tagId = tagId || null;
          target.updatedAt = new Date().toISOString();
          break;
        }

        // ---- Record that a file was just opened (recents ordering) ----
        case 'recordOpen': {
          const { fileId, app } = data || {};
          if (!fileId) {
            return res.status(400).json({ success: false, error: 'fileId is required' });
          }
          let found;
          if (app === 'filebox') {
            // Files AND folders use settings.lastOpened for recency.
            found = (userData.files || []).some(f => f.id === fileId) ||
              (userData.folders || []).some(f => f.id === fileId);
          } else {
            found = Boolean(
              app === 'sheets'
                ? userData.sheets.find(s => s.id === fileId)
                : app === 'forms'
                  ? userData.forms.find(f => f.id === fileId)
                  : app === 'slides'
                  ? userData.slides.find(d => d.id === fileId)
                  : app === 'draw'
                  ? userData.draws.find(d => d.id === fileId)
                  : app === 'todo'
                  ? (userData.todo || []).find(l => l.id === fileId)
                  : app === 'calendar'
                  // 'calendar' is the app-level card id (one card for the
                  // whole app); real ids still resolve for old deep links.
                  ? (fileId === 'calendar' ||
                     (userData.calendars || []).some(c => c.id === fileId))
                  : userData.docs.find(n => n.id === fileId)
            );
          }

          if (!found) {
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
          const isSheet = app === "sheets";
          const isForm = app === "forms";
          const isDeck = app === "slides";
          const isDrawing = app === "draw";
          const isFileboxFile = app === "filebox";
          const isTodo = app === "todo";
          const isCalendar = app === "calendar";
          const isKanban = app === "kanban";
          const collection = isSheet ? userData.sheets : isForm ? userData.forms : isDeck ? userData.slides : isDrawing ? userData.draws : isFileboxFile ? userData.files : isTodo ? (userData.todo || []) : isCalendar ? (userData.calendars || []) : isKanban ? (userData.kanban || []) : userData.docs;
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
          } else if (isDrawing) {
            target.name = cleanName;
          } else if (isFileboxFile) {
            target.name = cleanName;
          } else if (isTodo) {
            target.name = cleanName;
          } else if (isCalendar) {
            target.name = cleanName;
          } else if (isKanban) {
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
          } else if (app === 'draw') {
            const drawing = userData.draws.find(f => f.id === fileId);
            if (drawing?.sharedId) {
              await deleteSharedDoc(drawing.sharedId);
            }
            userData.draws = userData.draws.filter(d => d.id !== fileId);
          } else if (app === 'todo') {
            userData.todo = (userData.todo || []).filter(l => l.id !== fileId);
          } else if (app === 'kanban') {
            userData.kanban = (userData.kanban || []).filter(b => b.id !== fileId);
          } else if (app === 'calendar') {
            // A calendar takes its events with it.
            userData.calendars = (userData.calendars || []).filter(c => c.id !== fileId);
            userData.events = (userData.events || []).filter(e => !e || e.calId !== fileId);
          } else if (app === 'filebox') {
            const file = (userData.files || []).find(f => f.id === fileId);
            if (file?.storageKey) {
              try {
                await deleteRawDoc(file.storageKey);
              } catch (error) {
                console.error('[WORKDECK API] Failed to delete file content:', error);
              }
            }
            userData.files = (userData.files || []).filter(f => f.id !== fileId);
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
        draws: userData.draws,
        files: userData.files,
        folders: userData.folders,
        todo: userData.todo,
        calendars: userData.calendars,
        events: userData.events,
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

      // Filebox bytes live in separate records — remove them BEFORE the doc
      // goes, or they'd survive as orphans no metadata points at.
      for (const file of userData.files || []) {
        if (file && file.storageKey) {
          try {
            await deleteRawDoc(file.storageKey);
          } catch (error) {
            console.error('[WORKDECK API] Failed to delete file content:', error);
          }
        }
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
