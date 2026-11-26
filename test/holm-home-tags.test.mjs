import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { homeComponentCSS } from '../holm/auth/home-ui-build.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('holm/auth/dashboard.js');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('home item actions use the shared tag picker and replace or clear one tag', async () => {
  const tags = [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }];
  let picker;
  const assignments = [];
  const ui = runInNewContext(`${section('function showMoveModal(', '// Optimistic tag write')}
    ${section('async function applyFileMove(', '// ================================================\n// Drag a file')}
    ({ showMoveModal, applyFileMove })`, {
    state: { tags }, WDTagUI: { editTags: options => { picker = options; } },
    isMultiTagItem: file => Array.isArray(file.tags),
    applyFileTags: (file, tagIds) => { assignments.push({ file, tagIds }); return false; },
  });
  const file = { id: 'file', name: 'Report', tags: ['first'] };
  ui.showMoveModal(file);
  assert.equal(picker.name, 'Report');
  assert.equal(picker.tags, tags);
  assert.equal(picker.tagId, 'first');
  assert.equal(await picker.onSave('second'), false, 'failed writes keep the shared dialog open');
  assert.deepEqual(Array.from(assignments[0].tagIds), ['second']);
  await picker.onSave(null);
  assert.deepEqual(Array.from(assignments[1].tagIds), []);
});

test('home tag write failures restore the record and report failure to the picker', async () => {
  let fails = true;
  const ui = runInNewContext(`${section('async function applyFileTags(', '// ================================================\n// Drag a file')}
    ({ applyFileTags, applyFileMove })`, {
    isMultiTagItem: file => Array.isArray(file.tags),
    api: async () => { if (fails) throw Error('Offline'); },
    render() {}, loadUserData() {}, showNotification() {},
  });
  for (const file of [{ id: 'file', tags: ['first'] }, { id: 'doc', app: 'docs', tagId: 'first' }]) {
    fails = true;
    assert.equal(await ui.applyFileMove(file, 'second'), false);
    assert.equal(file.tags?.[0] || file.tagId, 'first');
    fails = false;
    assert.equal(await ui.applyFileMove(file, 'second'), true);
    assert.equal(file.tags?.[0] || file.tagId, 'second');
  }
});

test('all item tag modals use one component and the original home dropdown styles', () => {
  for (const path of ['holm/auth/dashboard.js', 'holm/auth/app-sidebar.js', 'holm/files/main.js', 'holm/docs-src/src/components/DocTags.jsx']) {
    assert.match(read(path), /WDTagUI\.editTags\(/, path);
  }
  const picker = read('holm/auth/tag-ui.js');
  assert.match(picker, />Edit tags<\/h3>/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /name: 'No tags'/);
  assert.match(picker, /button.disabled = true/);
  assert.match(picker, /await onSave\(selected\) === false/);
  const css = homeComponentCSS(read('public/workdeck.css'));
  assert.match(css, /\.wd-move-select-trigger \{/);
  assert.match(css, /\.wd-move-menu\.active \{/);
  assert.match(css, /\.wd-move-option\.selected \{/);
  assert.doesNotMatch(read('holm/docs-src/src/docs-ui.css'), /wd-doc-tags/);
});
