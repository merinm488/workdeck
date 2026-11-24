import { useState, useRef, useEffect } from 'react';

// Keep the original settings button location; Holm owns identity and account
// deletion, so never show legacy account keys or a Docs-only delete action.
export function UserDisplay({ onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [open]);
  return <div className="relative" ref={ref}>
    <button title="Settings" aria-label="Settings" onClick={() => setOpen(!open)}
      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
      <div className="w-8 h-8 rounded-full bg-blue-400/10 dark:bg-white/10 flex items-center justify-center">
        <svg className="w-4 h-4 text-blue-500 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      </div>
    </button>
    {open && <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 z-50">
      <a href="/account" className="block px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700">My account</a>
      <button onClick={() => { setOpen(false); onLogout(); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700">Logout</button>
    </div>}
  </div>;
}
