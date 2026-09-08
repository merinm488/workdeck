/**
 * ================================================
 * FORMS - Editor Application (editor.html)
 * ================================================
 * Coordinates everything on the form editor page:
 *   - session check
 *   - loading the form record and rendering the Form.io BUILDER
 *   - save (manual Ctrl+S + auto-save) via FormsStorage
 *   - rename by clicking the title
 *   - settings dropdown: Theme / View My Key / Share / Delete Account / Logout
 *
 *
 * =====================================================
 * FORM.IO QUICK REFERENCE (the only library APIs you need)
 * =====================================================
 *   Formio.builder(element, schema, options) -> Promise<builderInstance>
 *       element : DOM node, e.g. document.getElementById('builder')
 *       schema  : { display: 'form', components: [ ... ] }
 *       options : { builder: { basic: true, advanced: true, layout: true,
 *                              data: true, premium: false } }
 *                 -> groups shown in the left palette (premium is paid: keep false)
 *
 *   builderInstance.schema         -> CURRENT schema incl. edits: {display, components}
 *   builderInstance.on('change', cb) -> fires whenever the user edits the form
 *   builderInstance.destroy()        -> free the DOM when leaving the page
 *
 *   (For the shared/public side you'll use Formio.createForm instead —
 *    see js/shared.js.)
 * =====================================================
 */

class FormsEditorApp {
    constructor() {
        this.isInitialized = false;
        this.formId = null;          // from ?id=...
        this.formRecord = null;      // { id, name, display, components, sharedId, ... }
        this.builderInstance = null; // Form.io builder handle
        this.hasUnsavedChanges = false;
        this.autoSaveInterval = null;
        this.titleElementReplaced = false;
    }

    // ================================================
    // Initialization
    // ================================================

    /**

     * @returns {Promise<boolean>} success
     */
    async init() {
        try {
            // 1. Theme first — no flash of the wrong colors
            formsThemeManager.init();

            // 2. Session guard (Workdeck's login mirrored into sessionStorage)
            const session = formsAuth.getSession();
            if (!session) {
                goToWorkdeck();
                return false;
            }

            // 3. Which form did Workdeck ask us to open?
            this.formId = this.parseURL('id');
            if (!this.formId) {
                goToWorkdeck();
                return false;
            }

            // 4. Wire every button before anything slow happens
            this.setupEventListeners();

            // 5-6. Load the record (or seed a default one on first open)
            this.showLoading();
            const form = await formsStorage.getForm(this.formId);
            if (!form) {
                this.formRecord = this.createDefaultFormRecord(this.formId);
                await formsStorage.saveForm(this.formId, this.formRecord);
            } else {
                this.formRecord = form;
            }

            // 7. Show the saved name in nav + browser tab
            this.updateFormTitle(this.formRecord.name);

            // 8. Build the drag-and-drop editor
            await this.initBuilder();

            // 9. Periodic background save
            if (APP_CONFIG.autoSave.enabled) {
                this.setupAutoSave();
            }

            // 10. Ready
            this.hideLoading();
            this.cleanURL();

            // 11.
            this.isInitialized = true;
            return true;
        } catch (error) {
            console.error('[FORMS EDITOR] Init error:', error);
            this.showError('Failed to initialize application');
            return false;
        }
    }

  
    createDefaultFormRecord(id) {
        return {
            id: id,
            name: 'Untitled Form',
            display: 'form',
            components: [],
            sharedId: null
        };
    }

    // ================================================
    // Builder (Form.io)
    // ================================================

    /**
     * Create the drag-and-drop builder inside #builder.
     * The 'change' hook is what drives auto-save.
     */
    async initBuilder() {
        if (typeof Formio === 'undefined') {
            this.showError('Form library failed to load. Please refresh.');
            return;
        }
        const element = document.getElementById('builder');
        this.builderInstance = await Formio.builder(element, {
            display: this.formRecord.display || 'form',
            components: this.formRecord.components || []
        }, { builder: APP_CONFIG.builder });
        this.builderInstance.on('change', () => this.markAsChanged());
    }

