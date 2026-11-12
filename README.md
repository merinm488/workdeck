# Workdeck

A unified, Google-Drive-style home for your necessary apps. One login, one landing page, all the applications.


## ✨ Features

- 🔐 **One key for everything** — same authentication server-side, auto account creation, TextDB/local-file
  storage. Logging in to Workdeck logs you in to all the applications.
- 🗂️ **Recent files** — all the files, sorted by last-opened
  (re-opening bumps a file to the top), with fallback to last-modified.
- ➕ **+ New dropdowns** — in the header and the empty state; create a blank
  file in any registered app (Docs, Sheets, …) and jump straight into its
  editor.
- 🎛️ **App filter** — an "All files" pill plus one app-chooser dropdown
  listing every registered app, so new apps don't crowd the screen.
- 🔍 **Unified search** — searches titles of all files.
- 🔳 **Grid / List view toggle** — persisted per account (server-side).
- 🌗 **Dark / Light / System theme** — persisted per account, consistent
  with all child apps 
- ⚙️ **Settings dropdown** — View My Key, Theme submenu, Logout, Delete
  Account (deletes the unified account).
- ✏️ **Rename & delete files** from the landing page (including shared
  copies cleanup).
- 🗃️ **Files** — upload files (300 KB each by default, env-tunable via
  `FILES_MAX_FILE_SIZE`) and organize them in
  nested folders of unlimited depth; folder-aware dashboard, drag-to-move,
  search, list/grid views, and a PWA. Files and folders are taggable from
  the landing page's Tags sidebar or inside Files.
- ✅ **Todo** — task lists: create lists, add tasks with due
  dates and priorities, toggle/complete, edit in place, drag-to-reorder;
  search across lists and tasks, card/row list layouts.
- 📅 **Calendar** — multiple colored calendars with show/hide, Month /
  Week / Day / Agenda views (FullCalendar), drag-create/move/resize,
  all-day & multi-day events, RRULE recurrence with per-occurrence
  exceptions ("this / this and following / all"), reminders (in-app toast
  + browser notifications), search, keyboard shortcuts,
  Todo tasks rendered on the grid, file links via the suite's WDLinks,
  and .ics import/export (rrule.js + ical.js).
- 🗂️ **Kanban** — boards with columns and swimlanes (DHTMLX Kanban,
  GPL edition via CDN): drag-and-drop cards between columns, inline/modal
  card editor (title, description, priority, due date, color), checklists
  with a mirrored progress bar, comments, undo/redo, search/sort toolbar,
  column WIP limits, multi-select, and the suite's light/dark theme
  bridged onto the widget via its CSS variables.
- ✍️ **Blog** — a publishable blog: write posts in a rich-text editor
  (Quill), keep them as drafts or publish them one by one. Each post
  publishes at a public link you pick in the publish modal (/<slug>,
  unique across all accounts). Only published posts go out — drafts stay
  private — and the public pages are served GET-only through the same
  slug-pointer scheme the suite uses everywhere (the account key/hash
  never leaves the server).
- 📱 **Mobile-friendly** — touch devices open files in the same tab.

## AI connector (MCP, Workdeck apps)

Workdeck provides a **remote Streamable HTTP MCP** endpoint at `/api/mcp`.
It offers the Todo task tools plus `workspace_list`, `workspace_read`,
`workspace_create` and `workspace_update` across Workdeck collections. Content
operations also support Kanban columns/cards, form questions, slides, Draw
objects, Sheets cells, Files folders, and base64 file upload/read (100 KB MCP
limit). To fill a spreadsheet, call `sheet_create`, then `sheet_write_cells`
(zero-based row/column; `sheet_read_cells` inspects existing data). To populate
Kanban, create a board with `kanban_create_board`, then use `kanban_add_column`
and `kanban_upsert_card`. For Forms, use `form_create` and `form_upsert_question`.
Use `slides_create_deck` for slides. New decks already have a blank first
slide: find its ID with `workspace_read`, then use `slides_add_text` (or
`slides_add_slide` for more slides). Use `draw_create` and `draw_add_text` for
Draw. Use `file_upload` for Files, not `workspace_create`. Generic
`workspace_update` only edits names and plain-text content, not structured app
content. After a deployment, refresh/reconnect the client if it cached an old
tool list. The remote connector cannot open a local device path such as
`/Users/.../file.pdf`: the client must provide the bytes to `file_upload`, or
the user must upload larger files in the Workdeck Files UI. Publishing,
deletion and account settings are not exposed. It never provides account keys
or the whole account document to the model.

