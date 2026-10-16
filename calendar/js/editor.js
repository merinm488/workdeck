/**
 * ================================================
 * CALENDAR - Application Logic
 * ================================================
 *
 * FullCalendar renders the grid; this file owns everything else:
 * - Event CRUD against /api/calendar (records: masters + standalone
 *   exception records with parentEventId/origStart)
 * - Recurrence: RRULE strings expanded with rrule.js in a floating-UTC
 *   space (see floatFromInstant), with exdates and exceptions
 * - Reminders (in-app toast + Notification API), search, shortcuts,
 *   ICS import/export, Todo tasks overlay, file links (WDLinks)
 */

// ================================================
// State
// ================================================

let userData = null;          // whole unified doc (calendars, events, todo, ...)
let calendar = null;          // FullCalendar instance
let editing = null;           // { recordId, occKey } while the editor is open
let pendingLinks = [];        // [{ app, id, name }] in the open editor
let pendingScope = null;      // { kind: 'save'|'delete', recordId, occKey, record }
let linkPickerTarget = null;  // null | function(link)
let searchTimer = null;
let reminderTimer = null;

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const RRULE_DAYS = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

function $(id) {
    return document.getElementById(id);
}

// ================================================
// Generic UI helpers
// ================================================

function showNotification(message, type) {
    const el = $('notification');
    el.textContent = message;
    el.className = 'notification show' + (type ? ' ' + type : '');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3500);
}

function openModal(el) {
    el.classList.add('active');
}

function closeModal(el) {
    el.classList.remove('active');
}

function anyModalOpen() {
    return Boolean(document.querySelector('.key-modal.active'));
}

function openConfirm(title, message, actionLabel, onConfirm) {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    $('confirmAction').textContent = actionLabel || 'Delete';
    $('confirmAction').onclick = async () => {
        closeModal($('confirmModal'));
        await onConfirm();
    };
    openModal($('confirmModal'));
}

function genRecordId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// ================================================
// Date/time + duration helpers
// ================================================

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** Local Date -> 'YYYY-MM-DD'. */
function fmtDateStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 'YYYY-MM-DD' -> local midnight Date. */
function parseDateStr(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
}

function isDateStr(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

/** date + 'HH:MM' -> UTC ISO instant (browser-local wall clock). */
function combineLocalIso(dateStr, timeStr) {
    const d = parseDateStr(dateStr);
    const [h, min] = String(timeStr || '00:00').split(':').map(Number);
    d.setHours(h || 0, min || 0, 0, 0);
    return d.toISOString();
}

function timePartsOfIso(iso) {
    const d = new Date(iso);
    return {
        date: fmtDateStr(d),
        time: pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    };
}

function msToIsoDuration(ms) {
    const mins = Math.max(1, Math.round(ms / 60000));
    if (mins % 1440 === 0) return 'P' + (mins / 1440) + 'D';
    if (mins % 60 === 0) return 'PT' + (mins / 60) + 'H';
    return 'PT' + mins + 'M';
}

function isoDurationToMs(s) {
    const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || ''));
    if (!m) return 30 * 60000;
    return ((+m[1] || 0) * 7 * 86400 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 +
        (+m[4] || 0) * 60 + (+m[5] || 0)) * 1000;
}

function fmtTime(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Human range for popovers/search: 'Wed, Oct 14 · 9:00 – 10:00 AM'. */
function fmtWhen(start, end, allDay) {
    const s = allDay ? parseDateStr(start) : new Date(start);
    const day = s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (allDay) {
        if (!end) return day + ' · All day';
        const e = parseDateStr(end);
        e.setDate(e.getDate() - 1); // stored exclusive
        if (fmtDateStr(e) === fmtDateStr(s)) return day + ' · All day';
        return day + ' – ' + e.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }
    const e = end ? new Date(end) : null;
    if (e && fmtDateStr(e) !== fmtDateStr(s)) {
        return day + ' · ' + fmtTime(s) + ' – ' + e.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + fmtTime(e);
    }
    return day + ' · ' + fmtTime(s) + (e ? ' – ' + fmtTime(e) : '');
}

// ================================================
// Floating-UTC recurrence space
// ================================================
// rrule.js does its math on a Date's LOCAL fields. We expand recurring
// events in a space where those local fields mirror the stored instant's
// UTC fields, so "every day at 9:00" stays pinned to the wall clock the
// event was created with, independent of DST.

function floatFromInstant(date) {
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
        date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), 0);
}

function floatToInstantIso(d) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours(), d.getMinutes(), d.getSeconds())).toISOString();
}

/** Parse an RRULE string (no DTSTART) into an RRule anchored at dtstart. */
function buildRule(rruleStr, dtstart) {
    if (!rruleStr || typeof rrule === 'undefined') return null;
    try {
        const parsed = rrule.rrulestr(String(rruleStr).replace(/^RRULE:/i, '')).origOptions;
        const opts = { ...parsed, dtstart };
        delete opts.dtstart;
        if (parsed.until) opts.until = floatFromInstant(parsed.until);
        if (parsed.wkst !== undefined) opts.wkst = parsed.wkst;
        return new rrule.RRule({ ...opts, dtstart });
    } catch (err) {
        console.error('[RRULE] Parse failed:', rruleStr, err);
        return null;
    }
}

/** RRule -> RRULE string without the RRULE:/DTSTART preamble. */
function ruleToString(rule) {
    return rule.toString().replace(/^RRULE:/i, '').split('\n')
        .filter(line => line && !/^DTSTART/i.test(line)).join('\n').trim();
}

/**
 * All occurrence keys of a record falling in [winStart, winEnd] (real Date
 * instants), excluding exdates and exception origStarts. Non-recurring
 * records yield their single base key when it's in range.
 * Keys are ISO instants for timed events, 'YYYY-MM-DD' for all-day.
 */
function occurrenceKeys(record, winStart, winEnd) {
    const keys = [];
    if (!record.rrule) {
        const startMs = isDateStr(record.start) ? parseDateStr(record.start).getTime() : new Date(record.start).getTime();
        if (startMs >= winStart.getTime() - 86400000 && startMs <= winEnd.getTime() + 86400000) {
            keys.push(record.start);
        }
        return keys;
    }

    const allDay = isDateStr(record.start);
    const dtstart = allDay ? parseDateStr(record.start) : floatFromInstant(new Date(record.start));
    const rule = buildRule(record.rrule, dtstart);
    if (!rule) return keys;

    const occs = rule.between(
        allDay ? new Date(winStart.getFullYear(), winStart.getMonth(), winStart.getDate() - 2)
               : floatFromInstant(winStart),
        allDay ? new Date(winEnd.getFullYear(), winEnd.getMonth(), winEnd.getDate() + 2)
               : floatFromInstant(winEnd),
        true
    ).slice(0, 500);

    const excluded = new Set(record.exdates || []);
    (userData.events || []).forEach(ev => {
        if (ev && ev.parentEventId === record.id && ev.origStart) excluded.add(ev.origStart);
    });

    for (const occ of occs) {
        const key = allDay ? fmtDateStr(occ) : floatToInstantIso(occ);
        if (!excluded.has(key)) keys.push(key);
    }
    return keys;
}

/** Concrete start/end of one occurrence key (falls back to the record). */
function occurrenceTimes(record, occKey) {
    if (!record.rrule || occKey === record.start) {
        return { start: record.start, end: record.end };
    }
    if (isDateStr(record.start)) {
        const days = Math.max(1, Math.round(
            (parseDateStr(record.end || record.start) - parseDateStr(record.start)) / 86400000));
        const s = parseDateStr(occKey);
        const e = new Date(s.getTime() + days * 86400000);
        return { start: occKey, end: fmtDateStr(e) };
    }
    const startMs = new Date(occKey).getTime();
    const durMs = Math.max(60000, new Date(record.end).getTime() - new Date(record.start).getTime());
    return { start: occKey, end: new Date(startMs + durMs).toISOString() };
}

/**
 * Truncate a series so it stops before occKey ("this and following").
 * Returns the new RRULE string, or null when nothing would remain.
 */
