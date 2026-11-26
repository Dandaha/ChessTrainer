import type { ChessData } from '@chess/chess-tools';
import type { Db } from '../db/client.ts';
import { searchConcepts } from '../db/concepts.ts';
import { gamesAtPosition } from '../db/games.ts';
import { repertoiresAt } from '../db/repertoire.ts';
import { explore } from './explorer.ts';

/** The database answers the coach's tools need, in a compact shape for the model. */
export function chessData(db: Db): ChessData {
  return {
    searchConcepts: (query) => searchConcepts(db, query),
    repertoireAt: (fen) =>
      repertoiresAt(db, fen).map(({ repertoire, moves, reached }) => ({
        repertoire: `${repertoire.name} (${repertoire.color})`,
        positionIsInRepertoire: reached,
        moves: moves.map((m) => ({
          move: m.san,
          whose: m.isMyMove ? 'my move' : 'expected opponent reply',
          mainLine: m.isMain,
          priority: m.priority === 'must' ? 'must know' : 'nice to know',
          comment: m.comment,
        })),
      })),
    gamesAt: (fen) => {
      const found = gamesAtPosition(db, fen, 10);
      return {
        total: found.total,
        movesPlayedHere: found.moves.map((m) => ({ move: m.san, games: m.games, whiteWins: m.whiteWins, draws: m.draws, blackWins: m.blackWins })),
        examples: found.games.map((g) => ({ white: g.white, black: g.black, result: g.result, date: g.date, event: g.event, moveFromHere: g.nextSan })),
      };
    },
    openingStats: async (fen) => {
      const result = await explore(fen);
      const total = result.white + result.draws + result.black;
      return {
        games: total,
        moves: result.moves.map((m) => {
          const n = m.white + m.draws + m.black;
          return { move: m.san, share: total ? Math.round((n / total) * 1000) / 10 : 0, whiteWins: m.white, draws: m.draws, blackWins: m.black };
        }),
      };
    },
  };
}
