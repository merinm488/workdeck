/**
 * ================================================
 * FORMS - Responses (editor.html "Responses" tab)
 * ================================================
 * Google-Forms-style responses for the OWNER of a form: a Summary view
 * (one chart card per question), an Individual view (one submission at
 * a time) and a Table view (every submission as a sortable grid), plus
 * CSV export and the spreadsheet-link state. Lives on the editor page,
 * next to the builder. Header buttons and modals are wired by editor.js;
 * this file owns the rendering + view state.
 *
 * DATA SOURCE
 *   formsStorage.getResponses(formId) -> { responses, form, linkedSheet }
 *
 *   - `form`        = the SHARED snapshot: the exact questions responders saw
 *   - `responses`   = array of submissions, oldest first (as stored), each:
 *       {
 *         id: 'mtm...',                            (added by the API)
 *         submittedAt: '2026-09-09T04:42:53.908Z', (added by the API)
 *         data: { questionKey: answer, ... },      (the answers)
 *         meta: { userAgent: '...' }
 *       }
 *   - `linkedSheet` = { sheetId, sheetColumns, syncedResponseIds, linkedAt }
 *     when the form is linked to a Sheets spreadsheet. The server mirrors
 *     new responses into that spreadsheet every time this view loads.
 *
 * RENDERING LIBRARIES (both MIT, pinned CDN <script> tags in editor.html;
 * this file only prepares data and reads the result — no hand-drawn SVG):
 *   - Chart.js 4 draws the Summary charts. The tallying is ours
 *     (tallyChoice); Chart.js does the drawing. Colors are resolved from
 *     the --viz-* CSS custom properties on #responsesTabPanel EVERY TIME
 *     a chart is built, because canvas can't follow CSS variables — the
 *     'formsthemechange' event (dispatched by themes.js on any theme
 *     change) triggers a rebuild of the open view.
 *   - Tabulator 6 renders the Table sub-tab and powers CSV export
 *     (table.download: RFC-4180 escaping + the UTF-8 BOM Excel wants,
 *     both built in).
 *
 * SUMMARY RENDERERS, PER QUESTION TYPE
 *   Single choice (radio, select)        -> Chart.js pie (Google-Forms-style)
 *   Multi choice (checklist, taglist)    -> Chart.js horizontal bars, biggest first
 *   Checkbox (boolean)                   -> Yes/No Chart.js bars
 *   Text-like (textfield, textarea, datetime) -> latest answers as chips
 *   Number                               -> Low / Average / High
 *
 * INDIVIDUAL VIEW
 *   One submission at a time: "‹ Response N of M ›", its timestamp, and
 *   every question with the respondent's answer (or "No answer").
 *   Read-only by design — deletion is bulk-only (the ⋮ menu).
 *
 * TABLE VIEW + CSV EXPORT
 *   Tabulator grid over the same submissions: sortable columns, a text
 *   filter per question, pagination, and ⋮ "Download responses (.csv)"
 *   — Timestamp + one column per question (the same columns the linked
 *   spreadsheet gets).
 *
 * =====================================================
 * DATVIZ NOTES (why the UI looks the way it does)
 * =====================================================
 * - Headline numbers (response count / last submission) are header text or
 *   a stat tile — a number is not a chart.
 * - PIE CHARTS for single-choice questions are a deliberate Google-Forms
 *   mimicry choice (the generic part-to-whole recommendation is a stacked
 *   bar). Guardrails that keep the pie honest:
 *     * every slice's value is in the legend as TEXT (label · count · %) —
 *       tooltips ADD detail, nothing is gated behind hover;
 *     * at most 6 real slices — a longer tail folds into a neutral "Other";
 *     * colors come from a CVD-validated categorical palette (the dataviz
 *       reference palette, slots 1-6, as --viz-1..--viz-6), assigned by
 *       OPTION ORDER so an option keeps its color as counts change —
 *       color follows the entity, never its rank;
 *     * slices are separated by a 2px stroke in the card surface color
 *       (--bg-secondary), the gap-as-stroke idiom.
 * - Multi-select bars keep the single-hue meter: the row label carries
 *   identity, bar length carries magnitude — same-hue for nominal
 *   categories. Bars are thin (10px), 4px rounded data-end, square at the
 *   baseline. Every count is printed in TEXT at its bar end.
 * - Values/labels wear text tokens (--text-primary), never series color.
 * - The Table view doubles as the plain-data accessibility fallback.
 * - DOM building: createElement + textContent only; Tabulator cells use a
 *   textContent formatter. Question labels are typed by the form owner and
 *   answer text is typed by strangers — never innerHTML for either.
 * =====================================================
 */

/** Component types that carry no answer: skipped everywhere. */
const NON_QUESTION_TYPES = new Set([
    'button', 'hidden',
    // presentation-only components
    'text', 'image', 'html', 'separator', 'spacer', 'documentPreview',
    'iframe', 'table'
]);

/** How many colored slices a pie may show before the tail folds into "Other". */
const PIE_MAX_SLICES = 6;

