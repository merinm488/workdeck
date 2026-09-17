/**
 * ================================================
 * SLIDES - Authentication Module
 * ================================================
 *
 * Slides has NO login page. Workdeck performs the single login
 * (POST /api/workdeck { key, action: 'login' | 'create' }) and mirrors the
 * session into sessionStorage for every child app:
 *
 *   slides_user_hash / slides_user_key
 *
 * This module only reads that mirror (config.js already provides the
 * helpers). 
 *
 * Workdeck side:
 *   public/js/auth.js  -> storageKeys.slidesHash / slidesKey + 2 setItem()
 *                         lines in storeSession()
 */

// ================================================
// Slides Authentication Manager
// ================================================

class SlidesAuthManager {
    constructor() {
        this.userHash = null;
        this.userKey = null;
    }

    /**
     * @returns {{hash: string, key: string}|null} Session or null
     */
    getSession() {
        const hash = sessionStorage.getItem(APP_CONFIG.sessionKeys.userHash);
        const key = sessionStorage.getItem(APP_CONFIG.sessionKeys.userKey);

        if(hash && key){
            this.userHash = hash;
            this.userKey = key;
            return {hash,key};
        }
        return null;
    }

    /**
     * Check the account still exists on the server (e.g. deleted from
     * Workdeck in another tab).
     * @returns {Promise<boolean>} True when the account exists
     */
    async verifySession() {
        if(!this.userHash) return false;
        try{
            const response  = await fetch(
                `${APP_CONFIG.apiEndpoint}?hash=${encodeURIComponent(this.userHash)}`,
                {cache: 'no-store'}
            );
            return response.ok;
        } catch (error){
            console.error('[AUTH] Session verification error:', error);
            return false;
        }
    }

  
    logout() {
        clearSlidesSession();
        this.userHash = null;
        this.userKey = null;
        goToWorkdeck();
    }

    /**
     * Delete the account (removes the WHOLE unified document — docs, sheets,
     * forms AND slides) and return to Workdeck.
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async deleteAccount() {
        if(!this.userHash) 
            return {success: false, error: 'No user logged in'};
        try{
            const response = await fetch(
                `${APP_CONFIG.apiEndpoint}?hash=${encodeURIComponent(this.userHash)}`,
                {method: 'DELETE'}
            );
            const data = await response.json();
            if(data.success){
                this.logout();
                return {success: true};
            }
            return {success: false, error: data.error || 'Failed to delete account'};
        } catch (error){
            console.error('[AUTH] Delete account error:', error);
            return { success: false, error: 'Failed to delete account' };
        }
    }

    getUserHash() {
        return this.userHash;
    }

    getUserKey() {
        return this.userKey;
    }
}

// ================================================
// Export
// ================================================

const slidesAuth = new SlidesAuthManager();

if (typeof window !== 'undefined') {
    window.SlidesAuthManager = SlidesAuthManager;
    window.slidesAuth = slidesAuth;
}
