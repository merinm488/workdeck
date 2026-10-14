/**
 * iCalendar bridge — ical.js 2.x ships ESM-only, so it is imported here and
 * published on window for the classic scripts (editor.js).
 */

import ICAL from 'https://cdn.jsdelivr.net/npm/ical.js@2.2.1/dist/ical.min.js';

window.ICAL = ICAL;
