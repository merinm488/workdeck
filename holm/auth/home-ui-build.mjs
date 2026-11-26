import { workdeckHomeIcon, workdeckHomeLink } from './sidebar-home.mjs';
import { withPageBoot } from './navigation-build.mjs';

// Reuse the reference home's component CSS instead of maintaining lookalikes.
export function homeComponentCSS(source) {
  const section = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Missing home component CSS: ${start}`);
    return source.slice(a, b);
  };
  return [
    '/* Generated from public/workdeck.css. Do not edit the build output. */',
    section('.wd-primary-btn {', '.wd-icon-btn {'),
    section('.wd-input {', '.wd-login-error {'),
    section('.wd-search-container {', '/* Inline autocomplete'),
    section('.wd-search-clear {', '/* Actions area */'),
    section('/* ---------- Files grid view ---------- */', '/* ---------- Files list view ---------- */'),
    section('/* ---------- Sidebar rows ---------- */', '/* ---------- Move-to-project modal ---------- */'),
    section('.wd-modal {', '/* Connect AI modal */'),
    section('.wd-sandbox-frame {', '/* ---------- Loading overlay'),
  ].join('\n');
}

export function homeIconsJS(source) {
  const icons = Object.fromEntries([...source.matchAll(/<template id="wd-icon-([a-z-]+)">([\s\S]*?)<\/template>/g)].map(([, name, svg]) => [name, svg.trim()]));
  if (!icons.docs || !icons.minutes) throw new Error('Missing Workdeck app icons');
  icons.workdeck = workdeckHomeIcon;
  const preview = source.match(/<textarea id="wdPreviewFrameDoc" hidden>([\s\S]*?)<\/textarea>/)?.[1];
  if (!preview) throw new Error('Missing sandboxed card preview document');
  return 'window.WDHomeIcons = ' + JSON.stringify(icons) + ';window.WDHomeLink = ' + JSON.stringify(workdeckHomeLink) + ';window.WDPreviewFrameDoc = ' + JSON.stringify(preview) + ';';
}

export function withHomeUI(page) {
  // Document edits are always saved automatically. Keep a passive status in
  // place of the toolbar's manual save action, never an invisible button.
  page = page.replace(/<button\b[^>]*id="saveBtn"[^>]*>[\s\S]*?<\/button>/g,
    page.includes('id="saveState"') ? '' : '<span id="saveState" class="wd-save-status" role="status" aria-live="polite">All changes saved</span>');
  page = page.replace('</head>', '<script src="/js/autosave.js"></script></head>');
  page = page.replace(/<button id="fbTagsConfirm"[^>]*>Save<\/button>/, '')
    .replace('id="evSaveBtn" class="btn btn-primary">Save', 'id="evSaveBtn" class="btn btn-primary">Create event')
    .replace('id="confirmWipLimit" class="btn btn-primary">Save', 'id="confirmWipLimit" class="btn btn-primary">Done')
    .replace('id="confirmNameModal" class="btn btn-primary">Save', 'id="confirmNameModal" class="btn btn-primary">Create')
    .replace('id="confirmReview" class="primary">Save status', 'id="confirmReview" class="primary">Apply status');
  // Native sidebars share the same link as the runtime-mounted app sidebars.
  // Preserve Calendar's close control and the dashboard's separate landing link.
  page = page.replace('<a href="/" class="home-link"', '<a href="/home" class="home-link"')
    .replace('<a class="blog-home-link" href="/"', '<a class="blog-home-link" href="/home"')
    .replace('<div class="cal-sidebar-head"><strong>Calendar</strong>', `<div class="cal-sidebar-head wd-sidebar-brand">${workdeckHomeLink}`)
    .replace(/<a href="\/" class="fb-brand">[\s\S]*?<\/a>/, `<div class="wd-sidebar-brand">${workdeckHomeLink}</div>`)
    .replace('<a href="/" class="wd-logo">', '<a href="/" class="wd-logo" aria-label="Workdeck landing page" title="Workdeck landing page">');
  // App homes go straight from the main header to their content. Remove only
  // redundant title-only strips, never toolbars with navigation or controls.
  // Sheets tolerates the absent viewTitle; Docs owns its equivalent in React.
  page = page.replace(/<div class="(?:home-toolbar|lists-toolbar|home-view-indicator)">\s*<h2\b[^>]*>[^<]*<\/h2>\s*<\/div>\s*/g, '');
  // Native cards are decorated with shared metadata/actions asynchronously.
  // Keep only the results pending until that first decoration is complete;
  // the header/sidebar shell and explicit loading/retry state stay available.
  if (page.includes('src="/js/app-sidebar.js"')) page = page.replace(/<html\b([^>]*)>/, '<html$1 data-wd-home-pending>');
  // The dashboard contains a sandbox document in a template, including its own
  // closing body. Append to the OUTER document, never that inert template.
  const end = page.lastIndexOf('</body>');
  const preview = page.includes('src="/js/previews.js"') ? '' : '<script src="/js/previews.js"></script>';
  page = page.slice(0, end) + preview + '<script src="/js/home-icons.js"></script><script src="/js/action-menu.js"></script><script src="/js/dialogs.js"></script><script src="/js/tag-ui.js"></script><script src="/js/home-ui.js"></script>' + page.slice(end);
  return withPageBoot(page.replace('</head>', '<link rel="stylesheet" href="/home-components.css"><link rel="stylesheet" href="/home-ui.css"><link rel="stylesheet" href="/action-menu.css"></head>'));
}
