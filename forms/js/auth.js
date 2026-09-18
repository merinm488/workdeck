/**
 * ================================================
 * FORMS - Authentication Module
 * ================================================
 *
 * Forms has NO login page. Workdeck performs the single login
 * (POST /api/workdeck { key, action: 'login' | 'create' }) and mirrors the
 * session into sessionStorage for every child app:
 *
 *   forms_user_hash / forms_user_key
 *
 * This module only reads that mirror. If it's missing, the page redirects
 * to Workdeck. It also verifies the account still exists when asked.
 */

// ================================================
// Forms Authentication Manager
// ================================================

class FormsAuthManager {
    constructor() {
        this.userHash = null;
        this.userKey = null;
    }

    /**
     * Read the session Workdeck left in sessionStorage.
     * @returns {{hash: string, key: string}|null} Session or null
     */
    getSession() {
        const hash = sessionStorage.getItem(APP_CONFIG.sessionKeys.userHash);
        const key = sessionStorage.getItem(APP_CONFIG.sessionKeys.userKey);
        if (hash && key) {
            this.userHash = hash;
            this.userKey = key;
            return { hash, key };
        }
        return null;
    }

    /**
     * Check the account still exists on the server (e.g. deleted from
     * Workdeck in another tab). GET /api/forms?hash=... returns 404 when gone.
     * @returns {Promise<boolean>} True when the account exists
     */
    async verifySession() {
        if (!this.userHash) return false;

        try {
            const response = await fetch(
                `${APP_CONFIG.apiEndpoint}?hash=${encodeURIComponent(this.userHash)}`,
                { cache: 'no-store' }
            );
            return response.ok;
        } catch (error) {
            console.error('[AUTH] Session verification error:', error);
            return false;
        }
    }

    /**
     * Log out of the unified account: clear Workdeck's session plus every
     * app's mirrors, then return to Workdeck — which now shows its login
     * page (same as logging out of Workdeck/Docs).
     */
    logout() {
        clearUnifiedSession();
        this.userHash = null;
        this.userKey = null;
        goToWorkdeck();
    }

    /**
     * Delete the account (removes the WHOLE unified document — docs, sheets
     * and forms) and return to Workdeck.
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async deleteAccount() {
        if (!this.userHash) {
            return { success: false, error: 'No user logged in' };
        }

        try {
            const response = await fetch(
                `${APP_CONFIG.apiEndpoint}?hash=${encodeURIComponent(this.userHash)}`,
                { method: 'DELETE' }
            );
            const data = await response.json();

            if (data.success) {
                this.logout();
                return { success: true };
            }
            return { success: false, error: data.error || 'Failed to delete account' };
        } catch (error) {
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

const formsAuth = new FormsAuthManager();

if (typeof window !== 'undefined') {
    window.FormsAuthManager = FormsAuthManager;
    window.formsAuth = formsAuth;
}
