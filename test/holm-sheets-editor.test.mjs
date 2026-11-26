import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withSheetEditorChrome } from '../holm/sheets/editor-build.mjs';
import { withHomeUI } from '../holm/auth/home-ui-build.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Sheets moves its file-link action into the account menu and places save status next to the title', () => {
  const source = read('sheets/editor.html');
  const html = withHomeUI(withSheetEditorChrome(source));
  const left = html.slice(html.indexOf('<div class="top-nav-left">'), html.indexOf('<div class="top-nav-right">'));
  const menu = html.slice(html.indexOf('<div id="settingsDropdown"'), html.indexOf('<!-- Spreadsheet Container -->'));
  assert.match(left, /id="spreadsheetTitle"[^>]*>[^<]*<\/h1>\s*<span id="saveState"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.equal((html.match(/id="saveState"/g) || []).length, 1);
  assert.equal((html.match(/id="mentionBtn"/g) || []).length, 1);
  assert.match(menu, /id="mentionBtn"[^>]*class="settings-dropdown-item"[^>]*>[\s\S]*?Link a file/);
  assert.doesNotMatch(html, /id="saveBtn"|class="top-nav-actions"/);
  assert.match(html, /href="\/sheets\/editor-header.css"/);
  assert.match(html, /id="univer" class="univer-container"/);
  assert.match(read('draw/editor.html'), /id="drawingTitle"[\s\S]*?id="saveState"[\s\S]*?<div class="top-nav-right">/);
});

test('editor header adapter fails safely if the original toolbar gains another action', () => {
  const source = read('sheets/editor.html');
  assert.throws(() => withSheetEditorChrome(''), /no longer matches/);
  assert.throws(() => withSheetEditorChrome(source.replace('<div class="top-nav-actions">', '<div class="top-nav-actions"><button>Keep me</button>')), /no longer matches/);
});