To enable it on Vercel, configure all three environment variables before
redeploying:

- `PEPPER_SECRET` — the **existing** account pepper, unchanged. Changing it
  without migrating existing accounts makes them inaccessible; do not replace
  it merely to enable MCP. MCP fails closed if it is unset in production or
  uses the publicly documented development default.
- `MCP_AUTH_SECRET` — generate once with `openssl rand -hex 32`; keep it private
  and stable. Replacing it invalidates all MCP connections and OAuth client
  registrations. Do not reuse the pepper.
- `MCP_PUBLIC_ORIGIN` — exact HTTPS origin, e.g.
  `https://workdeck-m.vercel.app` (no path or trailing slash). Set a different
  origin in each preview deployment that should accept MCP connections.

TextDB remains the sole persistent backend. OAuth codes and scoped grants use
per-record TextDB documents through `api/_lib/mcp-grants.js`; app records still uses `api/_lib/store.js`. No Vercel instance memory holds
connection state. These modules separate storage from MCP/OAuth logic so the
backend can be changed later.

On Workdeck, open **Settings → Connect AI**, choose your MCP client, and follow
its instructions using the displayed MCP URL. Claude.ai uses a custom
connector (choose **Register automatically** for OAuth if prompted). For
Codex or Pi, add the URL as a remote MCP server and sign in via OAuth. ChatGPT
custom apps/connectors require a plan with remote MCP support; its settings
and availability vary. Other remote-MCP clients need Streamable HTTP and OAuth
with dynamic client registration. Workdeck asks for the key of an
*existing* account on its own consent page; it never forwards the key to the
client or creates an account. Approving connects the supported Workdeck apps.
Workdeck settings shows the active connection and lets the owner revoke it.
One connection per account is supported for this pilot: reconnecting replaces
the previous grant. Existing Todo-only grants remain Todo-only until the owner
reconnects and approves the expanded access. A key change or account deletion invalidates the token;
reconnect after changing keys.

**Pilot limitations:** access expires after 30 days, after which the owner
must reconnect. Refresh tokens are intentionally not issued. TextDB has no
compare-and-swap through the current storage API: under concurrent redemption
an OAuth code may be exchanged more than once, but both attempts require the
same PKCE verifier and resolve to the same revocable grant. This is not a
claim of strict single-use OAuth-code semantics. Browser and agent writes to
the same collection can also race; do not make concurrent edits during this
pilot. Client compatibility varies by version and plan; test your chosen client
and deployment end-to-end before treating production compatibility as verified.

Run the isolated local integration tests with `node --test test/*.test.mjs`.
To try the browser locally, run `npm install`, put a generated
`MCP_AUTH_SECRET` in your local `.env`, and start `npm run dev`. Use a **new,
throwaway local Workdeck account** at `http://localhost:4000` rather than your
production account. Hosted AI clients cannot access localhost directly: to test
one without deploying, expose port 4000 through a trusted HTTPS tunnel, set
`MCP_PUBLIC_ORIGIN=https://<your-tunnel-host>` in `.env`, and restart the dev
server. Only share the MCP URL with your client, not your account key. The
tunnel also exposes the rest of your local Workdeck server; close it after
testing. Without a tunnel you can still run the automated local MCP/OAuth
integration tests. Your chosen client and the Vercel deployment need staging
or production testing for confirmation.

## 🏗️ Architecture

