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
  with all child apps.
- ⚙️ **Settings dropdown** — View My Key, Theme submenu, Logout, Delete
  Account (deletes the unified account).
- ✏️ **Rename & delete files** from the landing page (including shared
  copies cleanup).
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
├── slides/                 # Slides app (vanilla + Fabric.js canvas editor)
│   ├── editor.html         # deck editor (owner, needs Workdeck session)
│   ├── shared.html         # public read-only deck viewer (?shared=<id>)
│   ├── styles.css
│   ├── config/config.js
│   ├── templates/          # starter decks (JSON, fabric v6 objects) + index.json
│   └── js/                 # skeleton modules: auth/storage/themes/editor/shared
│                           #   (config.js is complete — it is the contract)
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
  "settings": {
    "theme": "dark",
    "viewMode": "grid",
    "lastOpened": { "<fileId>": "<iso-date>" }
  }
}
```

All four APIs share `api/_lib/store.js` and save **section-merged**: Docs
only writes docs/tags, Sheets only writes sheets, Forms only writes
forms, Slides only writes slides, Workdeck writes
docs/tags/sheets/forms/slides/settings etc — so no app can wipe another's
data.

## 📄 License

MIT
