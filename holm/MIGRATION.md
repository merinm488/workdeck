# Holm migration (in progress)

The legacy Vercel/TextDB source and uncommitted work are retained. Holm starts
with empty accounts: do **not** copy account hashes, keys, TextDB records or
legacy `/api/*` handlers into the Holm build. `node scripts/build-holm-landing.mjs
/tmp/workdeck-holm-landing` builds the current Holm v1 package; use
`holm app validate --spec-v1 /tmp/workdeck-holm-landing` for static validation.
This is **not** a finished migration or a production deployment.

## Stage 1 — deployed on Holm; signed-in browser checks still pending

- `/` stays a public introduction for visitors, redirects signed-in members to
  `/home`; `/apps` stays public. `/home` serves the original Workdeck home markup,
  CSS, card/list templates, theme/search/filter and tag controls (currently Todo
  only). Unsupported apps are not advertised in its create menu.
- `/api/me` and `/api/workdeck` use Holm's verified member cookie. Suite tags
  (`workspace_tags`) and Todo (`todo_lists`) are in member-private DS; suite
  theme, view and last-opened preferences are in member-private KV. Todo reads
  and writes the same suite theme. No user-supplied account ID or hash is used.
- Tag deletion retains the legacy *destructive* semantics for Todo lists;
  later app collections must join the delete transaction before they become
  taggable. Files and folders will instead lose the deleted tag without being
  deleted. Member-private records are never returned to a signed-out visitor.
- Holm Todo remains the original frontend with its existing storage adapter.
  `/todo/<id>` and the dashboard's Todo cards use the same private DS records.

## Stage 2 — Kanban (deployed on Holm; signed-in browser checks pending)

- Original Kanban HTML, CSS, SortableJS editor, checklists, comments, lanes,
  Todo staging, search and previews are retained. Removed legacy access-key
  and delete-account controls; Holm account management is at `/account`.
- `/api/kanban` scopes all board reads/writes to the current Holm member's
  `kanban_boards` DS and validates ownership of newly linked Todo tasks.
  Board saves use record versions so stale tabs cannot silently overwrite edits.
- The dashboard registers Kanban creation, cards, private tags and recency.
  Holm Todo and Kanban share member-private Todo staging and theme settings.
  Public landing cards now link to migrated Kanban. No public board share links
  existed in the original app; copy-link URLs remain owner-private. Holm's
  static router redirects `/kanban/<id>` and `/todo/<id>` to their app roots,
  so the Holm link adapter uses `/kanban/?board=<id>` and `/todo/?list=<id>`
  for reload-safe private cross-app links.

## Stage 3 — Minutes (deployed on Holm; signed-in browser checks pending)

- The original in-progress single-page notebook, Quill editor, review/print
  views and styling are retained. Its request adapter uses Holm's member cookie
  instead of legacy account hashes, with `/minutes/?meeting=<id>` links.
- Meeting revisions and linked Todo task changes share a member-DS transaction;
  a forged task/calendar link cannot target another member's records. Todo
  completion is preserved. Deleting a meeting leaves linked tasks in Todo,
  matching the unfinished original app. Signed-in dashboard cards, tag deletion,
  theme and recency use the suite-wide Holm member scope. Calendar links remain
  empty until Calendar itself migrates.

## Stage 4 — Calendar (deployed on Holm; signed-in browser checks pending)

- Original FullCalendar grid, RRULE/exception edits, reminders, Todo overlay,
  file-link picker, snapshot preview, and ICS import/export assets are retained.
  Its auth/storage adapter now uses the Holm member cookie and member-private
  `user_calendars` / `calendar_events` DS records; event/calendar writes require
  record versions and reject references to another member's data.
- Minutes reads those events in its meeting event picker. Suite tags, theme,
  preview, dashboard Calendar card and recency all use the existing Holm
  workspace. Browser notification permission and device-local reminder state
  remain browser-managed, as in the original app.

## Stage 5 — Docs (deployed on Holm; signed-in browser and public-share checks pending)

