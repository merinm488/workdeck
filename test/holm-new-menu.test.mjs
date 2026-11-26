import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { appArtwork } from '../holm/auth/app-artwork.mjs';
import { homeIconsJS } from '../holm/auth/home-ui-build.mjs';
const source = readFileSync(new URL('../holm/auth/dashboard.js', import.meta.url), 'utf8');
const registry = source.slice(source.indexOf('const WD_APPS = ['), source.indexOf('/** Look up a registry entry'));
const build = source.slice(source.indexOf('function appArtworkIcon('), source.indexOf('function renderNewMenus('));
function node(tagName = 'SPAN') {
  return { tagName, children: [], classes: new Set(), append(child) { this.children.push(child); },
    get classList() { return { add: value => this.classes.add(value) }; } };
}
function button() {
  const chip = node(), label = node();
  return { dataset: {}, chip, label, querySelector: selector => selector === '.wd-app-icon' ? chip : label };
}
const ui = runInNewContext(`${registry}\n${build}\n({ apps: WD_APPS, buildAppMenuItem })`, {
  $: () => ({ content: { firstElementChild: { cloneNode: button } } }),
  document: { createElement: tag => node(tag.toUpperCase()) },
  window: { WDAppArtwork: appArtwork },
});

test('Minutes is registered in New with its artwork and app-owned creation dialog route', () => {
  const minutes = ui.apps.find(app => app.id === 'minutes');
  assert.equal(minutes.create.route, '/minutes/?new=1');
  assert.equal(minutes.create.action, undefined);
  const item = ui.buildAppMenuItem(minutes, false);
  assert.equal(item.dataset.app, 'minutes');
  assert.equal(item.label.textContent, 'Minutes');
  assert.ok(item.chip.classes.has('wd-app-icon-artwork'));
  const image = item.chip.children[0];
  assert.equal(image.tagName, 'IMG');
  assert.equal(image.src, '/icons/minutes512.png');
  assert.equal(image.alt, '');
  assert.equal(image.width, 48);
  assert.equal(image.height, 48);
  const png = readFileSync(new URL('../holm/icons/minutes.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
});

test('New Minutes opens the app dialog without creating a file and carries the active tag', async () => {
  const start = source.indexOf('async function createFile(');
  const end = source.indexOf('// ================================================\n// Modals', start);
  const opened = [], state = { activeTag: null };
  const createFile = runInNewContext(source.slice(start, end) + '\ncreateFile', {
    getApp: id => ui.apps.find(app => app.id === id), state,
    openInNewTab: href => opened.push(href),
    api: () => assert.fail('Opening the dialog must not create a meeting'),
    showLoading: () => assert.fail('App-owned creation needs no dashboard loading overlay'),
  });
  await createFile('minutes');
  assert.equal(opened.at(-1), '/minutes/?new=1');
  state.activeTag = 'tag_team&review';
  await createFile('minutes');
  assert.equal(opened.at(-1), '/minutes/?new=1&tag=tag_team%26review');
});

test('all app menus share the catalogue artwork, labels and filter selection', () => {
  assert.equal(ui.apps.length, 11);
  assert.deepEqual(Object.keys(appArtwork).sort(), Array.from(ui.apps, app => app.id).sort());
  for (const app of ui.apps) for (const selected of [false, true]) {
    const item = ui.buildAppMenuItem(app, selected);
    assert.equal(item.dataset.app, app.id);
    assert.equal(item.dataset.selected, selected ? 'true' : undefined);
    assert.equal(item.label.textContent, app.name);
    assert.ok(item.chip.classes.has('wd-app-icon-artwork'));
    const image = item.chip.children[0];
    assert.equal(image.tagName, 'IMG');
    assert.equal(image.src, appArtwork[app.id]);
    assert.equal(image.alt, '');
  }
  assert.match(source, /return buildAppMenuItem\(app, false\)/);
  assert.match(source, /emptyNewDropdown'\)\.replaceChildren\(\.\.\.items\.map/);
  assert.match(source, /activeApp \? \[appArtworkIcon\(activeApp, 20\)\]/);
});

test('the browser artwork registry is generated from the catalogue source', () => {
  const window = {};
  runInNewContext(homeIconsJS(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')), { window });
  assert.deepEqual(JSON.parse(JSON.stringify(window.WDAppArtwork)), appArtwork);
  const buildScript = readFileSync(new URL('../scripts/build-holm-landing.mjs', import.meta.url), 'utf8');
  assert.match(buildScript, /const pwaIcon = appArtwork\[match\[1\]\]/);
});
