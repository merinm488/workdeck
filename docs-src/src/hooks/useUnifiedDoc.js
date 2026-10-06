import { useState, useEffect } from 'react';

/**
 * The unified user document (all apps' files), fetched through the shared
 * WDMentions cache. Docs itself only loads its own section, but mention
 * chips, the picker and backlinks need every app's file names/ids.
 * Returns null until it resolves.
 */
export function useUnifiedDoc(userHash) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!userHash || !window.WDMentions) return;
    WDMentions.getUnifiedDoc()
      .then((doc) => { if (!cancelled) setData(doc); })
      .catch(() => { /* picker surfaces its own error state */ });
    return () => { cancelled = true; };
  }, [userHash]);

  return data;
}