class FormsResponsesView {
    constructor() {
        this.formId = null;
        this.formRecord = null;   // SHARED snapshot of the form (questions)
        this.responses = [];      // submissions, oldest first (as stored)
        this.linkedSheet = null;  // { sheetId, ... } when linked to Sheets
        this.isLoading = false;
        // Which sub-tab is open: 'summary' | 'individual' | 'table'
        this.view = 'summary';
        this.individualIndex = 0; // which response the Individual tab shows
        // Live Chart.js instances. A removed canvas must not leave its
        // Chart object alive behind it, so every Summary rebuild destroys
        // these first.
        this.charts = [];
        // The Table sub-tab's Tabulator instance. Built lazily on first
        // open; also serves the ⋮ CSV download. tableToken invalidates
        // an in-flight async build when the view is rebuilt mid-await.
        this.table = null;
        this.tableToken = null;
        // Canvas charts can't follow CSS custom properties, so a theme
        // change rebuilds the open view with the newly-resolved palette
        // (themes.js dispatches 'formsthemechange' on every applyTheme).
        this.onThemeChange = () => this.rerenderForTheme();
        document.addEventListener('formsthemechange', this.onThemeChange);
    }

    // ================================================
    // Public API (called by editor.js)
    // ================================================

    /**
     * Load + render responses for one form.
     * @param {string} formId
     * @returns {Promise<boolean>} true when data loaded (even 0 responses)
     */
    async load(formId) {
        // 1. Remember formId on `this` (refresh() reuses it) and return
        //    false if it's missing.
        if (!formId) {
            return false;
        }
        this.formId = formId;

        // 2. Guard against double-loads: if this.isLoading is already true,
        //    return false (the tab can be tapped rapidly).
        if (this.isLoading) {
            return false;
        }

        // 3. Set this.isLoading = true, show the loading state, drop any
        //    stale views, then fetch.
        this.isLoading = true;
        this.showState('loading');
        this.destroyCharts();
        this.destroyTable();
        const result = await formsStorage.getResponses(this.formId);

        // 4. Failure: result === null -> surface the error through the
        //    editor's toast (editor.js exposes itself as
        //    window.formsEditorApp) and bail.
        if (result === null) {
            this.isLoading = false;
            window.formsEditorApp?.showError('Failed to load responses');
            return false;
        }

        // 5. Success: store what came back on `this`, then render.
        this.responses = result.responses || [];
        this.formRecord = result.form || null;
        this.linkedSheet = result.linkedSheet || null;
        this.isLoading = false;

        // Header count ("N responses") + link-state UI. The active
        // sub-tab's view is rendered by showState -> applyView below —
        // charts build while their panel is VISIBLE so Chart.js measures
        // real pixel sizes.
        this.renderHeaderCount();
        this.updateSheetsUI();
        // With zero responses the summary cards would all read "0 of 0
        // answered" — the dedicated empty state says something useful
        // instead (and showState itself picks the right wording based on
        // whether the form has ever been shared).
        this.showState(this.responses.length > 0 ? 'summary' : 'empty');
        return true;
    }

    /** Re-fetch + re-render (the Refresh button). */
    async refresh() {
        if (!this.formId) return false;
        return this.load(this.formId);
    }

    /**
     * Swap the Summary / Individual / Table sub-tab (called by editor.js).
     * @param {'summary'|'individual'|'table'} view
     */
    switchView(view) {
        if (this.view === view) return;
        this.view = view;
        this.applyView();
    }

    /**
     * Where the linked spreadsheet lives. Derived, not stored: the API
     * returns only the sheetId.
     * @returns {string|null}
     */
    get sheetUrl() {
        return this.linkedSheet && this.linkedSheet.sheetId
            ? `${window.location.origin}/sheets/editor.html?id=${this.linkedSheet.sheetId}`
            : null;
    }

    /** Called by editor.js after a successful unlink. */
    clearLinkedSheet() {
        this.linkedSheet = null;
        this.updateSheetsUI();
    }

    /**
     * Download every response as CSV (the ⋮ menu item). Timestamp + one
     * column per question — the same columns the linked spreadsheet gets.
     * Delegated to Tabulator's download: RFC-4180 escaping and the UTF-8
     * BOM Excel wants are handled by the library.
     */
    async downloadCsv() {
        if (this.responses.length === 0) {
            window.formsEditorApp?.showError('No responses to download');
            return;
        }
        if (typeof Tabulator === 'undefined') {
            window.formsEditorApp?.showError('Table library failed to load');
            return;
        }

        const safeName = (this.formRecord?.name || 'Untitled Form')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .trim() || 'form';
        const filename = `${safeName} - responses.csv`;

        // Always export through a throw-away offscreen instance (built
        // offscreen because display:none would hand Tabulator a
        // zero-width container to measure columns against). Using the
        // visible grid instead could leak its active header filters or
        // pagination state into the export — the ⋮ CSV must always
        // contain EVERY response.
        const holder = document.createElement('div');
        holder.style.cssText =
            'position:fixed;left:-10000px;top:0;width:1200px;';
        document.body.appendChild(holder);
        const temp = new Tabulator(holder, this.tableConfig());
        // Tabulator 6.5.0 crashes if setData() lands before its renderer
        // finishes initializing (headers build first; rows go through
        // _wipeElements -> adjustTableSize with a null renderer) — wait
        // for the tableBuilt event first. Same guard in renderTable().
        await new Promise(resolve => temp.on('tableBuilt', resolve));
        await temp.setData(this.tableRows());
        temp.download('csv', filename);
        temp.destroy();
        holder.remove();

        window.formsEditorApp?.showNotification('Responses downloaded', 'success');
    }

