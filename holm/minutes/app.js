/* Minutes: a document-first meeting notebook. Existing agenda and Todo IDs are preserved. */
(() => {
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const uid = () => 'note_' + crypto.randomUUID().replaceAll('-', '');
const today = () => { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const labels = { discussion: 'Note', action: 'Action', decision: 'Decision', information: 'Information', question: 'Question' };
const stateLabels = { draft: 'Draft', review: 'In review', final: 'Final' };
const templates = { blank: [''], team: ['Check-in & updates', 'Blockers & discussion', 'Priorities & next steps'], one: ['How are things going?', 'Feedback & discussion', 'Growth & next steps'], project: ['Progress & milestones', 'Risks & decisions', 'Next steps'] };
const moreIcon = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';
const app = { meetings: [], todo: [], events: [], tags: [], settings: {}, meeting: null, dirty: false, saving: null, timer: null, conflict: false, failed: false, taskUpdate: null, taskError: '', expanded: new Set(), collapsed: new Set(), editors: new Map(), observer: null };
const apiFetch = (...args) => (window.WDBoot?.fetch || fetch)(...args);
// The home sidebar/header adapters mount at DOMContentLoaded. Reveal neither
// route until their synchronous setup has finished, even on a cached/fast read.
const shellReady = new Promise(resolve => {
  if (document.readyState === 'complete') resolve();
  else document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(resolve), { once: true });
});
const overviewDrawer = matchMedia('(max-width: 700px)');
let overviewDesktopOpen = true, overviewMobileOpen = false;
try { overviewDesktopOpen = localStorage.getItem('minutes_overview') !== 'off'; } catch { /* Private mode. */ }
function syncOverview() {
  const sidebar = $('meetingOverview'), toggle = $('overviewToggle');
  const open = !!app.meeting && (overviewDrawer.matches ? overviewMobileOpen : overviewDesktopOpen);
  const restoreFocus = document.activeElement === toggle || (!open && sidebar.contains(document.activeElement));
  const toolbar = $('editorToolbar');
  const parent = overviewDrawer.matches && open ? sidebar.querySelector('.rail-header') : toolbar;
  if (toggle.parentNode !== parent) {
    if (parent === toolbar) parent.prepend(toggle); else parent.append(toggle);
  }
  document.body.classList.toggle('minutes-overview-open', open);
  sidebar.inert = !open;
  sidebar.setAttribute('aria-hidden', String(!open));
  $('overviewScrim').hidden = !open || !overviewDrawer.matches;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.title = open ? 'Close meeting overview' : 'Open meeting overview';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.querySelector('path').setAttribute('d', open ? 'm11 6-6 6 6 6m8-12-6 6 6 6' : 'm5 6 6 6-6 6m8-12 6 6-6 6');
  if (restoreFocus) toggle.focus({ preventScroll: true });
}
function closeOverviewDrawer() { overviewMobileOpen = false; syncOverview(); }
function initOverview() {
  $('overviewToggle').onclick = () => {
    if (overviewDrawer.matches) overviewMobileOpen = !overviewMobileOpen;
    else {
      overviewDesktopOpen = !overviewDesktopOpen;
      try { localStorage.setItem('minutes_overview', overviewDesktopOpen ? 'on' : 'off'); } catch { /* Private mode. */ }
    }
    syncOverview();
  };
  $('overviewScrim').onclick = closeOverviewDrawer;
  $('meetingOverview').addEventListener('click', event => {
    if (overviewDrawer.matches && event.target.closest('a[href^="#"], #railAddTopic')) closeOverviewDrawer();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overviewMobileOpen && !document.querySelector('dialog[open]')) {
      event.preventDefault(); closeOverviewDrawer(); $('overviewToggle').focus({ preventScroll: true });
    }
  });
  overviewDrawer.addEventListener('change', closeOverviewDrawer);
  // Opening the panel changes line wrapping; keep auto-sized notes fully visible.
  let documentWidth = 0;
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === documentWidth) return;
    documentWidth = entry.contentRect.width;
    requestAnimationFrame(() => $('notesList').querySelectorAll('textarea').forEach(autoSize));
  }).observe($('documentScroll'));
  syncOverview();
}
function safeHTML(html) {
  return window.DOMPurify ? DOMPurify.sanitize(html || '', { ALLOWED_TAGS: ['p','br','strong','b','em','i','u','s','ol','ul','li','blockquote','a','span'], ALLOWED_ATTR: ['href','target','rel','class','data-list'] }) : esc(html || '');
}
async function request(action, data, endpoint = '/api/minutes') {
  const response = await apiFetch(endpoint, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
  if (response.status === 401) throw new Error('Your session expired. Keep this page open and sign in to Workdeck in another tab, then retry.');
  const result = await response.json();
  if (!response.ok || !result.success) { const error = new Error(result.error || 'Could not save Minutes.'); error.status = response.status; throw error; }
  return result;
}
function status(message, state = '') { $('saveState').textContent = message; $('saveState').dataset.state = state; }
function editing() { return !!app.meeting && app.meeting.state !== 'final' && !app.conflict; }
function findPoint(id) {
  for (const section of app.meeting?.agenda || []) { const point = section.points.find(item => item.id === id); if (point) return { section, point }; }
  return null;
}
function todoTask(point) { return app.todo.find(list => list.id === point.todoListId)?.items?.find(item => item.id === point.todoTaskId); }
function blankPoint(type = 'discussion') { return { id: uid(), type, text: '', notes: '', owner: '', dueDate: '', todoListId: null, todoTaskId: null }; }
function publishHome() { document.dispatchEvent(new CustomEvent('wd:home-data', { detail: { app: 'minutes', data: { minutes: app.meetings, tags: app.tags, settings: app.settings } } })); }
function changed() {
  if (!editing()) return;
  app.dirty = true; status('Unsaved changes'); clearTimeout(app.timer);
  if (!app.failed) app.timer = setTimeout(save, 700);
}
async function save() {
  clearTimeout(app.timer); app.timer = null;
  if (app.saving) { const ok = await app.saving; return ok && app.dirty ? save() : ok; }
  if (app.conflict) return false;
  if (!app.dirty || !app.meeting) return true;
  const meeting = app.meeting, snapshot = structuredClone(meeting);
  app.dirty = false; status('Saving…', 'saving');
  app.saving = (async () => {
    try {
      const result = await request('save', snapshot);
      meeting.revision = result.meeting.revision; meeting.updatedAt = result.meeting.updatedAt; meeting.approvedAt = result.meeting.approvedAt;
      for (const section of result.meeting.agenda) for (const point of section.points) {
        const local = findPoint(point.id)?.point;
        if (local) { local.todoListId = point.todoListId; local.todoTaskId = point.todoTaskId; }
      }
      mergeTodo(result.todo || []); app.failed = false;
      $('saveError').classList.add('hidden'); $('retryBtn').classList.add('hidden');
      status(app.dirty ? 'Unsaved changes' : 'All changes saved', app.dirty ? '' : 'saved');
      updateSummaries(); updateTaskBadges(); publishHome();
      return true;
    } catch (error) {
      app.dirty = true; app.failed = true; app.conflict = /changed elsewhere/i.test(error.message);
      status(app.conflict ? 'Save conflict' : 'Not saved', 'error');
      $('saveErrorTitle').textContent = app.conflict ? 'This meeting changed in another tab' : 'Your changes haven’t been saved';
      $('saveErrorText').textContent = error.message + (app.conflict ? ' Download your copy before reloading. We won’t overwrite the newer version.' : ' Your notes are still here. Retry when you’re ready.');
      $('saveError').classList.remove('hidden'); $('retryBtn').classList.toggle('hidden', app.conflict);
      if (app.conflict) renderMeeting();
      return false;
    }
  })();
  const ok = await app.saving; app.saving = null;
  // Drain edits made while the previous revision was in flight. Never loop on failure.
  return ok && app.dirty ? save() : ok;
}
function ensureWritingLine() {
  if (!editing()) return;
  if (!app.meeting.agenda.length) app.meeting.agenda.push({ id: uid(), title: '', points: [blankPoint()] });
}
function setRoute(id, replace = false) { history[replace ? 'replaceState' : 'pushState'](null, '', id ? '/minutes/?meeting=' + encodeURIComponent(id) : '/minutes/'); }
function showHome(navigate = true) {
  app.meeting = null; app.observer?.disconnect(); document.body.classList.remove('minutes-editing'); closeOverviewDrawer();
  $('home').classList.remove('hidden'); $('editor').classList.add('hidden');
  $('saveError').classList.add('hidden'); $('retryBtn').classList.add('hidden');
  window.WDPageTitle?.home();
  if (navigate) setRoute(null);
  renderHome(); publishHome();
}
function openMeeting(meeting, navigate = true) {
  app.meeting = meeting; app.dirty = false; app.failed = false; app.conflict = false; app.taskError = ''; app.expanded.clear(); app.collapsed.clear();
  ensureWritingLine(); document.body.classList.add('minutes-editing');
  $('home').classList.add('hidden'); $('editor').classList.remove('hidden'); $('saveError').classList.add('hidden'); closeOverviewDrawer();
  if (navigate) setRoute(meeting.id);
  status('All changes saved', 'saved'); renderMeeting(); $('documentScroll').scrollTo(0, 0);
  apiFetch('/api/workdeck', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recordOpen', data: { fileId: meeting.id, app: 'minutes' } }) }).catch(() => {});
}
async function load() {
  let createIntent = null;
  document.documentElement.setAttribute('data-minutes-loading', '');
  $('loadError').classList.add('hidden');
  try {
    const response = await apiFetch('/api/minutes', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) { location.assign('/auth/login?redirect=' + encodeURIComponent(location.pathname + location.search)); return; }
    if (!response.ok) throw new Error('Check your connection and try again.');
    const result = await response.json();
    await shellReady;
    app.meetings = result.data.minutes || []; app.todo = result.data.todo || []; app.events = result.data.events || []; app.tags = result.data.tags || []; app.settings = result.data.settings || {};
    const preference = app.settings.theme;
    if (['light', 'dark', 'system'].includes(preference)) { localStorage.setItem('workdeck_theme', preference); applyTheme(); }
    const params = new URLSearchParams(location.search);
    const id = params.get('meeting') || /^\/minutes\/([a-zA-Z0-9_-]{8,128})\/?$/.exec(location.pathname)?.[1];
    const meeting = app.meetings.find(item => item.id === id);
    if (meeting) openMeeting(meeting, false);
    else { showHome(false); if (id) throw new Error('This meeting no longer exists or is not available in your account. Your other meetings are shown below.'); }
    if (!id && params.get('new') === '1') {
      createIntent = { tagId: app.tags.find(tag => tag.id === params.get('tag'))?.id || null };
    }
    publishHome();
  } catch (error) {
    await shellReady;
    $('home').classList.remove('hidden'); $('loadError').classList.remove('hidden'); $('loadErrorText').textContent = error.message;
  }
  document.documentElement.removeAttribute('data-minutes-loading');
  if (createIntent) {
    // Consume the one-shot launcher URL only after a successful load. Refresh
    // or Back must not reopen the dialog, while load/sign-in retries retain it.
    setRoute(null, true);
    $('newBtn').focus();
    openCreate(createIntent.tagId);
  }
}
function renderHome() {
  const term = $('search').value.toLowerCase().trim();
  const results = app.meetings.filter(meeting => !term || [meeting.title, meeting.series, meeting.noteTaker, meeting.attendees, stateLabels[meeting.state], ...(meeting.agenda || []).flatMap(section => [section.title, ...(section.points || []).flatMap(point => [point.text, point.owner])])].join(' ').toLowerCase().includes(term)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  $('empty').classList.toggle('hidden', !!app.meetings.length); $('noResults').classList.toggle('hidden', !!results.length || !app.meetings.length);
  $('meetingList').innerHTML = results.map(meeting => `<div class="meeting-card" data-id="${esc(meeting.id)}" role="button" tabindex="0" aria-label="Open ${esc(meeting.title || 'Untitled meeting')}"><div class="card-body"><strong>${esc(meeting.title || 'Untitled meeting')}</strong><small>${esc(stateLabels[meeting.state] || 'Draft')}</small></div><button class="rename-meeting" data-rename="${esc(meeting.id)}" title="Rename" aria-label="Rename meeting" ${meeting.state === 'final' ? 'disabled' : ''}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m16 3 5 5L9 20l-6 1 1-6L16 3Z"/></svg></button><button class="delete-meeting" data-delete="${esc(meeting.id)}" aria-label="Delete ${esc(meeting.title || 'meeting')}">Delete</button></div>`).join('');
  $('meetingList').querySelectorAll('.meeting-card').forEach(card => {
    card.onclick = event => { if (!event.target.closest('button,a')) openMeeting(app.meetings.find(item => item.id === card.dataset.id)); };
    card.onkeydown = event => { if (event.target === card && ['Enter',' '].includes(event.key)) { event.preventDefault(); openMeeting(app.meetings.find(item => item.id === card.dataset.id)); } };
  });
  $('meetingList').querySelectorAll('[data-rename]').forEach(button => button.onclick = event => {
    event.stopPropagation(); renameHomeMeeting(app.meetings.find(item => item.id === button.dataset.rename));
  });
  $('meetingList').querySelectorAll('[data-delete]').forEach(button => button.onclick = event => {
    event.stopPropagation(); const meeting = app.meetings.find(item => item.id === button.dataset.delete);
    WDDialog.open({ title: 'Delete meeting', message: `Delete “${meeting.title || 'Untitled meeting'}”? Linked Todo tasks will remain. This cannot be undone.`, confirmLabel: 'Delete', danger: true,
      onSubmit: async () => { await request('delete', { id: meeting.id }); app.meetings = app.meetings.filter(item => item !== meeting); renderHome(); publishHome(); },
    });
  });
}
function renameHomeMeeting(meeting) {
  if (!meeting || meeting.state === 'final') return;
  WDDialog.open({
    title: 'Rename meeting', field: { label: 'Meeting name', value: meeting.title || 'Untitled meeting', maxLength: 200 }, confirmLabel: 'Rename',
    onSubmit: async name => {
      // Rename only metadata, never submit a stale copy of the agenda or Todo links.
      const result = await request('renameFile', { app: 'minutes', fileId: meeting.id, name }, '/api/workdeck');
      app.meetings = result.data.minutes || [];
      renderHome(); publishHome();
    },
  });
}
function renderMeeting() {
  const meeting = app.meeting;
  for (const id of ['title','date','location','noteTaker','attendees','startTime','endTime','series','chair','apologies']) $(id).value = id === 'title' && meeting.title === 'Untitled meeting' ? '' : meeting[id] || '';
  $('calendarEventId').innerHTML = '<option value="">No linked event</option>' + app.events.map(event => `<option value="${esc(event.id)}">${esc(event.title || 'Event')} · ${esc((event.start || '').slice(0, 10))}</option>`).join('');
  $('calendarEventId').value = meeting.calendarEventId || '';
  $('stateChip').textContent = stateLabels[meeting.state] || 'Draft'; $('stateChip').dataset.state = meeting.state;
  const approver = meeting.state === 'final' ? (meeting.approvedBy || '').trim() : '';
  $('approvalName').textContent = approver ? 'Approved by ' + approver : '';
  $('approvalName').hidden = !approver;
  $('reviewBtn').textContent = meeting.state === 'final' ? 'Reopen to edit' : 'Update Status';
  $('reviewBtn').disabled = app.conflict;
  document.querySelectorAll('#editor input,#editor select').forEach(input => input.disabled = !editing());
  $('addTopic').classList.toggle('hidden', !editing()); $('railAddTopic').classList.toggle('hidden', !editing());
  renderRows(); updateSummaries(); updateHeading();
}
function updateHeading() {
  $('documentName').textContent = app.meeting.title || 'Untitled meeting';
  $('documentName').disabled = !editing();
  $('documentName').title = editing() ? 'Rename meeting' : app.meeting.title || 'Untitled meeting';
  window.WDPageTitle?.file(app.meeting.title || 'Untitled meeting');
  const date = app.meeting.date && new Date(app.meeting.date + 'T12:00:00');
  $('railDate').textContent = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'No date set';
}
function renameMeeting() {
  if (!editing()) return;
  WDDialog.open({
    title: 'Rename meeting', field: { label: 'Meeting name', value: app.meeting.title || 'Untitled meeting', maxLength: 200 }, confirmLabel: 'Rename',
    onSubmit: async value => {
      if (!editing()) throw new Error('This meeting is read-only. Reopen it before renaming.');
      app.meeting.title = value; $('title').value = value; updateHeading(); changed();
      return save();
    },
  });
}
function renderOutline() {
  $('topicCount').textContent = app.meeting.agenda.length;
  $('outline').innerHTML = app.meeting.agenda.map((section, index) => `<a href="#topic-${esc(section.id)}"><span>${String(index + 1).padStart(2,'0')}</span><strong>${esc(section.title || 'Untitled topic')}</strong></a>`).join('');
  app.observer?.disconnect();
  app.observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { $('outline').querySelectorAll('a').forEach(a => a.setAttribute('aria-current', String(a.hash === '#' + entry.target.id))); break; } }, { root: $('documentScroll'), rootMargin: '-24px 0px -55% 0px' });
  $('notesList').querySelectorAll('.topic-group').forEach(section => app.observer.observe(section));
}
function typeOptions(current) { return Object.entries(labels).map(([key,label]) => `<option value="${key}" ${key === current ? 'selected' : ''}>${label}</option>`).join(''); }
function rowHTML(point) {
  const action = point.type === 'action', disabled = editing() ? '' : 'disabled';
  const meta = action || point.owner || point.dueDate;
  const collapsed = app.collapsed.has(point.id), contextOpen = !collapsed && app.expanded.has(point.id);
  return `<div class="note-row type-${esc(point.type)}" data-point="${esc(point.id)}"><div class="point-heading"><div class="point-summary"><div class="point-toolbar" id="point-tools-${esc(point.id)}" ${collapsed ? 'hidden' : ''}><select class="note-type" data-field="type" aria-label="Point type" ${disabled}>${typeOptions(point.type)}</select>${editing() ? `<button class="icon-button point-menu" aria-label="Note actions" aria-haspopup="menu" aria-expanded="false">${moreIcon}</button>` : ''}</div><textarea class="note-content" data-field="text" aria-label="${esc(labels[point.type] || 'Note')} text" rows="1" maxlength="2000" placeholder="${action ? 'What needs to happen next?' : point.type === 'decision' ? 'What did you decide?' : point.type === 'question' ? 'What still needs an answer?' : 'Capture a thought, update, or talking point…'}" ${disabled}>${esc(point.text)}</textarea></div><button type="button" class="icon-button point-toggle" aria-expanded="${!collapsed}" aria-controls="point-tools-${esc(point.id)} point-details-${esc(point.id)}" aria-label="${collapsed ? 'Expand section' : 'Collapse section'}" title="${collapsed ? 'Expand section' : 'Collapse section'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div><div class="point-details" id="point-details-${esc(point.id)}" ${collapsed ? 'hidden' : ''}>${meta ? `<div class="point-meta"><label>Owner <input data-field="owner" aria-label="Responsible person" placeholder="Assign someone" maxlength="120" value="${esc(point.owner)}" ${disabled}></label><label>Due <input data-field="dueDate" aria-label="Due date" type="date" value="${esc(point.dueDate)}" ${disabled}></label>${action ? '<span class="task-badge"></span>' : ''}</div>` : ''}${editing() || point.notes ? `<button type="button" class="add-context" data-context="${esc(point.id)}" aria-controls="point-context-${esc(point.id)}" aria-expanded="${contextOpen}">${contextOpen ? 'Hide context' : point.notes ? (editing() ? 'Edit context' : 'Show context') : '+ Add context or a link'}</button>` : ''}<div class="point-context" id="point-context-${esc(point.id)}" ${contextOpen ? '' : 'hidden'}><div class="rich-readonly">${safeHTML(point.notes)}</div></div></div></div>`;
}
// Collapse is presentation-only: never change meeting data or recreate an active editor.
function syncPointState(row) {
  const id = row.dataset.point, point = findPoint(id)?.point;
  const collapsed = app.collapsed.has(id), contextOpen = !collapsed && app.expanded.has(id);
  row.querySelector('.point-toolbar').hidden = collapsed;
  row.querySelector('.point-details').hidden = collapsed;
  const toggle = row.querySelector('.point-toggle');
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.title = collapsed ? 'Expand section' : 'Collapse section';
  toggle.setAttribute('aria-label', toggle.title);
  row.querySelector('.point-context').hidden = !contextOpen;
  const contextToggle = row.querySelector('[data-context]');
  if (contextToggle) {
    contextToggle.setAttribute('aria-expanded', String(contextOpen));
    contextToggle.textContent = contextOpen ? 'Hide context' : point?.notes ? (editing() ? 'Edit context' : 'Show context') : '+ Add context or a link';
  }
  autoSize(row.querySelector('textarea'));
}
function autoSize(textarea) { textarea.style.height = 'auto'; textarea.style.height = Math.max(30, textarea.scrollHeight) + 'px'; }
function renderRows(focusId = null) {
  app.editors.clear();
  $('notesList').innerHTML = app.meeting.agenda.map((section,index) => `<section class="topic-group" id="topic-${esc(section.id)}" data-section="${esc(section.id)}" tabindex="-1"><div class="topic-label"><span class="topic-number">${String(index+1).padStart(2,'0')}</span><input data-topic="${esc(section.id)}" value="${esc(section.title || '')}" placeholder="Untitled topic" aria-label="Topic name" maxlength="200" ${editing() ? '' : 'disabled'}>${editing() ? `<button class="icon-button topic-menu" aria-label="Topic actions" aria-haspopup="menu" aria-expanded="false">${moreIcon}</button>` : ''}</div><div class="topic-points">${section.points.map(rowHTML).join('')}</div>${editing() ? `<div class="under-topic"><button data-add="discussion">+ Note</button><button data-add="decision">+ Decision</button><button data-add="action">+ Action</button></div>` : ''}</section>`).join('');
  $('notesList').querySelectorAll('textarea').forEach(autoSize);
  $('notesList').querySelectorAll('[data-section]').forEach(element => {
    const section = app.meeting.agenda.find(item => item.id === element.dataset.section);
    element.querySelector('[data-topic]').oninput = event => { section.title = event.target.value; changed(); renderOutline(); updateSummaries(); };
    element.querySelectorAll('[data-add]').forEach(button => button.onclick = () => addPoint(button.dataset.add, section.id));
    element.querySelector('.topic-menu')?.addEventListener('click', event => openTopicMenu(event.currentTarget, section));
  });
  $('notesList').querySelectorAll('[data-point]').forEach(row => {
    const id = row.dataset.point;
    row.querySelectorAll('[data-field]').forEach(input => input.oninput = () => {
      const point = findPoint(id)?.point; if (!point || !editing()) return;
      point[input.dataset.field] = input.value; changed(); updateSummaries();
      if (input.dataset.field === 'text') autoSize(input);
      if (input.dataset.field === 'type') renderRows(id);
    });
    row.querySelector('textarea').onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && editing() && event.currentTarget.value.trim()) { event.preventDefault(); addPoint('discussion', findPoint(id).section.id, id); }
    };
    row.querySelector('.point-menu')?.addEventListener('click', event => openPointMenu(event.currentTarget, id));
    row.querySelector('.point-toggle').addEventListener('click', () => {
      if (app.collapsed.has(id)) app.collapsed.delete(id);
      else { app.collapsed.add(id); app.expanded.delete(id); }
      syncPointState(row);
    });
    row.querySelector('[data-context]')?.addEventListener('click', () => {
      if (app.expanded.has(id)) { app.expanded.delete(id); syncPointState(row); }
      else expandContext(id);
    });
    if (app.expanded.has(id) && !app.collapsed.has(id)) expandContext(id, false);
  });
  updateTaskBadges(); renderOutline();
  if (focusId) { const input = $('notesList').querySelector(`[data-point="${focusId}"] textarea`); input?.focus(); if (input) input.setSelectionRange(input.value.length,input.value.length); }
}
function expandContext(id, focus = true) {
  const row = $('notesList').querySelector(`[data-point="${id}"]`), point = findPoint(id)?.point;
  if (!row || !point) return;
  app.collapsed.delete(id); app.expanded.add(id); syncPointState(row);
  if (!editing()) return;
  const existing = app.editors.get(id); if (existing) { if (focus) existing.focus(); return; }
  if (!window.Quill) { status('Formatting unavailable — plain notes still work', 'error'); return; }
  const context = row.querySelector('.point-context');
  context.innerHTML = '<div class="rich-editor"></div><button class="text-button link-workdeck" type="button">+ Link a Workdeck file</button>';
  const quill = new Quill(context.querySelector('.rich-editor'), { theme: 'snow', placeholder: 'Add detail, reasoning, or a useful link…', modules: { toolbar: [['bold','italic','underline'], [{ list:'bullet' },{ list:'ordered' }], ['blockquote','link','clean']] } });
  quill.clipboard.dangerouslyPasteHTML(safeHTML(point.notes));
  quill.root.setAttribute('aria-label', 'Additional context');
  quill.on('text-change', (_delta,_old,source) => { if (source === 'user' && editing()) { point.notes = quill.getText().trim() ? quill.root.innerHTML : ''; changed(); } });
  context.querySelector('.link-workdeck').onclick = () => {
    const range = quill.getSelection() || { index:quill.getLength()-1,length:0 };
    WDDialog.open({ title:'Link a Workdeck file', message:'Paste the link to a document, task list, or another Workdeck file.', field:{ label:'File link',value:'',placeholder:'/docs/?doc=…' }, confirmLabel:'Insert link',
      onSubmit: value => { const link = window.WDLinks?.parseHref(value.trim()); if (!link || link.app === 'resolver') throw new Error('Enter a valid Workdeck file link.'); const label = window.WDLinks.APPS[link.app]?.name || 'Workdeck file'; quill.insertText(range.index,label,{link:window.WDLinks.url(link.app,link.id)},'user'); quill.setSelection(range.index+label.length,0); },
    });
  };
  app.editors.set(id,quill); if (focus) quill.focus();
}
function menu(button, items) { WDActionMenu.open(button, items, { label: 'Meeting actions' }); }
function openPointMenu(button,id) {
  const { section,point } = findPoint(id), index = section.points.indexOf(point);
  const move = offset => { section.points.splice(index,1); section.points.splice(index+offset,0,point); changed(); renderRows(id); updateSummaries(); };
  menu(button,[{label:'Add context or link',onSelect:()=>expandContext(id)}, {label:'Move up',disabled:index===0,onSelect:()=>move(-1)}, {label:'Move down',disabled:index===section.points.length-1,onSelect:()=>move(1)}, {label:'Remove note',danger:true,onSelect:()=>{
    const remove = () => { section.points = section.points.filter(item=>item!==point); changed(); renderRows(); updateSummaries(); };
    if (point.text || point.notes || point.todoTaskId) WDDialog.open({title:'Remove note',message:'Remove this note from the meeting? Any linked Todo task will remain.',confirmLabel:'Remove',danger:true,onSubmit:remove}); else remove();
  }}]);
}
function openTopicMenu(button,section) {
  const index = app.meeting.agenda.indexOf(section);
  const move = offset => { app.meeting.agenda.splice(index,1); app.meeting.agenda.splice(index+offset,0,section); changed(); renderRows(); updateSummaries(); };
  menu(button,[{label:'Move up',disabled:index===0,onSelect:()=>move(-1)}, {label:'Move down',disabled:index===app.meeting.agenda.length-1,onSelect:()=>move(1)}, {label:'Remove topic',danger:true,onSelect:()=>WDDialog.open({title:'Remove topic',message:'Remove this topic and its notes? Linked Todo tasks will remain.',confirmLabel:'Remove',danger:true,onSubmit:()=>{app.meeting.agenda=app.meeting.agenda.filter(item=>item!==section);changed();renderRows();updateSummaries();}})}]);
}
function addPoint(type,sectionId,afterId=null) {
  if (!editing()) return;
  const section = app.meeting.agenda.find(item=>item.id===sectionId); if (!section) return;
  const empty = !afterId && section.points.find(point=>!point.text&&!point.notes&&!point.owner&&!point.dueDate&&!point.todoTaskId);
  if (empty) { empty.type=type;app.collapsed.delete(empty.id);changed();renderRows(empty.id);return; }
  const point=blankPoint(type);section.points.splice(afterId?section.points.findIndex(item=>item.id===afterId)+1:section.points.length,0,point);
  changed();renderRows(point.id);updateSummaries();
}
function addTopic() {
  if (!editing()) return;
  const section={id:uid(),title:'',points:[blankPoint()]};app.meeting.agenda.push(section);changed();renderRows();
  const input=$('notesList').querySelector(`[data-topic="${section.id}"]`);input.focus();input.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function updateTaskBadges() {
  $('notesList').querySelectorAll('.task-badge').forEach(container=>{
    const point=findPoint(container.closest('[data-point]').dataset.point)?.point;if(!point)return;
    const task=todoTask(point);
    container.innerHTML=task?`<a target="_blank" rel="noopener" href="/todo/?list=${encodeURIComponent(point.todoListId)}">${task.completed?'✓ Done in Todo':'Open in Todo ↗'}</a>`:point.todoTaskId?'<span class="task-warning">Linked task was removed</span>':point.text?'<span class="task-pending">Syncs to Todo on save</span>':'';
  });
}
// Keep newer Todo revisions when autosave, refresh and completion responses cross.
function mergeTodo(lists, replace = false) {
  const current = new Map(app.todo.map(list => [list.id, list]));
  const merged = replace ? new Map() : new Map(current);
  for (const list of lists) merged.set(list.id, (current.get(list.id)?.version || 0) > list.version ? current.get(list.id) : list);
  app.todo = [...merged.values()];
}
function summaryTopic(section) {
  const title = section.title || 'Untitled topic';
  return `<a class="summary-topic" href="#topic-${esc(section.id)}" title="${esc(title)}" aria-label="Go to topic: ${esc(title)}">${esc(title)}</a>`;
}
async function setActionCompleted(pointId, completed) {
  if (!app.meeting || app.conflict || app.taskUpdate) return;
  const meeting = app.meeting;
  app.taskUpdate = { meetingId: meeting.id, pointId, completed }; app.taskError = '';
  updateSummaries();
  try {
    if (!await save()) throw new Error('Save the meeting before changing task completion.');
    if (app.meeting !== meeting) return;
    const result = await request('setActionCompleted', { id: meeting.id, pointId, completed });
    mergeTodo([result.todoList]);
    if (app.meeting === meeting) updateTaskBadges();
  } catch (error) {
    if (app.meeting === meeting) app.taskError = error.message + ' The change was not confirmed. Try again.';
  } finally {
    app.taskUpdate = null;
    if (app.meeting) updateSummaries();
    if (app.meeting === meeting && document.activeElement === document.body) {
      $('actionsList').querySelector(`[data-complete="${pointId}"]`)?.focus({ preventScroll: true });
    }
  }
}
function updateSummaries() {
  if (!app.meeting) return;
  const focusedPoint = document.activeElement?.dataset.complete;
  const points=app.meeting.agenda.flatMap(section=>section.points.map(point=>({point,section}))).filter(({point})=>point.text||point.notes||point.todoTaskId);
  const actions=points.filter(({point})=>point.type==='action'),decisions=points.filter(({point})=>point.type==='decision');
  $('pointCount').textContent=`${points.length} ${points.length===1?'note':'notes'}`;
  $('actionCount').textContent=$('actionSummaryCount').textContent=actions.length;
  $('decisionCount').textContent=$('decisionSummaryCount').textContent=decisions.length;
  $('decisionsList').innerHTML=decisions.map(({point,section})=>`<li class="summary-card decision-item"><p class="summary-text">${esc(point.text||'Untitled decision')}</p>${summaryTopic(section)}</li>`).join('')||'<li class="summary-empty"><strong>No decisions yet</strong><p>Add a decision under any topic and it will appear here.</p></li>';
  $('actionsList').innerHTML=actions.map(({point,section})=>{
    const task=todoTask(point), pending=app.taskUpdate?.meetingId===app.meeting.id && app.taskUpdate.pointId===point.id;
    const completed=pending ? app.taskUpdate.completed : !!task?.completed;
    const label=(completed?'Mark incomplete: ':'Mark completed: ')+(point.text||'Untitled action');
    const hint=pending?'Saving completion…':!task?(point.todoTaskId?'Linked Todo task was removed':'Available after this action is saved'):label;
    return `<li class="summary-card action-item" data-completed="${completed}" aria-busy="${pending}"><label class="summary-completion" title="${esc(hint)}"><input type="checkbox" data-complete="${esc(point.id)}" aria-label="${esc(label)}" ${completed?'checked':''} ${!task||app.conflict||app.taskUpdate?'disabled':''}></label><p class="summary-text">${esc(point.text||'Untitled action')}</p>${summaryTopic(section)}</li>`;
  }).join('')||'<li class="summary-empty"><strong>No action items yet</strong><p>Add an action under a topic to collect it here.</p></li>';
  $('actionError').textContent=app.taskError;
  $('actionError').hidden=!app.taskError;
  $('actionsList').querySelectorAll('[data-complete]').forEach(input=>input.onchange=()=>setActionCompleted(input.dataset.complete,input.checked));
  if (focusedPoint) $('actionsList').querySelector(`[data-complete="${focusedPoint}"]`)?.focus({ preventScroll: true });
}
function reviewIssues() {
  const points=app.meeting.agenda.flatMap(section=>section.points).filter(point=>point.text||point.notes||point.todoTaskId),issues=[];
  if(!points.length)issues.push('No notes yet. You can keep this meeting as a draft.');
  for(const point of points){if(point.type==='action'){if(!point.owner)issues.push(`Assign an owner: ${point.text||'Untitled action'}`);if(!point.dueDate)issues.push(`Set a due date: ${point.text||'Untitled action'}`);if(point.todoTaskId&&!todoTask(point))issues.push(`Linked Todo task is missing: ${point.text}`);}if(point.type==='question')issues.push(`Open question: ${point.text}`);}
  return issues;
}
async function openReview() {
  if(!await save())return;
  if(app.meeting.state==='final'){
    WDDialog.open({title:'Reopen meeting',message:'Reopen these minutes as a draft? The recorded approval will be cleared.',confirmLabel:'Reopen',onSubmit:async()=>{const prior={state:app.meeting.state,approvedBy:app.meeting.approvedBy,approvedAt:app.meeting.approvedAt};Object.assign(app.meeting,{state:'draft',approvedBy:'',approvedAt:null});app.dirty=true;if(!await save()){restoreStatus(prior);throw new Error('Could not confirm reopening. Please try again.');}renderMeeting();}});return;
  }
  const issues = reviewIssues();
  $('reviewIssues').innerHTML=issues.map(issue=>`<div class="issue">${esc(issue)}</div>`).join('');
  $('reviewIssues').hidden = !issues.length;
  $('recordState').value=app.meeting.state||'draft';$('approvedBy').value=app.meeting.approvedBy||'';$('approvedLabel').hidden=$('recordState').value!=='final';$('reviewError').hidden=true;$('reviewDialog').showModal();
}
function restoreStatus(prior) {
  Object.assign(app.meeting, prior);
  // Only the status was changed in this transaction; notes were flushed before
  // opening the dialog. Do not retry a final→final save after a failed reopen.
  app.dirty = false; app.failed = false;
  $('retryBtn').classList.add('hidden');
  if (!app.conflict) { $('saveError').classList.add('hidden'); status('Status change not confirmed', 'error'); }
  renderMeeting();
}
async function applyReview(event) {
  event.preventDefault(); const prior={state:app.meeting.state,approvedBy:app.meeting.approvedBy};
  setBusy($('reviewDialog'),true);$('reviewError').hidden=true;
  app.meeting.state=$('recordState').value;app.meeting.approvedBy=app.meeting.state==='final'?$('approvedBy').value:'';app.dirty=true;
  if(await save()){$('reviewDialog').close();renderMeeting();}
  else{restoreStatus(prior);$('reviewError').textContent='The status could not be saved. Check the connection and try again.';$('reviewError').hidden=false;}
  setBusy($('reviewDialog'),false);
}
function recoveryHTML() {
  const meeting=app.meeting;if(!meeting)return '';
  const field=(name,value)=>value?`<p><b>${name}:</b> ${esc(value)}</p>`:'';
  return `<span class="recovery-label">Workdeck / Minutes · ${esc(stateLabels[meeting.state]||'Draft')}</span><h1>${esc(meeting.title||'Untitled meeting')}</h1><div class="recovery-meta">${field('Date',meeting.date)}${field('Time',[meeting.startTime,meeting.endTime].filter(Boolean).join('–'))}${field('Location',meeting.location)}${field('Note-taker',meeting.noteTaker)}${field('Attendees',meeting.attendees)}${field('Chair',meeting.chair)}${field('Apologies',meeting.apologies)}${field('Series',meeting.series)}</div>${meeting.agenda.map((section,index)=>`<section><h2>${index+1}. ${esc(section.title||'Discussion')}</h2>${section.points.filter(point=>point.text||point.notes).map(point=>`<div class="recovery-point"><span class="recovery-label">${esc(labels[point.type])}</span><p>${esc(point.text)}</p>${safeHTML(point.notes)}${point.type==='action'||point.owner||point.dueDate?`<small>Owner: ${esc(point.owner||'Unassigned')} · Due: ${esc(point.dueDate||'Not set')}${todoTask(point)?.completed?' · Completed':''}</small>`:''}</div>`).join('')}</section>`).join('')}${meeting.state==='final'?`<p><small>Recorded approval: ${esc(meeting.approvedBy||'Not specified')} · ${esc(meeting.approvedAt?.slice(0,10)||'')}. Identity not independently verified.</small></p>`:''}`;
}
function downloadRecovery() {
  if(!app.meeting)return;
  const blob=new Blob(['<!doctype html><html><head><meta charset="utf-8"><title>Meeting recovery copy</title></head><body>',recoveryHTML(),'</body></html>'],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=(app.meeting.title||'Meeting').replace(/[^a-z0-9 -]/gi,'').slice(0,80)+' - recovery.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setBusy(dialog,busy){dialog.dataset.busy=String(busy);dialog.querySelectorAll('button,input,select').forEach(control=>control.disabled=busy);}
let creationTagId = null;
function openCreate(tagId = null){ creationTagId = tagId; $('createForm').reset();$('createError').hidden=true;$('createDialog').showModal();$('createName').focus(); }
async function createMeeting(event) {
  event.preventDefault();
  const chosen = new FormData($('createForm')).get('template') || 'blank';
  setBusy($('createDialog'),true);$('createError').hidden=true;
  try{
    const result=await request('create',{title:$('createName').value.trim(),date:today(),tagId:creationTagId});
    app.meetings.unshift(result.meeting);$('createDialog').close();openMeeting(result.meeting);publishHome();
    app.meeting.agenda=(templates[chosen]||templates.blank).map(title=>({id:uid(),title,points:[blankPoint()]}));
    changed();renderRows();await save();$('title').focus();
  }catch(error){$('createError').textContent=error.message;$('createError').hidden=false;}
  finally{setBusy($('createDialog'),false);}
}
function applyTheme() {
  const stored=localStorage.getItem('workdeck_theme');
  const theme=['light','dark','system'].includes(stored) ? stored : 'dark';
  const dark=theme==='dark'||(theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('dark',dark);document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
function init() {
  initOverview();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(localStorage.getItem('workdeck_theme')==='system')applyTheme();});applyTheme();
  $('settingsBtn').onclick=event=>{event.stopPropagation();$('settingsDropdown').classList.toggle('hidden');};
  document.querySelectorAll('#settingsDropdown [data-theme]').forEach(button=>button.onclick=async()=>{const theme=button.dataset.theme;localStorage.setItem('workdeck_theme',theme);applyTheme();$('accountError').hidden=true;try{const response=await apiFetch('/api/workdeck',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'updateSettings',data:{settings:{theme}}})});if(!response.ok)throw new Error('Theme could not be saved. Please try again.');}catch(error){$('accountError').textContent=error.message;$('accountError').hidden=false;}});
  $('logoutBtn').onclick=async()=>{if(!await save())return;$('logoutBtn').disabled=true;try{const response=await apiFetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Could not sign out. Please try again.');location.assign('/');}catch(error){$('accountError').textContent=error.message;$('accountError').hidden=false;}finally{$('logoutBtn').disabled=false;}};
  ['newBtn','emptyNew'].forEach(id=>$(id).onclick=()=>openCreate());$('createForm').onsubmit=createMeeting;$('reviewForm').onsubmit=applyReview;
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
  document.querySelectorAll('.minutes-dialog').forEach(dialog=>dialog.addEventListener('cancel',event=>{if(dialog.dataset.busy==='true')event.preventDefault();}));
  $('search').oninput=renderHome;$('clearSearch').onclick=()=>{$('search').value='';$('search').dispatchEvent(new Event('input',{bubbles:true}));$('search').focus();};
  $('loadRetry').onclick=load;$('retryBtn').onclick=save;$('downloadRecovery').onclick=downloadRecovery;
  const returnHome=async event=>{event?.preventDefault();if(await save()){showHome();$('newBtn').focus();}};
  $('backBtn').onclick=returnHome;
  $('documentName').onclick=renameMeeting;
  $('reviewBtn').onclick=openReview;
  for(const id of ['title','date','location','noteTaker','attendees','startTime','endTime','series','chair','apologies','calendarEventId'])$(id).oninput=()=>{if(!editing())return;app.meeting[id]=$(id).value;changed();if(id==='title'||id==='date')updateHeading();};
  $('addTopic').onclick=$('railAddTopic').onclick=addTopic;
  $('recordState').onchange=()=>{$('approvedLabel').hidden=$('recordState').value!=='final';};
  $('refreshTasks').onclick=async()=>{if(!await save())return;$('refreshTasks').disabled=true;try{const response=await apiFetch('/api/minutes',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw new Error();mergeTodo((await response.json()).data.todo||[],true);app.taskError='';updateTaskBadges();updateSummaries();$('refreshTasks').textContent='Refreshed';}catch{$('refreshTasks').textContent='Retry refresh';}finally{$('refreshTasks').disabled=false;}};
  addEventListener('beforeunload',event=>{if(app.dirty||app.saving||app.taskUpdate){event.preventDefault();event.returnValue='';}});
  addEventListener('online',()=>{if(app.failed&&!app.conflict)save();});
  addEventListener('storage',event=>{if(event.key==='workdeck_theme')applyTheme();});
  addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='s'&&app.meeting){event.preventDefault();save();}});
  addEventListener('popstate',async()=>{
    const id=new URLSearchParams(location.search).get('meeting');if(id===app.meeting?.id)return;
    if(!await save()){setRoute(app.meeting?.id,true);return;}
    const meeting=app.meetings.find(item=>item.id===id);if(meeting)openMeeting(meeting,false);else showHome(false);
  });
  load();
}
init();
})();
