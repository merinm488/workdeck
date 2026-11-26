import { useRef } from 'react';

export function SearchBar({ value, onChange }) {
  const input = useRef(null);
  const clear = () => { onChange(''); input.current?.focus(); };
  return <div className="wd-home-search-box">
    <svg className="wd-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
    <input ref={input} type="text" className="wd-search-input" value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      if (event.key === 'Escape' && value) { event.preventDefault(); event.stopPropagation(); clear(); }
    }} placeholder="Search" aria-label="Search docs" />
    {value && <button type="button" className="wd-search-clear" onClick={clear} aria-label="Clear search" title="Clear search"><svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M6 18L18 6M6 6l12 12" /></svg></button>}
  </div>;
}
