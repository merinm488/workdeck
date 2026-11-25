// Holm-only patches to the retained Sheets engine. Fail the build if upstream
// code changes rather than silently shipping a broken dark-mode adapter.
const replaceOnce = (source, before, after) => {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error('Sheets theme adapter no longer matches its source');
  }
  return source.replace(before, after);
};
export function withSheetEditorTheme(source) {
  // Univer 0.25's method is a setter, despite its name. Calling it without
  // an argument sets undefined, leaving the engine light on a dark page.
  return replaceOnce(source, 'this.univerAPI.toggleDarkMode();', 'this.univerAPI.toggleDarkMode(wantDark);');
}
export function withSharedSheetTheme(source) {
  source = replaceOnce(source, '    // Wait for Univer to be available',
    '    themeManager.init();\n    // Wait for Univer to be available');
  return replaceOnce(source, '            this.univerAPI = univerAPI;', `            this.univerAPI = univerAPI;
            // Theme only the viewer UI; never write to the shared workbook.
            const syncTheme = () => univerAPI.toggleDarkMode(document.documentElement.dataset.theme === 'dark');
            syncTheme();
            this.themeObserver = new MutationObserver(syncTheme);
            this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });`);
}
