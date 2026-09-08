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
 *   /docs/*        -> Docs build (static, vite base '/docs/')
 *   /api/workdeck  -> api/workdeck.js     (Workdeck API)
 *   /api/docs      -> api/docs.js         (Docs API, fetch-style handler)
 *   /api/users     -> api/users.js        (Sheets API)
 *   /api/forms     -> api/forms.js        (Forms API)
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

const app = express();
const PORT = 4000;

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

// api/docs.js uses the Web Fetch API style (Request/Response). Adapt it:
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
app.all('/api/workdeck', (req, res) => workdeckHandler(req, res));
app.all('/api/docs', (req, res) => adaptDocsHandler(req, res, req.method.toUpperCase()));
app.all('/api/users', (req, res) => usersHandler(req, res));
app.all('/api/forms', (req, res) => formsHandler(req, res));

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
  console.log(`🔌 APIs:       /api/workdeck, /api/docs, /api/users, /api/forms`);
  console.log(`📁 Local DB:   ${path.join(ROOT_DIR, 'db')}`);
  console.log('\nPress Ctrl+C to stop\n');
});
