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

/**
 * Leaving a screen with unsaved work asks first. A screen with something unsaved (a concept being
 * edited) sets a guard that says what would be lost; any change of address — a link, the sidebar,
 * Back — is then held while `ask` puts the question, and goes ahead only if the person agrees.
 * This listener is added before any screen's, so a held change never reaches them.
 */
let leaveGuard: (() => string | null) | null = null;
let ask: ((message: string) => Promise<boolean>) | null = null;
let current = typeof window === 'undefined' ? '' : window.location.hash;
let passing = false;

/** Sets what leaving the current screen would lose (null: nothing); returns the function that clears it. */
export function setLeaveGuard(guard: () => string | null): () => void {
  leaveGuard = guard;
  return () => {
    if (leaveGuard === guard) leaveGuard = null;
  };
}

/** How the question is put (the app's confirm dialog). */
export function setLeaveQuestion(question: (message: string) => Promise<boolean>): void {
  ask = question;
}

if (typeof window !== 'undefined') {
  let asking = false;
  window.addEventListener('hashchange', (event) => {
    const target = window.location.hash;
    // No change after all (the address was put back while a question is open), or one already asked.
    if (target === current) return;
    const message = passing ? null : leaveGuard?.();
    passing = false;
    if (!message || !ask) {
      current = target;
      return;
    }
    // Held: back to where we were (without another hashchange) until the question is answered.
    event.stopImmediatePropagation();
    history.replaceState(null, '', current || '#/');
    if (asking) return;
    asking = true;
    void ask(message).then((leave) => {
      asking = false;
      if (!leave) return;
      leaveGuard = null;
      passing = true;
      window.location.hash = target;
    });
  });
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