    /**
     * Snapshot the builder's current schema for saving.
     * @returns {object|null} formData for formsStorage.saveForm()
     */
    getBuilderSchema() {
        if(!this.builderInstance) return null;
        const schema = this.builderInstance.schema;
        return {
        
            name: (this.formRecord && this.formRecord.name) || this.currentTitle(),
            display: schema.display || 'form',
            components: schema.components || []
        };
    }

    // ================================================
    // Saving
    // ================================================

    /** 
     *
     * @param {object} [options] - { explicit: true } default; autosave passes false
     * @returns {Promise<boolean>}
     */
    async save(options = {}) {
        const formData = this.getBuilderSchema();
        if(!formData) {
            this.showError('Nothing to save');
            return false;
        }
        const ok = await formsStorage.saveForm(this.formId,formData);
        if(!ok){
            this.showError('Failed to save form');
            return false;
        }
        else {
            this.hasUnsavedChanges = false;
            this.showNotification('Form Saved', 'success');
            return true;
        }
    }

    /**
   
     */
    setupAutoSave() {
        clearInterval(this.autoSaveInterval);
       this.autoSaveInterval = setInterval(() => {
        if(this.hasUnsavedChanges) {
            this.save({explicit:false});
        }
       }, APP_CONFIG.autoSave.interval);
    }

    /** Mark dirty (called from the builder 'change' hook). */
    markAsChanged() {
        this.hasUnsavedChanges = true;
    }

    // ================================================
    // Title / rename
    // ================================================

    /**Read the title currently shown in the top nav. */
    currentTitle() {
        const el = document.getElementById('formTitle');
        return el ? el.textContent.trim() : 'Untitled Form';
    }

    /** Set the title text in the top nav. */
    updateFormTitle(name) {
        const el = document.getElementById('formTitle');
        if (el) el.textContent = name || 'Untitled Form';
        document.title = (name || 'Untitled Form') + ' - Forms';
    }

