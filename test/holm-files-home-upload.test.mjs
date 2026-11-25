import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../holm/files/main.js', import.meta.url), 'utf8');
const legacySource = readFileSync(new URL('../files/js/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../files/styles.css', import.meta.url), 'utf8');
const start = source.indexOf('// Keep successful uploads on screen');
const end = source.indexOf('// URL states', start);
assert.ok(start > 0 && end > start);
const section = source.slice(start, end);
const file = { id: 'record_1_abcdef', name: 'new.txt', folderId: null, tags: [], updatedAt: new Date().toISOString() };
const workspace = files => ({ files, folders: [], tags: [], settings: {} });

function fixture() {
  const state = { files: [], folders: [], tags: [], settings: {}, searchQuery: '', activeTag: null, currentFolderId: null };
  const elements = new Map(), renders = [];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: '', classList: { add() {} } });
    return elements.get(id);
  };
  const ui = runInNewContext(section + '\n({ applyUserData, showUploadedFile, recentUploads })', {
    state, $, window: {},
    render: () => renders.push(state.files.map(item => item.id)),
    syncUrl: () => {},
  });
  return { ui, state, renders, $ };
}

for (const [app, code] of [['Holm', source], ['legacy', legacySource]]) {
  test(`${app} Files home switches card/list visibility along with the Updated header`, () => {
    const from = code.indexOf('function renderContent()');
    const to = code.indexOf('function bindItemMenu(', from);
    const elements = new Map();
    const node = () => {
      const classes = new Set();
      return { innerHTML: '', textContent: '', children: [],
        appendChild(child) { this.children.push(child); },
        classList: {
          add: name => classes.add(name), remove: name => classes.delete(name),
          toggle: (name, value) => value ? classes.add(name) : classes.delete(name),
          contains: name => classes.has(name),
        },
      };
    };
    const viewToggle = { title: '', label: '',
      setAttribute(name, value) { if (name === 'aria-label') this.label = value; },
      querySelector: () => node(),
    };
    elements.set('fbViewToggle', viewToggle);
    const $ = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
    const state = { view: 'grid', searchQuery: '', activeTag: null, files: [] };
    const renderContent = runInNewContext(code.slice(from, to) + '\nrenderContent', {
      state, $, visibleFolders: () => [], visibleFiles: () => state.files,
      sortBy: records => records, buildFileCard: record => record, buildFileRow: record => record,
      renderFooter: () => {},
    });
    renderContent();
    assert.equal(viewToggle.label, 'Switch to list view');
    assert.equal(viewToggle.title, viewToggle.label);
    assert.equal($('fbList').classList.contains('hidden'), true);
    state.files = [file];
    state.view = 'list';
    renderContent();
    assert.equal(viewToggle.label, 'Switch to card view');
    assert.equal($('fbList').classList.contains('hidden'), false);
    assert.equal($('fbGrid').classList.contains('hidden'), true);
    assert.equal($('fbList').children.length, 1);
    state.view = 'grid';
    renderContent();
    assert.equal($('fbList').classList.contains('hidden'), true);
    assert.equal($('fbGrid').classList.contains('hidden'), false);
    assert.equal($('fbGrid').children.length, 1);
  });
}

test('Files list uses the shared Docs width and left-aligns Updated timestamps', () => {
  const sharedCSS = readFileSync(new URL('../holm/auth/home-ui.css', import.meta.url), 'utf8');
  assert.match(sharedCSS, /#fbList\) \{[^}]*max-width:var\(--wd-home-list-width\)/);
  assert.match(sharedCSS, /max-width:calc\(var\(--wd-home-list-width\) \+ 2 \* var\(--fb-home-gutter\)\)/);
  assert.match(css, /#fbList \.fb-row-date \{[^}]*grid-column:3;[^}]*text-align:left;/);
  assert.match(css, /\.fb-list-head:has\(\+ #fbList:not\(\.hidden\)\) \{ display: grid; \}/);
});

test('Files renders a saved upload immediately and keeps it across a stale workspace refresh', () => {
  const { ui, state, renders } = fixture();
  ui.applyUserData(workspace([]));
  ui.showUploadedFile(file);
  assert.deepEqual(Array.from(renders.at(-1)), [file.id]);
  ui.applyUserData(workspace([])); // A GET started before the PUT committed.
  assert.deepEqual(Array.from(renders.at(-1)), [file.id]);
  assert.equal(state.files.length, 1);
  ui.applyUserData(workspace([file])); // Server catches up; stop keeping an optimistic copy.
  assert.equal(ui.recentUploads.size, 0);
  ui.applyUserData(workspace([])); // Later deletion is no longer masked.
  assert.deepEqual(Array.from(renders.at(-1)), []);
});

test('Files clears a search or stale tag that would hide a newly uploaded file', () => {
  const { ui, state, $ } = fixture();
  state.searchQuery = 'unrelated';
  $('fbSearchInput').value = 'unrelated';
  state.activeTag = 'deleted-tag';
  ui.showUploadedFile(file);
  assert.equal(state.searchQuery, '');
  assert.equal($('fbSearchInput').value, '');
  assert.equal(state.activeTag, null);
  assert.equal(state.currentFolderId, null);
  assert.equal(state.files[0].id, file.id);
});
