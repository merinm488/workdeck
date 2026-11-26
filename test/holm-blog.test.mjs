import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { handleBlog, handleSite, publicArticle } from '../holm/blog/api.js';
import { handleWorkspace } from '../holm/auth/workspace.js';

function fixture() {
  let seq = 0;
  const members = new Map(), publicRows = new Map();
  const clone = value => value == null ? value : structuredClone(value);
  const realm = rows => {
    const col = name => { if (!rows.has(name)) rows.set(name, new Map()); return rows.get(name); };
    const ds = {
      find: (name, query = {}, opts = {}) => {
        const found = [...col(name).values()].filter(row => Object.entries(query).every(([key, value]) => row[key] === value));
        return (opts.order === 'desc' ? found.reverse() : found).slice(0, opts.limit || Infinity).map(clone);
      },
      findOne: (name, id) => clone(col(name).get(typeof id === 'string' ? id : id.id) || null),
      count: name => col(name).size,
      insert: (name, record) => { const id = `record_${++seq}_abcdef`; col(name).set(id, clone({ ...record, id })); return id; },
      update: (name, query, patch) => col(name).set(query.id, clone({ ...col(name).get(query.id), ...patch.$set })),
      delete: (name, query) => col(name).delete(query.id),
      transaction: fn => fn(ds),
    };
    return ds;
  };
  const globalDS = realm(publicRows);
  const web = { fetch: request => new Response(`shell:${new URL(request.url).pathname}`, {
    status: new URL(request.url).pathname === '/blog-public' ? 200 : 404,
  }) };
  function member(id) {
    if (!members.has(id)) members.set(id, { rows: new Map(), kv: new Map() });
    const { rows, kv } = members.get(id);
    return { holm: { auth: { getMember: () => ({ id }) }, app: {
      member: { ds: realm(rows), kv: { get: key => clone(kv.get(key)), set: (key, value) => kv.set(key, clone(value)) } },
      ds: globalDS,
    }, web } };
  }
  const anon = { holm: { auth: { getMember: () => null }, app: { ds: globalDS }, web } };
  async function call(handler, env, method = 'GET', body, path, origin = 'https://workdeck.test') {
    const route = path || (handler === handleBlog ? '/api/blog' : handler === handleSite ? '/api/site' : '/api/workdeck');
    const request = new Request('https://workdeck.test' + route, {
      method, headers: body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return handler(request, env);
  }
  async function json(...args) { const response = await call(...args); return { status: response.status,
    body: await response.json(), headers: response.headers }; }
  const put = (handler, env, action, data, origin) => json(handler, env, 'PUT', { action, data }, undefined, origin);
  const site = (env, slug, method = 'GET') => json(handleSite, env, method, undefined, `/api/site?slug=${slug}`);
  return { member, anon, call, json, put, site, globalDS };
}

test('Blog drafts stay private; public API reveals only published whitelisted snapshots', async () => {
  const { member, anon, json, put, site, globalDS } = fixture();
  const alice = member('alice'), bob = member('bob');
  assert.equal((await json(handleBlog, anon)).status, 401);
  assert.equal((await site(anon, 'private-entry')).status, 404);
  assert.equal((await site(anon, 'private-entry', 'PUT')).status, 405);
  assert.equal((await put(handleBlog, alice, 'createPost', { title: 'Oops' }, 'https://evil.test')).status, 403);
  assert.equal((await json(handleBlog, alice, 'PUT', { hash: 'bob', action: 'createPost', data: {} })).status, 400);
  const created = await put(handleBlog, alice, 'createPost', {
    title: 'Private Entry', html: '<p>Draft</p><script>steal()</script>', });
  assert.equal(created.status, 200);
  const post = created.body.post;
  assert.equal(post.slug, 'private-entry');
  assert.equal(created.body.data.posts[0].id, post.id);
  assert.equal((await json(handleBlog, bob)).body.data.posts.length, 0);
  assert.equal((await put(handleBlog, bob, 'publishPost', { id: post.id, slug: 'private-entry' })).status, 404);
  assert.equal((await put(handleBlog, bob, 'updatePost', { id: post.id, html: 'mine' })).status, 404);
  assert.equal((await site(bob, 'private-entry')).status, 404);
  assert.equal((await put(handleBlog, alice, 'publishPost', { id: post.id, slug: 'files' })).status, 400);
  assert.equal((await put(handleBlog, alice, 'updatePost', { id: post.id, html: '<p>Public</p><img onerror="alert(1)" src="javascript:evil()"><style>bad</style>' })).status, 200);
  const published = await put(handleBlog, alice, 'publishPost', { id: post.id, slug: 'private-entry' });
  assert.equal(published.status, 200);
  assert.equal(published.body.blog.postUrl, 'https://workdeck.test/private-entry');
  const response = await site(anon, 'private-entry');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.body.site.slug, 'private-entry');
  assert.equal(response.body.post.title, 'Private Entry');
  assert.doesNotMatch(JSON.stringify(response.body), /ownerMemberId|tagId|hash|steal\(|onerror|javascript:|<style>/);
  assert.equal(globalDS.find('blog_public_posts', {}, { limit: 200 }).length, 1);
  assert.equal((await site(anon, 'bogus-post')).status, 404);
  assert.equal((await put(handleBlog, bob, 'publishPost', { id: post.id, slug: 'another-entry' })).status, 404);
  const theirs = (await put(handleBlog, bob, 'createPost', { title: 'Theirs' })).body.post;
  assert.equal((await put(handleBlog, bob, 'publishPost', { id: theirs.id, slug: 'private-entry' })).status, 409);
  assert.equal((await site(bob, 'private-entry')).status, 200); // public to every visitor
  assert.equal((await json(handleBlog, bob)).body.data.posts[0].html, '');
});

test('Blog unpublish, republish, change link, delete, and cross-member claims', async () => {
  const { member, anon, put, site } = fixture();
  const alice = member('alice'), bob = member('bob');
  const post = (await put(handleBlog, alice, 'createPost', { title: 'First' })).body.post;
  const other = (await put(handleBlog, bob, 'createPost', { title: 'Second' })).body.post;
  assert.equal((await put(handleBlog, alice, 'publishPost', { id: post.id, slug: 'first-link' })).status, 200);
  assert.equal((await put(handleBlog, alice, 'publishPost', { id: post.id, slug: 'new-link' })).status, 409);
  assert.equal((await put(handleBlog, alice, 'unpublishPost', { id: post.id })).status, 200);
  assert.equal((await site(anon, 'first-link')).status, 404);
  assert.equal((await put(handleBlog, bob, 'publishPost', { id: other.id, slug: 'first-link' })).status, 409);
  assert.equal((await put(handleBlog, alice, 'publishPost', { id: post.id, slug: 'new-link' })).status, 200);
  assert.equal((await site(anon, 'first-link')).status, 404);
  assert.equal((await site(anon, 'new-link')).status, 200);
  assert.equal((await put(handleBlog, bob, 'publishPost', { id: other.id, slug: 'first-link' })).status, 200);
  assert.equal((await put(handleBlog, bob, 'deletePost', { id: post.id })).status, 404);
  assert.equal((await put(handleBlog, alice, 'deletePost', { id: post.id })).status, 200);
  assert.equal((await site(anon, 'new-link')).status, 404);
  assert.equal((await put(handleBlog, bob, 'publishPost', { id: other.id, slug: 'new-link' })).status, 409); // must unpublish before moving
  assert.equal((await put(handleBlog, bob, 'unpublishPost', { id: other.id })).status, 200);
  assert.equal((await put(handleBlog, bob, 'publishPost', { id: other.id, slug: 'new-link' })).status, 200);
});

test('Blog integrates with workspace, title/setting changes, tag cascade, and reload-safe routes', async () => {
  const { member, anon, put, site, json, call } = fixture();
  const alice = member('alice'), bob = member('bob');
  const tag = (await put(handleWorkspace, alice, 'createTag', { name: 'Thoughts' })).body.data.tags[0];
  const workspace = (await put(handleWorkspace, alice, 'createPost', { tagId: tag.id })).body.data;
  const post = workspace.posts[0];
  assert.equal(post.tagId, tag.id);
  assert.equal((await put(handleWorkspace, alice, 'recordOpen', { app: 'blog', fileId: post.id })).body.data.settings.lastOpened[post.id] !== undefined, true);
  assert.equal((await put(handleWorkspace, bob, 'renameFile', { app: 'blog', fileId: post.id, name: 'Stolen' })).status, 404);
  assert.equal((await put(handleWorkspace, alice, 'renameFile', { app: 'blog', fileId: post.id, name: 'My Thoughts' })).body.data.posts[0].slug, 'my-thoughts');
  assert.equal((await put(handleBlog, alice, 'publishPost', { id: post.id, slug: 'my-thoughts' })).status, 200);
  assert.equal((await put(handleWorkspace, alice, 'renameFile', { app: 'blog', fileId: post.id, name: 'Renamed' })).status, 200);
  assert.equal((await site(anon, 'my-thoughts')).body.post.title, 'Renamed');
  assert.equal((await put(handleBlog, alice, 'updateBlogSettings', { title: 'Little Garden', description: 'Shared stories' })).status, 200);
  assert.equal((await site(anon, 'my-thoughts')).body.blog.title, 'Little Garden');
  assert.equal((await json(handleWorkspace, bob)).body.data.posts.length, 0);
  assert.equal(publicArticle(anon, 'my-thoughts')?.post.title, 'Renamed');
  assert.equal(publicArticle(anon, 'unpublished-entry'), null);
  const deletedTag = await put(handleWorkspace, alice, 'deleteTag', { tagId: tag.id });
  assert.equal(deletedTag.body.data.posts.length, 0);
  assert.equal((await site(anon, 'my-thoughts')).status, 404);
  assert.equal((await put(handleWorkspace, bob, 'createPost', { tagId: tag.id })).body.data.posts[0].tagId, null);
  const next = (await put(handleWorkspace, alice, 'createPost', {})).body.data.posts[0];
  assert.equal((await put(handleBlog, alice, 'publishPost', { id: next.id, slug: 'second-thoughts' })).status, 200);
  assert.equal((await put(handleWorkspace, bob, 'deleteFile', { app: 'blog', fileId: next.id })).status, 404);
  assert.equal((await put(handleWorkspace, alice, 'deleteFile', { app: 'blog', fileId: next.id })).status, 200);
  assert.equal((await site(anon, 'second-thoughts')).status, 404);
});

test('Blog header back link returns from the editor to Blog without losing a pending save', () => {
  const source = readFileSync(new URL('../holm/blog/app.js', import.meta.url), 'utf8');
  const views = source.slice(source.indexOf('function setBackLink('), source.indexOf('// ================================================\n// Posts home'));
  const back = source.slice(source.indexOf('function handleHomeLinkClick('), source.indexOf('function wireChrome()'));
  const elements = new Map();
  const node = () => ({ classList: { add() {}, remove() {} }, setAttribute(key, value) { this[key] = value; } });
  const $ = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const link = node(), state = { editingId: 'post-1' }, history = { replaceState(_data, _unused, url) { this.url = url; } };
  let closed = 0;
  const ui = runInNewContext(`${views}\n${back}\n({ showPostsView, showEditorView, handleHomeLinkClick })`, {
    state, $, window: {}, document: { querySelector: selector => selector === '.blog-home-link' ? link : node() },
    history, renderPosts() {}, refreshPublishMenu() {},
    BlogEditor: { close() { closed++; state.editingId = null; ui.showPostsView(); } },
  });
  ui.showEditorView();
  assert.equal(link.href, '/blog/');
  assert.equal(link['aria-label'], 'Back to Blog');
  const click = { button: 0, preventDefault() { this.prevented = true; } };
  ui.handleHomeLinkClick(click);
  assert.equal(click.prevented, true);
  assert.equal(closed, 1);
  assert.equal(link.href, '/home'); // Workspace, not the public landing page
  assert.equal(history.url, '/blog/');
  ui.showEditorView();
  ui.handleHomeLinkClick({ button: 0, metaKey: true, preventDefault() { throw new Error('Modified click intercepted'); } });
  assert.equal(closed, 1);
});

test('Blog cards expose rename and delete to the shared list actions menu', async () => {
  const source = readFileSync(new URL('../holm/blog/app.js', import.meta.url), 'utf8');
  const render = source.slice(source.indexOf('function renderPosts()'), source.indexOf('async function createPost()'));
  const node = () => ({ children: [], dataset: {}, classList: { toggle() {} },
    append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); },
    prepend(item) { this.children.unshift(item); }, setAttribute(key, value) { this[key] = value; },
    addEventListener(event, fn) { this[event] = fn; }, remove() {} });
  const row = node(), title = node(), publicBadge = node(), excerpt = node(), date = node(), head = node();
  row.querySelector = selector => ({ '.blog-post-row-title': title, '.blog-post-row-public': publicBadge,
    '.blog-post-row-excerpt': excerpt, '.blog-post-row-date': date, '.blog-post-row-head': head })[selector];
  const list = node(), template = { content: { firstElementChild: { cloneNode: () => row } } };
  const elements = { postsList: list, blogPostRowTemplate: template, postsEmpty: node(), postsEmptySearch: node(), kanbanFooterStats: node() };
  const state = { posts: [{ id: 'post-1', title: 'First', excerpt: 'An excerpt', createdAt: '2026-01-01' }], searchQuery: '', settings: {} };
  let updated, deleted, dialog, reloads = 0;
  const ui = runInNewContext(`${render}; ({ renderPosts, renamePost, deletePostFromHome })`, {
    state, $: id => elements[id], document: { createElement: node }, window: { location: { reload() { reloads++; } } },
    WDDialog: { open(options) { dialog = options; } }, blogStorage: {
      request: async (action, data) => { updated = { action, data }; return { success: true, data: { posts: [{ ...state.posts[0], title: data.title }] } }; },
      deletePost: async id => { deleted = id; return { posts: [] }; },
    }, showToast() {}, openPost() {},
  });
  ui.renderPosts();
  assert.equal(list.children.length, 1);
  assert.equal(title.textContent, 'First');
  assert.equal(head.children[0].className, 'blog-post-row-icon');
  const actions = row.children.find(item => item.className === 'blog-post-row-actions');
  assert.equal(actions.children.length, 2);
  assert.equal(actions.children[0].getAttribute?.('aria-label') || actions.children[0]['aria-label'], 'Rename');
  assert.equal(actions.children[1]['aria-label'], 'Delete');
  ui.renamePost(state.posts[0]);
  assert.equal(dialog.title, 'Rename post');
  assert.equal(dialog.field.value, 'First');
  assert.equal(dialog.field.maxLength, 200);
  assert.equal(updated, undefined, 'Opening is not a mutation');
  await dialog.onSubmit('Renamed');
  assert.equal(updated.action, 'updatePost');
  assert.deepEqual({ ...updated.data }, { id: 'post-1', title: 'Renamed' });
  ui.deletePostFromHome(state.posts[0]);
  assert.equal(dialog.danger, true);
  assert.equal(deleted, undefined, 'Opening is not deletion');
  await dialog.onSubmit();
  assert.equal(deleted, 'post-1');
  assert.equal(title.textContent, 'Renamed');
  assert.equal(state.posts.length, 0);
  assert.equal(reloads, 0, 'CRUD updates the view without a full-page navigation');
  const sidebar = readFileSync(new URL('../holm/auth/app-sidebar.js', import.meta.url), 'utf8');
  assert.match(sidebar, /blog: \{[^\n]+actions: '\.blog-post-row-actions'/);
  assert.match(readFileSync(new URL('../holm/auth/app-sidebar.css', import.meta.url), 'utf8'), /blog-posts:not\(\.as-list\).*display:grid/);
});

test('Blog package keeps manager/reader UI with local Quill and no access-key controls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'holm-blog-test-'));
  try {
    execFileSync('node', ['scripts/build-holm-landing.mjs', dir], { cwd: process.cwd(), timeout: 120_000, stdio: 'pipe' });
    const editor = readFileSync(join(dir, 'web/blog/index.html'), 'utf8');
    assert.match(editor, /Quill|vendor-quill\.js/);
    assert.match(editor, /publishPostModal|postTitleInput|href="\/account"/);
    assert.doesNotMatch(editor, /View My Key|Your Access Key|Delete Account|cdn\.jsdelivr\.net\/npm\/quill/);
    assert.match(readFileSync(join(dir, 'web/blog-public.html'), 'utf8'), /id="postBody"/);
    assert.match(readFileSync(join(dir, 'web/js/workdeck.js'), 'utf8'), /'filebox', 'blog'/);
    assert.match(readFileSync(join(dir, 'web/blog/js/app.js'), 'utf8'), /searchParams\.set\('post', postId\)/);
    assert.match(readFileSync(join(dir, 'api/main.js'), 'utf8'), /publicArticle\(env, slug\)/);
    assert.match(readFileSync(join(dir, 'web/js/wd-links.js'), 'utf8'), /blog: 'post'/);
    assert.equal(readFileSync(join(dir, 'api/blog.js'), 'utf8').includes('ownerMemberId'), true);
    const { member, anon, call, put } = fixture();
    const alice = member('alice');
    const main = (await import(pathToFileURL(join(dir, 'api/main.js')).href)).default;
    const draft = (await put(handleBlog, alice, 'createPost', { title: 'Live reader' })).body.post;
    const root = '/live-reader';
    assert.equal((await call(main.fetch.bind(main), anon, 'GET', undefined, root)).status, 404);
    assert.equal((await put(handleBlog, alice, 'publishPost', { id: draft.id, slug: 'live-reader' })).status, 200);
    const shell = await call(main.fetch.bind(main), anon, 'GET', undefined, root);
    assert.equal(shell.status, 200);
    assert.equal(await shell.text(), 'shell:/blog-public');
    assert.equal((await put(handleBlog, alice, 'unpublishPost', { id: draft.id })).status, 200);
    assert.equal((await call(main.fetch.bind(main), anon, 'GET', undefined, root)).status, 404);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
