/**
 * ================================================
 * SHEETS - Simplified Authentication Module
 * ================================================
 *
 * Handles user authentication following the Docs project approach:
 * - Login with existing keys
 * - Auto-create account for new keys
 * - Session management using sessionStorage
 * - Hash-based identification (no session tokens)
 *
 * SECURITY GUIDANCE:
 * - Raw keys are NEVER stored
 * - Only pepper-hashed keys are used for identification
 * - Uses sessionStorage for hash storage
 * - Hash is sent with API requests for identification
 */

// ================================================
// Configuration
// ================================================

const AUTH_CONFIG = {
    // API endpoint (new unified API)
    apiEndpoint: '/api/users',

    // Session storage keys
    storageKeys: {
        userHash: 'sheets_user_hash',
        userKey: 'sheets_user_key'
    }
};

// ================================================
// Authentication Manager Class
// ================================================

class AuthenticationManager {
    constructor() {
        this.currentUser = null;
        this.userHash = null;
        this.userKey = null;
        this.isProduction = APP_CONFIG.isProduction;
        this.initialize();
    }

    /**
     * Initialize authentication manager
     * Loads existing session from sessionStorage
     */
    async initialize() {
        // Load existing session from sessionStorage
        const storedHash = sessionStorage.getItem(AUTH_CONFIG.storageKeys.userHash);
        const storedKey = sessionStorage.getItem(AUTH_CONFIG.storageKeys.userKey);

        if (storedHash && storedKey) {
            this.userHash = storedHash;
            this.userKey = storedKey;

            // Verify session is still valid by fetching user data
            const isValid = await this.verifySession();

            if (isValid) {
                // Redirect to home page if on login page
                if (window.location.pathname.endsWith('/sheets/index.html') || window.location.pathname === '/sheets/') {
                    window.location.href = '/sheets/home.html';
                }
            } else {
                // Invalid session, clear storage
                this.clearSession();
            }
        }
    }

