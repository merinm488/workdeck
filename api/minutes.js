import { accountHash, applyCorsHeaders, generateId, getUserDoc, saveOwnedSections } from './_lib/store.js';
import { scrubPostHtml } from './_lib/posts.js';

const TYPES = new Set(['discussion', 'decision', 'action', 'information', 'question']);
const STATES = new Set(['draft', 'review', 'final']);
const str = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
const idOk = value => /^[a-z0-9_]{14,}$/.test(value || '');

function cleanMeeting(input, prior) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.agenda) || input.agenda.length > 100) throw new Error('Invalid meeting or too many agenda items');
  const seen = new Set();
  const unique = id => { if (!idOk(id) || seen.has(id)) throw new Error('Invalid or duplicate ID'); seen.add(id); return id; };
  const agenda = input.agenda.map(section => {
    if (!Array.isArray(section.points) || section.points.length > 200) throw new Error('Invalid or too many points');
    return { id: unique(section.id), title: str(section.title, 200), points: section.points.map(point => {
      const id = unique(point.id);
      const old = prior?.agenda?.flatMap(s => s.points || []).find(p => p.id === id);
      return {
        id, type: TYPES.has(point.type) ? point.type : 'discussion',
        text: str(point.text, 2000), notes: scrubPostHtml(str(point.notes, 15000)),
        owner: str(point.owner, 120), dueDate: date(point.dueDate),
        // The client cannot choose or change the Todo record attached to a point.
        todoListId: old?.todoListId || null, todoTaskId: old?.todoTaskId || null
      };
    }) };
  });
  const state = STATES.has(input.state) ? input.state : 'draft';
  return {
    id: prior?.id || input.id, title: str(input.title, 200) || 'Untitled meeting',
    date: date(input.date), startTime: str(input.startTime, 5), endTime: str(input.endTime, 5),
    location: str(input.location, 300), chair: str(input.chair, 120), noteTaker: str(input.noteTaker, 120),
    attendees: str(input.attendees, 1000), apologies: str(input.apologies, 1000),
    series: str(input.series, 120), calendarEventId: idOk(input.calendarEventId) ? input.calendarEventId : null,
    state, approvedBy: state === 'final' ? str(input.approvedBy, 120) : '',
    approvedAt: state === 'final' ? (prior?.state === 'final' ? prior.approvedAt : new Date().toISOString()) : null,
    agenda, tagId: prior?.tagId || null, createdAt: prior?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(), revision: (prior?.revision || 0) + 1
  };
}

function taskDescription(meeting, section, owner) {
  return `Responsible: ${owner || 'Unassigned'}\nFrom Minutes: ${meeting.title} · ${section.title || 'Agenda'}\n/minutes/${meeting.id}`;
}

