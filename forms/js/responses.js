/**
 * ================================================
 * FORMS - Responses (editor.html "Responses" tab)
 * ================================================
 * Google-Forms-style responses for the OWNER of a form: a Summary view
 * (one chart card per question) and an Individual view (one submission at
 * a time), plus CSV export and the spreadsheet-link state. Lives on the
 * editor page, next to the builder. Header buttons and modals are wired
 * by editor.js; this file owns the rendering + view state.
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
 * SUMMARY RENDERERS, PER QUESTION TYPE
 *   Single choice (radio, select)        -> pie chart (Google-Forms-style)
 *   Multi choice (checklist, taglist)    -> per-option bar meter
 *   Checkbox (boolean)                   -> Yes/No bar meter
 *   Text-like (textfield, textarea, datetime) -> latest answers as chips
 *   Number                               -> Low / Average / High
 *
 * INDIVIDUAL VIEW
 *   One submission at a time: "‹ Response N of M ›", its timestamp, and
 *   every question with the respondent's answer (or "No answer").
 *   Read-only by design — deletion is bulk-only (the ⋮ menu).
 *
 * CSV EXPORT
 *   Timestamp + one column per question (the same columns the linked
 *   spreadsheet uses). RFC-4180 escaped, built and downloaded client-side.
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
 *       nothing is gated behind hover;
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
 *   baseline, on a track tinted with --accent-light. Every value is
 *   visible in TEXT next to its bar — nothing is gated behind hover.
 * - DOM building: createElement + textContent only (SVG via
 *   createElementNS). Question labels are typed by the form owner and
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
        // Which sub-tab is open: 'summary' | 'individual'
        this.view = 'summary';
        this.individualIndex = 0; // which response the Individual tab shows
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

        // 3. Set this.isLoading = true, show the loading state, then fetch.
        this.isLoading = true;
        this.showState('loading');
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

        // Header count ("N responses"), summary cards, link-state UI.
        this.renderHeaderCount();
        this.updateSheetsUI();
        this.renderSummary();
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
     * Swap the Summary / Individual sub-tab (called by editor.js).
     * @param {'summary'|'individual'} view
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
     */
    downloadCsv() {
        if (this.responses.length === 0) {
            window.formsEditorApp?.showError('No responses to download');
            return;
        }

        const questions = this.flattenComponents(this.formRecord?.components || [])
            .filter(c => c.type && c.key && !NON_QUESTION_TYPES.has(c.type));

        // RFC-4180: quote a cell when it contains a comma, quote or
        // newline, doubling any embedded quotes.
        const escape = (value) => {
            const text = value === null || value === undefined ? '' : String(value);
            return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };

        const lines = [
            ['Timestamp', ...questions.map(q => q.label || q.key)].map(escape).join(',')
        ];
        for (const response of this.responses) {
            const cells = [(response && response.submittedAt) || ''];
            for (const question of questions) {
                const answer = response && response.data
                    ? response.data[question.key]
                    : undefined;
                cells.push(this.answerTextFor(question, answer) ?? '');
            }
            lines.push(cells.map(escape).join(','));
        }

        // A UTF-8 BOM keeps Excel reading accented characters correctly.
        const blob = new Blob(['\ufeff' + lines.join('\r\n')], {
            type: 'text/csv;charset=utf-8;'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const safeName = (this.formRecord?.name || 'Untitled Form')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .trim() || 'form';
        link.download = `${safeName} - responses.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

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
            summary: ['responsesSummary', 'responsesIndividual'],
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
     * Sync the sub-tab buttons + panels with this.view (and build the
     * Individual card when that sub-tab is open).
     */
    applyView() {
        const summaryEl = document.getElementById('responsesSummary');
        const individualEl = document.getElementById('responsesIndividual');
        if (summaryEl) {
            summaryEl.classList.toggle('hidden', this.view !== 'summary');
        }
        if (individualEl) {
            individualEl.classList.toggle('hidden', this.view !== 'individual');
        }

        const summaryTab = document.getElementById('responsesSubtabSummary');
        const individualTab = document.getElementById('responsesSubtabIndividual');
        if (summaryTab) {
            summaryTab.classList.toggle('active', this.view === 'summary');
            summaryTab.setAttribute('aria-selected',
                this.view === 'summary' ? 'true' : 'false');
        }
        if (individualTab) {
            individualTab.classList.toggle('active', this.view === 'individual');
            individualTab.setAttribute('aria-selected',
                this.view === 'individual' ? 'true' : 'false');
        }

        if (this.view === 'individual') {
            this.renderIndividual();
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

    // ---- Renderer 1: pie (single choice) ------------------------

    /**
     * Google-Forms-style pie for single-choice questions: solid SVG
     * slices starting at 12 o'clock, clockwise, in option order, with a
     * legend that states every count + percentage in text.
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

        // Palette slot per entry (option order); the folded "Other" wears
        // neutral gray. CSS custom properties so dark mode re-colors free.
        const colorFor = (label, index) =>
            folded && label === 'Other' && index === entries.length - 1
                ? 'var(--viz-other)'
                : `var(--viz-${(index % PIE_MAX_SLICES) + 1})`;

        const wrap = document.createElement('div');
        wrap.className = 'responses-pie';

        // --- The pie itself ---
        const SIZE = 160;
        const RADIUS = 72;
        const CENTER = SIZE / 2;
        const NS = 'http://www.w3.org/2000/svg';

        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
        svg.setAttribute('width', SIZE);
        svg.setAttribute('height', SIZE);
        svg.setAttribute('role', 'img');
        svg.setAttribute('class', 'responses-pie-chart');
        svg.setAttribute('aria-label',
            `Answer distribution for ${question.label || question.key}`);

        let angle = -Math.PI / 2;   // start at 12 o'clock
        entries.forEach(([label, count], index) => {
            const fill = colorFor(label, index);
            const fraction = count / grandTotal;

            // A 360° arc is geometrically impossible — a full pie is a circle.
            if (fraction >= 0.9999) {
                const circle = document.createElementNS(NS, 'circle');
                circle.setAttribute('cx', CENTER);
                circle.setAttribute('cy', CENTER);
                circle.setAttribute('r', RADIUS);
                circle.style.fill = fill;
                svg.appendChild(circle);
                return;
            }

            const end = angle + fraction * 2 * Math.PI;
            const x1 = CENTER + RADIUS * Math.cos(angle);
            const y1 = CENTER + RADIUS * Math.sin(angle);
            const x2 = CENTER + RADIUS * Math.cos(end);
            const y2 = CENTER + RADIUS * Math.sin(end);
            const largeArc = fraction > 0.5 ? 1 : 0;

            const slice = document.createElementNS(NS, 'path');
            slice.setAttribute('d',
                `M ${CENTER} ${CENTER} L ${x1.toFixed(3)} ${y1.toFixed(3)} ` +
                `A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ` +
                `${x2.toFixed(3)} ${y2.toFixed(3)} Z`);
            slice.style.fill = fill;
            // The stroke IS the gap: a 2px ring in the card surface color
            // separates adjacent slices without borders on the marks.
            slice.setAttribute('stroke', 'var(--bg-secondary)');
            slice.setAttribute('stroke-width', '2');
            svg.appendChild(slice);

            angle = end;
        });

        // --- The legend (every value in text — nothing hover-gated) ---
        const legend = document.createElement('div');
        legend.className = 'responses-pie-legend';

        entries.forEach(([label, count], index) => {
            const row = document.createElement('div');
            row.className = 'responses-pie-legend-row';

            const swatch = document.createElement('span');
            swatch.className = 'responses-pie-swatch';
            swatch.style.background = colorFor(label, index);

            const labelEl = document.createElement('span');
            labelEl.className = 'responses-pie-legend-label';
            labelEl.textContent = label;

            const valueEl = document.createElement('span');
            valueEl.className = 'responses-pie-legend-value';
            const percent = Math.round((count / grandTotal) * 100);
            valueEl.textContent = `${count} (${percent}%)`;

            row.appendChild(swatch);
            row.appendChild(labelEl);
            row.appendChild(valueEl);
            legend.appendChild(row);
        });

        wrap.appendChild(svg);
        wrap.appendChild(legend);
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

        return this.buildBarMeter([['Yes', yes], ['No', no]]);
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
        return this.buildBarMeter(pairs);
    }

    /**
     * The shared bar-meter DOM: one thin accent bar per [label, count],
     * scaled against the biggest count, value printed beside the bar.
     * @param {Array<[string, number]>} pairs
     * @returns {HTMLElement}
     */
    buildBarMeter(pairs) {
        const wrap = document.createElement('div');
        wrap.className = 'responses-choice';

        const maxCount = pairs.length > 0 ? pairs[0][1] : 0;

        for (const [label, count] of pairs) {
            const row = document.createElement('div');
            row.className = 'responses-choice-row';

            const labelEl = document.createElement('span');
            labelEl.className = 'responses-choice-label';
            labelEl.textContent = label;

            const barLine = document.createElement('div');
            barLine.className = 'responses-choice-bar-line';

            const meter = document.createElement('div');
            meter.className = 'responses-meter';

            const fill = document.createElement('div');
            fill.className = 'responses-meter-fill';
            const width = maxCount === 0 ? 0 : (count / maxCount) * 100;
            fill.style.width = `${width}%`;

            const countEl = document.createElement('span');
            countEl.className = 'responses-choice-count';
            countEl.textContent = count;

            meter.appendChild(fill);
            barLine.appendChild(meter);
            barLine.appendChild(countEl);
            row.appendChild(labelEl);
            row.appendChild(barLine);
            wrap.appendChild(row);
        }

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
