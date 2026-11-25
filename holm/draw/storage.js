// Holm Draw persistence boundary. Canvas JSON stays member-private; only
// deliberately shared random-token snapshots can be viewed without sign-in.
class DrawStorage {
  constructor() { this.versions = new Map(); this.pending = new Map(); }
  remember(data) {
    for (const drawing of data?.draws || []) this.versions.set(drawing.id, drawing.version);
    return data;
  }
  async request(method = 'GET', action, data, query = '') {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/draw' + query, {
        method, credentials: 'same-origin', cache: 'no-store',
        ...(action ? { headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, data }) } : {}),
      });
      if (response.status === 401) {
        location.assign('/auth/login?redirect=' + encodeURIComponent(location.pathname + location.search));
        return null;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        console.error('[DRAW] ' + (action || 'load') + ' failed:', result.error || response.status);
        if (response.status === 409) alert('Drawing changed in another tab. Reload before editing further.');
        return null;
      }
      if (Array.isArray(result.data?.draws)) this.remember(result.data);
      return result;
    } catch (error) { console.error('[DRAW] Request failed:', error); return null; }
  }
  queue(drawingId, work) {
    const before = this.pending.get(drawingId) || Promise.resolve();
    const next = before.catch(() => {}).then(work);
    this.pending.set(drawingId, next);
    next.finally(() => { if (this.pending.get(drawingId) === next) this.pending.delete(drawingId); }).catch(() => {});
    return next;
  }
  async loadUserData() { return (await this.request())?.data || null; }
  async getDrawing(id) {
    const data = await this.loadUserData();
    this.lastUserData = data;
    return data?.draws?.find(drawing => drawing.id === id) || null;
  }
  saveDrawing(drawingId, drawingData) {
    return this.queue(drawingId, async () => {
      const version = this.versions.get(drawingId);
      if (!Number.isSafeInteger(version)) return false;
      return !!(await this.request('PUT', 'updateDrawing', { drawingId, version, drawingData }));
    });
  }
  deleteDrawing(drawingId) {
    return this.queue(drawingId, async () => {
      const version = this.versions.get(drawingId);
      if (!Number.isSafeInteger(version)) return false;
      const response = await this.request('PUT', 'deleteDrawing', { drawingId, version });
      if (response) this.versions.delete(drawingId);
      return !!response;
    });
  }
  async saveSettings(settings) { return !!(await this.request('PUT', 'updateSettings', { settings })); }
  shareDrawing(drawingId) {
    return this.queue(drawingId, async () => {
      const version = this.versions.get(drawingId);
      if (!Number.isSafeInteger(version)) return null;
      const result = await this.request('PUT', 'shareDrawing', { drawingId, version });
      return result ? { shareId: result.shareId, shareUrl: result.shareUrl,
        alreadyShared: result.alreadyShared } : null;
    });
  }
  async getSharedDrawing(shareId) {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/draw?shared=' + encodeURIComponent(shareId), { cache: 'no-store' });
      if (!response.ok) return null;
      const result = await response.json();
      return result.success ? { drawing: result.drawing, sharedAt: result.sharedAt } : null;
    } catch (_) { return null; }
  }
}
const drawStorage = new DrawStorage();
