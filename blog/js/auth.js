/**
 * ================================================
 * BLOG - Authentication Module
 * ================================================
 *
 * Blog has NO login page. Workdeck performs the single login and mirrors
 * the session into blog_user_hash / blog_user_key. This module only reads
 * that mirror (sessionStorage, localStorage fallback for new tabs).
 */

class BlogAuthManager {
    constructor() {
        this.userHash = null;
        this.userKey = null;
    }

    /**
     * Read the session Workdeck left in storage.
     * @returns {{hash: string, key: string}|null} Session or null
     */
    getSession() {
        const hash = getBlogUserHash();
        const key = getBlogUserKey();
        if (hash && key) {
            this.userHash = hash;
            this.userKey = key;
            return { hash, key };
        }
        return null;
    }

    /**
     * Check the account still exists on the server (GET returns 404 when gone).
     * @returns {Promise<boolean>}
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
     * Log out of the unified account and return to Workdeck's login page.
     */
    logout() {
        clearUnifiedSession();
        this.userHash = null;
        this.userKey = null;
        goToWorkdeck();
    }

    /**
     * Delete the account (removes the WHOLE unified document) and log out.
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

const blogAuth = new BlogAuthManager();

if (typeof window !== 'undefined') {
    window.BlogAuthManager = BlogAuthManager;
    window.blogAuth = blogAuth;
}