    /**
    
     */
    makeTitleEditable() {
        const h1 = document.getElementById('formTitle');
        if (!h1) return;

        const currentTitle = this.currentTitle();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-title-input';
        input.value = currentTitle;

        h1.parentNode.replaceChild(input, h1);
        input.focus();
        input.select();

        // Commit on blur (Enter triggers blur). Escape cancels.
        const commit = async () => {
            const newName = input.value.trim() || 'Untitled Form';
            if (newName !== currentTitle) {
                this.formRecord.name = newName;
                this.updateFormTitle(newName);
                await formsStorage.saveForm(this.formId, this.getBuilderSchema());
            }
            this.restoreTitleDisplay(newName);
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                this.restoreTitleDisplay(currentTitle);
            }
        });

        input.addEventListener('blur', commit);
    }

    /**
     * Put the <h1> back after editing (called by makeTitleEditable's commit path).
     * @param {string} title
     */
    restoreTitleDisplay(title) {
        const input = document.querySelector('.form-title-input');
        if (!input) return;

        const h1 = document.createElement('h1');
        h1.id = 'formTitle';
        h1.className = 'form-title';
        h1.title = 'Click to rename';
        h1.textContent = title;

        input.parentNode.replaceChild(h1, input);

        h1.addEventListener('click', () => this.makeTitleEditable());
    }

    // ================================================
    // Event listeners
    // ================================================

    /**
     * Wire every interactive element once. One listener per element; the
     * modal helpers below do the heavy lifting.
     *
 
     */
    setupEventListeners() {
        // --- Top nav ---
        const homeBtn = document.getElementById('homeBtn');
        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                window.location.href = '/';
            });
        }

        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        // --- Settings dropdown ---
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsDropdown = document.getElementById('settingsDropdown');
        if (settingsBtn && settingsDropdown) {
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsDropdown.classList.toggle('active');
            });
        }

        const themeToggleBtn = document.getElementById('themeToggleBtn');
        const themeSubmenu = document.getElementById('themeSubmenu');
        if (themeToggleBtn && themeSubmenu) {
            themeToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                themeSubmenu.classList.toggle('active');
            });
        }

        // Theme option selection
        const themeOptions = document.querySelectorAll('.theme-option');
        themeOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                formsThemeManager.setTheme(option.dataset.theme);
                this.updateThemeIndicator();
                if (themeSubmenu) {
                    themeSubmenu.classList.remove('active');
                }
            });
        });

        // Close dropdown / submenu when clicking outside
        document.addEventListener('click', (e) => {
            if (settingsDropdown && !e.target.closest('.top-nav-settings')) {
                settingsDropdown.classList.remove('active');
                if (themeSubmenu) {
                    themeSubmenu.classList.remove('active');
                }
            }
            if (themeSubmenu && !e.target.closest('.theme-dropdown-container')) {
                themeSubmenu.classList.remove('active');
            }
        });

        // --- Settings menu items ---
        const viewKeyBtn = document.getElementById('viewKeyBtn');
        if (viewKeyBtn) {
            viewKeyBtn.addEventListener('click', () => this.showKeyModal());
        }

        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => this.showShareModal());
        }

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => formsAuth.logout());
        }

        const deleteAccountBtn = document.getElementById('deleteAccountBtn');
        if (deleteAccountBtn) {
            deleteAccountBtn.addEventListener('click', () => this.showDeleteAccountModal());
        }

        // --- Title rename ---
        const formTitle = document.getElementById('formTitle');
        if (formTitle) {
            formTitle.addEventListener('click', () => this.makeTitleEditable());
        }

        // --- Key modal ---
        const keyModalClose = document.getElementById('keyModalClose');
        if (keyModalClose) {
            keyModalClose.addEventListener('click', () => this.hideKeyModal());
        }

        const keyModalCloseBtn = document.getElementById('keyModalCloseBtn');
        if (keyModalCloseBtn) {
            keyModalCloseBtn.addEventListener('click', () => this.hideKeyModal());
        }

        // Copy the access key to the clipboard
        const keyCopyBtn = document.getElementById('keyCopyBtn');
        if (keyCopyBtn) {
            keyCopyBtn.addEventListener('click', async () => {
                const userKey = formsAuth.getUserKey();
                if (!userKey) return;
                try {
                    await navigator.clipboard.writeText(userKey);
                    const keyCopyFeedback = document.getElementById('keyCopyFeedback');
                    if (keyCopyFeedback) {
                        keyCopyFeedback.classList.add('visible');
                        setTimeout(() => keyCopyFeedback.classList.remove('visible'), 2000);
                    }
                } catch (err) {
                    console.error('[FORMS EDITOR] Copy key failed:', err);
                    this.showError('Failed to copy key');
                }
            });
        }

        // --- Share modal ---
        const shareModalClose = document.getElementById('shareModalClose');
        if (shareModalClose) {
            shareModalClose.addEventListener('click', () => this.hideShareModal());
        }

        const shareModalCloseBtn = document.getElementById('shareModalCloseBtn');
        if (shareModalCloseBtn) {
            shareModalCloseBtn.addEventListener('click', () => this.hideShareModal());
        }

        const copyShareUrlBtn = document.getElementById('copyShareUrlBtn');
        if (copyShareUrlBtn) {
            copyShareUrlBtn.addEventListener('click', () => this.copyShareUrl());
        }

        // --- Delete account modal ---
        const deleteAccountModalClose = document.getElementById('deleteAccountModalClose');
        if (deleteAccountModalClose) {
            deleteAccountModalClose.addEventListener('click', () => this.hideDeleteAccountModal());
        }

        const cancelDeleteAccount = document.getElementById('cancelDeleteAccount');
        if (cancelDeleteAccount) {
            cancelDeleteAccount.addEventListener('click', () => this.hideDeleteAccountModal());
        }

        const confirmDeleteAccount = document.getElementById('confirmDeleteAccount');
        if (confirmDeleteAccount) {
            confirmDeleteAccount.addEventListener('click', () => this.confirmDeleteAccount());
        }

        // --- Keyboard shortcuts ---
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.save();
            }
        });

        // --- Mobile label swap for the theme row ---
        window.addEventListener('resize', () => this.updateThemeIndicator());

        // --- Warn before leaving with unsaved changes ---
        window.addEventListener('beforeunload', (e) => {
            if (this.hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    // ================================================
    // Theme indicator (settings menu label)
    // ================================================


    updateThemeIndicator() {
        const themeText = document.getElementById('themeText');
        if (!themeText) return;
        const label = formsThemeManager.getDisplayLabel();

        const narrow = window.innerWidth <= 640;
        themeText.textContent = narrow ? 'Theme' : 'Theme: ' + label;

        const pref = formsThemeManager.getPreference();
        document.querySelectorAll('.theme-option').forEach(option => {
            option.classList.toggle('active', option.dataset.theme === pref);
        });
    }

    // ================================================
    // Key modal
    // ================================================

   
    showKeyModal() {
        const keyText = document.getElementById('keyText');
        const keyModal = document.getElementById('keyModal');
        const settingsDropdown = document.getElementById('settingsDropdown');

        if (keyText) {
            keyText.textContent = formsAuth.getUserKey() || 'Not available';
        }
        if (keyModal) {
            keyModal.classList.add('active');
        }
        if (settingsDropdown) {
            settingsDropdown.classList.remove('active');
        }
    }

    /** Remove .active from #keyModal. */
    hideKeyModal() {
        const keyModal = document.getElementById('keyModal');
        if (keyModal) {
            keyModal.classList.remove('active');
        }
    }
    

    // ================================================
    // Delete account modal
    // ================================================

    /** Add .active to #deleteAccountModal; close the settings dropdown. */
    showDeleteAccountModal() {
        const deleteAccountModal = document.getElementById('deleteAccountModal');
        const settingsDropdown = document.getElementById('settingsDropdown');

        if (deleteAccountModal) {
            deleteAccountModal.classList.add('active');
        }
        if (settingsDropdown) {
            settingsDropdown.classList.remove('active');
        }
    }

    /** Remove .active from #deleteAccountModal. */
    hideDeleteAccountModal() {
        const deleteAccountModal = document.getElementById('deleteAccountModal');
        if (deleteAccountModal) {
            deleteAccountModal.classList.remove('active');
        }
    }

    
    async confirmDeleteAccount() {
        const result = await formsAuth.deleteAccount();
        if (!result || !result.success) {
            this.showError((result && result.error) || 'Failed to delete account');
            this.hideDeleteAccountModal();
        }
        // On success, formsAuth.deleteAccount() has already redirected to Workdeck.
    }

    // ================================================
    // Share modal
    // ================================================

  
    async showShareModal() {
        if (!this.formId) {
            this.showError('No form to share');
            return;
        }

        const shareFormName = document.getElementById('shareFormName');
        const shareUrlInput = document.getElementById('shareUrlInput');
        const shareModal = document.getElementById('shareModal');
        const settingsDropdown = document.getElementById('settingsDropdown');

        if (shareFormName) {
            shareFormName.textContent = this.formRecord?.name || 'Untitled Form';
        }
        if (shareUrlInput) {
            shareUrlInput.value = 'Generating share link...';
        }
        if (shareModal) {
            shareModal.classList.add('active');
        }
        if (settingsDropdown) {
            settingsDropdown.classList.remove('active');
        }

        const result = await formsStorage.shareForm(this.formId);
        if (result && result.shareUrl) {
            if (shareUrlInput) {
                shareUrlInput.value = result.shareUrl;
            }
            this.formRecord.sharedId = result.shareId;
        } else {
            this.showError('Failed to generate share link');
            this.hideShareModal();
        }
    }

    /** Hide #shareModal and reset the copy button (text 'Copy', drop .copied). */
    hideShareModal() {
        const shareModal = document.getElementById('shareModal');
        if (shareModal) {
            shareModal.classList.remove('active');
        }

        const copyShareUrlBtn = document.getElementById('copyShareUrlBtn');
        const copyButtonText = document.getElementById('copyButtonText');

        if (copyButtonText) {
            copyButtonText.textContent = 'Copy';
        }
        if (copyShareUrlBtn) {
            copyShareUrlBtn.classList.remove('copied');
        }
    }

    async copyShareUrl() {
        const input = document.getElementById('shareUrlInput');
        const copyShareUrlBtn = document.getElementById('copyShareUrlBtn');
        const copyButtonText = document.getElementById('copyButtonText');

        if (!input || !input.value) {
            this.showError('No share link to copy');
            return;
        }

        const showCopied = () => {
            if (copyShareUrlBtn) copyShareUrlBtn.classList.add('copied');
            if (copyButtonText) copyButtonText.textContent = 'Copied!';
            setTimeout(() => {
                if (copyShareUrlBtn) copyShareUrlBtn.classList.remove('copied');
                if (copyButtonText) copyButtonText.textContent = 'Copy';
            }, 2000);
        };

        try {
            // Modern browsers: async Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(input.value);
                showCopied();
                return;
            }

            // Fallback for older browsers
            input.select();
            input.setSelectionRange(0, 99999);
            const successful = document.execCommand('copy');
            if (successful) {
                showCopied();
            } else {
                this.showError('Failed to copy link');
            }
        } catch (err) {
            console.error('[FORMS EDITOR] Copy share link failed:', err);
            this.showError('Failed to copy link');
        }
    }

    // ================================================
    // URL helpers
    // ================================================

    /**
     * Read a query param from the URL.
     * @param {string} name
     * @returns {string|null}
     */
    parseURL(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    /**
     * Strip the query string once the deep link was consumed.
     */
    cleanURL() {
        if (window.location.search) {
            window.history.replaceState(null, '', window.location.pathname);
        }
    }

    // ================================================
    // Loading / notifications
    // ================================================

    /** Show the loading overlay. */
    showLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.classList.remove('hidden');
    }

    /** Hide the loading overlay. */
    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    /**
     * Toast notification.
     * @param {string} message
     * @param {'success'|'error'|'info'} [type]
     */
    showNotification(message, type = 'info') {
        const el = document.getElementById('notification');
        if (!el) return;
        el.textContent = message;
        el.className = 'notification ' + (type || 'info');
        void el.offsetWidth;            // restart transition
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 3000);
    }

    /** @param {string} message */
    showError(message) {
        this.showNotification(message, 'error');
    }

    // ================================================
    // Teardown
    // ================================================

    
    async destroy() {
        if (this.hasUnsavedChanges) {
            await this.save({ explicit: false });
        }
        clearInterval(this.autoSaveInterval);
        if (this.builderInstance) {
            this.builderInstance.destroy();
        }
    }
}

