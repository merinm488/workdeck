// Holm Slides storage adapter. Full Fabric slide JSON stays in the current
// member DS; the server owns identity, versions and public share tokens.
class SlidesStorage {
  constructor() { this.versions = new Map(); this.pending = new Map(); }
  remember(data) {
    for (const deck of data?.slides || []) this.versions.set(deck.id, deck.version);
    return data;
  }
  async request(method = 'GET', action, data, query = '') {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/slides' + query, {
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
        console.error('[SLIDES] ' + (action || 'load') + ' failed:', result.error || response.status);
        if (response.status === 409) alert('Deck changed in another tab. Reload before editing further.');
        return null;
      }
      if (Array.isArray(result.data?.slides)) this.remember(result.data);
      return result;
    } catch (error) { console.error('[SLIDES] Request failed:', error); return null; }
  }
  queue(deckId, work) {
    const prior = this.pending.get(deckId) || Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    this.pending.set(deckId, next);
    next.finally(() => { if (this.pending.get(deckId) === next) this.pending.delete(deckId); }).catch(() => {});
    return next;
  }
  async loadUserData() { return (await this.request())?.data || null; }
  async getDeck(deckId) {
    const data = await this.loadUserData();
    this.lastUserData = data;
    return data?.slides?.find(deck => deck.id === deckId) || null;
  }
  saveDeck(deckId, deckData) {
    return this.queue(deckId, async () => {
      const version = this.versions.get(deckId);
      if (!Number.isSafeInteger(version)) return false;
      return !!(await this.request('PUT', 'updateDeck', { deckId, version, deckData }));
    });
  }
  deleteDeck(deckId) {
    return this.queue(deckId, async () => {
      const version = this.versions.get(deckId);
      if (!Number.isSafeInteger(version)) return false;
      const result = await this.request('PUT', 'deleteDeck', { deckId, version });
      if (result) this.versions.delete(deckId);
      return !!result;
    });
  }
  async saveSettings(settings) { return !!(await this.request('PUT', 'updateSettings', { settings })); }
  shareDeck(deckId) {
    return this.queue(deckId, async () => {
      const version = this.versions.get(deckId);
      if (!Number.isSafeInteger(version)) return null;
      const result = await this.request('PUT', 'shareDeck', { deckId, version });
      return result ? { shareId: result.shareId, shareUrl: result.shareUrl,
        alreadyShared: result.alreadyShared } : null;
    });
  }
  async getSharedDeck(shareId) {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/slides?shared=' + encodeURIComponent(shareId), { cache: 'no-store' });
      if (!response.ok) return null;
      const result = await response.json();
      return result.success ? { deck: result.deck, sharedAt: result.sharedAt } : null;
    } catch (_) { return null; }
  }
}
const slidesStorage = new SlidesStorage();
