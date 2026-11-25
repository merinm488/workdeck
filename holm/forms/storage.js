// Holm Forms adapter: only verified member cookies authorize owner methods.
// Public share fetch and anonymous submission never use account credentials.
class FormsStorage {
  constructor() { this.versions = new Map(); this.pending = new Map(); this.forms = new Map(); }
  remember(data) {
    for (const form of data?.forms || []) {
      this.versions.set(form.id, form.version);
      this.forms.set(form.id, form);
    }
    return data;
  }
  async owner(action, data) {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/forms', { method: 'PUT', credentials: 'same-origin',
        cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
      });
      if (response.status === 401) {
        location.assign('/auth/login?redirect=' + encodeURIComponent(location.pathname + location.search));
        return null;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        console.error('[FORMS] ' + action + ' failed:', result.error || response.status);
        if (response.status === 409) alert('Form changed in another tab. Reload before editing further.');
        return null;
      }
      if (Array.isArray(result.data?.forms)) this.remember(result.data);
      return result;
    } catch (error) { console.error('[FORMS] ' + action + ' failed:', error); return null; }
  }
  queue(id, work) {
    const before = this.pending.get(id) || Promise.resolve();
    const next = before.catch(() => {}).then(work);
    this.pending.set(id, next);
    next.finally(() => { if (this.pending.get(id) === next) this.pending.delete(id); }).catch(() => {});
    return next;
  }
  async loadUserData() {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/forms', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) {
        location.assign('/auth/login?redirect=' + encodeURIComponent(location.pathname + location.search));
        return null;
      }
      const data = await response.json();
      return response.ok && data.success ? this.remember(data.data) : null;
    } catch (error) { console.error('[FORMS] Load failed:', error); return null; }
  }
  async getForm(formId) {
    const data = await this.loadUserData();
    this.lastUserData = data;
    return data?.forms?.find(form => form.id === formId) || null;
  }
  saveForm(formId, formData) {
    return this.queue(formId, async () => {
      const version = this.versions.get(formId);
      const current = this.forms.get(formId);
      if (!Number.isSafeInteger(version) || !current) return false;
      const merged = { name: formData.name ?? current.name,
        display: formData.display ?? current.display,
        components: formData.components ?? current.components };
      return !!(await this.owner('updateForm', { formId, version, formData: merged }));
    });
  }
  deleteForm(formId) {
    return this.queue(formId, async () => {
      const version = this.versions.get(formId);
      if (!Number.isSafeInteger(version)) return false;
      const result = await this.owner('deleteForm', { formId, version });
      if (result) this.versions.delete(formId);
      return !!result;
    });
  }
  async saveSettings(settings) { return !!(await this.owner('updateSettings', { settings })); }
  shareForm(formId) {
    return this.queue(formId, async () => {
      const version = this.versions.get(formId);
      if (!Number.isSafeInteger(version)) return null;
      const result = await this.owner('shareForm', { formId, version });
      return result ? { shareId: result.shareId, shareUrl: result.shareUrl,
        alreadyShared: result.alreadyShared } : null;
    });
  }
  getResponses(formId) {
    return this.queue(formId, async () => {
      const result = await this.owner('getResponses', { formId });
      return result ? { responses: result.responses || [], form: result.form,
        linkedSheet: result.linkedSheet || null } : null;
    });
  }
  deleteResponses(formId) { return this.queue(formId, async () => !!(await this.owner('deleteResponses', { formId }))); }
  linkSheet(formId) {
    return this.queue(formId, async () => {
      const result = await this.owner('linkSheet', { formId });
      return result ? { sheetId: result.sheetId, sheetUrl: result.sheetUrl,
        alreadyLinked: result.alreadyLinked } : null;
    });
  }
  unlinkSheet(formId) { return this.queue(formId, async () => !!(await this.owner('unlinkSheet', { formId }))); }
  async getSharedForm(shareId) {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/forms?shared=' + encodeURIComponent(shareId), { cache: 'no-store' });
      if (!response.ok) return null;
      const result = await response.json();
      return result.success ? { form: result.form } : null;
    } catch (_) { return null; }
  }
  async submitResponse(shareId, responseData) {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/forms', { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submitResponse', shareId, data: { response: responseData } }),
      });
      return response.ok && !!(await response.json()).success;
    } catch (_) { return false; }
  }
}
const formsStorage = new FormsStorage();
