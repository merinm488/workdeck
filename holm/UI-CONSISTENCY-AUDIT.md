# Holm UI consistency audit

For the latest cross-app interaction and accessibility review, see
[CONSISTENCY-REVIEW.md](CONSISTENCY-REVIEW.md).

## Earlier audit: app colors restored

**Generation 88** was deployed at `https://mer-workdeck.fazt.sh` on the existing
`holm_app_ZZNXL3c5t1ER` installation.

The first consistency pass (generation 87) incorrectly made all apps' primary
buttons yellow. The user's clarification supersedes that decision: **Home is
only the reference for neutral surfaces and component design, not every app's
brand colors.** Generation 88 removes those universal accent overrides.

Each app's original stylesheet now supplies its light/dark accents and hover
highlights. Shared controls consume those existing variables instead of
redefining them. This applies to buttons, tag creation, selected tools, focus
rings, sidebar selections, icons, Forms submit controls and Sheets' Univer UI.

| App | Light primary fill | Dark primary fill |
| --- | --- | --- |
| Home | `#eab308` | `#facc15` |
| Draw | `#e11d48` | `#fb7185` |
| Forms | `#7248b9` | `#a78bfa` |
| Slides | `#ea580c` | `#fb923c` |
| Todo | `#188038` | `#4ade80` |
| Calendar | `#0284c7` | `#38bdf8` |
| Kanban | `#a21caf` | `#e879f9` |
| Sheets | `#22c55e` | `#22c55e` |
| Files | `#0d9488` | `#0d9488` |
| Blog | `#0d9488` | `#2dd4bf` |
| Minutes | `#276b53` | `#276b53` |
| Docs | `#4285f4` | `#ffffff` |

Docs' white dark-theme primary and Minutes' constant green fill are their
original per-theme behavior, not new palette choices. Label colors are chosen
for readability against each actual fill rather than assuming yellow.

Draw's original hover highlights are restored to `rgba(225,29,72,.10)` in light
mode and `rgba(251,113,133,.14)` in dark mode. Equivalent source-defined
highlights remain intact for the other apps.

## Shared design retained

The reference stylesheet at `https://mer-workdeck.fazt.sh/workdeck.css` matched
`public/workdeck.css` byte-for-byte when the original audit started.

| Neutral token | Dark | Light |
| --- | --- | --- |
| Page and sidebar | `#0a0a0a` | `#ffffff` |
| Elevated surface | `#141414` | `#f7f7f5` |
| Input / neutral hover | `#1e1e1e` | `#f1f1ef` |
| Border | `#2a2a2a` | `#e5e5e0` |

These shared values are generated from Home. The consistency rules remain:

- Black dark-theme sidebars across all app shells, not slate/navy sidebars.
- Common button corner radius, typography, flat-fill design and hover effect.
- Consistent focus/disabled behavior and neutral secondary controls.
- Red destructive actions and green success notices remain semantic.
- App-specific hover tints and accent fills are **not** replaced with yellow.

## Other fixes retained

- Files, Kanban, Blog and Minutes use the shared neutral chrome rather than
  independent navy/green-tinted page and settings backgrounds.
- Docs' Tailwind neutral ramp and Markdown editor/toolbar use Home's surfaces.
- Docs and Minutes follow system-theme changes and update the effective root
  theme; Minutes uses the suite's dark default.
- Sheets' `toggleDarkMode()` call now passes the boolean required by Univer,
  fixing a light spreadsheet engine inside a dark shell.
- Shared Sheets initializes its theme manager and synchronizes the read-only
  viewer engine without writing to its workbook.
- Sheets settings stay within the viewport on phones.
- Minutes meeting cards and search controls fit a 320px viewport.
- A pre-paint bootstrap avoids mismatched initial theme colors.

## Implementation

- `holm/auth/theme-build.mjs`: Home-derived neutral/RGB tokens and HTML wiring.
- `holm/auth/suite-theme.css`: neutral adapters, app-accent adapters, shared
  component design, Docs and Univer chrome. Original accent variables are not
  overwritten.
- `holm/auth/app-sidebar.css`, `holm/auth/settings-menu.css`: shared UI components
  use the current app's control accent and common neutrals.
- `holm/auth/suite-theme.js`: pre-paint effective theme.
- `holm/docs-src/src/hooks/useTheme.js`, `holm/minutes/app.js`: theme synchronization.
- `holm/sheets/theme-build.mjs`: fail-fast, Holm-only transforms of retained
  spreadsheet source.
- `scripts/build-holm-landing.mjs`: package wiring and Docs utility palette.
- `test/holm-theme.test.mjs`: regression tests including a guard against
  overriding original app accent variables.
- `scripts/audit-holm-theme.mjs`: Chrome/CDP checks with independent per-app
  color expectations—not an assertion that every app equals Home.

## Verification for the correction

- **90 automated tests pass**, including existing migration/data tests.
- Holm package builds and validates with **0 validation warnings**.
- **24 app-home/theme checks** passed, including actual pointer hover,
  focus/disabled styling, primary fill/label colors and black/white sidebars.
- The **104-case** desktop/mobile matrix covered 26 home/editor/shared routes
  in both themes at 1280px and 390px. Four Draw shared-view checks initially
  reported an audit-only issue: the Export link was treated as a disableable
  button. The harness was corrected to distinguish links from native controls;
  all four passed on rerun. No app palette, layout or runtime failures remained.
- Draw's home and editor hover highlights were explicitly checked in both
  themes and viewport sizes.
- **12 live stylesheet checks** match the deployed release byte-for-byte,
  including shared styles and all static apps' original accent stylesheets.

Artifacts:

- `/tmp/workdeck-app-colors-homes/`
- `/tmp/workdeck-app-colors-full/`
- `/tmp/workdeck-app-colors-draw-shared/`
- `/tmp/workdeck-app-colors-live-verification.json`
- `/tmp/workdeck-app-colors-deploy.log`

Earlier neutral/layout testing also covered 320px and 768px, list views and
28 live system-theme/storage-event scenarios. Those checks are documented in
previous session artifacts under `/tmp/workdeck-theme-*`; they predate the
accent correction and should not be used as its color baseline.

## Reproduce

```sh
node --test test/*.test.mjs
node scripts/build-holm-landing.mjs /tmp/workdeck-app-colors
holm app validate --spec-v1 /tmp/workdeck-app-colors
WIDTHS=1280,390 CHECK_STATES=1 EDIT_DOCS=1 node scripts/audit-holm-theme.mjs \
  /tmp/workdeck-app-colors/web /tmp/workdeck-app-colors-report
```

Requires Node 22+ and Chrome (`CHROME` can specify its executable). Optional
`THEMES`, `PAGES`, `VIEW=list`, `CHECK_SWITCHING=1` and `SCREENSHOTS=0` narrow or
extend a run. Run editor-heavy audits sequentially; external CDN failures are
reported as failures, not ignored. Screenshots are saved for follow-up review;
this is not a pixel-diff baseline test.

## Boundaries

Changes are Holm-only; the legacy Vercel build and existing uncommitted work
are retained. Browser checks use local fixtures and real packaged app/editor
code, not a signed-in production account. Live verification checks deployed
assets, not private records or saves. No workspace records were modified.

User-selected tags, priorities, calendar colors, board covers, chart series,
canvas content and spreadsheet cell formatting remain unchanged. Marketing
pages, published blog articles and Holm-owned sign-in/consent pages retain
separate designs. `/account` remains the existing Home redirect.
