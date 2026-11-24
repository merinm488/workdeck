// Adapter for the original Todo editor. Only the persistence boundary changes:
// Holm uses the session cookie and member-private SQLite storage. An email
// address is optional (for example, Telegram sign-in).
class TodoStorage {
  constructor() { this.lists = new Map(); }

  async request(path, method = 'GET', data) {
    try {
      const response = await fetch(path, {
        method, credentials: 'same-origin', cache: 'no-store',
        ...(data !== undefined ? {
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
        } : {}),
      });
      if (response.status === 401) {
        window.location.assign('/auth/login?redirect=%2Ftodo%2F');
        return null;
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('[TODO] Holm save failed:', error.error || response.status);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error('[TODO] Holm request failed:', error);
      return null;
    }
  }

  async loadUserData() {
    const result = await this.request('/api/todo/lists');
    if (!result) return null;
    this.lists = new Map(result.lists.map(list => [list.id, list]));
    return { todo: result.lists, settings: result.settings || {} };
  }

  async createList(name) {
    const result = await this.request('/api/todo/lists', 'POST', { name: name || 'Untitled List' });
    if (!result?.list) return null;
    this.lists.set(result.list.id, result.list);
    return result.list;
  }

  async saveList(list) {
    const result = await this.request('/api/todo/lists/' + encodeURIComponent(list.id), 'PUT', {
      name: list.name, items: list.items, version: list.version,
    });
    if (!result?.list) return false;
    list.version = result.list.version;
    list.updatedAt = result.list.updatedAt;
    this.lists.set(list.id, list);
    return true;
  }

  async renameList(listId, name) {
    const list = this.lists.get(listId);
    if (!list) return false;
    const result = await this.request('/api/todo/lists/' + encodeURIComponent(listId), 'PUT', {
      name, items: list.items, version: list.version,
    });
    if (!result?.list) return false;
    list.name = result.list.name;
    list.version = result.list.version;
    list.updatedAt = result.list.updatedAt;
    return true;
  }

  async deleteList(listId) {
    const list = this.lists.get(listId);
    if (!list) return false;
    const result = await this.request('/api/todo/lists/' + encodeURIComponent(listId), 'DELETE', {
      version: list.version,
    });
    if (!result?.deleted) return false;
    this.lists.delete(listId);
    return true;
  }

  async saveSettings(settings) {
    return !!(await this.request('/api/todo/settings', 'PUT', settings))?.settings;
  }
}

const todoStorage = new TodoStorage();
