// Holm-only changes to the shared Univer editor. The hook attaches after
// loadData resolves; never discard edits during an arbitrary warm-up window.
export function withSheetAutosave(source) {
  const start = source.indexOf('        // Arm on quiescence rather than a fixed delay');
  const end = source.indexOf('        this.changeDisposables.push({ dispose: () => clearInterval(armTimer) });', start);
  if (start < 0 || end < 0) throw new Error('Sheets change-tracking boundary missing');
  source = source.slice(0, start) + '        // Tracking is armed immediately after hydration.\n'
    + source.slice(end + '        this.changeDisposables.push({ dispose: () => clearInterval(armTimer) });'.length);
  return source
    // Selection changes hydrate the formula-bar document, not workbook data.
    .replace("            'doc.mutation.rich-text-editing',", "            'doc.mutation.rich-text-editing',\n            'doc.command-replace-snapshot',")
    .replace('        if (thumbnail) spreadsheetData.thumbnail = thumbnail;', `        if (thumbnail) {
            spreadsheetData.thumbnail = thumbnail;
            spreadsheetData.thumbnailStyle = 'univer-light-v1';
        }`)
    .replace('    async save() {\n        const snapshot', '    async save() {\n        await window.WDSheetSnapshots?.nextPaint();\n        const snapshot')
    // Keep the original canvas compositor and its 640px PNG-first output.
    .replace('    captureThumbnail(maxWidth = 640) {', `    captureThumbnail(maxWidth = 640) {
        return window.WDSheetSnapshots?.capture(this, () => this.captureCanvasThumbnail(maxWidth)) || null;
    }

    captureCanvasThumbnail(maxWidth = 640) {`)
    .replace("!document.getElementById('saveBtn')", "!document.getElementById('spreadsheetTitle')")
    .replace('        this.onChangeCallback = onChange;', '        this.onChangeCallback = onChange;\n        this.changeListenersEnabled = true;');
}
