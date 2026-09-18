/**
 * ================================================
 * SHEETS - Storage Module
 * ================================================
 * Handles data persistence using the unified /api/users endpoint:
 * - All storage operations go through the user API
 * - Uses user hash from sessionStorage for identification
 * - Spreadsheet data is stored within user data structure
 */

// ================================================
// Storage Class
// ================================================

class SheetsStorage {
    constructor() {
        this.isProduction = APP_CONFIG.isProduction;
        this.apiEndpoint = '/api/users';
    }

    // ================================================
    // Public Methods
    // ================================================

    /**
     * Get current user hash from sessionStorage
     * @returns {string|null} User hash
     */
    getUserHash() {
        return sessionStorage.getItem('sheets_user_hash');
    }

    /**
     * Save spreadsheet data for current user
     * @param {string} sheetId - Spreadsheet ID
     * @param {object} sheetData - Spreadsheet data to save
     * @returns {Promise<boolean>} Success status
     */
    async saveSpreadsheet(sheetId, sheetData) {
        const hash = this.getUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return false;
        }

        try {
            const response = await fetch(`${this.apiEndpoint}?${new URLSearchParams({ _cacheBust: Date.now() })}`, {
                method: 'PUT',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                },
                body: JSON.stringify({
                    hash: hash,
                    action: 'updateSheet',
                    data: {
                        sheetId: sheetId,
                        sheetData: sheetData,
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
     * Load all user data (including spreadsheets)
     * @returns {Promise<object|null>} User data with spreadsheets
     */
    async loadUserData() {
        const hash = this.getUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }

        try {
            // Add cache-busting timestamp to ensure fresh data
            const cacheBuster = `&_t=${Date.now()}`;
            const response = await fetch(`${this.apiEndpoint}?hash=${encodeURIComponent(hash)}${cacheBuster}`, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            if (response.ok) {
                const result = await response.json();
                return result.success ? result.data : null;
            } else {
                console.error('[STORAGE] Load failed:', response.status);
                return null;
            }
        } catch (error) {
            console.error('[STORAGE] Load error:', error);
            return null;
        }
    }

    /**
     * Get specific spreadsheet from user data
     * @param {string} sheetId - Spreadsheet ID
     * @returns {Promise<object|null>} Spreadsheet data
     */
    async getSpreadsheet(sheetId) {
        const userData = await this.loadUserData();

        if (!userData || !userData.sheets) {
            console.error('[STORAGE] No user data or spreadsheets found');
            return null;
        }

        const spreadsheet = userData.sheets.find(s => s.id === sheetId);
        return spreadsheet || null;
    }

    /**
     * Get all spreadsheets for current user
     * @returns {Promise<Array>} Array of spreadsheets
     */
    async getSpreadsheets() {
        const userData = await this.loadUserData();
        if (!userData || !userData.sheets) {
            return [];
        }

        return userData.sheets;
    }

    /**
     * Delete spreadsheet from user data
     * Server-side handles deleting the shared copy if one exists
     * @param {string} sheetId - Spreadsheet ID to delete
     * @returns {Promise<boolean>} Success status
     */
    async deleteSpreadsheet(sheetId) {
        const hash = this.getUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return false;
        }

        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash: hash,
                    action: 'deleteSheet',
                    data: {
                        sheetId: sheetId
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
     * Update user settings
     * @param {object} settings - Settings object to update
     * @returns {Promise<boolean>} Success status
     */
    async saveSettings(settings) {
        const hash = this.getUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return false;
        }

        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash: hash,
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

    /**
     * Get user settings from user data
     * @returns {Promise<object>} User settings
     */
    async getSettings() {
        const userData = await this.loadUserData();
        if (!userData || !userData.settings) {
            // Return default settings
            return {
                theme: 'light'
            };
        }

        return userData.settings;
    }

    // ================================================
    // Share Functionality
    // ================================================

    /**
     * Share a spreadsheet (server-side, no CORS issues)
     * @param {string} sheetId - Spreadsheet ID to share
     * @returns {Promise<object|null>} Share result with shareUrl and alreadyShared flag
     */
    async shareSpreadsheet(sheetId) {
        const hash = this.getUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }

        try {
            // Call server-side API to handle sharing
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash: hash,
                    action: 'shareSheet',
                    data: {
                        sheetId: sheetId
                    }
                })
            });

            const result = await response.json();

            if (!result.success) {
                console.error('[STORAGE] Failed to share spreadsheet:', result.error);
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
     * Get shared spreadsheet from textdb.dev
     * @param {string} shareId - Share ID
     * @returns {Promise<object|null>} Shared spreadsheet data
     */
    async getSharedSpreadsheet(shareId) {
        try {
            const response = await fetch(`https://textdb.dev/api/data/shared_${shareId}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                return null;
            }

            const text = await response.text();

            // Check for empty or invalid content
            if (!text || text.trim() === '' || text.includes('hello world from textdb') || text.length < 10) {
                return null;
            }

            let parsed;
            try {
                parsed = JSON.parse(text);
                if (typeof parsed === 'string') {
                    parsed = JSON.parse(parsed);
                }
            } catch (parseError) {
                console.error('[STORAGE] JSON parse error:', parseError);
                return null;
            }

            // Validate structure
            if (!parsed || typeof parsed !== 'object' || !parsed.spreadsheet) {
                return null;
            }

            return parsed;

        } catch (error) {
            console.error('[STORAGE] Get shared spreadsheet error:', error);
            return null;
        }
    }

    /**
     * Generate unique ID for sharing
     * @returns {string} Unique ID
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2);
    }

    /**
     * Get base URL for share links
     * @returns {string} Base URL
     */
    getBaseUrl() {
        // Determine base URL from current location
        const protocol = window.location.protocol;
        const host = window.location.host;
        return `${protocol}//${host}`;
    }

    // ================================================
    // Legacy Methods (for backward compatibility)
    // ================================================

    /**
     * Legacy method - uses new API
     * @deprecated Use saveSpreadsheet with spreadsheet ID instead
     */
    async saveSpreadsheetByHash(hash, data) {
        console.warn('[STORAGE] saveSpreadsheetByHash is deprecated, use saveSpreadsheet instead');
        // This would need a spreadsheet ID, using hash as fallback
        return this.saveSpreadsheet(hash, data);
    }

    /**
     * Legacy method - uses new API
     * @deprecated Use loadUserData instead
     */
    async loadSpreadsheet(hash) {
        console.warn('[STORAGE] loadSpreadsheet is deprecated, use loadUserData instead');
        return this.loadUserData();
    }

    /**
     * Legacy method - uses new API
     * @deprecated Use getSpreadsheets instead
     */
    async listSpreadsheets() {
        return this.getSpreadsheets();
    }
}

// ================================================
// Export
// ================================================

// Initialize global storage instance
const sheetsStorage = new SheetsStorage();

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.SheetsStorage = SheetsStorage;
    window.sheetsStorage = sheetsStorage;
}
