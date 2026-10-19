/**
 * ================================================
 * KANBAN - Storage Module
 * ================================================
 *
 * All operations go through /api/kanban, which reads/writes the user's
 * unified document (db/users/{hash}.json in dev, textdb.dev in prod).
 */

class KanbanStorage {
    constructor() {
        this.apiEndpoint = APP_CONFIG.apiEndpoint;
    }

    async loadUserData() {
        const hash = getKanbanUserHash();
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

    async createBoard(name) {
        const hash = getKanbanUserHash();
        if (!hash) return null;
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'createBoard',
                    data: { name: name || '' }
                })
            });
            const result = await response.json();
            if (!result.success) {
                console.error('[STORAGE] Failed to create board:', result.error);
                return null;
            }
            return result.board || null;
        } catch (error) {
            console.error('[STORAGE] Create board error:', error);
            return null;
        }
    }

    // Upserts the whole board record (columns, rows, cards, links)
    async saveBoard(board) {
        const hash = getKanbanUserHash();
        if (!hash) return false;
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'updateBoard',
                    data: {
                        boardId: board.id,
                        board: {
                            name: board.name,
                            columns: board.columns,
                            rows: board.rows,
                            cards: board.cards,
                            links: board.links
                        }
                    }
                })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error('[STORAGE] Save board error:', error);
            return false;
        }
    }

    async renameBoard(boardId, name) {
        const hash = getKanbanUserHash();
        if (!hash) return false;
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'renameBoard',
                    data: { boardId, name }
                })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error('[STORAGE] Rename board error:', error);
            return false;
        }
    }

    async deleteBoard(boardId) {
        const hash = getKanbanUserHash();
        if (!hash) return false;
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'deleteBoard',
                    data: { boardId }
                })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error('[STORAGE] Delete board error:', error);
            return false;
        }
    }

    async saveSettings(settings) {
        const hash = getKanbanUserHash();
        if (!hash) return false;
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

const kanbanStorage = new KanbanStorage();

if (typeof window !== 'undefined') {
    window.KanbanStorage = KanbanStorage;
    window.kanbanStorage = kanbanStorage;
}