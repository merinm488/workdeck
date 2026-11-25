import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const DocTagsContext = createContext(null);
export const useDocTags = () => useContext(DocTagsContext);

// One editor for card, list and sidebar menus. Persist through useDocs so tags,
// badges, counts and filters update together, using the normal versioned API.
export function DocTagsProvider({ children, tags, onUpdateDoc, onCreateTag }) {
  const [editing, setEditing] = useState(null);
  return <DocTagsContext.Provider value={(doc, trigger) => setEditing({ doc, trigger })}>
    {children}
    {editing && <DocTagDialog key={editing.doc.id} {...editing} tags={tags}
      onUpdateDoc={onUpdateDoc} onCreateTag={onCreateTag} onClose={() => setEditing(null)} />}
  </DocTagsContext.Provider>;
}

function DocTagDialog({ doc, trigger, tags, onUpdateDoc, onCreateTag, onClose }) {
  const dialogRef = useRef(null);
  const busyRef = useRef(false);
  const [tagId, setTagId] = useState(doc.tagId || '');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3B82F6');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('saved');
  const queueRef = useRef(null);
  const selectedRef = useRef(tagId);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    const queue = window.WDAutosave.create({
      save: async () => !!await onUpdateDoc(doc.id, { tagId: selectedRef.current || null }),
      onState: setSaveStatus
    });
    queueRef.current = queue;
    return () => { queue.dispose(); dialog.close(); if (trigger?.isConnected) trigger.focus(); };
  }, [trigger]);

  const close = async () => { if (!busyRef.current && await queueRef.current.flush()) onClose(); };
  const selectTag = value => {
    selectedRef.current = value; setTagId(value); queueRef.current.change();
  };
  const save = async event => {
    event.preventDefault();
    if (busyRef.current || (creating && !name.trim())) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      let selected = tagId || null;
      if (creating) {
        const tag = await onCreateTag({ name: name.trim(), color });
        if (!tag?.id) throw new Error('Could not create tag. Please try again.');
        selected = tag.id;
        // If assignment fails, retry with the created tag, not a duplicate.
        selectTag(tag.id); setCreating(false); setName('');
      }
      if (!await queueRef.current.flush()) {
        throw new Error('Could not save tags. Please try again.');
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save tags. Please try again.');
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  return createPortal(<dialog ref={dialogRef} className="wd-doc-tags" aria-labelledby="doc-tags-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
    <form onSubmit={save}>
      <h2 id="doc-tags-title">Edit tags</h2>
      <p className="wd-doc-tags-name">{doc.title || 'Untitled'}</p>
      <label htmlFor="doc-tag-select">Tag</label>
      <select id="doc-tag-select" value={tagId} disabled={busy || creating} onChange={event => selectTag(event.target.value)} autoFocus>
        <option value="">No tag</option>
        {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
      </select>
      {!tags.length && <p>No tags yet. Create one below to organize this doc.</p>}
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => setCreating(!creating)} aria-expanded={creating}>
        {creating ? 'Use existing tag' : 'Create new tag'}
      </button>
      {creating && <div className="wd-doc-tags-create">
        <label htmlFor="doc-tag-name">Tag name</label>
        <input id="doc-tag-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} required disabled={busy} autoFocus />
        <label htmlFor="doc-tag-color">Tag color</label>
        <input id="doc-tag-color" type="color" value={color} onChange={event => setColor(event.target.value)} disabled={busy} />
      </div>}
      {error && <p className="wd-doc-tags-error" role="alert">{error}</p>}
      <div className="wd-doc-tags-actions">
        <span role="status" aria-live="polite">{saveStatus === 'saved' ? 'All changes saved' : saveStatus === 'error' ? 'Not saved — retrying automatically' : 'Saving…'}</span>
        <button type="button" className="btn-secondary" disabled={busy} onClick={close}>Done</button>
        {creating && <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create tag'}</button>}
      </div>
    </form>
  </dialog>, document.body);
}
