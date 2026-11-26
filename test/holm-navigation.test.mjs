import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { withoutDocPins } from '../holm/docs-src/pin-free-build.mjs';
import { withHomeUI, homeIconsJS } from '../holm/auth/home-ui-build.mjs';
import { workdeckHomeLink, workdeckHomeIcon } from '../holm/auth/sidebar-home.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Docs removes pin UI in every surface and ignores legacy pin flags in sorting', () => {
  for (const component of ['DocListView', 'DocDetailView']) {
    const built = withoutDocPins(read(`docs-src/src/components/${component}.jsx`), component);
    assert.doesNotMatch(built, /onPin|doc\??\.pinned|Unpin|Pin doc|Pinned/);
    assert.match(built, /doc\.title|MarkdownPreview/);
  }
  for (const path of ['App.jsx', 'components/DocActions.jsx', 'components/DocCard.jsx', 'hooks/useDocs.js', 'lib/db.js']) {
    assert.doesNotMatch(read('holm/docs-src/src/' + path), /togglePin|toggleDocPin|onPin|isPinned|\.pinned/);
  }
  assert.match(read('holm/docs-src/src/hooks/useDocs.js'), /\[\.\.\.filtered\]\.sort/);
  assert.throws(() => withoutDocPins('', 'DocListView'), /pin boundary/);
});

test('only sidebar app homes mark results pending before any app script runs', () => {
  const shell = '<html lang="en"><head></head><body><div id="boardsGrid"></div><script src="/js/app-sidebar.js"></script></body></html>';
  assert.match(withHomeUI(shell), /<html[^>]*data-wd-home-pending/);
  assert.doesNotMatch(withHomeUI(shell.replace('src="/js/app-sidebar.js"', 'src="editor.js"')), /data-wd-home-pending/);
});

test('all Workdeck home buttons pair the app artwork with its name and go directly to /home', () => {
  for (const path of ['files/index.html', 'calendar/index.html']) {
    const result = withHomeUI(read(path));
    assert.ok(result.includes(workdeckHomeLink), path);
    assert.doesNotMatch(result, /<strong>Calendar<\/strong>|class="fb-brand-text">Files/);
    if (path.startsWith('calendar')) assert.match(result, /id="calSidebarClose"/);
  }
  const window = {};
  runInNewContext(homeIconsJS(read('public/index.html')), { window });
  assert.equal(window.WDHomeLink, workdeckHomeLink);
  assert.equal(window.WDHomeIcons.workdeck, workdeckHomeIcon);
  assert.match(read('holm/auth/app-sidebar.js'), /wd-app-side-brand wd-sidebar-brand/);
  assert.match(read('holm/auth/app-sidebar.js'), /window\.WDHomeLink/);
  assert.match(read('holm/docs-src/src/App.jsx'), /className="wd-sidebar-home" href="\/home" aria-label="Workdeck home"/);
  assert.match(workdeckHomeIcon, /<img[^>]*src="\/icons\/icon-192x192.png"[^>]*alt=""/);
  assert.doesNotMatch(workdeckHomeIcon, /<svg/);
  assert.ok(workdeckHomeLink.includes(`<span class="wd-sidebar-home-icon">${workdeckHomeIcon}</span><span class="wd-sidebar-home-text">Workdeck</span>`));
  assert.match(read('holm/docs-src/src/App.jsx'), /<span className="wd-sidebar-home-text">Workdeck<\/span>/);
  const dashboard = withHomeUI(read('public/index.html'));
  assert.match(dashboard, /href="\/home" class="wd-logo" aria-label="Workdeck home"/);
  assert.ok(dashboard.includes(`<div class="wd-logo-icon">${workdeckHomeIcon}</div>`));
  assert.doesNotMatch(dashboard, /Workdeck landing page|M3 12l9-9/);
  for (const path of ['minutes/index.html', 'draw/shared.html']) {
    const built = withHomeUI(read(path));
    assert.match(built, /href="\/home"[^>]*aria-label="Workdeck home"/);
    assert.ok(built.includes(workdeckHomeIcon), path);
    assert.match(built, /class="wd-sidebar-home-text">Workdeck<\/span>/, path);
    assert.doesNotMatch(built, /M3 9.5 12 3l9/);
  }
});

function boardFixture(saveBoard) {
  const notices = [], timers = new Map();
  let timerId = 0;
  const { BoardController } = runInNewContext(read('holm/kanban/board.js') + '\n;({ BoardController });', {
    window: {}, document: {},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    kanbanStorage: { saveBoard }, showNotification: message => notices.push(message),
  });
  const board = new BoardController();
  board.board = { id: 'board_12345678', name: 'Plan', columns: [{ id: 'column_12345678', label: 'Todo' }], rows: [], cards: [], links: [] };
  return { board, notices, timers };
}

test('Kanban flush cancels debounce and saves edits made during a pending save in order', async () => {
  const calls = [], releases = [];
  const { board, timers } = boardFixture(record => new Promise(resolve => {
    calls.push(structuredClone(record));
    releases.push(() => { record.version = calls.length + 1; record.updatedAt = '2026-07-04T12:00:00Z'; resolve(true); });
  }));
  board.scheduleSave();
  const first = board.save();
  board.board.name = 'Changed while saving';
  board.scheduleSave();
  const flushed = board.flush();
  assert.equal(calls.length, 1);
  releases.shift()();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'Plan');
  assert.equal(calls[1].name, 'Changed while saving');
  releases.shift()();
  assert.equal(await flushed, true);
  assert.equal(board.dirty, false);
  assert.equal(board.saving, false);
  assert.equal(timers.size, 0);
  assert.equal(board.board.updatedAt, '2026-07-04T12:00:00Z');
});

test('Kanban failed saves preserve dirty edits and flush retries instead of leaving', async () => {
  let succeed = false;
  const { board, notices } = boardFixture(async () => succeed);
  board.scheduleSave();
  assert.equal(await board.flush(), false);
  assert.equal(board.dirty, true);
  assert.equal(board.board.name, 'Plan');
  assert.match(notices[0], /changes kept here/);
  succeed = true;
  assert.equal(await board.flush(), true);
  assert.equal(board.dirty, false);
});
