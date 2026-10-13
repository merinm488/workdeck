/**
 * ================================================
 * TODO - Unified User API
 * ================================================
 *
 *
 * The unified user document gains a `todo` array of task lists:
 * Saves are section-merged, so todo writes never wipe other apps' sections.
 * 
 * List record shape:
 *   { id, name, items: [{ id, title, description, dueDate, priority,
 *     completed, createdAt }], createdAt, updatedAt }
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

const DEFAULT_LIST_NAME = 'Untitled List';

/** Persist only the sections Todo owns (todo) + settings changes. */
async function saveTodoSections(hash, userData) {
  return saveOwnedSections(hash, {
    todo: userData.todo,
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

      // CREATE LIST — a new empty task list with a server-generated id.
      if (action === 'createList') {
        let id = data?.id || generateId();
        while (userData.todo.some(l => l && l.id === id)) {
          id = generateId();
        }

        const now = new Date().toISOString();
        const list = {
          id,
          name: (data?.name || '').trim() || DEFAULT_LIST_NAME,
          items: [],
          createdAt: now,
          updatedAt: now
        };
        userData.todo.unshift(list);

        const saved = await saveTodoSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to create list' });
        }
        return res.status(200).json({ success: true, list, data: userData });
      }

      // UPDATE LIST — upserts the whole list record (name, items), the way
      // the editor saves after every change.
      if (action === 'updateList') {
        const { listId, list } = data || {};

        if (!listId || !list || typeof list !== 'object' || !Array.isArray(list.items)) {
          return res.status(400).json({ success: false, error: 'listId and list (with items) are required' });
        }

        const existingIndex = userData.todo.findIndex(l => l && l.id === listId);

        if (existingIndex >= 0) {
          userData.todo[existingIndex] = {
            ...userData.todo[existingIndex],
            name: (list.name || '').trim() || DEFAULT_LIST_NAME,
            items: list.items,
            id: listId,
            updatedAt: new Date().toISOString()
          };
        } else {
          const now = new Date().toISOString();
          userData.todo.push({
            id: listId,
            name: (list.name || '').trim() || DEFAULT_LIST_NAME,
            items: list.items,
            createdAt: now,
            updatedAt: now
          });
        }

        const saved = await saveTodoSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update list' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // RENAME LIST — title-only change (same as updateList.name).
      if (action === 'renameList') {
        const { listId, name } = data || {};
        const cleanName = String(name || '').trim();

        if (!listId || !cleanName) {
          return res.status(400).json({ success: false, error: 'listId and name are required' });
        }

        const target = userData.todo.find(l => l && l.id === listId);
        if (!target) {
          return res.status(404).json({ success: false, error: 'List not found' });
        }

        target.name = cleanName;
        target.updatedAt = new Date().toISOString();

        const saved = await saveTodoSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to rename list' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // DELETE LIST.
      if (action === 'deleteList') {
        const { listId } = data || {};

        if (!listId) {
          return res.status(400).json({ success: false, error: 'listId is required' });
        }

        userData.todo = userData.todo.filter(l => l && l.id !== listId);
        if (userData.settings?.lastOpened) {
          delete userData.settings.lastOpened[listId];
        }

        const saved = await saveTodoSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to delete list' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // UPDATE SETTINGS (theme, etc.)
      if (action === 'updateSettings') {
        if (!data?.settings || typeof data.settings !== 'object') {
          return res.status(400).json({ success: false, error: 'settings object is required' });
        }
        userData.settings = { ...userData.settings, ...data.settings };

        const saved = await saveTodoSections(hash, userData);
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
    console.error('[TODO API] Error:', error);
    return res.status(500).json({ success: false, error: 'Server error', message: error.message });
  }
}