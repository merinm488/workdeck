/**
 * ================================================
 * SLIDES - Storage Module  
 * ================================================
 *
 * SlidesStorage — data persistence for the Slides app. Every call goes through the unified Slides
 * API (APP_CONFIG.apiEndpoint = /api/slides), which reads/writes the user's
 * unified document:
 *
 *   development -> db/users/{hash}.json       (server/dev-server.js)
 *   production  -> textdb.dev document        (api/_lib/store.js)
 *
 * ─────────────────────────────────────────────────────────────────
 * THE DECK RECORD — single source of truth for the whole app.
 * Stored in userData.slides[]. templates/*.json use the same shape
 * minus id/dates (home-side code stamps those on creation).
 *
 *   {
 *     id: "m91k...",                 // generateId()-style (api side)
 *     name: "Untitled Slide",
 *     formatVersion: 1,
 *     width: 960,                    // logical slide size (APP_CONFIG.slide)
 *     height: 540,
 *     slides: [
 *       {
 *         id: "s1",                  // unique WITHIN the deck
 *         name: "Slide 1",
 *         background: "#ffffff",
 *         objects: [ ... ]           // fabric object JSON (canvas.toObject().objects)
 *       }
 *     ],
 *     sharedId: null,                // set by the shareDeck action
 *     createdAt: "...", updatedAt: "..."
 *   }
 *
 * One slide's `objects` round-trips with fabric like this:
 *   save:  slide.objects  = canvas.toObject().objects;      // editor.js
 *   load:  canvas.loadFromJSON({ objects: slide.objects });  // fabric v6
 * ─────────────────────────────────────────────────────────────────
 */

class SlidesStorage {
    constructor() {
        this.apiEndpoint = APP_CONFIG.apiEndpoint;
    }

    // ================================================
    // Owner operations (all require the hash)
    // ================================================

    /**
     * Load the user's whole unified document (docs + sheets + forms +
     * slides + settings).
     * Mirror FormsStorage.loadUserData():
     *   GET `${apiEndpoint}?hash=${hash}&_t=${Date.now()}` with
     *   { cache: 'no-store' } -> { success, data } | null
     *
     * @returns {Promise<object|null>} User data or null
     */
    async loadUserData() {
        const hash = getSlidesUserHash()
        if(!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }
        try{
            const response = await fetch(`${this.apiEndpoint}?hash=${encodeURIComponent(hash)}&_t=${Date.now()}`,
            {cache:'no-store'}
            )
            if(!response.ok) return null;

            const result = await response.json();
            return result.success? result.data : null;
        } catch(error){
            console.error('[STORAGE] Load error:', error);
            return null;
        }
    }

    /**
     * Get one deck record from the user document.
     * Mirror FormsStorage.getForm(): loadUserData() -> userData.slides.find(...)
     *
     * @param {string} deckId
     * @returns {Promise<object|null>} Deck record or null
     */
    async getDeck(deckId) {
        const userData = await this.loadUserData();
        if (!userData || !userData.slides)
            return null;
        return userData.slides.find(f => f.id === deckId) || null;
    }

