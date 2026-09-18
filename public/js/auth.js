/**
 * ================================================
 * WORKDECK - Authentication Module
 * ================================================
 *
 *
 *   1. POST { key, action: 'login' }
 *   2. 404 "User not found"  ->  POST { key, action: 'create' }  (auto-create)
 *
 * The hash is computed server-side (sha256(key + pepper)), so the raw key
 * never determines storage. On success, sessionStorage gets the Workdeck
 * session PLUS mirrors for every child app, so apps are
 * already logged in when the user navigates to them:
 *
 *   wd_hash / wd_key           -> Workdeck session
 *   docs_hash / docs_key       -> Docs expects these (useAuth.js)
 *   sheets_user_hash / ..._key -> Sheets expects these (js/auth.js)
 *   forms_user_hash / ..._key  -> Forms expects these (js/auth.js)
 */

const WD_AUTH_CONFIG = {
    apiEndpoint: '/api/workdeck',
    storageKeys: {
        wdHash: 'wd_hash',
        wdKey: 'wd_key',
        docsHash: 'docs_hash',
        docsKey: 'docs_key',
        sheetsHash: 'sheets_user_hash',
        sheetsKey: 'sheets_user_key',
        formsHash: 'forms_user_hash',
        formsKey: 'forms_user_key',
        slidesHash: 'slides_user_hash',
        slidesKey: 'slides_user_key'
    }
};

class WdAuthManager {
    constructor() {
        this.userHash = null;
        this.userKey = null;
        this.userData = null;
    }

    /**
     * Read the session from sessionStorage (wd_hash / wd_key).
     */
    getSession() {
        const hash = sessionStorage.getItem(WD_AUTH_CONFIG.storageKeys.wdHash);
        const key = sessionStorage.getItem(WD_AUTH_CONFIG.storageKeys.wdKey);
        if (hash && key) {
            this.userHash = hash;
            this.userKey = key;
            return { hash, key };
        }
        return null;
    }

    /**
     * Authenticate with an access key. Logs in when the account exists,
     * auto-creates otherwise (same UX as Docs and Sheets).
     */
    async authenticate(rawKey) {
        const normalizedKey = String(rawKey || '').trim();
        if (!normalizedKey) {
            return { success: false, error: 'Key cannot be empty' };
        }

        // 1) Try login
        try {
            const response = await fetch(WD_AUTH_CONFIG.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: normalizedKey, action: 'login' })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this.storeSession(normalizedKey, data.hash, data.data);
                    return { success: true, isNewUser: false, data: data.data };
                }
                return { success: false, error: data.error || 'Login failed' };
            }

            if (response.status === 404) {
                // 2) Unknown key -> auto-create (Docs behavior)
                return await this.createAccount(normalizedKey);
            }

            const err = await response.json().catch(() => ({}));
            return { success: false, error: err.error || 'Login failed' };
        } catch (error) {
            console.error('[AUTH] Login error:', error);
            return { success: false, error: 'Login failed. Please try again.' };
        }
    }

    /**
     * Create the unified account.
     */
    async createAccount(normalizedKey) {
        try {
            const response = await fetch(WD_AUTH_CONFIG.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: normalizedKey, action: 'create' })
            });

            const data = await response.json();

            if (data.success) {
                this.storeSession(normalizedKey, data.hash, data.data);
                return { success: true, isNewUser: true, data: data.data };
            }
            return { success: false, error: data.error || 'Failed to create account' };
        } catch (error) {
            console.error('[AUTH] Create error:', error);
            return { success: false, error: 'Failed to create account. Please try again.' };
        }
    }

    /**
     * Persist the session under all apps' storage keys.
     */
    storeSession(key, hash, userData) {
        const s = WD_AUTH_CONFIG.storageKeys;
        sessionStorage.setItem(s.wdHash, hash);
        sessionStorage.setItem(s.wdKey, key);
        sessionStorage.setItem(s.docsHash, hash);
        sessionStorage.setItem(s.docsKey, key);
        sessionStorage.setItem(s.sheetsHash, hash);
        sessionStorage.setItem(s.sheetsKey, key);
        sessionStorage.setItem(s.formsHash, hash);
        sessionStorage.setItem(s.formsKey, key);
        sessionStorage.setItem(s.slidesHash, hash);
        sessionStorage.setItem(s.slidesKey, key);

        // Slides seed: Safari doesn't copy sessionStorage into a newly
        // opened tab, so a fresh-tab Slides editor used to find no session
        // and bounce back to '/'. The localStorage mirror lets it recover;
        // clearSession() removes it so logout still sticks.
        try {
            localStorage.setItem(s.slidesHash, hash);
            localStorage.setItem(s.slidesKey, key);
        } catch (err) {
            console.warn('[AUTH] localStorage seed failed (private mode?):', err);
        }

        this.userHash = hash;
        this.userKey = key;
        this.userData = userData;
    }

    /**
     * Remove all apps' keys from sessionStorage (plus the Slides
     * localStorage seed written by storeSession).
     */
    clearSession() {
        const s = WD_AUTH_CONFIG.storageKeys;
        Object.values(s).forEach(name => {
            sessionStorage.removeItem(name);
            localStorage.removeItem(name);
        });
    }

    /**
     * Logout: clear session and reset in-memory state.
     */
    logout() {
        this.clearSession();
        this.userHash = null;
        this.userKey = null;
        this.userData = null;
    }

    /**
     * Delete the account (removes the unified document) and clear the session.
     */
    async deleteAccount() {
        if (!this.userHash) {
            return { success: false, error: 'No user logged in' };
        }

        try {
            const response = await fetch(
                `${WD_AUTH_CONFIG.apiEndpoint}?hash=${encodeURIComponent(this.userHash)}`,
                { method: 'DELETE' }
            );
            const data = await response.json();

            if (data.success) {
                this.logout();
                return { success: true };
            }
            return { success: false, error: data.error || 'Failed to delete account' };
        } catch (error) {
            console.error('[AUTH] Delete error:', error);
            return { success: false, error: 'Failed to delete account. Please try again.' };
        }
    }

    getUserHash() {
        return this.userHash;
    }

    getUserKey() {
        return this.userKey;
    }
}

// Global instance
const wdAuth = new WdAuthManager();

if (typeof window !== 'undefined') {
    window.WdAuthManager = WdAuthManager;
    window.wdAuth = wdAuth;
}