    // ================================================
    // State switching (loading / empty / summary / error)
    // ================================================

    /**
     * Show exactly ONE of the tab's top-level states by toggling the
     * 'hidden' class on the containers defined in editor.html:
     *   'loading' -> #responsesLoading
     *   'empty'   -> #responsesEmpty      (zero responses)
     *   'summary' -> the sub-tab panels, then applyView() picks one
     *   'error'   -> #responsesError
     * @param {'loading'|'empty'|'summary'|'error'} state
     */
    showState(state) {
        const map = {
            loading: ['responsesLoading'],
            empty:   ['responsesEmpty'],
            summary: ['responsesSummary', 'responsesIndividual', 'responsesTable'],
            error:   ['responsesError']
        };

        for (const [stateName, elementIds] of Object.entries(map)) {
            for (const elementId of elementIds) {
                const el = document.getElementById(elementId);
                if (el) {
                    el.classList.toggle('hidden', stateName !== state);
                }
            }
        }

        // Zero responses: the copy reads differently depending on whether
        // the form has ever been shared.
        if (state === 'empty') {
            const titleEl = document.getElementById('responsesEmptyTitle');
            const textEl = document.getElementById('responsesEmptyText');

            if (titleEl) {
                titleEl.textContent = 'No responses yet';
            }
            if (textEl) {
                textEl.textContent = this.formRecord === null
                    ? 'Share your form to start collecting responses.'
                    : 'Your form is live and waiting for its first response.';
            }
        }

        if (state === 'summary') {
            this.applyView();
        }
    }

    /**
     * Sync the sub-tab buttons + panels with this.view, then build the
     * freshly opened view (charts build while visible so Chart.js
     * measures real sizes; the table re-uses its instance across visits).
     */
    applyView() {
        const panels = {
            summary: 'responsesSummary',
            individual: 'responsesIndividual',
            table: 'responsesTable'
        };
        for (const [viewName, elementId] of Object.entries(panels)) {
            const el = document.getElementById(elementId);
            if (el) {
                el.classList.toggle('hidden', this.view !== viewName);
            }
        }

        const tabs = {
            summary: 'responsesSubtabSummary',
            individual: 'responsesSubtabIndividual',
            table: 'responsesSubtabTable'
        };
        for (const [viewName, elementId] of Object.entries(tabs)) {
            const tab = document.getElementById(elementId);
            if (tab) {
                tab.classList.toggle('active', this.view === viewName);
                tab.setAttribute('aria-selected',
                    this.view === viewName ? 'true' : 'false');
            }
        }

        if (this.view === 'summary') {
            this.renderSummary();
        }
        if (this.view === 'individual') {
            this.renderIndividual();
        }
        if (this.view === 'table') {
            this.renderTable();
        }
    }

    // ================================================
    // Header + sheets-link UI
    // ================================================

    /** The Google-Forms-style "N responses" header label. */
    renderHeaderCount() {
        const countEl = document.getElementById('responsesCountLabel');
        if (countEl) {
            const n = this.responses.length;
            countEl.textContent = `${n} ${n === 1 ? 'response' : 'responses'}`;
        }
    }

    /**
     * Reflect the spreadsheet link in the header: the Sheets button turns
     * into "Open in Sheets" and the ⋮ menu gains the Unlink item.
     */
    updateSheetsUI() {
        const sheetsBtn = document.getElementById('responsesSheetsBtn');
        if (sheetsBtn) {
            sheetsBtn.classList.toggle('linked', !!this.linkedSheet);
            const label = this.linkedSheet ? 'Open in Sheets' : 'Link to Sheets';
            sheetsBtn.title = label;
            sheetsBtn.setAttribute('aria-label', label);
        }

        const unlinkItem = document.getElementById('responsesUnlinkBtn');
        if (unlinkItem) {
            unlinkItem.classList.toggle('hidden', !this.linkedSheet);
        }
    }

    // ================================================
    // Summary rendering
    // ================================================

    /**
     * Top of the Summary sub-tab: the stat tile.
     */
    renderStatTiles() {
        const lastEl = document.getElementById('responsesLastValue');
        if (lastEl) {
            const last = this.responses[this.responses.length - 1];
            lastEl.textContent = this.formatRelativeTime(last?.submittedAt);
        }
    }

