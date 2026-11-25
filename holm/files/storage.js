// Files persistence adapter. Holm's verified member cookie selects every
// metadata, thumbnail and byte record; legacy hashes/keys are never sent.
class FileboxStorage {
  constructor() {
    this.apiEndpoint = '/api/filebox';
    this.workdeckEndpoint = '/api/workdeck';
  }
  async loadUserData() {
    try {
      const response = await (window.WDBoot?.fetch || fetch)(this.workdeckEndpoint, { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { this.signIn(); return null; }
      const result = await response.json();
      return response.ok && result.success ? result.data : null;
    } catch (error) { console.error('[FILES] Load error:', error); return null; }
  }
  signIn() { location.assign('/auth/login?redirect=' + encodeURIComponent(location.pathname + location.search)); }
  async uploadFile(opts) {
    try {
      const response = await (window.WDBoot?.fetch || fetch)(this.apiEndpoint, { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'uploadFile', data: {
          name: opts.name, mime: opts.mime, base64: opts.base64,
          folderId: opts.folderId || null, tags: opts.tags || [], thumbnail: opts.thumbnail || null,
        } }),
      });
      if (response.status === 401) this.signIn();
      const result = await response.json().catch(() => ({}));
      return response.ok && result.success ? { ok: true, file: result.file } : {
        ok: false, errorCode: result.error || (response.status === 413 ? 'FILE_TOO_LARGE' : undefined),
        error: result.message || result.error || `Upload failed (${response.status})`,
      };
    } catch (error) { console.error('[FILES] Upload error:', error); return { ok: false, error: 'Upload failed. Check your connection.' }; }
  }
  fileUrl(fileId, dl) {
    return `${this.apiEndpoint}?fileId=${encodeURIComponent(fileId)}${dl ? '&dl=1' : ''}`;
  }
  async workdeckAction(action, data) {
    try {
      const response = await (window.WDBoot?.fetch || fetch)(this.workdeckEndpoint, { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }),
      });
      if (response.status === 401) { this.signIn(); return null; }
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'API request failed');
      return result.data;
    } catch (error) { console.error('[FILES] ' + action + ' error:', error); return null; }
  }
  createFolder(name, color, parentId) { return this.workdeckAction('createFolder', { name, color, parentId: parentId || null }); }
  updateFolder(folderId, updates) { return this.workdeckAction('updateFolder', { folderId, updates }); }
  deleteFolder(folderId) { return this.workdeckAction('deleteFolder', { folderId }); }
  setFileFolder(fileId, folderId) { return this.workdeckAction('setFileFolder', { fileId, folderId: folderId || null }); }
  setFolderParent(folderId, parentId) { return this.workdeckAction('setFolderParent', { folderId, parentId: parentId || null }); }
  setFileThumbnail(fileId, thumbnail, cover, version) {
    return this.workdeckAction('setFileThumbnail', { fileId, thumbnail,
      thumbnailCover: cover === true, thumbVer: version || 0 });
  }
  setFileTags(fileId, tagIds) { return this.workdeckAction('setFileTags', { fileId, tagIds }); }
  setFolderTags(folderId, tagIds) { return this.workdeckAction('setFolderTags', { folderId, tagIds }); }
  removeFile(fileId) { return this.workdeckAction('deleteFile', { fileId, app: 'filebox' }); }
  renameFile(fileId, name) { return this.workdeckAction('renameFile', { fileId, app: 'filebox', name }); }
  recordOpen(id) { return this.workdeckAction('recordOpen', { fileId: id, app: 'filebox' }); }
  createTag(name, color) { return this.workdeckAction('createTag', { name, color, origin: 'filebox' }); }
  updateTag(tagId, updates) { return this.workdeckAction('updateTag', { tagId, updates }); }
  deleteTag(tagId) { return this.workdeckAction('deleteTag', { tagId }); }
  saveSettings(settings) { return this.workdeckAction('updateSettings', { settings }); }
}
const fileboxStorage = new FileboxStorage();
