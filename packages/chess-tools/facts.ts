import { Chess, type Color as ChessColor, type PieceSymbol, type Square } from 'chess.js';

/**
 * Facts about a position computed by code, so the coach reasons from things
 * that are true rather than from a guess: material, hanging and loose pieces,
 * pins, pawn structure, files, king safety, mobility, checks and captures.
 */

type Side = 'white' | 'black';

export interface PieceRef {
  square: Square;
  /** "knight", "pawn"... */
  piece: string;
  color: Side;
}

export interface PositionFacts {
  fen: string;
  sideToMove: Side;
  inCheck: boolean;
  legalMoves: number;
  checksAvailable: string[];
  capturesAvailable: string[];
  material: {
    white: Record<'P' | 'N' | 'B' | 'R' | 'Q', number> & { points: number };
    black: Record<'P' | 'N' | 'B' | 'R' | 'Q', number> & { points: number };
    /** White's points minus Black's. */
    balance: number;
    bishopPair: { white: boolean; black: boolean };
  };
  /** Attacked and either undefended or attacked by a cheaper piece. */
  hanging: (PieceRef & { attackers: Square[]; defenders: number; reason: 'undefended' | 'attacked by a cheaper piece' })[];
  /** Pieces (not pawns or kings) with no defender, even if not attacked yet. */
  loose: PieceRef[];
  pins: { pinned: PieceRef; by: PieceRef; to: PieceRef; absolute: boolean }[];
  pawns: Record<Side, { isolated: Square[]; doubled: Square[]; passed: Square[]; backward: Square[]; islands: number }>;
  files: { open: string[]; halfOpen: Record<Side, string[]> };
  kings: Record<
    Side,
    { square: Square; castled: boolean; shieldPawns: number; attackedZoneSquares: number; openFilesNearKing: string[] }
  >;
  mobility: { white: number | null; black: number | null };
  /** The facts above as short sentences. */
  summary: string[];
}

const NAMES: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const FILES = 'abcdefgh';

const side = (c: ChessColor): Side => (c === 'w' ? 'white' : 'black');
const other = (c: ChessColor): ChessColor => (c === 'w' ? 'b' : 'w');
const sq = (file: number, rank: number) => `${FILES[file]}${rank + 1}` as Square;
const fileOf = (s: Square) => FILES.indexOf(s[0]!);
const rankOf = (s: Square) => Number(s[1]) - 1;
const label = (p: PieceRef) => `${p.color === 'white' ? 'White' : 'Black'}'s ${p.piece} on ${p.square}`;

interface Placed {
  square: Square;
  type: PieceSymbol;
  color: ChessColor;
}

function pieces(chess: Chess): Placed[] {
  return chess
    .board()
    .flat()
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => ({ square: p.square, type: p.type, color: p.color }));
}

/** The same position with the other side to move (en passant cleared), or null if that is not legal. */
function flipped(fen: string): Chess | null {
  const fields = fen.split(' ');
  fields[1] = fields[1] === 'w' ? 'b' : 'w';
  fields[3] = '-';
  // With the side to move in check, passing the move would let the other side take the king.
  if (new Chess(fen).inCheck()) return null;
  try {
    return new Chess(fields.join(' '));
  } catch {
    return null;
  }
}

