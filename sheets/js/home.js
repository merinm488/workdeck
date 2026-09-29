/**
 * ================================================
 * SHEETS - Home Page Module
 * ================================================
 * Home page functionality:
 * - Display all spreadsheets
 * - Search functionality
 * - Create new spreadsheet
 * - Delete spreadsheet
 * - Settings menu (theme, view key, logout)
 * - Responsive design
 */

class SheetsHome {
    constructor() {
        this.sheets = [];
        this.filteredSheets = [];
        this.searchQuery = '';
        this.spreadsheetToDelete = null;
        this.isInitialized = false;
        this.isLoading = false;
    }

    // ================================================
    // Initialization
    // ================================================

    /**
     * Initialize home page
     */
    async init() {
        try {
            // Initialize theme manager
            if (typeof themeManager !== 'undefined') {
                themeManager.init();
            }

            // Set up event listeners (only once)
            if (!this.isInitialized) {
                this.setupEventListeners();
                this.setupSettingsMenu();
            }

            // Add resize listener to update theme text on window resize
            window.addEventListener('resize', () => {
                this.updateThemeIndicator();
            });

            // Update theme indicator
            this.updateThemeIndicator();

            // Always load spreadsheets (even if already initialized) to get fresh data
            await this.loadSpreadsheets();

            this.isInitialized = true;
        } catch (error) {
            console.error('[HOME] Initialization error:', error);
            this.showError('Failed to load home page');
        }
    }

    // ================================================
    // Data Loading
    // ================================================

    /**
     * Load spreadsheets from storage
     */
    async loadSpreadsheets() {
        try {
            if (typeof sheetsStorage !== 'undefined') {
                const userData = await sheetsStorage.loadUserData();

                if (userData && userData.sheets) {
                    this.sheets = userData.sheets.sort((a, b) => {
                        // Sort by updated date, most recent first
                        return new Date(b.updatedAt) - new Date(a.updatedAt);
                    });
                } else {
                    this.sheets = [];
                }

                this.filteredSheets = [...this.sheets];
                this.renderSpreadsheets();
            }
        } catch (error) {
            console.error('[HOME] Failed to load spreadsheets:', error);
            this.sheets = [];
            this.filteredSheets = [];
            this.renderSpreadsheets();
        }
    }

    // ================================================
    // Rendering
    // ================================================

    /**
     * Render spreadsheets grid
     */
    renderSpreadsheets() {
        const container = document.getElementById('spreadsheetsContainer');
        const emptyState = document.getElementById('emptyState');
        const viewTitle = document.getElementById('viewTitle');

        if (!container) return;

        // Clear container
        container.innerHTML = '';

        // Update view title
        if (viewTitle) {
            if (this.searchQuery) {
                viewTitle.textContent = `Search Results (${this.filteredSheets.length})`;
            } else {
                viewTitle.textContent = 'All Sheets';
            }
        }

        // Show empty state if no spreadsheets
        if (this.filteredSheets.length === 0) {
            container.classList.add('hidden');
            emptyState.classList.remove('hidden');
            emptyState.classList.add('flex');

            if (this.searchQuery) {
                emptyState.querySelector('h3').textContent = 'No spreadsheets found';
                emptyState.querySelector('p').textContent = 'Try a different search term';
                emptyState.querySelector('#createFirstSheetBtn').classList.add('hidden');
            } else {
                emptyState.querySelector('h3').textContent = 'No spreadsheets yet';
                emptyState.querySelector('p').textContent = 'Welcome! Create your first spreadsheet to get started';
                emptyState.querySelector('#createFirstSheetBtn').classList.remove('hidden');
            }
            return;
        }

        // Hide empty state
        container.classList.remove('hidden');
        emptyState.classList.add('hidden');
        emptyState.classList.remove('flex');

        // Render spreadsheet cards
        this.filteredSheets.forEach(spreadsheet => {
            const card = this.createSpreadsheetCard(spreadsheet);
            container.appendChild(card);
        });
    }

