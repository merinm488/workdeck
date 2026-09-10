/**
 * ================================================
 * FORMS - Responses Summary (editor.html "Responses" tab)
 * ================================================
 * Google-Forms-style summary for the OWNER of a form. Lives on the editor
 * page, next to the builder.
 *
 * DATA SOURCE
 *   formsStorage.getResponses(formId)  ->  { responses: [...], form: {...} }
 *
 *   - `form`      = the SHARED snapshot: the exact questions responders saw
 *   - `responses` = array of submissions, oldest first (as stored), each:
 *       {
 *         id: 'mtm...',                          (added by the API)
 *         submittedAt: '2026-09-09T04:42:53.908Z', (added by the API)
 *         data: { questionKey: answer, ... },    (the answers)
 *         meta: { userAgent: '...' }
 *       }
 *
 * WHAT WE RENDER, PER QUESTION
 *   Choice-like  (radio, select, checkbox, checklist, taglist) -> per-option bar meter
 *   Text-like    (textfield, textarea, ...)                    -> latest answers as chips
 *   Number                                                     -> Low / Average / High
 *
 * THE ONE FORM-JS DETAIL THIS FILE DEPENDS ON
 *   Every component has a `type` ('textfield', 'select', ...) and a `key`
 *   ('firstName', 'favoriteColor', ...). The `key` is the property name the
 *   answer is stored under in each response's `data` object. Questions can
 *   be NESTED (inside a Group / Dynamic list), so we walk the tree.
 *
 * =====================================================
 * DATVIZ NOTES (why the UI looks the way it does)
 * =====================================================
 * - Headline numbers (Total / Last submission) are STAT TILES — a number is
 *   not a chart.
 * - Answer options are NOMINAL categories (swapping "Red" and "Blue" changes
 *   nothing), so every bar wears the SAME hue: the app accent
 *   (--accent-color). Bar length already encodes the count; coloring each
 *   bar differently would spend the identity channel on nothing.
 * - Bars are thin (10px), 4px rounded data-end, square at the baseline
 *   (left edge), on a track tinted with the same ramp (--accent-light).
 * - Every value is visible in TEXT next to its bar — nothing is gated
 *   behind hover.
 * - DOM building: createElement + textContent only. Question labels are
 *   typed by the form owner and answer text is typed by strangers — never
 *   innerHTML for either.
 * =====================================================
 */

class FormsResponsesView {
    constructor() {
        this.formId = null;
        this.formRecord = null;   // SHARED snapshot of the form (questions)
        this.responses = [];      // submissions, oldest first (as stored)
        this.isLoading = false;
    }

    // ================================================
    // Public API (called by editor.js)
    // ================================================

    /**
     * Load + render the summary for one form.
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

        // 3. Set this.isLoading = true, call this.showState('loading'),
        //    then:
        //      const result = await formsStorage.getResponses(this.formId);
        this.isLoading = true;
        this.showState('loading');
        const result = await formsStorage.getResponses(this.formId);

        // 4. Failure: result === null -> set isLoading = false, surface the
        //    error through the editor's toast (editor.js exposes itself as
        //    window.formsEditorApp):
        //      window.formsEditorApp?.showError('Failed to load responses');
        //    then return false.
        if (result === null) {
            this.isLoading = false;
            window.formsEditorApp?.showError('Failed to load responses');
            return false;
        }

        // 5. Success: store what came back on `this` —
        //      this.responses = result.responses || [];
        //      this.formRecord = result.form || null;
        //    then isLoading = false, this.renderSummary(),
        //    this.showState('summary'), return true.
        this.responses = result.responses || [];
        this.formRecord = result.form || null;
        this.isLoading = false;
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

    // ================================================
    // State switching (loading / empty / summary / error)
    // ================================================

    /**
     * Show exactly ONE of the tab's states by toggling the 'hidden' class
     * on the containers defined in editor.html:
     *   'loading' -> #responsesLoading
     *   'empty'   -> #responsesEmpty      (zero responses)
     *   'summary' -> #responsesSummary    (>= 1 response)
     *   'error'   -> #responsesError
     * @param {'loading'|'empty'|'summary'|'error'} state
     */
    showState(state) {
        const map = {
            loading: 'responsesLoading',
            empty:   'responsesEmpty',
            summary: 'responsesSummary',
            error:   'responsesError'
        };
        
        for (const [stateName, elementId] of Object.entries(map)) {
            const el = document.getElementById(elementId);
            if (el) {
                el.classList.toggle('hidden', stateName !== state);
            }
        }

        // 2. When state === 'empty', fill in the empty-state copy. It reads
        //    differently depending on whether the form has ever been shared:
        //      - this.formRecord === null  (never shared):
        //          '#responsesEmptyTitle' -> 'No responses yet'
        //          '#responsesEmptyText'  ->
        //              'Share your form to start collecting responses.'
        //      - shared but zero responses:
        //          '#responsesEmptyTitle' -> 'No responses yet'
        //          '#responsesEmptyText'  ->
        //              'Your form is live and waiting for its first response.'
        //    (textContent, never innerHTML.)
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
    }