- The existing React document editor, Markdown previews, backlinks, search,
  pins, archive, and card/list UI are compiled unchanged from a temporary
  `docs-src` copy with Holm-only auth/storage adapters. Legacy source/build
  and other uncommitted work are untouched. The old key form/settings are
  replaced with native Holm sign-in and account links.
- Private docs live in member DS with serialized autosaves and revision
  checks; tags/theme use the suite-wide Holm member scope. Public share links
  require a cryptographically random token and expose only a whitelist snapshot
  in separate app-wide DS. Updates refresh that snapshot, and document/tag
  deletion revokes it. Shared views are read-only and work without sign-in.
- Holm uses `/docs/?doc=<id>` for reload-safe private links, and
  `/docs/?shared=<token>` for intentionally public views. Calendar's file-link
  picker can now reference Docs; mentions/backlinks use the same Holm
  workspace index as other migrated apps.

## Stage 6 — Sheets (deployed on Holm; signed-in browser and share checks pending)

- Original Sheets home/editor/shared HTML/CSS and Univer editor are retained.
  Holm member-DS keeps metadata, full workbook snapshots and thumbnails in
  separate records; the UI's auth/storage adapters use the Holm cookie, not
  access keys. Record versions serialize autosaves and reject stale tabs.
- Explicit public view-only sheet snapshots use unpredictable tokens in the
  separate app-wide DS. Owner edits update that copy; deletion and tag deletion
  revoke it, remove the workbook and thumbnail, and clear recency. Calendar's
  link picker and the dashboard can reference member-owned Sheets. The
  desktop/mobile home, CSV/XLSX import/export, and Sheets PWA are preserved.
- Holm's CSP does not allow the original SheetJS CDN. The identical 0.20.3
  script is served as `/sheets/js/vendor-xlsx.js` under its Apache 2.0 license
  (`holm/sheets/SHEETJS-LICENSE.txt`). The Sheets service worker is scoped to
  Sheets' own caches; it no longer clears other Workdeck apps' caches.
- Forms' response-to-Sheets integration will be wired when Forms migrates.

## Stage 7 — Forms (deployed on Holm; signed-in browser and live public-submission checks pending)

- The original form-js builder/viewer, Questions and Responses tabs,
  Chart.js summary, Tabulator/CSV grid, and styling remain intact. Owner auth,
  form persistence and suite theme use Holm's member cookie and private DS.
- Form questions are snapshotted into an explicit app-wide public share with
  a random 256-bit token. Anonymous visitors can submit JSON responses from
  the shared viewer. Public GET responses exclude answers; only the signed-in
  owner can read/delete responses. Same-origin and size/rate limits protect
  anonymous submissions. Editing a form refreshes its public questions.
- Linking to Sheets creates a member-private Univer workbook, backfills
  earlier responses and syncs new answers on owner response refresh. Question
  columns are append-only; manual spreadsheet rows remain untouched. Unlinking
  or deleting a form leaves the response spreadsheet in place, as before.
  Tags, dashboard operations, owner-only Calendar links and share revocation
  use the shared Holm workspace.

## Stage 8 — Slides (deployed on Holm; signed-in browser and live public-share checks pending)

- The original Fabric v6 editor, slide sorter, presentation mode, templates,
  image placement, export buttons, public viewer and CSS are retained.
  Authentication and full-deck autosaves use Holm's member cookie and
  member-private `slide_decks` records with version checks. A failed save
  prevents sign-out rather than silently dropping pending edits.
- An explicitly shared deck has a random-token, read-only app-wide snapshot.
  Changes refresh the public viewer; deck/tag deletion revokes it. Dashboard
  cards, tags, theme, recency, Calendar links and mentions use the Holm
  workspace. Holm editor links use `/slides/editor.html?id=<id>` to survive
  Holm's clean URL canonicalization.

## Stage 9 — Draw (deployed on Holm; signed-in browser and live public-share checks pending)

- Original Fabric v7 infinite canvas, tools, touch gestures, export controls,
  zoom/pan viewport, file mentions, read-only shared viewer and CSS remain.
  The authentication/storage adapter now uses Holm's member cookie and
  member-private `canvas_drawings` with version-checked saves. Leaving the
  editor waits for dirty changes to save instead of racing logout/navigation.
