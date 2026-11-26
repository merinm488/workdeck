import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { appNames, withPageTitle, withSharedPageTitle } from '../holm/auth/page-title-build.mjs';
import { withPageBoot } from '../holm/auth/navigation-build.mjs';

const shell = '<html><head><title>Legacy app tagline</title></head><body></body></html>';

test('all eleven apps use app-only home titles and filename-only file titles', () => {
  assert.equal(Object.keys(appNames).length, 11);
  for (const [app, name] of Object.entries(appNames)) {
    const page = withPageBoot(shell.replace('<html>', `<html data-wd-app="${app}">`));
    assert.equal(page.match(/<title>([^<]*)<\/title>/)[1], name);
    const runtime = page.match(/<script data-wd-page-title>([\s\S]*?)<\/script>/)[1];
    const window = {}, document = { title: name };
    runInNewContext(runtime, { window, document });
    const titles = window.WDPageTitle;
    for (const file of ['test', 'Plan v2.3', 'report.pdf', 'test.Minutes', 'Report & <review>', '日本語 📝']) {
      titles.file(file);
      assert.equal(document.title, file);
    }
    titles.file('  Renamed file  ');
    assert.equal(document.title, 'Renamed file');
    for (const empty of ['', '  ', null, undefined]) {
      titles.file(empty);
      assert.equal(document.title, 'Untitled');
    }
    titles.home();
    assert.equal(document.title, name, 'returning home clears the previous filename');
  }
});

test('Workdeck and public blog branding are not overwritten by app-title bootstrapping', () => {
  for (const app of ['home', 'blog-public', undefined]) assert.equal(withPageTitle(shell, app), shell);
});

test('shared viewers use the same formatter without changing headings or legacy source', () => {
  for (const app of ['sheets', 'forms', 'slides', 'draw']) {
    const source = readFileSync(new URL(`../${app}/js/shared.js`, import.meta.url), 'utf8');
    assert.match(source, /document\.title =/);
    const built = withSharedPageTitle(source, app);
    assert.doesNotMatch(built, /document\.title =/);
    assert.match(built, /window\.WDPageTitle\?\.file\(/);
    assert.throws(() => withSharedPageTitle('', app), /Missing .* shared tab title/);
  }
});