    // ================================================
    // Summary rendering
    // ================================================

    /**
     * Top of the tab: the two stat tiles.
     */
    renderStatTiles() {
        const countEl = document.getElementById('responsesCountValue');
        if (countEl) {
            countEl.textContent = this.responses.length;
        }

        const lastEl = document.getElementById('responsesLastValue');
        if (lastEl) {
            const last = this.responses[this.responses.length - 1];
            lastEl.textContent = this.formatRelativeTime(last?.submittedAt);
        }
    }

    /**
     * Main entry: the two tiles + one summary card per question.
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
            if (question.type === 'button' || question.type === 'hidden') {
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
    // Question tree walking
    // form-js nests questions inside groups/dynamic lists; we need the
    // flat, ordered list of input questions.
    // ================================================

    /**
     * Depth-first walk of the form-js component tree.
     * @param {Array} components - form-js components array
     * @returns {Array} every input component, in display order
     */
    flattenComponents(components) {
        const out = [];

        // A recursive helper — it calls itself for containers' children.
        const walk = (list) => {
            for (const c of list) {
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
     * All three renderers share the same signature: fn(question) -> DOM node.
     * They read the submissions themselves via this.responses.
     * @param {object} question - form-js component
     * @returns {Function} fn(question) -> DOM node
     */
    getRendererFor(question) {
        const t = question.type;

        if (t === 'radio' || t === 'select' || t === 'checklist' || t === 'taglist') {
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

        // 'number' -> return this.renderNumberStats.
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

        const wrap = document.createElement('div');
        wrap.className = 'responses-choice';

        const rows = [
            ['Yes', yes],
            ['No', no]
        ];
        const maxCount = Math.max(yes, no);

        for (const [label, count] of rows) {
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

    // ---- Renderer 1: choice bars ------------------------------

    /**
     * Tally answers for a choice question and render bar meters.
     * @param {object} question
     * @returns {HTMLElement}
     */
    renderChoiceBars(question) {

        const options = question.type === 'survey'
            ? question.values
            : question.data?.values;
        const counts = {};
        for (const option of options || []) {
            counts[option.label] = 0;
        }

        const bump = (label) => {
            if (counts[label] === undefined) {
                counts[label] = 0;   // 'Other' bucket, created on demand
            }
            counts[label] += 1;
        };

        // Submissions store the option's VALUE ('red'), but the bars are
        // keyed by the option's LABEL ('Red') — resolve one to the other
        // before tallying, or every answer lands in a phantom bucket and
        // the real rows all show 0. Matching the label too keeps older
        // submissions (or value===label options) tallying correctly.
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

        const pairs = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const maxCount = pairs.length > 0 ? pairs[0][1] : 0;

        const wrap = document.createElement('div');
        wrap.className = 'responses-choice';

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
            const width = maxCount === 0
                ? 0
                : (count / maxCount) * 100;
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
