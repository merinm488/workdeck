// Holm-only changes to the shared Univer editor. The hook attaches after
// loadData resolves; never discard edits during an arbitrary warm-up window.
export function withSheetAutosave(source) {
  const start = source.indexOf('        // Arm on quiescence rather than a fixed delay');
  const end = source.indexOf('        this.changeDisposables.push({ dispose: () => clearInterval(armTimer) });', start);
  if (start < 0 || end < 0) throw new Error('Sheets change-tracking boundary missing');
  source = source.slice(0, start) + '        // Tracking is armed immediately after hydration.\n'
    + source.slice(end + '        this.changeDisposables.push({ dispose: () => clearInterval(armTimer) });'.length);
  return source
    .replace("!document.getElementById('saveBtn')", "!document.getElementById('spreadsheetTitle')")
    .replace('        this.onChangeCallback = onChange;', '        this.onChangeCallback = onChange;\n        this.changeListenersEnabled = true;');
}
