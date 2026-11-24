import { POSTS, revokeBlogPost, refreshPublishedBlogPost } from './blog.js';
import { createPostRecord, slugifyTitle, uniquePostSlug } from './posts.js';
// Suite-wide Holm workspace. Every query runs against Holm's *current member*
// scope; never accept the legacy account hash or a member ID from the browser.
// Other app collections will be registered here as they are migrated.
const TAGS = 'workspace_tags';
const DOCS = 'user_docs';
const SHEETS = 'sheet_records';
const FORMS = 'user_forms';
const SLIDES = 'slide_decks';
const DRAWS = 'canvas_drawings';
const DRAW_SHARES = 'drawing_public_shares';
const SLIDE_SHARES = 'slide_public_shares';
const FORM_SHARES = 'form_public_shares';
const BODIES = 'sheet_bodies';
const THUMBS = 'sheet_thumbs';
const SHEET_SHARES = 'sheet_public_shares';
const FILES = 'file_records';
const FOLDERS = 'file_folders';
const FILE_BYTES = 'file_contents';
const FILE_THUMBS = 'file_thumbs';
const SHARES = 'docs_public_shares';
const TODO = 'todo_lists';
const KANBAN = 'kanban_boards';
const MINUTES = 'meeting_minutes';
const CALENDARS = 'user_calendars';
const EVENTS = 'calendar_events';
const SETTINGS = 'workdeck_settings';
const LIMIT_TAGS = 200;
const LIMIT_LISTS = 200;
const json = (value, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const fail = (message, status) => json({ success: false, error: message }, status);
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const color = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const name = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100;
const tagName = value => name(value) && value.trim().length <= 60;
const fileName = value => typeof value === 'string' && !!value.trim() && value.trim().length <= 255;
const folderColor = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const thumbOK = value => typeof value === 'string' && value.length <= 60_000 &&
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/i.test(value);
function tagIds(ids, tx) {
  if (!Array.isArray(ids)) return [];
  const found = [];
  for (const id of ids.slice(0, 1)) if (validId(id) && tx.findOne(TAGS, id)) found.push(id);
  return found;
}
function folderTree(tx, rootId) {
  const doomed = new Set([rootId]);
  let more = true;
  while (more) {
    more = false;
    for (const folder of tx.find(FOLDERS, {}, { limit: 1000 })) {
      if (folder.parentId && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
        doomed.add(folder.id); more = true;
      }
    }
  }
  return doomed;
}

function settings(kv) {
  return { theme: 'dark', viewMode: 'grid', lastOpened: {}, ...(kv.get(SETTINGS) || {}) };
}
function saveSettings(kv, patch) {
  const next = { ...settings(kv), ...patch };
  kv.set(SETTINGS, next);
  return next;
}
function workspace(ds, kv) {
  return {
    docs: ds.find(DOCS, {}, { limit: 500, order: 'desc' }),
    sheets: ds.find(SHEETS, {}, { limit: 200, order: 'desc' }),
    forms: ds.find(FORMS, {}, { limit: 200, order: 'desc' }),
    slides: ds.find(SLIDES, {}, { limit: 200, order: 'desc' }),
    draws: ds.find(DRAWS, {}, { limit: 200, order: 'desc' }),
    files: ds.find(FILES, {}, { limit: 2000, order: 'desc' }),
    folders: ds.find(FOLDERS, {}, { limit: 1000, order: 'desc' }),
    todo: ds.find(TODO, {}, { limit: LIMIT_LISTS, order: 'desc' }),
    minutes: ds.find(MINUTES, {}, { limit: 200, order: 'desc' }),
    calendars: ds.find(CALENDARS, {}, { limit: 100, order: 'desc' }),
    events: ds.find(EVENTS, {}, { limit: 2000, order: 'desc' }),
    kanban: ds.find(KANBAN, {}, { limit: 200, order: 'desc' }),
    posts: ds.find(POSTS, {}, { limit: 200, order: 'desc' }),
    tags: ds.find(TAGS, {}, { limit: LIMIT_TAGS, order: 'desc' }),
    settings: { ...settings(kv), kanbanCards: (kv.get('todo_settings') || {}).kanbanCards || [] },
  };
}

export async function handleWorkspace(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/workdeck') return fail('Not found.', 404);
  if (!env.holm.auth.getMember()) return fail('Sign in to continue.', 401);
  const { ds, kv } = env.holm.app.member;
  if (request.method === 'GET') return json({ success: true, data: workspace(ds, kv) });
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  if (raw.length > 16_384) return fail('Request too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return fail('Invalid data.', 400);
  const { action, data } = body;
  // Explicitly reject the old protocol even when an attacker has a valid Holm
  // session. No client-selected account, access key, or hash is used here.
  if ('hash' in body || 'key' in body || 'memberId' in body) return fail('Legacy credentials are not accepted.', 400);
  if (action === 'updateSettings') {
    const patch = data.settings;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
        Object.keys(patch).some(key => !['theme', 'viewMode'].includes(key)) ||
        ('theme' in patch && !['dark', 'light', 'system'].includes(patch.theme)) ||
        ('viewMode' in patch && !['grid', 'list'].includes(patch.viewMode))) return fail('Invalid settings.', 400);
    saveSettings(kv, patch);
  } else if (action === 'createTag') {
    if (!tagName(data.name) || (data.color !== undefined && !color(data.color))) return fail('Invalid tag.', 400);
    const created = ds.transaction(tx => {
      if (tx.count(TAGS, {}) >= LIMIT_TAGS) return false;
      tx.insert(TAGS, { name: data.name.trim(), color: data.color || '#FACC15',
        ...(data.origin === 'filebox' ? { origin: 'filebox' } : {}) });
      return true;
    });
    if (!created) return fail('Tag limit reached.', 409);
  } else if (action === 'updateTag') {
    if (!validId(data.tagId) || !data.updates || typeof data.updates !== 'object' ||
        Array.isArray(data.updates) || !Object.keys(data.updates).length ||
        Object.keys(data.updates).some(key => !['name', 'color'].includes(key)) ||
        ('name' in data.updates && !tagName(data.updates.name)) ||
        ('color' in data.updates && !color(data.updates.color))) return fail('Invalid tag.', 400);
    const updated = ds.transaction(tx => {
      if (!tx.findOne(TAGS, data.tagId)) return false;
      const patch = { ...data.updates };
      if (patch.name) patch.name = patch.name.trim();
      tx.update(TAGS, { id: data.tagId }, { $set: patch });
      return true;
    });
    if (!updated) return fail('Tag not found.', 404);
  } else if (action === 'deleteTag') {
    if (!validId(data.tagId)) return fail('Invalid tag.', 400);
    // Deleting a tag deletes tagged single-tag app records. Files and
    // folders are multi-tagged, so they retain their bytes and lose only
    // this tag ID.
    // Revoke shared snapshots before deleting tagged Docs. Public storage
    // is separate from member DS; never leave a deleted doc readable by URL.
    const taggedDocs = ds.find(DOCS, {}, { limit: 500 }).filter(doc => doc.tagId === data.tagId);
    const taggedSheets = ds.find(SHEETS, {}, { limit: 200 }).filter(sheet => sheet.tagId === data.tagId);
    const taggedForms = ds.find(FORMS, {}, { limit: 200 }).filter(form => form.tagId === data.tagId);
    const taggedDecks = ds.find(SLIDES, {}, { limit: 200 }).filter(deck => deck.tagId === data.tagId);
    const taggedDrawings = ds.find(DRAWS, {}, { limit: 200 }).filter(drawing => drawing.tagId === data.tagId);
    const taggedPosts = ds.find(POSTS, {}, { limit: 200 }).filter(post => post.tagId === data.tagId);
    for (const post of taggedPosts) revokeBlogPost(env.holm.app.ds, env.holm.auth.getMember().id, post);
    for (const doc of taggedDocs) if (doc.sharedId) {
      const copy = env.holm.app.ds.find(SHARES, { token: doc.sharedId }, { limit: 1 })[0];
      if (copy) env.holm.app.ds.delete(SHARES, { id: copy.id });
    }
    for (const sheet of taggedSheets) if (sheet.sharedId) {
      const copy = env.holm.app.ds.find(SHEET_SHARES, { token: sheet.sharedId }, { limit: 1 })[0];
      if (copy) env.holm.app.ds.delete(SHEET_SHARES, { id: copy.id });
    }
    for (const form of taggedForms) if (form.sharedId) {
      const copy = env.holm.app.ds.find(FORM_SHARES, { token: form.sharedId }, { limit: 1 })[0];
      if (copy) env.holm.app.ds.delete(FORM_SHARES, { id: copy.id });
    }
    for (const deck of taggedDecks) if (deck.sharedId) {
      const copy = env.holm.app.ds.find(SLIDE_SHARES, { token: deck.sharedId }, { limit: 1 })[0];
      if (copy) env.holm.app.ds.delete(SLIDE_SHARES, { id: copy.id });
    }
    for (const drawing of taggedDrawings) if (drawing.sharedId) {
      const copy = env.holm.app.ds.find(DRAW_SHARES, { token: drawing.sharedId }, { limit: 1 })[0];
      if (copy) env.holm.app.ds.delete(DRAW_SHARES, { id: copy.id });
    }
    const deleted = ds.transaction(tx => {
      if (!tx.findOne(TAGS, data.tagId)) return null;
      const ids = tx.find(TODO, {}, { limit: LIMIT_LISTS }).filter(row => row.tagId === data.tagId).map(row => row.id);
      const boardIds = tx.find(KANBAN, {}, { limit: 200 }).filter(row => row.tagId === data.tagId).map(row => row.id);
      const meetingIds = tx.find(MINUTES, {}, { limit: 200 }).filter(row => row.tagId === data.tagId).map(row => row.id);
      const calendarIds = tx.find(CALENDARS, {}, { limit: 100 }).filter(row => row.tagId === data.tagId).map(row => row.id);
      const docIds = tx.find(DOCS, {}, { limit: 500 }).filter(row => row.tagId === data.tagId).map(row => row.id);
      const sheetIds = tx.find(SHEETS, {}, { limit: 200 }).filter(row => row.tagId === data.tagId).map(row => row.id);
      const formIds = tx.find(FORMS, {}, { limit: 200 }).filter(row => row.tagId === data.tagId).map(row => row.id);
      const deckIds = tx.find(SLIDES, {}, { limit: 200 }).filter(row => row.tagId === data.tagId).map(row => row.id);
      const drawIds = tx.find(DRAWS, {}, { limit: 200 }).filter(row => row.tagId === data.tagId).map(row => row.id);
      const postIds = tx.find(POSTS, {}, { limit: 200 }).filter(row => row.tagId === data.tagId).map(row => row.id);
      for (const id of ids) tx.delete(TODO, { id });
      for (const id of docIds) tx.delete(DOCS, { id });
      for (const id of sheetIds) tx.delete(SHEETS, { id });
      for (const id of formIds) tx.delete(FORMS, { id });
      for (const id of deckIds) tx.delete(SLIDES, { id });
      for (const id of drawIds) tx.delete(DRAWS, { id });
      for (const id of postIds) tx.delete(POSTS, { id });
      for (const body of tx.find(BODIES, {}, { limit: 200 }))
        if (sheetIds.includes(body.sheetId)) tx.delete(BODIES, { id: body.id });
      for (const thumb of tx.find(THUMBS, {}, { limit: 200 }))
        if (sheetIds.includes(thumb.sheetId)) tx.delete(THUMBS, { id: thumb.id });
      for (const id of boardIds) tx.delete(KANBAN, { id });
      for (const id of meetingIds) tx.delete(MINUTES, { id });
      for (const id of calendarIds) tx.delete(CALENDARS, { id });
      for (const e of tx.find(EVENTS, {}, { limit: 2000 })) {
        if (calendarIds.includes(e.calId)) tx.delete(EVENTS, { id: e.id });
      }
      for (const [collection, limit] of [[FILES, 2000], [FOLDERS, 1000]]) {
        for (const record of tx.find(collection, {}, { limit })) {
          if (record.tags?.includes(data.tagId))
            tx.update(collection, { id: record.id }, { $set: {
              tags: record.tags.filter(id => id !== data.tagId), updatedAt: new Date().toISOString(),
            } });
        }
      }
      tx.delete(TAGS, { id: data.tagId });
      return ids.concat(boardIds, meetingIds, calendarIds, docIds, sheetIds, formIds, deckIds, drawIds, postIds);
    });
    if (!deleted) return fail('Tag not found.', 404);
    const prefs = settings(kv);
    for (const id of deleted) delete prefs.lastOpened[id];
    if (!ds.count(CALENDARS, {}) && !ds.count(EVENTS, {})) delete prefs.lastOpened.calendar;
    kv.set(SETTINGS, prefs);
  } else if (action === 'createFolder') {
    if (!fileName(data.name) || data.color != null && !folderColor(data.color) ||
        data.tags != null && (!Array.isArray(data.tags) || data.tags.length > 1) ||
        data.parentId != null && (!validId(data.parentId) || !ds.findOne(FOLDERS, data.parentId)))
      return fail('Invalid folder or parent.', 400);
    const created = ds.transaction(tx => {
      if (tx.count(FOLDERS, {}) >= 1000) return false;
      if (data.parentId && !tx.findOne(FOLDERS, data.parentId)) return false;
      const stamp = new Date().toISOString();
      tx.insert(FOLDERS, { name: data.name.trim(), color: data.color || '#FACC15',
        parentId: data.parentId || null, tags: tagIds(data.tags, tx), createdAt: stamp, updatedAt: stamp });
      return true;
    });
    if (!created) return fail('Folder limit reached or parent missing.', 409);
  } else if (action === 'updateFolder') {
    if (!validId(data.folderId) || !data.updates || typeof data.updates !== 'object' ||
        Array.isArray(data.updates) || !Object.keys(data.updates).length ||
        Object.keys(data.updates).some(k => !['name', 'color'].includes(k)) ||
        'name' in data.updates && !fileName(data.updates.name) ||
        'color' in data.updates && !folderColor(data.updates.color)) return fail('Invalid folder update.', 400);
    const updated = ds.transaction(tx => {
      if (!tx.findOne(FOLDERS, data.folderId)) return false;
      tx.update(FOLDERS, { id: data.folderId }, { $set: {
        ...data.updates, ...(data.updates.name ? { name: data.updates.name.trim() } : {}),
        updatedAt: new Date().toISOString(),
      } });
      return true;
    });
    if (!updated) return fail('Folder not found.', 404);
  } else if (action === 'deleteFolder') {
    if (!validId(data.folderId)) return fail('Invalid folder ID.', 400);
    const deleted = ds.transaction(tx => {
      if (!tx.findOne(FOLDERS, data.folderId)) return null;
      const doomed = folderTree(tx, data.folderId);
      const fileIds = tx.find(FILES, {}, { limit: 2000 })
        .filter(file => file.folderId && doomed.has(file.folderId)).map(file => file.id);
      for (const id of fileIds) {
        for (const collection of [FILE_BYTES, FILE_THUMBS]) {
          const row = tx.find(collection, { fileId: id }, { limit: 1 })[0];
          if (row) tx.delete(collection, { id: row.id });
        }
        tx.delete(FILES, { id });
      }
      for (const id of doomed) tx.delete(FOLDERS, { id });
      return [...doomed, ...fileIds];
    });
    if (!deleted) return fail('Folder not found.', 404);
    const prefs = settings(kv);
    for (const id of deleted) delete prefs.lastOpened[id];
    kv.set(SETTINGS, prefs);
  } else if (action === 'setFileFolder') {
    if (!validId(data.fileId) || data.folderId != null && !validId(data.folderId)) return fail('Invalid file or folder.', 400);
    const result = ds.transaction(tx => {
      if (!tx.findOne(FILES, data.fileId)) return 'file';
      if (data.folderId && !tx.findOne(FOLDERS, data.folderId)) return 'folder';
      tx.update(FILES, { id: data.fileId }, { $set: {
        folderId: data.folderId || null, updatedAt: new Date().toISOString(),
      } });
      return 'ok';
    });
    if (result !== 'ok') return fail(result === 'file' ? 'File not found.' : 'Folder not found.', 404);
  } else if (action === 'setFolderParent') {
    if (!validId(data.folderId) || data.parentId != null && !validId(data.parentId)) return fail('Invalid folder.', 400);
    const result = ds.transaction(tx => {
      if (!tx.findOne(FOLDERS, data.folderId)) return 'missing';
      if (data.parentId && !tx.findOne(FOLDERS, data.parentId)) return 'parent';
      if (data.parentId && folderTree(tx, data.folderId).has(data.parentId)) return 'cycle';
      tx.update(FOLDERS, { id: data.folderId }, { $set: {
        parentId: data.parentId || null, updatedAt: new Date().toISOString(),
      } });
      return 'ok';
    });
    if (result !== 'ok') return fail(result === 'cycle' ? 'Cannot move a folder into its descendant.' : 'Folder not found.', result === 'cycle' ? 400 : 404);
  } else if (action === 'setFileThumbnail') {
    if (!validId(data.fileId)) return fail('Invalid file ID.', 400);
    const result = ds.transaction(tx => {
      if (!tx.findOne(FILES, data.fileId)) return false;
      const old = tx.find(FILE_THUMBS, { fileId: data.fileId }, { limit: 1 })[0];
      const image = thumbOK(data.thumbnail) ? data.thumbnail : null;
      if (image && old) tx.update(FILE_THUMBS, { id: old.id }, { $set: { image } });
      else if (image) tx.insert(FILE_THUMBS, { fileId: data.fileId, image });
      else if (old) tx.delete(FILE_THUMBS, { id: old.id });
      tx.update(FILES, { id: data.fileId }, { $set: {
        thumbRef: image ? 1 : 0, thumbnail: null,
        thumbnailCover: image ? data.thumbnailCover === true : false,
        thumbVer: image && Number.isSafeInteger(data.thumbVer) && data.thumbVer > 0 ? data.thumbVer : 0,
      } });
      return true;
    });
    if (!result) return fail('File not found.', 404);
  } else if (action === 'setFileTags' || action === 'setFolderTags') {
    if (!Array.isArray(data.tagIds) || data.tagIds.length > 1) return fail('Choose at most one tag.', 400);
    const collection = action === 'setFileTags' ? FILES : FOLDERS;
    const id = action === 'setFileTags' ? data.fileId : data.folderId;
    if (!validId(id)) return fail('Invalid item ID.', 400);
    const result = ds.transaction(tx => {
      if (!tx.findOne(collection, id)) return false;
      tx.update(collection, { id }, { $set: { tags: tagIds(data.tagIds, tx), updatedAt: new Date().toISOString() } });
      return true;
    });
    if (!result) return fail('Item not found.', 404);
  } else if (action === 'setFileTag') {
    if (!['todo', 'kanban', 'minutes', 'docs', 'sheets', 'forms', 'slides', 'draw', 'blog'].includes(data.app) || !validId(data.fileId) ||
        (data.tagId !== null && data.tagId !== undefined && !validId(data.tagId))) return fail('Invalid file or tag.', 400);
    const target = data.app === 'todo' ? TODO : data.app === 'kanban' ? KANBAN :
      data.app === 'docs' ? DOCS : data.app === 'sheets' ? SHEETS :
      data.app === 'forms' ? FORMS : data.app === 'slides' ? SLIDES : data.app === 'draw' ? DRAWS :
      data.app === 'blog' ? POSTS : MINUTES;
    const result = ds.transaction(tx => {
      const current = tx.findOne(target, data.fileId);
      if (!current) return 'missing';
      if (data.tagId && !tx.findOne(TAGS, data.tagId)) return 'tag';
      tx.update(target, { id: data.fileId }, { $set: { tagId: data.tagId || null,
        ...(['docs', 'sheets', 'forms', 'slides', 'draw', 'blog'].includes(data.app) ? { version: current.version + 1, updatedAt: new Date().toISOString() } : {}) } });
      return 'ok';
    });
    if (result !== 'ok') return fail(result === 'tag' ? 'Tag not found.' : 'List not found.', 404);
  } else if (action === 'recordOpen') {
    const fileboxItem = data.app === 'filebox' && validId(data.fileId) &&
      (ds.findOne(FILES, data.fileId) || ds.findOne(FOLDERS, data.fileId));
    const calendarApp = data.app === 'calendar' && (data.fileId === 'calendar'
      ? (ds.count(CALENDARS, {}) > 0 || ds.count(EVENTS, {}) > 0)
      : validId(data.fileId) && !!ds.findOne(CALENDARS, data.fileId));
    if (!fileboxItem && !calendarApp && (!['todo', 'kanban', 'minutes', 'docs', 'sheets', 'forms', 'slides', 'draw', 'blog'].includes(data.app) || !validId(data.fileId) ||
        !ds.findOne(data.app === 'todo' ? TODO : data.app === 'kanban' ? KANBAN :
          data.app === 'docs' ? DOCS : data.app === 'sheets' ? SHEETS :
          data.app === 'forms' ? FORMS : data.app === 'slides' ? SLIDES : data.app === 'draw' ? DRAWS :
          data.app === 'blog' ? POSTS : MINUTES, data.fileId))) return fail('File not found.', 404);
    const current = settings(kv);
    const recentId = calendarApp ? 'calendar' : data.fileId;
    saveSettings(kv, { lastOpened: { ...current.lastOpened, [recentId]: new Date().toISOString() } });
  } else if (action === 'createPost') {
    const created = ds.transaction(tx => {
      if (tx.count(POSTS, {}) >= 200) return false;
      const post = createPostRecord(null, { title: 'Untitled',
        tagId: data.tagId && tx.findOne(TAGS, data.tagId) ? data.tagId : null,
        posts: tx.find(POSTS, {}, { limit: 200 }) });
      const { id: ignored, ...fields } = post;
      tx.insert(POSTS, { ...fields, version: 1 });
      return true;
    });
    if (!created) return fail('Post limit reached.', 409);
  } else if (action === 'createDrawing') {
    const created = ds.transaction(tx => {
      if (tx.count(DRAWS, {}) >= 200) return false;
      const time = new Date().toISOString();
      tx.insert(DRAWS, { name: 'Untitled Drawing', formatVersion: 1, background: '#ffffff',
        objects: [], viewport: { zoom: 1, panX: 0, panY: 0 }, version: 1,
        tagId: data.tagId && tx.findOne(TAGS, data.tagId) ? data.tagId : null,
        createdAt: time, updatedAt: time });
      return true;
    });
    if (!created) return fail('Drawing limit reached.', 409);
  } else if (action === 'createDeck') {
    const created = ds.transaction(tx => {
      if (tx.count(SLIDES, {}) >= 200) return false;
      const time = new Date().toISOString();
      tx.insert(SLIDES, { name: 'Untitled', formatVersion: 1, width: 960, height: 540,
        slides: [{ id: 's1', name: 'Slide 1', background: '#ffffff', objects: [] }],
        version: 1, tagId: data.tagId && tx.findOne(TAGS, data.tagId) ? data.tagId : null,
        createdAt: time, updatedAt: time });
      return true;
    });
    if (!created) return fail('Deck limit reached.', 409);
  } else if (action === 'createForm') {
    const created = ds.transaction(tx => {
      if (tx.count(FORMS, {}) >= 200) return false;
      const time = new Date().toISOString();
      tx.insert(FORMS, { name: 'Untitled Form', display: 'form', components: [], sharedId: null,
        version: 1, tagId: data.tagId && tx.findOne(TAGS, data.tagId) ? data.tagId : null,
        createdAt: time, updatedAt: time });
      return true;
    });
    if (!created) return fail('Form limit reached.', 409);
  } else if (action === 'createSheet') {
    const created = ds.transaction(tx => {
      if (tx.count(SHEETS, {}) >= 200) return false;
      const stamp = new Date().toISOString();
      const id = tx.insert(SHEETS, { name: 'Untitled Sheet', formatVersion: 2, version: 1,
        tagId: data.tagId && tx.findOne(TAGS, data.tagId) ? data.tagId : null,
        createdAt: stamp, updatedAt: stamp });
      const tab = `sheet-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      tx.insert(BODIES, { sheetId: id, data: { id: `wb_${id}`, name: 'Untitled Sheet',
        appVersion: '0.25.1', locale: 'enUS', styles: {}, sheetOrder: [tab], sheets: { [tab]: {
          id: tab, name: 'Sheet1', tabColor: '', hidden: 0,
          freeze: { xOffset: 0, yOffset: 0, startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
          rowCount: 84, columnCount: 60, zoomRatio: 1, scrollTop: 0, scrollLeft: 0,
          defaultColumnWidth: 73, defaultRowHeight: 19, mergeData: [], cellData: {}, rowData: {}, columnData: {},
        } } } });
      return true;
    });
    if (!created) return fail('Sheet limit reached.', 409);
  } else if (action === 'createDoc') {
    const created = ds.transaction(tx => {
      if (tx.count(DOCS, {}) >= 500) return false;
      const stamp = new Date().toISOString();
      tx.insert(DOCS, { title: 'Untitled', content: '', contentType: 'plain-text',
        pinned: false, archived: false, version: 1,
        tagId: data.tagId && tx.findOne(TAGS, data.tagId) ? data.tagId : null,
        createdAt: stamp, updatedAt: stamp });
      return true;
    });
    if (!created) return fail('Document limit reached.', 409);
  } else if (action === 'createTodo') {
    const created = ds.transaction(tx => {
      if (tx.count(TODO, {}) >= LIMIT_LISTS) return false;
      tx.insert(TODO, { name: 'Untitled List', items: [], tagId: data.tagId && tx.findOne(TAGS, data.tagId) ? data.tagId : null,
        version: 1, updatedAt: new Date().toISOString() });
      return true;
    });
    if (!created) return fail('List limit reached.', 409);
  } else if (action === 'createKanban') {
    const created = ds.transaction(tx => {
      if (tx.count(KANBAN, {}) >= 200) return false;
      const stamp = new Date().toISOString();
      tx.insert(KANBAN, { name: 'Untitled Board',
        columns: [{ id: `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, label: 'Untitled List' }],
        rows: [], cards: [], links: [], version: 1,
        tagId: data.tagId && tx.findOne(TAGS, data.tagId) ? data.tagId : null,
        createdAt: stamp, updatedAt: stamp });
      return true;
    });
    if (!created) return fail('Board limit reached.', 409);
  } else if (action === 'createMinutes') {
    const created = ds.transaction(tx => {
      if (tx.count(MINUTES, {}) >= 200) return false;
      const stamp = new Date().toISOString();
      tx.insert(MINUTES, { title: 'Untitled meeting', date: stamp.slice(0, 10), state: 'draft',
        revision: 0, agenda: [], tagId: data.tagId && tx.findOne(TAGS, data.tagId) ? data.tagId : null,
        createdAt: stamp, updatedAt: stamp });
      return true;
    });
    if (!created) return fail('Meeting limit reached.', 409);
  } else if (action === 'renameFile' && data.app === 'filebox') {
    if (!validId(data.fileId) || !fileName(data.name)) return fail('Invalid file.', 400);
    const result = ds.transaction(tx => {
      if (!tx.findOne(FILES, data.fileId)) return false;
      tx.update(FILES, { id: data.fileId }, { $set: {
        name: data.name.trim(), updatedAt: new Date().toISOString(),
      } });
      return true;
    });
    if (!result) return fail('File not found.', 404);
  } else if (action === 'deleteFile' && data.app === 'filebox') {
    if (!validId(data.fileId)) return fail('Invalid file ID.', 400);
    const removed = ds.transaction(tx => {
      if (!tx.findOne(FILES, data.fileId)) return false;
      for (const collection of [FILE_BYTES, FILE_THUMBS]) {
        const record = tx.find(collection, { fileId: data.fileId }, { limit: 1 })[0];
        if (record) tx.delete(collection, { id: record.id });
      }
      tx.delete(FILES, { id: data.fileId });
      return true;
    });
    if (!removed) return fail('File not found.', 404);
    const prefs = settings(kv);
    delete prefs.lastOpened[data.fileId];
    kv.set(SETTINGS, prefs);
  } else if (action === 'renameFile') {
    if (!['todo', 'kanban', 'minutes', 'docs', 'sheets', 'forms', 'slides', 'draw', 'blog'].includes(data.app) || !validId(data.fileId) ||
        typeof data.name !== 'string' || !data.name.trim() ||
        data.name.trim().length > (['minutes', 'docs', 'sheets', 'forms', 'slides', 'draw', 'blog'].includes(data.app) ? 200 : 100)) return fail('Invalid file.', 400);
    const target = data.app === 'todo' ? TODO : data.app === 'kanban' ? KANBAN :
      data.app === 'docs' ? DOCS : data.app === 'sheets' ? SHEETS :
      data.app === 'forms' ? FORMS : data.app === 'slides' ? SLIDES : data.app === 'draw' ? DRAWS :
      data.app === 'blog' ? POSTS : MINUTES;
    const updated = ds.transaction(tx => {
      const current = tx.findOne(target, data.fileId);
      if (!current) return false;
      if (data.app === 'minutes' && current.state === 'final') return 'final';
      const patch = data.app === 'minutes'
        ? { title: data.name.trim(), revision: current.revision + 1, updatedAt: new Date().toISOString() }
        : data.app === 'blog'
          ? { title: data.name.trim(), version: current.version + 1, updatedAt: new Date().toISOString() }
        : data.app === 'docs'
          ? { title: data.name.trim(), version: current.version + 1, updatedAt: new Date().toISOString() }
          : { name: data.name.trim(), version: current.version + 1, updatedAt: new Date().toISOString() };
      if (data.app === 'blog' && !current.publishedAt && !current.path)
        patch.slug = uniquePostSlug(tx.find(POSTS, {}, { limit: 200 }), slugifyTitle(patch.title), current.id);
      tx.update(target, { id: data.fileId }, { $set: patch });
      return true;
    });
    if (updated === 'final') return fail('Reopen the final meeting before editing.', 409);
    if (!updated) return fail('File not found.', 404);
    if (data.app === 'blog') refreshPublishedBlogPost(env.holm.app.ds, env.holm.auth.getMember().id,
      ds.findOne(POSTS, data.fileId));
    if (data.app === 'docs') {
      const doc = ds.findOne(DOCS, data.fileId);
      if (doc?.sharedId) {
        const copy = env.holm.app.ds.find(SHARES, { token: doc.sharedId }, { limit: 1 })[0];
        if (copy) env.holm.app.ds.update(SHARES, { id: copy.id }, { $set: { doc: {
          id: doc.id, title: doc.title, content: doc.content, contentType: doc.contentType,
          pinned: doc.pinned, archived: doc.archived, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
        }, sharedAt: new Date().toISOString() } });
      }
    }
    if (data.app === 'sheets') {
      const sheet = ds.findOne(SHEETS, data.fileId);
      if (sheet?.sharedId) {
        const copy = env.holm.app.ds.find(SHEET_SHARES, { token: sheet.sharedId }, { limit: 1 })[0];
        const workbook = ds.find(BODIES, { sheetId: data.fileId }, { limit: 1 })[0];
        if (copy && workbook) env.holm.app.ds.update(SHEET_SHARES, { id: copy.id }, { $set: {
          sheet: { id: sheet.id, name: sheet.name, formatVersion: sheet.formatVersion,
            createdAt: sheet.createdAt, updatedAt: sheet.updatedAt, data: workbook.data },
          sharedAt: new Date().toISOString(),
        } });
      }
    }
    if (data.app === 'forms') {
      const form = ds.findOne(FORMS, data.fileId);
      if (form?.sharedId) {
        const copy = env.holm.app.ds.find(FORM_SHARES, { token: form.sharedId }, { limit: 1 })[0];
        if (copy) env.holm.app.ds.update(FORM_SHARES, { id: copy.id }, { $set: {
          form: { id: form.id, name: form.name, display: form.display, components: form.components,
            createdAt: form.createdAt, updatedAt: form.updatedAt }, sharedAt: new Date().toISOString(),
        } });
      }
    }
    if (data.app === 'slides') {
      const deck = ds.findOne(SLIDES, data.fileId);
      if (deck?.sharedId) {
        const copy = env.holm.app.ds.find(SLIDE_SHARES, { token: deck.sharedId }, { limit: 1 })[0];
        if (copy) env.holm.app.ds.update(SLIDE_SHARES, { id: copy.id }, { $set: {
          deck: { id: deck.id, name: deck.name, formatVersion: deck.formatVersion,
            width: deck.width, height: deck.height, slides: deck.slides,
            createdAt: deck.createdAt, updatedAt: deck.updatedAt }, sharedAt: new Date().toISOString(),
        } });
      }
    }
    if (data.app === 'draw') {
      const drawing = ds.findOne(DRAWS, data.fileId);
      if (drawing?.sharedId) {
        const copy = env.holm.app.ds.find(DRAW_SHARES, { token: drawing.sharedId }, { limit: 1 })[0];
        if (copy) env.holm.app.ds.update(DRAW_SHARES, { id: copy.id }, { $set: {
          drawing: { id: drawing.id, name: drawing.name, formatVersion: drawing.formatVersion,
            background: drawing.background, objects: drawing.objects, viewport: drawing.viewport,
            createdAt: drawing.createdAt, updatedAt: drawing.updatedAt }, sharedAt: new Date().toISOString(),
        } });
      }
    }
  } else if (action === 'deleteFile') {
    if (!['todo', 'kanban', 'minutes', 'docs', 'sheets', 'forms', 'slides', 'draw', 'blog'].includes(data.app) || !validId(data.fileId)) return fail('Invalid file.', 400);
    const target = data.app === 'todo' ? TODO : data.app === 'kanban' ? KANBAN :
      data.app === 'docs' ? DOCS : data.app === 'sheets' ? SHEETS :
      data.app === 'forms' ? FORMS : data.app === 'slides' ? SLIDES : data.app === 'draw' ? DRAWS :
      data.app === 'blog' ? POSTS : MINUTES;
    if (data.app === 'blog') {
      const post = ds.findOne(POSTS, data.fileId);
      if (post) revokeBlogPost(env.holm.app.ds, env.holm.auth.getMember().id, post);
    }
    if (data.app === 'docs') {
      const doc = ds.findOne(DOCS, data.fileId);
      if (doc?.sharedId) {
        const copy = env.holm.app.ds.find(SHARES, { token: doc.sharedId }, { limit: 1 })[0];
        if (copy) env.holm.app.ds.delete(SHARES, { id: copy.id });
      }
    }
    if (data.app === 'sheets') {
      const sheet = ds.findOne(SHEETS, data.fileId);
      if (sheet?.sharedId) {
        const copy = env.holm.app.ds.find(SHEET_SHARES, { token: sheet.sharedId }, { limit: 1 })[0];
        if (copy) env.holm.app.ds.delete(SHEET_SHARES, { id: copy.id });
      }
    }
    if (data.app === 'forms') {
      const form = ds.findOne(FORMS, data.fileId);
      if (form?.sharedId) {
        const copy = env.holm.app.ds.find(FORM_SHARES, { token: form.sharedId }, { limit: 1 })[0];
        if (copy) env.holm.app.ds.delete(FORM_SHARES, { id: copy.id });
      }
    }
    if (data.app === 'slides') {
      const deck = ds.findOne(SLIDES, data.fileId);
      if (deck?.sharedId) {
        const copy = env.holm.app.ds.find(SLIDE_SHARES, { token: deck.sharedId }, { limit: 1 })[0];
        if (copy) env.holm.app.ds.delete(SLIDE_SHARES, { id: copy.id });
      }
    }
    if (data.app === 'draw') {
      const drawing = ds.findOne(DRAWS, data.fileId);
      if (drawing?.sharedId) {
        const copy = env.holm.app.ds.find(DRAW_SHARES, { token: drawing.sharedId }, { limit: 1 })[0];
        if (copy) env.holm.app.ds.delete(DRAW_SHARES, { id: copy.id });
      }
    }
    const removed = ds.transaction(tx => {
      if (!tx.findOne(target, data.fileId)) return false;
      if (data.app === 'sheets') {
        for (const collection of [BODIES, THUMBS]) {
          const row = tx.find(collection, { sheetId: data.fileId }, { limit: 1 })[0];
          if (row) tx.delete(collection, { id: row.id });
        }
      }
      tx.delete(target, { id: data.fileId });
      return true;
    });
    if (!removed) return fail('List not found.', 404);
    const prefs = settings(kv);
    delete prefs.lastOpened[data.fileId];
    kv.set(SETTINGS, prefs);
  } else {
    return fail('App not migrated yet.', 404);
  }
  return json({ success: true, data: workspace(ds, kv) });
}