// Todo remains the source of truth for completion. Meeting edits only change
// title/due/owner when those specific fields were edited in Minutes.
function syncActions(doc, meeting, prior) {
  let changed = false;
  let list = (doc.todo || []).find(l => l.id === (meeting.agenda.flatMap(s => s.points).find(p => p.todoListId)?.todoListId));
  const previous = new Map((prior?.agenda || []).flatMap(s => s.points || []).map(p => [p.id, p]));
  for (const section of meeting.agenda) for (const point of section.points) {
    if (point.type !== 'action' || !point.text) continue;
    const old = previous.get(point.id);
    let dest = (doc.todo || []).find(l => l.id === point.todoListId);
    let task = dest?.items?.find(t => t.id === point.todoTaskId);
    if (task) {
      let taskChanged = false;
      if (point.text !== old?.text) { task.title = point.text; taskChanged = true; }
      if (point.dueDate !== old?.dueDate) { task.dueDate = point.dueDate || null; taskChanged = true; }
      if (point.owner !== old?.owner) { task.owner = point.owner; taskChanged = true; }
      if (task.description === taskDescription(prior, section, old?.owner) && task.description !== taskDescription(meeting, section, point.owner)) { task.description = taskDescription(meeting, section, point.owner); taskChanged = true; }
      if (taskChanged) { dest.updatedAt = new Date().toISOString(); changed = true; }
    } else if (!point.todoTaskId) {
      if (!list) {
        list = { id: generateId(), name: 'Meeting actions', items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        doc.todo = doc.todo || [];
        doc.todo.unshift(list);
      }
      const taskId = generateId();
      list.items.push({ id: taskId, title: point.text, description: taskDescription(meeting, section, point.owner), dueDate: point.dueDate || null, priority: 'medium', owner: point.owner, completed: false, createdAt: new Date().toISOString(), sourceMinuteId: meeting.id, sourcePointId: point.id });
      list.updatedAt = new Date().toISOString();
      changed = true;
      point.todoListId = list.id;
      point.todoTaskId = taskId;
    }
    // Deleted Todo tasks are NOT silently recreated. The Minutes UI flags the broken link.
  }
  return changed;
}

export default async function handler(req, res) {
  applyCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const hash = accountHash(req.method === 'GET' ? req.query : req.body);
  if (!hash) return res.status(400).json({ success: false, error: 'Account required' });
  try {
    const doc = await getUserDoc(hash);
    if (!doc) return res.status(404).json({ success: false, error: 'Account not found' });
    doc.minutes ||= [];
    if (req.method === 'GET') return res.status(200).json({ success: true, data: { minutes: doc.minutes, todo: doc.todo, events: doc.events, settings: doc.settings } });
    if (req.method !== 'PUT') return res.status(405).json({ success: false, error: 'Method not allowed' });
    const { action, data } = req.body || {};
    if (action === 'create') {
      const now = new Date().toISOString();
      const meeting = { id: generateId(), title: str(data?.title, 200) || 'Untitled meeting', date: date(data?.date) || now.slice(0, 10), state: 'draft', revision: 0, agenda: [], createdAt: now, updatedAt: now };
      doc.minutes.unshift(meeting);
      if (!await saveOwnedSections(hash, { minutes: doc.minutes })) throw new Error('Save failed');
      return res.json({ success: true, meeting });
    }
    if (action === 'save') {
      const previous = doc.minutes.find(m => m.id === data?.id);
      if (!previous) return res.status(404).json({ success: false, error: 'Meeting not found' });
      if (data.revision !== previous.revision) return res.status(409).json({ success: false, error: 'This meeting changed elsewhere. Reload before editing further.' });
      const meeting = cleanMeeting(data, previous);
      // A final version is read-only; reopen explicitly (as a new draft).
      if (previous.state === 'final' && meeting.state !== 'draft' && meeting.state !== 'final') return res.status(400).json({ success: false, error: 'Reopen the final record before editing' });
      if (previous.state === 'final' && meeting.state === 'final') return res.status(400).json({ success: false, error: 'Reopen the final record before editing' });
      const todoChanged = syncActions(doc, meeting, previous);
      doc.minutes[doc.minutes.findIndex(m => m.id === previous.id)] = meeting;
      if (!await saveOwnedSections(hash, { minutes: doc.minutes, ...(todoChanged ? { todo: doc.todo } : {}) })) throw new Error('Save failed');
      return res.json({ success: true, meeting, todo: doc.todo });
    }
    if (action === 'delete') {
      const target = doc.minutes.find(m => m.id === data?.id);
      if (!target) return res.status(404).json({ success: false, error: 'Meeting not found' });
      doc.minutes = doc.minutes.filter(m => m.id !== target.id);
      if (!await saveOwnedSections(hash, { minutes: doc.minutes })) throw new Error('Save failed');
      // Todo actions intentionally survive deletion of their source minutes.
      return res.json({ success: true });
    }
    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    if (error.message?.startsWith('Invalid')) return res.status(400).json({ success: false, error: error.message });
    console.error('[MINUTES]', error);
    return res.status(500).json({ success: false, error: 'Could not save Minutes' });
  }
}
