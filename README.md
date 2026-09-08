# Workdeck

A unified, Google-Drive-style home for your necessary apps. One login, one landing page, all the applications.

Built with plain **HTML / CSS / JavaScript**

## ✨ Features

- 🔐 **One key for everything** — same authentication
  (SHA-256(key + pepper) server-side, auto account creation, TextDB/local-file
  storage). Logging in to Workdeck logs you in to all the applications.
- 🗂️ **Recent files** — all the files, sorted by last-opened
  (re-opening bumps a file to the top), with fallback to last-modified.
- ➕ **+ New dropdowns** — in the header and the empty state; create a blank
  file in any registered app (Docs, Sheets, …) and jump straight into its
  editor. Apps are defined in one `WD_APPS` registry in
  `public/js/workdeck.js`.
- 🎛️ **App filter** — an "All files" pill plus one app-chooser dropdown
  listing every registered app, so new apps don't crowd the screen.
- 🔍 **Unified search** — searches titles of all files plus the markdown
  content of docs.
- 🔳 **Grid / List view toggle** — persisted per account (server-side).
- 🌗 **Dark / Light / System theme** — persisted per account, consistent
  with both child apps.
- ⚙️ **Settings dropdown** — View My Key, Theme submenu, Logout, Delete
  Account (deletes the unified account).
- ✏️ **Rename & delete files** from the landing page (including shared
  copies cleanup).

## 🏗️ Architecture

```
workdeck/
├── public/                 # Workdeck landing page (vanilla)
│   ├── index.html
│   ├── workdeck.css
│   └── js/
│       ├── themes.js       # light/dark/system theme manager
│       ├── auth.js         # login + session (mirrors keys for docs, sheets & forms)
│       └── workdeck.js     # landing page application
├── api/
│   ├── _lib/store.js       # shared storage: local files (dev) / textdb (prod)
│   ├── workdeck.js         # Workdeck API: auth + unified file ops
│   ├── docs.js             # Docs API (same shape as the original)
│   ├── users.js            # Sheets API (same shape as the original)
│   └── forms.js            # Forms API (incl. public response submission)
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
  "settings": {
    "theme": "dark",
    "viewMode": "grid",
    "lastOpened": { "<fileId>": "<iso-date>" }
  }
}
```

All four APIs share `api/_lib/store.js` and save **section-merged**: Docs
only writes docs/tags, Sheets only writes sheets, Forms only writes
forms, Workdeck writes docs/tags/sheets/forms/settings etc — so no app
can wipe another's data.

### Authentication flow


1. `POST /api/workdeck { key, action: 'login' }`
2. `404 User not found` → `POST { key, action: 'create' }` (auto-create)
3. Session keys stored in `sessionStorage` for all the apps at once:


## 🛠️ Rebuilding Docs

After changing anything in `docs-src/`:

```bash
npm run build:docs
```

### One key = one account

The hash is `sha256(key.trim() + PEPPER_SECRET)` and the hash *is* the
document id. One account, one document, consistent recents everywhere.

## 🔗 Deep links

- `/docs/?doc=<id>` — opens a specific doc (Workdeck uses this for
  recent-docs clicks and New Doc).
- `/sheets/editor.html?id=<id>` — opens a specific sheet.
- `/forms/editor.html?id=<id>` — opens a specific form in the builder.
- `/sheets/shared.html?shared=<id>`, `/docs/?shared=<id>` — public share views.
- `/forms/shared.html?shared=<id>` — public fill-out view for a shared form
  (recipients can answer; responses are stored with the shared form).

## 📄 License

MIT