function truncateRule(record, occKey) {
    const allDay = isDateStr(record.start);
    const dtstart = allDay ? parseDateStr(record.start) : floatFromInstant(new Date(record.start));
    const rule = buildRule(record.rrule, dtstart);
    if (!rule) return null;

    const occFloat = allDay ? parseDateStr(occKey) : floatFromInstant(new Date(occKey));

    if (rule.origOptions.count) {
        const before = rule.between(dtstart, occFloat, false).length;
        if (before <= 0) return null;
        const opts = { ...rule.origOptions, dtstart, count: before };
        delete opts.until;
        return ruleToString(new rrule.RRule(opts));
    }

    const until = new Date(occFloat.getTime() - (allDay ? 86400000 : 1000));
    if (until.getTime() < dtstart.getTime()) return null;
    const opts = { ...rule.origOptions, dtstart, until };
    delete opts.count;
    return ruleToString(new rrule.RRule(opts));
}

// ================================================
// Records <-> FullCalendar events
// ================================================

function getCalendar(calId) {
    return (userData.calendars || []).find(c => c && c.id === calId) || null;
}

function findRecord(recordId) {
    return (userData.events || []).find(e => e && e.id === recordId) || null;
}

/**
 * The app has one main calendar: every event lives in it. Legacy
 * accounts may still carry extra calendars (their events keep the old
 * colors) — new events always go into the first one.
 */
function mainCalendarId() {
    const first = (userData.calendars || []).find(c => c);
    return first ? first.id : null;
}

/** One FC event for a record (+ optional occurrence key). */
function fcEventFor(record, occKey) {
    const cal = getCalendar(record.calId);
    const color = (cal && cal.color) || '#0284c7';
    const times = record.rrule ? occurrenceTimes(record, occKey) : { start: record.start, end: record.end };
    return {
        id: 'r:' + record.id + (occKey && record.rrule ? '~' + occKey : ''),
        title: record.title || '(no title)',
        start: times.start,
        end: times.end,
        allDay: isDateStr(times.start),
        backgroundColor: color,
        borderColor: color,
        textColor: '#ffffff',
        extendedProps: {
            kind: 'event',
            recordId: record.id,
            occKey: record.rrule ? occKey : null,
            calId: record.calId,
            recurring: Boolean(record.rrule),
            record: record
        }
    };
}

/** Everything the grid should show in [start, end]. */
function computeFcEvents(start, end) {
    const out = [];

    (userData.events || []).forEach(record => {
        if (!record) return;
        if (record.parentEventId) {
            out.push(fcEventFor(record, null));
            return;
        }
        occurrenceKeys(record, start, end).forEach(key => {
            out.push(fcEventFor(record, key));
        });
    });

    if (showTodoTasks()) {
        out.push(...todoFcEvents());
    }
    return out;
}

/** Todo items with due dates as all-day items. */
function todoFcEvents() {
    const out = [];
    (userData.todo || []).forEach(list => {
        (list && Array.isArray(list.items) ? list.items : []).forEach(item => {
            if (!item || !item.dueDate || item.completed) return;
            out.push({
                id: 't:' + item.id,
                title: item.title || '(task)',
                start: item.dueDate,
                allDay: true,
                backgroundColor: 'transparent',
                borderColor: 'transparent',
                classNames: ['ev-todo'],
                extendedProps: {
                    kind: 'todo',
                    listId: list.id,
                    itemId: item.id,
                    priority: item.priority || 'medium'
                }
            });
        });
    });
    return out;
}

function showTodoTasks() {
    return localStorage.getItem(APP_CONFIG.todo.storageKey) !== 'off';
}

function parseFcId(fcId) {
    // 'r:<recordId>' | 'r:<recordId>~<occKey>' | 't:<itemId>'
    if (fcId.startsWith('t:')) return { kind: 'todo', itemId: fcId.slice(2) };
    const body = fcId.slice(2);
    const tilde = body.indexOf('~');
    return tilde === -1
        ? { kind: 'event', recordId: body, occKey: null }
        : { kind: 'event', recordId: body.slice(0, tilde), occKey: body.slice(tilde + 1) };
}

// ================================================
// FullCalendar init
// ================================================

function initCalendar() {
    const calEl = $('calendarEl');
    const savedView = localStorage.getItem(APP_CONFIG.view.storageKey) || APP_CONFIG.view.defaultView;

    calendar = new FullCalendar.Calendar(calEl, {
        initialView: savedView,
        height: '100%',
        firstDay: 1,
        nowIndicator: true,
        navLinks: true,
        selectable: true,
        selectMirror: true,
        dayMaxEventRows: true,
        slotDuration: '00:30:00',
        slotLabelInterval: '01:00',
        scrollTime: '08:00:00',
        eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
        },
        buttonText: { today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'Agenda' },

        events: (info, success) => success(computeFcEvents(info.start, info.end)),

        datesSet: (info) => {
            localStorage.setItem(APP_CONFIG.view.storageKey, info.view.type);
        },

        select: (info) => {
            calendar.unselect();
            // A plain click yields a zero-length selection; give it a size.
            const zero = !info.end || info.end.getTime() <= info.start.getTime();
            const end = zero
                ? new Date(info.start.getTime() + (info.allDay ? 86400000 : 1800000))
                : info.end;
            openEditorForNew(info.start, end, info.allDay);
        },

        dateClick: (info) => {
            if (info.view.type !== 'dayGridMonth') return;
            openEditorForNew(info.date, null, false);
        },

        eventClick: (info) => {
            const props = info.event.extendedProps || {};
            if (props.kind === 'todo') {
                if (typeof WDLinks !== 'undefined' && props.listId) {
                    WDLinks.open('todo', props.listId, { newTab: true });
                }
                return;
            }
            showPopover(info.event, info.el);
        },

        eventDrop: (info) => {
            handleMoveResize(info);
        },

        eventResize: (info) => {
            handleMoveResize(info);
        },

        eventDidMount: (info) => {
            const props = info.event.extendedProps || {};
            if (props.kind === 'todo') {
                info.el.style.setProperty('--todo-color', APP_CONFIG.todo.color);
                info.el.title = 'Todo: ' + info.event.title;
            }
        }
    });

    calendar.render();
}

