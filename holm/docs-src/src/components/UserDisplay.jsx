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
    <button title="Account menu" aria-label="Account menu" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} className="wd-account-trigger">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
    </button>
    {open && <div className="wd-account-panel absolute right-0 top-full mt-2 z-50">
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