export function positionFacts(fen: string): PositionFacts {
  const chess = new Chess(fen);
  const all = pieces(chess);
  const at = new Map(all.map((p) => [p.square, p]));
  const toMove = chess.turn();
  const moves = chess.moves({ verbose: true });

  // Material.
  const count = (c: ChessColor) => {
    const out = { P: 0, N: 0, B: 0, R: 0, Q: 0, points: 0 };
    for (const p of all.filter((x) => x.color === c && x.type !== 'k')) {
      out[p.type.toUpperCase() as 'P'] += 1;
      out.points += VALUE[p.type];
    }
    return out;
  };
  const white = count('w');
  const black = count('b');

  // Hanging and loose pieces.
  const hanging: PositionFacts['hanging'] = [];
  const loose: PieceRef[] = [];
  for (const p of all) {
    if (p.type === 'k') continue;
    const attackers = chess.attackers(p.square, other(p.color));
    const defenders = chess.attackers(p.square, p.color).length;
    const ref = { square: p.square, piece: NAMES[p.type], color: side(p.color) };
    if (attackers.length) {
      const cheapest = Math.min(...attackers.map((s) => VALUE[at.get(s)!.type]));
      if (defenders === 0) hanging.push({ ...ref, attackers, defenders, reason: 'undefended' });
      else if (cheapest < VALUE[p.type]) hanging.push({ ...ref, attackers, defenders, reason: 'attacked by a cheaper piece' });
    } else if (defenders === 0 && p.type !== 'p') {
      loose.push(ref);
    }
  }

  // Pins: a slider, then one enemy piece, then the enemy king or a more valuable enemy piece.
  const pins: PositionFacts['pins'] = [];
  const DIRS: Record<string, [number, number][]> = {
    b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
    r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  };
  for (const slider of all.filter((p) => p.type === 'b' || p.type === 'r' || p.type === 'q')) {
    const dirs = slider.type === 'q' ? [...DIRS.b!, ...DIRS.r!] : DIRS[slider.type]!;
    for (const [df, dr] of dirs) {
      let f = fileOf(slider.square) + df;
      let r = rankOf(slider.square) + dr;
      const hits: Placed[] = [];
      while (f >= 0 && f < 8 && r >= 0 && r < 8 && hits.length < 2) {
        const p = at.get(sq(f, r));
        if (p) hits.push(p);
        f += df;
        r += dr;
      }
      const [first, second] = hits;
      if (!first || !second || first.color === slider.color || second.color === slider.color) continue;
      const absolute = second.type === 'k';
      if (absolute || VALUE[second.type] > VALUE[first.type]) {
        pins.push({
          pinned: { square: first.square, piece: NAMES[first.type], color: side(first.color) },
          by: { square: slider.square, piece: NAMES[slider.type], color: side(slider.color) },
          to: { square: second.square, piece: NAMES[second.type], color: side(second.color) },
          absolute,
        });
      }
    }
  }

  // Pawn structure.
  const pawnsOf = (c: ChessColor) => all.filter((p) => p.type === 'p' && p.color === c).map((p) => p.square);
  const structure = (c: ChessColor) => {
    const mine = pawnsOf(c);
    const theirs = pawnsOf(other(c));
    const forward = c === 'w' ? 1 : -1;
    const onFile = (list: Square[], f: number) => list.filter((s) => fileOf(s) === f);
    const isolated = mine.filter((s) => onFile(mine, fileOf(s) - 1).length === 0 && onFile(mine, fileOf(s) + 1).length === 0);
    const doubled = mine.filter((s) => onFile(mine, fileOf(s)).length > 1);
    const passed = mine.filter((s) =>
      theirs.every((t) => Math.abs(fileOf(t) - fileOf(s)) > 1 || (rankOf(t) - rankOf(s)) * forward <= 0),
    );
    const backward = mine.filter((s) => {
      if (passed.includes(s) || isolated.includes(s)) return false;
      const supporters = mine.filter(
        (o) => Math.abs(fileOf(o) - fileOf(s)) === 1 && (rankOf(o) - rankOf(s)) * forward <= 0,
      );
      if (supporters.length) return false;
      const stop = rankOf(s) + forward;
      if (stop < 0 || stop > 7) return false;
      return theirs.some((t) => Math.abs(fileOf(t) - fileOf(s)) === 1 && rankOf(t) === stop + forward);
    });
    const files = [...new Set(mine.map(fileOf))].sort((a, b) => a - b);
    const islands = files.filter((f, i) => i === 0 || f !== files[i - 1]! + 1).length;
    return { isolated, doubled, passed, backward, islands };
  };

  // Files.
  const pawnFiles = (c: ChessColor) => new Set(pawnsOf(c).map(fileOf));
  const wf = pawnFiles('w');
  const bf = pawnFiles('b');
  const open = [...FILES].filter((_, f) => !wf.has(f) && !bf.has(f));
  const halfOpen = {
    white: [...FILES].filter((_, f) => !wf.has(f) && bf.has(f)),
    black: [...FILES].filter((_, f) => !bf.has(f) && wf.has(f)),
  };

  // King safety.
  const king = (c: ChessColor) => {
    const k = all.find((p) => p.type === 'k' && p.color === c)!;
    const kf = fileOf(k.square);
    const kr = rankOf(k.square);
    const forward = c === 'w' ? 1 : -1;
    const back = c === 'w' ? 0 : 7;
    const shieldPawns = pawnsOf(c).filter(
      (s) => Math.abs(fileOf(s) - kf) <= 1 && (rankOf(s) - kr) * forward >= 1 && (rankOf(s) - kr) * forward <= 2,
    ).length;
    let attackedZoneSquares = 0;
    for (let df = -1; df <= 1; df += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        const f = kf + df;
        const r = kr + dr;
        if (f >= 0 && f < 8 && r >= 0 && r < 8 && chess.isAttacked(sq(f, r), other(c))) attackedZoneSquares += 1;
      }
    }
    const ownFiles = c === 'w' ? wf : bf;
    const openFilesNearKing = [kf - 1, kf, kf + 1].filter((f) => f >= 0 && f < 8 && !ownFiles.has(f)).map((f) => FILES[f]!);
    return {
      square: k.square,
      castled: kr === back && [0, 1, 2, 6, 7].includes(kf),
      shieldPawns,
      attackedZoneSquares,
      openFilesNearKing,
    };
  };

  const flip = flipped(fen);
  const mobility = {
    white: toMove === 'w' ? moves.length : (flip?.moves().length ?? null),
    black: toMove === 'b' ? moves.length : (flip?.moves().length ?? null),
  };

  const facts: PositionFacts = {
    fen,
    sideToMove: side(toMove),
    inCheck: chess.inCheck(),
    legalMoves: moves.length,
    checksAvailable: moves.filter((m) => /[+#]$/.test(m.san)).map((m) => m.san),
    capturesAvailable: moves.filter((m) => m.san.includes('x')).map((m) => m.san),
    material: {
      white,
      black,
      balance: white.points - black.points,
      bishopPair: { white: white.B >= 2, black: black.B >= 2 },
    },
    hanging,
    loose,
    pins,
    pawns: { white: structure('w'), black: structure('b') },
    files: { open, halfOpen },
    kings: { white: king('w'), black: king('b') },
    mobility,
    summary: [],
  };
  facts.summary = summarize(facts);
  return facts;
}

function summarize(f: PositionFacts): string[] {
  const out: string[] = [];
  const mover = f.sideToMove === 'white' ? 'White' : 'Black';
  out.push(`${mover} to move${f.inCheck ? ', in check' : ''}; ${f.legalMoves} legal moves.`);
  const b = f.material.balance;
  out.push(b === 0 ? 'Material is equal.' : `${b > 0 ? 'White' : 'Black'} is up ${Math.abs(b)} point${Math.abs(b) === 1 ? '' : 's'} of material.`);
  if (f.material.bishopPair.white !== f.material.bishopPair.black) {
    out.push(`${f.material.bishopPair.white ? 'White' : 'Black'} has the bishop pair.`);
  }
  for (const h of f.hanging) out.push(`${label(h)} is hanging (${h.reason}; attacked from ${h.attackers.join(', ')}).`);
  for (const p of f.pins) {
    out.push(`${label(p.pinned)} is pinned to the ${p.to.piece} on ${p.to.square} by the ${p.by.piece} on ${p.by.square}${p.absolute ? ' (it cannot move)' : ''}.`);
  }
  for (const color of ['white', 'black'] as const) {
    const Name = color === 'white' ? 'White' : 'Black';
    const s = f.pawns[color];
    if (s.passed.length) out.push(`${Name} has a passed pawn on ${s.passed.join(', ')}.`);
    if (s.isolated.length) out.push(`${Name} has an isolated pawn on ${s.isolated.join(', ')}.`);
    if (s.doubled.length) out.push(`${Name} has doubled pawns on ${s.doubled.join(', ')}.`);
    if (s.backward.length) out.push(`${Name} has a backward pawn on ${s.backward.join(', ')}.`);
    const k = f.kings[color];
    if (k.shieldPawns === 0 && f.material[color === 'white' ? 'black' : 'white'].Q > 0) {
      out.push(`${Name}'s king on ${k.square} has no pawn shield.`);
    }
    if (k.attackedZoneSquares >= 3) out.push(`${k.attackedZoneSquares} squares around ${Name}'s king are attacked.`);
  }
  if (f.files.open.length) out.push(`Open file${f.files.open.length === 1 ? '' : 's'}: ${f.files.open.join(', ')}.`);
  if (f.checksAvailable.length) out.push(`${mover} has ${f.checksAvailable.length} check${f.checksAvailable.length === 1 ? '' : 's'}: ${f.checksAvailable.join(', ')}.`);
  if (f.mobility.white !== null && f.mobility.black !== null) {
    out.push(`Mobility: White ${f.mobility.white} moves, Black ${f.mobility.black}.`);
  }
  return out;
}
