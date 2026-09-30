/**
 * ================================================
 * SHEETS - Spreadsheet Module (Univer)
 * ================================================
 * Manages the Univer spreadsheet engine (successor of Luckysheet):
 * - Initialization and configuration
 * - Data operations (load, save, export)
 * - Cell formulas and calculations
 * - Multi-sheet management
 * - Import/Export (via SheetJS community edition)
 * - Undo/Redo operations
 * - Freeze rows/columns
 *
 * Storage format (v2): spreadsheet.data is a plain Univer workbook
 * snapshot (IWorkbookData) - a JSON object, NOT an array.
 * Legacy Luckysheet saves (array of sheets with celldata) are detected
 * and surfaced with a friendly notice instead of being rendered.
 */

// ================================================
// Spreadsheet Manager Class
// ================================================

class SpreadsheetManager {
    constructor() {
        // Initialize spreadsheet manager
        this.container = null;
        this.univerAPI = null;      // FUniver facade
        this.fWorkbook = null;      // Active FWorkbook
        this.currentSheetId = null;
        this.isInitialized = false;
        this.currentSpreadsheetMetadata = null; // Cache spreadsheet metadata
        this.changeDisposables = [];            // Univer event subscriptions
        this.changeListenersEnabled = false;
        this.legacyNoticeShown = false;
        this.darkModeOn = false;

        // Default grid dimensions (kept from previous version)
        this.defaultRowCount = APP_CONFIG.spreadsheet.default.row;
        this.defaultColumnCount = APP_CONFIG.spreadsheet.default.column;
    }

    // ================================================
    // Initialization
    // ================================================

    /**
     * Initialize the Univer application and load data
     * @param {object} initialData - Workbook snapshot (or null for empty)
     * @param {string} workbookName - Name shown in the editor
     * @returns {Promise<{ok: boolean, legacy: boolean}>} Result status
     */
    async initialize(initialData = null, workbookName = 'Untitled Spreadsheet') {
        const containerElement = document.getElementById(APP_CONFIG.spreadsheet.container);
        if (containerElement === null) {
            console.error('[SPREADSHEET] Container element not found:', APP_CONFIG.spreadsheet.container);
            this.showError('Spreadsheet container not found');
            return { ok: false, legacy: false };
        }
        this.container = containerElement;

        // Legacy Luckysheet payloads are arrays of sheet objects
        if (Array.isArray(initialData)) {
            console.warn('[SPREADSHEET] Legacy Luckysheet data detected');
            this.hideLoading();
            this.showLegacyNotice();
            return { ok: false, legacy: true };
        }

        this.showLoading();

        try {
            if (!this.univerAPI) {
                this.createUniverInstance();
            }

            const snapshot = initialData || this.createDefaultData(workbookName);

            // Dispose any previously open unit before creating another one
            this.disposeCurrentWorkbook();

            this.fWorkbook = this.univerAPI.createWorkbook(snapshot);
            this.syncEditorTheme();

            this.isInitialized = true;
            this.hideLoading();
            return { ok: true, legacy: false };
        } catch (error) {
            console.error('[SPREADSHEET] Univer initialization error:', error);
            this.hideLoading();
            this.showError('Failed to initialize spreadsheet. Please refresh the page.');
            return { ok: false, legacy: false };
        }
    }

    /**
     * Create the singleton Univer instance bound to the container
     */
    createUniverInstance() {
        if (typeof UniverPresets === 'undefined') {
            throw new Error('Univer library not loaded');
        }

        const { createUniver } = UniverPresets;
        const { LocaleType, mergeLocales } = UniverCore;
        const { UniverSheetsCorePreset } = UniverPresetSheetsCore;

        // Filter/sort are optional add-ons - degrade gracefully if their
        // scripts failed to load (e.g. stale cached HTML without the
        // script tags, or a CDN hiccup) so the core editor still works
        const presets = [UniverSheetsCorePreset({
            container: APP_CONFIG.spreadsheet.container,
        })];
        const locales = [UniverPresetSheetsCoreEnUS];

        if (typeof UniverPresetSheetsFilter !== 'undefined' &&
            typeof UniverPresetSheetsFilterEnUS !== 'undefined') {
            presets.push(UniverPresetSheetsFilter.UniverSheetsFilterPreset());
            locales.push(UniverPresetSheetsFilterEnUS);
        } else {
            console.warn('[SPREADSHEET] Filter preset not loaded - filter unavailable');
        }

        if (typeof UniverPresetSheetsSort !== 'undefined' &&
            typeof UniverPresetSheetsSortEnUS !== 'undefined') {
            presets.push(UniverPresetSheetsSort.UniverSheetsSortPreset());
            locales.push(UniverPresetSheetsSortEnUS);
        } else {
            console.warn('[SPREADSHEET] Sort preset not loaded - sort unavailable');
        }

        const { univerAPI } = createUniver({
            locale: LocaleType.EN_US,
            locales: { [LocaleType.EN_US]: mergeLocales(...locales) },
            presets,
        });

        this.univerAPI = univerAPI;
    }

