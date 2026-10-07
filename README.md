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
- 🗃️ **Files** — upload files (up to 300 KB each) and organize them in
  nested folders of unlimited depth; folder-aware dashboard, drag-to-move,
  search, list/grid views, and a PWA. Files and folders are taggable from
  the landing page's Tags sidebar or inside Files.
- 📱 **Mobile-friendly** — touch devices open files in the same tab.

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
│   └── filebox.js          # Files API (file bytes: upload + download)
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
├── filebox/                # Files app (vanilla file manager)
│   ├── index.html          # manager UI (?folder=, ?id=, ?upload=1 URL states)
│   ├── styles.css          # self-contained, teal accents
│   ├── manifest.json       # PWA (scoped to /filebox/, "Upload files" shortcut)
│   ├── service-worker.js   # filebox-v1, /api/ always bypasses
│   ├── icons/              # teal icon set (192/512, any+maskable)
│   ├── config/config.js
│   └── js/                 # auth/storage/themes/main/pwa
├── server/dev-server.js    # one Express server mirroring the prod layout
├── vercel.json             # routing for production
├── .env                    # PEPPER_SECRET for local dev
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
  "files": [ ... ],      // Files app file metadata (bytes live in separate records)
  "folders": [ ... ],    // Files app folders (nested via parentId)
  "settings": {
    "theme": "dark",
    "viewMode": "grid",
    "lastOpened": { "<fileId>": "<iso-date>" }
  }
}
```

All the APIs share `api/_lib/store.js` and save **section-merged**: Docs
only writes docs/tags, Sheets only writes sheets, Forms only writes
forms, Slides only writes slides, Draw only writes draws, Workdeck writes
docs/tags/sheets/forms/slides/draws/settings etc — so no app can wipe another's
data.

### Hard links & mentions (interlinking)

Every file is addressable by a clean URL, and files can reference each
other file.

**Mentions.** Type `@` in Docs (or use the `@ Link` / "Link file" /
"Insert reference" toolbar buttons anywhere) to open a fuzzy picker of
every file across every app. 

## 🗃️ Files

A Drive-style file manager at `/filebox/` — upload via picker or full-window
drag-drop, organize in nested folders of unlimited depth, browse as cards.

- **300 KB cap per file** — gated client-side with a toast before reading,
  enforced server-side with `413 FILE_TOO_LARGE`.
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
