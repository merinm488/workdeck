/**
 * ================================================
 * CALENDAR - Unified User API
 * ================================================
 *
 * The unified user document gains two sections:
 *   calendars: [{ id, name, color, visible, tagId, createdAt, updatedAt }]
 *   events:    [{ id, calId, title, description, location, start, end,
 *                 allDay, rrule, duration, exdates, overrides, reminders,
 *                 links, createdAt, updatedAt }]
 * Recurrence lives entirely on the client (rrule.js): the API stores the
 * RRULE string plus exdates/overrides verbatim and never expands anything.
 * Saves are section-merged, so calendar writes never wipe other apps' data.
 */

import {
  generateHash,
  generateId,
  getUserDoc,
  saveOwnedSections,
  createUserDoc,
  deleteUserDoc,
  applyCorsHeaders
} from './_lib/store.js';

const DEFAULT_CALENDAR_NAME = 'Untitled Calendar';

/** Persist only the sections Calendar owns + settings changes. */
async function saveCalendarSections(hash, userData) {
  return saveOwnedSections(hash, {
    calendars: userData.calendars,
    events: userData.events,
    settings: userData.settings
  });
}

// ================================================
// Handler
// ================================================

export default async function handler(req, res) {
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // ============================================================
    // GET - user data (session check / initial load)
    // ============================================================
    if (req.method === 'GET') {
      const { hash } = req.query;

      if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash is required' });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      return res.status(200).json({ success: true, data: userData });
    }

    // ============================================================
    // POST - login / create account
    // ============================================================
    if (req.method === 'POST') {
      const { key, action } = req.body || {};

      if (!key || typeof key !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid key format' });
      }

      const normalizedKey = key.trim();
      if (normalizedKey === '') {
        return res.status(400).json({ success: false, error: 'Key cannot be empty' });
      }

      const hash = generateHash(normalizedKey);

      if (action === 'login') {
        const userData = await getUserDoc(hash);
        if (!userData) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        return res.status(200).json({ success: true, hash, data: userData });
      }

      if (action === 'create') {
        const result = await createUserDoc(hash, { theme: 'dark' });
        if (!result.ok) {
          if (result.code === 'USER_EXISTS') {
            return res.status(409).json({ success: false, error: 'User already exists' });
          }
          return res.status(500).json({ success: false, error: 'Failed to create account' });
        }
        return res.status(201).json({ success: true, hash, data: result.doc });
      }

      return res.status(400).json({ success: false, error: 'Invalid action. Use "login" or "create"' });
    }

    // ============================================================
    // PUT - owner operations on the unified document
    // ============================================================
    if (req.method === 'PUT') {
      const { hash, action, data } = req.body || {};

      if (!hash || !action) {
        return res.status(400).json({ success: false, error: 'Hash and action are required' });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // CREATE CALENDAR — a new empty calendar with a server-generated id.
      if (action === 'createCalendar') {
        let id = data?.id || generateId();
        while (userData.calendars.some(c => c && c.id === id)) {
          id = generateId();
        }

        const now = new Date().toISOString();
        const calendar = {
          id,
          name: (data?.name || '').trim() || DEFAULT_CALENDAR_NAME,
          color: data?.color || '#0284c7',
          visible: true,
          tagId: data?.tagId || null,
          createdAt: now,
          updatedAt: now
        };
        userData.calendars.unshift(calendar);

        const saved = await saveCalendarSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to create calendar' });
        }
        return res.status(200).json({ success: true, calendar, data: userData });
      }

      // UPDATE CALENDAR — name/color/visibility changes.
      if (action === 'updateCalendar') {
        const { calId, updates } = data || {};
        const target = userData.calendars.find(c => c && c.id === calId);
        if (!target) {
          return res.status(404).json({ success: false, error: 'Calendar not found' });
        }

        if (updates && typeof updates === 'object') {
          if (updates.name !== undefined) {
            target.name = String(updates.name).trim() || DEFAULT_CALENDAR_NAME;
          }
          if (updates.color !== undefined) target.color = updates.color;
          if (updates.visible !== undefined) target.visible = Boolean(updates.visible);
          if (updates.tagId !== undefined) target.tagId = updates.tagId;
        }
        target.updatedAt = new Date().toISOString();

        const saved = await saveCalendarSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update calendar' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // DELETE CALENDAR — the calendar and every event in it.
      if (action === 'deleteCalendar') {
        const { calId } = data || {};
        if (!calId) {
          return res.status(400).json({ success: false, error: 'calId is required' });
        }
        if (!userData.calendars.some(c => c && c.id === calId)) {
          return res.status(404).json({ success: false, error: 'Calendar not found' });
        }

        userData.calendars = userData.calendars.filter(c => c && c.id !== calId);
        userData.events = userData.events.filter(e => e && e.calId !== calId);
        if (userData.settings?.lastOpened) {
          delete userData.settings.lastOpened[calId];
        }

        const saved = await saveCalendarSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to delete calendar' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // CREATE EVENT — one event record, recurring shape included as-is.
      if (action === 'createEvent') {
        const input = data?.event;
        if (!input || typeof input !== 'object') {
          return res.status(400).json({ success: false, error: 'event is required' });
        }

        let id = input.id || generateId();
        while (userData.events.some(e => e && e.id === id)) {
          id = generateId();
        }

        const now = new Date().toISOString();
        const event = {
          ...input,
          id,
          createdAt: now,
          updatedAt: now
        };
        userData.events.unshift(event);

        const saved = await saveCalendarSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to create event' });
        }
        return res.status(200).json({ success: true, event, data: userData });
      }

      // UPDATE EVENT — upserts the whole record; the client composes
      // recurrence exceptions (exdates/overrides/splits) before calling.
      if (action === 'updateEvent') {
        const { eventId, event } = data || {};
        if (!eventId || !event || typeof event !== 'object') {
          return res.status(400).json({ success: false, error: 'eventId and event are required' });
        }

        const existingIndex = userData.events.findIndex(e => e && e.id === eventId);
        if (existingIndex >= 0) {
          userData.events[existingIndex] = {
            ...userData.events[existingIndex],
            ...event,
            id: eventId,
            calId: event.calId || userData.events[existingIndex].calId,
            updatedAt: new Date().toISOString()
          };
        } else {
          const now = new Date().toISOString();
          userData.events.unshift({
            ...event,
            id: eventId,
            createdAt: now,
            updatedAt: now
          });
        }

        const saved = await saveCalendarSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update event' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // DELETE EVENT — the whole series for recurring records (deleting a
      // single occurrence is updateEvent with a grown exdates list).
      if (action === 'deleteEvent') {
        const { eventId } = data || {};
        if (!eventId) {
          return res.status(400).json({ success: false, error: 'eventId is required' });
        }

        userData.events = userData.events.filter(e => e && e.id !== eventId);

        const saved = await saveCalendarSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to delete event' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      // UPDATE SETTINGS (theme, etc.)
      if (action === 'updateSettings') {
        if (!data?.settings || typeof data.settings !== 'object') {
          return res.status(400).json({ success: false, error: 'settings object is required' });
        }
        userData.settings = { ...userData.settings, ...data.settings };

        const saved = await saveCalendarSections(hash, userData);
        if (!saved) {
          return res.status(500).json({ success: false, error: 'Failed to update settings' });
        }
        return res.status(200).json({ success: true, data: userData });
      }

      return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    // ============================================================
    // DELETE - delete account (clears the unified document)
    // ============================================================
    if (req.method === 'DELETE') {
      const { hash } = req.query;

      if (!hash) {
        return res.status(400).json({ success: false, error: 'Hash is required' });
      }

      const userData = await getUserDoc(hash);
      if (!userData) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const deleted = await deleteUserDoc(hash);
      if (!deleted) {
        return res.status(500).json({ success: false, error: 'Failed to delete account' });
      }

      return res.status(200).json({ success: true, message: 'Account deleted' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[CALENDAR API] Error:', error);
    return res.status(500).json({ success: false, error: 'Server error', message: error.message });
  }
}