/** Persist a drag-move or resize (occurrence moves become exceptions). */
async function handleMoveResize(info) {
    const parsed = parseFcId(info.event.id);
    if (parsed.kind !== 'event') {
        info.revert();
        return;
    }
    const record = findRecord(parsed.recordId);
    if (!record) {
        info.revert();
        return;
    }

    const start = info.event.start;
    const end = info.event.end;
    const allDay = info.event.allDay;
    const startVal = allDay ? fmtDateStr(start) : start.toISOString();
    let endVal;
    if (allDay) {
        const exclusive = end || new Date(start.getTime() + 86400000);
        endVal = fmtDateStr(exclusive);
    } else {
        endVal = end ? end.toISOString() : new Date(start.getTime() + 3600000).toISOString();
    }

    try {
        if (record.rrule && parsed.occKey) {
            // One occurrence moved/resized -> standalone exception.
            const times = occurrenceTimes(record, parsed.occKey);
            const exception = {
                id: genRecordId(),
                calId: record.calId,
                parentEventId: record.id,
                origStart: parsed.occKey,
                title: record.title,
                description: record.description || '',
                location: record.location || '',
                allDay,
                start: startVal,
                end: endVal,
                exdates: [],
                reminders: record.reminders || [],
                links: record.links || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const result = await calendarStorage.createEvent(exception);
            if (!result) throw new Error('save failed');
            setUserData(result);
        } else {
            const updated = { ...record, allDay, start: startVal, end: endVal,
                updatedAt: new Date().toISOString() };
            const result = await calendarStorage.updateEvent(record.id, updated);
            if (!result) throw new Error('save failed');
            setUserData(result);
        }
        refreshAll();
    } catch (err) {
        console.error('[MOVE] Failed:', err);
        info.revert();
        showNotification('Could not save the move. Please try again.', 'error');
    }
}

// ================================================
// Data refresh
// ================================================

function setUserData(doc) {
    if (doc && typeof doc === 'object' && Array.isArray(doc.calendars)) userData = doc;
}

function refreshAll() {
    renderEvents();
    if (calendar) calendar.refetchEvents();
    renderFooter();
}

function renderFooter() {
    const events = (userData.events || []).length;
    $('calFooterStats').textContent =
        events + ' event' + (events === 1 ? '' : 's');
}

// ================================================
// Event editor modal
// ================================================

/** Make sure the main calendar exists (fresh accounts); returns its id. */
function ensureMainCalendar() {
    if ((userData.calendars || []).length > 0) {
        return Promise.resolve(mainCalendarId());
    }
    return calendarStorage.createCalendar('Personal', APP_CONFIG.colors[0]).then(result => {
        if (result) setUserData(result);
        return mainCalendarId();
    });
}

/** Fresh editor for a click/drag-created slot. */
function openEditorForNew(start, end, allDay) {
    const calId = mainCalendarId();
    if (!calId) {
        showNotification('Your calendar is still loading — try again.', 'error');
        return;
    }

    const startD = start instanceof Date ? start : new Date();
    // Round to the next half hour for timed slots.
    let startD2 = startD;
    let endD;
    if (allDay) {
        endD = end || new Date(startD.getTime() + 86400000);
    } else {
        startD2 = new Date(startD.getTime());
        startD2.setSeconds(0, 0);
        startD2.setMinutes(startD.getMinutes() < 30 ? 30 : 60);
        endD = end || new Date(startD2.getTime() + 3600000);
    }

    editing = null;
    populateEditor({
        record: {
            calId,
            title: '',
            description: '',
            location: '',
            allDay: Boolean(allDay),
            start: allDay ? fmtDateStr(startD2) : startD2.toISOString(),
            end: allDay ? fmtDateStr(endD) : endD.toISOString(),
            rrule: '',
            exdates: [],
            reminders: [10],
            links: []
        },
        occKey: null
    });
}

/** Editor for an existing record (optionally one occurrence of a series). */
function openEditorForRecord(recordId, occKey) {
    const record = findRecord(recordId);
    if (!record) return;
    editing = { recordId, occKey: occKey || null };
    populateEditor({ record, occKey: occKey || null });
}

function populateEditor({ record, occKey }) {
    const isNew = !editing;
    $('evModalTitle').textContent = isNew ? 'New Event'
        : (record.rrule && occKey ? 'Edit Repeating Event' : 'Edit Event');
    $('evDeleteBtn').classList.toggle('hidden', isNew);

    $('evTitle').value = record.title || '';
    $('evLocation').value = record.location || '';
    $('evDescription').value = record.description || '';

    const s = isDateStr(record.start);
    const startParts = s
        ? { date: record.start, time: '00:00' }
        : timePartsOfIso(record.start);
    const endParts = isDateStr(record.end)
        ? { date: record.end, time: '00:00' }
        : (record.end ? timePartsOfIso(record.end) : startParts);

    $('evAllDay').checked = Boolean(record.allDay);
    $('evStart').value = startParts.date;
    $('evStartTime').value = startParts.time;
    $('evEnd').value = endParts.date;
    $('evEndTime').value = endParts.time;
    syncAllDayFields();

    // Repeat
    syncRepeatSelect(record.rrule || '', record.start);
    $('repeatBuilder').classList.toggle('hidden', $('evRepeat').value !== 'custom');
    if ($('evRepeat').value === 'custom') populateBuilder(record.rrule);

    // Reminders
    renderReminderChips(record.reminders || []);

    // Links
    pendingLinks = Array.isArray(record.links) ? record.links.slice() : [];
    renderLinkChips();

    openModal($('eventModal'));
    setTimeout(() => $('evTitle').focus(), 80);
}

function syncAllDayFields() {
    const allDay = $('evAllDay').checked;
    $('evStartTime').classList.toggle('hidden', allDay);
    $('evEndTime').classList.toggle('hidden', allDay);
}

/** Which preset does this RRULE match, if any? */
function rrulePreset(rruleStr) {
    if (!rruleStr) return '';
    const parts = {};
    String(rruleStr).replace(/^RRULE:/i, '').split(';').forEach(p => {
        const [k, v] = p.split('=');
        if (k) parts[k.toUpperCase()] = v;
    });
    const interval = Number(parts.INTERVAL || 1);
    const noEnd = !parts.UNTIL && !parts.COUNT;
    if (parts.FREQ === 'DAILY' && interval === 1 && noEnd) return 'daily';
    if (parts.FREQ === 'WEEKLY' && interval === 1 && noEnd &&
        parts.BYDAY && /^[A-Z]{2}$/.test(parts.BYDAY)) return 'weekly';
    if (parts.FREQ === 'MONTHLY' && interval === 1 && noEnd &&
        parts.BYMONTHDAY && /^\d{1,2}$/.test(parts.BYMONTHDAY)) return 'monthly';
    if (parts.FREQ === 'YEARLY' && interval === 1 && noEnd && !parts.BYDAY &&
        !parts.BYMONTHDAY && !parts.BYMONTH) return 'yearly';
    return 'custom';
}

function syncRepeatSelect(rruleStr, startStr) {
    const preset = rrulePreset(rruleStr);
    $('evRepeat').value = preset || '';
    // Pre-pick the start's weekday for the weekly preset label.
    const d = isDateStr(startStr) ? parseDateStr(startStr) : new Date(startStr);
    $('evRepeat').options[2].textContent = 'Weekly on ' +
        d.toLocaleDateString([], { weekday: 'long' });
}

function rruleForPreset(preset, record) {
    const d = isDateStr(record.start) ? parseDateStr(record.start) : new Date(record.start);
    switch (preset) {
        case 'daily': return 'FREQ=DAILY';
        case 'weekly': return 'FREQ=WEEKLY;BYDAY=' + DAY_NAMES[d.getDay()];
        case 'monthly': return 'FREQ=MONTHLY;BYMONTHDAY=' + d.getDate();
        case 'yearly': return 'FREQ=YEARLY';
        default: return '';
    }
}

/** Collect the editor form into a plain record (no exception logic). */
function collectEditor() {
    const allDay = $('evAllDay').checked;
    const startDate = $('evStart').value;
    const endDate = $('evEnd').value;
    if (!startDate || !endDate) {
        showNotification('Start and end dates are required.', 'error');
        return null;
    }

    let start, end;
    if (allDay) {
        start = startDate;
        end = endDate >= startDate ? endDate : startDate;
    } else {
        start = combineLocalIso(startDate, $('evStartTime').value || '09:00');
        end = combineLocalIso(endDate, $('evEndTime').value || '10:00');
        if (new Date(end) <= new Date(start)) {
            end = new Date(new Date(start).getTime() + 1800000).toISOString();
        }
    }

    const preset = $('evRepeat').value;
    const rruleStr = preset === 'custom'
        ? buildCustomRrule()
        : rruleForPreset(preset, { start: allDay ? startDate : start });

    const reminders = [];
    document.querySelectorAll('#evReminders .reminder-check:checked').forEach(cb => {
        reminders.push(Number(cb.value));
    });
    reminders.sort((a, b) => a - b);

    const record = {
        calId: mainCalendarId(),
        title: $('evTitle').value.trim() || '(no title)',
        description: $('evDescription').value.trim(),
        location: $('evLocation').value.trim(),
        allDay,
        start,
        end,
        rrule: rruleStr || null,
        exdates: [],
        reminders,
        links: pendingLinks.slice()
    };
    if (rruleStr) {
        record.duration = allDay
            ? msToIsoDuration(parseDateStr(end) - parseDateStr(start) || 86400000)
            : msToIsoDuration(new Date(end) - new Date(start));
    }
    return record;
}

async function saveEditor() {
    const record = collectEditor();
    if (!record) return;

    if (!editing) {
        const result = await calendarStorage.createEvent({
            ...record, id: genRecordId(), createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        if (!result) {
            showNotification('Could not save the event.', 'error');
            return;
        }
        setUserData(result);
        refreshAll();
        closeModal($('eventModal'));
        showNotification('Event created', 'success');
        maybeAskNotificationPermission(record);
        return;
    }

    // Recurring + editing a single occurrence -> ask about scope.
    const target = findRecord(editing.recordId);
    if (target && target.rrule && editing.occKey) {
        pendingScope = { kind: 'save', recordId: editing.recordId, occKey: editing.occKey, record };
        openScopeModal('save');
        return;
    }

    const updated = { ...target, ...record, id: target.id,
        parentEventId: target.parentEventId || null,
        origStart: target.origStart || null,
        exdates: target.exdates || [],
        updatedAt: new Date().toISOString() };
    const result = await calendarStorage.updateEvent(target.id, updated);
    if (!result) {
        showNotification('Could not save the event.', 'error');
        return;
    }
    setUserData(result);
    refreshAll();
    closeModal($('eventModal'));
    hidePopover();
    showNotification('Event saved', 'success');
    maybeAskNotificationPermission(record);
}

// ================================================
// Occurrence scope ("this / following / all")
// ================================================

function openScopeModal(kind) {
    $('scopeTitle').textContent = kind === 'save' ? 'Apply changes' : 'Delete recurring event';
    $('scopeMessage').textContent = kind === 'save'
        ? 'This event repeats. Which occurrences should change?'
        : 'This event repeats. Which occurrences should be deleted?';
    openModal($('scopeModal'));
}

async function applyScope(choice) {
    const scope = pendingScope;
    pendingScope = null;
    closeModal($('scopeModal'));
    if (!scope) return;

    const master = findRecord(scope.recordId);
    if (!master) return;

    try {
        if (scope.kind === 'save') {
            if (choice === 'this') {
                const exception = {
                    id: genRecordId(),
                    calId: scope.record.calId,
                    parentEventId: master.id,
                    origStart: scope.occKey,
                    title: scope.record.title,
                    description: scope.record.description,
                    location: scope.record.location,
                    allDay: scope.record.allDay,
                    start: scope.record.start,
                    end: scope.record.end,
                    exdates: [],
                    reminders: scope.record.reminders,
                    links: scope.record.links,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                const result = await calendarStorage.createEvent(exception);
                if (!result) throw new Error('save failed');
                setUserData(result);
            } else if (choice === 'following') {
                const truncated = truncateRule(master, scope.occKey);
                if (!truncated) throw new Error('nothing would remain');
                const updated = { ...master, rrule: truncated, updatedAt: new Date().toISOString() };
                const result = await calendarStorage.updateEvent(master.id, updated);
                if (!result) throw new Error('save failed');
                setUserData(result);
                const next = {
                    ...scope.record,
                    id: genRecordId(),
                    start: scope.record.start,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                const result2 = await calendarStorage.createEvent(next);
                if (!result2) throw new Error('save failed');
                setUserData(result2);
            } else {
                const updated = {
                    ...master, ...scope.record, id: master.id,
                    exdates: master.exdates || [],
                    updatedAt: new Date().toISOString()
                };
                const result = await calendarStorage.updateEvent(master.id, updated);
                if (!result) throw new Error('save failed');
                setUserData(result);
            }
            showNotification('Series updated', 'success');
        } else {
            if (choice === 'this') {
                const updated = {
                    ...master,
                    exdates: [...(master.exdates || []), scope.occKey],
                    updatedAt: new Date().toISOString()
                };
                const result = await calendarStorage.updateEvent(master.id, updated);
                if (!result) throw new Error('delete failed');
                setUserData(result);
            } else if (choice === 'following') {
                const truncated = truncateRule(master, scope.occKey);
                if (!truncated) {
                    const result = await calendarStorage.deleteEvent(master.id);
                    if (!result) throw new Error('delete failed');
                    setUserData(result);
                } else {
                    const updated = { ...master, rrule: truncated, updatedAt: new Date().toISOString() };
                    const result = await calendarStorage.updateEvent(master.id, updated);
                    if (!result) throw new Error('delete failed');
                    setUserData(result);
                }
            } else {
                // Master + every exception record of the series.
                const exceptions = (userData.events || [])
                    .filter(e => e && e.parentEventId === master.id);
                for (const exc of exceptions) {
                    const result = await calendarStorage.deleteEvent(exc.id);
                    if (!result) throw new Error('delete failed');
                    setUserData(result);
                }
                const result = await calendarStorage.deleteEvent(master.id);
                if (!result) throw new Error('delete failed');
                setUserData(result);
            }
            showNotification('Deleted', 'success');
        }
        refreshAll();
        closeModal($('eventModal'));
        hidePopover();
    } catch (err) {
        console.error('[SCOPE] Failed:', err);
        showNotification('The change could not be saved. Please try again.', 'error');
        refreshAll();
    }
}

// ================================================
// Custom repeat builder
// ================================================

function renderBuilderDays() {
    const wrap = $('rbDayChecks');
    wrap.replaceChildren();
    DAY_NAMES.forEach((name, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rb-day';
        btn.dataset.day = name;
        btn.textContent = name.charAt(0);
        btn.title = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index];
        btn.addEventListener('click', () => btn.classList.toggle('selected'));
        wrap.appendChild(btn);
    });
}

function populateBuilder(rruleStr) {
    const parts = {};
    String(rruleStr || '').replace(/^RRULE:/i, '').split(';').forEach(p => {
        const [k, v] = p.split('=');
        if (k && v) parts[k.toUpperCase()] = v;
    });

    $('rbFreq').value = parts.FREQ || 'WEEKLY';
    $('rbInterval').value = parts.INTERVAL || 1;
    syncBuilderFreq();

    const checked = (parts.BYDAY || '').split(',').filter(Boolean);
    document.querySelectorAll('#rbDayChecks .rb-day').forEach(btn => {
        btn.classList.toggle('selected', checked.includes(btn.dataset.day));
    });

    const endMode = parts.UNTIL ? 'until' : (parts.COUNT ? 'count' : 'never');
    document.querySelector(`input[name="rbEnd"][value="${endMode}"]`).checked = true;
    if (parts.UNTIL) {
        const u = parts.UNTIL;
        $('rbUntilDate').value = u.length === 8
            ? u.slice(0, 4) + '-' + u.slice(4, 6) + '-' + u.slice(6, 8)
            : u.slice(0, 4) + '-' + u.slice(4, 6) + '-' + u.slice(6, 8);
    } else if (!$('rbUntilDate').value) {
        const d = new Date();
        d.setMonth(d.getMonth() + 3);
        $('rbUntilDate').value = fmtDateStr(d);
    }
    if (parts.COUNT) $('rbUntilCount').value = parts.COUNT;
}

function syncBuilderFreq() {
    const freq = $('rbFreq').value;
    const units = { DAILY: 'day(s)', WEEKLY: 'week(s)', MONTHLY: 'month(s)', YEARLY: 'year(s)' };
    $('rbIntervalUnit').textContent = units[freq];
    $('rbDaysGroup').classList.toggle('hidden', freq !== 'WEEKLY');
}

function buildCustomRrule() {
    const freq = $('rbFreq').value;
    const interval = Math.max(1, Number($('rbInterval').value) || 1);
    const parts = ['FREQ=' + freq];
    if (interval > 1) parts.push('INTERVAL=' + interval);

    if (freq === 'WEEKLY') {
        const days = [...document.querySelectorAll('#rbDayChecks .rb-day.selected')]
            .map(btn => btn.dataset.day);
        if (days.length) parts.push('BYDAY=' + days.join(','));
    }

    const endMode = document.querySelector('input[name="rbEnd"]:checked').value;
    if (endMode === 'until' && $('rbUntilDate').value) {
        const d = parseDateStr($('rbUntilDate').value);
        d.setHours(23, 59, 59, 0);
        const iso = d.toISOString();
        parts.push('UNTIL=' + iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) +
            'T' + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + 'Z');
    } else if (endMode === 'count') {
        parts.push('COUNT=' + Math.max(1, Number($('rbUntilCount').value) || 1));
    }
    return parts.join(';');
}

// ================================================
// Reminders UI (editor chips)
// ================================================

function reminderLabel(minutes) {
    if (minutes >= 1440) return (minutes / 1440) + ' day' + (minutes >= 2880 ? 's' : '') + ' before';
    if (minutes >= 60) return (minutes / 60) + ' hour' + (minutes >= 120 ? 's' : '') + ' before';
    return minutes + ' min before';
}

function renderReminderChips(selected) {
    const wrap = $('evReminders');
    wrap.replaceChildren();
    APP_CONFIG.reminders.options.forEach(minutes => {
        const chip = $('reminderChipTemplate').content.firstElementChild.cloneNode(true);
        const check = chip.querySelector('.reminder-check');
        check.value = String(minutes);
        chip.querySelector('.reminder-label').textContent = reminderLabel(minutes);
        check.checked = selected.includes(minutes);
        chip.classList.toggle('selected', check.checked);
        check.addEventListener('change', () => chip.classList.toggle('selected', check.checked));
        wrap.appendChild(chip);
    });
}

function maybeAskNotificationPermission(record) {
    if (!record.reminders || !record.reminders.length) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

// ================================================
// Reminder ticker
// ================================================

function loadFiredLog() {
    try {
        return JSON.parse(localStorage.getItem(APP_CONFIG.reminders.firedLogKey)) || {};
    } catch (err) {
        return {};
    }
}

function saveFiredLog(log) {
    const cutoff = Date.now() - 2 * 86400000;
    const pruned = {};
    Object.keys(log).forEach(key => {
        if (log[key] >= cutoff) pruned[key] = log[key];
    });
    localStorage.setItem(APP_CONFIG.reminders.firedLogKey, JSON.stringify(pruned));
}

function checkReminders() {
    if (!userData) return;
    const now = Date.now();
    const winStart = new Date(now - 120000);
    const winEnd = new Date(now + 24 * 3600000);
    const log = loadFiredLog();
    let dirty = false;

    (userData.events || []).forEach(record => {
        if (!record) return;
        if (record.parentEventId) return;
        const keys = occurrenceKeys(record, winStart, winEnd);
        keys.forEach(key => {
            const times = occurrenceTimes(record, key);
            const startMs = isDateStr(times.start)
                ? parseDateStr(times.start).getTime()
                : new Date(times.start).getTime();
            (record.reminders || []).forEach(minutes => {
                const fireAt = startMs - minutes * 60000;
                if (now < fireAt || now - fireAt > 120000) return;
                const logKey = record.id + '|' + key + '|' + minutes;
                if (log[logKey]) return;
                log[logKey] = Date.now();
                dirty = true;
                fireReminder(record, minutes);
            });
        });
    });

    if (dirty) saveFiredLog(log);
}

function fireReminder(record, minutes) {
    const title = record.title || '(no title)';
    const body = minutes === 0
        ? 'Starting now'
        : 'Starts ' + reminderLabel(minutes).replace(' before', '');
    showNotification('⏰ ' + title + ' — ' + body);

    try {
        if (typeof Notification !== 'undefined' &&
            Notification.permission === 'granted' &&
            localStorage.getItem('calendar_notify') !== 'off') {
            new Notification(title, { body, tag: 'wd-cal-' + record.id });
        }
    } catch (err) { /* notifications are optional */ }
}

// ================================================
// Event popover (quick view)
// ================================================

function hidePopover() {
    const existing = document.querySelector('.ev-popover');
    if (existing) existing.remove();
}

function showPopover(fcEvent, anchorEl) {
    hidePopover();
    const props = fcEvent.extendedProps || {};
    const record = props.record || findRecord(props.recordId);
    if (!record) return;

    const cal = getCalendar(props.calId);
    const color = (cal && cal.color) || '#0284c7';
    const node = $('calPopoverTemplate').content.firstElementChild.cloneNode(true);

    node.querySelector('.ev-popover-dot').style.background = color;
    node.querySelector('.ev-popover-title').textContent = fcEvent.title;
    node.querySelector('.ev-popover-time').textContent = fmtWhen(
        fcEvent.start, fcEvent.end, fcEvent.allDay);
    node.querySelector('.ev-popover-repeat').classList.toggle('hidden', !props.recurring);

    if (record.description) {
        const desc = node.querySelector('.ev-popover-desc');
        desc.textContent = record.description;
        desc.classList.remove('hidden');
    }
    if (Array.isArray(record.links) && record.links.length) {
        const linksWrap = node.querySelector('.ev-popover-links');
        linksWrap.classList.remove('hidden');
        record.links.forEach(link => linksWrap.appendChild(linkChip(link, false)));
    }
    if (Array.isArray(record.reminders) && record.reminders.length) {
        const rem = node.querySelector('.ev-popover-reminders');
        rem.textContent = 'Reminds ' + record.reminders.map(reminderLabel).join(', ').toLowerCase();
        rem.classList.remove('hidden');
    }

    node.querySelector('.ev-popover-edit').addEventListener('click', () => {
        hidePopover();
        openEditorForRecord(props.recordId, props.occKey);
    });
    node.querySelector('.ev-popover-delete').addEventListener('click', () => {
        hidePopover();
        requestDelete(props.recordId, props.occKey);
    });
    node.querySelector('.ev-popover-close').addEventListener('click', hidePopover);

    node.addEventListener('click', (e) => {
        const chip = e.target.closest('.link-chip');
        if (chip && chip.dataset.app && typeof WDLinks !== 'undefined') {
            hidePopover();
            WDLinks.open(chip.dataset.app, chip.dataset.id, { newTab: true });
        }
    });

    document.body.appendChild(node);

    // Position near the anchor, clamped to the viewport.
    const rect = anchorEl.getBoundingClientRect();
    const width = 300;
    const height = node.offsetHeight || 160;
    let left = Math.min(rect.left, window.innerWidth - width - 12);
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
    left = Math.max(12, left);
    node.style.position = 'fixed';
    node.style.left = left + 'px';
    node.style.top = top + 'px';
}

// ================================================
// Delete flows
// ================================================

function requestDelete(recordId, occKey) {
    const record = findRecord(recordId);
    if (!record) return;

    if (record.rrule && occKey) {
        pendingScope = { kind: 'delete', recordId, occKey };
        openScopeModal('delete');
        return;
    }

    const isException = Boolean(record.parentEventId);
    openConfirm(
        isException ? 'Delete this occurrence?' : 'Delete event?',
        '"' + (record.title || '(no title)') + '" will be permanently deleted.',
        'Delete',
        async () => {
            const result = await calendarStorage.deleteEvent(recordId);
            if (!result) {
                showNotification('Could not delete the event.', 'error');
                return;
            }
            setUserData(result);
            refreshAll();
            showNotification('Event deleted', 'success');
        }
    );
}

// ================================================
// Sidebar: upcoming events
// ================================================

const EVENT_LIST_LIMIT = 25;

/** Next occurrences across the calendar (masters + moved exceptions). */
function upcomingOccurrences() {
    const now = new Date();
    const winStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const winEnd = new Date(winStart.getTime() + 365 * 86400000);
    const rows = [];

    (userData.events || []).forEach(record => {
        if (!record) return;
        if (record.parentEventId) {
            rows.push({ record, occKey: null });
            return;
        }
        occurrenceKeys(record, winStart, winEnd).forEach(key => {
            rows.push({ record, occKey: record.rrule ? key : null });
        });
    });

    rows.forEach(row => {
        const times = occurrenceTimes(row.record, row.occKey);
        row.startMs = isDateStr(times.start)
            ? parseDateStr(times.start).getTime()
            : new Date(times.start).getTime();
    });
    return rows
        .filter(row => row.startMs >= winStart.getTime() && row.startMs <= winEnd.getTime())
        .sort((a, b) => a.startMs - b.startMs);
}

function renderEvents() {
    const list = $('eventList');
    list.replaceChildren();

    const rows = upcomingOccurrences().slice(0, EVENT_LIST_LIMIT);
    if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'cal-events-empty';
        empty.textContent = 'No upcoming events';
        list.appendChild(empty);
        return;
    }

    rows.forEach(row => {
        const node = $('eventRowTemplate').content.firstElementChild.cloneNode(true);
        const cal = getCalendar(row.record.calId);
        node.querySelector('.cal-row-dot').style.background = (cal && cal.color) || '#0284c7';
        node.querySelector('.cal-event-title').textContent = row.record.title || '(no title)';
        const times = occurrenceTimes(row.record, row.occKey);
        node.querySelector('.cal-event-when').textContent = fmtWhen(
            times.start, times.end, isDateStr(times.start));
        node.querySelector('.cal-event-repeat').classList.toggle('hidden', !row.record.rrule);

        const open = () => openEditorForRecord(row.record.id, row.occKey);
        node.addEventListener('click', open);
        node.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
        list.appendChild(node);
    });
}

// ================================================
// Todo tasks toggle
// ================================================

function initTodoToggle() {
    $('todoToggle').checked = showTodoTasks();
    $('todoToggle').addEventListener('change', () => {
        localStorage.setItem(APP_CONFIG.todo.storageKey, $('todoToggle').checked ? 'on' : 'off');
        if (calendar) calendar.refetchEvents();
    });
}

// ================================================
// Sidebar drawer (mobile)
// ================================================

function sidebarDrawerOpen() {
    return $('calSidebar').classList.contains('open');
}

function openSidebarDrawer() {
    $('calSidebar').classList.add('open');
    $('sidebarScrim').classList.add('show');
    $('sidebarToggleBtn').setAttribute('aria-expanded', 'true');
}

function closeSidebarDrawer() {
    $('calSidebar').classList.remove('open');
    $('sidebarScrim').classList.remove('show');
    $('sidebarToggleBtn').setAttribute('aria-expanded', 'false');
}

function initSidebarDrawer() {
    $('sidebarToggleBtn').addEventListener('click', () =>
        sidebarDrawerOpen() ? closeSidebarDrawer() : openSidebarDrawer());
    $('sidebarScrim').addEventListener('click', closeSidebarDrawer);
    $('newEventBtn').addEventListener('click', closeSidebarDrawer);
    document.addEventListener('click', (e) => {
        if (sidebarDrawerOpen() && e.target.closest('.cal-event-row')) closeSidebarDrawer();
    });
    const desktop = window.matchMedia('(min-width: 701px)');
    desktop.addEventListener('change', (e) => {
        if (e.matches) closeSidebarDrawer();
    });
}

// ================================================
// File links (WDLinks integration)
// ================================================

function linkChip(link, removable) {
    const chip = $('linkChipTemplate').content.firstElementChild.cloneNode(true);
    chip.dataset.app = link.app;
    chip.dataset.id = link.id;
    const iconWrap = chip.querySelector('.link-chip-icon');
    if (typeof WDLinks !== 'undefined') {
        iconWrap.appendChild(WDLinks.iconNode(link.app, 14));
    }
    chip.querySelector('.link-chip-name').textContent = link.name;
    const remove = chip.querySelector('.link-chip-remove');
    if (!removable) remove.remove();
    else {
        remove.addEventListener('click', () => {
            pendingLinks = pendingLinks.filter(l => !(l.id === link.id && l.app === link.app));
            renderLinkChips();
        });
    }
    return chip;
}

function renderLinkChips() {
    const wrap = $('evLinks');
    wrap.replaceChildren();
    pendingLinks.forEach(link => wrap.appendChild(linkChip(link, true)));
}

function allLinkableFiles() {
    const files = [];
    const sections = ['docs', 'sheets', 'forms', 'slides', 'draws', 'todo', 'files', 'folders'];
    const appIdOf = { docs: 'docs', sheets: 'sheets', forms: 'forms', slides: 'slides',
        draws: 'draw', todo: 'todo', files: 'filebox', folders: 'filebox' };
    const nameOf = {
        docs: d => d.title || 'Untitled',
        sheets: s => s.name || 'Untitled Sheet',
        forms: f => f.name || 'Untitled Form',
        slides: s => s.name || 'Untitled Deck',
        draws: d => d.name || 'Untitled Drawing',
        todo: t => t.name || 'Untitled List',
        files: f => f.name || 'Untitled',
        folders: f => f.name || 'Untitled Folder'
    };
    sections.forEach(section => {
        (userData[section] || []).forEach(item => {
            if (!item || !item.id) return;
            files.push({ app: appIdOf[section], id: item.id, name: nameOf[section](item) });
        });
    });
    return files;
}

function openLinkPicker() {
    linkPickerTarget = null;
    $('lpSearch').value = '';
    renderLinkPickerResults('');
    openModal($('linkPickerModal'));
    setTimeout(() => $('lpSearch').focus(), 80);
}

function renderLinkPickerResults(query) {
    const wrap = $('lpResults');
    wrap.replaceChildren();
    const q = query.toLowerCase().trim();
    const matches = allLinkableFiles().filter(file => !q || file.name.toLowerCase().includes(q));

    if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'lp-empty';
        empty.textContent = q ? 'No files match your search' : 'No files yet';
        wrap.appendChild(empty);
        return;
    }

    matches.slice(0, 100).forEach(file => {
        const row = $('lpRowTemplate').content.firstElementChild.cloneNode(true);
        const iconWrap = row.querySelector('.lp-row-icon');
        if (typeof WDLinks !== 'undefined') {
            iconWrap.appendChild(WDLinks.iconNode(file.app, 15));
        }
        row.querySelector('.lp-row-name').textContent = file.name;
        row.addEventListener('click', () => {
            if (!pendingLinks.some(l => l.id === file.id && l.app === file.app)) {
                pendingLinks.push(file);
                renderLinkChips();
            }
            closeModal($('linkPickerModal'));
        });
        wrap.appendChild(row);
    });
}

// ================================================
// Search
// ================================================

function runSearch(query) {
    const wrap = $('searchResults');
    wrap.replaceChildren();

    if (!query.trim()) {
        wrap.classList.add('hidden');
        return;
    }

    const q = query.toLowerCase().trim();
    const now = new Date();
    const winStart = new Date(now.getTime() - 90 * 86400000);
    const winEnd = new Date(now.getTime() + 365 * 86400000);
    const matches = [];

    (userData.events || []).forEach(record => {
        if (!record) return;
        const haystack = ((record.title || '') + ' ' + (record.description || '') + ' ' +
            (record.location || '')).toLowerCase();
        if (!haystack.includes(q)) return;
        occurrenceKeys(record, winStart, winEnd).slice(0, 10).forEach(key => {
            const times = occurrenceTimes(record, key);
            matches.push({
                record,
                key,
                sortMs: isDateStr(times.start) ? parseDateStr(times.start).getTime() : new Date(times.start).getTime()
            });
        });
    });

    matches.sort((a, b) => a.sortMs - b.sortMs);
    const top = matches.slice(0, 30);

    if (!top.length) {
        const empty = document.createElement('div');
        empty.className = 'search-empty';
        empty.textContent = 'No events match "' + query.trim() + '"';
        wrap.appendChild(empty);
        wrap.classList.remove('hidden');
        return;
    }

    top.forEach(match => {
        const cal = getCalendar(match.record.calId);
        const row = $('searchRowTemplate').content.firstElementChild.cloneNode(true);
        row.querySelector('.search-row-dot').style.background = (cal && cal.color) || '#0284c7';
        row.querySelector('.search-row-title').textContent = match.record.title || '(no title)';
        const times = occurrenceTimes(match.record, match.key);
        row.querySelector('.search-row-when').textContent = fmtWhen(
            times.start, times.end, isDateStr(times.start));
        row.addEventListener('click', () => {
            wrap.classList.add('hidden');
            gotoOccurrence(match.record, match.key);
        });
        wrap.appendChild(row);
    });

    wrap.classList.remove('hidden');
}

function gotoOccurrence(record, occKey) {
    const times = occurrenceTimes(record, occKey);
    const start = isDateStr(times.start) ? parseDateStr(times.start) : new Date(times.start);
    calendar.gotoDate(start);
    setTimeout(() => {
        const fcId = 'r:' + record.id + (record.rrule ? '~' + occKey : '');
        const fcEvent = calendar.getEventById(fcId);
        if (fcEvent) showPopover(fcEvent, fcEvent.el || document.body);
    }, 120);
}

function clearSearch() {
    $('searchInput').value = '';
    $('searchClear').classList.add('hidden');
    $('searchResults').classList.add('hidden');
}

// ================================================
// ICS import / export
// ================================================

/** ICAL.Time values (ical.js 2.x rejects raw datetime strings). */
function icsTimeFromIso(iso) {
    return ICAL.Time.fromJSDate(new Date(iso), true);
}

function icsTimeFromDateStr(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new ICAL.Time();
    t.isDate = true;
    t.year = y;
    t.month = m;
    t.day = d;
    return t;
}

function importIcsFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const jcal = ICAL.parse(reader.result);
            const comp = new ICAL.Component(jcal);
            const vevents = comp.getAllSubcomponents('vevent');
            if (!vevents.length) {
                showNotification('No events found in that file.', 'error');
                return;
            }

            const targetId = await ensureMainCalendar();
            if (!targetId) {
                showNotification('Could not reach your calendar. Try again.', 'error');
                return;
            }

            const imported = [];
            for (const vev of vevents.slice(0, 500)) {
                const record = icsVeventToRecord(vev, targetId);
                if (record) imported.push(record);
            }
            if (!imported.length) {
                showNotification('No importable events found.', 'error');
                return;
            }

            for (const record of imported) {
                const result = await calendarStorage.createEvent(record);
                if (result) setUserData(result);
            }
            refreshAll();
            showNotification('Imported ' + imported.length + ' event' +
                (imported.length === 1 ? '' : 's'), 'success');
        } catch (err) {
            console.error('[ICS] Import failed:', err);
            showNotification('That file could not be read as an .ics calendar.', 'error');
        }
    };
    reader.readAsText(file);
}

