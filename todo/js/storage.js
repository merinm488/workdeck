/**
 * TodoStorage — data persistence for the Todo app.
 *
 * All operations go through /api/todo, which reads/writes the user's
 * unified document (db/users/{hash}.json in dev, textdb.dev in prod).
 * Saves are section-merged — only the `todo` section is written.
 */

class TodoStorage {
    constructor() {
        this.apiEndpoint = APP_CONFIG.apiEndpoint;
    }

    /**
     * Load the user's whole unified document.
     * @returns {Promise<object|null>} User data or null
     */
    async loadUserData() {
        const hash = getTodoUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }
        try {
            const response = await fetch(`${this.apiEndpoint}?hash=${encodeURIComponent(hash)}&_t=${Date.now()}`,
                { cache: 'no-store' }
            );
            if (!response.ok) return null;

            const result = await response.json();
            return result.success ? result.data : null;
        } catch (error) {
            console.error('[STORAGE] Load error:', error);
            return null;
        }
    }

    /**
     * Create a new empty task list (server generates the id).
     * @param {string} [name]
     * @returns {Promise<object|null>} The created list record
     */
    async createList(name) {
        const hash = getTodoUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'createList',
                    data: { name: name || '' }
                })
            });
            const result = await response.json();
            if (!result.success) {
                console.error('[STORAGE] Failed to create list:', result.error);
                return null;
            }
            return result.list || null;
        } catch (error) {
            console.error('[STORAGE] Create list error:', error);
            return null;
        }
    }

    /**
     * Save a list record (upsert — the server merges by id).
     * @param {object} list - { id, name, items }
     * @returns {Promise<boolean>}
     */
    async saveList(list) {
        const hash = getTodoUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return false;
        }
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'updateList',
                    data: {
                        listId: list.id,
                        list: { name: list.name, items: list.items }
                    }
                })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error('[STORAGE] Save error:', error);
            return false;
        }
    }

    /**
     * Rename a list.
     * @param {string} listId
     * @param {string} name
     * @returns {Promise<boolean>}
     */
    async renameList(listId, name) {
        const hash = getTodoUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return false;
        }
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'renameList',
                    data: { listId, name }
                })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error('[STORAGE] Rename error:', error);
            return false;
        }
    }

    /**
     * Delete a list.
     * @param {string} listId
     * @returns {Promise<boolean>}
     */
    async deleteList(listId) {
        const hash = getTodoUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return false;
        }
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'deleteList',
                    data: { listId }
                })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error('[STORAGE] Delete error:', error);
            return false;
        }
    }

    /**
     * Update user settings (theme, etc.).
     * @param {object} settings - Partial settings, e.g. { theme: 'dark' }
     * @returns {Promise<boolean>}
     */
    async saveSettings(settings) {
        const hash = getTodoUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return false;
        }
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'updateSettings',
                    data: { settings }
                })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error('[STORAGE] Save settings error:', error);
            return false;
        }
    }
}

const todoStorage = new TodoStorage();

if (typeof window !== 'undefined') {
    window.TodoStorage = TodoStorage;
    window.todoStorage = todoStorage;
}