```
workdeck/
├── public/                 # Workdeck landing page (vanilla)
│   ├── index.html
│   ├── workdeck.css
│   └── js/
│       ├── themes.js       # light/dark/system theme manager
│       ├── auth.js         # login + session (mirrors keys for docs, sheets,
│       │                   #   forms & slides; localStorage seed for Slides)
│       └── workdeck.js     # landing page application
├── api/
│   ├── _lib/store.js       # shared storage: local files (dev) / textdb (prod)
│   ├── workdeck.js         # Workdeck API: auth + unified file ops
│   ├── docs.js             # Docs API (same shape as the original)
│   ├── users.js            # Sheets API (same shape as the original)
│   ├── forms.js            # Forms API (incl. public response submission)
│   ├── slides.js           # Slides API (deck records + public share snapshots)
│   ├── draw.js             # Draw API (drawing records + public share snapshots)
│   ├── filebox.js          # Files API (file bytes: upload + download)
│   ├── todo.js             # Todo API (task list records)
│   ├── calendar.js         # Calendar API (calendars + event records)
│   ├── kanban.js           # Kanban API (board records)
│   ├── blog.js             # Blog API (post records + publish/unpublish)
│   └── site.js             # Public blog API (GET-only, slug -> account)
├── docs/                   # Docs build output (from docs-src, base /docs/)
├── docs-src/               # Docs source (React+Vite, with:
│                           #   base '/docs/', ?doc= deep link, shared sessions)
├── sheets/                 # Sheets app (vanilla), paths adjusted to /sheets/
├── forms/                  # Forms app (vanilla + Form.io builder)
│   ├── editor.html         # builder (owner, needs Workdeck session)
│   ├── shared.html         # public fill-out view (?shared=<id>)
│   ├── styles.css
│   ├── config/config.js
│   └── js/                 # auth.js (complete) + storage/themes/editor/shared skeletons
├── slides/                 # Slides app (vanilla + Fabric.js canvas editor)
│   ├── editor.html         # deck editor (owner, needs Workdeck session)
│   ├── shared.html         # public read-only deck viewer (?shared=<id>)
│   ├── styles.css
│   ├── config/config.js
│   ├── templates/          # starter decks (JSON, fabric v6 objects) + index.json
│   └── js/                 # auth/storage/themes/editor/shared
├── draw/                   # Draw app (vanilla + Fabric.js v7 infinite canvas)
│   ├── editor.html         # drawing editor (owner, needs Workdeck session)
│   ├── shared.html         # public read-only drawing viewer (?shared=<id>)
│   ├── styles.css
│   ├── config/config.js
│   └── js/                 # auth/storage/themes/editor/shared.
├── files/                  # Files app (vanilla file manager)
│   ├── index.html          # manager UI (?folder=, ?id=, ?upload=1 URL states)
│   ├── styles.css          # self-contained, teal accents
│   ├── manifest.json       # PWA (scoped to /files/, "Upload files" shortcut)
│   ├── service-worker.js   # filebox-v4, /api/ always bypasses
│   ├── icons/              # teal icon set (192/512, any+maskable)
│   ├── config/config.js
│   └── js/                 # auth/storage/themes/main/pwa
├── todo/                   # Todo app (vanilla task lists)
│   ├── index.html          # lists view + task list view (/todo/<id>, ?list=<id>)
│   ├── styles.css          # self-contained, green accents
│   ├── config/config.js
│   └── js/                 # auth/storage/themes/editor
├── calendar/               # Calendar app (vanilla + FullCalendar v6)
│   ├── index.html          # grid + sidebar (/calendar/<id>, ?cal=<id>)
│   ├── styles.css          # self-contained, sky accents
│   ├── config/config.js
│   └── js/                 # auth/storage/themes/editor (+ rrule.js, ical.js via CDN)
├── kanban/                 # Kanban app (vanilla + SortableJS board surface)
│   ├── index.html          # boards home + board view (/kanban/<id>, ?board=<id>)
│   ├── styles.css          # self-contained, fuchsia accents
│   ├── config/config.js
│   └── js/                 # auth/storage/themes/app/board
├── blog/                   # Blog app (vanilla + Quill rich-text editor)
│   ├── index.html          # posts home + post editor (/blog/<id>, ?post=<id>)
│   ├── styles.css          # self-contained, teal accents
│   ├── config/config.js
│   └── js/                 # auth/storage/themes/app/editor
├── server/dev-server.js    # one Express server mirroring the prod layout
├── vercel.json             # routing for production
├── .env                    # PEPPER_SECRET, FILES_MAX_FILE_SIZE for local dev
└── package.json
```