    /**
     * Verify session by fetching user data
     * @returns {Promise<boolean>} - Session validity
     */
    async verifySession() {
        if (!this.userHash) return false;

        try {
            const response = await fetch(`${AUTH_CONFIG.apiEndpoint}?hash=${encodeURIComponent(this.userHash)}`);

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.data) {
                    this.currentUser = data.data;
                    return true;
                }
            }
            return false;
        } catch (error) {
            console.error('[AUTH] Session verification error:', error);
            return false;
        }
    }

    /**
     * Authenticate user with access key
     * - Logs in if key exists
     * - Creates account if key doesn't exist (auto-create)
     *
     * @param {string} rawKey - Raw access key from user
     * @returns {Promise<Object>} Authentication result
     */
    async authenticate(rawKey) {
        try {
            // Normalize key
            const normalizedKey = rawKey.trim();

            if (normalizedKey === '') {
                return {
                    success: false,
                    error: 'Key cannot be empty'
                };
            }

            // Try login first
            const loginResult = await this.login(normalizedKey);

            // If login fails (user not found), try creating account
            if (!loginResult.success && loginResult.error === 'User not found') {
                return await this.createAccount(normalizedKey);
            }

            return loginResult;
        } catch (error) {
            console.error('[AUTH] Authentication error:', error);
            return {
                success: false,
                error: 'Authentication failed. Please try again.'
            };
        }
    }

    /**
     * Login with existing key
     * @param {string} normalizedKey - Normalized access key
     * @returns {Promise<Object>} Login result
     */
    async login(normalizedKey) {
        try {
            const response = await fetch(AUTH_CONFIG.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: normalizedKey,
                    action: 'login'
                })
            });

            const data = await response.json();

            if (data.success) {
                // Store hash and key in sessionStorage
                sessionStorage.setItem(AUTH_CONFIG.storageKeys.userHash, data.hash);
                sessionStorage.setItem(AUTH_CONFIG.storageKeys.userKey, normalizedKey);

                this.userHash = data.hash;
                this.userKey = normalizedKey;
                this.currentUser = data.data;

                return {
                    success: true,
                    isNewUser: false,
                    message: 'Welcome back!'
                };
            } else {
                return {
                    success: false,
                    error: data.error || 'Login failed'
                };
            }
        } catch (error) {
            console.error('[AUTH] Login error:', error);
            return {
                success: false,
                error: 'Login failed. Please try again.'
            };
        }
    }

    /**
     * Create new account
     * @param {string} normalizedKey - Normalized access key
     * @returns {Promise<Object>} Registration result
     */
    async createAccount(normalizedKey) {
        try {
            const response = await fetch(AUTH_CONFIG.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: normalizedKey,
                    action: 'create'
                })
            });

            const data = await response.json();

            if (data.success) {
                // Store hash and key in sessionStorage
                sessionStorage.setItem(AUTH_CONFIG.storageKeys.userHash, data.hash);
                sessionStorage.setItem(AUTH_CONFIG.storageKeys.userKey, normalizedKey);

                this.userHash = data.hash;
                this.userKey = normalizedKey;
                this.currentUser = data.data;

                return {
                    success: true,
                    isNewUser: true,
                    message: 'Account created successfully!'
                };
            } else {
                return {
                    success: false,
                    error: data.error || 'Failed to create account'
                };
            }
        } catch (error) {
            console.error('[AUTH] Account creation error:', error);
            return {
                success: false,
                error: 'Failed to create account. Please try again.'
            };
        }
    }

    /**
     * Logout current user
     * @returns {Promise<Object>} Logout result
     */
    async logout() {
        try {
            // Clear sessionStorage
            this.clearSession();

            // Reset current user
            this.currentUser = null;
            this.userHash = null;
            this.userKey = null;

            // Clear any app data associated with session
            const keysToRemove = [
                APP_CONFIG.storage.keys.spreadsheetData,
                APP_CONFIG.storage.keys.recentFiles,
                APP_CONFIG.storage.keys.userSettings
            ];
            keysToRemove.forEach(key => localStorage.removeItem(key));

            // Redirect to login page
            if (!window.location.pathname.endsWith('/sheets/index.html') && window.location.pathname !== '/sheets/') {
                window.location.href = '/sheets/';
            }

            return {
                success: true,
                message: 'Logged out successfully'
            };
        } catch (error) {
            console.error('[AUTH] Logout error:', error);
            return {
                success: false,
                error: 'Logout failed'
            };
        }
    }

    /**
     * Delete current user account
     * @returns {Promise<Object>} Deletion result
     */
    async deleteAccount() {
        if (!this.userHash) {
            return {
                success: false,
                error: 'No user logged in'
            };
        }

        try {
            const response = await fetch(`${AUTH_CONFIG.apiEndpoint}?hash=${encodeURIComponent(this.userHash)}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                // Clear session after successful deletion
                this.clearSession();
                this.currentUser = null;
                this.userHash = null;
                this.userKey = null;

                // Redirect to login page
                window.location.href = '/sheets/';

                return {
                    success: true,
                    message: 'Account deleted successfully'
                };
            } else {
                return {
                    success: false,
                    error: data.error || 'Failed to delete account'
                };
            }
        } catch (error) {
            console.error('[AUTH] Account deletion error:', error);
            return {
                success: false,
                error: 'Failed to delete account. Please try again.'
            };
        }
    }

    /**
     * Check if user is authenticated
     * @returns {boolean} Authentication status
     */
    isAuthenticated() {
        return this.userHash !== null && this.currentUser !== null;
    }

    /**
     * Get current user
     * @returns {Object|null} Current user object
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Get user hash
     * @returns {string|null} User hash
     */
    getUserHash() {
        return this.userHash;
    }

    /**
     * Get user key (for display purposes only)
     * @returns {string|null} Normalized user key
     */
    getUserKey() {
        return this.userKey;
    }

    /**
     * Clear session from sessionStorage
     */
    clearSession() {
        sessionStorage.removeItem(AUTH_CONFIG.storageKeys.userHash);
        sessionStorage.removeItem(AUTH_CONFIG.storageKeys.userKey);
    }
}

// ================================================
// Initialize Authentication Manager
// ================================================

// Create global authentication instance
const authManager = new AuthenticationManager();

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AuthenticationManager = AuthenticationManager;
    window.authManager = authManager;
}
