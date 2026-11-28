import type { OpeningName } from '@chess/chess-core/openings';
import { useEffect, useState } from 'react';

/**
 * Lichess's opening names (all of ECO A00–E99 and their named variations), for the pages. The
 * table is half a megabyte, so it is its own file, fetched the first time a screen asks for it.
 */

type Openings = typeof import('@chess/chess-core/openings');

let ready: Openings | null = null;
let loading: Promise<Openings> | null = null;

/** The opening lookups once loaded; null until then (a screen then shows no name for a moment). */
export function useOpenings(): Openings | null {
  const [openings, setOpenings] = useState(ready);
  useEffect(() => {
    if (openings) return;
    let live = true;
    (loading ??= import('@chess/chess-core/openings'))
      .then((module) => {
        ready = module;
        if (live) setOpenings(module);
      })
      .catch(() => {
        // Not loaded (offline dev server, say): the screens show no names; the next screen tries again.
        loading = null;
      });
    return () => {
      live = false;
    };
  }, [openings]);
  return openings;
}

/** "C50 Italian Game: Giuoco Pianissimo", the code in bold; nothing for no opening. */
export function OpeningLabel({ opening, className = '' }: { opening: OpeningName | null | undefined; className?: string }) {
  if (!opening) return null;
  return (
    <span className={className} title={`${opening.eco} ${opening.name}`} data-testid="opening">
      <span className="font-semibold tabular-nums">{opening.eco}</span> {opening.name}
    </span>
  );
}

export type { OpeningName };
