import { useEffect, useState } from 'react';

/** Whether a CSS media query matches now, kept up to date as the window changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const changed = () => setMatches(list.matches);
    changed();
    list.addEventListener('change', changed);
    return () => list.removeEventListener('change', changed);
  }, [query]);
  return matches;
}
