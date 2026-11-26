import { createContext, useContext, useEffect, useRef } from 'react';

const DocTagsContext = createContext(null);
export const useDocTags = () => useContext(DocTagsContext);

// Card, list and document-sidebar actions use the same picker as Workdeck home.
// Persist through useDocs so versioning, badges, counts and filters stay in sync.
export function DocTagsProvider({ children, tags, onUpdateDoc }) {
  const dialogRef = useRef(null);
  useEffect(() => () => dialogRef.current?.close(), []);
  const editTags = (doc, trigger) => {
    if (dialogRef.current?.open) return;
    dialogRef.current = window.WDTagUI.editTags({
      name: doc.title,
      tags,
      tagId: doc.tagId || null,
      trigger,
      onSave: async tagId => !!await onUpdateDoc(doc.id, { tagId }),
      onClose: () => { dialogRef.current = null; },
    });
  };
  return <DocTagsContext.Provider value={editTags}>{children}</DocTagsContext.Provider>;
}
