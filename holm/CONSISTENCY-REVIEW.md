# Cross-app consistency review

## Scope

Reviewed Workdeck Home and all eleven apps: Docs, Sheets, Forms, Slides, Draw,
Todo, Kanban, Minutes, Calendar, Files and Blog. Checked shared controls,
keyboard interaction, light/dark/system themes, card/list layouts, native
controls, installation metadata, and home/editor/public-viewer routes.

Changes target the existing Holm deployment. The legacy Vercel source remains
unchanged. Each app keeps its own accent palette; authored document, canvas,
spreadsheet and published article content is not restyled. Domain-specific
editor tools deliberately retain their own layouts.

## Findings and corrections

| Area | Inconsistency | Correction |
| --- | --- | --- |
| Tags | Eight app homes required typing a tag name into a browser prompt. Errors opened another native alert. | Shared, labelled tag chooser with an explicit **No tags** choice, automatic saving, inline errors and retry. Closing an unchanged chooser does not write. Saved assignments reload on close so versioned editors fetch the updated revision. |
| Account menus | Keyboard opening, Escape, focus return and expanded state differed between apps. | Shared arrow/Home/End navigation, Escape/focus restoration and outside dismissal; equivalent React behavior for Docs home and editor. Hidden/disabled controls are skipped. |
| Home account wiring | The build inserted the settings script into the preview document inside a textarea. | Inject into the outer page instead; regression coverage checks the script is outside the template. |
| Minutes account controls | Only a light/dark toggle; no System choice, sign-in management or sign-out in the app. | Standard avatar/menu, Light/Dark/System choices, Your sign-ins and Logout. Sign-out flushes pending meeting changes and refuses to leave on an unsaved/conflicted meeting. |
| Sidebars | Some off-canvas controls remained keyboard/screen-reader reachable; shared drawers and Docs lacked Escape behavior. | Closed sidebars are inert throughout the suite. Mobile drawers support Escape and return focus to their opener. Shared/Docs drawers defer to active dialogs and action menus; Docs also makes its background home inert while the editor is open. |
| Search | Some homes had no clear button; Escape sometimes cleared and blurred, while Docs did not clear. | Explicit Clear search action, Escape-to-clear, and retained input focus. Existing search/autocomplete behavior is preserved. |
| Dialogs | Blog rename/delete and Minutes home deletion used native browser prompts rather than app controls. | Shared themed dialogs with associated labels, focus containment, safe initial focus for destructive actions, inline errors, validation and duplicate-submit prevention. In-flight writes cannot be dismissed accidentally. |
| Keyboard cards | Minutes meeting cards opened with Enter but not Space. | Both keys activate the card without activating nested action buttons. |
| Native controls | The root theme did not set `color-scheme`, leaving browser-owned controls disconnected from dark mode. | Explicit native light/dark color schemes; Minutes printing stays light paper. |
| Install identity | Todo, Calendar, Kanban, Slides, Draw and Blog manifests/browser bars used another app's or an obsolete accent. | Manifest and HTML theme colors now match each app's own light-theme primary fill. |
| Motion | Account-menu visibility animations delayed accessibility state and keyboard focus. | Visibility changes immediately; decorative transitions honor reduced-motion preferences. |

## Implementation

- `holm/auth/dialogs.js`: small native-dialog adapter; callbacks own persistence.
- `holm/auth/settings-menu.js`, `settings-menu.css`: shared account behavior.
- `holm/docs-src/src/hooks/useAccountMenu.js`: React account-menu adapter.
- `holm/auth/app-sidebar.js` and native sidebar implementations: focus/visibility.
- `holm/auth/home-ui.js`, Home and Docs search: clear-action behavior.
- `holm/auth/suite-theme.css`: dialog geometry and native color schemes.
- `scripts/build-holm-landing.mjs`: outer-page wiring, Minutes header, PWA colors.
- `test/consistency.browser.mjs`: new interaction matrix on actual built pages.
- Existing Blog, Minutes and PWA tests cover the changed contracts/build output.

## Reproduction

```sh
node --test test/*.test.mjs
node scripts/build-holm-landing.mjs /tmp/workdeck-holm-release
holm app validate --spec-v1 /tmp/workdeck-holm-release

# Playwright is installed outside the repository; CHROME is optional.
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs \
  WORKDECK_UI_BUILD=/tmp/workdeck-holm-release \
  node test/consistency.browser.mjs

WIDTHS=1280,390 CHECK_STATES=1 CHECK_SWITCHING=1 EDIT_DOCS=1 \
  node scripts/audit-holm-theme.mjs \
  /tmp/workdeck-holm-release/web /tmp/workdeck-consistency-final
```

The browser tests use synthetic local data and mocked storage APIs. No private
production records, account credentials, or test fixtures enter the release.
Live checks verify public pages/assets and deployment identity, not private
record editing. Screenshots are diagnostic artifacts, not a pixel-diff baseline.

## Verified release

Deployed **generation 109** to **`holm_app_ZZNXL3c5t1ER`** on peer `zyt-space`,
keeping the existing host **https://mer-workdeck.fazt.sh**.

- **131 unit/integration tests passed.**
- **24 cross-app interaction runs passed** (12 app areas × 2 themes), each
  exercising 1440px, 768px, 390px and 320px. These also cover native control
  themes, focus, tag assignment/removal/retry, safe dialog cancellation,
  in-flight writes, and Docs' editor account menu.
- **104 home/editor/shared-view theme/layout cases passed** at 1280px and
  390px, plus **28 system-theme/cross-tab checks**.
- All nine existing browser regression suites passed: home UI, navigation,
  list layout, Docs accounts/tags, landing/sidebar, autosave, Sheets editor
  header, Sheets PWA upgrades, and performance. The landing regression's
  sign-out wait now tolerates the new document not having parsed yet; it still
  requires the actual signed-out state before proceeding.
- Holm package validation passed with **0 warnings**. Deployment succeeded;
  its advisory about the existing 1.1 MB Sheets `app-preview.png` remains
  (that unrelated image was not changed).
- **24 live assets matched the release byte-for-byte**; **14 live page routes**
  and **3 updated HTML shells** passed checks. Anonymous workspace access
  still returns **401**. No production workspace records were edited.

Artifacts (outside the repository and release):

- `/tmp/workdeck-consistency-tests-final.log`
- `/tmp/workdeck-consistency-consistency-final.log`
- `/tmp/workdeck-consistency-*-final.log` (individual browser suites)
- `/tmp/workdeck-consistency-final-release/` (104 screenshots and JSON reports)
- `/tmp/workdeck-consistency-interactions/` (dialog/error-state screenshots)
- `/tmp/workdeck-consistency-validate-final.log`
- `/tmp/workdeck-consistency-deploy.log`
- `/tmp/workdeck-consistency-live.json`
