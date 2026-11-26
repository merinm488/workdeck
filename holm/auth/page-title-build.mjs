// Browser-tab titles are independent of headings and public-site SEO metadata.
export const appNames = Object.freeze({
  docs: 'Docs', sheets: 'Sheets', forms: 'Forms', slides: 'Slides', draw: 'Draw',
  todo: 'Todo', minutes: 'Minutes', kanban: 'Kanban', blog: 'Blog',
  calendar: 'Calendar', files: 'Files',
});

export function withPageTitle(page, app) {
  const name = appNames[app];
  if (!name) return page; // Workdeck landing/home and published blogs keep their own titles.
  const runtime = `window.WDPageTitle = Object.freeze({
    home() { document.title = ${JSON.stringify(name)}; },
    file(name) { document.title = String(name ?? '').trim() || 'Untitled'; }
  });`;
  return page.replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`)
    .replace('</head>', `<script data-wd-page-title>${runtime}</script></head>`);
}

// Legacy shared viewers remain read-only inputs. Adapt only their tab-title
// assignments in the Holm package; keep the viewer headings unchanged.
export function withSharedPageTitle(source, app) {
  const assignments = {
    sheets: ['document.title = `${this.spreadsheetData.name} - Shared Spreadsheet`;', 'this.spreadsheetData.name'],
    forms: ['document.title = name;', 'name'],
    slides: ['document.title = `${sharedState.deck.name} - Slides`;', 'sharedState.deck.name'],
    draw: ["document.title = `${sharedState.drawing.name || 'Shared Drawing'} - Draw`;", "sharedState.drawing.name || 'Shared Drawing'"],
  };
  const [before, name] = assignments[app] || [];
  if (!before || !source.includes(before)) throw new Error(`Missing ${app} shared tab title`);
  return source.replace(before, `window.WDPageTitle?.file(${name});`)
    .replace('if (this.spreadsheetData && this.spreadsheetData.name) {', 'if (this.spreadsheetData) {');
}