    /**
     * Main entry: the tile + one summary card per question.
     */
    renderSummary() {
        this.renderStatTiles();
        this.destroyCharts();   // removed canvases must not leave Charts alive

        const questions = this.flattenComponents(
            this.formRecord?.components || []
        );

        const listEl = document.getElementById('responsesQuestionList');
        if (!listEl) {
            return;
        }
        listEl.replaceChildren();

        for (const question of questions) {
            if (!question.type || question.type === 'button'
                || question.type === 'hidden') {
                continue;
            }

            const renderer = this.getRendererFor(question);
            if (!renderer) {
                continue;
            }

            const answered = this.responses.filter(
                r => r.data && r.data[question.key] !== undefined
            ).length;

            const card = document.createElement('div');
            card.className = 'responses-question-card';

            const head = document.createElement('div');
            head.className = 'responses-question-head';

            const label = document.createElement('h3');
            label.className = 'responses-question-label';
            label.textContent = question.label || question.key;

            const meta = document.createElement('span');
            meta.className = 'responses-question-meta';
            meta.textContent = `${answered} of ${this.responses.length} answered`;

            head.appendChild(label);
            head.appendChild(meta);

            const body = document.createElement('div');
            body.className = 'responses-question-body';
            body.appendChild(renderer(question));

            card.appendChild(head);
            card.appendChild(body);
            listEl.appendChild(card);
        }

        const noQuestionsEl = document.getElementById('responsesNoQuestions');
        if (noQuestionsEl) {
            noQuestionsEl.classList.toggle('hidden', listEl.children.length > 0);
        }
    }

    // ================================================
    // Individual rendering
    // ================================================

    /**
     * Build the Individual sub-tab: "Response N of M", its timestamp, and
     * one label/answer row per question of the SHARED snapshot.
     */
    renderIndividual() {
        const total = this.responses.length;
        if (total === 0) return;

        // Keep the index valid after refreshes / deletions.
        this.individualIndex = Math.min(Math.max(this.individualIndex, 0), total - 1);
        const response = this.responses[this.individualIndex];

        const positionEl = document.getElementById('individualPosition');
        if (positionEl) {
            positionEl.textContent =
                `Response ${this.individualIndex + 1} of ${total}`;
        }

        const timestampEl = document.getElementById('individualTimestamp');
        if (timestampEl) {
            const when = response?.submittedAt
                ? new Date(response.submittedAt) : null;
            timestampEl.textContent = when && !isNaN(when.getTime())
                ? `Submitted ${when.toLocaleString()}`
                : '';
        }

        const listEl = document.getElementById('individualQuestionList');
        if (!listEl) return;
        listEl.replaceChildren();

        for (const question of this.flattenComponents(
            this.formRecord?.components || []
        )) {
            if (!question.type || NON_QUESTION_TYPES.has(question.type)) {
                continue;
            }

            const row = document.createElement('div');
            row.className = 'responses-individual-question';

            const label = document.createElement('div');
            label.className = 'responses-individual-question-label';
            label.textContent = question.label || question.key;

            const answerEl = document.createElement('div');
            const answer = response?.data
                ? response.data[question.key]
                : undefined;
            const answerText = this.answerTextFor(question, answer);
            if (answerText === null) {
                answerEl.className =
                    'responses-individual-answer is-empty';
                answerEl.textContent = 'No answer';
            } else {
                answerEl.className = 'responses-individual-answer';
                answerEl.textContent = answerText;
            }

            row.appendChild(label);
            row.appendChild(answerEl);
            listEl.appendChild(row);
        }

        // Arrows stop at the ends (no wrap-around, like Google Forms).
        const prevBtn = document.getElementById('individualPrevBtn');
        const nextBtn = document.getElementById('individualNextBtn');
        if (prevBtn) prevBtn.disabled = this.individualIndex === 0;
        if (nextBtn) nextBtn.disabled = this.individualIndex === total - 1;
    }

    /** Step the Individual view by ±1 (called by editor.js arrow buttons). */
    moveIndividual(delta) {
        const total = this.responses.length;
        if (total === 0) return;
        const next = this.individualIndex + delta;
        if (next < 0 || next >= total) return;
        this.individualIndex = next;
        this.renderIndividual();
    }

    // ================================================
    // Answer formatting (shared by Individual + CSV)
    // ================================================

    /**
     * Human text for one submitted answer: option values resolve to their
     * labels, booleans read Yes/No, arrays join with commas. Returns null
     * when the question was left unanswered.
     * @param {object} question - form-js component
     * @param {*} answer
     * @returns {string|null}
     */
    answerTextFor(question, answer) {
        if (answer === undefined || answer === null || answer === '') {
            return null;
        }
        if (typeof answer === 'boolean') {
            return answer ? 'Yes' : 'No';
        }
        if (Array.isArray(answer)) {
            const parts = answer
                .map(item => this.answerTextFor(question, item))
                .filter(Boolean);
            return parts.length > 0 ? parts.join(', ') : null;
        }
        // Options live top-level in form-js components (radio/select/
        // checklist/taglist) and under data.values on legacy survey fields.
        const options = question.values || question.data?.values;
        if (options) {
            const match = options.find(
                opt => opt && (opt.value === answer || opt.label === answer)
            );
            if (match) return match.label;
        }
        if (typeof answer === 'object') {
            return JSON.stringify(answer);
        }
        return String(answer);
    }

    // ================================================
    // Question tree walking
    // form-js nests questions inside groups/dynamic lists; we need the
    // flat, ordered list of input questions.
    // ================================================

    /**
     * Depth-first walk of the form-js component tree.
     * @param {Array} components - form-js components array
     * @returns {Array} every component, in display order
     */
    flattenComponents(components) {
        const out = [];

        // A recursive helper — it calls itself for containers' children.
        const walk = (list) => {
            for (const c of list || []) {
                if (!c) {
                    continue;
                }

                if (c.components) {
                    walk(c.components);
                } else {
                    out.push(c);
                }
            }
        };

        walk(components || []);
        return out;
    }

