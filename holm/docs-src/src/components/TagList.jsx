import { useEffect, useRef } from 'react';

// The exact same DOM component used by the non-React app homes. React owns
// the wrapper; the shared component exclusively owns its children.
export function TagList({ tags, docs = [], activeTag, onTagSelect, onCreateTag, onUpdateTag, onDeleteTag }) {
  const root = useRef(null), ui = useRef(null), latest = useRef(null);
  latest.current = { tags, active: activeTag, count: id => docs.filter(doc => doc.tagId === id).length,
    onSelect: onTagSelect, onSave: (id, values) => id ? onUpdateTag(id, values) : onCreateTag(values), onDelete: onDeleteTag };
  useEffect(() => {
    ui.current = window.WDTagUI.mount(root.current, latest.current);
    return () => { ui.current.destroy(); ui.current = null; };
  }, []);
  useEffect(() => { ui.current?.update(latest.current); }, [tags, docs, activeTag, onTagSelect, onCreateTag, onUpdateTag, onDeleteTag]);
  return <div>
    <button type="button" className={`wd-app-side-all ${activeTag === null ? 'active' : ''}`} aria-current={activeTag === null} onClick={() => onTagSelect(null)}>All items</button>
    <div ref={root} />
  </div>;
}