- An explicit public share stores a separate random-token snapshot in app DS;
  updates refresh it and drawing/tag deletion revokes it. Dashboard cards,
  tags, theme, recency and Calendar links use the Holm workspace. Reload-safe
  private URLs use `/draw/editor.html?id=<id>`.

## Stage 10 — Files (deployed on Holm; signed-in browser/upload/download checks pending)

- The original Files manager, nested folders, Uppy multi-file queue, file
  viewers, thumbnails, multi-tag controls and styling are retained. Metadata,
  raw bytes and thumbnails live in separate Holm member-DS collections; no
  key/hash or client-supplied storage path selects another member's file.
  Uploads are atomic with metadata; member-private downloads carry no-store,
  nosniff and sandbox headers so an uploaded HTML/SVG document cannot run
  same-origin scripts with the member's cookie. The original default 300 KB
  cap is reported to Uppy and enforced by the server. An optional bounded
  `FILES_MAX_FILE_SIZE` setting may raise it; large-file limits still need
  live platform verification.
- Folder delete cascades through arbitrary nesting and removes contained bytes
  and thumbnails. Files/folders are *multi-tagged*: deleting a tag only removes
  it from them, unlike destructive single-tag apps. `/files/?id=<id>` and
  `?folder=<id>` survive Holm's static URL canonicalization. Dashboard cards,
  tag filters, recency, thumbnail lookups, Calendar links and mentions resolve
  solely inside the signed-in member's workspace.
- Holm CSP blocks the original Uppy CDN, so the same pinned Uppy assets are
  served locally. PDF.js and its worker are same-origin for browser Worker CSP.
  Their MIT/Apache licenses are shipped. The Files PWA's activate handler now
  cleans only Files caches, never another Workdeck app's cache.

## Stage 11 — Blog (deployed on Holm; signed-in browser/public-URL checks pending)

- Kept the original posts manager, Quill editor, themes and public article
  renderer. Quill's pinned CSS/JS are now bundled locally with its license for
  Holm CSP. Login uses the suite's verified cookie; the old access-key and
  account-deletion controls have been replaced with a link to Holm account
  management. `/blog/?post=<id>` is a reload-safe private deep link.
- Drafts and post bodies live only in the signed-in member's Holm DS. Publishing
  atomically claims a global 3–40 character, non-reserved root slug and copies
  only the published post's public fields and blog title/description to an
  app-wide read-only snapshot. The guest `/api/site?slug=<slug>` endpoint never
  reads member storage and accepts GET only; `/<slug>` serves the original
  article reader when and only when an active public snapshot exists. The
  public response is no-store so unpublish/delete doesn't retain stale data
  in a CDN cache. Unpublish revokes the snapshot but reserves the old slug;
  deleting or changing links frees it. Ownership checks prevent one member
  from taking or removing another's claimed address.
- Workspace search, previews, tags, recency, create/rename/delete and mentions
  now include member-private posts. Tag or dashboard deletion revokes public
  snapshots before private deletion. Editor autosave completes before publishing.

## Remaining migrations (not yet implemented)

| App | Source / storage | Behaviors to carry over |
| --- | --- | --- |
| Docs | `docs-src`, `api/docs.js` | **Migrated in stage 5**; signed-in browser/share checks pending |
| Sheets | `sheets`, `api/users.js` | **Migrated in stage 6**; signed-in browser/share checks pending |
| Forms | `forms`, `api/forms.js` | **Migrated in stage 7**; signed-in browser/live public submission checks pending |
| Slides | `slides`, `api/slides.js` | **Migrated in stage 8**; signed-in browser/live public share checks pending |
| Draw | `draw`, `api/draw.js` | **Migrated in stage 9**; signed-in browser/live public share checks pending |
| Files | `files`, `api/filebox.js` | **Migrated in stage 10**; signed-in browser/upload/download checks pending |
| Calendar | `calendar`, `api/calendar.js` | **Migrated in stage 4**; signed-in browser checks pending |
| Kanban | `kanban`, `api/kanban.js` | **Migrated in stage 2**; pending deploy/browser verification |
| Blog | `blog`, `api/blog.js`, `api/site.js` | **Migrated in stage 11**; signed-in browser/public-URL checks pending |
| Minutes | `minutes`, `api/minutes.js` (currently unfinished) | **Migrated in stage 3** as-is; current features only, Calendar references await Calendar |
| AI/MCP | `api/_lib/mcp-*`, `/api/mcp` routes | Holm native `/_holm/mcp` connected-app gateway; 29 legacy-compatible tools plus two Holm Docs tools, member-scoped, Holm sign-in and consent (see below) |

