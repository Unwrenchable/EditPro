import { useEffect, useState } from 'react';
import { getPlatform } from '../platform';
import { prefersTouchLayout, type LayoutHost } from './gestures';

const NARROW_QUERY = '(max-width: 800px)';

function mediaMatches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/** Narrow web and Capacitor windows use the simplified timeline. Electron never does. */
export function useCoarseLayout(): boolean {
  const kind: LayoutHost = getPlatform().kind;
  const [touch, setTouch] = useState(() => prefersTouchLayout(kind, mediaMatches));
  useEffect(() => {
    if (kind === 'electron' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setTouch(prefersTouchLayout(kind, mediaMatches));
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [kind]);
  return touch;
}
