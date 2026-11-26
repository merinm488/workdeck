import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { appArtwork } from '../holm/auth/app-artwork.mjs';
import { homeIconsJS } from '../holm/auth/home-ui-build.mjs';
import { newFileWorkspace } from './fixtures/new-file-workspace.mjs';
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

function creationHarness(fetch) {
  const start = source.indexOf('async function createFile(');
  const end = source.indexOf('// ================================================\n// Modals', start);
  const apiStart = source.indexOf('async function api(');
  const apiEnd = source.indexOf('\n/**', apiStart);
  const window = {};
  runInNewContext(readFileSync(new URL('../holm/auth/links.js', import.meta.url), 'utf8'), { window });
  const opened = [], errors = [], state = { activeTag: null };
  const createFile = runInNewContext(source.slice(apiStart, apiEnd) + '\n' + source.slice(start, end) + '\ncreateFile', {
    window, fetch, WD_APP: { apiEndpoint: '/api/workdeck' }, WDLinks: window.WDLinks,
    getApp: id => ui.apps.find(app => app.id === id), state,
    openInNewTab: href => opened.push(href), showLoading() {}, hideLoading() {}, loadUserData() {},
    showNotification: message => errors.push(message), console: { error() {} },
  });
  return { createFile, opened, errors, state };
}

test('every server-created New entry opens the exact inserted record, regardless of list order', async () => {
  const workspace = newFileWorkspace();
  const tag = (await workspace.create('createTag', { name: 'Project' })).data.tags[0];
  for (const app of ui.apps.filter(app => app.create?.action)) {
    const old = await workspace.create(app.create.action);
    const oldId = old.createdFile.id;
    let response;
    const harness = creationHarness(async (...args) => {
      response = await (await workspace.fetch(...args)).json();
      // Put every new record in the middle, ruling out both first/last guesses.
      for (const list of Object.values(response.data).filter(Array.isArray)) {
        if (list.some(file => file.id === response.createdFile.id)) {
          const created = list.find(file => file.id === response.createdFile.id);
          list.splice(0, list.length, { id: oldId }, created, { id: oldId });
        }
      }
      return Response.json(response);
    });
    harness.state.activeTag = tag.id;
    for (let n = 0; n < 2; n++) {
      await harness.createFile(app.id);
      const opened = new URL(harness.opened.at(-1), 'https://workdeck.test');
      assert.equal(opened.searchParams.get(app.editorParam), response.createdFile.id, app.id);
      assert.equal(opened.searchParams.get('edit'), '1');
      assert.notEqual(response.createdFile.id, oldId);
      const created = Object.values(response.data).filter(Array.isArray).flat().find(file => file.id === response.createdFile.id);
      assert.equal(created.tagId, tag.id);
    }
    assert.notEqual(harness.opened[0], harness.opened[1], 'each click creates a different file');
    assert.deepEqual(harness.errors, []);
  }
});

test('New Docs and Sheets create blank records without changing existing contents', async () => {
  const { ds, create } = newFileWorkspace();
  const docId = (await create('createDoc')).createdFile.id;
  ds.update('user_docs', { id: docId }, { $set: { content: 'Keep this document' } });
  const sheetId = (await create('createSheet')).createdFile.id;
  const oldBody = ds.find('sheet_bodies', { sheetId })[0];
  const firstTab = oldBody.data.sheetOrder[0];
  oldBody.data.sheets[firstTab].cellData = { 0: { 0: { v: 'Keep this cell' } } };
  ds.update('sheet_bodies', { id: oldBody.id }, { $set: { data: oldBody.data } });
  const doc = await create('createDoc'), sheet = await create('createSheet');
  assert.equal(ds.findOne('user_docs', doc.createdFile.id).content, '');
  assert.equal(ds.findOne('user_docs', docId).content, 'Keep this document');
  const body = ds.find('sheet_bodies', { sheetId: sheet.createdFile.id })[0].data;
  assert.deepEqual(body.sheets[body.sheetOrder[0]].cellData, {});
  assert.deepEqual(ds.find('sheet_bodies', { sheetId })[0], oldBody);
});

test('failed or incomplete creation never opens an existing file', async () => {
  for (const app of ['docs', 'sheets']) for (const result of [
    { success: false, error: 'File limit reached' },
    { success: true, data: { docs: [{ id: 'old_doc_1' }], sheets: [{ id: 'old_sheet_1' }] } },
    { success: true, createdFile: {} },
  ]) {
    const harness = creationHarness(async () => Response.json(result));
    await harness.createFile(app);
    assert.deepEqual(harness.opened, []);
    assert.equal(harness.errors.length, 1);
  }
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
