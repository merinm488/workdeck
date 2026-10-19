/**
 * ================================================
 * KANBAN - Board Controller (DHTMLX Kanban wiring)
 * ================================================
 *
 */

const KANBAN_SAVE_EVENTS = [
    'add-card', 'update-card', 'move-card', 'delete-card', 'duplicate-card',
    'add-column', 'update-column', 'move-column', 'delete-column',
    'add-row', 'update-row', 'move-row', 'delete-row',
    'add-comment', 'update-comment', 'delete-comment',
    'add-vote', 'delete-vote', 'add-link', 'delete-link',
    'undo', 'redo'
];

const CARD_FIELDS = ['label', 'description', 'row', 'priority', 'color', 'progress',
    'start_date', 'end_date', 'css', 'createdAt'];

class BoardController {
    constructor() {
        this.board = null;
        this.userDoc = null;
        this.widget = null;
        this.toolbar = null;
        this.api = null;
        this.saveTimer = null;
        this.saving = false;
        this.checklistCardId = null;
    }

    async open(boardId, userDoc) {
        this.board = (userDoc.kanban || []).find(b => b && b.id === boardId);
        this.userDoc = userDoc;
        if (!this.board) return false;

        // Cards referencing deleted columns would be dropped by the widget
        const firstColumn = (this.board.columns && this.board.columns[0]) || null;
        (this.board.cards || []).forEach(c => {
            if (!c.column || !this.board.columns.some(col => col.id === c.column)) {
                c.column = firstColumn ? firstColumn.id : c.column;
            }
        });

        document.getElementById('pageTitle').textContent = this.board.name;
        this.bumpLastOpened();

        this.initWidget();
        return true;
    }

    initWidget() {
        const Widget = window.kanban;
        const mount = document.getElementById('boardRoot');

        this.widget = new Widget.Kanban(mount, {
            cards: this.board.cards || [],
            columns: this.board.columns || [],
            rows: this.board.rows || [],
            links: this.board.links || [],
            currentUser: APP_CONFIG.currentUser.id,
            history: true,
            theme: { name: 'material', fonts: false },
            cardShape: {
                label: true,
                progress: { show: true },
                priority: { show: true, values: APP_CONFIG.priorities },
                color: { show: true },
                end_date: true,
                users: false,
                cover: false,
                menu: {
                    show: true,
                    items: (ctx) => this.cardMenuItems(ctx)
                }
            },
            columnShape: {
                menu: {
                    show: true,
                    items: (ctx) => this.columnMenuItems(ctx)
                }
            },
            editorShape: [
                { type: 'text', key: 'label', label: 'Title' },
                { type: 'textarea', key: 'description', label: 'Description' },
                { type: 'select', key: 'priority', label: 'Priority', values: APP_CONFIG.priorities },
                { type: 'date', key: 'end_date', label: 'Due date' },
                { type: 'color', key: 'color', label: 'Color' },
                { type: 'comments', key: 'comments', label: 'Comments', placement: 'editor' }
            ],
            editor: { placement: 'modal' }
        });
        this.api = this.widget.api;

        this.toolbar = new Widget.Toolbar(document.getElementById('boardToolbar'), {
            api: this.api
        });

        KANBAN_SAVE_EVENTS.forEach(ev => {
            try {
                this.api.on(ev, () => this.scheduleSave());
            } catch (err) { /* event not in this version's bus */ }
        });
        try {
            this.api.on('checklist', (payload) => this.openChecklist(payload));
            this.api.on('wip-limit', (payload) => this.openWipLimit(payload));
        } catch (err) {
            console.error('[BOARD] Custom menu events unavailable:', err);
        }
    }

    cardMenuItems(ctx) {
        const multi = ctx && Array.isArray(ctx.selected) && ctx.selected.length > 1;
        const items = [];
        if (!multi) {
            items.push({ id: 'set-edit', icon: 'wxi-edit-outline', text: 'Edit' });
            items.push({ id: 'checklist', icon: 'wxi-check', text: 'Checklist' });
        }
        items.push({ id: 'duplicate-card', icon: 'wxi-content-copy', text: 'Duplicate' });
        items.push({ id: 'delete-card', icon: 'wxi-delete-outline', text: 'Delete' });
        return items;
    }

