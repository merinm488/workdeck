/**
 * ================================================
 * SHEETS - Shared Spreadsheet Module
 * ================================================
 * Read-only view of a shared spreadsheet:
 * - Shows spreadsheet in view-only mode
 * - No edit/delete/save options
 * - Handles shared links with ?shared= parameter
 */

class SharedSpreadsheet {
    constructor() {
        this.shareId = null;
        this.spreadsheetData = null;
        this.isLoaded = false;
    }

    /**
     * Initialize shared spreadsheet view
     */
    async init() {
        try {
            // Get share ID from URL
            const urlParams = new URLSearchParams(window.location.search);
            this.shareId = urlParams.get('shared');

            if (!this.shareId) {
                this.showError('No share ID provided');
                return;
            }

            // Fetch shared spreadsheet from textdb.dev
            await this.fetchSharedSpreadsheet();

        } catch (error) {
            console.error('[SHARED] Initialization error:', error);
            this.showError('Failed to load shared spreadsheet');
        }
    }

    /**
     * Fetch shared spreadsheet from server API (server-side handles textdb.dev)
     */
    async fetchSharedSpreadsheet() {
        try {
            this.showLoading();

            // Use server API to avoid CORS issues (server fetches from textdb.dev)
            const response = await fetch(`/api/users?shared=${encodeURIComponent(this.shareId)}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                this.showError('Shared spreadsheet not found');
                return;
            }

            const result = await response.json();

            if (!result.success) {
                this.showError('Shared spreadsheet not found');
                return;
            }

            this.spreadsheetData = result.sheet;

            // Update the page title with the actual spreadsheet name
            this.updatePageTitle();

            // Initialize Univer in read-only mode
            await this.initializeSpreadsheet();

        } catch (error) {
            console.error('[SHARED] Fetch error:', error);
            this.showError('Failed to load shared spreadsheet');
        }
    }

    /**
     * Initialize Univer in view mode.
     * Viewers can filter and sort interactively (viewer-side only),
     * but data entry / cell edits stay blocked.
     */
    async initializeSpreadsheet() {
        try {
            const body = this.spreadsheetData.data || this.spreadsheetData;

            // Legacy Luckysheet payload - cannot be rendered by the new engine
            if (Array.isArray(body)) {
                this.showLegacyNotice();
                this.hideLoading();
                return;
            }

            if (typeof UniverPresets === 'undefined') {
                throw new Error('Univer not loaded');
            }

            const { createUniver } = UniverPresets;
            const { LocaleType, mergeLocales } = UniverCore;
            const { UniverSheetsCorePreset } = UniverPresetSheetsCore;

            // Optional presets load when their scripts are present
            const presets = [UniverSheetsCorePreset({ container: 'univer' })];
            const locales = [UniverPresetSheetsCoreEnUS];

            if (typeof UniverPresetSheetsFilter !== 'undefined' &&
                typeof UniverPresetSheetsFilterEnUS !== 'undefined') {
                presets.push(UniverPresetSheetsFilter.UniverSheetsFilterPreset());
                locales.push(UniverPresetSheetsFilterEnUS);
            }

            if (typeof UniverPresetSheetsSort !== 'undefined' &&
                typeof UniverPresetSheetsSortEnUS !== 'undefined') {
                presets.push(UniverPresetSheetsSort.UniverSheetsSortPreset());
                locales.push(UniverPresetSheetsSortEnUS);
            }

            const { univerAPI } = createUniver({
                locale: LocaleType.EN_US,
                locales: { [LocaleType.EN_US]: mergeLocales(...locales) },
                presets,
            });

            const fWorkbook = univerAPI.createWorkbook({
                ...body,
                name: this.spreadsheetData.name || body.name || 'Untitled Spreadsheet',
            });

            // Data entry stays blocked, but filter/sort interactions
            // remain available for the viewer (viewer-side only)
            fWorkbook.setEditable(false);
            this.univerAPI = univerAPI;
            this.fWorkbook = fWorkbook;

            this.isLoaded = true;
            this.hideLoading();

        } catch (error) {
            console.error('[SHARED] Spreadsheet initialization error:', error);
            this.showError('Failed to display spreadsheet');
        }
    }

    /**
     * Friendly notice for spreadsheets created with the older
     * Luckysheet-based version of Sheets. Data stays untouched.
     */
    showLegacyNotice() {
        const container = document.getElementById('univer');
        const tpl = document.getElementById('legacyNoticeTemplate');
        if (!container || !tpl) return;

        container.replaceChildren(tpl.content.cloneNode(true));
    }

    /**
     * Show loading overlay
     */
    showLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        const errorOverlay = document.getElementById('errorOverlay');
        if (loadingOverlay) {
            loadingOverlay.classList.remove('hidden');
            loadingOverlay.style.display = 'flex';
        }
        if (errorOverlay) {
            errorOverlay.classList.add('hidden');
            errorOverlay.style.display = 'none';
        }
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
            loadingOverlay.style.display = 'none';
        }
    }

    /**
     * Show error overlay
     */
    showError(message) {
        this.hideLoading();
        const errorOverlay = document.getElementById('errorOverlay');
        const loadingOverlay = document.getElementById('loadingOverlay');

        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }

        if (errorOverlay) {
            errorOverlay.classList.remove('hidden');
            errorOverlay.style.display = 'flex';
            const errorText = errorOverlay.querySelector('p');
            if (errorText && message) {
                errorText.textContent = message;
            }
        }
    }

    /**
     * Update page title with spreadsheet name
     */
    updatePageTitle() {
        const titleElement = document.getElementById('sharedSpreadsheetTitle');
        if (titleElement && this.spreadsheetData.name) {
            titleElement.textContent = this.spreadsheetData.name;
        }

        // Update document title as well
        if (this.spreadsheetData.name) {
            document.title = `${this.spreadsheetData.name} - Shared Spreadsheet`;
        }
    }

    /**
     * Close shared view
     */
    close() {
        // Close window or navigate to home
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = '/sheets/';
        }
    }
}

// ================================================
// Initialize Shared Spreadsheet View
// ================================================

let sharedSpreadsheet;

document.addEventListener('DOMContentLoaded', async () => {
    // Wait for Univer to be available
    let attempts = 0;
    const maxAttempts = 100;
    while (typeof UniverPresets === 'undefined' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }

    if (typeof UniverPresets === 'undefined') {
        console.error('[SHARED] Univer failed to load');
        document.body.replaceChildren(
            document.getElementById('univerFailTemplate').content.cloneNode(true));
        return;
    }

    sharedSpreadsheet = new SharedSpreadsheet();
    await sharedSpreadsheet.init();

    // Set up event listeners
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) {
        homeBtn.addEventListener('click', () => sharedSpreadsheet.close());
    }

    const closeErrorBtn = document.getElementById('closeErrorBtn');
    if (closeErrorBtn) {
        closeErrorBtn.addEventListener('click', () => sharedSpreadsheet.close());
    }

    // Expose globally for debugging
    window.sharedSpreadsheet = sharedSpreadsheet;
});

// Handle window errors
window.addEventListener('error', (event) => {
    console.error('[SHARED] Application error:', event.error);
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
    console.error('[SHARED] Unhandled promise rejection:', event.reason);
});
