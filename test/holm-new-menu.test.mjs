import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../holm/auth/dashboard.js', import.meta.url), 'utf8');
const registry = source.slice(source.indexOf('const WD_APPS = ['), source.indexOf('/** Look up a registry entry'));
const build = source.slice(source.indexOf('function buildAppMenuItem('), source.indexOf('function renderNewMenus('));
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
  wdIcon: () => node('SVG'),
});

test('Minutes is registered in New with its packaged app artwork and meeting creation action', () => {
  const minutes = ui.apps.find(app => app.id === 'minutes');
  assert.equal(minutes.create.action, 'createMinutes');
  const item = ui.buildAppMenuItem(minutes, false, true);
  assert.equal(item.dataset.app, 'minutes');
  assert.equal(item.label.textContent, 'Minutes');
  assert.ok(item.chip.classes.has('wd-app-icon-artwork'));
  const image = item.chip.children[0];
  assert.equal(image.tagName, 'IMG');
  assert.equal(image.src, '/icons/minutes192.png');
  assert.equal(image.alt, '');
  assert.equal(image.width, 48);
  assert.equal(image.height, 48);
  const png = readFileSync(new URL('../holm/icons/minutes192.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 192);
  assert.equal(png.readUInt32BE(20), 192);
});

test('Minutes filter icon and the other ten app launcher icons remain unchanged', () => {
  assert.equal(ui.apps.length, 11);
  for (const app of ui.apps) {
    assert.equal(ui.buildAppMenuItem(app, true).chip.children[0].tagName, 'SVG');
    if (app.id !== 'minutes') assert.equal(ui.buildAppMenuItem(app, false, true).chip.children[0].tagName, 'SVG');
  }
  assert.match(source, /return buildAppMenuItem\(app, false, true\)/);
  assert.match(source, /emptyNewDropdown'\)\.replaceChildren\(\.\.\.items\.map/);
});
