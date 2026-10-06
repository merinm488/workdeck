/**
 * ================================================
 * FILEBOX - Storage Module
 * ================================================
 *
 * FileboxStorage — data persistence for the Filebox app.
 *
 * Two endpoints:
 *   APP_CONFIG.workdeckEndpoint (/api/workdeck) — everything metadata:
 *     files[]/folders[] records, folders CRUD, moves, tags, renames,
 *     deletes and recency. All calls pass app:'filebox' where the action
 *     needs an app discriminator, exactly like the landing page does.
 *   APP_CONFIG.apiEndpoint (/api/filebox) — file BYTES only:
 *     uploadFile POSTs base64 and downloads stream from GET ?fileId=.
 *
 * Unified document sections used (see api/_lib/store.js):
 *   files:   [{ id, name, mime, size, folderId, tags, thumbnail,
 *               storage: 'textdb', storageKey: 'file_<id>',
 *               createdAt, updatedAt }]
 *   folders: [{ id, name, color, parentId, tags, createdAt, updatedAt }]
 *   tags:    [{ id, name, color, origin? }]  // shared with the whole suite;
 *                                            // origin 'filebox' = born here
 *   settings.lastOpened[id]               // recency, shared map
 */

class FileboxStorage {
    constructor() {
        this.apiEndpoint = APP_CONFIG.apiEndpoint;
        this.workdeckEndpoint = APP_CONFIG.workdeckEndpoint;
    }

    // ================================================
    // Unified document
    // ================================================

    /**
     * Load the user's whole unified document (homepage parity: the same
     * GET the landing page uses, so tags created anywhere show up here).
     *
     * @returns {Promise<object|null>} User data or null
     */
    async loadUserData() {
        const hash = getFileboxUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }
        try {
            const response = await fetch(
                `${this.workdeckEndpoint}?hash=${encodeURIComponent(hash)}&_t=${Date.now()}`,
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

    // ================================================
    // File bytes (via /api/filebox)
    // ================================================

    /**
     * Upload one file: stores the bytes first (orphan guard), then the
     * metadata record. Strictly call this SEQUENTIALLY — concurrent
     * uploads do read-modify-write on the shared user doc.
     *
     * @param {object} opts - { name, mime, base64, folderId, tags, thumbnail }
     * @returns {Promise<{ok: boolean, file?: object, errorCode?: string, error?: string}>}
     *   errorCode 'FILE_TOO_LARGE' maps to the client's oversize toast.
     */
    async uploadFile(opts) {
        const hash = getFileboxUserHash();
        if (!hash) {
            return { ok: false, error: 'No user hash found' };
        }
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash,
                    action: 'uploadFile',
                    data: {
                        name: opts.name,
                        mime: opts.mime,
                        base64: opts.base64,
                        folderId: opts.folderId || null,
                        tags: opts.tags || [],
                        thumbnail: opts.thumbnail || null
                    }
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!result.success) {
                return {
                    ok: false,
                    errorCode: result.error || (response.status === 413 ? 'FILE_TOO_LARGE' : undefined),
                    error: result.error || `Upload failed (${response.status})`
                };
            }
            return { ok: true, file: result.file };
        } catch (error) {
            console.error('[STORAGE] Upload error:', error);
            return { ok: false, error: 'Upload failed. Check your connection.' };
        }
    }

    /**
     * URL that streams a file's bytes (inline in the viewer, or as a
     * download with dl=1).
     * @param {string} fileId
     * @param {boolean} [dl] - Content-Disposition: attachment
     */
    fileUrl(fileId, dl) {
        const hash = getFileboxUserHash() || '';
        return `${this.apiEndpoint}?fileId=${encodeURIComponent(fileId)}` +
            `&hash=${encodeURIComponent(hash)}` + (dl ? '&dl=1' : '');
    }

    // ================================================
    // Metadata operations (via /api/workdeck)
    // ================================================

    /**
     * Generic PUT against the Workdeck API.
     * @returns {Promise<object|null>} updated user data, or null on failure
     */
    async workdeckAction(action, data) {
        const hash = getFileboxUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }
        try {
            const response = await fetch(this.workdeckEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hash, action, data })
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'API request failed');
            }
            return result.data;
        } catch (error) {
            console.error(`[STORAGE] ${action} error:`, error);
            return null;
        }
    }

    /** Create a folder. parentId null = root. */
    createFolder(name, color, parentId) {
        return this.workdeckAction('createFolder', { name, color, parentId: parentId || null });
    }

    /** Rename / recolor a folder. */
    updateFolder(folderId, updates) {
        return this.workdeckAction('updateFolder', { folderId, updates });
    }

    /**
     * Delete a folder — DESTRUCTIVE: the folder, every descendant folder
     * and all contained files (bytes + metadata) are gone permanently.
     */
    deleteFolder(folderId) {
        return this.workdeckAction('deleteFolder', { folderId });
    }

    /** Move a file (folderId null = root). */
    setFileFolder(fileId, folderId) {
        return this.workdeckAction('setFileFolder', { fileId, folderId: folderId || null });
    }

    /** Full tag-array replace (one call adds AND removes). */
    setFileTags(fileId, tagIds) {
        return this.workdeckAction('setFileTags', { fileId, tagIds });
    }

    /** Full tag-array replace on a folder. */
    setFolderTags(folderId, tagIds) {
        return this.workdeckAction('setFolderTags', { folderId, tagIds });
    }

    /** Delete a file (server also deletes its content record). */
    removeFile(fileId) {
        return this.workdeckAction('deleteFile', { fileId, app: 'filebox' });
    }

    /** Rename a file. */
    renameFile(fileId, name) {
        return this.workdeckAction('renameFile', { fileId, app: 'filebox', name });
    }

    /** Record an open (file or folder id) for homepage recency. */
    recordOpen(id) {
        return this.workdeckAction('recordOpen', { fileId: id, app: 'filebox' });
    }

    
    createTag(name, color) {
        return this.workdeckAction('createTag', { name, color, origin: 'filebox' });
    }

    /** Rename / recolor a tag (the tag is shared with Workdeck). */
    updateTag(tagId, updates) {
        return this.workdeckAction('updateTag', { tagId, updates });
    }

  
    deleteTag(tagId) {
        return this.workdeckAction('deleteTag', { tagId });
    }

    /** Update user settings (theme, etc.). */
    saveSettings(settings) {
        return this.workdeckAction('updateSettings', { settings });
    }
}

// ================================================
// Export
// ================================================

const fileboxStorage = new FileboxStorage();

if (typeof window !== 'undefined') {
    window.FileboxStorage = FileboxStorage;
    window.fileboxStorage = fileboxStorage;
}
