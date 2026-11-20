import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = file => readFileSync(new URL(file, import.meta.url), 'utf8');

test('Holm Todo preserves original app styling, library, and editor feature surface', () => {
  assert.equal(source('../holm/todo/styles.css'), source('../todo/styles.css'));
  const html = source('../holm/todo/index.html');
  const original = source('../todo/index.html');
  const editor = source('../holm/todo/editor.js');
  for (const marker of ['sortablejs@1.15.0', 'id="listsGrid"', 'id="listsLayoutBtn"',
    'id="listsSearchInput"', 'id="todoForm"', 'id="todoPriority"', 'id="todoDate"',
    'id="tdListCardTemplate"', 'id="tdTaskTemplate"', 'id="settingsDropdown"',
    'class="theme-option"', 'td-task-kanban']) {
    assert.ok(original.includes(marker), `Original Todo missing ${marker}`);
    assert.ok(html.includes(marker), `Holm Todo missing ${marker}`);
  }
  for (const feature of ['function renderLists()', 'function renderTasks()',
    'function initSortable()', 'function toggleKanbanStaged(id)', 'function openEditModal(id)']) {
    assert.ok(editor.includes(feature), `Missing existing editor feature: ${feature}`);
  }
  assert.doesNotMatch(html, /View My Key|Your Access Key|todo_user_hash|todo_user_key|Delete Account/);
  assert.doesNotMatch(editor, /viewKeyBtn|deleteAccountBtn|todoAuth\.getSession/);
});