    /**
     * Create spreadsheet card element
     */
    createSpreadsheetCard(spreadsheet) {
        const card = document.createElement('div');
        card.className = 'spreadsheet-card';
        card.dataset.id = spreadsheet.id;

        const updatedAt = new Date(spreadsheet.updatedAt);

        card.innerHTML = `
            <div class="spreadsheet-card-header">
                <div class="spreadsheet-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7-6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2z" />
                    </svg>
                </div>
                <div class="spreadsheet-title">${this.escapeHtml(spreadsheet.name || 'Untitled')}</div>
                <div class="spreadsheet-card-actions">
                    <button class="spreadsheet-action-btn rename" title="Rename">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                    </button>
                    <button class="spreadsheet-action-btn delete" title="Delete">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>
            <div class="spreadsheet-card-info">
                <div class="spreadsheet-meta">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>${this.formatDate(updatedAt)}</span>
                </div>
            </div>
        `;

        // Add click event to open spreadsheet
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.spreadsheet-action-btn')) {
                this.openSpreadsheet(spreadsheet.id);
            }
        });

        // Add rename button event
        const renameBtn = card.querySelector('.spreadsheet-action-btn.rename');
        if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.renameSpreadsheet(spreadsheet);
            });
        }

        // Add delete button event
        const deleteBtn = card.querySelector('.spreadsheet-action-btn.delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showDeleteModal(spreadsheet);
            });
        }

        return card;
    }

    // ================================================
    // Event Handlers
    // ================================================

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Search input
        const searchInput = document.getElementById('searchInput');
        const clearSearch = document.getElementById('clearSearch');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });

            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    this.handleSearch('');
                    searchInput.blur();
                }
            });
        }

        if (clearSearch) {
            clearSearch.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    this.handleSearch('');
                }
            });
        }

        // Create sheet buttons
        const createSheetBtn = document.getElementById('createSheetBtn');
        const createFirstSheetBtn = document.getElementById('createFirstSheetBtn');

        if (createSheetBtn) {
            createSheetBtn.addEventListener('click', () => this.createNewSpreadsheet());
        }

        if (createFirstSheetBtn) {
            createFirstSheetBtn.addEventListener('click', () => this.createNewSpreadsheet());
        }

        // Delete modal events
        const deleteModalClose = document.getElementById('deleteModalClose');
        const cancelDelete = document.getElementById('cancelDelete');
        const confirmDelete = document.getElementById('confirmDelete');

        if (deleteModalClose) {
            deleteModalClose.addEventListener('click', () => this.hideDeleteModal());
        }

        if (cancelDelete) {
            cancelDelete.addEventListener('click', () => this.hideDeleteModal());
        }

        if (confirmDelete) {
            confirmDelete.addEventListener('click', () => this.confirmDeleteSpreadsheet());
        }

        // Rename modal events
        const renameModalClose = document.getElementById('renameModalClose');
        const cancelRename = document.getElementById('cancelRename');
        const confirmRename = document.getElementById('confirmRename');
        const renameInput = document.getElementById('renameInput');

        if (renameModalClose) {
            renameModalClose.addEventListener('click', () => this.hideRenameModal());
        }

        if (cancelRename) {
            cancelRename.addEventListener('click', () => this.hideRenameModal());
        }

        if (confirmRename) {
            confirmRename.addEventListener('click', () => this.confirmRenameSpreadsheet());
        }

        // Handle Enter key in rename input
        if (renameInput) {
            renameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.confirmRenameSpreadsheet();
                } else if (e.key === 'Escape') {
                    this.hideRenameModal();
                }
            });
        }

        // Close modal on outside click
        const deleteModal = document.getElementById('deleteModal');
        if (deleteModal) {
            deleteModal.addEventListener('click', (e) => {
                if (e.target === deleteModal) {
                    this.hideDeleteModal();
                }
            });
        }

        // Close rename modal on outside click
        const renameModal = document.getElementById('renameModal');
        if (renameModal) {
            renameModal.addEventListener('click', (e) => {
                if (e.target === renameModal) {
                    this.hideRenameModal();
                }
            });
        }

        // Reload spreadsheets when page becomes visible again
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && document.visibilityState === 'visible') {
                this.loadSpreadsheets();
            }
        });
    }

    /**
     * Set up settings menu
     */
    setupSettingsMenu() {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsDropdown = document.getElementById('settingsDropdown');
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        const themeSubmenu = document.getElementById('themeSubmenu');
        const viewKeyBtn = document.getElementById('viewKeyBtn');
        const logoutBtn = document.getElementById('logoutBtn');

        // Toggle settings dropdown
        if (settingsBtn && settingsDropdown) {
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsDropdown.classList.toggle('active');
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            // Only close settings dropdown if not clicking within it
            if (settingsDropdown && !e.target.closest('.top-nav-settings')) {
                settingsDropdown.classList.remove('active');
                // Also close theme submenu when closing settings
                if (themeSubmenu) {
                    themeSubmenu.classList.remove('active');
                }
                const themeContainer = themeToggleBtn && themeToggleBtn.closest('.theme-dropdown-container');
                if (themeContainer) {
                    themeContainer.classList.remove('active');
                }
            }
            // Close theme submenu if clicking outside it but still in settings
            if (themeSubmenu && !e.target.closest('.theme-dropdown-container')) {
                themeSubmenu.classList.remove('active');
                const themeContainer = themeToggleBtn && themeToggleBtn.closest('.theme-dropdown-container');
                if (themeContainer) {
                    themeContainer.classList.remove('active');
                }
            }
        });

        // Theme toggle - show submenu
        if (themeToggleBtn && themeSubmenu) {
            themeToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Toggle the submenu
                const isActive = themeSubmenu.classList.contains('active');
                if (isActive) {
                    themeSubmenu.classList.remove('active');
                    themeToggleBtn.closest('.theme-dropdown-container').classList.remove('active');
                } else {
                    themeSubmenu.classList.add('active');
                    themeToggleBtn.closest('.theme-dropdown-container').classList.add('active');
                }
            });
        }

        // Theme option selection
        const themeOptions = document.querySelectorAll('.theme-option');
        themeOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const theme = option.getAttribute('data-theme');
                this.setThemeFromOption(theme);
                if (themeSubmenu) {
                    themeSubmenu.classList.remove('active');
                }
                const themeContainer = themeToggleBtn && themeToggleBtn.closest('.theme-dropdown-container');
                if (themeContainer) {
                    themeContainer.classList.remove('active');
                }
            });
        });

        // View key button
        if (viewKeyBtn) {
            viewKeyBtn.addEventListener('click', () => {
                this.showKeyInfo();
            });
        }

        // Key modal close button
        const keyModalClose = document.getElementById('keyModalClose');
        if (keyModalClose) {
            keyModalClose.addEventListener('click', () => {
                this.hideKeyModal();
            });
        }

        // Close modal on outside click
        const keyModal = document.getElementById('keyModal');
        if (keyModal) {
            keyModal.addEventListener('click', (e) => {
                if (e.target === keyModal) {
                    this.hideKeyModal();
                }
            });
        }

        // Logout button
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
            });
        }

        // Delete account button
        const deleteAccountBtn = document.getElementById('deleteAccountBtn');
        if (deleteAccountBtn) {
            deleteAccountBtn.addEventListener('click', () => {
                this.showDeleteAccountModal();
            });
        }

        // Delete account modal events
        const deleteAccountModalClose = document.getElementById('deleteAccountModalClose');
        const cancelDeleteAccount = document.getElementById('cancelDeleteAccount');
        const confirmDeleteAccount = document.getElementById('confirmDeleteAccount');

        if (deleteAccountModalClose) {
            deleteAccountModalClose.addEventListener('click', () => this.hideDeleteAccountModal());
        }

        if (cancelDeleteAccount) {
            cancelDeleteAccount.addEventListener('click', () => this.hideDeleteAccountModal());
        }

        if (confirmDeleteAccount) {
            confirmDeleteAccount.addEventListener('click', () => this.confirmDeleteAccount());
        }

        // Close delete account modal on outside click
        const deleteAccountModal = document.getElementById('deleteAccountModal');
        if (deleteAccountModal) {
            deleteAccountModal.addEventListener('click', (e) => {
                if (e.target === deleteAccountModal) {
                    this.hideDeleteAccountModal();
                }
            });
        }

        // Update theme indicator
        this.updateThemeIndicator();
    }

    /**
     * Set theme from theme option
     * Handle theme selection from dropdown
     * @param {string} theme - Theme name ('light', 'dark', or 'system')
     */
    setThemeFromOption(theme) {
        if (theme === 'system') {
            // Set system preference
            const systemTheme = this.getSystemTheme();
            if (typeof themeManager !== 'undefined') {
                themeManager.setTheme(systemTheme);
            }
            // Store preference as 'system'
            localStorage.setItem(themeManager.storageKey, 'system');
        } else {
            // Set specific theme
            if (typeof themeManager !== 'undefined') {
                themeManager.setTheme(theme);
            }
        }
        this.updateThemeIndicator();
    }

    /**
     * Get system theme preference
     * @returns {string} 'light' or 'dark'
     */
    getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    /**
     * Handle search input
     */
    handleSearch(query) {
        this.searchQuery = query.toLowerCase().trim();

        // Show/hide clear button
        const clearSearch = document.getElementById('clearSearch');
        if (clearSearch) {
            clearSearch.classList.toggle('hidden', !this.searchQuery);
        }

        // Filter spreadsheets
        if (this.searchQuery) {
            this.filteredSheets = this.sheets.filter(sheet => {
                const name = (sheet.name || 'Untitled').toLowerCase();
                return name.includes(this.searchQuery);
            });
        } else {
            this.filteredSheets = [...this.sheets];
        }

        this.renderSpreadsheets();
    }

    // ================================================
    // Spreadsheet Operations
    // ================================================

    /**
     * Open spreadsheet in editor
     */
    openSpreadsheet(id) {
        // Navigate to spreadsheet (the destination page will show its own loading)
        window.location.href = `/sheets/editor.html?id=${id}`;
    }

    /**
     * Create new spreadsheet
     */
    async createNewSpreadsheet() {
        try {
            // Generate unique ID
            const id = `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`;

            // Create default spreadsheet data - Univer workbook snapshot
            const sheetId = `sheet-${Date.now().toString(36)}`;
            const newSpreadsheet = {
                id: id,
                name: 'Untitled Spreadsheet',
                formatVersion: 2,
                data: {
                    id: `wb_${id}`,
                    name: 'Untitled Spreadsheet',
                    appVersion: '0.25.1',
                    locale: 'enUS',
                    styles: {},
                    sheetOrder: [sheetId],
                    sheets: {
                        [sheetId]: {
                            id: sheetId,
                            name: 'Sheet1',
                            tabColor: '',
                            hidden: 0,
                            freeze: { xOffset: 0, yOffset: 0, startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
                            rowCount: 84,
                            columnCount: 60,
                            zoomRatio: 1,
                            scrollTop: 0,
                            scrollLeft: 0,
                            defaultColumnWidth: 73,
                            defaultRowHeight: 19,
                            mergeData: [],
                            cellData: {},
                            rowData: {},
                            columnData: {}
                        }
                    }
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Save to storage
            const success = await sheetsStorage.saveSpreadsheet(id, newSpreadsheet);

            if (success) {
                // Navigate to the new spreadsheet
                this.openSpreadsheet(id);
            } else {
                this.showError('Failed to create spreadsheet');
            }
        } catch (error) {
            console.error('[HOME] Failed to create spreadsheet:', error);
            this.showError('Failed to create spreadsheet');
        }
    }

    /**
     * Show rename modal
     */
    showRenameModal(spreadsheet) {
        const renameModal = document.getElementById('renameModal');
        const renameInput = document.getElementById('renameInput');
        const deleteSheetName = document.getElementById('deleteSheetName');

        if (renameInput) {
            renameInput.value = spreadsheet.name || 'Untitled Spreadsheet';
        }

        if (renameModal) {
            renameModal.classList.add('active');
        }

        // Store the spreadsheet being renamed
        this.spreadsheetToRename = spreadsheet;

        // Focus input and select text
        if (renameInput) {
            setTimeout(() => {
                renameInput.focus();
                renameInput.select();
            }, 100);
        }
    }

    /**
     * Hide rename modal
     */
    hideRenameModal() {
        const renameModal = document.getElementById('renameModal');
        if (renameModal) {
            renameModal.classList.remove('active');
        }
        this.spreadsheetToRename = null;
    }

    /**
     * Confirm rename spreadsheet
     */
    async confirmRenameSpreadsheet() {
        if (!this.spreadsheetToRename) return;

        const renameInput = document.getElementById('renameInput');
        const newName = renameInput ? renameInput.value.trim() : '';

        if (!newName) {
            this.showError('Name cannot be empty');
            return;
        }

        // Store the ID before hiding the modal
        const spreadsheetId = this.spreadsheetToRename.id;
        const originalSpreadsheet = { ...this.spreadsheetToRename };

        try {
            // Update local state immediately (optimistic update)
            const updatedSpreadsheet = {
                ...this.spreadsheetToRename,
                name: newName,
                updatedAt: new Date().toISOString()
            };

            // Update local state
            const index = this.sheets.findIndex(s => s.id === spreadsheetId);
            if (index !== -1) {
                this.sheets[index] = updatedSpreadsheet;
            }
            this.filteredSheets = [...this.sheets];
            this.renderSpreadsheets();

            // Hide modal and clear the reference
            this.hideRenameModal();

            // Save to storage in background
            const success = await sheetsStorage.saveSpreadsheet(spreadsheetId, updatedSpreadsheet);

            if (!success) {
                // Rollback on failure
                const rollbackIndex = this.sheets.findIndex(s => s.id === spreadsheetId);
                if (rollbackIndex !== -1) {
                    this.sheets[rollbackIndex] = originalSpreadsheet;
                }
                this.filteredSheets = [...this.sheets];
                this.renderSpreadsheets();
                this.showError('Failed to rename spreadsheet');
            } else {
                this.showSuccess('Spreadsheet renamed successfully');
            }
        } catch (error) {
            console.error('[HOME] Failed to rename spreadsheet:', error);
            this.showError('Failed to rename spreadsheet');
        }
    }

    /**
     * Rename spreadsheet
     */
    async renameSpreadsheet(spreadsheet) {
        this.showRenameModal(spreadsheet);
    }

    /**
     * Show delete confirmation modal
     */
    showDeleteModal(spreadsheet) {
        this.spreadsheetToDelete = spreadsheet;

        const deleteModal = document.getElementById('deleteModal');
        const deleteSheetName = document.getElementById('deleteSheetName');

        if (deleteSheetName) {
            deleteSheetName.textContent = spreadsheet.name || 'Untitled';
        }

        if (deleteModal) {
            deleteModal.classList.add('active');
        }
    }

    /**
     * Hide delete confirmation modal
     */
    hideDeleteModal() {
        this.spreadsheetToDelete = null;

        const deleteModal = document.getElementById('deleteModal');
        if (deleteModal) {
            deleteModal.classList.remove('active');
        }
    }

    /**
     * Confirm and delete spreadsheet
     */
    async confirmDeleteSpreadsheet() {
        if (!this.spreadsheetToDelete) return;

        const spreadsheetId = this.spreadsheetToDelete.id;

        try {
            // Optimistic update - remove from local state immediately
            this.sheets = this.sheets.filter(s => s.id !== spreadsheetId);
            this.filteredSheets = this.sheets.filter(s => s.id !== spreadsheetId);
            this.renderSpreadsheets();
            this.hideDeleteModal();

            // Delete from storage in background
            const success = await sheetsStorage.deleteSpreadsheet(spreadsheetId);

            if (success) {
                this.showSuccess('Spreadsheet deleted successfully');
            } else {
                // Rollback - restore the spreadsheet on failure
                this.sheets.push(this.spreadsheetToDelete);
                this.filteredSheets = [...this.sheets];
                this.renderSpreadsheets();
                this.showError('Failed to delete spreadsheet');
            }
        } catch (error) {
            console.error('[HOME] Failed to delete spreadsheet:', error);
            // Rollback on error
            this.sheets.push(this.spreadsheetToDelete);
            this.filteredSheets = [...this.sheets];
            this.renderSpreadsheets();
            this.showError('Failed to delete spreadsheet');
        }
    }

    // ================================================
    // Theme Operations
    // ================================================

    /**
     * Toggle theme
     */
    toggleTheme() {
        if (typeof themeManager !== 'undefined') {
            themeManager.toggleTheme();
            this.updateThemeIndicator();
        }
    }

    /**
     * Update theme indicator in settings menu
     * Show current theme status
     */
    updateThemeIndicator() {
        const themeText = document.getElementById('themeText');
        if (themeText && typeof themeManager !== 'undefined') {
            const currentTheme = themeManager.getCurrentTheme();
            const savedPreference = localStorage.getItem(themeManager.storageKey);

            // Display name for theme
            let themeDisplayName;
            if (savedPreference === 'system') {
                themeDisplayName = 'System';
            } else {
                // Capitalize the theme name
                themeDisplayName = currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1);
            }

            themeText.textContent = `Theme: ${themeDisplayName}`;

            // Update active state on theme options
            const themeOptions = document.querySelectorAll('.theme-option');
            themeOptions.forEach(option => {
                option.classList.remove('active');
                const optionTheme = option.getAttribute('data-theme');
                if ((savedPreference === 'system' && optionTheme === 'system') ||
                    (savedPreference !== 'system' && optionTheme === currentTheme)) {
                    option.classList.add('active');
                }
            });
        }
    }

    // ================================================
    // Key Info Modal
    // ================================================

    /**
     * Show key information modal
     */
    showKeyInfo() {
        const userKey = authManager ? authManager.getUserKey() : null;
        const keyModal = document.getElementById('keyModal');
        const keyText = document.getElementById('keyText');
        const keyCopyBtn = document.getElementById('keyCopyBtn');
        const keyCopyFeedback = document.getElementById('keyCopyFeedback');
        const keyModalCloseBtn = document.getElementById('keyModalCloseBtn');
        const settingsDropdown = document.getElementById('settingsDropdown');

        if (keyModal) {
            // Show the actual key
            if (keyText && userKey) {
                keyText.textContent = userKey;
            } else {
                keyText.textContent = 'Not available';
            }

            // Set up copy button
            if (keyCopyBtn && userKey) {
                keyCopyBtn.onclick = async () => {
                    try {
                        await navigator.clipboard.writeText(userKey);
                        if (keyCopyFeedback) {
                            keyCopyFeedback.classList.add('visible');
                            setTimeout(() => {
                                keyCopyFeedback.classList.remove('visible');
                            }, 2000);
                        }
                    } catch (err) {
                        console.error('Failed to copy key:', err);
                    }
                };
            }

            // Set up close button
            if (keyModalCloseBtn) {
                keyModalCloseBtn.onclick = () => this.hideKeyModal();
            }

            keyModal.classList.add('active');

            // Close settings dropdown
            if (settingsDropdown) {
                settingsDropdown.classList.remove('active');
            }
        }
    }

    /**
     * Update key modal with current data
     * (No longer needed with simplified modal)
     */
    updateKeyModal() {
        // Simplified modal doesn't need updates
    }

    /**
     * Hide key modal
     */
    hideKeyModal() {
        const keyModal = document.getElementById('keyModal');
        if (keyModal) keyModal.classList.remove('active');
    }

    // ================================================
    // Authentication
    // ================================================

    /**
     * Logout current user
     */
    async logout() {
        try {
            if (authManager) {
                await authManager.logout();
            } else {
                // Fallback
                sessionStorage.removeItem('sheets_user_hash');
                sessionStorage.removeItem('sheets_user_key');
                window.location.href = '/sheets/';
            }
        } catch (error) {
            console.error('[HOME] Logout error:', error);
            // Force redirect
            window.location.href = '/sheets/';
        }
    }

    /**
     * Show delete account confirmation modal
     */
    showDeleteAccountModal() {
        const deleteAccountModal = document.getElementById('deleteAccountModal');
        const settingsDropdown = document.getElementById('settingsDropdown');

        if (deleteAccountModal) {
            deleteAccountModal.classList.add('active');
        }

        // Close settings dropdown
        if (settingsDropdown) {
            settingsDropdown.classList.remove('active');
        }
    }

    /**
     * Hide delete account confirmation modal
     */
    hideDeleteAccountModal() {
        const deleteAccountModal = document.getElementById('deleteAccountModal');
        if (deleteAccountModal) {
            deleteAccountModal.classList.remove('active');
        }
    }

    /**
     * Confirm and delete account
     */
    async confirmDeleteAccount() {
        try {
            if (authManager) {
                const result = await authManager.deleteAccount();

                if (result.success) {
                    // The authManager handles the redirect
                } else {
                    this.showError(result.error || 'Failed to delete account');
                    this.hideDeleteAccountModal();
                }
            } else {
                this.showError('Authentication manager not available');
                this.hideDeleteAccountModal();
            }
        } catch (error) {
            console.error('[HOME] Delete account error:', error);
            this.showError('Failed to delete account');
            this.hideDeleteAccountModal();
        }
    }

    // ================================================
    // Notifications
    // ================================================

    /**
     * Show success notification
     */
    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    /**
     * Show error notification
     */
    showError(message) {
        this.showNotification(message, 'error');
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        if (!notification) return;

        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.remove('hidden');

        setTimeout(() => {
            notification.classList.add('hidden');
        }, 3000);
    }

    // ================================================
    // Loading State
    // ================================================

    /**
     * Show loading overlay
     */
    showLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.classList.remove('hidden');
            loadingOverlay.style.display = 'flex';
        }
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
            setTimeout(() => {
                if (loadingOverlay.classList.contains('hidden')) {
                    loadingOverlay.style.display = 'none';
                }
            }, 500);
        }
    }

    // ================================================
    // Utility Methods
    // ================================================

    /**
     * Format date for display with relative time
     * Shows: Just now, Xm ago, Xh ago, Yesterday, or date
     */
    formatDate(date) {
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        // Less than 1 minute
        if (seconds < 60) {
            return 'Just now';
        }

        // Less than 1 hour
        if (minutes < 60) {
            return `${minutes}m ago`;
        }

        // Less than 24 hours
        if (hours < 24) {
            return `${hours}h ago`;
        }

        // Yesterday
        if (days === 1) {
            return 'Yesterday';
        }

        // Beyond yesterday - show date
        return date.toLocaleDateString();
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// ================================================
// Initialize Home Page
// ================================================

let sheetsHome;

document.addEventListener('DOMContentLoaded', async () => {
    sheetsHome = new SheetsHome();
    await sheetsHome.init();

    // Expose globally for debugging
    window.sheetsHome = sheetsHome;
});