    /**
     * Create or update a deck record (upsert — the server merges by id).
     * Goes through PUT { hash, action: 'updateDeck', data: { deckId, deckData } }.
     * NOTE: deckData contains the FULL slides array (every slide's objects),
     * so this is the autosave/Ctrl+S path. See api/slides.js for the server
     * side.
     *
     * @param {string} deckId
     * @param {object} deckData - deck record per the schema above
     * @returns {Promise<boolean>} Success
     */
    async saveDeck(deckId, deckData) {
        const hash = getSlidesUserHash();
        if (!hash){
            console.error('[STORAGE] No user hash found');
            return false;
        }
        try{
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    hash,
                    action: 'updateDeck',
                    data: {
                        deckId,
                        deckData,
                        _timestamp: Date.now()
                    }
                })
            });
            const result = await response.json();
            return result.success;
        } catch(error){
            console.error('[STORAGE] Save error:', error);
            return false;
        }
    }

    /**
     * Delete a deck (server also deletes its shared copy).
     * PUT { hash, action: 'deleteDeck', data: { deckId } }.
     *
     * @param {string} deckId
     * @returns {Promise<boolean>}
     */
    async deleteDeck(deckId) {
        const hash = getSlidesUserHash();
        if(!hash) {
            console.error('[STORAGE] No user hash found');
            return false;
        }

        try{
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({
                    hash,
                    action: 'deleteDeck',
                    data: {
                        deckId:deckId
                    }
                })
            });
            const result = await response.json();
            return result.success;
        }catch(error){
            console.error('[STORAGE] Delete error:', error);
            return false;
        }
    }

    /**
     * Update user settings (theme, etc.) — same contract as Sheets/Forms.
     * PUT { hash, action: 'updateSettings', data: { settings } }.
     *
     * @param {object} settings - Partial settings, e.g. { theme: 'dark' }
     * @returns {Promise<boolean>}
     */
    async saveSettings(settings) {
        const hash = getSlidesUserHash();
        if(!hash){
            console.error('[STORAGE] No user hash found');
            return false;
        }
        try{
            const response = await fetch(this.apiEndpoint,{
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    hash,
                    action: 'updateSettings',
                    data: {
                        settings:settings
                    }
                })
            });
            const result = await response.json();
            return result.success;
        }catch (error) {
          console.error('[STORAGE] Save settings error:', error);
          return false;
      }
    }

    // ================================================
    // Sharing
    // ================================================

    /**
     * Share a deck -> creates (or reuses) the public view link.
     * PUT { hash, action: 'shareDeck', data: { deckId } }
     *   -> { success, shareId, shareUrl, alreadyShared }
     * The server snapshots the CURRENT deck into the shared document, so
     * re-share ("update link") after big edits if you want viewers to see
     * the latest — or add a 'refreshShare' PUT action server-side.
     *
     * @param {string} deckId
     * @returns {Promise<{shareId, shareUrl, alreadyShared}|null>}
     */
    async shareDeck(deckId) {
        const hash = getSlidesUserHash();
        if(!hash){
            console.error('[STORAGE] No user hash found');
            return null;
        }
        try{
            const response = await fetch(this.apiEndpoint,{
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    hash,
                    action: 'shareDeck',
                    data :{
                        deckId:deckId
                    }
                })
            });
            const result = await response.json();
            if(!result.success){
                console.error('[STORAGE] Failed to share deck:', result.error);
                return null;
            }
            return {
                shareId:result.shareId,
                shareUrl: result.shareUrl,
                alreadyShared: result.alreadyShared
            }
        } catch(error){
            console.error('[STORAGE] Share error:', error);
            return null;
        }
    }

    /**
     * Fetch a shared deck (PUBLIC — no session needed). Used by shared.html.
     * GET `${apiEndpoint}?shared=${shareId}` -> { success, deck, sharedAt }.
     * The shared snapshot holds the deck WITHOUT sharedId — never the user
     * hash or any other decks.
     *
     * @param {string} shareId
     * @returns {Promise<{deck: object, sharedAt: string}|null>}
     */
    async getSharedDeck(shareId) {
        try{
            const response = await fetch(`${this.apiEndpoint}?shared=${encodeURIComponent(shareId)}`,
            { cache: 'no-store'});
            if(!response.ok){
                return null;
            }
            const result = await response.json();
            return result.success ? { deck: result.deck, sharedAt: result.sharedAt } : null;
        }catch(error){
            console.error('[STORAGE] Get shared deck error:', error);
            return null;
        }

    }
}

// ================================================
// Export
// ================================================

const slidesStorage = new SlidesStorage();

if (typeof window !== 'undefined') {
    window.SlidesStorage = SlidesStorage;
    window.slidesStorage = slidesStorage;
}
