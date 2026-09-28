/**
 * ================================================
 * DRAW - Storage Module
 * ================================================
 *
 * DrawStorage — data persistence for the Draw app. Every call goes through
 * the unified Draw API (APP_CONFIG.apiEndpoint = /api/draw), which
 * reads/writes the user's unified document:
 *
 *   development -> db/users/{hash}.json       (server/dev-server.js)
 *   production  -> textdb.dev document        (api/_lib/store.js)
 *
 * ─────────────────────────────────────────────────────────────────
 * THE DRAWING RECORD — single source of truth for the whole app.
 * Stored in userData.draws[]. Default drawings created outside the
 * editor share this shape minus objects/viewport content.
 *
 *   {
 *     id: "m91k...",                 // generateId()-style (api side)
 *     name: "Untitled Drawing",
 *     formatVersion: 1,              // schema version — lets us migrate later
 *     background: "#ffffff",
 *     objects: [ ... ],              // fabric object JSON — saved via
 *                                    //   canvas.toObject(['from','to']).objects
 *                                    //   (the extra props carry arrow endpoints)
 *     viewport: {                    // last pan/zoom so reopening feels continuous
 *       zoom: 1,
 *       panX: 0,                     // fabric viewportTransform[4]
 *       panY: 0                      // fabric viewportTransform[5]
 *     },
 *     sharedId: null,                // set by the shareDrawing action
 *     createdAt: "...", updatedAt: "..."
 *   }
 *
 * The canvas is INFINITE — there is no fixed width/height. `objects` carry
 * their absolute coordinates; `viewport` is editor UI state, not geometry.
 *
 * `objects` round-trips with fabric like this:
 *   save:  drawing.objects  = canvas.toObject(['from','to']).objects;  // editor.js
 *   load:  canvas.loadFromJSON({ objects: drawing.objects });  // fabric v7
 * ─────────────────────────────────────────────────────────────────
 */

class DrawStorage {
    constructor() {
        this.apiEndpoint = APP_CONFIG.apiEndpoint;
    }

    // ================================================
    // Owner operations (all require the hash)
    // ================================================

    /**
     * Load the user's whole unified document.
     *
     * @returns {Promise<object|null>} User data or null
     */
    async loadUserData() {
        const hash = getDrawUserHash();
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
     * Get one drawing record from the user document.
     *
     * @param {string} drawingId
     * @returns {Promise<object|null>} Drawing record or null
     */
    async getDrawing(drawingId) {
        const userData = await this.loadUserData();
        if (!userData || !userData.draws)
            return null;
        return userData.draws.find(f => f.id === drawingId) || null;
    }

    /**
     * Create or update a drawing record (upsert — the server merges by id).
     * NOTE: drawingData contains the FULL record (objects + viewport),
     * so this is the autosave/Ctrl+S path. See api/draw.js for the server side.
     *
     * @param {string} drawingId
     * @param {object} drawingData - drawing record per the schema above
     * @returns {Promise<boolean>} Success
     */
    async saveDrawing(drawingId, drawingData) {
        const hash = getDrawUserHash();
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
                    action: 'updateDrawing',
                    data: {
                        drawingId,
                        drawingData,
                        _timestamp: Date.now()
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
     * Delete a drawing (server also deletes its shared copy).
     *
     * @param {string} drawingId
     * @returns {Promise<boolean>}
     */
    async deleteDrawing(drawingId) {
        const hash = getDrawUserHash();
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
                    action: 'deleteDrawing',
                    data: {
                        drawingId: drawingId
                    }
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
     * Update user settings (theme, etc.) 
     *
     * @param {object} settings - Partial settings, e.g. { theme: 'dark' }
     * @returns {Promise<boolean>}
     */
    async saveSettings(settings) {
        const hash = getDrawUserHash();
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
                    data: {
                        settings: settings
                    }
                })
            });
            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error('[STORAGE] Save settings error:', error);
            return false;
        }
    }

    // ================================================
    // Sharing
    // ================================================

    /**
     * Share a drawing -> creates (or reuses) the public view link.
     * The server snapshots the CURRENT drawing into the shared document, so
     * re-share ("update link") after big edits if you want viewers to see
     * the latest — or add a 'refreshShare' PUT action server-side.
     *
     * @param {string} drawingId
     * @returns {Promise<{shareId, shareUrl, alreadyShared}|null>}
     */
    async shareDrawing(drawingId) {
        const hash = getDrawUserHash();
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
                    action: 'shareDrawing',
                    data: {
                        drawingId: drawingId
                    }
                })
            });
            const result = await response.json();
            if (!result.success) {
                console.error('[STORAGE] Failed to share drawing:', result.error);
                return null;
            }
            return {
                shareId: result.shareId,
                shareUrl: result.shareUrl,
                alreadyShared: result.alreadyShared
            };
        } catch (error) {
            console.error('[STORAGE] Share error:', error);
            return null;
        }
    }

    /**
     * Fetch a shared drawing (PUBLIC — no session needed). Used by shared.html.
     * The shared snapshot holds the drawing WITHOUT sharedId — never the
     * user hash or any other drawings.
     *
     * @param {string} shareId
     * @returns {Promise<{drawing: object, sharedAt: string}|null>}
     */
    async getSharedDrawing(shareId) {
        try {
            const response = await fetch(`${this.apiEndpoint}?shared=${encodeURIComponent(shareId)}`,
                { cache: 'no-store' });
            if (!response.ok) {
                return null;
            }
            const result = await response.json();
            return result.success ? { drawing: result.drawing, sharedAt: result.sharedAt } : null;
        } catch (error) {
            console.error('[STORAGE] Get shared drawing error:', error);
            return null;
        }
    }
}

// ================================================
// Export
// ================================================

const drawStorage = new DrawStorage();

if (typeof window !== 'undefined') {
    window.DrawStorage = DrawStorage;
    window.drawStorage = drawStorage;
}