// Keep the legacy Docs source read-only while retiring pin UI in Holm's build.
export function withoutDocPins(source, component) {
  const remove = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Missing ${component} pin boundary`);
    source = source.slice(0, a) + source.slice(b);
  };
  if (component === 'DocListView') {
    source = source.replace('onClick, onPin, onDelete', 'onClick, onDelete')
      .replace('              onPin={onPin}\n', '')
      .replace('{/* Pin icon + Title */}', '{/* Title */}');
    remove('            <button\n', '            <span className="font-medium');
  } else if (component === 'DocDetailView') {
    remove('          {/* Pin indicator */}', '          {/* Date */}');
  } else throw new Error(`Unknown Docs component: ${component}`);
  return source;
}
