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
 *   3. Formio.createForm(element, { display, components })
 *   4. on submit -> formsStorage.submitResponse(shareId, payload)
 *   5. show the thank-you panel; "Submit another response" re-renders
 *

 *
 * =====================================================
 * FORM.IO QUICK REFERENCE (renderer side)
 * =====================================================
 *   Formio.createForm(element, form, options) -> Promise<formInstance>
 *       element : DOM node (#formio)
 *       form    : { display: 'form', components: [ ... ] }
 *       options : { readOnly: true|false }   (not needed for fill-out)
 *
 *   formInstance.on('submit', handler(submission)) // user pressed Submit
 *       submission = { data: {...}, ... }
 *       IMPORTANT: inside the handler call event.preventDefault() — we
 *       submit to OUR API (formsStorage.submitResponse), not form.io's.
 *   formInstance.redraw() / destroy()
 * =====================================================
 */

class SharedFormApp {
    constructor() {
        this.shareId = null;
        this.formRecord = null;      // { name, display, components, ... }
        this.formInstance = null;    // Form.io renderer handle
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
        if (typeof Formio === 'undefined') {
            this.showErrorPanel('Failed to load the form library');
            return;
        }

        // 2. The empty container div the form gets rendered into.
        const element = document.getElementById('formio');

        // 3. Build the form; await pauses here until form.io is done rendering.
        this.formInstance = await Formio.createForm(element, {
            display: this.formRecord.display || 'form',
            components: this.formRecord.components || []
        });

        // 4. This callback runs LATER — every time the recipient clicks Submit.
        this.formInstance.on('submit', async (submission) => {
            // Stop form.io from POSTing to its own servers — we use our API.
            if (event) event.preventDefault();

            const payload = {
                data: submission.data,               // the answers
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
        // Wait for the Form.io CDN bundle (up to 10s), like the editor does.
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
