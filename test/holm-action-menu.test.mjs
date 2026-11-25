import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { withHomeUI } from '../holm/auth/home-ui-build.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const window = {};
runInNewContext(read('holm/auth/action-menu.js'), { window });
const position = (...args) => JSON.parse(JSON.stringify(window.WDActionMenu.position(...args)));

test('action dropdown is right-aligned below its trigger when there is space', () => {
  assert.deepEqual(position({ right: 1000, top: 120, bottom: 156 }, 232, 180, 1440, 900), { left: 768, top: 162, maxHeight: 730 });
});
test('action dropdown flips above a bottom row and stays inside a narrow screen', () => {
  assert.deepEqual(position({ right: 378, top: 800, bottom: 836 }, 232, 300, 390, 844), { left: 146, top: 494, maxHeight: 786 });
  assert.equal(position({ right: 30, top: 10, bottom: 46 }, 232, 180, 390, 844).left, 8);
  const long = position({ right: 378, top: 180, bottom: 216 }, 232, 1000, 390, 400);
  assert.equal(long.maxHeight, 170); // long menus scroll rather than leaving the screen
  assert.equal(long.top, 222);
});
test('every list view uses the shared labelled menu and the build ships its assets', () => {
  for (const file of ['holm/auth/dashboard.js', 'holm/auth/app-sidebar.js', 'holm/files/main.js', 'holm/docs-src/src/components/DocActions.jsx']) {
    assert.match(read(file), /WDActionMenu\.open/);
  }
  const html = withHomeUI('<html><head></head><body><template><body></body></template></body></html>');
  assert.ok(html.indexOf('/js/action-menu.js') > html.indexOf('</template>'));
  assert.match(html, /href="\/action-menu.css"/);
  assert.match(read('scripts/build-holm-landing.mjs'), /components\/DocActions\.jsx/);
  const css = read('holm/auth/action-menu.css');
  assert.match(css, /flex-direction: column/);
  assert.match(css, /overflow-y: auto/);
  const script = read('holm/auth/action-menu.js');
  assert.match(script, /label\.textContent = item\.label/);
  assert.match(script, /setAttribute\('role', 'menuitem'\)/);
  assert.match(script, /!menu\.contains\(event\.target\)/); // internal scrolling must not dismiss it
});

test('shared tag actions say Edit Tags and still invoke the original button', () => {
  let clicks = 0;
  const button = {
    classList: { contains: name => name === 'wd-app-card-tag' },
    title: 'Project planning', disabled: false,
    querySelector: () => null, getAttribute: () => null, click: () => clicks++,
  };
  const item = window.WDActionMenu.fromButton(button);
  assert.equal(item.label, 'Edit Tags');
  assert.equal(item.danger, false);
  item.onSelect();
  assert.equal(clicks, 1);
  const files = read('holm/files/main.js');
  assert.match(files, /action: 'tags', label: 'Edit Tags'/);
  assert.match(files, /action: 'move', label: 'Move to folder'/);
  assert.doesNotMatch(files, /label: '(?:Edit tags|Move to folder)[.…]/i);
});

test('cards use a single shared three-dot entry point and retain their original actions', () => {
  const dashboard = read('holm/auth/dashboard.js');
  assert.equal((dashboard.match(/wireCardActions\(card\);/g) || []).length, 3, 'regular, folder and app-level cards');
  for (const path of ['holm/auth/dashboard.js', 'holm/auth/home-ui.js']) assert.match(read(path), /WDActionMenu\.createCardTrigger/);
  assert.match(read('holm/files/main.js'), /classList\.contains\('fb-card'\).*classList\.add\('wd-card-more'\)/);
  assert.match(read('holm/docs-src/src/components/DocCard.jsx'), /<DocActions card/);
  assert.doesNotMatch(read('holm/docs-src/src/components/DocCard.jsx'), /<button/); // Pin remains in DocActions' dropdown.
  assert.match(read('holm/auth/action-menu.css'), /wd-card-action-source, \.wd-home-card-actions\) \{ display: none !important/);
  assert.match(read('holm/auth/action-menu.js'), /!trigger\.isConnected/);
});