    // ================================================
    // Renderers by question type
    // ================================================

    /**
     * Pick the renderer function for a component type.
     * All renderers share the same signature: fn(question) -> DOM node.
     * They read the submissions themselves via this.responses.
     * @param {object} question - form-js component
     * @returns {Function} fn(question) -> DOM node
     */
    getRendererFor(question) {
        const t = question.type;

        // Single-choice questions get the Google-Forms pie.
        if (t === 'radio' || t === 'select') {
            return this.renderChoicePie.bind(this);
        }

        // Multi-select keeps the bar meter (bar length carries magnitude).
        if (t === 'checklist' || t === 'taglist') {
            return this.renderChoiceBars.bind(this);
        }

        // Text-like types get answer chips. form-js has no separate email/
        // phone/url types — those are textfields with a validation pattern —
        // so the chip list is short. 'datetime' stores an ISO-ish string and
        // reads fine as text.
        const textTypes = [
            'textfield', 'textarea', 'datetime'
        ];
        if (textTypes.includes(t)) {
            return this.renderTextChips.bind(this);
        }

        // 'number' -> Low / Average / High stats.
        if (t === 'number') {
            return this.renderNumberStats.bind(this);
        }

        // 'checkbox' is boolean (Yes/No) — a two-bar choice chart reads
        // better than raw true/false chips.
        if (t === 'checkbox') {
            return this.renderCheckboxBars.bind(this);
        }

        // Anything else (containers were already filtered out by
        // flattenComponents): fall back to renderTextChips — it prints odd
        // values readably. Return it rather than null so nothing disappears.
        return this.renderTextChips.bind(this);
    }

    // ---- Choice tallying (shared by pie + bars) ----------------

    /**
     * Count answers per option label, in OPTION ORDER (never rank order —
     * the pie uses position here for stable colors). Answers store the
     * option's VALUE ('red') while bars/legend show the LABEL ('Red'), so
     * one resolves to the other first; matching the label too keeps older
     * submissions (or value===label options) tallying correctly. Unknown
     * labels create phantom buckets on demand.
     * @param {object} question
     * @returns {{counts: Object<string, number>}}
     */
    tallyChoice(question) {
        // Options live top-level in form-js components (radio/select/
        // checklist/taglist) and under data.values on legacy survey fields.
        const options = question.values || question.data?.values;

        const counts = {};
        for (const option of options || []) {
            counts[option.label] = 0;
        }

        const bump = (label) => {
            if (counts[label] === undefined) {
                counts[label] = 0;   // bucket for unexpected answers
            }
            counts[label] += 1;
        };

        const toLabel = (answer) => {
            const match = (options || []).find(
                opt => opt && (opt.value === answer || opt.label === answer)
            );
            return match ? match.label : answer;
        };

        for (const r of this.responses) {
            const answer = r.data && r.data[question.key];
            if (answer === undefined || answer === '') {
                continue;
            }
            if (Array.isArray(answer)) {
                for (const item of answer) {
                    bump(toLabel(item));
                }
            } else {
                bump(toLabel(answer));
            }
        }

        return { counts };
    }

    // ================================================
    // Chart.js plumbing (palette + canvas containers)
    // ================================================

    /**
     * Theme-aware colors for Chart.js, resolved fresh on every build:
     * canvas can't follow CSS custom properties, so the --viz-*,
     * text and surface variables on #responsesTabPanel are read into concrete
     * values here. A theme change re-runs this via 'formsthemechange'.
     * @returns {{palette: string[], other: string, surface: string,
     *            text: string, muted: string, accent: string,
     *            font: {family: string, size: number}}}
     */
    chartTheme() {
        const panel = document.getElementById('responsesTabPanel');
        const styles = panel
            ? getComputedStyle(panel)
            : getComputedStyle(document.documentElement);
        const v = (name) => styles.getPropertyValue(name).trim();
        return {
            palette: ['--viz-1', '--viz-2', '--viz-3',
                      '--viz-4', '--viz-5', '--viz-6'].map(v),
            other: v('--viz-other'),
            surface: v('--bg-secondary'),
            text: v('--text-primary'),
            muted: v('--text-secondary'),
            accent: v('--accent-color'),
            font: { family: "'Inter', sans-serif", size: 12 }
        };
    }

    /**
     * Fixed-height container for one chart. The card body is fluid
     * width; Chart.js fills the container (responsive: true +
     * maintainAspectRatio: false) and follows resizes itself.
     * @param {string} className
     * @param {number} heightPx
     * @returns {HTMLElement}
     */
    chartContainer(className, heightPx) {
        const wrap = document.createElement('div');
        wrap.className = className;
        wrap.style.height = `${heightPx}px`;
        return wrap;
    }

    /** Destroy every live Chart (before any Summary rebuild). */
    destroyCharts() {
        for (const chart of this.charts) {
            chart.destroy();
        }
        this.charts = [];
    }

    /** Destroy the Table grid (before every load/rebuild). */
    destroyTable() {
        if (this.table) {
            this.table.destroy();
            this.table = null;
        }
        this.tableToken = null;   // invalidate any in-flight buildTable
    }

