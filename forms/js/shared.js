/**
 * ================================================
 * FORMS - Shared (public) View (shared.html)
 * ================================================
 * The page a form RECIPIENT sees via the share link:
 *   /forms/shared.html?shared=<shareId>
 *
 * No login required — the shareId IS the access. Flow:
 *   1. Parse ?shared= from the URL
 *   2. formsStorage.getSharedForm(shareId)     (public GET)
 *   3. FormViewer.createForm({ container, schema })
 *   4. on submit -> formsStorage.submitResponse(shareId, payload)
 *   5. show the thank-you panel; "Submit another response" re-renders
 *

 *
 * =====================================================
 * FORM-JS QUICK REFERENCE (renderer side)
 * =====================================================
 *   FormViewer.createForm(options) -> Promise<formInstance>
 *       options : { container: DOM node (#formjs),
 *                   schema: { type: 'default', components: [ ... ] } }
 *
 *   formInstance.on('submit', handler(result)) // user pressed Submit
 *       result = { data: {...}, errors: {...}, files: Map }
 *       Fires even when validation FAILED — check result.errors first;
 *       only an empty errors object means every field is valid. The
 *       library shows the inline error messages itself.
 *   formInstance.destroy()
 * =====================================================
 */

class SharedFormApp {
    constructor() {
        this.shareId = null;
        this.formRecord = null;      // { name, components, ... }
        this.formInstance = null;    // form-js viewer handle
    }

    // ================================================
    // Initialization
    // ================================================


    async init() {
        // 1. The share ID is the page's only credential — without it, bail.
        this.shareId = this.parseURL('shared');
        if (!this.shareId) {
            this.showErrorPanel('No share ID provided');
            return;
        }

        // 2. Spinner on BEFORE the network request, not after.
        this.showLoading();

        // 3. Public fetch — no login; the shareId is the access.
        const result = await formsStorage.getSharedForm(this.shareId);
        if (!result) {
            this.showErrorPanel('Form not found or no longer shared');
            return;
        }

        // 4–5. Keep just the form half; put its name in the <h1> and tab title.
        this.formRecord = result.form;
        this.updatePageTitle();

        // 6. Build the fillable form.
        await this.renderForm();

        // 7. Only now can the spinner come off — the form is on screen.
        this.hideLoading();
    }

    // ================================================
    // Rendering
    // ================================================

    async renderForm() {
        // 1. The renderer bundle comes from a CDN — bail out if it never loaded.
        if (typeof FormViewer === 'undefined') {
            this.showErrorPanel('Failed to load the form library');
            return;
        }

        // 2. The empty container div the form gets rendered into.
        const element = document.getElementById('formjs');

        // 3. Build the form; await pauses here until form-js is done rendering.
        this.formInstance = await FormViewer.createForm({
            container: element,
            schema: {
                type: 'default',
                components: this.formRecord.components || []
            }
        });

        // 4. This callback runs LATER — every time the recipient clicks Submit.
        //    form-js runs its own validation first and renders the inline
        //    error messages; 'submit' fires either way, so we only accept
        //    the submission when there are no errors.
        this.formInstance.on('submit', async (result) => {
            const errors = result.errors || {};
            if (Object.keys(errors).length > 0) {
                // Library already highlighted the fields — nothing to add.
                return;
            }

            const payload = {
                data: result.data,                   // the answers
                meta: { userAgent: navigator.userAgent }
            };

            const ok = await formsStorage.submitResponse(this.shareId, payload);
            if (ok) {
                this.showSuccessPanel();             // thank-you panel first
                this.formInstance.destroy();         // then tear down the form
                this.formInstance = null;
            } else {
                this.showNotification('Submission failed — please try again', 'error');
            }
        });
    }

    // ================================================
    // Panels
    // ================================================

    showSuccessPanel() {
        document.getElementById('sharedView').style.display = 'none';
        document.getElementById('submitResult').style.display = 'block';
    }

   
    async handleSubmitAgain() {
        // Reverse of showSuccessPanel: back from thank-you to the form view.
        document.getElementById('submitResult').style.display = 'none';
        document.getElementById('sharedView').style.display = 'block';

        // Fresh blank form in the (now visible) container.
        await this.renderForm();
    }

   
    showErrorPanel(message) {
        this.hideLoading();
        const h2 = document.querySelector('#submitResult h2');
        if(h2) h2.textContent = 'Something went wrong';
        document.getElementById('submitResultText').textContent = message;
        document.getElementById('sharedView').style.display = 'none';
        document.getElementById('submitResult').style.display = 'block';
        document.getElementById('submitAgainBtn').style.display = 'none';
    }

    // ================================================
    // Events / title / URL / loading
    // ================================================

   
    setupEventListeners() {
        document.getElementById('submitAgainBtn').addEventListener(
            'click', () => this.handleSubmitAgain());
    }

    /** Set document.title + the h1 from the form name. */
    updatePageTitle() {
        const name = (this.formRecord && this.formRecord.name) || 'Untitled Form';
        document.title = name;
        const h1 = document.getElementById('sharedFormTitle');
        if (h1) h1.textContent = name;
    }

    /** Read a query param from the URL. */
    parseURL(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

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
        void el.offsetWidth;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 3000);
    }
}

// ================================================
// Boot
// ================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Wait for the form-js CDN bundle (up to 10s), like the editor does.
        let attempts = 0;
        while (typeof FormViewer === 'undefined' && attempts < 100) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (typeof FormViewer === 'undefined') {
            document.body.innerHTML =
                '<div style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif">' +
                '<h2>Failed to load form library</h2>' +
                '<p>Please check your internet connection and refresh the page.</p>' +
                '<button onclick="location.reload()" style="margin-top:20px;padding:10px 20px;cursor:pointer">Refresh</button>' +
                '</div>';
            return;
        }

        const app = new SharedFormApp();
        app.setupEventListeners();
        await app.init();
        window.sharedFormApp = app;   // debugging handle
    } catch (error) {
        console.error('[FORMS SHARED] Boot error:', error);
        if (window.sharedFormApp) {
            window.sharedFormApp.showErrorPanel('Failed to load this form.');
        }
    }
});