### Unified data model

One document per user (local `db/users/{hash}.json` in dev, one textdb.dev
document per hash in production):

```json
{
  "docs": [ ... ],
  "tags": [ ... ],
  "sheets": [ ... ],
  "forms": [ ... ],
  "slides": [ ... ],
  "draws": [ ... ],
  "files": [ ... ],
  "folders": [ ... ],
  "todo": [ ... ],
  "calendars": [ ... ],
  "events": [ ... ],
  "kanban": [ ... ],
  "posts": [ { "id": "...", "title": "...", "slug": "...", "path": null, "html": "...",
               "excerpt": "...", "publishedAt": null } ],
  "settings": {
    "theme": "dark",
    "viewMode": "grid",
    "lastOpened": { "<fileId>": "<iso-date>" },
    "blog": { "title": "Blog", "description": "",
              "address": { "slug": "my-blog", "publishedAt": "<iso-date>" } | null }
  }
}
```

All the APIs share `api/_lib/store.js` and save **section-merged**: Docs
only writes docs/tags, Sheets only writes sheets, Forms only writes
forms, Slides only writes slides, Draw only writes draws, Todo only
writes todo, Calendar only writes calendars/events, Blog only writes
posts/settings, Workdeck writes
docs/tags/sheets/forms/slides/draws/posts/settings etc — so no app can wipe another's
data.

### Hard links & mentions (interlinking)

Every file is addressable by a clean URL, and files can reference each
other file.

**Mentions.** Type `@` in Docs (or use the `@ Link` / "Link file" /
"Insert reference" toolbar buttons anywhere) to open a fuzzy picker of
every file across every app. 

## 🗃️ Files

A Drive-style file manager at `/files/` — upload via picker or full-window
drag-drop, organize in nested folders of unlimited depth, browse as cards.

- **300 KB default cap per file** — gated client-side with a toast before
  reading, enforced server-side with `413 FILE_TOO_LARGE`. Configurable via
  the `FILES_MAX_FILE_SIZE` env var (`"300KB"`, `"10MB"`, or plain bytes) for
  when the storage backend outgrows textdb.dev's 1 MB docs; the server
  reports its cap to the client via `GET /api/filebox?limits=1`. On Vercel,
  request bodies cap near 4.5 MB, which bounds how far this can go.
- **Per-file content records** — bytes are base64 in separate
  `file_<id>` records (raw-key siblings of the shared-doc helpers in
  `api/_lib/store.js`), never inside the ~1 MB user doc. Upload writes the
  bytes first and bails without metadata on failure (orphan guard); file
  and account deletion remove them again.
- **Folders vs tags** — folders live only in Files (`parentId` nesting,
  8-color palette); tags are the suite-wide `tags` array. Files AND folders
  are multi-tag (`tags: [tagId, ...]`), unlike the single `tagId` on
  docs/sheets/forms/slides/draws.
- **Destructive folder delete** — deleting a folder permanently removes
  every descendant folder and contained file (content records included),
  behind a count-confirm.
- **Tag delete is mixed**: docs/sheets/forms/slides/draws carrying the tag
  are deleted (existing behavior), while files/folders in Files only lose
  the tag id — the confirm copy states this explicitly.
- **Homepage integration** — Files files appear as file cards, top-level
  folders as Finder-style folder cards (click → opens Files inside that
  folder); both open/recency-sort via `settings.lastOpened`. Nested depth
  is navigated inside Files only.
- **No file thumbnails** — file cards show extension tiles; folder cards
  show a Finder-style folder graphic tinted with the folder color.
- **PWA** — installable standalone app (teal), `?upload=1` shortcut,
  30 s poll + visibilitychange sync while visible.

## 📄 License

MIT
