/**
 * ================================================
 * KANBAN - Unified User API
 * ================================================
 *
 * The unified user document gains a `kanban` array of board records.
 *
 * Board record shape (columns/rows/cards/links mirror DHTMLX Kanban's
 * serialize() output, so the client round-trips the widget state directly):
 *   { id, name, columns: [{ id, label, limit?, collapsed? }],
 *     rows: [{ id, label, collapsed? }],
 *     cards: [{ id, label, description, column, row?, priority?, color?,
 *       progress?, end_date?, checklist?: [{ id, text, done }],
 *       comments?: [{ id, cardId, userId?, text, date }],
 *       votes?: [], attached?: [], createdAt }],
 *     links: [], createdAt, updatedAt }
 */

import {
  generateHash,
  generateId,
  getUserDoc,
  saveOwnedSections,
  createUserDoc,
  deleteUserDoc,
  applyCorsHeaders
} from './_lib/store.js';

const DEFAULT_BOARD_NAME = 'Untitled Board';

const DEFAULT_COLUMNS = () => ([
  { id: 'todo', label: 'To Do' },
  { id: 'progress', label: 'In Progress' },
  { id: 'done', label: 'Done' }
]);

/** Persist only the sections Kanban owns (kanban) + settings changes. */
async function saveKanbanSections(hash, userData) {
  return saveOwnedSections(hash, {
    kanban: userData.kanban,
    settings: userData.settings
  });
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
        return res.status(200).json({ success: true, hash, data: userData });
      }

      if (action === 'create') {
        const result = await createUserDoc(hash, { theme: 'dark' });
        if (!result.ok) {
          if (result.code === 'USER_EXISTS') {
            return res.status(409).json({ success: false, error: 'User already exists' });
          }
          return res.status(500).json({ success: false, error: 'Failed to create account' });
        }
        return res.status(201).json({ success: true, hash, data: result.doc });
      }

      return res.status(400).json({ success: false, error: 'Invalid action. Use "login" or "create"' });
    }

    // ============================================================
    // PUT - owner operations on the unified document
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

      // CREATE BOARD — new board with default columns (server-generated id).
      if (action === 'createBoard') {
        let id = data?.id || generateId();
        while (userData.kanban.some(b => b && b.id === id)) {
          id = generateId();
        }

        const now = new Date().toISOString();
        const board = {
          id,
          name: (data?.name || '').trim() || DEFAULT_BOARD_NAME,
          columns: DEFAULT_COLUMNS(),
          rows: [],
          cards: [],
          links: [],
          createdAt: now,
          updatedAt: now
        };
        userData.kanban.unshift(board);

        const saved = await saveKanbanSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to create board' });
        }
        return res.status(200).json({ success: true, board, data: userData });
      }

      // UPDATE BOARD — upserts the whole board record (columns, rows,
      // cards, links) the way the editor saves after every change.
      if (action === 'updateBoard') {
        const { boardId, board } = data || {};

        if (!boardId || !board || typeof board !== 'object' || !Array.isArray(board.columns) || !Array.isArray(board.cards)) {
          return res.status(400).json({ success: false, error: 'boardId and board (with columns and cards) are required' });
        }

        const existingIndex = userData.kanban.findIndex(b => b && b.id === boardId);

        if (existingIndex >= 0) {
          userData.kanban[existingIndex] = {
            ...userData.kanban[existingIndex],
            name: (board.name || '').trim() || DEFAULT_BOARD_NAME,
            columns: board.columns,
            rows: Array.isArray(board.rows) ? board.rows : [],
            cards: board.cards,
            links: Array.isArray(board.links) ? board.links : [],
            id: boardId,
            updatedAt: new Date().toISOString()
          };
        } else {
          const now = new Date().toISOString();
          userData.kanban.push({
            id: boardId,
            name: (board.name || '').trim() || DEFAULT_BOARD_NAME,
            columns: board.columns,
            rows: Array.isArray(board.rows) ? board.rows : [],
            cards: board.cards,
            links: Array.isArray(board.links) ? board.links : [],
            createdAt: now,
            updatedAt: now
          });
        }

        const saved = await saveKanbanSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update board' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // RENAME BOARD — title-only change (same as updateBoard.name).
      if (action === 'renameBoard') {
        const { boardId, name } = data || {};
        const cleanName = String(name || '').trim();

        if (!boardId || !cleanName) {
          return res.status(400).json({ success: false, error: 'boardId and name are required' });
        }

        const target = userData.kanban.find(b => b && b.id === boardId);
        if (!target) {
          return res.status(404).json({ success: false, error: 'Board not found' });
        }

        target.name = cleanName;
        target.updatedAt = new Date().toISOString();

        const saved = await saveKanbanSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to rename board' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // DELETE BOARD.
      if (action === 'deleteBoard') {
        const { boardId } = data || {};

        if (!boardId) {
          return res.status(400).json({ success: false, error: 'boardId is required' });
        }

        userData.kanban = userData.kanban.filter(b => b && b.id !== boardId);
        if (userData.settings?.lastOpened) {
          delete userData.settings.lastOpened[boardId];
        }

        const saved = await saveKanbanSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to delete board' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // UPDATE SETTINGS (theme, etc.)
      if (action === 'updateSettings') {
        if (!data?.settings || typeof data.settings !== 'object') {
          return res.status(400).json({ success: false, error: 'settings object is required' });
        }
        userData.settings = { ...userData.settings, ...data.settings };

        const saved = await saveKanbanSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update settings' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      return res.status(400).json({ success: false, error: 'Invalid action' });
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
    console.error('[KANBAN API] Error:', error);
    return res.status(500).json({ success: false, error: 'Server error', message: error.message });
  }
}