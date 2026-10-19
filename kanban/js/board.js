/**
 * ================================================
 * KANBAN - Board Controller
 * ================================================
 *
 */

const CARD_FIELDS = ['label', 'description', 'row', 'priority', 'color', 'progress',
    'end_date', 'createdAt'];

const CARD_COLORS = [
    '#2563eb', '#7c3aed', '#c026d3', '#dc2626', '#ea580c',
    '#b45309', '#16a34a', '#0d9488', '#0891b2', '#64748b'
];

// Tile/canvas colors, assigned per board from its id (stable, no storage)
const BOARD_COLORS = [
    '#2563eb', '#7c3aed', '#c026d3', '#dc2626', '#ea580c',
    '#b45309', '#16a34a', '#0d9488', '#0891b2', '#475569'
];

function kbBoardColor(board) {
    const id = String((board && board.id) || '');
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return BOARD_COLORS[h % BOARD_COLORS.length];
}

function kbNewId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function kbClone(id) {
    return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function kbParseDate(value) {
    if (!value) return null;
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
    if (!m) return null;
    const d = new Date(m[1] + 'T00:00:00');
    return isNaN(d) ? null : d;
}

class BoardController {
    constructor() {
        this.board = null;
        this.userDoc = null;
        this.saveTimer = null;
        this.saving = false;
        this.checklistCardId = null;
        this.editingCardId = null;
        this.sortables = [];
        this.searchQuery = '';
        this._chromeWired = false;
        this._modalWired = false;
        this._toolbarWired = false;
    }

    open(boardId, userDoc) {
        this.board = (userDoc.kanban || []).find(b => b && b.id === boardId);
        this.userDoc = userDoc;
        if (!this.board) return false;

        this.board.columns = this.board.columns || [];
        this.board.rows = this.board.rows || [];
        this.board.cards = this.board.cards || [];

        // Cards referencing deleted columns/lanes would vanish on save;
        // in a swimlane board, rowless (legacy) cards go to the first lane
        const firstColumn = this.board.columns[0] || null;
        const firstRow = this.board.rows.length ? this.board.rows[0].id : null;
        this.board.cards.forEach(c => {
            if (!c.column || !this.board.columns.some(col => col.id === c.column)) {
                c.column = firstColumn ? firstColumn.id : c.column;
            }
            if (firstRow) {
                if (!c.row || !this.board.rows.some(r => r.id === c.row)) c.row = firstRow;
            } else if (c.row) {
                delete c.row;
            }
        });

        document.getElementById('pageTitle').textContent = this.board.name;
        document.getElementById('boardRoot').style.setProperty('--board-accent', kbBoardColor(this.board));
        this.bumpLastOpened();

        this.wireChrome();
        this.wireCardModal();
        this.render();
        return true;
    }

    // ================================================
    // Rendering
    // ================================================

    render() {
        this.destroySortables();
        const root = document.getElementById('boardRoot');
        root.innerHTML = '';

        if (this.board.rows.length) {
            this.board.rows.forEach(row => {
                const lane = kbClone('kbLaneTemplate');
                lane.dataset.rowId = row.id;
                lane.classList.toggle('collapsed', !!row.collapsed);
                lane.querySelector('.kb-lane-title').textContent = row.label || 'Untitled';
                lane.querySelector('.kb-lane-collapse').addEventListener('click', () => {
                    row.collapsed = !row.collapsed;
                    this.render();
                    this.scheduleSave();
                });
                this.fillLane(lane, row.id);
                root.appendChild(lane);
            });
        } else {
            const lane = kbClone('kbLaneTemplate');
            lane.classList.add('single');
            this.fillLane(lane, null);
            root.appendChild(lane);
        }

        root.appendChild(this.buildAddColumn());
        this.wireSortables();
        this.applyFilter();
    }

    fillLane(lane, rowId) {
        const wrap = lane.querySelector('.kb-lane-cols');
        this.board.columns.forEach(col => wrap.appendChild(this.buildColumn(col, rowId)));
    }

    cardsIn(columnId, rowId) {
        return this.board.cards.filter(c =>
            c.column === columnId && (rowId ? c.row === rowId : !c.row));
    }

    getCard(id) {
        return this.board.cards.find(c => c.id === id) || null;
    }

    buildColumn(col, rowId) {
        const el = kbClone('kbColumnTemplate');
        el.dataset.columnId = col.id;
        const collapsed = !!col.collapsed;
        el.classList.toggle('collapsed', collapsed);

        const title = el.querySelector('.kb-col-title');
        title.textContent = col.label || 'Untitled';
        title.addEventListener('click', () => {
            if (collapsed) {
                col.collapsed = false;
                this.render();
                this.scheduleSave();
                return;
            }
            openNameModal('Rename Column', col.label, (name) => {
                col.label = name;
                this.render();
                this.scheduleSave();
            });
        });
        title.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                title.click();
            }
        });

        el.querySelector('.kb-col-collapse').addEventListener('click', () => {
            col.collapsed = !col.collapsed;
            this.render();
            this.scheduleSave();
        });

        el.querySelector('.kb-col-menu-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.openMenu(e.currentTarget, 'kbColumnMenuTemplate', (action) => {
                this.columnAction(action, col.id);
            });
        });

        const cardsWrap = el.querySelector('.kb-col-cards');
        this.cardsIn(col.id, rowId).forEach(card => cardsWrap.appendChild(this.buildCard(card)));

        const addBtn = el.querySelector('.kb-col-add');
        const composer = el.querySelector('.kb-col-composer');
        const input = composer.querySelector('.kb-composer-input');
        const submit = () => {
            const text = input.value.trim();
            if (!text) return;
            const node = this.buildCard(this.createCard(col.id, rowId, text));
            cardsWrap.appendChild(node);
            this.updateColumnCount(el, col, rowId);
            this.applyFilter();
            this.scheduleSave();
            input.value = '';
            input.focus();
        };
        addBtn.addEventListener('click', () => {
            composer.classList.remove('hidden');
            addBtn.classList.add('hidden');
            input.focus();
        });
        composer.querySelector('.kb-composer-cancel').addEventListener('click', () => {
            composer.classList.add('hidden');
            addBtn.classList.remove('hidden');
            input.value = '';
        });
        composer.querySelector('.kb-composer-add').addEventListener('click', submit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
            if (e.key === 'Escape') {
                e.stopPropagation();
                composer.classList.add('hidden');
                addBtn.classList.remove('hidden');
                input.value = '';
            }
        });

        this.updateColumnCount(el, col, rowId);
        return el;
    }

    createCard(columnId, rowId, text) {
        const card = { id: kbNewId(), label: text, column: columnId, createdAt: new Date().toISOString() };
        if (rowId) card.row = rowId;
        this.board.cards.push(card);
        return card;
    }

    updateColumnCount(colEl, col, rowId) {
        const n = this.cardsIn(col.id, rowId).length;
        const badge = colEl.querySelector('.kb-col-count');
        badge.textContent = col.limit ? `${n}/${col.limit}` : String(n);
        badge.classList.toggle('limit', !!col.limit && n >= col.limit);
        badge.classList.toggle('over', !!col.limit && n > col.limit);
    }

    refreshCounts() {
        document.querySelectorAll('#boardRoot .kb-col').forEach(el => {
            const col = this.board.columns.find(c => c.id === el.dataset.columnId);
            if (!col) return;
            const lane = el.closest('.kb-lane');
            this.updateColumnCount(el, col, lane.dataset.rowId || null);
        });
    }

    buildCard(card) {
        const el = kbClone('kbCardTemplate');
        el.dataset.cardId = card.id;

        const strip = el.querySelector('.kb-card-color');
        if (card.color) {
            strip.style.background = card.color;
            strip.classList.remove('hidden');
        }

        el.querySelector('.kb-card-title').textContent = card.label || 'Untitled';

        const desc = el.querySelector('.kb-card-desc');
        if (card.description) {
            desc.textContent = card.description;
            desc.classList.remove('hidden');
        }

        const pri = (APP_CONFIG.priorities || []).find(p => p.id === card.priority);
        const priChip = el.querySelector('.chip-priority');
        if (pri) {
            priChip.textContent = pri.label;
            priChip.style.setProperty('--chip-color', pri.color);
            priChip.classList.remove('hidden');
        }

        const dueChip = el.querySelector('.chip-due');
        const date = kbParseDate(card.end_date);
        if (date) {
            dueChip.querySelector('span').textContent =
                date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            dueChip.classList.toggle('overdue', date < today);
            dueChip.classList.remove('hidden');
        }

        const checkChip = el.querySelector('.chip-check');
        if (Array.isArray(card.checklist) && card.checklist.length) {
            const done = card.checklist.filter(i => i.done).length;
            checkChip.querySelector('span').textContent = `${done}/${card.checklist.length}`;
            checkChip.classList.remove('hidden');
        }

        const commChip = el.querySelector('.chip-comments');
        if (Array.isArray(card.comments) && card.comments.length) {
            commChip.querySelector('span').textContent = String(card.comments.length);
            commChip.classList.remove('hidden');
        }

        el.addEventListener('click', () => this.openCardModal(card.id));
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openCardModal(card.id);
            }
        });
        el.querySelector('.kb-card-menu-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.openMenu(e.currentTarget, 'kbCardMenuTemplate', (action) => {
                this.cardAction(action, card.id);
            });
        });
        return el;
    }

    buildAddColumn() {
        const el = kbClone('kbAddColumnTemplate');
        const btn = el.querySelector('.kb-addcol-btn');
        const composer = el.querySelector('.kb-addcol-composer');
        const input = el.querySelector('.kb-addcol-input');
        const close = () => {
            composer.classList.add('hidden');
            input.value = '';
            btn.classList.remove('hidden');
        };
        btn.addEventListener('click', () => {
            btn.classList.add('hidden');
            composer.classList.remove('hidden');
            input.focus();
        });
        el.querySelector('.kb-addcol-cancel').addEventListener('click', close);
        el.querySelector('.kb-addcol-confirm').addEventListener('click', () => {
            const name = input.value.trim();
            if (!name) return;
            this.board.columns.push({ id: kbNewId(), label: name });
            this.render();
            this.scheduleSave();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                el.querySelector('.kb-addcol-confirm').click();
            }
            if (e.key === 'Escape') {
                e.stopPropagation();
                close();
            }
        });
        return el;
    }

    // ================================================
    // Drag & drop
    // ================================================

    wireSortables() {
        if (typeof Sortable === 'undefined') return;
        document.querySelectorAll('#boardRoot .kb-col-cards').forEach(list => {
            this.sortables.push(new Sortable(list, {
                group: 'kb-cards',
                animation: 150,
                ghostClass: 'kb-ghost',
                dragClass: 'kb-drag',
                scroll: true,
                bubbleScroll: true,
                onEnd: (evt) => this.onCardDrop(evt)
            }));
        });
        document.querySelectorAll('#boardRoot .kb-lane-cols').forEach(wrap => {
            this.sortables.push(new Sortable(wrap, {
                group: 'kb-cols',
                animation: 150,
                handle: '.kb-col-head',
                ghostClass: 'kb-ghost-col',
                onEnd: (evt) => this.onColumnDrop(evt)
            }));
        });
    }

    destroySortables() {
        this.sortables.forEach(s => {
            try { s.destroy(); } catch (err) { /* already gone */ }
        });
        this.sortables = [];
    }

    onCardDrop(evt) {
        const colEl = evt.to.closest('.kb-col');
        const col = colEl && this.board.columns.find(c => c.id === colEl.dataset.columnId);
        if (col && col.limit && evt.to.children.length > col.limit) {
            evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex] || null);
            showNotification(`"${col.label}" is at its WIP limit`, 'error');
            return;
        }
        this.syncCardsFromDom();
        this.refreshCounts();
        this.scheduleSave();
    }

    onColumnDrop(evt) {
        const wrap = evt.to;
        const order = [...wrap.querySelectorAll('.kb-col')].map(el => el.dataset.columnId);
        this.board.columns.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        // Other lanes share the column order — realign, but outside the drop event
        setTimeout(() => this.render(), 0);
        this.scheduleSave();
    }

    syncCardsFromDom() {
        const byId = new Map(this.board.cards.map(c => [c.id, c]));
        const ordered = [];
        document.querySelectorAll('#boardRoot .kb-col-cards').forEach(list => {
            const colEl = list.closest('.kb-col');
            const lane = list.closest('.kb-lane');
            const rowId = (this.board.rows.length && lane.dataset.rowId) || null;
            list.querySelectorAll('.kb-card').forEach(node => {
                const card = byId.get(node.dataset.cardId);
                if (!card) return;
                card.column = colEl.dataset.columnId;
                if (rowId) card.row = rowId; else delete card.row;
                ordered.push(card);
            });
        });
        this.board.cards = ordered;
    }

    // ================================================
    // Menus
    // ================================================

    openMenu(anchor, templateId, onAction) {
        this.closeMenu();
        const menu = document.getElementById('kbMenu');
        menu.innerHTML = '';
        menu.appendChild(document.getElementById(templateId).content.cloneNode(true));
        menu.querySelectorAll('.kb-menu-item').forEach(btn => {
            btn.addEventListener('click', () => {
                this.closeMenu();
                onAction(btn.dataset.action);
            });
        });
        menu.classList.remove('hidden');
        const r = anchor.getBoundingClientRect();
        let x = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
        let y = r.bottom + 6;
        if (y + menu.offsetHeight > window.innerHeight - 8) y = Math.max(8, r.top - menu.offsetHeight - 6);
        menu.style.left = Math.max(8, x) + 'px';
        menu.style.top = y + 'px';
    }

    closeMenu() {
        document.getElementById('kbMenu').classList.add('hidden');
    }

    cardAction(action, cardId) {
        if (action === 'edit') this.openCardModal(cardId);
        if (action === 'checklist') this.openChecklist({ cardId });
        if (action === 'duplicate') this.duplicateCard(cardId);
        if (action === 'delete') {
            const card = this.getCard(cardId);
            openConfirm('Delete Card', `"${card.label || 'Untitled'}" will be deleted. This cannot be undone.`, () => {
                this.board.cards = this.board.cards.filter(c => c.id !== cardId);
                if (this.editingCardId === cardId) this.closeCardModal();
                this.render();
                this.scheduleSave();
            });
        }
    }

    columnAction(action, columnId) {
        const col = this.board.columns.find(c => c.id === columnId);
        if (!col) return;
        if (action === 'add-card') {
            const colEl = document.querySelector(`#boardRoot .kb-col[data-column-id="${CSS.escape(columnId)}"]`);
            if (colEl) colEl.querySelector('.kb-col-add').click();
        }
        if (action === 'rename') {
            openNameModal('Rename Column', col.label, (name) => {
                col.label = name;
                this.render();
                this.scheduleSave();
            });
        }
        if (action === 'wip') this.openWipLimit({ columnId });
        if (action === 'move-left') this.moveColumn(columnId, -1);
        if (action === 'move-right') this.moveColumn(columnId, 1);
        if (action === 'delete') {
            const count = this.board.cards.filter(c => c.column === columnId).length;
            openConfirm('Delete Column',
                `"${col.label}"${count ? ` and ${count} card${count === 1 ? '' : 's'}` : ''} will be deleted. This cannot be undone.`,
                () => {
                    this.board.columns = this.board.columns.filter(c => c.id !== columnId);
                    this.board.cards = this.board.cards.filter(c => c.column !== columnId);
                    this.render();
                    this.scheduleSave();
                });
        }
    }

    moveColumn(columnId, delta) {
        const i = this.board.columns.findIndex(c => c.id === columnId);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= this.board.columns.length) return;
        const [col] = this.board.columns.splice(i, 1);
        this.board.columns.splice(j, 0, col);
        this.render();
        this.scheduleSave();
    }

    duplicateCard(cardId) {
        const card = this.getCard(cardId);
        if (!card) return;
        const copy = { ...card, id: kbNewId(), label: (card.label || 'Untitled') + ' (copy)' };
        if (Array.isArray(card.checklist)) {
            copy.checklist = card.checklist.map(i => ({ ...i }));
        }
        if (Array.isArray(card.comments)) {
            copy.comments = card.comments.map(m => ({ ...m }));
        }
        const i = this.board.cards.findIndex(c => c.id === cardId);
        this.board.cards.splice(i + 1, 0, copy);
        this.render();
        this.scheduleSave();
    }

    // ================================================
    // Card editor modal (live-applies on every change)
    // ================================================

    wireCardModal() {
        if (this._modalWired) return;
        this._modalWired = true;

        const sel = document.getElementById('cardPrioritySelect');
        (APP_CONFIG.priorities || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.label;
            sel.appendChild(opt);
        });

        const row = document.getElementById('cardColorRow');
        CARD_COLORS.forEach(color => {
            const sw = kbClone('kbSwatchTemplate');
            sw.style.background = color;
            sw.dataset.color = color;
            sw.title = color;
            row.appendChild(sw);
        });
        row.addEventListener('click', (e) => {
            const sw = e.target.closest('.card-swatch');
            if (!sw) return;
            this.applyCardEdits({ color: sw.dataset.color || null });
            this.syncSwatches(sw.dataset.color || '');
        });

        document.getElementById('cardTitleInput').addEventListener('input', (e) => {
            this.applyCardEdits({ label: e.target.value });
        });
        document.getElementById('cardDescInput').addEventListener('input', (e) => {
            this.applyCardEdits({ description: e.target.value });
        });
        document.getElementById('cardPrioritySelect').addEventListener('change', (e) => {
            this.applyCardEdits({ priority: e.target.value });
        });
        document.getElementById('cardDueInput').addEventListener('change', (e) => {
            this.applyCardEdits({ end_date: e.target.value });
        });
        document.getElementById('cardModalClose').addEventListener('click', () => this.closeCardModal());
        document.getElementById('cardDoneBtn').addEventListener('click', () => this.closeCardModal());
        document.getElementById('cardDeleteBtn').addEventListener('click', () => {
            if (this.editingCardId) this.cardAction('delete', this.editingCardId);
        });
        document.getElementById('cardDuplicateBtn').addEventListener('click', () => {
            if (!this.editingCardId) return;
            this.duplicateCard(this.editingCardId);
            this.closeCardModal();
        });
        document.getElementById('cardChecklistBtn').addEventListener('click', () => {
            if (this.editingCardId) this.openChecklist({ cardId: this.editingCardId });
        });

        const addComment = () => {
            const input = document.getElementById('cardCommentInput');
            const text = input.value.trim();
            const card = this.editingCard();
            if (!text || !card) return;
            if (!Array.isArray(card.comments)) card.comments = [];
            card.comments.push({
                id: kbNewId(),
                cardId: card.id,
                userId: APP_CONFIG.currentUser.id,
                text,
                date: new Date().toISOString()
            });
            input.value = '';
            input.focus();
            this.renderComments(card);
            this.patchCardNode(card);
            this.scheduleSave();
        };
        document.getElementById('cardCommentAdd').addEventListener('click', addComment);
        document.getElementById('cardCommentInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addComment();
            }
        });
    }

    editingCard() {
        return this.editingCardId ? this.getCard(this.editingCardId) : null;
    }

    applyCardEdits(patch) {
        const card = this.editingCard();
        if (!card) return;
        Object.keys(patch).forEach(k => {
            if (patch[k] === null || patch[k] === '') delete card[k];
            else card[k] = patch[k];
        });
        this.patchCardNode(card);
        this.scheduleSave();
    }

    patchCardNode(card) {
        const node = document.querySelector(`#boardRoot .kb-card[data-card-id="${CSS.escape(card.id)}"]`);
        if (node) node.replaceWith(this.buildCard(card));
    }

    syncSwatches(color) {
        document.querySelectorAll('#cardColorRow .card-swatch').forEach(sw => {
            sw.classList.toggle('active', (sw.dataset.color || '') === (color || ''));
        });
    }

    openCardModal(cardId) {
        const card = this.getCard(cardId);
        if (!card) return;
        this.editingCardId = cardId;
        document.getElementById('cardTitleInput').value = card.label || '';
        document.getElementById('cardDescInput').value = card.description || '';
        document.getElementById('cardPrioritySelect').value = card.priority || '';
        document.getElementById('cardDueInput').value = card.end_date ? String(card.end_date).slice(0, 10) : '';
        this.syncSwatches(card.color || '');
        this.renderChecklistSummary(card);
        this.renderComments(card);
        document.getElementById('cardModal').classList.add('open');
        document.getElementById('cardTitleInput').focus();
    }

    closeCardModal() {
        document.getElementById('cardModal').classList.remove('open');
        this.editingCardId = null;
    }

    renderChecklistSummary(card) {
        const items = Array.isArray(card.checklist) ? card.checklist : [];
        const done = items.filter(i => i.done).length;
        const pct = items.length ? Math.round((done / items.length) * 100) : 0;
        document.getElementById('cardChecklistProgress').value = pct;
        document.getElementById('cardChecklistStats').textContent =
            items.length ? `${done} / ${items.length}` : 'No items';
    }

    renderComments(card) {
        const list = document.getElementById('cardCommentsList');
        list.innerHTML = '';
        (card.comments || []).forEach(m => {
            const row = kbClone('kbCommentTemplate');
            const d = new Date(m.date || Date.now());
            row.querySelector('.card-comment-date').textContent = !isNaN(d)
                ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
                  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                : '';
            row.querySelector('.card-comment-text').textContent = m.text || '';
            list.appendChild(row);
        });
    }

    // ================================================
    // Board toolbar (card filter)
    // ================================================

    wireChrome() {
        if (this._chromeWired) return;
        this._chromeWired = true;

        document.addEventListener('click', (e) => {
            const menu = document.getElementById('kbMenu');
            if (!menu.classList.contains('hidden') && !menu.contains(e.target)) this.closeMenu();
        });

        if (this._toolbarWired) return;
        this._toolbarWired = true;
        const input = document.getElementById('boardSearchInput');
        if (!input) return;
        input.addEventListener('input', () => {
            this.searchQuery = input.value;
            this.applyFilter();
        });
        document.getElementById('boardSearchClear').addEventListener('click', () => {
            input.value = '';
            this.searchQuery = '';
            this.applyFilter();
        });
    }

    applyFilter() {
        const q = this.searchQuery.toLowerCase().trim();
        let visible = 0;
        let total = 0;
        document.querySelectorAll('#boardRoot .kb-card').forEach(node => {
            total++;
            const card = this.getCard(node.dataset.cardId);
            const match = !q || (card && ((card.label || '').toLowerCase().includes(q) ||
                (card.description || '').toLowerCase().includes(q)));
            node.classList.toggle('filtered-out', !match);
            if (match) visible++;
        });
        const count = document.getElementById('boardCardCount');
        if (count) {
            count.textContent = q
                ? `${visible} / ${total} card${total === 1 ? '' : 's'}`
                : `${total} card${total === 1 ? '' : 's'}`;
        }
        const clear = document.getElementById('boardSearchClear');
        if (clear) clear.classList.toggle('hidden', !q);
    }

    // ================================================
    // Persistence
    // ================================================

    scheduleSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(), 800);
    }

    async save() {
        if (!this.board) return;
        if (this.saving) {
            // A change landed mid-save; don't drop it
            this.scheduleSave();
            return;
        }
        this.saving = true;
        try {
            // The live model is the source of truth — sanitize() builds a
            // persistence copy and must never be assigned back into it
            const record = {
                name: this.board.name,
                columns: this.board.columns.map(c => this.sanitizeColumn(c)),
                rows: (this.board.rows || []).map(r => this.sanitizeRow(r)),
                cards: this.board.cards.map(c => this.sanitizeCard(c)),
                links: this.board.links || []
            };
            const ok = await kanbanStorage.saveBoard({ id: this.board.id, ...record });
            if (!ok) {
                showNotification('Save failed — changes kept locally', 'error');
            }
        } finally {
            this.saving = false;
        }
    }

    sanitizeColumn(c) {
        const out = { id: c.id, label: c.label || 'Untitled' };
        if (c.limit !== undefined && c.limit !== null) out.limit = c.limit;
        if (c.collapsed) out.collapsed = true;
        return out;
    }

    sanitizeRow(r) {
        const out = { id: r.id, label: r.label || 'Untitled' };
        if (r.collapsed) out.collapsed = true;
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
    // Checklist dialog
    // ================================================

    resolveCard(payload) {
        if (payload && payload.cardId) return this.getCard(payload.cardId);
        return this.editingCard();
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

    syncChecklist(card) {
        const items = card.checklist || [];
        const done = items.filter(i => i.done).length;
        card.progress = items.length ? Math.round((done / items.length) * 100) : 0;
        if (this.editingCardId === card.id) this.renderChecklistSummary(card);
        this.patchCardNode(card);
        this.scheduleSave();
    }

    addChecklistItem() {
        const modal = document.getElementById('checklistModal');
        const input = modal.querySelector('#checklistNewItem');
        const text = input.value.trim();
        if (!text || !this.checklistCardId) return;

        const card = this.getCard(this.checklistCardId);
        if (!card) return;
        if (!Array.isArray(card.checklist)) card.checklist = [];
        card.checklist.push({ id: kbNewId(), text, done: false });
        input.value = '';
        input.focus();
        this.syncChecklist(card);
        this.renderChecklist(card);
    }

    // ================================================
    // WIP limit dialog
    // ================================================

    openWipLimit(payload) {
        const columnId = payload && payload.columnId;
        const col = columnId && this.board.columns.find(c => c.id === columnId);
        if (!col) return;

        const modal = document.getElementById('wipLimitModal');
        modal.querySelector('#wipLimitColumn').textContent = col.label || 'Column';
        const input = modal.querySelector('#wipLimitInput');
        input.value = col.limit != null ? col.limit : '';
        modal.classList.add('open');
        modal.dataset.columnId = columnId;
        input.focus();
    }

    closeWipLimit() {
        document.getElementById('wipLimitModal').classList.remove('open');
    }

    confirmWipLimit() {
        const modal = document.getElementById('wipLimitModal');
        const col = this.board.columns.find(c => c.id === modal.dataset.columnId);
        if (col) {
            const raw = modal.querySelector('#wipLimitInput').value.trim();
            if (raw === '') delete col.limit;
            else {
                const limit = Math.max(1, parseInt(raw, 10) || 0);
                if (limit) col.limit = limit;
            }
            this.refreshCounts();
            this.scheduleSave();
        }
        this.closeWipLimit();
    }

    currentBoard() {
        return this.board;
    }

    closeOverlays() {
        this.closeMenu();
        if (document.getElementById('cardModal').classList.contains('open')) this.closeCardModal();
    }

    destroy() {
        clearTimeout(this.saveTimer);
        this.destroySortables();
        document.getElementById('boardRoot').innerHTML = '';
    }
}

const boardController = new BoardController();

if (typeof window !== 'undefined') {
    window.KanbanBoard = boardController;
    window.kbBoardColor = kbBoardColor;
    window.KB_BOARD_COLORS = BOARD_COLORS;
}