// ================================================
// Boot
// ================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Wait for the Form.io CDN bundle (up to 10s), like Sheets waits for Univer.
        let attempts = 0;
        while (typeof Formio === 'undefined' && attempts < 100) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (typeof Formio === 'undefined') {
            document.body.innerHTML =
                '<div style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif">' +
                '<h2>Failed to load form library</h2>' +
                '<p>Please check your internet connection and refresh the page.</p>' +
                '<button onclick="location.reload()" style="margin-top:20px;padding:10px 20px;cursor:pointer">Refresh</button>' +
                '</div>';
            return;
        }

        const app = new FormsEditorApp();
        const success = await app.init();

        if (!success && document.getElementById('loadingOverlay')) {
            // init() only returns false when it redirected away; nothing to show.
        }

        window.formsEditorApp = app;   // debugging handle, like Sheets
    } catch (error) {
        console.error('[FORMS EDITOR] Boot error:', error);
    }
});

// Free the builder DOM when leaving the page.
window.addEventListener('beforeunload', () => {
    if (window.formsEditorApp) {
        window.formsEditorApp.destroy();
    }
});

// Global error surfaces
window.addEventListener('error', (event) => {
    console.error('Application error:', event.error);
    if (window.formsEditorApp) window.formsEditorApp.showError('An unexpected error occurred');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    if (window.formsEditorApp) window.formsEditorApp.showError('An unexpected error occurred');
    event.preventDefault();
});
