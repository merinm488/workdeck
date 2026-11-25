import { memo, useEffect, useRef } from 'react';
import { DocActions } from './DocActions';

function DocCard({ doc, onClick, onDelete, onRename, onShare, tags = [] }) {
  const preview = useRef(null);
  const tag = tags.find(tag => tag.id === doc.tagId);
  useEffect(() => {
    window.WDPreviews?.mount(preview.current, { app: 'docs', id: doc.id, updatedAt: doc.updatedAt, raw: doc });
  }, [doc]);
  return <div className="wd-file-card wd-doc-card" role="button" tabIndex={0} onClick={() => onClick(doc)} onKeyDown={event => {
    if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onClick(doc); }
  }}>
    <div className="wd-file-card-top">
      <span className="wd-file-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: window.WDHomeIcons?.docs || '' }} />
      <h3 className="wd-file-title">{doc.title || 'Untitled'}</h3>
      <div className="wd-card-menu-slot" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <DocActions card doc={doc} onDelete={onDelete} onRename={onRename} onShare={onShare} />
      </div>
    </div>
    <div className="wd-file-preview" aria-hidden="true"><div className="wd-file-preview-page" ref={preview}><div className="wd-preview-skeleton" /></div></div>
    <div className="wd-file-meta"><span className="wd-file-app-badge">Doc</span>
      {tag && <span className="wd-file-project" title={tag.name}><span className="wd-dot" style={{ background: tag.color }} /><span className="wd-file-project-name">{tag.name}</span></span>}
      <span>{window.WDHomeUI.formatDate(doc.updatedAt || doc.createdAt)}</span>
    </div>
  </div>;
}
export default memo(DocCard);
