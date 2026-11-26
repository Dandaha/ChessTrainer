/**
 * The Lichess opening explorer: how often each move is played from a position.
 * It needs a personal Lichess API token (LICHESS_TOKEN in apps/server/.env).
 */

import { ImportSourceError } from './importers.ts';

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
}

export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
}

export function explorerToken(): string | undefined {
  return process.env.LICHESS_TOKEN || undefined;
}

export async function explore(fen: string, options: { ratings?: number[] } = {}): Promise<ExplorerResult> {
  const token = explorerToken();
  if (!token) {
    throw new ImportSourceError(
      'The Lichess opening explorer needs a personal Lichess token. Create one at lichess.org/account/oauth/token (no scopes needed) and put LICHESS_TOKEN=... in apps/server/.env, then restart.',
      400,
    );
  }
  const params = new URLSearchParams({
    variant: 'standard',
    fen,
    speeds: 'blitz,rapid,classical',
    ratings: (options.ratings ?? [1600, 1800, 2000, 2200, 2500]).join(','),
    moves: '12',
    topGames: '0',
    recentGames: '0',
  });
  let response: Response;
  try {
    response = await fetch(`https://explorer.lichess.ovh/lichess?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'chess-workspace (personal use)' },
    });
  } catch {
    throw new ImportSourceError('Could not reach the Lichess opening explorer.', 502);
  }
  if (response.status === 401) throw new ImportSourceError('Lichess did not accept the token in LICHESS_TOKEN.', 400);
  if (response.status === 429) throw new ImportSourceError('The opening explorer asks us to slow down. Try again in a minute.', 429);
  if (!response.ok) throw new ImportSourceError(`The opening explorer answered ${response.status}.`, 502);
  return (await response.json()) as ExplorerResult;
}

/** A rating band around the player's rating, for explorer queries. */
export function ratingsAround(rating?: number): number[] | undefined {
  if (!rating) return undefined;
  const bands = [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
  return bands.filter((b) => b >= rating - 300 && b <= rating + 300);
}