    /**
     * Re-render the open view after a theme flip. Charts must rebuild
     * (new palette values); Individual has no canvas; the Table
     * restyles through its swapped Tabulator stylesheet, no rebuild.
     */
    rerenderForTheme() {
        if (!this.formId || this.isLoading) {
            return;
        }
        if (this.view === 'summary') {
            this.renderSummary();
        }
    }

    // ---- Renderer 1: pie (single choice) ------------------------

    /**
     * Google-Forms-style pie for single-choice questions, drawn by
     * Chart.js: solid slices in option order with a legend that states
     * every count + percentage in text.
     * @param {object} question
     * @returns {HTMLElement}
     */
    renderChoicePie(question) {
        const { counts } = this.tallyChoice(question);

        // Drop options nobody picked, then fold a long tail into "Other".
        let entries = Object.entries(counts).filter(([, count]) => count > 0);
        let folded = false;
        if (entries.length > PIE_MAX_SLICES) {
            const otherCount = entries
                .slice(PIE_MAX_SLICES)
                .reduce((sum, [, count]) => sum + count, 0);
            entries = entries.slice(0, PIE_MAX_SLICES);
            entries.push(['Other', otherCount]);
            folded = true;
        }
        const grandTotal = entries.reduce((sum, [, count]) => sum + count, 0);

        if (grandTotal === 0) {
            const empty = document.createElement('div');
            empty.className = 'responses-no-data';
            empty.textContent = 'No answers yet';
            return empty;
        }

        if (typeof Chart === 'undefined') {
            const msg = document.createElement('div');
            msg.className = 'responses-no-data';
            msg.textContent =
                'Chart library failed to load — check your connection and refresh.';
            return msg;
        }

        // Palette slot per entry (option order); the folded "Other" wears
        // neutral gray. Values re-read from CSS vars on every build, so a
        // theme change recolors through rerenderForTheme().
        const theme = this.chartTheme();
        const colors = entries.map(([label], index) =>
            folded && label === 'Other' && index === entries.length - 1
                ? theme.other
                : theme.palette[index % PIE_MAX_SLICES]);

        const wrap = this.chartContainer(
            'responses-chart responses-chart-square', 220);
        const canvas = document.createElement('canvas');
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label',
            `Answer distribution for ${question.label || question.key}`);
        wrap.appendChild(canvas);

