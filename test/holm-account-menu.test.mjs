import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountAvatar, withAccountAvatars, withDocsAccountAvatar } from '../holm/auth/account-build.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('all static account triggers get the same avatar without changing menu IDs or handlers', () => {
  const paths = ['public/index.html', 'files/index.html', 'calendar/index.html', 'todo/index.html', 'kanban/index.html', 'blog/index.html',
    ...['sheets', 'forms', 'slides', 'draw'].flatMap(app => [`${app}/index.html`, `${app}/editor.html`])];
  for (const path of paths) {
    const source = read(path);
    const result = withAccountAvatars(source);
    const buttons = result.match(/<button\b[^>]*id="(?:settingsBtn|fbSettingsBtn)"[^>]*>[\s\S]*?<\/button>/g);
    assert.ok(buttons?.length, path);
    for (const button of buttons) {
      assert.match(button, /aria-label="Account menu" title="Account menu"/);
      assert.ok(button.includes(accountAvatar));
      assert.match(button, /class="[^"]*\bwd-account-trigger\b/);
      assert.doesNotMatch(button, /M19\.4|M10\.325/);
    }
    assert.equal(withAccountAvatars(result), result, 'idempotent');
    assert.equal(result.slice(result.indexOf('</button>', result.indexOf('id="' + (path.startsWith('files') ? 'fbSettingsBtn' : 'settingsBtn')))),
      source.slice(source.indexOf('</button>', source.indexOf('id="' + (path.startsWith('files') ? 'fbSettingsBtn' : 'settingsBtn')))), 'rest of page untouched');
  }
});

test('Docs editor avatar retains all existing menu actions', () => {
  const source = read('docs-src/src/components/SettingsDropdown.jsx');
  const result = withDocsAccountAvatar(source);
  assert.match(result, /aria-label="Account menu"/);
  assert.match(result, /<circle cx="12" cy="8" r="4"/);
  assert.match(result, /className="wd-account-trigger"/);
  assert.doesNotMatch(result, /className=\{`p-2 rounded-lg/);
  assert.doesNotMatch(result, /M10\.325/);
  const after = '{/* Dropdown Menu';
  assert.equal(result.slice(result.indexOf(after)), source.slice(source.indexOf(after)));
  assert.throws(() => withDocsAccountAvatar('changed upstream'), /no longer matches/);
});

test('React and static avatars share a separated head and shoulders', () => {
  const body = accountAvatar.match(/<path d="([^"]+)"/)?.[1];
  assert.equal(body, 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2');
  assert.ok(read('holm/docs-src/src/components/UserDisplay.jsx').includes(body));
  assert.doesNotMatch(accountAvatar, /a8 8/);
});
