import { useEffect, useState } from 'react';

/**
 * Screens live in the address hash (#/games, #/positions/set/<id>), so a
 * reload and the Back button work without a router library.
 */

export interface Route {
  /** The path segments after "#/": [] for home, ['positions', 'set', id]... */
  parts: string[];
  params: URLSearchParams;
}

function parse(hash: string): Route {
  const [path = '', search = ''] = hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(search) };
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
