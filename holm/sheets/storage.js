// Holm Sheets adapter. Every request uses the current verified member cookie.
// Workbook autosaves are serialized and version checked; no hash/key crosses
// the network. Thumbnails and workbook bodies are loaded separately.
class SheetsStorage {
  constructor() { this.versions = new Map(); this.pending = new Map(); }
  remember(data) {
    for (const sheet of data?.sheets || []) this.versions.set(sheet.id, sheet.version);
    return data;
  }
  async request(method = 'GET', action, data, query = '') {
    try {
      const response = await fetch('/api/users' + query, {
        method, cache: 'no-store', credentials: 'same-origin',
        ...(action ? { headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, data }) } : {}),
      });
      if (response.status === 401) {
        location.assign('/auth/login?redirect=' + encodeURIComponent(location.pathname + location.search));
        return null;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        console.error('[SHEETS] ' + (action || 'load') + ' failed:', result.error || response.status);
        if (response.status === 409) alert('Sheet changed in another tab. Reload before editing further.');
        return null;
      }
      if (Array.isArray(result.data?.sheets)) this.remember(result.data);
      return result;
    } catch (error) { console.error('[SHEETS] Request failed:', error); return null; }
  }
  queue(id, work) {
    const previous = this.pending.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.pending.set(id, next);
    next.finally(() => { if (this.pending.get(id) === next) this.pending.delete(id); }).catch(() => {});
    return next;
  }
  loadUserData = async () => (await this.request())?.data || null;
  async getSpreadsheet(id) {
    const data = await this.loadUserData();
    this.lastUserData = data;
    const record = data?.sheets?.find(sheet => sheet.id === id);
    if (!record) return null;
    const result = await this.request('GET', null, null, '?sheet=' + encodeURIComponent(id));
    return result ? { ...record, data: result.data } : null;
  }
  async getSpreadsheets() { return (await this.loadUserData())?.sheets || []; }
  async createSpreadsheet() {
    const result = await this.request('PUT', 'createSheet', {});
    return result?.sheet || null;
  }
  saveSpreadsheet(sheetId, sheetData) {
    return this.queue(sheetId, async () => {
      const version = this.versions.get(sheetId);
      if (!Number.isSafeInteger(version)) return false;
      return !!(await this.request('PUT', 'updateSheet', { sheetId, version, sheetData }));
    });
  }
  deleteSpreadsheet(sheetId) {
    return this.queue(sheetId, async () => {
      const version = this.versions.get(sheetId);
      if (!Number.isSafeInteger(version)) return false;
      const response = await this.request('PUT', 'deleteSheet', { sheetId, version });
      if (response) this.versions.delete(sheetId);
      return !!response;
    });
  }
  async saveSettings(settings) { return !!(await this.request('PUT', 'updateSettings', { settings })); }
  async getSettings() { return (await this.loadUserData())?.settings || { theme: 'dark' }; }
  shareSpreadsheet(sheetId) {
    return this.queue(sheetId, async () => {
      const version = this.versions.get(sheetId);
      if (!Number.isSafeInteger(version)) return null;
      const response = await this.request('PUT', 'shareSheet', { sheetId, version });
      return response ? { shareId: response.shareId, shareUrl: response.shareUrl,
        alreadyShared: response.alreadyShared } : null;
    });
  }
}
const sheetsStorage = new SheetsStorage();
