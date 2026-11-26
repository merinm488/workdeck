import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildThemeTokens, withSuiteTheme } from '../holm/auth/theme-build.mjs';
import { withSheetEditorTheme, withSharedSheetTheme } from '../holm/sheets/theme-build.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const home = read('public/workdeck.css');
const css = read('holm/auth/suite-theme.css');

test('Holm palette and utility ramps are derived from the Home reference', () => {
  const tokens = buildThemeTokens(home);
  for (const block of [home.match(/:root\s*\{([^}]+)\}/)[1], home.match(/html\[data-theme="light"\]\s*\{([^}]+)\}/)[1]]) {
    for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      assert.ok(tokens.includes(`--wd-ui-${name}: ${value};`), name);
    }
  }
  assert.match(tokens, /--wd-ui-bg-rgb: 10 10 10;/);
  assert.match(tokens, /--wd-ui-neutral-800: #141414;/);
  assert.match(tokens, /--wd-ui-neutral-50-rgb: 247 247 245;/);
  // A reference change propagates to both normal CSS and third-party utilities.
  const changed = buildThemeTokens(home.replace('--bg-elevated: #141414;', '--bg-elevated: #161616;'));
  assert.match(changed, /--wd-ui-neutral-800-rgb: 22 22 22;/);
  assert.throws(() => buildThemeTokens(''), /palettes/);
});

test('primary labels have accessible contrast in both Home themes', () => {
  const luminance = hex => {
    const rgb = hex.match(/\w\w/g).map(h => parseInt(h,16)/255).map(v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722;
  };
  for (const fill of ['facc15','eab308']) {
    assert.ok((luminance(fill)+.05)/(luminance('0a0a0a')+.05) >= 4.5);
  }
  assert.ok((luminance('ffffff')+.05)/(luminance('a16207')+.05) >= 4.5, 'light-theme accent text');
  assert.match(buildThemeTokens(home), /--wd-ui-on-accent: #0a0a0a;/);
});

test('pre-paint theme supports light, dark, system, invalid and blocked storage without changing the preference', () => {
  const script = read('holm/auth/suite-theme.js');
  for (const [stored, systemDark, expected] of [
    [null,false,'dark'],['broken',false,'dark'],['light',true,'light'],
    ['dark',false,'dark'],['system',false,'light'],['system',true,'dark'],
  ]) {
    const classes = new Set();
    const element = {dataset:{wdApp:'docs'},classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}}};
    runInNewContext(script, {document:{documentElement:element},localStorage:{getItem:()=>stored},matchMedia:()=>({matches:systemDark})});
    assert.equal(element.dataset.theme,expected);
    assert.equal(classes.has('dark'), expected==='dark');
  }
  const element = {dataset:{wdApp:'todo'}};
  runInNewContext(script,{document:{documentElement:element},localStorage:{getItem(){throw Error('blocked');}}});
  assert.equal(element.dataset.theme,'dark');
});

