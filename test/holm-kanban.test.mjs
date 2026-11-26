import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleKanban } from '../holm/kanban/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';
import { handleTodo } from '../holm/todo/api.js';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

function fixture() {
  const stores = new Map();
  let seq = 0;
  function member(id) {
    if (!stores.has(id)) stores.set(id, { rows: new Map(), kv: new Map() });
    const { rows, kv } = stores.get(id);
    const col = name => {
      if (!rows.has(name)) rows.set(name, new Map());
      return rows.get(name);
    };
    const ds = {
      find: name => [...col(name).values()], count: name => col(name).size,
      findOne: (name, where) => col(name).get(typeof where === 'string' ? where : where.id) || null,
      insert: (name, record) => { const key = `rec_${++seq}_abcdef`; col(name).set(key, { id: key, ...record }); return key; },
      update: (name, where, patch) => col(name).set(where.id, { ...col(name).get(where.id), ...patch.$set }),
      delete: (name, where) => col(name).delete(where.id), transaction: fn => fn(ds),
    };
    return { holm: { auth: { getMember: () => ({ id }) }, app: { member: {
      ds, kv: { get: key => kv.get(key), set: (key, value) => kv.set(key, value) },
    } } } };
  }
  const anon = { holm: { auth: { getMember: () => null } } };
  async function call(handler, env, method = 'GET', body, origin = 'https://workdeck.test') {
    const path = handler === handleKanban ? '/api/kanban' : handler === handleTodo ? '/api/todo/lists' : '/api/workdeck';
    const res = await handler(new Request('https://workdeck.test' + path, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: res.status, data: await res.json() };
  }
  const put = (handler, env, action, data, origin) => call(handler, env, 'PUT', { action, data }, origin);
  return { member, anon, call, put };
}

test('Kanban is private and preserves board/column/card features with stale-write protection', async () => {
  const { member, anon, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await call(handleKanban, anon)).status, 401);
  assert.equal((await put(handleKanban, alice, 'createBoard', { name: 'Attack' }, 'https://evil.test')).status, 403);
  assert.equal((await call(handleKanban, alice, 'PUT', { hash: 'bob', action: 'createBoard', data: { name: 'X' } })).status, 400);
  const created = await put(handleKanban, alice, 'createBoard', { name: 'My project' });
  assert.equal(created.status, 200);
  const board = created.data.board;
  assert.equal(board.version, 1);
  assert.deepEqual((await call(handleKanban, bob)).data.data.kanban, []);
  assert.equal((await put(handleKanban, bob, 'updateBoard', { boardId: board.id, version: 1, board })).status, 404);
  const card = { id: 'card_abcdef1234', column: board.columns[0].id, label: 'Write',
    description: 'Task description', priority: 'high', progress: 50,
    checklist: [{ id: 'check_abcdef123', text: 'Draft', done: true }],
    comments: [{ id: 'comm_abcdef1234', text: 'Looks good', date: '2026-01-01T00:00:00Z' }] };
  const update = { name: 'My project', columns: board.columns, rows: [], cards: [card], links: [] };
  const saved = await put(handleKanban, alice, 'updateBoard', { boardId: board.id, version: 1, board: update });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.board.cards[0].comments, card.comments);
  assert.equal(saved.data.board.version, 2);
  assert.equal((await put(handleKanban, alice, 'updateBoard', { boardId: board.id, version: 1, board: update })).status, 409);
  assert.equal((await put(handleKanban, alice, 'updateBoard', { boardId: board.id, version: 2,
    board: { ...update, cards: [{ ...card, column: 'nonexistent' }] } })).status, 400);
  const renamed = await put(handleKanban, alice, 'renameBoard', { boardId: board.id, name: 'Renamed' });
  assert.equal(renamed.data.board.version, 3);
  assert.equal((await put(handleKanban, bob, 'deleteBoard', { boardId: board.id })).status, 404);
  assert.equal((await put(handleKanban, alice, 'deleteBoard', { boardId: board.id })).status, 200);
  assert.deepEqual((await call(handleKanban, alice)).data.data.kanban, []);
});

