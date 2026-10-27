/**
 * ================================================
 * WORKDECK - Development Server
 * ================================================
 *
 * One Express server that mirrors the production (Vercel) layout on a single
 * origin:
 *
 *   /              -> public/index.html   (Workdeck landing page)
 *   /js, /css      -> public assets
 *   /sheets/*      -> Sheets app (static)
 *   /forms/*       -> Forms app (static)
 *   /slides/*      -> Slides app (static)
 *   /draw/*        -> Draw app (static)
 *   /filebox/*     -> 301 to /files/*
 *   /files/*       -> Files app (static)
 *   /todo/*        -> Todo app (static)
 *   /docs/*        -> Docs build (static, vite base '/docs/')
 *   /api/workdeck  -> api/workdeck.js     (Workdeck API)
 *   /api/docs      -> api/docs.js         (Docs API, fetch-style handler)
 *   /api/users     -> api/users.js        (Sheets API)
 *   /api/forms     -> api/forms.js        (Forms API)
 *   /api/slides    -> api/slides.js       (Slides API)
 *   /api/draw      -> api/draw.js         (Draw API)
 *   /api/filebox   -> api/filebox.js      (Filebox bytes API)
 *   /api/todo      -> api/todo.js         (Todo API)
 *
 * Storage: local JSON files under db/users/ (NODE_ENV=development).
 * Run with:  npm run dev   (port 4000)
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// Load .env manually (keeps dependencies minimal)
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2] || '';
    }
  }
}

// Force development mode for local storage (the .env value must not override
// the intent of this server; it is 'development' by default anyway).
process.env.NODE_ENV = 'development';

const { default: workdeckHandler } = await import('../api/workdeck.js');
const docsModule = await import('../api/docs.js');
const { default: usersHandler } = await import('../api/users.js');
const { default: formsHandler } = await import('../api/forms.js');
const { default: slidesHandler } = await import('../api/slides.js');
const { default: drawHandler } = await import('../api/draw.js');
const { default: fileboxHandler } = await import('../api/filebox.js');
const { default: todoHandler } = await import('../api/todo.js');
const { default: calendarHandler } = await import('../api/calendar.js');
const { default: kanbanHandler } = await import('../api/kanban.js');

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ---------- fetch-style -> express adapter for api/docs.js ----------
function createMockRequest(req) {
  return {
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])),
    url: req.originalUrl,
    async json() {
      return req.body;
    }
  };
}

function createMockResponse(res) {
  const make = (payload) => ({
    json: (body) => {
      res.status(payload.status).json(body);
      return make(payload);
    }
  });
  return {
    json(body) {
      res.status(200).json(body);
    }
  };
}

// api/docs.js uses the Web Fetch API style (Request/Response). Adapting it:
async function adaptDocsHandler(req, res, method) {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const request = new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: hasBody ? JSON.stringify(req.body || {}) : undefined
  });

  const response = await docsModule[method](request);
  const text = await response.text();
  res.status(response.status);
  res.set('Content-Type', response.headers.get('content-type') || 'application/json');
  res.send(text);
}

// ---------- API routes ----------
app.get('/llm.txt', (req, res) => res.redirect(301, '/llms.txt'));
app.all('/api/workdeck', (req, res) => workdeckHandler(req, res));
app.all('/api/docs', (req, res) => adaptDocsHandler(req, res, req.method.toUpperCase()));
app.all('/api/users', (req, res) => usersHandler(req, res));
app.all('/api/forms', (req, res) => formsHandler(req, res));
app.all('/api/slides', (req, res) => slidesHandler(req, res));
app.all('/api/draw', (req, res) => drawHandler(req, res));
app.all('/api/filebox', (req, res) => fileboxHandler(req, res));
app.all('/api/todo', (req, res) => todoHandler(req, res));
app.all('/api/calendar', (req, res) => calendarHandler(req, res));
app.all('/api/kanban', (req, res) => kanbanHandler(req, res));

// ---------- Pretty file URLs ----------
// Underscore allowed: legacy client-created sheets have ids like mv7xyz_ab12cde
const WD_ID_RE = /^[a-z0-9_]{14,}$/;
const WD_PRETTY_PAGES = {
  docs: '/docs/index.html',
  sheets: '/sheets/editor.html',
  forms: '/forms/editor.html',
  slides: '/slides/editor.html',
  draw: '/draw/editor.html',
  todo: '/todo/index.html',
  calendar: '/calendar/index.html',
  kanban: '/kanban/index.html',
  files: '/files/index.html'
};
const WD_PRETTY_PARAMS = { docs: 'doc', todo: 'list', calendar: 'cal', kanban: 'board' };

Object.keys(WD_PRETTY_PAGES).forEach((prettyApp) => {
  app.get('/' + prettyApp + '/:id', (req, res, next) => {
    if (!WD_ID_RE.test(req.params.id)) return next();
    // Carry extra query params through (?edit=1 from create flows).
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    params.set(WD_PRETTY_PARAMS[prettyApp] || 'id', req.params.id);
    req.url = WD_PRETTY_PAGES[prettyApp] + '?' + params.toString();
    next();
  });
});

// Universal resolver /f/<id> -> public/f.html (looks up the owning app with
// the user's unified doc, then redirects to the canonical pretty URL).
app.get('/f/:id', (req, res, next) => {
  if (!WD_ID_RE.test(req.params.id)) return next();
  req.url = '/f.html?id=' + encodeURIComponent(req.params.id);
  next();
});

// Legacy /filebox URLs -> /files (301, path and query preserved)
app.use('/filebox', (req, res) => {
  res.redirect(301, '/files' + req.url);
});

// Legacy Sheets home path (the home now lives at /sheets/)
app.get('/sheets/home.html', (req, res) => {
  res.redirect(301, '/sheets/');
});

// ---------- Static apps ----------
// Workdeck landing page + assets
app.use(express.static(path.join(ROOT_DIR, 'public'), { index: 'index.html' }));

// Docs (vite build with base '/docs/')
app.use('/docs', express.static(path.join(ROOT_DIR, 'docs-src', 'dist'), { index: 'index.html' }));
app.get('/docs/*', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'docs-src', 'dist', 'index.html'));
});

// Sheets (plain static)
app.use('/sheets', express.static(path.join(ROOT_DIR, 'sheets'), { index: 'index.html' }));

// Forms (plain static)
app.use('/forms', express.static(path.join(ROOT_DIR, 'forms'), { index: 'index.html' }));

// Slides (plain static)
app.use('/slides', express.static(path.join(ROOT_DIR, 'slides'), { index: 'index.html' }));

// Draw (plain static)
app.use('/draw', express.static(path.join(ROOT_DIR, 'draw'), { index: 'index.html' }));

// Files (plain static)
app.use('/files', express.static(path.join(ROOT_DIR, 'files'), { index: 'index.html' }));

// Todo (plain static)
app.use('/todo', express.static(path.join(ROOT_DIR, 'todo'), { index: 'index.html' }));

// Calendar (plain static)
app.use('/calendar', express.static(path.join(ROOT_DIR, 'calendar'), { index: 'index.html' }));

// Kanban (plain static)
app.use('/kanban', express.static(path.join(ROOT_DIR, 'kanban'), { index: 'index.html' }));

// Root redirect to the Workdeck landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log('\n🚀 Workdeck Development Server');
  console.log(`📱 Workdeck:   http://localhost:${PORT}`);
  console.log(`📝 Docs:       http://localhost:${PORT}/docs/`);
  console.log(`📊 Sheets:     http://localhost:${PORT}/sheets/`);
  console.log(`📋 Forms:      http://localhost:${PORT}/forms/`);
  console.log(`🎬 Slides:     http://localhost:${PORT}/slides/`);
  console.log(`✏️  Draw:       http://localhost:${PORT}/draw/`);
  console.log(`🗂️  Files:      http://localhost:${PORT}/files/`);
  console.log(`✅ Todo:       http://localhost:${PORT}/todo/`);
  console.log(`📅 Calendar:   http://localhost:${PORT}/calendar/`);
  console.log(`🗂️  Kanban:     http://localhost:${PORT}/kanban/`);
  console.log(`🔌 APIs:       /api/workdeck, /api/docs, /api/users, /api/forms, /api/slides, /api/draw, /api/filebox, /api/todo, /api/calendar, /api/kanban`);
  console.log(`📁 Local DB:   ${path.join(ROOT_DIR, 'db')}`);
  console.log('\nPress Ctrl+C to stop\n');
});
