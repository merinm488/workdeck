// Synthetic, in-memory Holm member storage for browser regression tests.
// No production account, credentials or persisted fixture data is used.
import { handleWorkspace } from '../../holm/auth/workspace.js';
import { handleDocs } from '../../holm/docs/api.js';
import { handleSheets } from '../../holm/sheets/api.js';
import { handleForms } from '../../holm/forms/api.js';
import { handleSlides } from '../../holm/slides/api.js';
import { handleDraw } from '../../holm/draw/api.js';
import { handleTodo } from '../../holm/todo/api.js';
import { handleKanban } from '../../holm/kanban/api.js';
import { handleMinutes } from '../../holm/minutes/api.js';
import { handleBlog } from '../../holm/blog/api.js';
import { handleCalendar } from '../../holm/calendar/api.js';

export function newFileWorkspace() {
  const rows = new Map(), prefs = new Map();
  let sequence = 0;
  const col = name => {
    if (!rows.has(name)) rows.set(name, new Map());
    return rows.get(name);
  };
  const ds = {
    find(name, query = {}, options = {}) {
      const matches = [...col(name).values()].filter(row => Object.entries(query).every(([key, value]) => row[key] === value));
      return structuredClone((options.order === 'desc' ? matches.reverse() : matches).slice(0, options.limit || Infinity));
    },
    findOne: (name, where) => structuredClone(col(name).get(typeof where === 'string' ? where : where.id) || null),
    count: (name, query = {}) => ds.find(name, query).length,
    insert(name, fields) {
      const id = `new_file_${++sequence}`;
      col(name).set(id, structuredClone({ ...fields, id }));
      return id;
    },
    update: (name, where, patch) => col(name).set(where.id, structuredClone({ ...col(name).get(where.id), ...patch.$set })),
    delete: (name, where) => col(name).delete(where.id),
    transaction: fn => fn(ds),
  };
  const env = { holm: { auth: { getMember: () => ({ id: 'synthetic_member', name: 'New file test' }) },
    app: { member: { ds, kv: { get: key => structuredClone(prefs.get(key)), set: (key, value) => prefs.set(key, structuredClone(value)) } } } } };
  async function fetch(url, options = {}) {
    const target = new URL(url, 'https://workdeck.test');
    if (target.pathname === '/api/me') return Response.json({ member: env.holm.auth.getMember() });
    const handler = target.pathname.startsWith('/api/todo/') ? handleTodo : {
      '/api/workdeck': handleWorkspace, '/api/docs': handleDocs, '/api/users': handleSheets,
      '/api/forms': handleForms, '/api/slides': handleSlides, '/api/draw': handleDraw,
      '/api/kanban': handleKanban, '/api/minutes': handleMinutes, '/api/blog': handleBlog,
      '/api/calendar': handleCalendar,
    }[target.pathname];
    if (!handler) throw Error('Unexpected test API: ' + target.pathname);
    return handler(new Request(target, { ...options, headers: { Origin: target.origin, 'Content-Type': 'application/json', ...options.headers } }), env);
  }
  const create = async (action, data = {}) => (await fetch('/api/workdeck', {
    method: 'PUT', body: JSON.stringify({ action, data }),
  })).json();
  return { ds, fetch, create };
}
