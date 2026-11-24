// Persistence adapter for the unchanged Kanban UI. Holm's verified member
// cookie selects storage; no account hash/key is ever sent or accepted.
class KanbanStorage {
  constructor() { this.versions = new Map(); }

  async request(method = 'GET', action, data) {
    try {
      const response = await fetch('/api/kanban', {
        method, cache: 'no-store', credentials: 'same-origin',
        ...(action ? { headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, data }) } : {}),
      });
      if (response.status === 401) {
        window.location.assign('/auth/login?redirect=%2Fkanban%2F');
        return null;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        console.error('[KANBAN] Request failed:', result.error || response.status);
        if (response.status === 409 && typeof showNotification === 'function') {
          showNotification('Board changed in another tab. Reload before editing further.', 'error');
        }
        return null;
      }
      return result;
    } catch (error) {
      console.error('[KANBAN] Request failed:', error);
      return null;
    }
  }

  async loadUserData() {
    const result = await this.request();
    if (!result) return null;
    for (const board of result.data.kanban || []) this.versions.set(board.id, board.version);
    return result.data;
  }

  async createBoard(name) {
    const result = await this.request('PUT', 'createBoard', { name: name || 'Untitled Board' });
    if (result?.board) this.versions.set(result.board.id, result.board.version);
    return result?.board || null;
  }

  async saveBoard(board) {
    const version = this.versions.get(board.id);
    if (!version) return false;
    const result = await this.request('PUT', 'updateBoard', {
      boardId: board.id, version,
      board: { name: board.name, columns: board.columns, rows: board.rows,
        cards: board.cards, links: board.links || [] },
    });
    if (!result?.board) return false;
    this.versions.set(board.id, result.board.version);
    return true;
  }

  async renameBoard(boardId, name) {
    const result = await this.request('PUT', 'renameBoard', { boardId, name });
    if (result?.board) this.versions.set(boardId, result.board.version);
    return !!result?.board;
  }

  async deleteBoard(boardId) {
    const result = await this.request('PUT', 'deleteBoard', { boardId });
    if (result?.deleted) this.versions.delete(boardId);
    return !!result?.deleted;
  }

  async saveSettings(settings) {
    if (settings.lastOpened) {
      const boardId = Object.keys(settings.lastOpened)[0];
      if (!boardId || !(await this.request('PUT', 'recordOpen', { boardId }))) return false;
    }
    const patch = {};
    if ('theme' in settings) patch.theme = settings.theme;
    if ('kanbanCards' in settings) patch.kanbanCards = settings.kanbanCards;
    return !Object.keys(patch).length || !!(await this.request('PUT', 'updateSettings', { settings: patch }));
  }
}
const kanbanStorage = new KanbanStorage();