For each stage: keep the source app's HTML/CSS/editor behavior, replace only
its auth/storage boundary with verified-member APIs, register its DS collection
link/mention lookup, tag deletion, recency and isolated-member tests. Public
sharing/publishing requires separate explicit public tokens and whitelisted
snapshots: the public endpoint must never expose a private member DS record or
accept an account hash. New share URLs are acceptable; Forms must remain
anonymously submittable. Cross-app settings, deletion cleanup and link targets
need tests before enabling each new menu item. Stage 1 automated tests and
static package validation do **not** substitute for deployment/browser checks.

## AI/MCP on Holm

The Holm build packages `api/contract.json` by combining
`holm/auth/mcp-contract.json` with `holm/auth/mcp-extra-contract.js`. Named
handlers are in `holm/auth/mcp.js` and `holm/auth/mcp-extra.js`. **Deploy with `--spec-v1`** on a Holm
node supporting named operations and connected agents (0.254.0 or newer). Holm
owns `https://<workdeck-app-host>/_holm/mcp`: do not route `/api/mcp` to the
legacy Vercel handler. No TextDB secret, old Workdeck key, PAT, or custom OAuth
service is needed. Holm verifies the signed-in human, obtains consent, and
supplies member-private storage to the handlers. `auth: user` is intentional:
this suite's users need not belong to a Space. Each call uses the verified
current member's `env.holm.app.member.ds`, not an ID supplied by the client.

After deploying, sign in to your Holm Workdeck, open **Settings → Connect AI**,
select your client and copy the displayed URL. In the client, add it as a remote
Streamable HTTP MCP server and finish OAuth in the browser; review the tools
before allowing them. A remote client must support OAuth and automatic client
registration. Test `workspace_list` with `app: "docs"` or `todo_lists`. Holm
manages consent, connection expiry and revocation (not Workdeck's old
`/api/mcp-connections`). Open **Settings → Connect AI → Manage connections**
(opens a new tab), or visit `https://<workdeck-app-host>/_holm/connect/connections`
while signed in with the Holm account that approved the client. That Holm-owned
page lists your connected AI clients and lets you revoke one. Unlike the old
Workdeck modal, the app does not receive the connection inventory or tokens;
the name/status and revoke controls live on Holm's page. `pi mcp logout workdeck`
removes Pi's local saved credentials; use the Holm page to revoke the server-side
approval as well. See
https://holmhq.com/docs/workflows/app-mcp.md for platform-specific steps.

The Holm contract includes all 29 tool names from the old connector, plus two
Holm-specific Docs operations (`docs_create` and `docs_update`). It covers
Todo, Docs, Blog drafts, Calendar, Kanban, Forms, Slides, Draw, Sheets, and
Files/folders. Files and Sheets metadata remain separate from their bytes and
workbooks; dedicated tools read/write those contents. File transfers are limited
to 100 KB. No tool deletes or publishes data. Holm's `sheet_cells` compatibility
tool requests **write** consent because it can mutate a workbook; use
`sheet_read_cells` for read-only consent. Shared Docs, Forms, Slides, Draw and
Sheets cannot be edited by AI until unshared (otherwise the public snapshot
could become stale). Adding future tools or changing their consent risk can
invalidate existing Holm connections; reconnect after redeploy when Holm
requests it.