/** ICAL vevent -> our record shape (simple alarms become reminders). */
function icsVeventToRecord(vev, calId) {
    const event = new ICAL.Event(vev);
    if (!event.startDate) return null;

    const startT = event.startDate;
    const endT = event.endDate;
    const allDay = startT.isDate;

    let start, end;
    if (allDay) {
        start = fmtDateStr(startT.toJSDate());
        end = endT ? fmtDateStr(endT.toJSDate()) : start;
        if (end <= start) end = start;
    } else {
        start = icalTimeToIso(startT);
        end = endT ? icalTimeToIso(endT)
            : new Date(new Date(start).getTime() + 3600000).toISOString();
        if (new Date(end) <= new Date(start)) {
            end = new Date(new Date(start).getTime() + 1800000).toISOString();
        }
    }

    let rrule = null;
    const recurProp = vev.getFirstProperty('rrule');
    if (recurProp) {
        try {
            const recur = recurProp.getFirstValue();
            const r = String(recur);
            rrule = r.replace(/^RRULE:/i, '') || null;
        } catch (err) { /* keep non-recurring */ }
    }

    // EXDATEs -> exdate keys on the master (same instants as DTSTART series).
    let exdates = [];
    vev.getAllProperties('exdate').forEach(prop => {
        const values = prop.getValues();
        values.forEach(t => {
            if (!t) return;
            exdates.push(t.isDate ? fmtDateStr(t.toJSDate()) : icalTimeToIso(t));
        });
    });

    const reminders = [];
    vev.getAllSubcomponents('valarm').forEach(alarm => {
        const trigger = alarm.getFirstProperty('trigger');
        if (!trigger) return;
        try {
            const dur = ICAL.Duration.fromSeconds(trigger.getFirstValue().toSeconds());
            const mins = Math.round(Math.abs(dur.weeks * 7 * 1440 + dur.days * 1440 +
                dur.hours * 60 + dur.minutes + dur.seconds / 60));
            if (mins > 0 && mins <= 10080 && !reminders.includes(mins)) reminders.push(mins);
        } catch (err) { /* unusual trigger shapes are skipped */ }
    });
    reminders.sort((a, b) => a - b);

    const record = {
        id: genRecordId(),
        calId,
        title: event.summary || '(imported event)',
        description: event.description || '',
        location: event.location || '',
        allDay,
        start,
        end,
        rrule,
        exdates,
        reminders,
        links: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    if (rrule) {
        record.duration = allDay
            ? msToIsoDuration(Math.max(86400000, parseDateStr(end) - parseDateStr(start)))
            : msToIsoDuration(new Date(end) - new Date(start));
    }
    return record;
}

/** ICAL.Time (timed) -> UTC ISO, honoring floating local times. */
function icalTimeToIso(t) {
    if (t.zone !== ICAL.Timezone.localTimezone) {
        return t.toJSDate().toISOString();
    }
    const d = new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
    return d.toISOString();
}

/** Export every event as a single .ics download (settings menu). */
function exportIcs() {
    const records = (userData.events || []).filter(Boolean);
    const masters = records.filter(r => !r.parentEventId);
    const exceptions = records.filter(r => r.parentEventId);

    const vcalendar = new ICAL.Component(['vcalendar', [], []]);
    vcalendar.addPropertyWithValue('version', '2.0');
    vcalendar.addPropertyWithValue('prodid', '-//Workdeck//Calendar//EN');
    vcalendar.addPropertyWithValue('calscale', 'GREGORIAN');

    const now = new Date();

    /** VEVENT for one record; isException adds RECURRENCE-ID to its master. */
    function buildVevent(record, master) {
        const vevent = new ICAL.Component('vevent');
        vevent.addPropertyWithValue('uid',
            (master ? master.id : record.id) + '@workdeck');
        vevent.addPropertyWithValue('dtstamp', icsTimeFromIso(now.toISOString()));
        vevent.addPropertyWithValue('summary', record.title || '(no title)');
        if (record.description) vevent.addPropertyWithValue('description', record.description);
        if (record.location) vevent.addPropertyWithValue('location', record.location);

        const allDay = isDateStr(record.start);
        if (allDay) {
            // isDate Times make ICAL emit VALUE=DATE on its own.
            vevent.addPropertyWithValue('dtstart', icsTimeFromDateStr(record.start));
            vevent.addPropertyWithValue('dtend', icsTimeFromDateStr(record.end || record.start));
        } else {
            vevent.addPropertyWithValue('dtstart', icsTimeFromIso(record.start));
            vevent.addPropertyWithValue('dtend', icsTimeFromIso(record.end || record.start));
        }

        if (master) {
            vevent.addPropertyWithValue('recurrence-id',
                isDateStr(record.origStart) ? icsTimeFromDateStr(record.origStart) : icsTimeFromIso(record.origStart));
        } else {
            if (record.rrule) {
                try {
                    vevent.addPropertyWithValue('rrule',
                        ICAL.Recur.fromString(record.rrule.replace(/^RRULE:/i, '')));
                } catch (err) { /* skip unparsable rules */ }
            }
            (record.exdates || []).forEach(key => {
                vevent.addPropertyWithValue('exdate',
                    isDateStr(key) ? icsTimeFromDateStr(key) : icsTimeFromIso(key));
            });
            (record.reminders || []).forEach(minutes => {
                const alarm = new ICAL.Component('valarm');
                alarm.addPropertyWithValue('action', 'DISPLAY');
                alarm.addPropertyWithValue('description', record.title || 'Event reminder');
                const trigger = alarm.addPropertyWithValue('trigger', '-PT' + minutes + 'M');
                trigger.setParameter('related', 'START');
                vevent.addSubcomponent(alarm);
            });
        }
        return vevent;
    }

    masters.forEach(record => {
        vcalendar.addSubcomponent(buildVevent(record, null));
        exceptions.filter(exc => exc.parentEventId === record.id).forEach(exc => {
            vcalendar.addSubcomponent(buildVevent(exc, record));
        });
    });

    // Exception records whose master is gone still deserve export.
    exceptions.filter(exc => !masters.some(m => m.id === exc.parentEventId)).forEach(exc => {
        vcalendar.addSubcomponent(buildVevent(exc, null));
    });

    const text = vcalendar.toString();
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workdeck-calendar.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showNotification('Exported ' + records.length + ' event' +
        (records.length === 1 ? '' : 's'), 'success');
}

// ================================================
// Settings / key / delete account / shortcuts UI
// ================================================

function closeSettingsMenus() {
    $('settingsDropdown').classList.remove('active');
    $('themeSubmenu').classList.remove('active');
    document.querySelector('.theme-dropdown-container').classList.remove('active');
}

function updateNotifyLabel() {
    const on = typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        localStorage.getItem('calendar_notify') !== 'off';
    $('notifyText').textContent = 'Browser notifications: ' + (on ? 'On' : 'Off');
}

async function toggleNotifications() {
    if (typeof Notification === 'undefined') {
        showNotification('This browser does not support notifications.', 'error');
        return;
    }
    if (Notification.permission === 'denied') {
        showNotification('Notifications are blocked in your browser settings.', 'error');
        return;
    }
    if (Notification.permission === 'granted' &&
        localStorage.getItem('calendar_notify') !== 'off') {
        localStorage.setItem('calendar_notify', 'off');
        showNotification('Browser notifications turned off');
    } else {
        const perm = await Notification.requestPermission();
        localStorage.setItem('calendar_notify', perm === 'granted' ? 'on' : 'off');
        if (perm === 'granted') showNotification('Browser notifications turned on', 'success');
    }
    updateNotifyLabel();
}

async function viewKey() {
    const key = getCalendarUserKey();
    $('keyText').textContent = key || '-';
    $('keyCopyFeedback').classList.remove('visible');
    openModal($('keyModal'));
}

async function deleteAccount() {
    openModal($('deleteAccountModal'));
}

// ================================================
// Keyboard shortcuts
// ================================================

function switchView(type) {
    if (calendar.view.type !== type) calendar.changeView(type);
}

function handleShortcut(e) {
    if (e.key === 'Escape') {
        hidePopover();
        closeSettingsMenus();
        closeSidebarDrawer();
        if (anyModalOpen()) {
            document.querySelectorAll('.key-modal.active').forEach(m => {
                if (m.id !== 'deleteAccountModal') closeModal(m);
            });
        }
        return;
    }

    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || anyModalOpen()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
        case 'c': openEditorForNew(new Date(), null, false); break;
        case 'd': switchView('timeGridDay'); break;
        case 'w': switchView('timeGridWeek'); break;
        case 'm': switchView('dayGridMonth'); break;
        case 'a': switchView('listWeek'); break;
        case 't': calendar.today(); break;
        case 'p': calendar.prev(); break;
        case 'n': calendar.next(); break;
        case '/':
            e.preventDefault();
            $('searchInput').focus();
            break;
        case '?': openModal($('shortcutsModal')); break;
    }
}

