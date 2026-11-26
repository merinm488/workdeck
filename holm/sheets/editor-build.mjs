// Holm editor chrome only; keep the legacy Sheets source and Univer UI intact.
export function withSheetEditorChrome(page) {
  const actions = page.match(/            <div class="top-nav-actions">[\s\S]*?\n            <\/div>/g);
  const title = page.match(/<h1 id="spreadsheetTitle"[^>]*>[\s\S]*?<\/h1>/g);
  const share = '                    <button class="settings-dropdown-item" id="shareBtn">';
  if (actions?.length !== 1 || title?.length !== 1 || !page.includes(share) ||
      !actions[0].includes('id="mentionBtn"') || !actions[0].includes('id="saveBtn"') ||
      (actions[0].match(/<button\b/g) || []).length !== 2) {
    throw new Error('Sheets editor header no longer matches its source');
  }
  return page
    .replace('<nav class="top-nav">', '<nav class="top-nav wd-sheet-editor-header">')
    .replace(actions[0], '')
    .replace(title[0], title[0] + '\n            <span id="saveState" class="wd-save-status" role="status" aria-live="polite">All changes saved</span>')
    .replace(share, `                    <button type="button" id="mentionBtn" class="settings-dropdown-item" title="Link a file in the selected cell (or type @ in a cell)"><span class="item-text">Link a file</span></button>\n${share}`)
    .replace('</head>', '<link rel="stylesheet" href="/sheets/editor-header.css"></head>');
}
