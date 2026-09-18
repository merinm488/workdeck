/**
 * ================================================
 * SHEETS - Main Application Module
 * ================================================
 * Application entry point that coordinates all modules:
 * - Theme management
 * - Spreadsheet initialization
 * - Storage operations
 * - Event handling
 * - Auto-save functionality
 */

// ================================================
// Application Class
// ================================================

class SheetsApp {
    constructor() {
        // Initialize application state
        this.isInitialized = false;
        this.spreadsheetId = null;
        this.autoSaveInterval = null;
        this.hasUnsavedChanges = false;
        // Rename reminder: dismissed once per spreadsheet (either button)
        this.renamePromptDismissed = false;
        this.isProduction = APP_CONFIG.isProduction;
    }

    // ================================================
    // Initialization
    // ================================================

    /**
     * Initialize application
     * Set up all components and event listeners
     * @returns {Promise<boolean>} Success status
     */
    async init() {
        try {
    
            // Initialize theme manager
            themeManager.init();

            // Initialize storage (already done via config, but validate connection)
            if (!this.validateStorageConnection()) {
                this.showError('Failed to connect to storage service');
                return false;
            }

            // Get or create spreadsheet ID
            this.spreadsheetId = this.getOrCreateSpreadsheetId();

            // If no spreadsheet ID and user is authenticated, redirect to home
            if (!this.spreadsheetId && window.authManager && window.authManager.isAuthenticated()) {
                window.location.href = '/sheets/home.html';
                return false;
            }

            // Set up event listeners
            this.setupEventListeners();

            // Set up auto-save
            if (APP_CONFIG.autoSave.enabled) {
                this.setupAutoSave();
            }

            // Check if Univer is available
            if (typeof UniverPresets === 'undefined') {
                console.error('[APP] Univer not loaded');
                this.showError('Spreadsheet library failed to load. Please refresh the page.');
                return false;
            }

            // Initialize spreadsheet
            let loadOutcome = false;
            if (this.spreadsheetId) {
                loadOutcome = await this.load(this.spreadsheetId);
            }

            if (loadOutcome) {
                // Successfully loaded existing spreadsheet
                const metadata = spreadsheetManager.getMetadata();
                this.updateSpreadsheetTitle(metadata?.name);
                // Set up Univer change hooks for auto-save
                this.setupLuckysheetHooks();
            } else if (spreadsheetManager && spreadsheetManager.isLegacyBlocked && spreadsheetManager.isLegacyBlocked()) {
                // Legacy Luckysheet file - notice is already shown, nothing else to do
                this.updateSpreadsheetTitle(spreadsheetManager.getMetadata()?.name);
                console.warn('[APP] Legacy spreadsheet opened - editor disabled for this file');
            } else {
                // Create new spreadsheet
                const newId = await this.createNew();
                if (newId) {
                    this.spreadsheetId = newId;
                    this.updateURL(newId);
                    // Set up Luckysheet change hooks for auto-save
                    this.setupLuckysheetHooks();
                } else {
                    this.showError('Failed to create spreadsheet');
                    return false;
                }
            }

            // Clean the address bar: the deep link (?id=...) has been
            // consumed, so show the bare /sheets/ URL.
            this.cleanURL();

            this.isInitialized = true;
            return true;
        } catch (error) {
            console.error('[APP] Application initialization error:', error);
            this.showError('Failed to initialize application');
            return false;
        }
    }

    /**
     * Set up event listeners
     * Configure all application events
     */
    setupEventListeners() {
        // Settings menu toggle
        this.setupSettingsMenu();

        // Editable title
        this.setupEditableTitle();

        // Keyboard shortcuts
        this.setupKeyboardShortcuts();

        // Window resize events
        window.addEventListener('resize', () => this.handleResize());

        // Beforeunload for unsaved changes
        window.addEventListener('beforeunload', (e) => this.handleBeforeUnload(e));
    }