        const chart = new Chart(canvas, {
            type: 'pie',
            data: {
                labels: entries.map(([label]) => label),
                datasets: [{
                    data: entries.map(([, count]) => count),
                    backgroundColor: colors,
                    // The stroke IS the gap: a 2px ring in the card
                    // surface color separates adjacent slices.
                    borderColor: theme.surface,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: theme.text,
                            font: theme.font,
                            boxWidth: 12,
                            boxHeight: 12,
                            // Legend text carries every value: label ·
                            // count · % — nothing gated behind hover.
                            generateLabels: () => entries.map(([label, count], i) => ({
                                text: `${label} — ${count} (${Math.round((count / grandTotal) * 100)}%)`,
                                fillStyle: colors[i],
                                strokeStyle: theme.surface,
                                lineWidth: 1,
                                index: i
                            }))
                        },
                        // Click a legend entry to hide/show that slice —
                        // explicit because our generated items use
                        // index-based visibility.
                        onClick: (e, legendItem, legend) => {
                            legend.chart.toggleDataVisibility(legendItem.index);
                            legend.chart.update();
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const count = ctx.parsed;
                                const percent = Math.round((count / grandTotal) * 100);
                                return ` ${count} (${percent}%)`;
                            }
                        }
                    }
                }
            }
        });
        this.charts.push(chart);
        return wrap;
    }

    // ---- Renderer 1b: checkbox (boolean) bars ------------------

    /**
     * Yes/No tally for a checkbox question, rendered as two bar meters.
     * @param {object} question
     * @returns {HTMLElement}
     */
    renderCheckboxBars(question) {
        let yes = 0;
        let no = 0;

        for (const r of this.responses) {
            const value = r.data && r.data[question.key];
            if (value === true) {
                yes += 1;
            } else if (value === false) {
                no += 1;
            }
            // undefined/null (never answered) counts toward neither bar
        }

        return this.renderBarChart([['Yes', yes], ['No', no]]);
    }

    // ---- Renderer 1c: multi-choice bars ------------------------

    /**
     * Tally answers for a multi-select question and render bar meters,
     * biggest first (same hue for every bar — the label carries identity).
     * @param {object} question
     * @returns {HTMLElement}
     */
    renderChoiceBars(question) {
        const { counts } = this.tallyChoice(question);
        const pairs = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return this.renderBarChart(pairs);
    }

    /**
     * Shared Chart.js horizontal bars for count-per-option data (the
     * multi-choice tally and the Yes/No checkbox tally). Single hue —
     * the row label carries identity, bar length carries magnitude —
     * with each count printed at its bar end so no value lives only in
     * a tooltip.
     * @param {Array<[string, number]>} pairs
     * @returns {HTMLElement}
     */
    renderBarChart(pairs) {
        if (typeof Chart === 'undefined') {
            const msg = document.createElement('div');
            msg.className = 'responses-no-data';
            msg.textContent =
                'Chart library failed to load — check your connection and refresh.';
            return msg;
        }

        const theme = this.chartTheme();
        const maxCount = pairs.reduce((m, [, count]) => Math.max(m, count), 0);

        const wrap = this.chartContainer(
            'responses-chart', pairs.length * 34 + 16);
        const canvas = document.createElement('canvas');
        wrap.appendChild(canvas);

        // Prints each bar's count just past its end. Values are text, so
        // they wear the text token — never the series color.
        const countLabels = {
            id: 'responsesCountLabels',
            afterDatasetsDraw(chart) {
                const meta = chart.getDatasetMeta(0);
                const ctx = chart.ctx;
                ctx.save();
                ctx.fillStyle = theme.text;
                ctx.font = `600 ${theme.font.size}px 'Inter', sans-serif`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                meta.data.forEach((bar, i) => {
                    ctx.fillText(String(pairs[i][1]), bar.x + 6, bar.y);
                });
                ctx.restore();
            }
        };

        const chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: pairs.map(([label]) => label),
                datasets: [{
                    data: pairs.map(([, count]) => count),
                    backgroundColor: theme.accent,
                    barThickness: 10,
                    borderRadius: 4,
                    borderSkipped: 'start'   // square baseline, rounded data-end
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { right: 34 } },  // room for the counts
                scales: {
                    x: { display: false, max: maxCount || 1 },
                    y: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { color: theme.text, font: theme.font }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) =>
                                ` ${ctx.parsed.x} ${ctx.parsed.x === 1 ? 'response' : 'responses'}`
                        }
                    }
                }
            },
            plugins: [countLabels]
        });
        this.charts.push(chart);
        return wrap;
    }

    // ---- Renderer 2: text chips -------------------------------

    /**
     * Latest N answers to a text-like question, as chips.
     * @param {object} question
     * @returns {HTMLElement}
     */
    renderTextChips(question) {
        const MAX_CHIPS = 8;

        const chips = [];
        let total = 0;

        for (const r of [...this.responses].reverse()) {
            const value = r.data && r.data[question.key];
            if (value === undefined || value === null || value === '') {
                continue;
            }

            total += 1;
            if (chips.length < MAX_CHIPS) {
                let text;
                if (typeof value === 'boolean') {
                    text = value ? 'Yes' : 'No';
                } else if (typeof value === 'object') {
                    text = JSON.stringify(value);
                } else {
                    text = String(value);
                }
                chips.push(text);
            }
        }

        const wrap = document.createElement('div');

        if (total === 0) {
            wrap.className = 'responses-no-data';
            wrap.textContent = 'No answers yet';
            return wrap;
        }

        wrap.className = 'responses-chips';
        for (const text of chips) {
            const chip = document.createElement('span');
            chip.className = 'responses-chip';
            chip.textContent = text;
            wrap.appendChild(chip);
        }

        if (total > MAX_CHIPS) {
            const more = document.createElement('span');
            more.className = 'responses-chip responses-chip-more';
            more.textContent = `+${total - MAX_CHIPS} more`;
            wrap.appendChild(more);
        }

        return wrap;
    }

    // ---- Renderer 3: number stats ------------------------------

    /**
     * Low / Average / High for a number question.
     * @param {object} question
     * @returns {HTMLElement}
     */
    renderNumberStats(question) {

        const numbers = [];
        for (const r of this.responses) {
            const value = r.data && r.data[question.key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                numbers.push(value);
            }
        }

        if (numbers.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'responses-no-data';
            empty.textContent = 'No answers yet';
            return empty;
        }


        let sum = 0;
        let min = numbers[0];
        let max = numbers[0];
        for (const n of numbers) {
            sum += n;
            if (n < min) min = n;
            if (n > max) max = n;
        }
        const average = sum / numbers.length;

        const wrap = document.createElement('div');
        wrap.className = 'responses-numbers';

        const rows = [
            ['Low', min],
            ['Average', average],
            ['High', max]
        ];
        for (const [label, value] of rows) {
            const cell = document.createElement('div');
            cell.className = 'responses-number';

            const labelEl = document.createElement('span');
            labelEl.className = 'responses-number-label';
            labelEl.textContent = label;

            const valueEl = document.createElement('span');
            valueEl.className = 'responses-number-value';
            valueEl.textContent = this.formatNumber(value);

            cell.appendChild(labelEl);
            cell.appendChild(valueEl);
            wrap.appendChild(cell);
        }

        return wrap;
    }

    // ================================================
    // Table view (Tabulator)
    // Every response as a sortable, filterable grid — and the same
    // instance powers the ⋮ CSV download.
    // ================================================

    /**
     * Flat rows for Tabulator: one object per response, each answer
     * keyed directly by its question key (Tabulator columns read
     * top-level fields; Timestamp is the only reserved column).
     * @returns {Array<object>}
     */
    tableRows() {
        return this.responses.map(r => ({
            id: r && r.id,
            submittedAt: (r && r.submittedAt) || '',
            ...((r && r.data) || {})
        }));
    }

    /**
     * Columns: Timestamp first, then one per answerable question of the
     * SHARED snapshot — the same columns the CSV export and the linked
     * spreadsheet use. Display goes through textContent (a DOM formatter
     * or answerTextFor) — answer text is typed by strangers. Downloads
     * go through accessorDownload, so the CSV gets the same human values
     * the old hand-rolled exporter (and the linked spreadsheet) wrote:
     * option LABELS, Yes/No, comma-joined multi-selects.
     * @returns {Array<object>} Tabulator column definitions
     */
    tableColumns() {
        const timestamp = {
            title: 'Timestamp',
            field: 'submittedAt',
            width: 190,
            sorter: 'string',   // ISO strings sort chronologically
            formatter: (cell) => {
                const when = new Date(cell.getValue());
                const el = document.createElement('span');
                el.textContent = isNaN(when.getTime())
                    ? '' : when.toLocaleString();
                return el;
            },
            accessorDownload: (value) => value ?? ''
        };

        const questions = this.flattenComponents(
            this.formRecord?.components || []
        )
            .filter(c => c.type && c.key && !NON_QUESTION_TYPES.has(c.type))
            .map(q => ({
                title: q.label || q.key,
                field: q.key,
                headerFilter: 'input',
                maxWidth: 360,
                // answerTextFor renders arrays/booleans/options readably
                // and returns null for "no answer" — printed as ''.
                formatter: (cell) => {
                    const el = document.createElement('span');
                    el.textContent =
                        this.answerTextFor(q, cell.getValue()) ?? '';
                    return el;
                },
                accessorDownload: (value) =>
                    this.answerTextFor(q, value) ?? '',
                // Explicit sorter REQUIRED: without one, Tabulator's
                // findSorter() inspects only the FIRST row's raw value
                // and calls .match() on it — an array (checklist answer)
                // crashes every sort click. Sorting the display text
                // also keeps the order consistent with what's shown.
                sorter: (a, b) => {
                    const left = (this.answerTextFor(q, a) ?? '').toLowerCase();
                    const right = (this.answerTextFor(q, b) ?? '').toLowerCase();
                    return left === right ? 0 : (left < right ? -1 : 1);
                }
            }));

        return [timestamp, ...questions];
    }

    /**
     * Shared Tabulator config for the visible grid and the offscreen
     * CSV-export table. Rows are set via setData() by both call sites,
     * so the config carries none.
     * @returns {object} Tabulator constructor options
     */
    tableConfig() {
        return {
            index: 'id',
            layout: 'fitDataFill',
            pagination: true,
            paginationSize: 25,
            paginationSizeSelector: [10, 25, 50, 100],
            maxHeight: '70vh',
            placeholder: 'No responses',
            columns: this.tableColumns()
        };
    }

    /**
     * Build the Table sub-tab's grid. Destroyed and rebuilt on every
     * load(), so the columns always match the current shared snapshot.
     */
    async renderTable() {
        const mount = document.getElementById('responsesTableGrid');
        if (!mount) {
            return;
        }

        if (typeof Tabulator === 'undefined') {
            mount.replaceChildren();
            const msg = document.createElement('div');
            msg.className = 'responses-no-data';
            msg.textContent =
                'Table library failed to load — check your connection and refresh.';
            mount.appendChild(msg);
            return;
        }

        this.destroyTable();
        const token = {};       // identity of THIS build attempt
        this.tableToken = token;
        const table = new Tabulator(mount, this.tableConfig());

        // Tabulator 6.5.0 crashes if setData() lands before its renderer
        // finishes initializing (headers build first; rows go through
        // _wipeElements -> adjustTableSize with a null renderer) — wait
        // for the tableBuilt event first. Same guard in downloadCsv().
        await new Promise(resolve => table.on('tableBuilt', resolve));
        await table.setData(this.tableRows());

        // A refresh or another build may have superseded this instance
        // while we waited — don't leave the zombie behind.
        if (this.tableToken !== token) {
            table.destroy();
            return;
        }
        this.table = table;
    }

    // ================================================
    // Formatting helpers
    // ================================================

    /**
     * Human "3m ago" strings; falls back to a full locale date+time.
     * @param {string} isoTimestamp
     * @returns {string}
     */
    formatRelativeTime(isoTimestamp) {
        const then = new Date(isoTimestamp);
        if (isNaN(then.getTime())) {
            return '';
        }
        const seconds = Math.round((Date.now() - then.getTime()) / 1000);
        if (seconds < 60) {
            return 'just now';
        }
        if (seconds < 3600) {
            return Math.round(seconds / 60) + 'm ago';
        }
        if (seconds < 86400) {
            return Math.round(seconds / 3600) + 'h ago';
        }

        return then.toLocaleString();
    }

    /**
     * Compact numbers for tiles/stats: 5 -> '5', 1284 -> '1.3K',
     * 1200000 -> '1.2M'.
     * @param {number} n
     * @returns {string}
     */
    formatNumber(n) {
        if (n >= 1e6) {
            return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        }

        if (n >= 1e3) {
            return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return String(n);
    }
}

// ================================================
// Export
// Forms loads plain <script> tags (no modules), so attach the class to
// window — editor.js then does `new FormsResponsesView()`.
// ================================================

if (typeof window !== 'undefined') {
    window.FormsResponsesView = FormsResponsesView;
}
