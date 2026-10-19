/**
 * ================================================
 * KANBAN - Authentication Module
 * ================================================
 *
 * No login page. Workdeck performs the single login and mirrors
 * the session into kanban_user_hash / kanban_user_key.
 */

class KanbanAuthManager {
    constructor() {
        this.userHash = null;
        this.userKey = null;
    }

    getSession() {
        const hash = getKanbanUserHash();
        const key = getKanbanUserKey();
        if (hash && key) {
            this.userHash = hash;
            this.userKey = key;
            return { hash, key };
        }
        return null;
    }

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

    logout() {
        clearUnifiedSession();
        this.userHash = null;
        this.userKey = null;
        goToWorkdeck();
    }

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

const kanbanAuth = new KanbanAuthManager();

if (typeof window !== 'undefined') {
    window.KanbanAuthManager = KanbanAuthManager;
    window.kanbanAuth = kanbanAuth;
}