test('Kanban and Todo share member-private tags, theme, staging and deep links', async () => {
  const { member, call, put } = fixture();
  const alice = member('alice'), bob = member('bob');
  const list = (await call(handleTodo, alice, 'POST', { name: 'Backlog' })).data.list;
  const task = { id: 'task_abcdef1234', title: 'Work', description: '', priority: 'medium',
    dueDate: null, completed: false, createdAt: '2026-01-01T00:00:00Z' };
  const taskSaved = await handleTodo(new Request(`https://workdeck.test/api/todo/lists/${list.id}`, {
    method: 'PUT', headers: { Origin: 'https://workdeck.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: list.name, items: [task], version: 1 }),
  }), alice);
  assert.equal(taskSaved.status, 200);
  const added = (await put(handleKanban, alice, 'createBoard', { name: 'Linked board' })).data.board;
  const linked = { name: added.name, columns: added.columns, rows: [], links: [],
    cards: [{ id: 'card_abcdef1234', column: added.columns[0].id, label: 'Work',
      todoListId: list.id, todoTaskId: task.id }] };
  assert.equal((await put(handleKanban, alice, 'updateBoard', { boardId: added.id, version: 1, board: linked })).status, 200);
  const invalid = { ...linked, cards: [{ ...linked.cards[0], todoTaskId: 'task_not_in_list_abc' }] };
  assert.equal((await put(handleKanban, alice, 'updateBoard', { boardId: added.id, version: 2, board: invalid })).status, 400);
  // Todo only stages task IDs it owns, and Kanban reads that same member KV.
  assert.equal((await put(handleKanban, alice, 'updateSettings', { settings: { kanbanCards: [task.id], theme: 'light' } })).status, 200);
  assert.equal((await call(handleTodo, alice)).data.settings.theme, 'light');
  assert.deepEqual((await call(handleTodo, alice)).data.settings.kanbanCards, [task.id]);
  assert.deepEqual((await call(handleKanban, bob)).data.data.settings.kanbanCards, []);
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Team', color: '#123456' })).data.data.tags[0];
  assert.equal((await put(handleWorkspace, alice, 'setFileTag', { app: 'kanban', fileId: added.id, tagId: tag.id })).status, 200);
  assert.equal((await put(handleWorkspace, bob, 'setFileTag', { app: 'kanban', fileId: added.id, tagId: tag.id })).status, 404);
  assert.equal((await call(handleWorkspace, alice)).data.data.kanban[0].tagId, tag.id);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'kanban', fileId: added.id })).status, 200);
  assert.ok((await call(handleWorkspace, alice)).data.data.settings.lastOpened[added.id]);
  const removed = await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id });
  assert.deepEqual(removed.data.data.kanban, []);
  assert.equal(removed.data.data.settings.lastOpened[added.id], undefined);
});

test('Holm hard links for Todo and Kanban survive the static router on reload', () => {
  const script = readFileSync(new URL('../holm/auth/links.js', import.meta.url), 'utf8');
  const window = { location: { origin: 'https://workdeck.test', pathname: '/home', search: '' } };
  vm.runInNewContext(script, { window, URL, URLSearchParams });
  const todo = window.WDLinks.url('todo', 'list_abcdef123');
  const board = window.WDLinks.url('kanban', 'board_abcdef123');
  assert.equal(todo, '/todo/?list=list_abcdef123');
  assert.equal(board, '/kanban/?board=board_abcdef123');
  assert.equal(window.WDLinks.parseHref(board).id, 'board_abcdef123');
  const editor = readFileSync(new URL('../holm/todo/editor.js', import.meta.url), 'utf8');
  assert.ok(editor.includes("'/todo/?list=' + encodeURIComponent(id)"));
});

