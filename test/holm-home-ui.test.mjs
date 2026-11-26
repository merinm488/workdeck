import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeComponentCSS, homeIconsJS, withHomeUI } from '../holm/auth/home-ui-build.mjs';
import { runInNewContext } from 'node:vm';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('app home components and app icons are generated from Workdeck, not separate copies', () => {
  const source = read('public/workdeck.css');
  const css = homeComponentCSS(source);
  for (const selector of ['.wd-file-card', '.wd-file-preview', '.wd-search-input', '.wd-project-form', '.wd-color-swatch', '.wd-side-action', '.wd-modal-content']) {
    const start = source.indexOf(selector + ' {');
    assert.ok(start >= 0);
    assert.ok(css.includes(source.slice(start, source.indexOf('}', start) + 1)), selector);
  }
  const window = {};
  runInNewContext(homeIconsJS(read('public/index.html')), { window });
  for (const app of ['docs', 'sheets', 'forms', 'slides', 'draw', 'todo', 'kanban', 'blog', 'minutes']) assert.match(window.WDHomeIcons[app], /^<svg/);
});

test('shared scripts are outside the dashboard sandbox template', () => {
  const page = '<html><head></head><body><template><body>inert</body></template><main>home</main></body></html>';
  const built = withHomeUI(page);
  for (const script of ['tag-ui', 'home-ui', 'home-icons', 'previews', 'search-suggestions']) {
    assert.ok(built.indexOf(`src="/js/${script}.js"`) > built.indexOf('</template>'));
    assert.equal(built.split(`src="/js/${script}.js"`).length, 2);
  }
  assert.match(built, /href="\/home-components.css"/);
  assert.ok(built.indexOf('src="/js/search-suggestions.js"') < built.indexOf('src="/js/home-ui.js"'));
});

test('all static app homes omit redundant title ribbons without removing controls', () => {
  const homes = {
    sheets: ['sheets/index.html', 'searchInput', 'spreadsheetsContainer', 'createFirstSheetBtn'],
    forms: ['forms/index.html', 'homeSearchInput', 'homeGrid', 'emptyNewFormBtn'],
    slides: ['slides/index.html', 'homeSearchInput', 'homeGrid', 'emptyNewDeckBtn'],
    draw: ['draw/index.html', 'homeSearchInput', 'homeGrid', 'emptyNewDrawingBtn'],
    todo: ['holm/todo/index.html', 'listsSearchInput', 'listsGrid', 'emptyNewListBtn'],
    kanban: ['kanban/index.html', 'listsSearchInput', 'boardsGrid', 'emptyNewBoardBtn'],
    blog: ['blog/index.html', 'postsSearch', 'postsList', 'emptyNewPostBtn'],
    calendar: ['calendar/index.html', 'searchInput', 'pageTitle'],
    files: ['files/index.html', 'fbSearchInput', 'fbBreadcrumb', 'fbGrid'],
    minutes: ['holm/minutes/index.html', 'search', 'meetingList', 'newBtn'],
  };
  for (const [app, [file, ...controls]] of Object.entries(homes)) {
    const built = withHomeUI(read(file));
    assert.doesNotMatch(built, /class="(?:home-toolbar|lists-toolbar|home-view-indicator)"/, app);
    for (const id of controls) assert.ok(built.includes(`id="${id}"`), `${app}: ${id} retained`);
  }
  const docs = read('holm/docs-src/src/App.jsx');
  assert.doesNotMatch(docs, /Folder\/View indicator|<h2\b|All Docs|Unknown Tag/);
  for (const component of ['SearchBar', 'TagList', 'DocCard', 'DocListView']) assert.ok(docs.includes(`<${component}`));
  assert.match(docs, /onClick=\{handleCreateDoc\}/);
  assert.match(docs, /filteredDocs\.map/);
});

test('ribbon removal never consumes functional toolbars or editor headings', () => {
  const controls = '<div class="home-toolbar"><h2>Files</h2><button>New file</button></div>';
  const heading = '<div class="editor-toolbar"><h2>Document title</h2></div>';
  const built = withHomeUI(`<html><head></head><body>${controls}${heading}</body></html>`);
  assert.ok(built.includes(controls));
  assert.ok(built.includes(heading));
});

test('all home lists share Docs geometry without applying it to cards or editors', () => {
  const css = read('holm/auth/home-ui.css');
  assert.match(css, /--wd-home-list-width:1024px/);
  assert.match(css, /--wd-home-list-row-height:51px/);
  assert.match(css, /@media \(max-width:639px\)[^}]*--wd-home-list-row-height:53px/);
  const widthRule = css.split('\n').find(line => line.includes('max-width:var(--wd-home-list-width)'));
  for (const selector of ['.wd-home-list', '.wd-app-table-head', '.wd-app-items.as-list', '.wd-file-list-head', '#filesList', '.fb-list-head', '#fbList']) assert.ok(widthRule.includes(selector), selector);
  assert.doesNotMatch(widthRule, /wd-home-grid|wd-home-card|editor/);
  const rowRule = css.split('\n').find(line => line.includes('height:var(--wd-home-list-row-height)'));
  for (const selector of ['.wd-app-items.as-list > [data-id]', '#filesList > .wd-file-row', '#fbList > .fb-row', '.wd-home-list .docs-list-grid + .docs-list-grid']) assert.ok(rowRule.includes(selector), selector);
  assert.match(read('holm/docs-src/src/App.jsx'), /className="wd-home-list max-w-5xl mx-auto"/);
});

test('every tag sidebar uses the same controller, including React Docs and Workdeck', () => {
  for (const file of ['holm/auth/dashboard.js', 'holm/auth/app-sidebar.js', 'holm/files/main.js', 'holm/docs-src/src/components/TagList.jsx']) assert.match(read(file), /WDTagUI\.mount/);
  const tagUI = read('holm/auth/tag-ui.js');
  assert.doesNotMatch(tagUI, /\b(?:prompt|confirm)\(/);
  assert.match(tagUI, /dialog\.showModal\(\)/);
  assert.match(tagUI, /Files and folders in Files keep existing but lose this tag/);
  assert.match(tagUI, /if \(busy\) event\.preventDefault\(\)/);
  assert.match(tagUI, /role="alert"/);
  assert.match(tagUI, /event\.target === row/); // row keyboard activation never steals action keys
  assert.match(read('holm/docs-src/src/hooks/useDocs.js'), /setDocs\(prev => prev\.filter\(doc => doc\.tagId !== tagId\)\)/);
});