// ================================================
// Init
// ================================================

function bindUi() {
    $('homeBtn').addEventListener('click', () => { window.location.href = '/'; });

    // Settings dropdown
    $('settingsBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        $('settingsDropdown').classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.top-nav-settings')) closeSettingsMenus();
    });
    $('themeToggleBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        $('themeSubmenu').classList.toggle('active');
        document.querySelector('.theme-dropdown-container').classList.toggle('active');
    });
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            calendarThemeManager.setTheme(btn.dataset.theme);
            closeSettingsMenus();
        });
    });
    $('shortcutsBtn').addEventListener('click', () => {
        closeSettingsMenus();
        openModal($('shortcutsModal'));
    });
    $('notifyToggleBtn').addEventListener('click', () => {
        closeSettingsMenus();
        toggleNotifications();
    });
    $('exportIcsBtn').addEventListener('click', () => {
        closeSettingsMenus();
        exportIcs();
    });
    $('viewKeyBtn').addEventListener('click', () => {
        closeSettingsMenus();
        viewKey();
    });
    $('deleteAccountBtn').addEventListener('click', () => {
        closeSettingsMenus();
        deleteAccount();
    });
    $('logoutBtn').addEventListener('click', () => calendarAuth.logout());

    // Key modal
    $('keyModalClose').addEventListener('click', () => closeModal($('keyModal')));
    $('keyModalCloseBtn').addEventListener('click', () => closeModal($('keyModal')));
    $('keyCopyBtn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(getCalendarUserKey());
            $('keyCopyFeedback').classList.add('visible');
            setTimeout(() => $('keyCopyFeedback').classList.remove('visible'), 1500);
        } catch (err) { /* clipboard may be unavailable */ }
    });

    // Delete account modal
    $('deleteAccountModalClose').addEventListener('click', () => closeModal($('deleteAccountModal')));
    $('cancelDeleteAccount').addEventListener('click', () => closeModal($('deleteAccountModal')));
    $('confirmDeleteAccount').addEventListener('click', async () => {
        await calendarAuth.deleteAccount();
    });

    // Search
    $('searchInput').addEventListener('input', () => {
        $('searchClear').classList.toggle('hidden', !$('searchInput').value);
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => runSearch($('searchInput').value), 220);
    });
    $('searchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const first = document.querySelector('#searchResults .search-row');
            if (first) first.click();
        }
    });
    $('searchClear').addEventListener('click', clearSearch);
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#navSearchWrap')) $('searchResults').classList.add('hidden');
    });

    // Sidebar
    $('newEventBtn').addEventListener('click', () => openEditorForNew(new Date(), null, false));
    $('icsImportBtn').addEventListener('click', () => $('icsFileInput').click());
    $('icsFileInput').addEventListener('change', () => {
        const file = $('icsFileInput').files[0];
        if (file) importIcsFile(file);
        $('icsFileInput').value = '';
    });

    // Event editor
    $('evModalClose').addEventListener('click', () => closeModal($('eventModal')));
    $('evCancelBtn').addEventListener('click', () => closeModal($('eventModal')));
    $('evForm').addEventListener('submit', (e) => {
        e.preventDefault();
        saveEditor();
    });
    $('evAllDay').addEventListener('change', syncAllDayFields);
    $('evRepeat').addEventListener('change', () => {
        const custom = $('evRepeat').value === 'custom';
        $('repeatBuilder').classList.toggle('hidden', !custom);
        if (custom) {
            const record = editing ? findRecord(editing.recordId) : null;
            const existing = record && record.rrule &&
                rrulePreset(record.rrule) === 'custom' ? record.rrule : '';
            populateBuilder(existing);
        }
    });
    $('rbFreq').addEventListener('change', syncBuilderFreq);
    $('evLinkFileBtn').addEventListener('click', openLinkPicker);
    $('evDeleteBtn').addEventListener('click', () => {
        if (!editing) return;
        closeModal($('eventModal'));
        requestDelete(editing.recordId, editing.occKey);
    });

    // Scope modal
    $('scopeModalClose').addEventListener('click', () => {
        pendingScope = null;
        closeModal($('scopeModal'));
    });
    $('scopeCancel').addEventListener('click', () => {
        pendingScope = null;
        closeModal($('scopeModal'));
    });
    $('scopeThis').addEventListener('click', () => applyScope('this'));
    $('scopeFollowing').addEventListener('click', () => applyScope('following'));
    $('scopeAll').addEventListener('click', () => applyScope('all'));

    // Link picker
    $('linkPickerClose').addEventListener('click', () => closeModal($('linkPickerModal')));
    $('lpSearch').addEventListener('input', () => renderLinkPickerResults($('lpSearch').value));

    // Shortcuts modal
    $('shortcutsModalClose').addEventListener('click', () => closeModal($('shortcutsModal')));

    // Generic confirm modal
    $('confirmModalClose').addEventListener('click', () => closeModal($('confirmModal')));
    $('cancelConfirm').addEventListener('click', () => closeModal($('confirmModal')));

    document.addEventListener('keydown', handleShortcut);
}

async function init() {
    if (!calendarAuth.getSession()) {
        goToWorkdeck();
        return;
    }

    calendarThemeManager.init();
    bindUi();
    renderBuilderDays();
    initTodoToggle();
    initSidebarDrawer();
    updateNotifyLabel();
    $('loadingOverlay').classList.remove('hidden');

    userData = await calendarStorage.loadUserData();
    $('loadingOverlay').classList.add('hidden');

    if (!userData) {
        showNotification('Cannot reach your account. Check your connection and try again.', 'error');
        return;
    }

    calendarThemeManager.applyFromServer(userData.settings && userData.settings.theme);

    await ensureMainCalendar();
    renderEvents();
    renderFooter();
    initCalendar();

    reminderTimer = setInterval(checkReminders, APP_CONFIG.reminders.tickMs);
    checkReminders();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}