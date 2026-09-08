/**
 * FormsStorage — data persistence for the Forms app.
 *
 * All operations go through the unified Forms API (APP_CONFIG.apiEndpoint,
 * i.e. /api/forms), which reads/writes the user's unified document in
 * db/users/{hash}.json (dev) or textdb.dev (prod). Responses are stored in
 * the shared document (db/shared_<shareId>.json / textdb shared_<shareId>).
 *
 */

class FormsStorage {
    constructor() {
        this.apiEndpoint = APP_CONFIG.apiEndpoint;
    }

    // ================================================
    // Owner operations (all require the hash)
    // ================================================

    /**
     * Load the user's whole unified document (docs + sheets + forms + settings).
     *
     
     * @returns {Promise<object|null>} User data ({docs, sheets, forms, settings}) or null
     */
    async loadUserData() {
        const hash = getFormsUserHash()
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
     * Get one form record from the user document.
     * @param {string} formId
     * @returns {Promise<object|null>} Form record ({id, name, display, components, sharedId, ...})
     */
    async getForm(formId) {
        const userData = await this.loadUserData();
        if (!userData || !userData.forms)
            return null;
        return userData.forms.find(f => f.id === formId) || null;
    }

    /**
     * Create or update a form record (upsert — the server merges by id).
     *
     *
     * @param {string} formId
     * @param {object} formData - { name, display, components }
     * @returns {Promise<boolean>} Success
     */
    async saveForm(formId, formData) {
        const hash = getFormsUserHash();
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
                    action: 'updateForm',
                    data: {
                        formId,
                        formData,
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
     * Delete a form (server also deletes its shared copy + responses).
     *
     *
     * @param {string} formId
     * @returns {Promise<boolean>}
     */
    async deleteForm(formId) {
        const hash = getFormsUserHash();
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
                    action: 'deleteForm',
                    data: {
                        formId:formId
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
     * Update user settings (theme, etc.) — same contract as Sheets.
     *
     *
     * @param {object} settings - Partial settings, e.g. { theme: 'dark' }
     * @ Implement: same fetch shape as Sheets' SheetsStorage.saveSettings().
     */
    async saveSettings(settings) {
        const hash = getFormsUserHash();
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
    // Sharing & responses
    // **

    /**
     * Share a form -> creates (or reuses) the public link.
     *
     *
     * @param {string} formId
     * @returns {Promise<{shareId, shareUrl, alreadyShared}|null>}
     */
    async shareForm(formId) {
        const hash = getFormsUserHash();
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
                    action: 'shareForm',
                    data :{
                        formId:formId
                    }
                })
            });
            const result = await response.json();
            if(!result.success){
                console.error('[STORAGE] Failed to share form:', result.error);
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
     * Fetch a shared form (PUBLIC — no session needed). Used by shared.html.
    
     *
     * @param {string} shareId
     * @returns {Promise<{form: object, responses: Array}|null>}
     */
    async getSharedForm(shareId) {
        try{
            const response = await fetch(`${this.apiEndpoint}?shared=${encodeURIComponent(shareId)}`,
            { cache: 'no-store'});
            if(!response.ok){
                return null;
            }
            const result = await response.json();
            return result.success ? {form:result.form, responses: result.responses || []} : null;
        }catch(error){
            console.error('[STORAGE] Get shared form error:', error);
            return null;
        }

    }

    /**
     * Submit a response to a shared form (PUBLIC — no session needed).
     *
     *
     * @param {string} shareId
     * @param {object} response - Submission payload (see shape above)
     * @returns {Promise<boolean>}
     */
    async submitResponse(shareId, response) {
        try{
            const res = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shareId:shareId,
                    action: 'submitResponse',
                    data: {response:response}
                })
            });
            const result = await res.json();
            return result.success;
        }catch(error){
            console.error('[STORAGE] Submit response error:', error);
            return false;
        }
    }

    /**
     *
     * @param {string} formId
     * @returns {Promise<boolean>}
     */
    async deleteResponses(formId) {
        const hash = getFormsUserHash();
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
                    action: 'deleteResponses',
                    data :{
                        formId:formId
                    }
                })
            });
            const result = await response.json();
            
            return result.success;
        } catch(error){
            console.error('[STORAGE] Delete responses error:', error);
            return false;
        }
    }
}

// ================================================
// Export
// ================================================

const formsStorage = new FormsStorage();

if (typeof window !== 'undefined') {
    window.FormsStorage = FormsStorage;
    window.formsStorage = formsStorage;
}