    columnMenuItems(ctx) {
        return [
            { id: 'add-card', icon: 'wxi-plus', text: 'Add card' },
            { id: 'set-edit', icon: 'wxi-rename', text: 'Rename' },
            { id: 'wip-limit', icon: 'wxi-alert', text: 'WIP limit' },
            { id: 'move-column:up', icon: 'wxi-angle-up', text: 'Move up' },
            { id: 'move-column:down', icon: 'wxi-angle-down', text: 'Move down' },
            { id: 'delete-column', icon: 'wxi-delete-outline', text: 'Delete' }
        ];
    }

    // ================================================
    // Persistence
    // ================================================

    scheduleSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(), 800);
    }

    async save() {
        if (!this.widget || !this.board || this.saving) return;
        this.saving = true;
        try {
            const state = this.widget.serialize();
            const record = {
                name: this.board.name,
                columns: (state.columns || []).map(c => this.sanitizeColumn(c)),
                rows: (state.rows || []).map(r => this.sanitizeRow(r)),
                cards: (state.cards || []).map(c => this.sanitizeCard(c)),
                links: state.links || []
            };
            const ok = await kanbanStorage.saveBoard({ id: this.board.id, ...record });
            if (ok) {
                Object.assign(this.board, record);
            } else {
                showNotification('Save failed — changes kept locally', 'error');
            }
        } finally {
            this.saving = false;
        }
    }

    sanitizeColumn(c) {
        const out = { id: c.id, label: c.label || 'Untitled' };
        if (c.limit !== undefined && c.limit !== null) out.limit = c.limit;
        if (c.strictLimit !== undefined) out.strictLimit = c.strictLimit;
        if (c.collapsed) out.collapsed = true;
        if (c.css) out.css = c.css;
        return out;
    }

    sanitizeRow(r) {
        const out = { id: r.id, label: r.label || 'Untitled' };
        if (r.collapsed) out.collapsed = true;
        if (r.css) out.css = r.css;
        return out;
    }

    sanitizeCard(c) {
        const out = { id: c.id, column: c.column, checklist: [] };
        CARD_FIELDS.forEach(k => {
            if (c[k] !== undefined && c[k] !== null && c[k] !== '') out[k] = c[k];
        });
        if (Array.isArray(c.checklist)) {
            out.checklist = c.checklist.map(i => ({ id: i.id, text: i.text, done: !!i.done }));
        }
        if (Array.isArray(c.comments) && c.comments.length) {
            out.comments = c.comments.map(m => ({
                id: m.id,
                cardId: m.cardId,
                userId: m.userId || APP_CONFIG.currentUser.id,
                text: m.text,
                date: m.date instanceof Date ? m.date.toISOString() : (m.date || new Date().toISOString())
            }));
        }
        if (Array.isArray(c.votes) && c.votes.length) out.votes = c.votes;
        if (Array.isArray(c.attached) && c.attached.length) out.attached = c.attached;
        if (!out.createdAt) out.createdAt = new Date().toISOString();
        return out;
    }

    bumpLastOpened() {
        if (!this.userDoc) return;
        const settings = this.userDoc.settings || {};
        const lastOpened = { ...(settings.lastOpened || {}) };
        lastOpened[this.board.id] = new Date().toISOString();
        kanbanStorage.saveSettings({ lastOpened }).catch(() => {});
    }

    // ================================================
    // Checklist dialog (the one feature the widget lacks)
    // ================================================

    resolveCard(payload) {
        if (payload && payload.card) return payload.card;
        if (payload && payload.cardId && this.api) {
            try { return this.api.getCard(payload.cardId); } catch (err) { /* fall through */ }
        }
        const sel = this.api ? this.api.getSelection() : [];
        if (sel.length) {
            try { return this.api.getCard(sel[sel.length - 1]); } catch (err) { /* fall through */ }
        }
        return null;
    }

    openChecklist(payload) {
        const card = this.resolveCard(payload);
        if (!card) return;
        this.checklistCardId = card.id;

        const modal = document.getElementById('checklistModal');
        modal.querySelector('#checklistCardTitle').textContent = card.label || 'Untitled card';
        this.renderChecklist(card);
        modal.classList.add('open');
        const input = modal.querySelector('#checklistNewItem');
        input.value = '';
        input.focus();
    }

    closeChecklist() {
        const modal = document.getElementById('checklistModal');
        modal.classList.remove('open');
        this.checklistCardId = null;
    }

    renderChecklist(card) {
        const modal = document.getElementById('checklistModal');
        const list = document.getElementById('checklistItems');
        list.innerHTML = '';
        const items = Array.isArray(card.checklist) ? card.checklist : [];

        items.forEach(item => {
            const row = document.getElementById('checklistItemTemplate')
                .content.firstElementChild.cloneNode(true);
            const check = row.querySelector('.checklist-check');
            const text = row.querySelector('.checklist-text');
            check.checked = !!item.done;
            text.value = item.text || '';
            text.classList.toggle('done', !!item.done);

            check.addEventListener('change', () => {
                item.done = check.checked;
                text.classList.toggle('done', !!item.done);
                this.syncChecklist(card);
            });
            text.addEventListener('input', () => {
                item.text = text.value;
                this.syncChecklist(card);
            });
            text.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    text.blur();
                }
            });
            row.querySelector('.checklist-delete').addEventListener('click', () => {
                card.checklist = card.checklist.filter(i => i.id !== item.id);
                this.syncChecklist(card);
                this.renderChecklist(card);
            });
            list.appendChild(row);
        });

        const done = items.filter(i => i.done).length;
        const pct = items.length ? Math.round((done / items.length) * 100) : 0;
        modal.querySelector('#checklistProgress').value = pct;
        modal.querySelector('#checklistStats').textContent =
            items.length ? `${done} / ${items.length}` : 'No items yet';
    }

    // Write checklist back to the card; progress bar mirrors completion
    syncChecklist(card) {
        const items = card.checklist || [];
        const done = items.filter(i => i.done).length;
        const progress = items.length ? Math.round((done / items.length) * 100) : 0;
        this.api.exec('update-card', { id: card.id, card: { checklist: items, progress } });
    }

    addChecklistItem() {
        const modal = document.getElementById('checklistModal');
        const input = modal.querySelector('#checklistNewItem');
        const text = input.value.trim();
        if (!text || !this.checklistCardId) return;

        let card;
        try { card = this.api.getCard(this.checklistCardId); } catch (err) { return; }
        if (!Array.isArray(card.checklist)) card.checklist = [];
        card.checklist.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            text,
            done: false
        });
        input.value = '';
        input.focus();
        this.syncChecklist(card);
        this.renderChecklist(card);
    }

    // ================================================
    // WIP limit dialog
    // ================================================

    openWipLimit(payload) {
        let columnId = null;
        if (payload && payload.column) columnId = payload.column.id;
        else if (payload && payload.columnId) columnId = payload.columnId;
        if (!columnId) return;

        let column;
        try {
            column = this.widget.serialize().columns.find(c => c.id === columnId);
        } catch (err) { return; }
        if (!column) return;

        const modal = document.getElementById('wipLimitModal');
        modal.querySelector('#wipLimitColumn').textContent = column.label || 'Column';
        const input = modal.querySelector('#wipLimitInput');
        input.value = column.limit != null ? column.limit : '';
        modal.classList.add('open');
        modal.dataset.columnId = columnId;
        input.focus();
    }

    closeWipLimit() {
        document.getElementById('wipLimitModal').classList.remove('open');
    }

    confirmWipLimit() {
        const modal = document.getElementById('wipLimitModal');
        const columnId = modal.dataset.columnId;
        const raw = modal.querySelector('#wipLimitInput').value.trim();
        const limit = raw === '' ? null : Math.max(1, parseInt(raw, 10) || 0);
        if (limit === 0) {
            this.closeWipLimit();
            return;
        }
        try {
            this.api.exec('update-column', { id: columnId, column: { limit } });
        } catch (err) {
            console.error('[BOARD] WIP limit update failed:', err);
        }
        this.closeWipLimit();
    }

    currentBoard() {
        return this.board;
    }

    destroy() {
        clearTimeout(this.saveTimer);
        if (this.widget) this.widget.destructor();
        if (this.toolbar) this.toolbar.destructor();
        this.widget = null;
        this.toolbar = null;
        this.api = null;
    }
}

const boardController = new BoardController();

if (typeof window !== 'undefined') {
    window.KanbanBoard = boardController;
    if (typeof showNotification === 'undefined') {
        window.showNotification = function () { };
    }
}