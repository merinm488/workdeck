import { useState, useRef, useEffect } from 'react';

const icons = {
  light: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>,
  dark: <path d="M20.5 15.5A9 9 0 0 1 8.5 3.5a9 9 0 1 0 12 12Z"/>,
  system: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8m-4-3v3"/></>
};

// Docs uses React instead of the static app menus; share their account styling
// and call Docs' own theme hook to persist the preference to Holm.
export function UserDisplay({ onLogout, theme, onSetTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="relative" ref={ref}>
    <button title="Settings" aria-label="Settings" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} className="wd-account-trigger">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
    {open && <div className="wd-account-panel absolute left-0 bottom-full mb-2 z-50">
      <div className="wd-theme-setting" aria-label="Theme"><span>Theme</span>
        <div className="wd-theme-options" role="group" aria-label="Theme preference">
          {Object.entries(icons).map(([choice, icon]) => <button key={choice} type="button" className="wd-theme-choice" title={`${choice[0].toUpperCase() + choice.slice(1)} theme`} aria-label={`${choice[0].toUpperCase() + choice.slice(1)} theme`} aria-pressed={theme === choice} onClick={() => onSetTheme(choice)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>
          </button>)}
        </div>
      </div>
      <a href="/auth/account?redirect=%2Fhome" className="wd-account-item">Your sign-ins</a>
      <button onClick={() => { setOpen(false); onLogout(); }} className="wd-account-item">Logout</button>
    </div>}
  </div>;
}
