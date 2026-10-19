import { useEffect, useState } from 'react';
import { prefersCoarseLayout } from './gestures';

function mediaMatches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/** Phones, tablets, and narrow windows use the simplified timeline. */
export function useCoarseLayout(): boolean {
  const [coarse, setCoarse] = useState(() => prefersCoarseLayout(mediaMatches));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const queries = [window.matchMedia('(pointer: coarse)'), window.matchMedia('(max-width: 800px)')];
    const update = () => setCoarse(prefersCoarseLayout(mediaMatches));
    for (const query of queries) query.addEventListener('change', update);
    return () => {
      for (const query of queries) query.removeEventListener('change', update);
    };
  }, []);
  return coarse;
}