test('suite chrome supplies neutral sidebars, semantic actions and interaction states without recoloring canvases', () => {
  assert.match(css, /\.wd-sidebar, \.wd-app-sidebar, \.fb-sidebar, \.cal-sidebar, \.wd-docs-sidebar/);
  assert.match(css, /--wd-side-bg: var\(--wd-ui-bg\)/);
  assert.match(css, /--wd-menu-surface: var\(--wd-ui-bg-elevated\)/);
  assert.match(css, /\.home-confirm-delete-btn[\s\S]*?background: var\(--wd-ui-danger\)/);
  assert.match(css, /:focus-visible[\s\S]*?outline: 2px solid var\(--wd-control-focus\)/);
  assert.match(css, /:disabled[\s\S]*?cursor: not-allowed/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /(?:^|\n)[^\n{]*(?:canvas|\.upper-canvas|\.lower-canvas)\s*\{/);
});

test('shared design preserves app accents instead of assigning Home yellow to every app', () => {
  assert.match(css, /--wd-control-accent: var\(--accent-color, var\(--accent\)\)/);
  assert.match(css, /--wd-control-accent: var\(--fb-accent\)/);
  assert.match(css, /--wd-control-accent: rgb\(var\(--accent\)\)/);
  assert.match(css, /--wd-control-accent: var\(--minutes-primary\)/);
  // Shared neutrals must not redefine the apps' color/highlight variables.
  assert.doesNotMatch(css, /(?:^|\n)\s*--(?:accent(?:-color|-hover|-light|-soft)?|fb-accent(?:-soft)?|green(?:-soft)?):/);
  assert.doesNotMatch(css, /(?:background|color|border-color|accent-color): var\(--wd-ui-(?:accent|focus|on-accent)/);
  assert.match(css, /background: var\(--wd-control-accent\)/);
  assert.match(css, /background: var\(--wd-control-soft\)/);
  assert.match(read('draw/styles.css'), /--accent-color: #e11d48/);
  assert.match(read('draw/styles.css'), /--accent-color: #fb7185/);
});

test('Minutes editor and shared controls derive their purple identity from Home', () => {
  const minutes = read('holm/minutes/styles.css');
  const tokens = buildThemeTokens(home);
  assert.match(tokens, /--wd-ui-minutes-accent: #5451a6;/);
  assert.match(tokens, /--wd-ui-minutes-accent-soft: rgba\(84, 81, 166, \.12\);/);
  assert.match(minutes, /--minutes-primary:var\(--wd-ui-minutes-accent,#5451a6\)/);
  assert.match(minutes, /--minutes-accent-soft:var\(--wd-ui-minutes-accent-soft,/);
  assert.match(minutes, /:root\[data-theme="dark"\],body\.dark\{--minutes-accent:#b5b2ef;/);
  assert.match(css, /--wd-control-soft: var\(--minutes-accent-soft\)/);
  assert.match(css, /--wd-control-focus: var\(--minutes-accent\)/);
  assert.doesNotMatch(minutes + css, /#(?:276b53|98d4b5|e9f3ee|203c30)|var\(--green/);
  const changed = buildThemeTokens(home.replace('--minutes-accent: #5451a6;', '--minutes-accent: #5552a7;'));
  assert.match(changed, /--wd-ui-minutes-accent: #5552a7;/, 'Home palette changes propagate to Minutes');
});

test('Minutes purple labels meet normal-text contrast in light and dark themes', () => {
  const luminance = hex => {
    const rgb = hex.match(/\w\w/g).map(h => parseInt(h, 16) / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const [foreground, background] of [['ffffff', '5451a6'], ['5451a6', 'ffffff'], ['b5b2ef', '141414']]) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, foreground + ' on ' + background);
  }
});

test('Univer dark-mode adapter passes a boolean and shared views follow theme changes without writes', () => {
  const editor = withSheetEditorTheme(read('sheets/js/spreadsheet.js'));
  assert.match(editor, /toggleDarkMode\(wantDark\)/);
  assert.doesNotMatch(editor, /toggleDarkMode\(\)/);
  const shared = withSharedSheetTheme(read('sheets/js/shared.js'));
  assert.match(shared, /themeManager\.init\(\)/);
  assert.match(shared, /toggleDarkMode\(document\.documentElement\.dataset\.theme === 'dark'\)/);
  assert.match(shared, /attributeFilter: \['data-theme'\]/);
  assert.match(shared, /fWorkbook\.setEditable\(false\)/);
  assert.throws(()=>withSheetEditorTheme('upstream changed'), /no longer matches/);
});

test('Docs and Minutes synchronize their effective theme on system and cross-tab changes', () => {
  const docs = read('holm/docs-src/src/hooks/useTheme.js');
  assert.match(docs, /if \(localStorage\.getItem\('workdeck_theme'\) === 'system'\) applyTheme\(effective\)/);
  assert.match(docs, /setAttribute\('data-theme', themeValue\)/);
  const minutes = read('holm/minutes/app.js');
  assert.match(minutes, /matchMedia\('\(prefers-color-scheme: dark\)'\)\.addEventListener\('change'/);
  assert.match(minutes, /setAttribute\('data-theme', dark \? 'dark' : 'light'\)/);
  assert.match(minutes, /includes\(stored\) \? stored : 'dark'/);
});

test('Holm packages theme assets on every app home, editor and public viewer, after app styles', () => {
  const dir = mkdtempSync(join(tmpdir(),'holm-suite-theme-'));
  try {
    execFileSync(process.execPath,[new URL('../scripts/build-holm-landing.mjs',import.meta.url).pathname,dir],{stdio:'pipe'});
    const pages = ['home.html','docs/index.html',...['todo','kanban','minutes','calendar','sheets','forms','slides','draw','files','blog'].map(app=>`${app}/index.html`),
      ...['sheets','forms','slides','draw'].flatMap(app=>[`${app}/editor.html`,`${app}/shared.html`])];
    for (const path of pages) {
      const page = readFileSync(join(dir,path === 'home.html' ? 'api' : 'web',path),'utf8');
      assert.match(page, /<html data-wd-app="[a-z]+"/, path);
      assert.equal((page.match(/src="\/js\/suite-theme\.js"/g)||[]).length,1,path);
      assert.match(page, /href="\/suite-tokens\.css"/, path);
      assert.match(page, /href="\/suite-theme\.css"/, path);
      assert.ok(page.indexOf('suite-theme.js') < page.indexOf('<body'), path);
      if (!path.startsWith('docs/')) assert.ok(page.indexOf('suite-theme.css') > page.lastIndexOf('href="styles.css"'),path);
    }
    assert.equal(readFileSync(join(dir,'web/suite-tokens.css'),'utf8'),buildThemeTokens(home));
    assert.equal(readFileSync(join(dir,'web/suite-theme.css'),'utf8'),css);
    assert.match(readFileSync(join(dir,'web/sheets/js/spreadsheet.js'),'utf8'), /toggleDarkMode\(wantDark\)/);
    assert.match(readFileSync(join(dir,'web/sheets/js/shared.js'),'utf8'), /this\.themeObserver/);
    // Marketing and public blog article designs aren't workspace chrome.
    assert.doesNotMatch(readFileSync(join(dir,'api/landing.html'),'utf8'), /data-wd-app/);
    assert.doesNotMatch(readFileSync(join(dir,'web/blog-public.html'),'utf8'), /data-wd-app/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('theme wrapper retains existing content and applies before app scripts', () => {
  const wrapped = withSuiteTheme('<html lang="en"><head><script src="app.js"></script></head><body>unchanged</body></html>','todo');
  assert.ok(wrapped.indexOf('suite-theme.js')<wrapped.indexOf('app.js'));
  assert.ok(wrapped.endsWith('<body>unchanged</body></html>'));
});
