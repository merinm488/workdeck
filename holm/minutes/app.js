/* A single-page meeting notebook. Sections group optional topics; every visible line is a structured point. */
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const today = () => new Date().toISOString().slice(0, 10);
const labels = { discussion: 'Note', action: 'Action', decision: 'Decision', information: 'Info', question: 'Question' };
const app = { meetings: [], todo: [], events: [], meeting: null, detailId: null, quill: null, sortables: [], dirty: false, saving: null, timer: null, conflict: false };
async function request(action, data) {
  const response = await (window.WDBoot?.fetch || fetch)('/api/minutes', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
  if (response.status === 401) { location.assign('/auth/login?redirect=%2Fminutes%2F'); throw new Error('Sign in to continue.'); }
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || 'Could not save Minutes');
  return result;
}
function status(message) { $('saveState').textContent = message; if (message !== 'Save failed') $('retryBtn').classList.add('hidden'); }
function editing() { return app.meeting && app.meeting.state !== 'final' && !app.conflict; }
function findPoint(id) {
  for (const section of app.meeting?.agenda || []) {
    const point = section.points.find(item => item.id === id);
    if (point) return { section, point };
  }
  return null;
}
function todoTask(point) { return app.todo.find(list => list.id === point.todoListId)?.items?.find(item => item.id === point.todoTaskId); }
function changed() {
  if (!editing()) return;
  app.dirty = true; status('Unsaved changes'); clearTimeout(app.timer);
  app.timer = setTimeout(save, 700);
}
async function save() {
  clearTimeout(app.timer); app.timer = null;
  if (app.saving) { await app.saving; if (app.dirty) return save(); return; }
  if (!app.dirty || !app.meeting || app.conflict) return;
  const meeting = app.meeting, snapshot = structuredClone(meeting);
  app.dirty = false; status('Saving…');
  app.saving = request('save', snapshot).then(result => {
    if (app.meeting !== meeting) return;
    meeting.revision = result.meeting.revision;
    meeting.updatedAt = result.meeting.updatedAt;
    meeting.approvedAt = result.meeting.approvedAt;
    for (const section of result.meeting.agenda) for (const point of section.points) {
      const local = findPoint(point.id)?.point;
      if (local) { local.todoListId = point.todoListId; local.todoTaskId = point.todoTaskId; }
    }
    app.todo = result.todo;
    status(app.dirty ? 'Unsaved changes' : 'All changes saved');
    updateActionSummary(); updateTaskBadges(); renderPrint();
  }).catch(error => {
    app.dirty = true;
    app.conflict = /changed elsewhere/i.test(error.message);
    status(app.conflict ? 'Changed in another tab — reload' : 'Save failed');
    $('retryBtn').classList.toggle('hidden', app.conflict);
    alert(error.message + (app.conflict ? ' Your unsaved text is still on screen; copy it before reloading.' : ' Your changes remain on screen. Retry saving when the connection returns.'));
  }).finally(() => { app.saving = null; });
  await app.saving;
  if (app.dirty && !app.conflict && !app.timer) app.timer = setTimeout(save, 700);
}
function blankPoint(type = 'discussion') { return { id: uid(), type, text: '', notes: '', owner: '', dueDate: '', todoListId: null, todoTaskId: null }; }
function ensureWritingLine() {
  if (!app.meeting.agenda.length) app.meeting.agenda.push({ id: uid(), title: '', points: [] });
  const last = app.meeting.agenda.at(-1);
  if (!last.points.length) last.points.push(blankPoint());
}
function showHome() {
  $('home').classList.remove('hidden'); $('editor').classList.add('hidden');
  $('newBtn').classList.remove('hidden'); $('backBtn').classList.add('hidden');
  if (location.pathname.startsWith('/minutes/')) history.pushState(null, '', '/minutes/');
  renderHome();
}
function openMeeting(meeting) {
  app.meeting = meeting; app.dirty = false; app.conflict = false;
  ensureWritingLine();
  $('home').classList.add('hidden'); $('editor').classList.remove('hidden');
  $('newBtn').classList.add('hidden'); $('backBtn').classList.remove('hidden');
  history.replaceState(null, '', '/minutes/?meeting=' + encodeURIComponent(meeting.id));
  status('All changes saved'); renderMeeting();
  fetch('/api/workdeck', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recordOpen', data: { fileId: meeting.id, app: 'minutes' } }) }).catch(() => {});
}
async function load() {
  try {
    const response = await (window.WDBoot?.fetch || fetch)('/api/minutes', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) { location.assign('/auth/login?redirect=%2Fminutes%2F'); return; }
    if (!response.ok) throw new Error('Cannot load your meetings. Return to Workdeck and check your session.');
    const result = await response.json();
    app.meetings = result.data.minutes || []; app.todo = result.data.todo || []; app.events = result.data.events || [];
    const preference = result.data.settings?.theme;
    if (['light', 'dark', 'system'].includes(preference)) {
      localStorage.setItem('workdeck_theme', preference);
      applyTheme();
    }
    const id = new URLSearchParams(location.search).get('meeting') || /^\/minutes\/([a-z0-9_]{14,})\/?$/.exec(location.pathname)?.[1];
    const meeting = app.meetings.find(item => item.id === id);
    if (meeting) openMeeting(meeting); else showHome();
  } catch (error) { $('home').classList.remove('hidden'); $('home').innerHTML = `<div class="empty"><p>${esc(error.message)}</p><button type="button" id="loadRetry">Retry</button><a href="/home">Return to Workdeck</a></div>`; $('loadRetry').onclick = () => location.reload(); }
}
function renderHome() {
  const term = $('search').value.toLowerCase().trim(), filter = $('filter').value;
  const results = app.meetings.filter(meeting => (filter === 'all' || filter === meeting.state) && (!term || [meeting.title, meeting.series, meeting.noteTaker, meeting.attendees, ...(meeting.agenda || []).flatMap(section => [section.title, ...(section.points || []).flatMap(point => [point.text, point.owner])])].join(' ').toLowerCase().includes(term))).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  $('empty').classList.toggle('hidden', !!results.length || !!app.meetings.length);
  $('meetingList').innerHTML = results.map(meeting => {
    const points = (meeting.agenda || []).flatMap(section => section.points || []).filter(point => point.text);
    const day = meeting.date || today();
    return `<div class="meeting-card" data-id="${esc(meeting.id)}" role="button" tabindex="0"><div class="date-tile"><b>${esc(day.slice(8))}</b><span>${esc(new Date(day + 'T12:00').toLocaleString(undefined, { month: 'short' }))}</span></div><div class="card-body"><strong>${esc(meeting.title || 'Untitled meeting')}</strong><small>${esc(meeting.series || 'Meeting')} · ${points.length} point${points.length === 1 ? '' : 's'} · ${points.filter(point => point.type === 'action').length} action${points.filter(point => point.type === 'action').length === 1 ? '' : 's'}</small></div><span class="state-chip">${esc(meeting.state || 'draft')}</span><button class="delete-meeting" data-delete="${esc(meeting.id)}" aria-label="Delete ${esc(meeting.title)}">Delete</button></div>`;
  }).join('') || (app.meetings.length ? '<p class="no-results">No meetings match your search.</p>' : '');
  $('meetingList').querySelectorAll('.meeting-card').forEach(card => {
    card.onclick = event => { if (!event.target.closest('[data-delete]')) openMeeting(app.meetings.find(item => item.id === card.dataset.id)); };
    card.onkeydown = event => { if (event.key === 'Enter' && !event.target.closest('button')) openMeeting(app.meetings.find(item => item.id === card.dataset.id)); };
  });
  $('meetingList').querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => {
    const meeting = app.meetings.find(item => item.id === button.dataset.delete);
    if (!meeting || !confirm(`Delete “${meeting.title}”? Its Todo tasks will remain.`)) return;
    try { await request('delete', { id: meeting.id }); app.meetings = app.meetings.filter(item => item !== meeting); renderHome(); } catch (error) { alert(error.message); }
  });
}
function renderMeeting() {
  const meeting = app.meeting;
  for (const id of ['title','date','location','noteTaker','attendees','startTime','endTime','series','chair','apologies']) $(id).value = id === 'title' && meeting.title === 'Untitled meeting' ? '' : meeting[id] || '';
  $('calendarEventId').innerHTML = '<option value="">No linked event</option>' + app.events.map(event => `<option value="${esc(event.id)}">${esc(event.title || 'Event')} · ${esc((event.start || '').slice(0, 10))}</option>`).join('');
  $('calendarEventId').value = meeting.calendarEventId || '';
  $('stateChip').textContent = { draft: 'Draft', review: 'In review', final: 'Final' }[meeting.state] || 'Draft';
  $('reviewBtn').textContent = meeting.state === 'final' ? 'Reopen to edit' : 'Review & finish';
  $('bottomReview').textContent = meeting.state === 'final' ? 'Reopen to edit →' : 'Review & finish →';
  document.querySelectorAll('#editor input,#editor select,#editor .capture-buttons button').forEach(input => input.disabled = !editing());
  renderRows(); updateActionSummary(); renderPrint();
}
function typeOptions(current) { return Object.entries(labels).map(([key, label]) => `<option value="${key}" ${key === current ? 'selected' : ''}>${label}</option>`).join(''); }
function rowHtml(point) {
  const action = point.type === 'action';
  const task = todoTask(point);
  const badge = action ? (task ? `<a class="task-state" target="_blank" rel="noopener" href="/todo/?list=${encodeURIComponent(point.todoListId)}">${task.completed ? '✓ Done in Todo' : '↗ In Todo'}</a>` : point.todoTaskId ? '<span class="task-warning">Todo task missing</span>' : point.text ? '<span class="task-pending">Creating Todo task…</span>' : '') : '';
  return `<div class="note-row type-${esc(point.type)}" data-point="${esc(point.id)}"><div class="note-type"><select data-field="type" aria-label="Point type" ${editing() ? '' : 'disabled'}>${typeOptions(point.type)}</select></div><div class="note-content"><textarea data-field="text" aria-label="Note" rows="1" placeholder="${action ? 'What needs doing?' : point.type === 'decision' ? 'What was decided?' : 'Write a note…'}" ${editing() ? '' : 'disabled'}>${esc(point.text)}</textarea><div class="point-extras"><span class="task-badge">${badge}</span>${point.notes ? '<span class="has-context">✎ More details added</span>' : ''}<button data-details="${esc(point.id)}" class="details-link" ${editing() ? '' : 'disabled'}>+ Details / link</button></div></div><div class="owner-cell"><input data-field="owner" aria-label="Responsible person" placeholder="Who?" value="${esc(point.owner)}" ${editing() ? '' : 'disabled'}></div><div class="due-cell"><input data-field="dueDate" aria-label="Due date" type="date" value="${esc(point.dueDate)}" ${editing() ? '' : 'disabled'}></div><button class="remove-point" data-remove="${esc(point.id)}" title="Remove point" aria-label="Remove point" ${editing() ? '' : 'disabled'}>×</button></div>`;
}
function autoSize(textarea) { textarea.style.height = 'auto'; textarea.style.height = Math.max(40, textarea.scrollHeight) + 'px'; }
function renderRows(focusId = null) {
  app.sortables.forEach(sortable => sortable.destroy()); app.sortables = [];
  $('notesList').innerHTML = app.meeting.agenda.map((section, index) => `<section class="topic-group" data-section="${esc(section.id)}"><div class="topic-label"><span>TOPIC ${String(index + 1).padStart(2, '0')}</span><input data-topic="${esc(section.id)}" value="${esc(section.title || '')}" placeholder="Give this topic a name (optional)" aria-label="Topic name" ${editing() ? '' : 'disabled'}><button data-remove-topic="${esc(section.id)}" aria-label="Remove topic" title="Remove topic" ${editing() ? '' : 'disabled'}>×</button></div><div class="topic-points">${section.points.map(rowHtml).join('')}</div><button class="under-topic" data-add-under="${esc(section.id)}" ${editing() ? '' : 'disabled'}>+ Add a line under this topic</button></section>`).join('');
  $('notesList').querySelectorAll('textarea[data-field="text"]').forEach(autoSize);
  $('notesList').querySelectorAll('[data-topic]').forEach(input => input.oninput = () => { app.meeting.agenda.find(section => section.id === input.dataset.topic).title = input.value; changed(); renderPrint(); });
  $('notesList').querySelectorAll('[data-remove-topic]').forEach(button => button.onclick = () => {
    const section = app.meeting.agenda.find(item => item.id === button.dataset.removeTopic);
    if (section.points.some(point => point.text || point.todoTaskId) && !confirm('Delete this topic and its notes? Linked Todo tasks will remain.')) return;
    app.meeting.agenda = app.meeting.agenda.filter(item => item !== section);
    ensureWritingLine(); changed(); renderRows(); renderPrint();
  });
  $('notesList').querySelectorAll('[data-add-under]').forEach(button => button.onclick = () => addPoint('discussion', button.dataset.addUnder));
  $('notesList').querySelectorAll('[data-point]').forEach(row => {
    const id = row.dataset.point;
    row.querySelectorAll('[data-field]').forEach(input => input.oninput = () => {
      const point = findPoint(id)?.point;
      if (!point || !editing()) return;
      const field = input.dataset.field;
      point[field] = input.value;
      if (field === 'text') autoSize(input);
      changed(); updateActionSummary(); renderPrint();
      if (field === 'type') { renderRows(id); return; }
    });
    row.querySelector('textarea').onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && editing() && event.currentTarget.value.trim()) {
        event.preventDefault(); addPoint('discussion', findPoint(id)?.section?.id, id);
      }
    };
    row.querySelector('[data-details]').onclick = () => openDetails(id);
    row.querySelector('[data-remove]').onclick = () => {
      const found = findPoint(id); if (!found || !editing()) return;
      if (found.point.todoTaskId && !confirm('Remove this line? Its Todo task will remain.')) return;
      found.section.points = found.section.points.filter(item => item.id !== id);
      ensureWritingLine(); changed(); renderRows(); updateActionSummary(); renderPrint();
    };
  });
  if (window.Sortable && editing()) $('notesList').querySelectorAll('.topic-points').forEach(list => app.sortables.push(Sortable.create(list, { group: 'meeting-points', animation: 120, handle: '.note-type', filter: 'select', preventOnFilter: false, onEnd(event) {
    const id = event.item.dataset.point, source = findPoint(id)?.section, destination = app.meeting.agenda.find(section => section.id === event.to.closest('[data-section]').dataset.section);
    if (!source || !destination) return;
    const point = source.points.splice(source.points.findIndex(item => item.id === id), 1)[0];
    destination.points.splice(event.newIndex, 0, point); changed(); renderRows(); renderPrint();
  } })));
  if (focusId) { const input = $('notesList').querySelector(`[data-point="${focusId}"] textarea`); input?.focus(); if (input) input.setSelectionRange(input.value.length, input.value.length); }
  $('pointCount').textContent = `${app.meeting.agenda.flatMap(section => section.points).filter(point => point.text).length} notes`;
}
function updateTaskBadges() {
  $('notesList').querySelectorAll('[data-point]').forEach(row => {
    const point = findPoint(row.dataset.point)?.point;
    if (!point || point.type !== 'action') return;
    const task = todoTask(point), container = row.querySelector('.task-badge');
    container.replaceChildren();
    if (task) { const a = document.createElement('a'); a.href = '/todo/?list=' + encodeURIComponent(point.todoListId); a.target = '_blank'; a.rel = 'noopener'; a.className = 'task-state'; a.textContent = task.completed ? '✓ Done in Todo' : '↗ In Todo'; container.append(a); }
    else if (point.todoTaskId) { const warning = document.createElement('span'); warning.className = 'task-warning'; warning.textContent = 'Todo task missing'; container.append(warning); }
  });
}
function addPoint(type = 'discussion', sectionId = null, afterId = null) {
  if (!editing()) return;
  const section = app.meeting.agenda.find(item => item.id === sectionId) || app.meeting.agenda.at(-1);
  if (!section) return;
  // Reuse the initial blank note rather than leaving an empty row behind.
  const empty = section.points.find(point => !point.text && !point.notes && !point.owner && !point.dueDate && !point.todoTaskId);
  if (empty && !afterId) { empty.type = type; renderRows(empty.id); return; }
  const point = blankPoint(type);
  const position = afterId ? section.points.findIndex(item => item.id === afterId) + 1 : section.points.length;
  section.points.splice(position, 0, point); changed(); renderRows(point.id); renderPrint();
}
function addTopic() {
  if (!editing()) return;
  const section = { id: uid(), title: '', points: [blankPoint()] };
  app.meeting.agenda.push(section); changed(); renderRows();
  const input = $('notesList').querySelector(`[data-topic="${section.id}"]`);
  input?.focus(); input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function updateActionSummary() {
  if (!app.meeting) return;
  const actions = app.meeting.agenda.flatMap(section => section.points.filter(point => point.type === 'action' && (point.text || point.todoTaskId)).map(point => ({ point, section })));
  $('actionCount').textContent = actions.length;
  $('actionsList').innerHTML = actions.map(({ point, section }) => {
    const task = todoTask(point);
    return `<div class="action-item"><span>${task?.completed ? '✓' : '○'}</span><div><strong>${esc(point.text || 'Untitled action')}</strong><small>${esc(section.title || 'Meeting')} · ${esc(point.owner || 'Unassigned')} · ${esc(point.dueDate || 'No due date')}</small></div>${task ? `<a target="_blank" rel="noopener" href="/todo/?list=${encodeURIComponent(point.todoListId)}">Open in Todo ↗</a>` : point.todoTaskId ? '<span class="task-warning">Task missing</span>' : '<small>Saving...</small>'}</div>`;
  }).join('') || '<p class="quiet">No actions yet. Choose “Action” on any line to add one.</p>';
  $('pointCount').textContent = `${app.meeting.agenda.flatMap(section => section.points).filter(point => point.text).length} notes`;
}
function openDetails(id) {
  if (!editing()) return;
  app.detailId = id;
  app.quill.setContents([]);
  const html = findPoint(id)?.point?.notes || '';
  app.quill.clipboard.dangerouslyPasteHTML(window.DOMPurify ? DOMPurify.sanitize(html) : esc(html));
  $('detailOverlay').classList.remove('hidden'); app.quill.focus();
}
function closeDetails() {
  $('detailOverlay').classList.add('hidden');
  if (app.detailId) { app.detailId = null; renderRows(); }
}
function reviewIssues() {
  const points = app.meeting.agenda.flatMap(section => section.points).filter(point => point.text || point.todoTaskId);
  const issues = [];
  if (!points.length) issues.push('No notes yet — you can still save a draft.');
  for (const point of points) {
    if (point.type === 'action') {
      if (!point.owner) issues.push(`Add a responsible person: ${point.text || '(untitled action)'}`);
      if (!point.dueDate) issues.push(`Add a due date: ${point.text || '(untitled action)'}`);
      if (point.todoTaskId && !todoTask(point)) issues.push(`Todo task missing: ${point.text}`);
    }
    if (point.type === 'question') issues.push(`Open question: ${point.text}`);
  }
  return issues;
}
async function openReview() {
  if (app.meeting.state === 'final') {
    if (!confirm('Reopen this final meeting as a draft? Its recorded approval will be cleared.')) return;
    app.meeting.state = 'draft'; app.meeting.approvedBy = ''; app.meeting.approvedAt = null;
    changed(); await save(); if (!app.dirty) renderMeeting(); return;
  }
  await save(); if (app.dirty || app.conflict) return;
  const issues = reviewIssues();
  $('reviewIssues').innerHTML = issues.map(issue => `<div class="issue">⚠ ${esc(issue)}</div>`).join('') || '<div class="issue success">✓ No missing follow-ups found</div>';
  $('recordState').value = app.meeting.state || 'draft'; $('approvedBy').value = app.meeting.approvedBy || '';
  $('approvedLabel').classList.toggle('hidden', $('recordState').value !== 'final');
  $('reviewOverlay').classList.remove('hidden');
}
function renderPrint() {
  const meeting = app.meeting; if (!meeting) return;
  const field = (name, value) => value ? `<p><b>${name}:</b> ${esc(value)}</p>` : '';
  const notes = point => window.DOMPurify ? DOMPurify.sanitize(point.notes || '', { USE_PROFILES: { html: true } }) : esc(point.notes || '');
  $('printView').innerHTML = `<span class="print-label">Workdeck / Minutes · ${esc(meeting.state || 'draft')}</span><h1>${esc(meeting.title || 'Untitled meeting')}</h1><div class="print-meta">${field('Date', meeting.date)}${field('Time', [meeting.startTime, meeting.endTime].filter(Boolean).join('–'))}${field('Location', meeting.location)}${field('Note-taker', meeting.noteTaker)}${field('Chair', meeting.chair)}${field('Attendees', meeting.attendees)}${field('Apologies', meeting.apologies)}${field('Series', meeting.series)}</div>${meeting.agenda.map((section, index) => {
    const points = section.points.filter(point => point.text || point.notes);
    if (!points.length && !section.title) return '';
    return `<section>${section.title ? `<h2>${index + 1}. ${esc(section.title)}</h2>` : ''}${points.map(point => `<div class="print-point"><span class="print-label">${esc(labels[point.type] || point.type)}</span><p>${esc(point.text)}</p>${point.notes ? `<div>${notes(point)}</div>` : ''}${point.type === 'action' || point.owner || point.dueDate ? `<small>Responsible: ${esc(point.owner || 'Unassigned')} · Due: ${esc(point.dueDate || 'Not set')}${point.type === 'action' && todoTask(point)?.completed ? ' · Completed' : ''}</small>` : ''}</div>`).join('')}</section>`;
  }).join('')}${meeting.state === 'final' ? `<p><small>Recorded approval: ${esc(meeting.approvedBy || 'Not specified')} · ${esc(meeting.approvedAt?.slice(0, 10) || '')}. Identity not independently verified.</small></p>` : ''}`;
}
async function createMeeting() {
  try {
    const result = await request('create', { date: today() });
    app.meetings.unshift(result.meeting); openMeeting(result.meeting); $('title').focus();
  } catch (error) { alert(error.message); }
}
function applyTheme() {
  const stored = localStorage.getItem('workdeck_theme');
  const theme = ['light', 'dark', 'system'].includes(stored) ? stored : 'dark';
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('dark', dark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
function init() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('workdeck_theme') === 'system') applyTheme();
  });
  applyTheme(); $('themeBtn').onclick = async () => {
    const theme = document.body.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem('workdeck_theme', theme); applyTheme();
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/workdeck', { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateSettings', data: { settings: { theme } } }),
      });
      if (!response.ok) throw new Error('Unable to save theme');
    } catch (_) { alert('Theme could not be saved. Please try again.'); }
  };
  app.quill = new Quill('#notesEditor', { theme: 'snow', placeholder: 'Why was this decided? Add context or a link…', modules: { toolbar: [['bold','italic'], [{ list: 'bullet' }, { list: 'ordered' }], ['link','clean']] } });
  app.quill.on('text-change', (_delta, _old, source) => { if (source !== 'user' || !editing() || !app.detailId) return; const point = findPoint(app.detailId)?.point; if (point) { point.notes = app.quill.root.innerHTML; changed(); renderPrint(); } });
  ['newBtn','heroNew','emptyNew'].forEach(id => $(id).onclick = createMeeting);
  $('search').oninput = renderHome; $('filter').onchange = renderHome;
  $('retryBtn').onclick = save;
  const returnHome = async () => { await save(); if (app.dirty || app.conflict) return; app.meeting = null; showHome(); };
  $('backBtn').onclick = $('returnBtn').onclick = returnHome;
  $('printBtn').onclick = async () => { await save(); if (app.dirty || app.conflict) return; renderPrint(); print(); };
  $('reviewBtn').onclick = $('bottomReview').onclick = openReview;
  for (const id of ['title','date','location','noteTaker','attendees','startTime','endTime','series','chair','apologies','calendarEventId']) $(id).oninput = () => {
    if (!editing()) return;
    app.meeting[id] = $(id).value; changed(); renderPrint();
  };
  $('addTopic').onclick = addTopic;
  $('closeDetail').onclick = $('closeDetailBottom').onclick = closeDetails;
  $('insertLink').onclick = () => {
    if (!editing() || !app.detailId) return;
    const raw = prompt('Paste a Workdeck file link (for example, /docs/… or /todo/…)');
    if (!raw) return;
    const link = window.WDLinks?.parseHref(raw.trim());
    if (!link || link.app === 'resolver') { alert('Please paste a valid Workdeck file link.'); return; }
    const label = prompt('Label for this link', window.WDLinks.APPS[link.app]?.name || 'Workdeck file') || 'Workdeck file';
    const index = app.quill.getSelection(true)?.index ?? app.quill.getLength() - 1;
    app.quill.insertText(index, label, { link: window.WDLinks.url(link.app, link.id) }, 'user');
    app.quill.insertText(index + label.length, ' ', 'user');
  };
  $('actionsDisclosure').ontoggle = async () => {
    if (!$('actionsDisclosure').open || !app.meeting || app.dirty) return;
    try { const response = await (window.WDBoot?.fetch || fetch)('/api/minutes', { cache: 'no-store', credentials: 'same-origin' }); if (response.ok) { app.todo = (await response.json()).data.todo || []; updateTaskBadges(); updateActionSummary(); } } catch (_) { /* Keep last known status. */ }
  };
  $('closeReview').onclick = $('cancelReview').onclick = () => $('reviewOverlay').classList.add('hidden');
  $('recordState').onchange = () => $('approvedLabel').classList.toggle('hidden', $('recordState').value !== 'final');
  $('confirmReview').onclick = async () => {
    changed(); app.meeting.state = $('recordState').value; app.meeting.approvedBy = app.meeting.state === 'final' ? $('approvedBy').value : '';
    $('reviewOverlay').classList.add('hidden'); await save(); if (!app.dirty) renderMeeting();
  };
  addEventListener('beforeunload', event => { if (app.dirty || app.saving) { event.preventDefault(); event.returnValue = ''; } });
  addEventListener('storage', event => { if (event.key === 'workdeck_theme') applyTheme(); });
  load();
}
init();
