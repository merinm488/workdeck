import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../holm/auth/dashboard.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

function element() {
  return {
    children: [], classList: { add() {}, remove() {} },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute() {},
    addEventListener(event, callback) { this[event] = callback; },
  };
}

test('Holm home chooser has one selection and replaces options when reopened', async () => {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const tags = [{ id: 'first', name: 'First', color: '#123456' }, { id: 'second', name: 'Second', color: '#654321' }];
  const state = { tags, moveTarget: null };
  const assignments = [];
  const ui = runInNewContext(`${section('function showMoveModal(', 'function hideMoveModal(')}
    ${section('function moveEmptyDiv()', 'async function confirmMove()')}
    ${section('async function applyFileMove(', '// ================================================\n// Drag a file')}
    ({ showMoveModal, renderMoveOptions, applyFileMove })`, {
    state, $, document: { createElement: () => element() },
    wdDot: () => element(), wdIcon: () => element(),
    setMoveTriggerValue: () => {}, closeMoveDropdown: () => {},
    isMultiTagItem: file => Array.isArray(file.tags),
    applyFileTags: (file, tagIds) => assignments.push({ file, tagIds }),
  });
  const dropdown = $('moveDropdown');
  const file = { id: 'file', tags: ['first'] }; // Filebox stores tags as an array
  ui.showMoveModal(file);
  assert.equal(state.moveTarget, 'first');
  assert.equal(dropdown.children.length, 3); // No tags + two tags
  dropdown.children[2].click();
  assert.equal(state.moveTarget, 'second');
  assert.equal(dropdown.children.length, 3);
  ui.showMoveModal(file);
  assert.equal(dropdown.children.length, 3);

  await ui.applyFileMove(file, 'second');
  assert.deepEqual(Array.from(assignments[0].tagIds), ['second']); // replaces, not adds
  await ui.applyFileMove(file, null);
  assert.deepEqual(Array.from(assignments[1].tagIds), []);
  state.tags = [];
  ui.renderMoveOptions();
  assert.equal(dropdown.children.length, 1);
});
