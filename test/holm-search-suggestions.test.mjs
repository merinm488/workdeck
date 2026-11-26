import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const script = readFileSync(new URL('../holm/auth/search-suggestions.js', import.meta.url), 'utf8');
const window = {};
runInNewContext(script, { window });
const { match } = window.WDSearchSuggestions;

test('inline completion uses the first current result with a case-insensitive title prefix', () => {
  assert.equal(match('pla', ['Planning notes', 'Planning review']), 'Planning notes');
  assert.equal(match('PLAN', ['Planning review', 'Planning notes']), 'Planning review');
  assert.equal(match('notes', ['Planning notes']), null, 'substring results are not completions');
  assert.equal(match('other', ['Planning notes']), null);
  assert.equal(match('pla', []), null);
  assert.equal(match('å', ['Årsplan']), 'Årsplan');
  assert.equal(match('<Pl', ['<Planning> & review']), '<Planning> & review');
});

test('empty, whitespace-only, invalid and already-complete titles cannot trap Tab', () => {
  for (const query of ['', ' ', '\t', '\n']) assert.equal(match(query, ['Planning notes']), null);
  assert.equal(match('Planning', ['Planning notes', 'Planning']), null);
  assert.equal(match('planning', ['Planning notes', 'PLANNING']), null);
  assert.equal(match('Planning ', ['Planning notes']), 'Planning notes');
  assert.equal(match(' Planning', ['Planning notes']), null, 'preserve the typed prefix like Home');
  assert.equal(match('pla', [null, 123, {}, '', 'Planning notes']), 'Planning notes');
});

test('suggestions are read-only local presentation with IME, selection and cleanup guards', () => {
  assert.doesNotMatch(script, /\bfetch\s*\(|localStorage|sessionStorage/);
  assert.match(script, /selectionStart === input\.value\.length/);
  assert.match(script, /event\.shiftKey/);
  assert.match(script, /event\.isComposing \|\| composing/);
  assert.match(script, /compositionstart/);
  assert.match(script, /compositionend/);
  assert.match(script, /rest\.textContent =/);
  assert.match(script, /aria-autocomplete', 'inline'/);
  assert.match(script, /resize\.disconnect\(\)/);
  assert.match(script, /listeners\.forEach\(remove => remove\(\)\)/);
});
