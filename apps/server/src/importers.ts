/**
 * Fetching a player's games from Lichess and Chess.com. These only download
 * PGN text; importing it into the library is apps/server/db/games.ts.
 */

const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

export class ImportSourceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ImportSourceError';
  }
}

function checkUsername(username: string): string {
  const name = username.trim();
  if (!USERNAME.test(name)) throw new ImportSourceError('That is not a valid username.');
  return name;
}

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': 'chess-workspace (personal use)', ...headers } });
  } catch {
    throw new ImportSourceError(`Could not reach ${new URL(url).host}. Check the internet connection.`, 502);
  }
  if (response.status === 404) throw new ImportSourceError('No such player on that site.', 404);
  if (response.status === 429) throw new ImportSourceError('The site asks us to slow down. Try again in a minute.', 429);
  if (!response.ok) throw new ImportSourceError(`The site answered ${response.status}.`, 502);
  return response;
}

/** The most recent games of a Lichess player, newest first, as one PGN text. */
export async function fetchLichessGames(username: string, max = 500, token?: string): Promise<string> {
  const name = checkUsername(username);
  const params = new URLSearchParams({
    max: String(Math.min(Math.max(max, 1), 5000)),
    opening: 'true',
    clocks: 'false',
    evals: 'false',
  });
  const response = await get(`https://lichess.org/api/games/user/${encodeURIComponent(name)}?${params}`, {
    Accept: 'application/x-chess-pgn',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  return response.text();
}

interface ChesscomArchive {
  games?: { pgn?: string; rules?: string }[];
}

/** The most recent standard-chess games of a Chess.com player, newest months first, up to max. */
export async function fetchChesscomGames(username: string, max = 500): Promise<string> {
  const name = checkUsername(username).toLowerCase();
  const archives = (await (await get(`https://api.chess.com/pub/player/${name}/games/archives`)).json()) as {
    archives?: string[];
  };
  const months = [...(archives.archives ?? [])].reverse();
  const pgns: string[] = [];
  for (const month of months) {
    if (pgns.length >= max) break;
    const archive = (await (await get(month)).json()) as ChesscomArchive;
    const monthGames = (archive.games ?? [])
      .filter((g) => g.pgn && (g.rules ?? 'chess') === 'chess')
      .map((g) => g.pgn!)
      .reverse();
    pgns.push(...monthGames.slice(0, max - pgns.length));
  }
  return pgns.join('\n\n');
}