test('Holm Kanban home renders no Create board tile; the header New Board button remains', () => {
  const source = readFileSync(new URL('../holm/kanban/app.js', import.meta.url), 'utf8');
  const render = source.slice(source.indexOf('function renderBoards()'), source.indexOf('async function openBoard('));
  const grid = { children: [], innerHTML: '', appendChild(card) { this.children.push(card); } };
  const elements = {
    boardsGrid: grid, boardsNoResults: { classList: { toggle() {} } },
    boardsEmpty: { classList: { toggle() {} } }, kanbanFooterStats: {},
  };
  const state = { searchQuery: '', boards: [], settings: {} };
  const { renderBoards } = vm.runInNewContext(`${render}; ({ renderBoards })`, {
    state, document: { getElementById(id) {
      assert.notEqual(id, 'kbBoardCreateTemplate', 'Create board tile must not be rendered');
      return elements[id];
    } },
  });
  renderBoards();
  assert.equal(grid.children.length, 0);
  assert.equal(elements.kanbanFooterStats.textContent, '0 boards · 0 cards');
  assert.match(readFileSync(new URL('../kanban/index.html', import.meta.url), 'utf8'), /id="newBoardBtn"/);
});

test('Holm Kanban keeps the original board UI but never ships access-key login', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wd-kanban-'));
  try {
    execFileSync(process.execPath, [new URL('../scripts/build-holm-landing.mjs', import.meta.url).pathname, dir]);
    const original = readFileSync(new URL('../kanban/index.html', import.meta.url), 'utf8');
    const html = readFileSync(join(dir, 'web/kanban/index.html'), 'utf8');
    const css = readFileSync(join(dir, 'web/kanban/styles.css'), 'utf8');
    const sidebarCSS = readFileSync(join(dir, 'web/app-sidebar.css'), 'utf8');
    assert.doesNotMatch(sidebarCSS, /max-width:760px/);
    const homeCSS = readFileSync(join(dir, 'web/home-ui.css'), 'utf8');
    assert.match(homeCSS, /--wd-home-list-width:1024px/);
    assert.match(homeCSS, /\.wd-app-items\.as-list,[^}]*max-width:var\(--wd-home-list-width\)/);
    assert.match(sidebarCSS, /#boardsSearchToggle \{ display:none; \}/);
    assert.match(sidebarCSS, /@media\(max-width:700px\) \{ #boardsSearchToggle:not\(\.hidden\) \{ display:inline-flex; \} \}/);
    assert.match(html, /id="listsSearchInput"/);
    assert.match(html, /id="newBoardBtn"/);
    assert.doesNotMatch(html, /id="kbSidebarClose"/);
    assert.equal((html.match(/id="kbSidebarToggle"/g) || []).length, 1, 'one Cards sidebar toggle');
    const toggle = html.match(/<button\b[^>]*id="kbSidebarToggle"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.match(toggle, /aria-controls="kbSidebar"/);
    assert.match(toggle, /aria-label="Close cards sidebar"/);
    assert.match(toggle, /d="m11 6-6 6 6 6m8-12-6 6 6 6"/);
    assert.doesNotMatch(toggle, /<rect|<line/);
    const boardScript = readFileSync(join(dir, 'web/kanban/js/board.js'), 'utf8');
    assert.doesNotMatch(boardScript, /kbSidebarClose/);
    assert.match(boardScript, /m5 6 6 6-6 6m8-12 6 6-6 6/);
    assert.equal(css, readFileSync(new URL('../kanban/styles.css', import.meta.url), 'utf8'));
    for (const marker of ['sortablejs@1.15.6', 'id="boardView"', 'id="boardRoot"',
      'id="cardModal"', 'id="kbTodoList"', 'id="checklistModal"', 'id="wipLimitModal"']) {
      assert.ok(original.includes(marker));
      assert.ok(html.includes(marker));
    }
    assert.doesNotMatch(html, /View My Key|Delete Account|Your Access Key|sessionStorage|kanban_user_hash/);
    assert.doesNotMatch(readFileSync(join(dir, 'web/kanban/js/storage.js'), 'utf8'), /hash:|userHash|userKey/);
    assert.ok(readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8').includes("['todo', 'kanban', 'minutes', 'calendar', 'docs', 'sheets', 'forms', 'slides', 'draw', 'filebox', 'blog']"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
