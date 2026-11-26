import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { withSheetAutosave } from '../holm/sheets/autosave-build.mjs';
const source = readFileSync(new URL('../holm/sheets/snapshot.js', import.meta.url), 'utf8');
function fixture({ dark = true, renderFails = false } = {}) {
  const events = [], theme = { darkMode: dark, setDarkMode(value) { events.push(['theme', value]); this.darkMode = value; } };
  let paints = 0;
  const render = { components: new Map([['sheet', { makeForceDirty() {}, makeDirty() {} }]]), scene: {
    makeDirtyNoParent() {}, render() { events.push(['render', theme.darkMode]); if (renderFails && ++paints === 1) throw Error('Not ready'); }
  } };
  const window = {};
  runInNewContext(source, { window, document: { hidden: true }, console: { warn() {} },
    UniverCore: { ThemeService: 'theme' }, UniverEngineRender: { IRenderManagerService: 'renderer' },
  });
  const manager = { isInitialized: true, currentSheetId: 'sheet123', fWorkbook: { getId: () => 'book123' },
    univerAPI: { _injector: { get(key) { return key === 'theme' ? theme : { getRenderById: () => render }; } } } };
  return { ...window.WDSheetSnapshots, events, manager, theme };
}

test('light pass copies the original canvas then restores dark rendering synchronously', () => {
  const h = fixture();
  const value = h.capture(h.manager, () => { assert.equal(h.theme.darkMode, false); h.events.push(['copy']); return 'real-canvas'; });
  assert.equal(value, 'real-canvas');
  assert.deepEqual(h.events, [['theme', false], ['render', false], ['copy'], ['theme', true], ['render', true]]);
  assert.equal(h.theme.darkMode, true);
  assert.doesNotMatch(source, /fillText\(|invertColor|createWorkbook\(|addEventListener\(/);
});

test('light editors stay light and capture/renderer failures always restore dark editors', () => {
  const light = fixture({ dark: false });
  assert.equal(light.capture(light.manager, () => 'light'), 'light');
  assert.deepEqual(light.events, [['render', false]]);
  for (const renderFails of [false, true]) {
    const h = fixture({ renderFails });
    assert.equal(h.capture(h.manager, () => { throw Error('Tainted canvas'); }), null);
    assert.equal(h.theme.darkMode, true);
    assert.deepEqual(h.events.at(-1), ['render', true]);
  }
});

test('Holm retains the exact original canvas compositor, dimensions and encoding', () => {
  const original = readFileSync(new URL('../sheets/js/spreadsheet.js', import.meta.url), 'utf8');
  const built = withSheetAutosave(original);
  const body = text => text.slice(text.indexOf('        try {', text.indexOf('    captureCanvasThumbnail(')), text.indexOf('    /**\n     * Get the active worksheet facade'));
  assert.equal(body(built), body(original.replace('    captureThumbnail(', '    captureCanvasThumbnail(')));
  assert.match(built, /thumbnailStyle = 'univer-light-v1'/);
});

test('legacy preview refresh uses only a clean saved checkpoint and its captured version', async () => {
  const h = fixture(), calls = [];
  const record = { id: 'sheet123', version: 7 };
  const storage = { lastUserData: { sheets: [record] }, versions: new Map([['sheet123', 7]]),
    savePreview: async (...args) => { calls.push(args); return true; } };
  h.manager.captureThumbnail = () => 'saved-light-image';
  assert.equal(await h.refreshSavedPreview(h.manager, storage, () => true), false);
  assert.deepEqual(calls, []);
  assert.equal(await h.refreshSavedPreview(h.manager, storage, () => false), true);
  assert.deepEqual(calls, [['sheet123', 7, 'saved-light-image']]);
  record.thumbnailStyle = 'univer-light-v1';
  record.thumbnailContentVersion = record.version;
  assert.equal(await h.refreshSavedPreview(h.manager, storage, () => false), false);
  assert.equal(calls.length, 1);
  record.version = 8; storage.versions.set('sheet123', 8);
  assert.equal(await h.refreshSavedPreview(h.manager, storage, () => false), true, 'newer saved data refreshes the preview');
  assert.deepEqual(calls.at(-1), ['sheet123', 8, 'saved-light-image']);
  delete record.thumbnailStyle;
  h.manager.captureThumbnail = () => null;
  assert.equal(await h.refreshSavedPreview(h.manager, storage, () => false), false);
  assert.equal(calls.length, 2);
});