    /**
     * Destroy the currently open workbook (keeps the Univer app alive)
     */
    disposeCurrentWorkbook() {
        if (this.univerAPI && this.fWorkbook) {
            try {
                this.univerAPI.disposeUnit(this.fWorkbook.getId());
            } catch (error) {
                console.warn('[SPREADSHEET] Error disposing previous workbook:', error);
            }
            this.fWorkbook = null;
        }
        this.stopChangeTracking();
    }

    /**
     * Show error message to user
     * @param {string} message - Error message
     */
    showError(message) {
        const container = document.getElementById(APP_CONFIG.spreadsheet.container);
        if (container) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; color: var(--text-primary); text-align: center; padding: 20px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                    <h2 style="margin-bottom: 10px;">Spreadsheet Error</h2>
                    <p style="margin-bottom: 20px; color: var(--text-secondary);">${message}</p>
                    <button onclick="location.reload()" style="padding: 10px 20px; background: var(--accent-color); color: white; border: none; border-radius: 6px; cursor: pointer;">
                        Refresh Page
                    </button>
                </div>
            `;
        }
    }

    /**
     * Friendly notice for spreadsheets created with the older
     * Luckysheet-based version of Sheets. Their data is left untouched.
     */
    showLegacyNotice() {
        if (this.legacyNoticeShown) return;
        this.legacyNoticeShown = true;

        const container = document.getElementById(APP_CONFIG.spreadsheet.container);
        if (!container) return;

        const isSharedView = !document.getElementById('saveBtn');
        container.innerHTML = `
            <div class="legacy-notice">
                <div class="legacy-notice-card">
                    <div class="legacy-notice-icon">📊</div>
                    <h2>Created with an older version of Sheets</h2>
                    <p>This spreadsheet was made with the previous Sheets engine and can no longer be opened here.</p>
                    <p class="legacy-banner">Your data is safe and untouched in your account.</p>
                    ${isSharedView
                        ? '<button class="home-cancel-btn" id="legacyCloseBtn">Close</button>'
                        : '<button class="home-cancel-btn" id="legacyHomeBtn">Back to Home</button>'}
                </div>
            </div>
        `;

        const homeBtn = document.getElementById('legacyHomeBtn');
        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                window.location.href = '/sheets/home.html';
            });
        }
    }

    /**
     * Build an empty workbook snapshot in the current storage format
     * @param {string} name - Workbook name
     * @returns {object} Univer workbook snapshot
     */
    createDefaultData(name = 'Untitled Spreadsheet') {
        return this.buildEmptySheetSnapshot('sheet-1', 'Sheet1', name);
    }

    /**
     * Create a snapshot containing one empty worksheet
     * @param {string} sheetId - Worksheet id
     * @param {string} sheetName - Worksheet name
     * @param {string} workbookName - Workbook name
     * @returns {object} Univer workbook snapshot
     */
    buildEmptySheetSnapshot(sheetId, sheetName, workbookName) {
        return {
            id: this.generateWorkbookId(),
            name: workbookName,
            appVersion: '0.25.1',
            locale: 'enUS',
            styles: {},
            sheetOrder: [sheetId],
            sheets: {
                [sheetId]: {
                    id: sheetId,
                    name: sheetName,
                    tabColor: '',
                    hidden: 0,
                    freeze: { xOffset: 0, yOffset: 0, startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
                    rowCount: this.defaultRowCount,
                    columnCount: this.defaultColumnCount,
                    zoomRatio: 1,
                    scrollTop: 0,
                    scrollLeft: 0,
                    defaultColumnWidth: 73,
                    defaultRowHeight: 19,
                    mergeData: [],
                    cellData: {},
                    rowData: {},
                    columnData: {},
                    rowHeader: { width: 46 },
                    columnHeader: { height: 20 },
                    rightToLeft: 0,
                },
            },
        };
    }

    /**
     * Generate a unique workbook/unit id
     * @returns {string} Unique id
     */
    generateWorkbookId() {
        return `wb_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`;
    }

    // ================================================
    // Data Operations
    // ================================================

    /**
     * Load spreadsheet data into the editor
     * Accepts a Univer snapshot (object). Legacy arrays are rejected
     * with the friendly notice.
     * @param {object} data - Workbook snapshot
     * @param {string} workbookName - Fallback name
     * @returns {Promise<{ok: boolean, legacy: boolean}>}
     */
    async loadData(data, workbookName = 'Untitled Spreadsheet') {
        if (Array.isArray(data)) {
            this.hideLoading();
            this.showLegacyNotice();
            return { ok: false, legacy: true };
        }

        if (!data || typeof data !== 'object' || !data.sheets) {
            console.error('[SPREADSHEET] Invalid snapshot structure:', data);
            return { ok: false, legacy: false };
        }

        const result = await this.initialize(data, workbookName);
        return result;
    }

    /**
     * Get current workbook snapshot (the persisted form)
     * @returns {object|null} Workbook snapshot
     */
    getData() {
        if (!this.isInitialized || !this.fWorkbook) return null;
        try {
            return this.fWorkbook.save();
        } catch (error) {
            console.error('[SPREADSHEET] Failed to serialize workbook:', error);
            return null;
        }
    }

    /**
     * Snapshot Univer's own render canvases into a small image data URL,
     * stored on the record as the Workdeck card thumbnail.
     * Returns null when there is nothing to capture (not rendered yet,
     * tainted canvas, ...) - callers then just omit the thumbnail.
     * @param {number} maxWidth - Output pixel width cap
     * @returns {string|null} PNG (or JPEG when too large) data URL
     */
    captureThumbnail(maxWidth = 640) {
        try {
            if (!this.container || !this.isInitialized) return null;

            const containerRect = this.container.getBoundingClientRect();
            if (!containerRect.width || !containerRect.height) return null;

            let canvases = Array.from(
                this.container.querySelectorAll('canvas[data-u-comp="render-canvas"]')
            );
            if (!canvases.length) {
                canvases = Array.from(this.container.querySelectorAll('canvas'));
            }

            const rects = new Map();
            let largest = 0;
            canvases = canvases.filter(c => {
                if (!c.width || !c.height) return false;
                const rect = c.getBoundingClientRect();
                rects.set(c, rect);
                const area = rect.width * rect.height;
                if (area > largest) largest = area;
                return true;
            });
            if (!canvases.length || !largest) return null;

            // Keep the layer stack, drop tiny helper canvases
            const layers = canvases.filter(
                c => rects.get(c).width * rects.get(c).height >= largest * 0.1
            );
            if (!layers.length) return null;

            let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            layers.forEach(c => {
                const r = rects.get(c);
                left = Math.min(left, r.left - containerRect.left);
                top = Math.min(top, r.top - containerRect.top);
                right = Math.max(right, r.right - containerRect.left);
                bottom = Math.max(bottom, r.bottom - containerRect.top);
            });
            const unionW = right - left;
            const unionH = bottom - top;
            if (unionW <= 0 || unionH <= 0) return null;

            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const composite = document.createElement('canvas');
            composite.width = Math.round(unionW * dpr);
            composite.height = Math.round(unionH * dpr);
            const ctx = composite.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, composite.width, composite.height);
            layers.forEach(c => {
                const r = rects.get(c);
                ctx.drawImage(
                    c,
                    (r.left - containerRect.left - left) * dpr,
                    (r.top - containerRect.top - top) * dpr,
                    r.width * dpr,
                    r.height * dpr
                );
            });

            const outW = Math.min(composite.width, maxWidth);
            const outH = Math.max(1, Math.round(composite.height * outW / composite.width));
            const out = document.createElement('canvas');
            out.width = outW;
            out.height = outH;
            out.getContext('2d').drawImage(composite, 0, 0, outW, outH);

            const png = out.toDataURL('image/png');
            if (png.length <= 250000) return png;
            return out.toDataURL('image/jpeg', 0.75);
        } catch (error) {
            console.warn('[SPREADSHEET] Thumbnail capture failed:', error);
            return null;
        }
    }

    /**
     * Get the active worksheet facade
     * @returns {object|null} FWorksheet
     */
    getCurrentSheetData() {
        if (!this.isInitialized || !this.fWorkbook) return null;
        return this.fWorkbook.getActiveSheet();
    }

    /**
     * Get cached spreadsheet metadata
     * @returns {object|null} Spreadsheet metadata or null
     */
    getMetadata() {
        return this.currentSpreadsheetMetadata;
    }

    /**
     * Whether the last load attempt hit a legacy Luckysheet file
     * @returns {boolean}
     */
    isLegacyBlocked() {
        return this.legacyNoticeShown;
    }

    /**
     * Save spreadsheet data
     * Persist current state to storage using cached metadata
     * @returns {Promise<boolean>} Success status
     */
    async save() {
        const snapshot = this.getData();
        if (!snapshot || !this.currentSheetId) {
            console.error('[SPREADSHEET] Error saving - no data or sheet ID');
            return false;
        }

        // Use cached metadata instead of fetching from API
        const existingSpreadsheet = this.currentSpreadsheetMetadata || {
            name: 'Untitled Spreadsheet',
            createdAt: new Date().toISOString()
        };

        // Build complete spreadsheet object with metadata
        const spreadsheetData = {
            id: this.currentSheetId,
            name: existingSpreadsheet.name || 'Untitled Spreadsheet',
            data: snapshot,
            formatVersion: 2,
            createdAt: existingSpreadsheet.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sharedId: existingSpreadsheet.sharedId || null
        };

        // True canvas snapshot for the Workdeck card. On failure it's
        // omitted, which keeps the previous thumbnail via the API merge.
        const thumbnail = this.captureThumbnail();
        if (thumbnail) spreadsheetData.thumbnail = thumbnail;

        const success = await sheetsStorage.saveSpreadsheet(this.currentSheetId, spreadsheetData);

        // Update cached metadata immediately after save
        if (success) {
            this.currentSpreadsheetMetadata = spreadsheetData;

            // If spreadsheet is shared, update the shared copy asynchronously (non-blocking)
            if (spreadsheetData.sharedId) {
                this.updateSharedCopy(spreadsheetData).catch(e => {
                    console.error('[SPREADSHEET] Failed to update shared copy:', e);
                });
            }
        }

        return success;
    }

    /**
     * Load spreadsheet from storage
     * Load data from storage and cache metadata
     * @param {string} id - Spreadsheet ID
     * @returns {Promise<boolean>} Success status
     */
    async load(id) {
        this.showLoading();

        try {
            // Set currentSheetId immediately to ensure consistency
            this.currentSheetId = id;

            // Get specific spreadsheet from user data
            const spreadsheetData = await sheetsStorage.getSpreadsheet(id);

            if (!spreadsheetData) {
                console.error('[SPREADSHEET] No spreadsheet data found for ID:', id);
                this.currentSheetId = null;
                this.hideLoading();
                return false;
            }

            // Cache the metadata (id, name, dates, sharedId) to avoid refetching
            this.currentSpreadsheetMetadata = {
                id: spreadsheetData.id,
                name: spreadsheetData.name,
                createdAt: spreadsheetData.createdAt,
                updatedAt: spreadsheetData.updatedAt,
                sharedId: spreadsheetData.sharedId || null
            };

            // Extract the spreadsheet body
            let body = spreadsheetData.data || spreadsheetData;

            const result = await this.loadData(body, spreadsheetData.name);
            if (!result.ok) {
                this.currentSheetId = result.legacy ? id : null;
                return false;
            }

            this.data = body;
            this.hideLoading();
            return true;
        } catch (error) {
            console.error('[SPREADSHEET] Load error:', error);
            this.currentSheetId = null;
            this.hideLoading();
            return false;
        }
    }

    // ================================================
    // Change Tracking (auto-save support)
    // ================================================

    /**
     * Start listening for user edits so the app can mark unsaved changes.
     *
     * Filtering strategy:
     * - Commands of type OPERATION are transient UI state (selection,
     *   scroll, active-cell) and never represent document edits.
     * - Internal bookkeeping namespaces (formula engine triggers,
     *   rich-text editing previews) are ignored.
     * - Everything else (COMMAND/MUTATION like set-range-values,
     *   set-style, insert-row, set-frozen, sheet CRUD) marks the
     *   document dirty.
     *
     * Arming strategy: listeners attach immediately but stay muted
     * until the workbook has been quiet for ~0.8s and at least 2s
     * have passed since init - so snapshot hydration on slow boots
     * does not register as a user edit.
     */
    startChangeTracking(onChange) {
        if (!this.univerAPI || typeof onChange !== 'function') return;

        this.stopChangeTracking();
        this.onChangeCallback = onChange;

        // Mutations fired purely by internal subsystems, not user intent
        const ignoredMutations = [
            'formula.mutation.',
            'doc.mutation.rich-text-editing',
        ];

        const disposable = this.univerAPI.onCommandExecuted((command) => {
            if (!command || typeof command.id !== 'string') return;

            const id = command.id;
            const now = Date.now();
            this.lastCommandAt = now;

            if (!this.changeListenersEnabled) return;

            // OPERATION = ephemeral view state, never document content
            const CommandTypeRef = (typeof UniverCore !== 'undefined' && UniverCore.CommandType)
                ? UniverCore.CommandType : null;
            if (CommandTypeRef && command.type === CommandTypeRef.OPERATION) return;

            if (ignoredMutations.some(prefix => id.startsWith(prefix))) return;

            onChange();
        });

        this.changeDisposables.push(disposable);

        // Arm on quiescence rather than a fixed delay
        this.changeTrackingStartedAt = Date.now();
        this.lastCommandAt = Date.now();
        const armTimer = setInterval(() => {
            const elapsed = Date.now() - this.changeTrackingStartedAt;
            const quietFor = Date.now() - this.lastCommandAt;
            if (elapsed >= 2000 && quietFor >= 800) {
                clearInterval(armTimer);
                this.changeListenersEnabled = true;
            }
        }, 250);
        this.changeDisposables.push({ dispose: () => clearInterval(armTimer) });
    }

    /**
     * Remove all change-tracking subscriptions
     */
    stopChangeTracking() {
        this.changeDisposables.forEach(d => {
            try { d && d.dispose && d.dispose(); } catch (e) { /* noop */ }
        });
        this.changeDisposables = [];
        this.changeListenersEnabled = false;
    }

    // ================================================
    // Theme
    // ================================================

    /**
     * Apply app theme to the editor (light/dark)
     * @param {string} themeName - 'light' or 'dark'
     */
    applyTheme(themeName) {
        const wantDark = themeName === 'dark';
        if (this.univerAPI && wantDark !== this.darkModeOn) {
            this.univerAPI.toggleDarkMode();
            this.darkModeOn = wantDark;
        }
        document.documentElement.style.setProperty('--sheet-accent', 'var(--accent-color)');
    }

    /**
     * Sync editor theme with the app-wide data-theme attribute
     */
    syncEditorTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        if (current) this.applyTheme(current);
    }

    // ================================================
    // Sheet Operations
    // ================================================

    /**
     * Add new sheet
     * @param {string} name - Sheet name
     * @returns {string|null} New sheet ID
     */
    addSheet(name = null) {
        if (!this.ready()) return null;
        if (name === null) {
            name = this.generateSheetName();
        }
        const sheet = this.fWorkbook.insertSheet(name);
        return sheet ? sheet.getSheetId() : null;
    }

    /**
     * Delete the active sheet
     * @returns {boolean} Success status
     */
    deleteSheet() {
        if (!this.ready()) return false;

        // Prevent deleting the last remaining sheet
        if (this.fWorkbook.getNumSheets() <= 1) {
            console.error('[SPREADSHEET] Cannot delete the last sheet');
            return false;
        }

        // Activate another sheet first - Univer requires a surviving active sheet
        const doomedId = this.fWorkbook.getActiveSheet().getSheetId();
        const surviving = this.fWorkbook.getSheets().find(s => s.getSheetId() !== doomedId);
        if (surviving) {
            this.fWorkbook.setActiveSheet(surviving);
        }

        return this.fWorkbook.deleteSheet(doomedId);
    }

    /**
     * Rename sheet
     * @param {string} sheetId - Sheet ID
     * @param {string} newName - New name
     * @returns {boolean} Success status
     */
    renameSheet(sheetId, newName) {
        if (!this.ready()) return false;
        const sheet = this.fWorkbook.getSheetBySheetId(sheetId);
        if (!sheet) return false;
        sheet.setName(newName);
        return true;
    }

    /**
     * Duplicate the active sheet
     * @returns {string|null} New sheet ID
     */
    duplicateSheet() {
        if (!this.ready()) return false;
        const copy = this.fWorkbook.duplicateActiveSheet();
        return copy ? copy.getSheetId() : null;
    }

    /**
     * Switch to sheet
     * @param {string} sheetId - Target sheet ID
     */
    switchSheet(sheetId) {
        if (!this.ready()) return;
        const sheet = this.fWorkbook.getSheetBySheetId(sheetId);
        if (sheet) this.fWorkbook.setActiveSheet(sheet);
    }

    // ================================================
    // Cell Operations
    // ================================================

    /**
     * Get cell value
     * @param {string} cell - Cell reference (e.g., 'A1')
     * @returns {string|number|null} Cell value
     */
    getCellValue(cell) {
        if (!this.ready()) return null;
        const ref = this.resolveRangeRef(cell);
        return ref ? ref.getValue() : null;
    }

    /**
     * Set cell value (formulas starting with '=' are written as formulas)
     * @param {string} cell - Cell reference (e.g., 'A1')
     * @param {string|number} value - Value to set
     */
    setCellValue(cell, value) {
        if (!this.ready()) return;
        const ref = this.resolveRangeRef(cell);
        if (!ref) return;

        if (typeof value === 'string' && value.startsWith('=')) {
            ref.setFormula(value);
        } else {
            ref.setValue(value);
        }
    }

    /**
     * Get selected cells
     * @returns {object|null} Active FRange selection
     */
    getSelectedCells() {
        if (!this.ready()) return null;
        return this.getCurrentSheetData().getActiveRange();
    }

    /**
     * Format cells
     * Apply formatting to cells ('A1' or 'A1:B2')
     * @param {string|Array} cells - Cell reference(s)
     * @param {object} format - Format options ({fontWeight, fontStyle, background, fontColor, ...})
     */
    formatCells(cells, format) {
        if (!this.ready()) return;
        const ranges = Array.isArray(cells) ? cells : [cells];
        ranges.forEach(refStr => {
            const range = this.resolveRangeRef(refStr);
            if (!range) return;
            if (format.fontWeight) range.setFontWeight(format.fontWeight);
            if (format.fontStyle) range.setFontStyle(format.fontStyle);
            if (format.background) range.setBackground(format.background);
            if (format.fontColor) range.setFontColor(format.fontColor);
            if (format.fontSize) range.setFontSize(format.fontSize);
            if (format.wrapStrategy) range.setWrapStrategy(format.wrapStrategy);
        });
    }

    /**
     * Merge the active selection
     * @param {string} type - 'merge' | 'mergeAll' | 'mergeHorizontally' | 'mergeVertically' | 'unmerge'
     */
    mergeCells(type = 'merge') {
        if (!this.ready()) return;
        const range = this.getCurrentSheetData().getActiveRange();
        if (!range) return;

        switch (type) {
            case 'mergeAll':
                range.merge();
                break;
            case 'mergeHorizontally':
                range.mergeAcross();
                break;
            case 'mergeVertically':
                range.mergeVertically();
                break;
            case 'unmerge':
                range.breakApart();
                break;
            default:
                range.merge();
        }
    }

    // ================================================
    // Formula Operations
    // ================================================

    /**
     * Execute a formula and return its calculated value.
     * Uses a scratch cell that is cleared afterwards.
     * @param {string} formula - Formula string (e.g., '=SUM(A1:A10)')
     * @returns {Promise<number|string|null>} Calculated value
     */
    async executeFormula(formula) {
        if (!this.ready() || typeof formula !== 'string' || !formula.startsWith('=')) {
            return null;
        }

        const ws = this.getCurrentSheetData();
        const scratch = ws.getRange(this.defaultRowCount - 1, this.defaultColumnCount - 1);

        scratch.setFormula(formula);

        // Formulas evaluate asynchronously - poll briefly for the result
        let value = null;
        for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            value = scratch.getValue();
            if (value !== null && value !== undefined && value !== '') break;
        }

        scratch.clearContents();
        return value ?? null;
    }

    /**
     * Recalculate everything (no-op: Univer recalculates automatically)
     */
    refreshFormulas() {
        // Univer's formula engine keeps results in sync automatically
    }

    // ================================================
    // Import / Export (real implementations via SheetJS)
    // ================================================

    /**
     * Import a CSV/XLSX file into the current workbook.
     * Each file sheet becomes a workbook sheet.
     * @param {File} file - File to import
     * @returns {Promise<boolean>} Success status
     */
    async importFile(file) {
        if (!window.XLSX) {
            console.error('[SPREADSHEET] SheetJS not available for import');
            return false;
        }

        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
            console.error('[SPREADSHEET] Invalid file type. Only CSV and Excel files are supported.');
            return false;
        }

        try {
            const buffer = await file.arrayBuffer();
            const parsed = XLSX.read(buffer, { type: 'array' });

            // Start from a clean single-sheet workbook, then append parsed sheets
            const baseName = fileName.replace(/\.(csv|xlsx|xls)$/, '') || 'Imported';
            const snapshot = this.buildEmptySheetSnapshot('sheet-import-1', this.uniqueSheetName(parsed.SheetNames[0] || 'Sheet1'), baseName);
            snapshot.sheetOrder = [];
            snapshot.sheets = {};

            parsed.SheetNames.forEach((sheetName, index) => {
                const aoa = XLSX.utils.sheet_to_json(parsed.Sheets[sheetName], {
                    header: 1,
                    raw: true,
                    defval: null,
                });

                const sheetId = `import-${index}-${Date.now().toString(36)}`;
                const cellData = {};
                aoa.forEach((row, r) => {
                    if (!row) return;
                    const rowMap = {};
                    row.forEach((val, c) => {
                        if (val === null || val === undefined || val === '') return;
                        rowMap[c] = { v: val };
                    });
                    if (Object.keys(rowMap).length > 0) cellData[r] = rowMap;
                });

                snapshot.sheetOrder.push(sheetId);
                snapshot.sheets[sheetId] = {
                    ...snapshot.sheets[sheetId],
                    id: sheetId,
                    name: this.uniqueSheetName(sheetName),
                    cellData,
                };
            });

            const totalRows = Object.keys(snapshot.sheets).length;
            if (totalRows === 0) {
                console.error('[SPREADSHEET] Import produced no sheets');
                return false;
            }

            const result = await this.loadData(snapshot, baseName);
            return result.ok;
        } catch (error) {
            console.error('[SPREADSHEET] Import failed:', error);
            return false;
        }
    }

    /**
     * Export to Excel (.xlsx) - every workbook sheet becomes a file sheet
     * @param {string} filename - Output filename
     * @returns {Promise<boolean>} Success status
     */
    async exportToExcel(filename) {
        if (!window.XLSX) {
            console.error('[SPREADSHEET] SheetJS not available for export');
            return false;
        }
        if (!this.ready()) return false;

        try {
            const snapshot = this.getData();
            const book = XLSX.utils.book_new();

            snapshot.sheetOrder.forEach(sheetId => {
                const sheetSnap = snapshot.sheets[sheetId];
                if (!sheetSnap) return;

                const aoa = [];

                const cellData = sheetSnap.cellData || {};
                Object.keys(cellData).forEach(rStr => {
                    const r = parseInt(rStr, 10);
                    if (!aoa[r]) aoa[r] = [];
                    Object.keys(cellData[r]).forEach(cStr => {
                        const c = parseInt(cStr, 10);
                        const cell = cellData[r][cStr];
                        if (!cell) return;
                        if (cell.f) {
                            // Preserve formulas in the exported file
                            aoa[r][c] = { f: cell.f };
                        } else if (cell.v !== undefined && cell.v !== null) {
                            aoa[r][c] = cell.v;
                        }
                    });
                });

                const denseAoa = [];
                for (let i = 0; i < aoa.length; i++) denseAoa.push(aoa[i] || []);
                if (denseAoa.length === 0) denseAoa.push([]);

                const sheet = XLSX.utils.aoa_to_sheet(denseAoa);
                XLSX.utils.book_append_sheet(book, sheet, sheetSnap.name || `Sheet${snapshot.sheetOrder.indexOf(sheetId) + 1}`);
            });

            const outputFilename = (filename || `spreadsheet_${new Date().toISOString().slice(0, 10)}.xlsx`);
            XLSX.writeFile(book, outputFilename.endsWith('.xlsx') ? outputFilename : `${outputFilename}.xlsx`);
            return true;
        } catch (error) {
            console.error('[SPREADSHEET] Export to Excel failed:', error);
            return false;
        }
    }

    /**
     * Export the active sheet to CSV
     * @param {string} filename - Output filename
     * @returns {Promise<boolean>} Success status
     */
    async exportToCSV(filename) {
        if (!window.XLSX) {
            console.error('[SPREADSHEET] SheetJS not available for export');
            return false;
        }
        if (!this.ready()) return false;

        try {
            const snapshot = this.getData();
            const ws = this.getCurrentSheetData();
            const sheetId = ws.getSheetId();
            const sheetSnap = snapshot.sheets[sheetId];
            if (!sheetSnap) return false;

            // Convert cellData to an array-of-arrays for SheetJS
            const aoa = [];
            const cellData = sheetSnap.cellData || {};
            Object.keys(cellData).forEach(rStr => {
                const r = parseInt(rStr, 10);
                if (!aoa[r]) aoa[r] = [];
                Object.keys(cellData[r]).forEach(cStr => {
                    const c = parseInt(cStr, 10);
                    const cell = cellData[r][cStr];
                    if (!cell) return;
                    aoa[r][c] = cell.f ? `=${cell.f}` : (cell.v ?? '');
                });
            });

            const denseAoa = [];
            for (let i = 0; i < aoa.length; i++) denseAoa.push(aoa[i] || []);
            if (denseAoa.length === 0) denseAoa.push([]);

            const sheet = XLSX.utils.aoa_to_sheet(denseAoa);
            const csvContent = XLSX.utils.sheet_to_csv(sheet);

            const outputFilename = (filename || `sheet_${new Date().toISOString().slice(0, 10)}.csv`);
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

            const link = document.createElement('a');
            const downloadUrl = URL.createObjectURL(blob);
            link.href = downloadUrl;
            link.download = outputFilename.endsWith('.csv') ? outputFilename : `${outputFilename}.csv`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(downloadUrl);

            return true;
        } catch (error) {
            console.error('[SPREADSHEET] Export to CSV failed:', error);
            return false;
        }
    }

    // ================================================
    // Undo/Redo Operations
    // ================================================

    /**
     * Undo last action
     */
    undo() {
        if (!this.univerAPI) return;
        this.univerAPI.undo();
    }

    /**
     * Redo last undone action
     */
    redo() {
        if (!this.univerAPI) return;
        this.univerAPI.redo();
    }

    // ================================================
    // Freeze Operations
    // ================================================

    /**
     * Freeze the first N rows
     * @param {number} count - Number of rows to freeze
     */
    freezeRows(count) {
        if (!this.ready() || count <= 0) {
            console.error('[SPREADSHEET] Invalid freeze row count');
            return;
        }
        this.getCurrentSheetData().setFrozenRows(count);
    }

    /**
     * Freeze the first N columns
     * @param {number} count - Number of columns to freeze
     */
    freezeColumns(count) {
        if (!this.ready() || count <= 0) {
            console.error('[SPREADSHEET] Invalid freeze column count');
            return;
        }
        this.getCurrentSheetData().setFrozenColumns(count);
    }

    /**
     * Freeze rows and columns together
     * @param {object} options - {rows: number, cols: number}
     */
    freeze(options) {
        if (!this.ready()) return;
        const ws = this.getCurrentSheetData();
        if (options.rows > 0) ws.setFrozenRows(options.rows);
        if (options.cols > 0) ws.setFrozenColumns(options.cols);
    }

    /**
     * Remove all freezing
     */
    unfreeze() {
        if (!this.ready()) return;
        this.getCurrentSheetData().cancelFreeze();
    }

    // ================================================
    // Utility Methods
    // ================================================

    /**
     * True when Univer and a workbook are ready
     * @returns {boolean}
     */
    ready() {
        return this.isInitialized && !!this.fWorkbook && !!this.univerAPI;
    }

    /**
     * Resolve an A1-notation string to an FRange on the active sheet
     * @param {string} ref - 'A1' or 'A1:B2'
     * @returns {object|null} FRange
     */
    resolveRangeRef(ref) {
        try {
            return this.getCurrentSheetData().getRange(ref);
        } catch (error) {
            console.error('[SPREADSHEET] Invalid range reference:', ref, error);
            return null;
        }
    }

    /**
     * Validate data structure
     * @param {object} data - Snapshot or legacy payload
     * @returns {boolean}
     */
    validateData(data) {
        if (Array.isArray(data)) return false;             // legacy
        return !!(data && typeof data === 'object' && data.sheets);
    }

    /**
     * Find a unique sheet name avoiding collisions
     * @param {string} preferred - Desired name
     * @returns {string} Unique name
     */
    uniqueSheetName(preferred) {
        if (!this.univerAPI || !this.fWorkbook) return preferred || 'Sheet1';

        const taken = new Set(this.fWorkbook.getSheets().map(s => s.getSheetName()));
        if (!taken.has(preferred)) return preferred;

        let counter = 1;
        let candidate = `${preferred}${counter}`;
        while (taken.has(candidate)) {
            counter++;
            candidate = `${preferred}${counter}`;
        }
        return candidate;
    }

    /**
     * Generate unique sheet name ("Sheet2", "Sheet3", ...)
     * @param {string} baseName - Base name for sheet
     * @returns {string} Unique sheet name
     */
    generateSheetName(baseName = 'Sheet') {
        if (!this.fWorkbook) return `${baseName}1`;

        const existingNames = this.fWorkbook.getSheets().map(sheet => sheet.getSheetName());
        let counter = 1;
        let newName = baseName + counter;
        while (existingNames.includes(newName)) {
            counter++;
            newName = baseName + counter;
        }
        return newName;
    }

    /**
     * Convert cell reference to index
     * Parse "A1" to {row: 0, column: 0}
     * @param {string} cell - Cell reference
     * @returns {object} Row and column indices
     */
    cellToIndex(cell) {
        const match = cell.match(/^([A-Z]+)(\d+)$/);
        if (!match) {
            console.error('[SPREADSHEET] Invalid cell reference:', cell);
            return null;
        }
        const column = match[1];
        let colIndex = 0;
        for (let i = 0; i < column.length; i++) {
            colIndex = colIndex * 26 + (column.charCodeAt(i) - 64);
        }
        colIndex--; // zero-based
        return { row: parseInt(match[2], 10) - 1, column: colIndex };
    }

    /**
     * Convert index to cell reference
     * Convert {row: 0, col: 0} to "A1"
     * @param {object} index - Row and column indices
     * @returns {string} Cell reference
     */
    indexToCell(index) {
        const rowIndex = index.row + 1;
        let col = index.column + 1;
        let column = '';
        while (col > 0) {
            col--;
            const remainder = col % 26;
            column = String.fromCharCode(65 + remainder) + column;
            col = Math.floor(col / 26);
        }
        return column + rowIndex;
    }

    /**
     * Show loading state
     */
    showLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.classList.remove('hidden');
            loadingOverlay.style.display = 'flex';
            loadingOverlay.style.opacity = '1';
            loadingOverlay.style.pointerEvents = 'auto';
        }
    }

    /**
     * Hide loading state
     */
    hideLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
            loadingOverlay.classList.add('hidden');
            loadingOverlay.style.opacity = '0';
            loadingOverlay.style.pointerEvents = 'none';
        }
    }

    /**
     * Destroy spreadsheet
     * Tear down Univer instance and references
     */
    destroy() {
        this.disposeCurrentWorkbook();
        this.isInitialized = false;
        this.container = null;
        this.data = null;
    }

    /**
     * Get current spreadsheet record from storage
     * @returns {Promise<object|null>}
     */
    async getCurrentSpreadsheetData() {
        try {
            if (!this.currentSheetId) return null;

            const userData = await sheetsStorage.loadUserData();
            if (!userData || !userData.sheets) return null;

            return userData.sheets.find(s => s.id === this.currentSheetId) || null;
        } catch (error) {
            console.error('[SPREADSHEET] Error getting spreadsheet data:', error);
            return null;
        }
    }

    /**
     * Save spreadsheet metadata
     * @param {object} metadata - Spreadsheet metadata with updated name/date
     * @returns {Promise<boolean>} Success status
     */
    async saveSpreadsheetMetadata(metadata) {
        try {
            if (!metadata.id) return false;

            const userData = await sheetsStorage.loadUserData();
            if (!userData || !userData.sheets) return false;

            const index = userData.sheets.findIndex(s => s.id === metadata.id);
            if (index === -1) return false;

            // Preserve the existing spreadsheet body, refresh metadata
            const updatedSpreadsheet = {
                ...userData.sheets[index],
                name: metadata.name,
                updatedAt: metadata.updatedAt
            };

            const success = await sheetsStorage.saveSpreadsheet(metadata.id, updatedSpreadsheet);

            if (success) {
                this.currentSpreadsheetMetadata = updatedSpreadsheet;
            }

            return success;
        } catch (error) {
            console.error('[SPREADSHEET] Error saving metadata:', error);
            return false;
        }
    }

    /**
     * Update shared copy asynchronously (non-blocking)
     * @param {object} spreadsheetData - Complete spreadsheet data to push
     */
    async updateSharedCopy(spreadsheetData) {
        if (!spreadsheetData.sharedId) {
            console.warn('[SPREADSHEET] No sharedId found, skipping shared copy update');
            return;
        }

        try {
            const shareData = {
                spreadsheet: spreadsheetData,
                sharedAt: new Date().toISOString()
            };

            const response = await fetch(`https://textdb.dev/api/data/shared_${spreadsheetData.sharedId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(shareData)
            });

            if (!response.ok) {
                console.error('[SPREADSHEET] Failed to update shared copy, status:', response.status);
            }
        } catch (e) {
            console.error('[SPREADSHEET] Error updating shared copy:', e);
            throw e;
        }
    }
}

// ================================================
// Export
// ================================================

// Initialize global spreadsheet manager instance
const spreadsheetManager = new SpreadsheetManager();

// Explicitly expose on window: top-level const declarations don't
// become window properties, and themes.js relies on detecting it there
if (typeof window !== 'undefined') {
    window.spreadsheetManager = spreadsheetManager;
}