    /**
     * Setup settings menu
     * Configure settings menu functionality
     */
    setupSettingsMenu() {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsDropdown = document.getElementById('settingsDropdown');
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        const themeSubmenu = document.getElementById('themeSubmenu');
        const viewKeyBtn = document.getElementById('viewKeyBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const homeBtn = document.getElementById('homeBtn');
        const saveBtn = document.getElementById('saveBtn');

        // Home button - navigate back to home page
        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                window.location.href = '/sheets/home.html';
            });
        }

        // Save button - manual save
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.save();
            });
        }

        // Rename reminder modal buttons
        this.setupRenamePrompt();

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
            }
            // Close theme submenu if clicking outside it but still in settings
            if (themeSubmenu && !e.target.closest('.theme-dropdown-container')) {
                themeSubmenu.classList.remove('active');
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
                } else {
                    themeSubmenu.classList.add('active');
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

        // Share button
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => {
                this.showShareModal();
            });
        }

        // Share modal events
        const shareModalClose = document.getElementById('shareModalClose');
        const shareModalCloseBtn = document.getElementById('shareModalCloseBtn');
        const copyShareUrlBtn = document.getElementById('copyShareUrlBtn');

        if (shareModalClose) {
            shareModalClose.addEventListener('click', () => this.hideShareModal());
        }

        if (shareModalCloseBtn) {
            shareModalCloseBtn.addEventListener('click', () => this.hideShareModal());
        }

        if (copyShareUrlBtn) {
            copyShareUrlBtn.addEventListener('click', () => this.copyShareUrl());
        }

        // Close share modal on outside click
        const shareModal = document.getElementById('shareModal');
        if (shareModal) {
            shareModal.addEventListener('click', (e) => {
                if (e.target === shareModal) {
                    this.hideShareModal();
                }
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
     * Handle window resize
     */
    handleResize() {
        // Univer handles resize automatically via its own listeners
        this.updateThemeIndicator();
    }

    /**
     * Set up keyboard shortcuts
     * Configure keyboard commands
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Save (Ctrl+S / Cmd+S)
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.save();
            }

            // Undo (Ctrl+Z / Cmd+Z)
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                spreadsheetManager.undo();
            }

            // Redo (Ctrl+Y / Cmd+Y or Cmd+Shift+Z)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                spreadsheetManager.redo();
            }
        });
    }

    /**
     * Setup editable title functionality
     * Allow clicking on title to rename spreadsheet
     */
    setupEditableTitle() {
        const titleElement = document.getElementById('spreadsheetTitle');
        if (!titleElement) return;

        titleElement.addEventListener('click', () => {
            this.makeTitleEditable();
        });
    }

    /**
     * Make title editable
     * Replace title with input field
     */
    makeTitleEditable() {
        const titleElement = document.getElementById('spreadsheetTitle');
        if (!titleElement) return;

        const currentTitle = titleElement.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'spreadsheet-title-input';
        input.value = currentTitle;

        // Replace title with input
        titleElement.parentNode.replaceChild(input, titleElement);
        input.focus();
        input.select();

        // Handle save on blur and enter
        const saveNewTitle = async () => {
            const newTitle = input.value.trim() || 'Untitled';
            if (newTitle !== currentTitle) {
                await this.renameSpreadsheet(newTitle);
            }
            // Restore title display
            this.restoreTitleDisplay(newTitle);
        };

        // Save on Enter key
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                // Cancel on Escape
                this.restoreTitleDisplay(currentTitle);
            }
        });

        // Save on blur
        input.addEventListener('blur', saveNewTitle);
    }

    /**
     * Restore title display after editing
     * @param {string} title - Title to display
     */
    restoreTitleDisplay(title) {
        const input = document.querySelector('.spreadsheet-title-input');
        if (!input) return;

        const titleElement = document.createElement('h1');
        titleElement.id = 'spreadsheetTitle';
        titleElement.className = 'spreadsheet-title';
        titleElement.title = 'Click to rename';
        titleElement.textContent = title;

        input.parentNode.replaceChild(titleElement, input);

        // Re-setup click handler
        titleElement.addEventListener('click', () => {
            this.makeTitleEditable();
        });
    }

    /**
     * Rename spreadsheet
     * @param {string} newTitle - New spreadsheet title
     */
    async renameSpreadsheet(newTitle) {
        try {
            // Get current spreadsheet data
            const spreadsheetData = await spreadsheetManager.getCurrentSpreadsheetData();
            if (!spreadsheetData) {
                this.showError('Failed to rename spreadsheet');
                return;
            }

            // Update the name in the data
            spreadsheetData.name = newTitle;
            spreadsheetData.updatedAt = new Date().toISOString();

            // Save to storage
            const success = await spreadsheetManager.saveSpreadsheetMetadata(spreadsheetData);

            if (success) {
                // Reflect the new name in the editor header right away —
                // otherwise it keeps showing the old title until the user
                // goes back to the home page.
                this.updateSpreadsheetTitle(newTitle);
                this.showNotification('Spreadsheet renamed successfully', 'success');
            } else {
                this.showError('Failed to rename spreadsheet');
            }
        } catch (error) {
            console.error('[APP] Error renaming spreadsheet:', error);
            this.showError('Error renaming spreadsheet');
        }
    }

    // ================================================
    // Spreadsheet Operations
    // ================================================

    /**
     * Create new spreadsheet
     * Initialize fresh spreadsheet
     * @returns {Promise<string>} New spreadsheet ID
     */
    async createNew() {
        try {
            // Generate unique ID
            const newId = this.generateId();

            // Create default data structure
            const defaultData = spreadsheetManager.createDefaultData();

            // Initialize spreadsheet with default data
            const result = await spreadsheetManager.initialize(defaultData);
            if (!result.ok) {
                throw new Error('Failed to initialize spreadsheet');
            }

            // Set and save to storage
            spreadsheetManager.currentSheetId = newId;
            await spreadsheetManager.save();

            return newId;
        } catch (error) {
            console.error('[APP] Error creating new spreadsheet:', error);
            return null;
        }
    }

    /**
     * Load existing spreadsheet
     * Load spreadsheet from storage
     * @param {string} id - Spreadsheet ID
     * @returns {Promise<boolean>} Success status
     */
    async load(id) {
        try {
            // Load from storage (spreadsheetManager.load() handles its own loading state)
            const success = await spreadsheetManager.load(id);

            if (success) {
                this.spreadsheetId = id;
                return true;
            }

            return false;
        } catch (error) {
            console.error('Error loading spreadsheet:', error);
            return false;
        }
    }

    /**
     * Save current spreadsheet
     * Persist current state.
     * On explicit saves, if the spreadsheet has never been named, show a
     * rename reminder first (Rename = name it then save; Later = save as
     * 'Untitled'). Auto-save bypasses the reminder.
     * @param {Object} [options] - Save options
     * @param {boolean} [options.explicit=true] - False for auto-save paths
     * @returns {Promise<boolean>} Success status
     */
    async save(options = {}) {
        const { explicit = true } = options;

        try {
            // Rename reminder: only on user-initiated saves, only while the
            // name is still the default, and only until dismissed once.
            if (explicit && !this.renamePromptDismissed && this.isUntitledSpreadsheet()) {
                this.openRenamePrompt();
                return false; // Actual save happens after Rename/Later is chosen
            }

            // Ensure IDs are consistent
            if (this.spreadsheetId && spreadsheetManager.currentSheetId !== this.spreadsheetId) {
                console.warn('[APP] ID mismatch detected, correcting');
                spreadsheetManager.currentSheetId = this.spreadsheetId;
            }

            // Save spreadsheet data
            const success = await spreadsheetManager.save();

            if (success) {
                // Update hasUnsavedChanges flag
                this.hasUnsavedChanges = false;

                // Show save confirmation
                this.showNotification('Spreadsheet saved successfully', 'success');
                return true;
            } else {
                this.showError('Failed to save spreadsheet');
                return false;
            }
        } catch (error) {
            console.error('[APP] Error saving spreadsheet:', error);
            this.showError('Error saving spreadsheet');
            return false;
        }
    }

    /**
     * Check whether the current spreadsheet still has its default name.
     * Covers every untitled variant in circulation: the Sheets home page
     * creates 'Untitled Spreadsheet', the Workdeck API creates 'Untitled
     * Sheet', and the editor falls back to 'Untitled'.
     * @returns {boolean} True if the name is empty or a default untitled name
     */
    isUntitledSpreadsheet() {
        const titleElement = document.getElementById('spreadsheetTitle');
        const currentName = titleElement ? titleElement.textContent.trim().toLowerCase() : '';
        return !currentName || currentName === 'untitled' || currentName === 'untitled spreadsheet' || currentName === 'untitled sheet';
    }

    /**
     * Wire up rename reminder modal event handlers
     */
    setupRenamePrompt() {
        const confirmBtn = document.getElementById('renamePromptConfirm');
        const laterBtn = document.getElementById('renamePromptLater');
        const closeBtn = document.getElementById('renamePromptClose');
        const modal = document.getElementById('renamePromptModal');
        const input = document.getElementById('renamePromptInput');

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.closeRenamePrompt(true));
        }
        if (laterBtn) {
            laterBtn.addEventListener('click', () => this.closeRenamePrompt(false));
        }
        // The X and backdrop count as "Later" - the save must still go through
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeRenamePrompt(false));
        }
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeRenamePrompt(false);
                }
            });
        }
        // Enter = Rename, Escape = Later
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.closeRenamePrompt(true);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.closeRenamePrompt(false);
                }
            });
        }
    }

    /**
     * Open the rename reminder modal
     */
    openRenamePrompt() {
        const modal = document.getElementById('renamePromptModal');
        const input = document.getElementById('renamePromptInput');
        if (!modal) {
            // Modal missing (e.g. stale markup) - never block saving
            this.renamePromptDismissed = true;
            return;
        }
        if (input) input.value = '';
        modal.classList.add('active');
        setTimeout(() => input && input.focus(), 100);
    }

    /**
     * Close the rename reminder modal
     * @param {boolean} renamed - True if the user chose Rename with a name
     */
    closeRenamePrompt(renamed) {
        const modal = document.getElementById('renamePromptModal');
        if (modal) modal.classList.remove('active');

        // Don't nag again for this spreadsheet after either choice
        this.renamePromptDismissed = true;

        const input = document.getElementById('renamePromptInput');
        const newName = (input ? input.value : '').trim();

        const proceed = () => {
            if (renamed && newName) {
                // Apply the new name, then continue the interrupted save
                this.renameSpreadsheet(newName).then(() => this.save({ explicit: false }));
            } else {
                // "Later" - save as Untitled exactly as before
                this.save({ explicit: false });
            }
        };

        if (renamed && newName) {
            // Input still visible for a frame - close first, then act
            setTimeout(proceed, 50);
        } else {
            proceed();
        }
    }

    /**
     * Auto-save handler
     * Periodic save logic
     */
    async autoSave() {
        // Check if has unsaved changes
        if (this.hasUnsavedChanges) {
            // Ensure ID consistency before saving
            if (this.spreadsheetId && spreadsheetManager.currentSheetId !== this.spreadsheetId) {
                console.warn('[APP] Auto-save: Correcting ID mismatch');
                spreadsheetManager.currentSheetId = this.spreadsheetId;
            }
            // Save if changed
            await spreadsheetManager.save();
            // Reset unsaved flag
            this.hasUnsavedChanges = false;
        }
    }

    /**
     * Set up change tracking for auto-save via Univer's command stream
     */
    setupLuckysheetHooks() {
        spreadsheetManager.startChangeTracking(() => {
            this.markAsChanged();
        });
    }

    /**
     * Setup auto-save interval
     */
    setupAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

        this.autoSaveInterval = setInterval(() => {
            this.autoSave();
        }, APP_CONFIG.autoSave.interval);
    }

    // ================================================
    // Theme Operations
    // ================================================

    /**
     * Toggle theme
     * Switch between light and dark
     */
    toggleTheme() {
        themeManager.toggleTheme();
        this.updateThemeIndicator();
    }

    /**
     * Set theme
     * Apply specific theme
     * @param {string} theme - Theme name
     */
    setTheme(theme) {
        themeManager.setTheme(theme);
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
            const systemTheme = themeManager.getSystemTheme();
            themeManager.setTheme(systemTheme);
            // Store preference as 'system'
            localStorage.setItem(themeManager.storageKey, 'system');
        } else {
            // Set specific theme
            themeManager.setTheme(theme);
        }
        this.updateThemeIndicator();
    }

    /**
     * Update theme indicator in settings menu
     * Show current theme status
     */
    updateThemeIndicator() {
        const themeText = document.getElementById('themeText');
        if (themeText) {
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

            // On mobile devices, show just "Theme" to fit on one line
            if (window.innerWidth <= 640) {
                themeText.textContent = 'Theme';
            } else {
                themeText.textContent = `Theme: ${themeDisplayName}`;
            }

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

    /**
     * Show key information
     * Display user's access key with copy functionality
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
     * Hide key modal
     * Close the key information modal
     */
    hideKeyModal() {
        const keyModal = document.getElementById('keyModal');
        if (keyModal) keyModal.classList.remove('active');
    }

    /**
     * Logout current user
     * Logout and redirect to login page
     */
    async logout() {
        try {
            await authManager.logout();
        } catch (error) {
            console.error('Logout error:', error);
            // Force redirect even if logout fails
            window.location.href = '/sheets/';
        }
    }

    /**
     * Show delete account confirmation modal
     * Display modal with warning about account deletion
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
     * Close the modal without taking action
     */
    hideDeleteAccountModal() {
        const deleteAccountModal = document.getElementById('deleteAccountModal');
        if (deleteAccountModal) {
            deleteAccountModal.classList.remove('active');
        }
    }

    /**
     * Confirm and delete account
     * Execute account deletion and redirect
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
            console.error('[APP] Delete account error:', error);
            this.showError('Failed to delete account');
            this.hideDeleteAccountModal();
        }
    }

    // ================================================
    // Share Modal
    // ================================================

    /**
     * Show share modal
     * Display shareable link for current spreadsheet
     */
    async showShareModal() {
        try {
            if (!this.spreadsheetId) {
                this.showError('No spreadsheet to share');
                return;
            }

            const shareModal = document.getElementById('shareModal');
            const shareSpreadsheetName = document.getElementById('shareSpreadsheetName');
            const shareUrlInput = document.getElementById('shareUrlInput');

            // Get current spreadsheet name
            const metadata = spreadsheetManager.getMetadata();
            if (shareSpreadsheetName) {
                shareSpreadsheetName.textContent = metadata?.name || 'Untitled Spreadsheet';
            }

            // Show loading state in modal
            if (shareUrlInput) {
                shareUrlInput.value = 'Generating share link...';
            }

            // Show the modal
            if (shareModal) {
                shareModal.classList.add('active');
            }

            // Generate share link
            const result = await sheetsStorage.shareSpreadsheet(this.spreadsheetId);

            if (result && result.shareUrl) {
                if (shareUrlInput) {
                    shareUrlInput.value = result.shareUrl;
                }
            } else {
                this.showError('Failed to generate share link');
                this.hideShareModal();
            }

        } catch (error) {
            console.error('[APP] Show share modal error:', error);
            this.showError('Failed to share spreadsheet');
            this.hideShareModal();
        }
    }

    /**
     * Hide share modal
     * Close the share modal
     */
    hideShareModal() {
        const shareModal = document.getElementById('shareModal');
        if (shareModal) {
            shareModal.classList.remove('active');
        }

        // Reset copy button state
        const copyShareUrlBtn = document.getElementById('copyShareUrlBtn');
        const copyButtonText = document.getElementById('copyButtonText');

        if (copyButtonText) {
            copyButtonText.textContent = 'Copy';
        }

        if (copyShareUrlBtn) {
            copyShareUrlBtn.classList.remove('copied');
        }
    }

    /**
     * Copy share URL to clipboard
     */
    async copyShareUrl() {
        const shareUrlInput = document.getElementById('shareUrlInput');
        const copyShareUrlBtn = document.getElementById('copyShareUrlBtn');

        if (!shareUrlInput || !shareUrlInput.value) {
            this.showError('No share link to copy');
            return;
        }

        try {
            // Try modern clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(shareUrlInput.value);

                // Update button state
                if (copyShareUrlBtn) {
                    copyShareUrlBtn.classList.add('copied');
                    const copyText = copyShareUrlBtn.querySelector('.copy-text');
                    if (copyText) {
                        copyText.textContent = 'Copied!';
                    }
                }

                // Reset after 2 seconds
                setTimeout(() => {
                    if (copyShareUrlBtn) {
                        copyShareUrlBtn.classList.remove('copied');
                        const copyText = copyShareUrlBtn.querySelector('.copy-text');
                        if (copyText) {
                            copyText.textContent = 'Copy';
                        }
                    }
                }, 2000);

                return;
            }

            // Fallback for older browsers
            shareUrlInput.select();
            shareUrlInput.setSelectionRange(0, 99999);

            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    if (copyShareUrlBtn) {
                        copyShareUrlBtn.classList.add('copied');
                        const copyText = copyShareUrlBtn.querySelector('.copy-text');
                        if (copyText) {
                            copyText.textContent = 'Copied!';
                        }
                    }

                    setTimeout(() => {
                        if (copyShareUrlBtn) {
                            copyShareUrlBtn.classList.remove('copied');
                            const copyText = copyShareUrlBtn.querySelector('.copy-text');
                            if (copyText) {
                                copyText.textContent = 'Copy';
                            }
                        }
                    }, 2000);
                }
            } catch (execErr) {
                console.error('[APP] Fallback copy failed:', execErr);
                this.showError('Failed to copy link');
            }
        } catch (err) {
            console.error('[APP] Copy error:', err);
            this.showError('Failed to copy link');
        }
    }

    // ================================================
    // URL Handling
    // ================================================

    /**
     * Parse URL for spreadsheet ID
     * Get ID from URL query params
     * @returns {string|null} Spreadsheet ID or null
     */
    parseURL() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('id');
    }

    /**
     * Update URL with spreadsheet ID
     * Update browser URL without reload
     * @param {string} id - Spreadsheet ID
     */
    updateURL(id) {
        window.history.pushState(null, '', `?id=${id}`);
    }

    /**
     * Strip the query string from the URL once the deep link has been
     * consumed, leaving the bare editor URL.
     * @returns {void}
     */
    cleanURL() {
        if (window.location.search) {
            window.history.replaceState(null, '', window.location.pathname);
        }
    }

    /**
     * Update spreadsheet title in the top nav
     * Display the spreadsheet name from cached data
     */
    updateSpreadsheetTitle(spreadsheetName = null) {
        const titleElement = document.getElementById('spreadsheetTitle');
        if (!titleElement || !this.spreadsheetId) return;

        try {
            // Use provided name, default to 'Untitled Spreadsheet' if not provided
            titleElement.textContent = spreadsheetName || 'Untitled';
        } catch (error) {
            console.error('[APP] Failed to update spreadsheet title:', error);
            titleElement.textContent = 'Untitled';
        }
    }

    // ================================================
    // Unsaved Changes Handling
    // ================================================

    /**
     * Mark spreadsheet as changed
     * Set unsaved changes flag
     */
    markAsChanged() {
        this.hasUnsavedChanges = true;
    }

    /**
     * Check for unsaved changes
     * Warn user before closing
     * @returns {boolean} Has unsaved changes
     */
    checkUnsavedChanges() {
        return this.hasUnsavedChanges;
    }

    /**
     * Handle before unload event
     * Show warning for unsaved changes
     * @param {Event} event - Before unload event
     */
    handleBeforeUnload(event) {
        // Check for unsaved changes
        if (this.hasUnsavedChanges) {
            // Set event.returnValue if changes exist
            event.preventDefault();
            event.returnValue = '';
            return event.returnValue;
        }
    }

    // ================================================
    // Spreadsheet Event Handlers
    // ================================================

    /**
     * Handle cell value change
     * Process cell modifications
     * @param {object} event - Change event
     */
    onCellChange(event) {
        // Mark as changed
        this.markAsChanged();
        // Trigger auto-save timer (handled by interval)
    }

    /**
     * Handle sheet change
     * Process sheet switching
     * @param {object} event - Sheet change event
     */
    onSheetChange(event) {
        // Update current sheet reference
        const currentSheet = spreadsheetManager.getCurrentSheetData();
        // Sheet changed successfully
    }

    /**
     * Handle selection change
     * Process selection updates
     * @param {object} event - Selection event
     */
    onSelectionChange(event) {
        // Update selection reference
        const selection = spreadsheetManager.getSelectedCells();
        // Store selection if needed for future operations
    }

    // ================================================
    // Utility Methods
    // ================================================

    /**
     * Show notification
     * Display user message
     * @param {string} message - Message text
     * @param {string} type - Message type ('success', 'error', 'info')
     */
    showNotification(message, type = 'info') {
        // Create and display notification element
        const msg = document.createElement('div');
        msg.className = `notification notification-${type}`;
        msg.textContent = message;
        document.body.appendChild(msg);

        // Auto-dismiss after timeout
        setTimeout(() => {
            msg.classList.add('notification-hiding');
            setTimeout(() => msg.remove(), 300);
        }, 3000);
    }

    /**
     * Show error
     * Display error message
     * @param {string} message - Error message
     */
    showError(message) {
        this.showNotification(message, 'error');
    }

    /**
     * Show loading state
     * Display loading overlay
     */
    showLoadingState() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.classList.remove('hidden');
            loadingOverlay.style.display = 'flex';
        }
    }

    /**
     * Hide loading state
     * Hide loading overlay
     */
    hideLoadingState() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
            loadingOverlay.classList.remove('hidden');
        }
    }

    /**
     * Validate storage connection
     * Check if storage is accessible
     * @returns {boolean} Connection status
     */
    validateStorageConnection() {
        // Try to access storage
        try {
            const testKey = '__sheets_test__';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            return true;
        } catch (e) {
            console.error('Storage connection failed:', e);
            return false;
        }
    }

    /**
     * Generate unique ID
     * Create unique identifier
     * @returns {string} Unique ID
     */
    generateId() {
        // Generate timestamp-based ID with random component
        const timestamp = Date.now().toString(36);
        const randomStr = Math.random().toString(36).substring(2, 11);
        return `${timestamp}_${randomStr}`;
    }

    /**
     * Get spreadsheet ID from URL or create new
     * Check URL for existing ID
     * @returns {string} Spreadsheet ID
     */
    getOrCreateSpreadsheetId() {
        // Parse URL for ID
        const urlId = this.parseURL();

        // Generate new ID if not found
        if (urlId) {
            return urlId;
        }

        // Return null to trigger creation of new spreadsheet
        return null;
    }

    /**
     * Clean up
     * Release resources on shutdown
     */
    async destroy() {
        try {
            // Save any pending changes (never via the rename reminder)
            if (this.hasUnsavedChanges) {
                await this.save({ explicit: false });
            }

            // Clear auto-save interval
            if (this.autoSaveInterval) {
                clearInterval(this.autoSaveInterval);
                this.autoSaveInterval = null;
            }

            // Destroy spreadsheet instance
            if (spreadsheetManager && spreadsheetManager.isInitialized) {
                spreadsheetManager.destroy();
            }

            this.isInitialized = false;
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

// ================================================
// Application Entry Point
// ================================================

/**
 * Initialize application when DOM is ready
 * Set up app and start initialization
 */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Wait for Univer to be available (CDN loading)
        let attempts = 0;
        const maxAttempts = 100; // 10 seconds timeout (more realistic for CDN)
        while (typeof UniverPresets === 'undefined' && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (typeof UniverPresets === 'undefined') {
            console.error('[APP] Univer failed to load from CDN');
            document.body.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; height: 100vh; flex-direction: column;">
                    <h2>Failed to load spreadsheet library</h2>
                    <p>Please check your internet connection and refresh the page.</p>
                    <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; cursor: pointer;">Refresh</button>
                </div>
            `;
            return;
        }

        // Create app instance
        const app = new SheetsApp();

        // Initialize application
        const success = await app.init();

        if (!success) {
            console.error('[APP] Failed to initialize application');
            app.showError('Failed to initialize application. Please refresh the page.');
        }

        // Expose app instance globally for debugging
        window.sheetsApp = app;
    } catch (error) {
        console.error('[APP] Application initialization error:', error);
    }
});

/**
 * Handle window errors
 * Global error handling
 */
window.addEventListener('error', (event) => {
    // Log error
    console.error('Application error:', event.error);

    // Show user-friendly error message
    if (window.sheetsApp) {
        window.sheetsApp.showError('An unexpected error occurred');
    }
});

/**
 * Handle unhandled promise rejections
 * Catch async errors
 */
window.addEventListener('unhandledrejection', (event) => {
    // Log error
    console.error('Unhandled promise rejection:', event.reason);

    // Show user-friendly error message
    if (window.sheetsApp) {
        window.sheetsApp.showError('An unexpected error occurred');
    }

    // Prevent default browser error handling
    event.preventDefault();
});
