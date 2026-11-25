import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { withHomeUI } from '../holm/auth/home-ui-build.mjs';
import { withSheetAutosave } from '../holm/sheets/autosave-build.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function harness(extra = {}) {
  const timers = new Map(), listeners = {}, states = [];
  let next = 0;
  const context = {
    console: { warn() {} }, URL, structuredClone,
    setTimeout(fn, delay) { timers.set(++next, { fn, delay }); return next; },
    clearTimeout(id) { timers.delete(id); },
    window: { addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener() {} },
    document: { getElementById() { return null; }, addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener() {} },
    ...extra
  };
  runInNewContext(read('holm/auth/autosave.js'), context);
  context.WDAutosave = context.window.WDAutosave;
  return { context, timers, listeners, states, create: save => context.WDAutosave.create({ save, onState: (state, dirty) => states.push([state, dirty]) }) };
}

test('autosave bounds typing delay and only reports saved after acknowledgement', async () => {
  const h = harness(); let writes = 0, resolve;
  const queue = h.create(() => { writes++; return new Promise(done => { resolve = done; }); });
  queue.change(); const firstTimer = [...h.timers.keys()][0];
  queue.change(); queue.change();
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.keys()][0], firstTimer);
  assert.equal([...h.timers.values()][0].delay, 800);
  const flush = queue.flush(); assert.equal(writes, 1); assert.equal(queue.dirty(), true);
  assert.deepEqual(h.states.at(-1), ['saving', true]);
  resolve(true); assert.equal(await flush, true); assert.equal(queue.dirty(), false);
  assert.deepEqual(h.states.at(-1), ['saved', false]); queue.dispose();
});

test('edits during a slow request are serialized and saved by the same flush', async () => {
  const h = harness(), releases = [], snapshots = []; let value = 'first';
  const queue = h.create(() => { snapshots.push(value); return new Promise(done => releases.push(done)); });
  queue.change(); const flush = queue.flush();
  value = 'latest'; queue.change(); const secondFlush = queue.flush();
  assert.deepEqual(snapshots, ['first']); releases.shift()(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(snapshots, ['first', 'latest']); assert.equal(queue.dirty(), true);
  assert.ok(!h.states.slice(1).some(([state]) => state === 'saved'));
  releases.shift()(true); assert.equal(await flush, true); assert.equal(await secondFlush, true);
  assert.equal(queue.dirty(), false); queue.dispose();
});

test('failed writes stay dirty, retry automatically, and retry on reconnection', async () => {
  const h = harness(); let online = false;
  const queue = h.create(async () => online);
  queue.change(); assert.equal(await queue.flush(), false);
  assert.equal(queue.dirty(), true); assert.deepEqual(h.states.at(-1), ['error', true]);
  assert.equal([...h.timers.values()][0].delay, 5000);
  const event = { preventDefault() { this.prevented = true; } };
  h.listeners.beforeunload(event); assert.equal(event.prevented, true);
  await new Promise(resolve => setImmediate(resolve));
  online = true; h.listeners.online(); await queue.flush();
  assert.equal(queue.dirty(), false); queue.dispose();
});

test('navigation flushes every dirty editor, and is blocked if any save fails', async () => {
  const assigned = [], h = harness({ location: { href: 'https://example.com/docs/', pathname: '/docs/', search: '', assign: url => assigned.push(url) } });
  let ok = false, writes = 0;
  const one = h.create(async () => { writes++; return true; }), two = h.create(async () => ok);
  one.change(); two.change();
  const click = () => ({ button: 0, target: { closest: () => ({ href: 'https://example.com/home', hasAttribute: () => false }) }, preventDefault() {}, stopImmediatePropagation() {} });
  await h.listeners.click(click()); assert.deepEqual(assigned, []); assert.equal(writes, 1);
  ok = true; await h.listeners.click(click()); assert.equal(assigned.length, 1);
  one.dispose(); two.dispose();
});

test('all editor shells omit manual save buttons but retain passive status and shared-view detection', () => {
  for (const app of ['sheets', 'forms', 'draw', 'slides']) {
    const html = withHomeUI(read(`${app}/editor.html`));
    assert.doesNotMatch(html, /id="saveBtn"/);
    assert.equal((html.match(/id="saveState"/g) || []).length, 1);
    assert.match(html, /src="\/js\/autosave.js"/);
  }
  const sheet = withSheetAutosave(read('sheets/js/spreadsheet.js'));
  assert.match(sheet, /!document\.getElementById\('spreadsheetTitle'\)/);
  assert.match(sheet, /this.onChangeCallback = onChange;\n        this.changeListenersEnabled = true;/);
  assert.doesNotMatch(sheet, /elapsed >= 2000/);
  assert.doesNotMatch(read('holm/docs-src/src/components/DocDetailView.jsx'), /Save Changes|handleExplicitSave|content\.trim\(\),/);
  assert.match(read('holm/auth/dashboard.js'), /querySelector\('\.wd-file-icon'\)\.append\(wdIcon\('filebox'\)\)/);
});

test('Sheets, Forms, Slides and Draw dirty hooks drive the shared autosave without losing failures', async () => {
  for (const app of ['sheets', 'forms', 'slides', 'draw']) {
    let writes = 0, success = false;
    const storage = async () => { writes++; return success; };
    const extra = {
      editorState: { deck: { id: 'deck' }, drawingId: 'draw', drawing: {}, canvas: { toObject: () => ({ objects: [] }) } },
      slidesStorage: { saveDeck: storage }, drawStorage: { saveDrawing: storage },
      formsStorage: { saveForm: storage }, spreadsheetManager: { save: storage },
      syncCurrentSlideFromCanvas() {}, EXTRA_SERIALIZED_PROPS: [], getViewport: () => ({}),
      $: () => ({ textContent: 'Untitled' })
    };
    const h = harness(extra);
    if (app === 'sheets' || app === 'forms') {
      const source = read(`holm/${app}/${app === 'forms' ? 'editor' : 'app'}.js`);
      const methods = ['save', 'setupAutoSave', 'markAsChanged'].map(name => {
        const start = source.indexOf(`    ${name === 'save' ? 'async ' : ''}${name}(`);
        return source.slice(start, source.indexOf('\n    }', start) + 6);
      }).join('\n');
      runInNewContext(`class Editor { ${methods}\n getBuilderSchema() { return { components: [] }; } queueSheetFooterUpdate() {} } globalThis.editor = new Editor();`, h.context);
      h.context.editor.markAsChanged();
      assert.equal(await h.context.editor.save(), false, app);
      assert.equal(h.context.editor.hasUnsavedChanges, true, app);
      success = true; assert.equal(await h.context.editor.save(), true, app);
      assert.equal(h.context.editor.hasUnsavedChanges, false, app);
      h.context.editor.autosave.dispose();
    } else {
      const source = read(`holm/${app}/editor.js`), start = source.indexOf('function startAutoSave()');
      const end = source.indexOf(app === 'slides' ? 'function isUntitledDeck()' : 'function bindBeforeUnload()', start);
      runInNewContext(source.slice(start, end), h.context);
      h.context.markDirty(); const save = h.context[app === 'slides' ? 'saveDeck' : 'saveDrawing'];
      assert.equal(await save(), false, app); assert.equal(h.context.editorState.isDirty, true, app);
      success = true; assert.equal(await save(), true, app); assert.equal(h.context.editorState.isDirty, false, app);
      h.context.editorState.autosave.dispose();
    }
    assert.equal(writes, 2, app);
  }
});
