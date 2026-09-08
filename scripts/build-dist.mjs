/**
 * Assemble the unified deployment output for Vercel.
 *
 * Mirrors the layout server/dev-server.js serves locally, so production and
 * development see the same paths:
 *
 *   dist/            <- public/            (Workdeck landing page at /)
 *   dist/sheets/     <- sheets/            (Sheets app at /sheets/)
 *   dist/forms/      <- forms/             (Forms app at /forms/)
 *   dist/docs/       <- docs-src/dist/     (Docs vite build, base '/docs/')
 *
 * The api/ directory is NOT copied — Vercel picks it up from the repo root
 * on its own and builds it as serverless functions.
 */

import { cpSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });
cpSync(path.join(ROOT, 'sheets'), path.join(DIST, 'sheets'), { recursive: true });
cpSync(path.join(ROOT, 'forms'), path.join(DIST, 'forms'), { recursive: true });
cpSync(path.join(ROOT, 'docs-src', 'dist'), path.join(DIST, 'docs'), { recursive: true });

console.log('[build-dist] Assembled dist/ (public -> /, sheets -> /sheets/, forms -> /forms/, docs -> /docs/)');
