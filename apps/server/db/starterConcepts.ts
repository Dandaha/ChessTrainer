import type { ConceptLevel as Level } from './schema.ts';

/**
 * The starter library: the chess concepts every player should know, from basic to advanced, written
 * up so the person can add their own positions and notes to them. Added once to every library
 * (db/starterLibrary.ts); the move lines here are checked in test/starterConcepts.test.ts.
 */


export interface StarterConcept {
  title: string;
  aliases?: string[];
  category: string;
  level: Level;
  /** What to look for: a few short signs. */
  signs: string[];
  /** Markdown: paragraphs, "- " lists, and ```line blocks (from the FEN line above, else the start). */
  body: string;
  /** Titles of related concepts in this library, linked both ways. */
  related?: string[];
}

export const TACTICS = 'Tactical motifs';
export const MATES = 'Checkmate patterns';
export const PRACTICAL = 'Practical play';
export const OPENINGS = 'Opening ideas';
export const STRUCTURES = 'Pawn structures';
export const STRATEGY = 'Strategic plans';
export const ENDGAMES = 'Endgame technique';

const FENCE = '```';
/** A line of moves shown as a board after them (from the FEN line just above, else the start). */
const line = (moves: string) => `${FENCE}line\n${moves}\n${FENCE}`;
const md = (...parts: string[]) => parts.join('\n\n');

export const STARTER_CONCEPTS: StarterConcept[] = [
  // --- Tactical motifs --------------------------------------------------------------------------
  {
    title: 'Fork',
    aliases: ['Knight fork', 'Family fork', 'Royal fork'],
    category: TACTICS,
    level: 'basic',
    signs: ['Two enemy pieces a knight’s jump from the same square', 'A check that also hits a second piece', 'Undefended or more valuable pieces in a line, a pawn’s step apart'],
    body: md(
      'One piece attacks two or more enemy pieces at once; the opponent can save only one. Knights are the classic forkers: their attack cannot be blocked and it lands on both colours. Pawns, queens and even kings fork too.',
      'A fork of king and queen is a **royal fork**; king, queen and rook together is a **family fork**. A fork that comes with check is the strongest kind, because the reply is forced.',
      '**How to use it:** look for squares from which a piece would hit two targets, then ask how to get a piece there — often a sacrifice first drags a piece onto the right square (a decoy).',
      '**Defending:** keep pieces protected, and do not leave your king and queen a knight’s jump apart.',
      'In the diagram, White to play: the knight jumps to c7 with check, hitting king and rook at once, and takes the rook next.',
      'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
      line('1. Nc7+ Kd7 2. Nxa8'),
    ),
    related: ['Double attack', 'Decoy', 'Loose pieces'],
  },
  {
    title: 'Double attack',
    category: TACTICS,
    level: 'basic',
    signs: ['A move that makes two threats at once', 'A queen move that threatens mate and a loose piece', 'Loose pieces on both sides of the board'],
    body: md(
      'A single move that creates two threats at once, so the opponent can meet only one. A fork is one kind; others are a queen move that threatens mate and a loose piece, a discovered attack that uncovers one threat while the moving piece makes another, or a check that also attacks something.',
      'Most won material in practice comes from double attacks on undefended pieces. Before every move, check which of the opponent’s pieces are loose — and which of yours are.',
      'In the diagram, White to play: the queen checks on the e-file and at the same time eyes the rook on a8 along the diagonal.',
      'r3k3/8/8/8/7Q/8/8/4K3 w - - 0 1',
      line('1. Qe4+ Kd8 2. Qxa8+'),
    ),
    related: ['Fork', 'Discovered attack', 'Loose pieces'],
  },
  {
    title: 'Pin',
    aliases: ['Absolute pin', 'Relative pin'],
    category: TACTICS,
    level: 'basic',
    signs: ['A bishop, rook or queen lined up with an enemy piece and the king or queen behind it', 'A pinned piece that is also a defender', 'A pawn that can attack the pinned piece'],
    body: md(
      'A bishop, rook or queen attacks an enemy piece that cannot move off the line without exposing something behind it. With the king behind, the pin is **absolute**: the pinned piece may not legally move. With a more valuable piece behind, it is **relative**: moving is legal but costs material.',
      '**Exploiting a pin:** attack the pinned piece again, ideally with a pawn ("pile up on the pin"); a pinned piece is also a poor defender, so whatever it guards is weak.',
      '**Breaking one:** put a piece in between, move the piece behind, chase the pinning piece, or — with a relative pin — ignore it when a tactic works. The Elephant Trap is the famous case: White takes on d5 counting on the knight on f6 being pinned, but Black takes back anyway, and after White wins the queen a bishop check wins White’s queen back, leaving Black a piece for a pawn ahead.',
      line('1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Nbd7 5. cxd5 exd5 6. Nxd5 Nxd5 7. Bxd8 Bb4+ 8. Qd2 Bxd2+ 9. Kxd2 Kxd8'),
    ),
    related: ['Skewer', 'X-ray attack', 'Removing the defender'],
  },
  {
    title: 'Skewer',
    category: TACTICS,
    level: 'basic',
    signs: ['King or queen on the same line as a piece behind it', 'A check along a rank, file or diagonal with something loose further on', 'Rooks and queens on open lines in the endgame'],
    body: md(
      'The reverse of a pin: a bishop, rook or queen attacks a valuable piece, which has to move, and the piece behind it falls. A check along a line that wins the rook or queen behind the king is the usual form.',
      'Skewers decide many endgames: a rook checking from the side or from behind wins a rook that stands on the same line as its king, and a pawn promoting on a square in line with the enemy king and queen can skewer them.',
      'In the diagram, White to play: the bishop checks along the long diagonal; the king has to step aside, and the queen behind it falls.',
      'q7/8/8/3k4/8/8/8/2K2B2 w - - 0 1',
      line('1. Bg2+ Kc5 2. Bxa8'),
    ),
    related: ['Pin', 'X-ray attack'],
  },
  {
    title: 'X-ray attack',
    aliases: ['X-ray', 'X-ray defence'],
    category: TACTICS,
    level: 'intermediate',
    signs: ['Two line pieces on the same line, one behind the other', 'An exchange on a square where a piece behind joins in', 'A piece "seeing" through an enemy piece to the square beyond'],
    body: md(
      'A bishop, rook or queen acting *through* another piece. A rook behind its own queen on an open file defends the squares the queen goes to; a rook behind an enemy rook still controls the square beyond once the front rook is exchanged.',
      'X-rays matter most when counting an exchange: a piece standing behind another on the same line is an extra attacker or defender that only shows up after the first capture.',
    ),
    related: ['Skewer', 'Pin', 'Counting', 'Battery'],
  },
  {
    title: 'Battery',
    category: TACTICS,
    level: 'basic',
    signs: ['Queen and bishop on the same diagonal', 'Doubled rooks, or queen and rook on a file', 'A target the front piece is aimed at'],
    body: md(
      'Two or more line pieces lined up on the same rank, file or diagonal, so that their force adds up: doubled rooks on an open file, queen and rook together, or queen and bishop on a diagonal aimed at h7.',
      'Order matters. The front piece should be the one you are happy to exchange or sacrifice; with queen and bishop against h7, the queen in front mates, the bishop behind it supports.',
    ),
    related: ['X-ray attack', 'Open file', 'Attacking the castled king'],
  },
  {
    title: 'Discovered attack',
    aliases: ['Discovery'],
    category: TACTICS,
    level: 'basic',
    signs: ['Your piece standing between your line piece and an enemy target', 'A piece that can move with a threat of its own', 'An enemy queen or king on the line of your rook, bishop or queen'],
    body: md(
      'Moving one piece uncovers an attack by a line piece behind it. Since the moving piece can make a threat of its own, one move creates two threats.',
      'Set them up by placing a piece in front of your bishop, rook or queen on a line that points at an enemy target. The strongest form is the discovered check, where the moving piece is free to go anywhere.',
      'In the diagram, White to play: the knight jumps to c6 with check and uncovers the rook on the queen; after the king moves, the queen is lost.',
      '1k1q4/8/8/8/3N4/8/8/3RK3 w - - 0 1',
      line('1. Nc6+ Kc7 2. Nxd8'),
    ),
    related: ['Discovered check', 'Double check', 'Double attack'],
  },
  {
    title: 'Discovered check',
    category: TACTICS,
    level: 'intermediate',
    signs: ['Your piece between your line piece and the enemy king', 'An undefended enemy piece the moving piece can take'],
    body: md(
      'A discovered attack in which the uncovered attack is check. The opponent has to answer the check, so the moving piece can do anything at all: take the queen, attack two pieces, even stand where it can be captured.',
      'When you see your piece standing between your bishop, rook or queen and the enemy king, look at every square that piece could go to.',
      'In the diagram, White to play: the bishop takes the queen, and the rook behind it gives check, so Black has no time to take back.',
      'q3k3/8/8/8/4B3/8/8/4RK2 w - - 0 1',
      line('1. Bxa8+ Kd7'),
    ),
    related: ['Discovered attack', 'Double check', 'Windmill'],
  },
  {
    title: 'Double check',
    category: TACTICS,
    level: 'intermediate',
    signs: ['A discovered check where the moving piece also gives check', 'A king with few flight squares'],
    body: md(
      'Check from two pieces at once, usually a discovered check in which the moving piece checks too. Neither checking piece can be captured or blocked in one move, so only a king move helps — and when the king has nowhere to go, it is mate.',
      'Réti against Tartakower (Vienna 1910) ends with a queen sacrifice that drags the king into a double check from rook and bishop:',
      line('1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nf6 5. Qd3 e5 6. dxe5 Qa5+ 7. Bd2 Qxe5 8. O-O-O Nxe4 9. Qd8+ Kxd8 10. Bg5+ Kc7 11. Bd8#'),
    ),
    related: ['Discovered check', 'Decoy'],
  },
  {
    title: 'Removing the defender',
    aliases: ['Removal of the guard', 'Undermining', 'Eliminating the defender'],
    category: TACTICS,
    level: 'intermediate',
    signs: ['A target defended by exactly one piece', 'A defender that can be captured, chased by a pawn or exchanged off', 'A knight on f6 (or f3) guarding the king'],
    body: md(
      'Capture, exchange or drive away the piece that guards a key square or piece; then the target falls. The defender can be taken (often with a sacrifice of equal or greater value), attacked by a pawn, or lured away.',
      '**How to find it:** for every important square or piece of the opponent, ask "what defends it?" When the answer is a single piece, look for a way to get rid of it.',
    ),
    related: ['Deflection', 'Overloading', 'Pin'],
  },
  {
    title: 'Deflection',
    category: TACTICS,
    level: 'intermediate',
    signs: ['A defender with an important duty: guarding the back rank, a square or a piece', 'A check or capture the defender must answer'],
    body: md(
      'Forcing a defending piece away from the square, rank or file it guards, with a check or a capture it has to answer. Classic: a rook guarding the back rank is offered something it must take, and the back rank falls.',
      'The difference from a decoy: a deflection drives a piece *away from* its post; a decoy lures one *onto* a particular square.',
    ),
    related: ['Decoy', 'Overloading', 'Removing the defender', 'Back-rank mate'],
  },
  {
    title: 'Decoy',
    aliases: ['Attraction'],
    category: TACTICS,
    level: 'intermediate',
    signs: ['A square where the king or queen would fall to a fork, pin or mate', 'A sacrifice the opponent must accept'],
    body: md(
      'A sacrifice that forces an enemy piece — usually the king or queen — *onto* a particular square, where it then falls to a fork, pin, skewer or mate.',
      'The Greek gift and many smothered mates are decoys: the queen or bishop is given up so that the king or a rook has to step onto the fatal square.',
    ),
    related: ['Deflection', 'Fork', 'Smothered mate', 'Greek gift sacrifice'],
  },
  {
    title: 'Overloading',
    aliases: ['Overworked piece', 'Overloaded piece'],
    category: TACTICS,
    level: 'intermediate',
    signs: ['One piece defending two things', 'Two threats that are both parried by the same piece'],
    body: md(
      'A defender with two jobs cannot do both. Attack one of the things it guards — often with a capture it must recapture — and the other is left unprotected.',
      'Count defenders, not just attackers: a piece that defends a pawn and also covers a mating square is already overloaded.',
    ),
    related: ['Deflection', 'Removing the defender'],
  },
  {
    title: 'Interference',
    category: TACTICS,
    level: 'advanced',
    signs: ['Two enemy line pieces whose lines cross on one square', 'A defender that guards from a distance'],
    body: md(
      'Placing a piece — usually as a sacrifice — between an enemy line piece and the square or piece it defends, cutting the line. Whichever way the opponent captures, one of their lines is blocked.',
      'Rarer than deflection, and easy to miss: look at defenders that work from a distance (a rook along a rank, a bishop along a diagonal) and the squares on their lines.',
    ),
    related: ['Deflection', 'Clearance sacrifice'],
  },
  {
    title: 'Clearance sacrifice',
    aliases: ['Line clearance', 'Square clearance'],
    category: TACTICS,
    level: 'advanced',
    signs: ['Your own piece standing on the square another piece needs', 'Your own piece blocking a line to the enemy king'],
    body: md(
      'Giving up a piece to empty a square or open a line for another piece. The sacrifice should come with a threat — ideally a check — so the opponent has no time to use the tempo.',
      'Ask "which of my pieces is in the way?" A knight on the square the queen wants, or a pawn blocking a bishop’s diagonal to the king, is a candidate for clearance.',
    ),
    related: ['Interference', 'Discovered attack', 'Decoy'],
  },
  {
    title: 'Desperado',
    category: TACTICS,
    level: 'intermediate',
    signs: ['A piece of yours that is lost anyway', 'A sequence of mutual captures', 'An attacked piece that can take something first'],
    body: md(
      'A piece that is lost anyway — attacked and unable to escape, or about to be recaptured — sells itself as dearly as possible by capturing something first.',
      'In exchanges, before recapturing, check whether your attacked piece can take something else (or give check) on its way out. The opponent should check the same thing before starting the exchange.',
    ),
    related: ['Zwischenzug', 'Counting', 'Stalemate trick'],
  },
  {
    title: 'Zwischenzug',
    aliases: ['Intermediate move', 'Intermezzo', 'In-between move'],
    category: TACTICS,
    level: 'intermediate',
    signs: ['An "obvious" recapture', 'A check or threat available first', 'An exchange the opponent started expecting a reply'],
    body: md(
      'Instead of the expected reply — usually a recapture — a forcing move (a check, a capture, a stronger threat) is played first, and the recapture comes afterwards in better circumstances.',
      'Whenever you are about to make a "forced" recapture, take a second: is there a check or a bigger threat first? And when you calculate an exchange, look for the opponent’s in-between moves too.',
    ),
    related: ['Desperado', 'Checks, captures, threats'],
  },
  {
    title: 'Windmill',
    aliases: ['See-saw'],
    category: TACTICS,
    level: 'advanced',
    signs: ['A rook and a bishop (or queen) giving check in turn', 'A king that can only shuttle between two squares'],
    body: md(
      'A repeated discovered check: one piece checks, the king has to step aside, the other piece moves away with discovered check — capturing something — and returns, again and again. The king is stuck and the moving piece eats the board.',
      'The best-known example is Torre against Lasker (Moscow 1925), where a rook and bishop windmill took most of Black’s pieces.',
    ),
    related: ['Discovered check', 'Double check'],
  },
  {
    title: 'Trapped piece',
    category: TACTICS,
    level: 'basic',
    signs: ['A piece with no safe squares', 'A bishop grabbing a rook pawn', 'A knight on the rim, a queen hunting pawns deep in enemy territory'],
    body: md(
      'A piece with no safe square to go to can be attacked and won. Typical victims: a bishop that took a rook pawn and is shut in by a pawn move, a knight on the edge, a queen that went pawn-grabbing.',
      'The Noah’s Ark trap in the Ruy Lopez traps the bishop on b3 with two pawn moves:',
      line('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 d6 5. d4 b5 6. Bb3 Nxd4 7. Nxd4 exd4 8. Qxd4 c5 9. Qd5 Be6 10. Qc6+ Bd7 11. Qd5 c4'),
    ),
    related: ['Knight on the rim', 'Opening traps'],
  },
  {
    title: 'Loose pieces',
    aliases: ['Loose pieces drop off', 'LPDO', 'Undefended pieces'],
    category: TACTICS,
    level: 'basic',
    signs: ['Undefended pieces on either side', 'Pieces defended only by the king'],
    body: md(
      '"Loose pieces drop off" (John Nunn): undefended pieces are the targets of almost every double attack. Keep your pieces protected, and keep a running list of the opponent’s loose ones.',
      'A quick habit: before each move, name every undefended piece on the board. Many tactics simply appear once you have done that.',
    ),
    related: ['Fork', 'Double attack'],
  },
  {
    title: 'Perpetual check',
    category: TACTICS,
    level: 'basic',
    signs: ['An exposed enemy king', 'A queen (or rook) that can check from several squares', 'A lost position that needs a draw'],
    body: md(
      'An endless series of checks the king cannot escape. The game is drawn by repetition (three times the same position) — a vital rescue when you are behind in material.',
      'When you are losing, look at the enemy king’s shelter: a queen with a few checking squares is often enough. When you are winning, make sure your own king has a hiding place before you grab material.',
    ),
    related: ['Stalemate trick', 'Fortress'],
  },
  {
    title: 'Stalemate trick',
    aliases: ['Stalemate', 'Desperado rook'],
    category: TACTICS,
    level: 'intermediate',
    signs: ['Your king with no legal moves', 'A piece you could throw away with check', 'A winning opponent who is not careful'],
    body: md(
      'Stalemate — the side to move has no legal move but is not in check — is a draw. A defender whose king is boxed in can try to give away the rest of the army: a "desperado" rook that checks again and again and cannot be taken without stalemate.',
      'With a big material advantage, always count the defender’s legal moves before you play. With a lost position, look for a way to have none.',
    ),
    related: ['Perpetual check', 'Desperado', 'Queen against pawn on the seventh'],
  },
  {
    title: 'Underpromotion',
    category: TACTICS,
    level: 'intermediate',
    signs: ['A pawn about to promote where a queen would stalemate', 'A knight promotion that gives check or forks'],
    body: md(
      'Promoting to a knight, rook or bishop instead of a queen: to a knight to give check or fork, to a rook or bishop to avoid stalemating the opponent.',
      'The Lasker Trap in the Albin Countergambit ends with a knight promotion with check:',
      line('1. d4 d5 2. c4 e5 3. dxe5 d4 4. e3 Bb4+ 5. Bd2 dxe3 6. Bxb4 exf2+ 7. Ke2 fxg1=N+'),
      'After the king steps back, a queen check wins; if the rook takes the new knight, a bishop check wins White’s queen.',
    ),
    related: ['Stalemate trick', 'Opening traps'],
  },
  {
    title: 'Greek gift sacrifice',
    aliases: ['Classic bishop sacrifice', 'Bxh7+'],
    category: TACTICS,
    level: 'intermediate',
    signs: ['Your bishop on the b1–h7 diagonal against a king castled short', 'A knight that can reach g5, a queen that can reach h5', 'No black knight on f6, often chased away by a pawn on e5'],
    body: md(
      'The bishop takes on h7 with check, the king takes it, the knight jumps to g5 with check and the queen comes to h5 (or d3, or the rook to the h-file) with a mating attack.',
      '**When it works:** a white pawn on e5 keeps a knight off f6; the queen and knight can arrive at once; Black has no …Bf5 or …Qxg5 defence and cannot run the king to g6 safely.',
      '**When it fails:** the king can escape to g6 or g8 with tempo, a defender reaches f6 or h6, or the queen cannot join in time. Calculate the king walk before you give the bishop.',
    ),
    related: ['Decoy', 'Attacking the castled king'],
  },
  {
    title: 'Quiet move',
    aliases: ['Silent move'],
    category: TACTICS,
    level: 'advanced',
    signs: ['A combination that runs out of checks', 'A defender that a calm move would cut off', 'A threat the opponent cannot meet'],
    body: md(
      'A move in the middle of a combination that is not a check, a capture or an obvious threat, yet creates a threat that cannot be met, or takes away the opponent’s only defence. Hard to see precisely because it is quiet.',
      'When a forcing line seems to end without a result, ask what a calm move — closing a flight square, cutting off a defender — would do.',
    ),
    related: ['Checks, captures, threats', 'Prophylaxis'],
  },

  // --- Checkmate patterns -----------------------------------------------------------------------
  {
    title: 'Back-rank mate',
    aliases: ['Back-rank weakness', 'Corridor mate'],
    category: MATES,
    level: 'basic',
    signs: ['A king on its first rank behind unmoved pawns', 'No escape square (no luft)', 'An open file for a rook or queen'],
    body: md(
      'A rook or queen mates the king on its first rank, where it is hemmed in by its own pawns. Even strong players lose to it: the back rank is often defended by a single piece, which can be deflected or overloaded.',
      '**Prevention:** make luft — a pawn move such as h3 (…h6) that gives the king an escape square — or keep a rook or minor piece guarding the back rank.',
      'In the diagram, White to play: the king is shut in by its own pawns, and the rook mates on the back rank.',
      '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
      line('1. Rd8#'),
    ),
    related: ['Luft', 'Deflection', 'Overloading'],
  },
  {
    title: 'Smothered mate',
    aliases: ['Philidor’s legacy'],
    category: MATES,
    level: 'intermediate',
    signs: ['A king surrounded by its own pieces', 'A knight that can reach the square next to the king', 'A queen check on g8 (g1) that the rook must take'],
    body: md(
      'A knight mates a king that cannot move because its own pieces surround it. In **Philidor’s legacy** a queen check on the diagonal drives the king into the corner, the knight checks, the queen is sacrificed on g8 so the rook must take, and the knight mates on f7.',
      'It can happen as early as move six in the Caro-Kann, where Black’s e-pawn is pinned and cannot take the knight:',
      line('1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nd7 5. Qe2 Ngf6 6. Nd6#'),
    ),
    related: ['Decoy', 'Back-rank mate'],
  },
  {
    title: 'Anastasia’s mate',
    category: MATES,
    level: 'intermediate',
    signs: ['A king on h7 (or h8) next to its own g-pawn', 'A knight that can land on e7 (e2)', 'A rook or queen that can reach the h-file'],
    body: md(
      'A knight on e7 covers g8 and g6, the king’s own pawn on g7 blocks it, and a rook or queen mates along the h-file. Often the h-file is opened with a sacrifice on h7 or h5.',
      'Named after the 1803 novel *Anastasia und das Schachspiel*.',
      'In the diagram, White to play: the knight on e7 covers g8 and g6, the pawn on g7 blocks the king, and the rook mates along the h-file.',
      '8/4N1pk/8/8/8/1R6/8/6K1 w - - 0 1',
      line('1. Rh3#'),
    ),
    related: ['Arabian mate', 'Attacking the castled king'],
  },
  {
    title: 'Arabian mate',
    category: MATES,
    level: 'basic',
    signs: ['A king in the corner', 'A knight on f6 (f3) guarding h7 and g8', 'A rook that can reach the seventh rank or the h-file'],
    body: md(
      'One of the oldest mating patterns: a rook mates the king in the corner from the square next to it, protected by a knight that also covers the remaining flight square. With the king on h8, a knight on f6 guards h7 and g8, and the rook mates on h7.',
      'In the diagram, White to play: the rook checks from h7, protected by the knight, which also covers g8.',
      '7k/R7/5N2/8/8/8/8/6K1 w - - 0 1',
      line('1. Rh7#'),
    ),
    related: ['Anastasia’s mate', 'Seventh rank'],
  },
  {
    title: 'Boden’s mate',
    category: MATES,
    level: 'intermediate',
    signs: ['A king castled long with its own pieces on d7 and b8', 'Two bishops on criss-crossing diagonals', 'An open a6–c8 or a3–c1 diagonal'],
    body: md(
      'Two bishops on crossing diagonals mate a king whose flight squares are blocked by its own pieces — typically a king castled queenside, with a sacrifice on c6 or c3 opening the way.',
      'Named after Samuel Boden, who mated this way against Schulder in London, 1853.',
      'In the diagram, Black to play: the two bishops cross on b2 and c2, and the king\'s own rook and knight block its way out.',
      '4kb2/8/8/5b2/8/8/P2N4/2KR4 b - - 0 1',
      line('1... Ba3#'),
    ),
    related: ['Bishop pair', 'Attacking the castled king'],
  },
  {
    title: 'Epaulette mate',
    category: MATES,
    level: 'intermediate',
    signs: ['A king between two of its own pieces on the same rank', 'A queen that can check from two squares in front'],
    body: md(
      'A queen mates the king from two squares straight in front of it, while the king’s two side squares are blocked by its own pieces — like epaulettes on its shoulders. Typically rooks on d8 and f8 with the king on e8.',
      'In the diagram, White to play: the rooks beside the king are its epaulettes, and the queen mates in front of it.',
      '3rkr2/8/8/8/8/7Q/8/4K3 w - - 0 1',
      line('1. Qe6#'),
    ),
    related: ['Dovetail mate', 'Back-rank mate'],
  },
  {
    title: 'Dovetail mate',
    aliases: ['Cozio’s mate'],
    category: MATES,
    level: 'intermediate',
    signs: ['A queen that can reach a square diagonally next to the king, protected', 'The king’s two escape squares behind it blocked by its own pieces'],
    body: md(
      'A protected queen mates from a square diagonally next to the king; the two squares behind the king are blocked by its own pieces, giving the dovetail shape. It often arises with the king driven up the board in the middlegame.',
    ),
    related: ['Epaulette mate'],
  },
  {
    title: 'Damiano’s mate',
    category: MATES,
    level: 'intermediate',
    signs: ['A pawn on g6 (g3) next to the castled king', 'A queen that can reach h7 (h2)', 'The king’s own rook on f8 (f1)'],
    body: md(
      'A queen mates on h7, supported by a pawn on g6, against a king on g8 whose rook still stands on f8. Often the h-file is opened by a rook sacrifice first. Named after Pedro Damiano, who published it in 1512.',
      'In the diagram, White to play: the pawn on g6 protects h7, and the queen mates there.',
      '5rk1/8/6P1/8/8/8/8/6KQ w - - 0 1',
      line('1. Qh7#'),
    ),
    related: ['Attacking the castled king', 'Greco’s mate'],
  },
  {
    title: 'Greco’s mate',
    category: MATES,
    level: 'intermediate',
    signs: ['A king on h8 behind its own g7 pawn', 'Your bishop on the a2–g8 diagonal', 'An h-file you can open'],
    body: md(
      'A bishop on the a2–g8 diagonal covers g8, the king’s own pawn on g7 blocks its last flight square, and a rook or queen mates on the h-file — often after a sacrifice on h7 opens it. Named after Gioachino Greco, the 17th-century master.',
      'In the diagram, White to play: the bishop on c4 takes away g8, and the queen mates on the h-file.',
      '7k/6p1/8/8/2B5/8/4Q3/6K1 w - - 0 1',
      line('1. Qh5#'),
    ),
    related: ['Damiano’s mate', 'Anastasia’s mate'],
  },
  {
    title: 'Opera mate',
    category: MATES,
    level: 'intermediate',
    signs: ['A king on its back rank with its own pieces beside it', 'A rook that can reach the back rank, supported by a bishop'],
    body: md(
      'A rook mates on the back rank, protected by a bishop from a distance, against a king blocked by its own pieces. Named after Morphy’s Opera Game (Paris 1858), which ended with a queen sacrifice and this mate:',
      line('1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#'),
      'The game is also the model of rapid development: Black’s kingside never moves.',
    ),
    related: ['Back-rank mate', 'Development', 'Decoy'],
  },
  {
    title: 'Ladder mate',
    aliases: ['Lawnmower mate', 'Rolling mate'],
    category: MATES,
    level: 'basic',
    signs: ['Two rooks, or queen and rook, against a lone king', 'A king that can be pushed rank by rank to the edge'],
    body: md(
      'Two heavy pieces take turns checking, each cutting off one rank (or file), so the king is pushed step by step to the edge and mated there. If the king attacks the rook, move that rook to the far side of the board and carry on.',
      'In the diagram, White to play: one rook holds the seventh rank, the other mates on the eighth.',
      '7k/R7/8/8/8/8/1R6/6K1 w - - 0 1',
      line('1. Rb8#'),
    ),
    related: ['Rook and king mate', 'Queen and king mate'],
  },
  {
    title: 'Fool’s mate',
    category: MATES,
    level: 'basic',
    signs: ['Early f- and g-pawn moves', 'An open e1–h4 (e8–h5) diagonal'],
    body: md(
      'The fastest possible mate, in two moves: White weakens the e1–h4 diagonal with both the f- and g-pawns, and the queen mates on h4.',
      line('1. f3 e5 2. g4 Qh4#'),
      'The lesson: early moves of the f- and g-pawns open lines to your own king.',
    ),
    related: ['Scholar’s mate', 'King safety'],
  },
  {
    title: 'Scholar’s mate',
    category: MATES,
    level: 'basic',
    signs: ['An early queen and bishop aimed at f7 (f2)', 'f7 defended only by the king'],
    body: md(
      'Queen and bishop combine against f7, the square only the king defends at the start:',
      line('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#'),
      'Easily stopped — a pawn to g6 or the queen to e7 covers f7 — and then the early queen is a target that costs White time.',
    ),
    related: ['Fool’s mate', 'Weakness of f7', 'Development'],
  },
  {
    title: 'Légal’s mate',
    category: MATES,
    level: 'intermediate',
    signs: ['A pin on the f3 knight against the queen', 'A queen sacrifice that opens f7', 'Minor pieces that can cover the king’s flight squares'],
    body: md(
      'A queen sacrifice against a pin that only seems to hold: the knight on f3 is "pinned" to the queen, but it moves anyway, and if the queen is taken the minor pieces mate. Named after Légal de Kermeur, 18th-century French master.',
      line('1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#'),
    ),
    related: ['Pin', 'Opening traps', 'Weakness of f7'],
  },

  // --- Practical play ---------------------------------------------------------------------------
  {
    title: 'Candidate moves',
    category: PRACTICAL,
    level: 'basic',
    signs: ['A position that needs calculation', 'More than one reasonable move'],
    body: md(
      'Before calculating, list the moves worth considering — usually two to four — and then look at each in turn. The method, made famous by Alexander Kotov’s *Think Like a Grandmaster* (1971), keeps you from falling in love with the first idea.',
      'Start the list with the forcing moves (checks, captures, threats), then add the strategically natural ones.',
    ),
    related: ['Checks, captures, threats', 'Blunder check', 'Visualization'],
  },
  {
    title: 'Checks, captures, threats',
    aliases: ['Forcing moves', 'CCT'],
    category: PRACTICAL,
    level: 'basic',
    signs: ['Every move: yours and the opponent’s'],
    body: md(
      'The order in which to look at moves: first every check, then every capture, then every threat — for yourself and for the opponent. Forcing moves limit the replies, so they can be calculated deeply, and most tactics start with one.',
    ),
    related: ['Candidate moves', 'Blunder check', 'Zwischenzug'],
  },
  {
    title: 'Blunder check',
    aliases: ['Safety check'],
    category: PRACTICAL,
    level: 'basic',
    signs: ['Before every move you play'],
    body: md(
      'Before letting go of the piece: what are the opponent’s checks, captures and threats *after* my move? Did my move leave a piece undefended, open a line to my king, or stop guarding a square?',
      'Thirty seconds of blunder check saves more points than any opening preparation.',
    ),
    related: ['Checks, captures, threats', 'Loose pieces'],
  },
  {
    title: 'Counting',
    aliases: ['Exchange counting', 'Static exchange evaluation'],
    category: PRACTICAL,
    level: 'intermediate',
    signs: ['A square attacked and defended several times', 'Pieces of different values involved in an exchange'],
    body: md(
      'When a square is attacked and defended, count the attackers and defenders and the value of each piece involved, and capture with the least valuable piece first. Winning the exchange depends on the order, not just the numbers.',
      'Remember hidden attackers behind other pieces (x-rays), pinned defenders that do not count, and in-between moves that change everything.',
    ),
    related: ['X-ray attack', 'Desperado', 'Zwischenzug'],
  },
  {
    title: 'Visualization',
    category: PRACTICAL,
    level: 'intermediate',
    signs: ['Lines longer than a few moves', 'Pieces that move away and come back in a line'],
    body: md(
      'Holding the position in your head as you calculate, so you still see where every piece stands five moves deep. Typical errors are "ghost pieces" that have already moved, and forgetting squares a piece now controls.',
      'Train it by following games in a book without a board, solving puzzles without moving the pieces, and playing through short lines blindfold.',
    ),
    related: ['Candidate moves'],
  },
  {
    title: 'Time management',
    category: PRACTICAL,
    level: 'basic',
    signs: ['Critical moments: exchanges, pawn breaks, the end of the opening', 'Falling behind on the clock'],
    body: md(
      'Spend your time where it matters: decisions that change the character of the position — exchanges, pawn structure changes, sacrifices — deserve long thought; obvious recaptures do not. Avoid time trouble, where even good players blunder.',
    ),
    related: ['Candidate moves'],
  },

  // --- Opening ideas ----------------------------------------------------------------------------
  {
    title: 'Control the centre',
    category: OPENINGS,
    level: 'basic',
    signs: ['The squares e4, d4, e5 and d5', 'Pawns and pieces aimed at the middle'],
    body: md(
      'Pieces in and around the centre reach more squares and can swing to either wing. Occupy or control e4, d4, e5 and d5 with pawns and pieces, and challenge the opponent’s hold on them.',
      'Control does not have to mean occupation: the hypermodern school controls the centre from a distance and strikes at it later.',
    ),
    related: ['Development', 'Hypermodern play', 'Centralization'],
  },
  {
    title: 'Development',
    aliases: ['Rapid development'],
    category: OPENINGS,
    level: 'basic',
    signs: ['Pieces still on their starting squares', 'The same piece moved twice', 'An early queen'],
    body: md(
      'Bringing the pieces out quickly and to good squares: knights and bishops first, then castling, then connecting the rooks. Move each piece once if you can, and do not bring the queen out early, where it gets chased with gain of time.',
      'A lead in development is a temporary advantage: use it to open lines before the opponent catches up.',
    ),
    related: ['Control the centre', 'King safety', 'Tempo'],
  },
  {
    title: 'King safety',
    aliases: ['Castle early', 'Castling'],
    category: OPENINGS,
    level: 'basic',
    signs: ['A king still in the centre with lines opening', 'Pawn moves in front of your castled king'],
    body: md(
      'Get the king out of the centre — usually by castling — before the centre opens, and keep the pawns in front of the castled king where they are unless there is a good reason. Every pawn move there creates a weakness that cannot be undone.',
    ),
    related: ['Development', 'Luft', 'Attacking the castled king'],
  },
  {
    title: 'Tempo',
    aliases: ['Gaining a tempo', 'Time'],
    category: OPENINGS,
    level: 'basic',
    signs: ['A move that develops with a threat', 'An opponent’s piece that can be chased'],
    body: md(
      'A tempo is one move, as a unit of time. Gaining a tempo means making a useful move with a threat the opponent has to answer; losing one means a move that achieves nothing, or a piece that gets chased back.',
      'In the opening and in sharp positions, tempi often matter more than a pawn.',
    ),
    related: ['Development', 'Initiative', 'Gambit'],
  },
  {
    title: 'Weakness of f7',
    aliases: ['Weakness of f2', 'The f7 square'],
    category: OPENINGS,
    level: 'basic',
    signs: ['f7 (f2) defended only by the king', 'A bishop on c4 (c5) and a knight that can reach g5 (g4)'],
    body: md(
      'At the start the f7 square (f2 for White) is defended only by the king, so early attacks aim at it: Scholar’s mate, the Fried Liver attack, and many traps with a bishop on c4 and a knight on g5.',
      'Castling — which brings a rook to f8 — and keeping a knight on f6 are the usual cures.',
      'Guarded only by the king, f7 is the first target of many attacks. In the Fried Liver below, White\'s knight takes there.',
      line('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7'),
    ),
    related: ['Scholar’s mate', 'Légal’s mate', 'King safety'],
  },
  {
    title: 'Fianchetto',
    category: OPENINGS,
    level: 'basic',
    signs: ['A knight’s pawn moved one square', 'A bishop on a long diagonal'],
    body: md(
      'Developing a bishop on the long diagonal by moving the knight’s pawn one square (g3 and Bg2, or …b6 and …Bb7). The bishop works from a distance and guards the castled king.',
      'Its weakness: if the fianchettoed bishop is exchanged, the squares around the king (f3, h3 or f6, h6) become holes.',
    ),
    related: ['Hypermodern play', 'Colour complex weakness'],
  },
  {
    title: 'Gambit',
    category: OPENINGS,
    level: 'intermediate',
    signs: ['A pawn offered for development or open lines', 'A lead in development to use quickly'],
    body: md(
      'An opening in which material, usually a pawn, is offered for time, open lines or the centre. The gambiteer must use the lead in development before it disappears; the defender can keep the pawn and survive, or give it back to catch up.',
    ),
    related: ['Tempo', 'Initiative', 'Compensation'],
  },
  {
    title: 'Hypermodern play',
    aliases: ['Hypermodernism'],
    category: OPENINGS,
    level: 'advanced',
    signs: ['Fianchettoed bishops aimed at the centre', 'Letting the opponent build a big pawn centre on purpose'],
    body: md(
      'The idea, from Nimzowitsch, Réti and Breyer in the 1920s, that the centre can be controlled from a distance with pieces, letting the opponent occupy it with pawns and then attacking those pawns. The Grünfeld, the King’s Indian and the Alekhine Defence work this way.',
    ),
    related: ['Control the centre', 'Fianchetto', 'Pawn breaks'],
  },
  {
    title: 'Knight on the rim',
    aliases: ['A knight on the rim is dim'],
    category: OPENINGS,
    level: 'basic',
    signs: ['A knight on the a- or h-file', 'A knight with two or three squares to go to'],
    body: md(
      '"A knight on the rim is dim": from the edge a knight reaches at most four squares (two from a corner), against eight in the centre. Put knights on the edge only with a clear purpose, and get them back into play.',
    ),
    related: ['Trapped piece', 'Centralization', 'Outpost'],
  },
  {
    title: 'Transposition',
    aliases: ['Move order'],
    category: OPENINGS,
    level: 'intermediate',
    signs: ['The same position reached by a different order of moves', 'An opponent who might avoid your preparation'],
    body: md(
      'Reaching the same position by a different move order. Move orders let you avoid an opponent’s favourite line, or steer into one you know — and a repertoire has to cover the orders by which its positions can be reached.',
      'This app’s repertoire spots transpositions by position: a position reached two ways is one position, marked ⇄ transposes.',
    ),
    related: ['Opening traps'],
  },
  {
    title: 'Opening traps',
    aliases: ['Opening trap'],
    category: OPENINGS,
    level: 'intermediate',
    signs: ['A natural-looking move that loses to a hidden reply', 'A pin, a loose piece or the f7 square in the opening'],
    body: md(
      'A natural-looking move that loses to a hidden reply. Knowing the classic traps in your openings saves games — and they teach the patterns behind them: Légal’s mate, the Elephant Trap, Noah’s Ark, the Lasker Trap.',
      'The Blackburne Shilling Gambit is a dubious opening that sets one: after White takes on e5 and on f7, the queen and knight mate.',
      line('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#'),
      'Instead of grabbing the e5 pawn, White should simply take the knight on d4 or castle, and Black’s opening is just bad.',
    ),
    related: ['Légal’s mate', 'Trapped piece', 'Underpromotion', 'Pin'],
  },

  // --- Pawn structures --------------------------------------------------------------------------
  {
    title: 'Isolated queen’s pawn',
    aliases: ['IQP', 'Isolani'],
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['A d-pawn with no c- or e-pawn beside it', 'Outposts on e5 and c5 for the side with it, d5 for the other side'],
    body: md(
      'A d-pawn with no friendly pawns on the c- or e-file. It gives space, open files and outposts on e5 and c5, and so attacking chances in the middlegame; but it cannot be defended by pawns, and the square in front of it is a perfect blockade square.',
      '**With the IQP:** keep pieces on, attack (queen and bishop against h7, a rook lift), and look for the d5 break.',
      '**Against it:** blockade the square in front with a knight, exchange pieces, and win the pawn in the endgame.',
    ),
    related: ['Hanging pawns', 'Blockade', 'Outpost', 'Trading pieces'],
  },
  {
    title: 'Hanging pawns',
    category: STRUCTURES,
    level: 'advanced',
    signs: ['c- and d-pawns side by side with no pawns on the b- and e-files'],
    body: md(
      'Two pawns side by side on the c- and d-files with no neighbours. While they stand together they control many central squares and can break with either one; once attacked and forced to advance, they leave holes behind, and once split they become two weak pawns.',
      'The side against them pressures them with rooks and pieces so they must commit, then blockades.',
    ),
    related: ['Isolated queen’s pawn', 'Pawn breaks', 'Blockade'],
  },
  {
    title: 'Doubled pawns',
    category: STRUCTURES,
    level: 'basic',
    signs: ['Two pawns of one side on the same file'],
    body: md(
      'Two pawns on the same file. They cannot protect each other and are often weak in the endgame, especially when also isolated. But the capture that created them opens a file and the pawns control useful squares, so doubled pawns are often a fair price — the Nimzo-Indian is built on that trade.',
    ),
    related: ['Pawn islands', 'Isolated queen’s pawn'],
  },
  {
    title: 'Backward pawn',
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['A pawn behind its neighbours that cannot advance safely', 'A hole in front of it on a half-open file'],
    body: md(
      'A pawn that has fallen behind the pawns on the files beside it and cannot advance without being lost. It is weak on a half-open file, and the square in front of it is an outpost for the opponent — Black’s d6 pawn in the Sicilian, with the d5 square, is the classic case.',
    ),
    related: ['Weak squares', 'Outpost', 'Half-open file'],
  },
  {
    title: 'Passed pawn',
    category: STRUCTURES,
    level: 'basic',
    signs: ['No enemy pawns in front of it, on its own file or the next ones'],
    body: md(
      'A pawn with no enemy pawn in front of it on its own file or the files beside it: nothing but pieces can stop it. "Passed pawns must be pushed" — the further it gets, the more of the opponent’s army it ties down.',
      'The defender blockades it with a piece, best of all a knight, on the square in front.',
    ),
    related: ['Protected passed pawn', 'Outside passed pawn', 'Connected passed pawns', 'Blockade'],
  },
  {
    title: 'Protected passed pawn',
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['A passed pawn defended by another pawn'],
    body: md(
      'A passed pawn defended by a pawn of its own. The enemy king cannot take it, so it ties the king or a piece down for good; in king-and-pawn endings, it often lets your king roam freely while the enemy king must stay near it.',
    ),
    related: ['Passed pawn', 'Outside passed pawn'],
  },
  {
    title: 'Outside passed pawn',
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['A passed pawn far from the other pawns', 'A king-and-pawn ending'],
    body: md(
      'A passed pawn far away from the rest of the pawns. In king-and-pawn endings it decides: it lures the enemy king away, and your king then eats the pawns on the other side.',
    ),
    related: ['Passed pawn', 'Pawn majority', 'King activity'],
  },
  {
    title: 'Connected passed pawns',
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['Two passed pawns on neighbouring files'],
    body: md(
      'Two passed pawns on neighbouring files protect each other as they advance. On the sixth rank, two connected passers beat a rook on its own.',
    ),
    related: ['Passed pawn', 'Breakthrough'],
  },
  {
    title: 'Pawn majority',
    aliases: ['Queenside majority'],
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['More pawns than the opponent on one wing', 'An endgame coming'],
    body: md(
      'More pawns than the opponent on one wing. A healthy majority can produce a passed pawn; a queenside majority is prized because the passed pawn it creates is far from the kings, which usually castle short.',
      'Advance the pawn with no opponent in front of it first ("candidate first"), so the passed pawn appears.',
    ),
    related: ['Outside passed pawn', 'Minority attack'],
  },
  {
    title: 'Minority attack',
    aliases: ['Carlsbad structure'],
    category: STRUCTURES,
    level: 'advanced',
    signs: ['White pawns a2, b2, d4; Black pawns a7, b7, c6, d5 (the Carlsbad structure)', 'A half-open c-file'],
    body: md(
      'Advancing fewer pawns against more — typically White’s a- and b-pawns against Black’s a-, b- and c-pawns in the Carlsbad structure of the Queen’s Gambit Declined, Exchange Variation. When b5 is played and pawns are exchanged, Black is left with a weak pawn on c6 or an isolated one on d5.',
      'Black’s counterplay lies on the kingside and in the centre, or in meeting b5 with …c5.',
    ),
    related: ['Pawn majority', 'Backward pawn', 'Half-open file'],
  },
  {
    title: 'Pawn chain',
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['Pawns on a diagonal, each protecting the next', 'A locked centre (e5 against e6, d4 against d5)'],
    body: md(
      'Pawns on a diagonal, each defending the one in front. Nimzowitsch’s rule: attack a chain at its base, the one pawn no other pawn protects. In the French, White’s chain d4–e5 is attacked with …c5 at d4, and …f6 at e5.',
      'Play on the side the chain points towards: a chain pointing to the kingside invites a kingside attack.',
    ),
    related: ['Pawn breaks', 'Space advantage'],
  },
  {
    title: 'Pawn breaks',
    aliases: ['Lever'],
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['A pawn advance that offers an exchange with an enemy pawn', 'Closed files you want to open'],
    body: md(
      'A pawn advance that challenges an enemy pawn and opens lines. In closed positions the breaks are the plan: know which ones your structure offers (…c5 and …f6 in the French, f4–f5 or c4–c5 in the King’s Indian) and prepare them with pieces before playing them.',
    ),
    related: ['Pawn chain', 'Hypermodern play'],
  },
  {
    title: 'Weak squares',
    aliases: ['Holes'],
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['A square no pawn can ever attack again', 'Pawns advanced past a square on both neighbouring files'],
    body: md(
      'A square that can no longer be defended by a pawn, because the pawns that could have covered it have advanced or gone. It becomes a home for enemy pieces, above all knights. Every pawn move leaves squares behind it forever — think before advancing.',
    ),
    related: ['Outpost', 'Backward pawn', 'Colour complex weakness'],
  },
  {
    title: 'Pawn islands',
    category: STRUCTURES,
    level: 'basic',
    signs: ['Groups of pawns separated by empty files'],
    body: md(
      'Groups of pawns with no pawns of the same side on the files between them. Fewer islands are usually better: each island’s end pawns need pieces to defend them. The advice is often credited to Capablanca.',
    ),
    related: ['Doubled pawns', 'Isolated queen’s pawn'],
  },
  {
    title: 'Maroczy bind',
    category: STRUCTURES,
    level: 'advanced',
    signs: ['White pawns on c4 and e4 against a Sicilian structure', 'Black’s …d5 and …b5 breaks taken away'],
    body: md(
      'White pawns on c4 and e4 against a Sicilian, after White’s d-pawn has been exchanged for Black’s c-pawn. They clamp d5, so Black’s freeing …d5 (and often …b5) is no longer possible; Black must manoeuvre in less space and look for …f5 or …b5 at the right moment.',
    ),
    related: ['Space advantage', 'Hedgehog'],
  },
  {
    title: 'Stonewall',
    category: STRUCTURES,
    level: 'intermediate',
    signs: ['Pawns on c3, d4, e3 and f4 (or c6, d5, e6, f5)'],
    body: md(
      'A wall of pawns on c3, d4, e3 and f4 (or the same for Black). It gives a firm outpost on e5 (e4 for Black) and kingside attacking chances, but the pawns all stand on one colour: the square in front of them (e4, or e5 for Black) is a hole, and the bishop of the pawns’ colour is hemmed in.',
    ),
    related: ['Outpost', 'Good and bad bishops', 'Weak squares'],
  },
  {
    title: 'Hedgehog',
    category: STRUCTURES,
    level: 'advanced',
    signs: ['Black pawns on a6, b6, d6 and e6', 'White pawns on c4 and e4'],
    body: md(
      'Black pawns on a6, b6, d6 and e6 behind the pieces, against White’s c4 and e4. Black accepts less space for a flexible, solid position and waits for the …b5 or …d5 break; White must avoid over-pressing into it.',
    ),
    related: ['Maroczy bind', 'Pawn breaks', 'Space advantage'],
  },

  // --- Strategic plans --------------------------------------------------------------------------
  {
    title: 'Outpost',
    category: STRATEGY,
    level: 'intermediate',
    signs: ['A square in the opponent’s half that no enemy pawn can attack', 'Protected by your own pawn', 'A knight that can reach it'],
    body: md(
      'A square in the opponent’s half of the board that no enemy pawn can attack, ideally protected by your own pawn. A knight on an outpost is often worth more than a rook; bishops and rooks use them too.',
      'Create outposts by forcing pawn advances, and remove the enemy minor piece that could exchange off your knight.',
    ),
    related: ['Weak squares', 'Knight against bishop', 'Backward pawn'],
  },
  {
    title: 'Open file',
    category: STRATEGY,
    level: 'basic',
    signs: ['A file with no pawns on it', 'Rooks still on their starting squares'],
    body: md(
      'A file with no pawns. Rooks belong there: occupy it, double rooks on it, and use it to invade the seventh rank. When both sides fight for one, the side that controls the entry squares usually wins it.',
    ),
    related: ['Half-open file', 'Seventh rank', 'Battery'],
  },
  {
    title: 'Half-open file',
    aliases: ['Semi-open file'],
    category: STRATEGY,
    level: 'intermediate',
    signs: ['A file with only enemy pawns on it'],
    body: md(
      'A file with no pawns of your own but one of the opponent’s. Your rooks and queen press against that pawn — the c-file in the Sicilian for Black, the c-file against a backward pawn in the Carlsbad structure.',
    ),
    related: ['Open file', 'Minority attack', 'Backward pawn'],
  },
  {
    title: 'Seventh rank',
    aliases: ['Rook on the seventh', 'Pigs on the seventh'],
    category: STRATEGY,
    level: 'basic',
    signs: ['A rook that can reach the opponent’s second rank', 'Pawns still on their starting squares'],
    body: md(
      'A rook on the opponent’s second rank (the seventh from its own side) attacks the pawns that have not moved and boxes the king onto the back rank. Two rooks there — "pigs on the seventh" — often win outright or force a draw by perpetual check.',
    ),
    related: ['Open file', 'Active rook'],
  },
  {
    title: 'Good and bad bishops',
    aliases: ['Bad bishop', 'Good bishop'],
    category: STRATEGY,
    level: 'intermediate',
    signs: ['Your pawns fixed on squares of your bishop’s colour', 'A bishop with no targets'],
    body: md(
      'A bishop is "bad" when its own pawns are fixed on squares of its colour, blocking it, and "good" when its pawns stand on the other colour. As a rule, put your pawns on the colour opposite to your bishop, and exchange your bad bishop when you can.',
      'A bad bishop can still be a good defender: it protects the pawns that block it.',
    ),
    related: ['Bishop pair', 'Knight against bishop', 'Colour complex weakness'],
  },
  {
    title: 'Bishop pair',
    aliases: ['The two bishops'],
    category: STRATEGY,
    level: 'intermediate',
    signs: ['Two bishops against bishop and knight or two knights', 'An open or opening position'],
    body: md(
      'Two bishops cover both colours and work together from a distance; in open positions they are worth about half a pawn more than bishop and knight. The side with the pair should open the position; the other side should keep it closed and look for outposts.',
    ),
    related: ['Good and bad bishops', 'Knight against bishop', 'Open and closed positions'],
  },
  {
    title: 'Knight against bishop',
    aliases: ['Knight vs bishop'],
    category: STRATEGY,
    level: 'intermediate',
    signs: ['A closed position with fixed pawns', 'Pawns on both wings', 'An outpost for the knight'],
    body: md(
      'Knights are better in closed positions, with outposts and pawns on one wing; bishops are better in open positions with pawns on both wings, where their range counts. In an endgame, ask which piece the pawn structure favours before exchanging into it.',
    ),
    related: ['Outpost', 'Bishop pair', 'Good and bad bishops'],
  },
  {
    title: 'Opposite-coloured bishops',
    category: STRATEGY,
    level: 'advanced',
    signs: ['One bishop each, on different colours'],
    body: md(
      'Bishops that move on different colours. In the middlegame they favour the attacker, who in effect has an extra piece on the colour the defender cannot cover. In the endgame they are famously drawish: the defender blockades on the colour of their bishop, and even two extra pawns may not win.',
    ),
    related: ['Fortress', 'Attacking the castled king'],
  },
  {
    title: 'Space advantage',
    aliases: ['Space'],
    category: STRATEGY,
    level: 'intermediate',
    signs: ['Pawns further advanced than the opponent’s', 'Pieces of one side tripping over each other'],
    body: md(
      'More room behind your pawns to manoeuvre. The side with space should avoid exchanges, since the cramped side’s problem eases with every trade; the cramped side should exchange pieces and look for pawn breaks to free the position.',
    ),
    related: ['Pawn chain', 'Trading pieces', 'Maroczy bind'],
  },
  {
    title: 'Prophylaxis',
    aliases: ['Prophylactic thinking'],
    category: STRATEGY,
    level: 'advanced',
    signs: ['A quiet position without a clear plan', 'An opponent’s piece about to become active', 'A pawn break the opponent is preparing'],
    body: md(
      'Preventing the opponent’s plan before it starts. Ask "what does my opponent want to do?" and, when the answer is dangerous, stop it first. Nimzowitsch named it; Petrosian and Karpov made it an art.',
      'Typical prophylactic moves: a king step off a dangerous diagonal, a pawn move that takes a square from an enemy piece, a rook placed opposite the file the opponent wants to open.',
    ),
    related: ['Quiet move', 'Overprotection'],
  },
  {
    title: 'Initiative',
    category: STRATEGY,
    level: 'intermediate',
    signs: ['Threats the opponent has to answer', 'A lead in development'],
    body: md(
      'The ability to make threats that dictate the play, so the opponent can only react. It is worth material: players give a pawn or the exchange to keep it. Keep it with forcing moves, and convert it before it runs out — into material, a better structure or a winning attack.',
    ),
    related: ['Tempo', 'Gambit', 'Compensation'],
  },
  {
    title: 'Centralization',
    category: STRATEGY,
    level: 'basic',
    signs: ['Pieces on the edge of the board', 'An endgame with the king still at the side'],
    body: md(
      'Pieces in the centre control the most squares and can reach either wing fastest. Centralise knights and queens in the middlegame, and the king in the endgame.',
    ),
    related: ['Control the centre', 'King activity', 'Knight on the rim'],
  },
  {
    title: 'Improving the worst piece',
    aliases: ['Worst piece'],
    category: STRATEGY,
    level: 'intermediate',
    signs: ['No clear plan', 'One piece that does nothing'],
    body: md(
      'When there is nothing concrete to do, find your least active piece and give it a job — a better square, a diagonal, a file. Often attributed to Karpov, it is the simplest way to make a plan in a quiet position.',
    ),
    related: ['Prophylaxis', 'Centralization'],
  },
  {
    title: 'Principle of two weaknesses',
    aliases: ['Two weaknesses'],
    category: STRATEGY,
    level: 'advanced',
    signs: ['A weakness the opponent can defend', 'A better endgame that will not win by itself'],
    body: md(
      'One weakness can usually be defended; two, far apart, overstretch the defence. When pressure on one target is not enough, create a second on the other side of the board, then switch between them faster than the defender’s pieces can.',
    ),
    related: ['Weak squares', 'King activity'],
  },
  {
    title: 'Colour complex weakness',
    aliases: ['Weak colour complex'],
    category: STRATEGY,
    level: 'advanced',
    signs: ['A bishop gone, with pawns on the other colour', 'Holes on squares of one colour around the king'],
    body: md(
      'When a side loses the bishop of one colour and its pawns stand on the other, the squares of the missing bishop’s colour have no defender. Enemy pieces settle on them; a queen and knight, or the remaining bishop, can use them to attack.',
    ),
    related: ['Good and bad bishops', 'Fianchetto', 'Weak squares'],
  },
  {
    title: 'Blockade',
    category: STRATEGY,
    level: 'intermediate',
    signs: ['An enemy passed or isolated pawn', 'A knight that can sit on the square in front of it'],
    body: md(
      'Placing a piece on the square in front of an enemy pawn — above all a passed or isolated one — so it cannot advance. Nimzowitsch: "first restrain, then blockade, then destroy." The knight is the ideal blockader: it keeps attacking from the blockade square.',
    ),
    related: ['Passed pawn', 'Isolated queen’s pawn', 'Hanging pawns'],
  },
  {
    title: 'Overprotection',
    category: STRATEGY,
    level: 'advanced',
    signs: ['A key central point the whole plan depends on'],
    body: md(
      'Defending a key point — a central pawn or an outpost — more often than it is attacked. The defending pieces end up well placed, and the point holds even when one of them has to leave. Another of Nimzowitsch’s ideas.',
    ),
    related: ['Prophylaxis', 'Pawn chain'],
  },
  {
    title: 'Exchange sacrifice',
    category: STRATEGY,
    level: 'advanced',
    signs: ['A rook that can take a key minor piece', 'An enemy structure that would be wrecked by the capture'],
    body: md(
      'Giving a rook for a bishop or knight (the exchange) for positional gains: a wrecked pawn structure, a dominant minor piece, control of one colour, a weakened king, or a lasting initiative. The capture on c3 in the Sicilian, breaking White’s queenside pawns, is the textbook case; Petrosian sacrificed the exchange as a defensive weapon.',
    ),
    related: ['Compensation', 'Initiative'],
  },
  {
    title: 'Attacking the castled king',
    aliases: ['Kingside attack', 'Pawn storm'],
    category: STRATEGY,
    level: 'intermediate',
    signs: ['More of your pieces than the defender’s near the king', 'Kings castled on opposite sides', 'A stable or closed centre'],
    body: md(
      'Bring more pieces to the king than can defend it, then open lines: a pawn storm when the kings have castled on opposite sides (your pawns are not shielding your own king), or sacrifices on h7, g7 or f7 when they have castled on the same side.',
      'Before attacking, make sure the centre will not open against you — a centre counter-attack is the classic answer to a flank attack.',
    ),
    related: ['Greek gift sacrifice', 'King safety', 'Battery'],
  },
  {
    title: 'Luft',
    category: STRATEGY,
    level: 'basic',
    signs: ['A castled king with all its pawns unmoved', 'Rooks leaving the back rank'],
    body: md(
      '"Air": a pawn move, such as h3 or g3 (…h6, …g6), that gives the castled king an escape square and ends back-rank threats. Make luft at a quiet moment — before the opponent’s rook arrives — and prefer the move that weakens least.',
    ),
    related: ['Back-rank mate', 'King safety'],
  },
  {
    title: 'Trading pieces',
    aliases: ['When to exchange', 'Exchanges'],
    category: STRATEGY,
    level: 'intermediate',
    signs: ['A material advantage', 'A cramped position', 'An enemy piece stronger than yours'],
    body: md(
      'Exchange when you are ahead in material (simplify into an ending), when you are cramped, and to remove the opponent’s best piece or your worst. Avoid exchanges when you are attacking, when you have more space, or when the opponent is cramped.',
    ),
    related: ['Space advantage', 'Isolated queen’s pawn', 'Knight against bishop'],
  },
  {
    title: 'Compensation',
    category: STRATEGY,
    level: 'advanced',
    signs: ['Material down, but with activity, development or king safety on your side'],
    body: md(
      'What you get for material you are down: a lead in development, the initiative, a weak enemy king, a better pawn structure, a dominant piece. Compensation is real only if it lasts long enough to turn into something concrete.',
    ),
    related: ['Gambit', 'Exchange sacrifice', 'Initiative'],
  },
  {
    title: 'Open and closed positions',
    category: STRATEGY,
    level: 'intermediate',
    signs: ['Locked central pawns (closed)', 'Exchanged central pawns and open files (open)'],
    body: md(
      'In **open** positions, with the central pawns exchanged, lines decide: bishops and rooks gain, development and king safety matter most. In **closed** positions, with locked pawn chains, manoeuvring and pawn breaks matter, and knights gain in value.',
    ),
    related: ['Bishop pair', 'Knight against bishop', 'Pawn breaks'],
  },

  // --- Endgame technique ------------------------------------------------------------------------
  {
    title: 'Opposition',
    aliases: ['Direct opposition', 'Distant opposition', 'Diagonal opposition'],
    category: ENDGAMES,
    level: 'basic',
    signs: ['Two kings facing each other with one square between them', 'A king-and-pawn ending'],
    body: md(
      'Kings standing on the same file or rank with one square between them. The side that does *not* have to move "has the opposition": the other king must give way. With three or five squares between, it is distant opposition; on a diagonal, diagonal opposition.',
      'In king-and-pawn endings the opposition decides whether the attacking king gets through — or, for the defender, whether it can be stopped.',
    ),
    related: ['Key squares', 'Triangulation', 'Outflanking', 'Zugzwang'],
  },
  {
    title: 'Key squares',
    aliases: ['Critical squares'],
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['A king-and-pawn against king ending', 'Squares in front of the pawn'],
    body: md(
      'Squares that, once the attacking king reaches one, win regardless of whose move it is. For a pawn not yet past the middle of the board, the key squares are the three two ranks in front of it; once the pawn has reached the fifth rank, the three squares directly and diagonally in front count too.',
      'So the attacking king aims for a key square, not for the pawn, and the defender fights to keep it out.',
    ),
    related: ['Opposition', 'Rule of the square'],
  },
  {
    title: 'Rule of the square',
    aliases: ['Square of the pawn'],
    category: ENDGAMES,
    level: 'basic',
    signs: ['A passed pawn racing a king'],
    body: md(
      'Whether a king can catch a passed pawn: draw a square from the pawn to its promotion rank (as many files to the side as ranks to go). If the defending king can step into the square — counting whose move it is — it catches the pawn. From its starting rank, count the pawn as if it stood one square further on, because of the double step.',
      'In the diagram, White to play: after the pawn steps to a6 the black king is outside its square, and the pawn queens.',
      '8/8/8/P3k3/8/8/8/7K w - - 0 1',
      line('1. a6 Kd6 2. a7 Kc7 3. a8=Q'),
    ),
    related: ['Passed pawn', 'Réti manoeuvre', 'Key squares'],
  },
  {
    title: 'Triangulation',
    category: ENDGAMES,
    level: 'advanced',
    signs: ['A king-and-pawn ending where you have the wrong move', 'Your king with room to step around three squares'],
    body: md(
      'Losing a tempo with the king: it goes around a triangle of three squares in three moves, while the defending king cannot copy the manoeuvre in the space it has. The position comes back with the opponent to move — now in zugzwang.',
    ),
    related: ['Opposition', 'Zugzwang', 'Corresponding squares'],
  },
  {
    title: 'Zugzwang',
    aliases: ['Mutual zugzwang'],
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['Every move makes your position worse', 'A blocked position with few pieces left to move'],
    body: md(
      'German for "compulsion to move": the side to move would rather pass, because every move worsens its position. **Mutual zugzwang** is a position in which whichever side has to move loses (or draws instead of winning).',
      'It decides most king-and-pawn endings, but appears in middlegames too — Sämisch against Nimzowitsch (Copenhagen 1923) is known as the "Immortal Zugzwang Game".',
    ),
    related: ['Opposition', 'Triangulation', 'Corresponding squares'],
  },
  {
    title: 'Corresponding squares',
    aliases: ['Related squares'],
    category: ENDGAMES,
    level: 'advanced',
    signs: ['A complex king-and-pawn ending', 'Kings manoeuvring at a distance'],
    body: md(
      'Pairs of squares that correspond: when the attacking king stands on one, the defending king must stand on its partner, or lose. Working them out generalises the opposition to positions where the kings are far apart or the pawns block the way.',
    ),
    related: ['Opposition', 'Triangulation', 'Zugzwang'],
  },
  {
    title: 'Shouldering',
    aliases: ['Body check'],
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['Two kings racing to the same area', 'Your king able to stand in the other king’s way'],
    body: md(
      'Using your king to block the enemy king’s path, like a shoulder in a crowd: by standing beside it on the way to the pawns, your king makes it go the long way round.',
    ),
    related: ['Opposition', 'Outflanking'],
  },
  {
    title: 'Outflanking',
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['Kings in opposition', 'Room to the side for your king'],
    body: md(
      'When the kings are in opposition and the defender holds, the attacking king steps to the side and goes around: if the defender follows, it gives up the way forward; if not, your king gets past.',
    ),
    related: ['Opposition', 'Shouldering'],
  },
  {
    title: 'Lucena position',
    aliases: ['Building a bridge'],
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['Rook and pawn against rook', 'Your pawn on the seventh with your king in front of it', 'The enemy king cut off by a file'],
    body: md(
      'The most important winning position in rook endings: the pawn is on the seventh rank, the king in front of it, the enemy king cut off. The winning method is to **build a bridge**: put your rook on the fourth rank, so that when the king comes out the rook can block the checks.',
      '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
      line('1. Rd1+ Ke7 2. Rd4 Ra1 3. Kc7 Rc1+ 4. Kb6 Rb1+ 5. Kc6 Rc1+ 6. Kb5 Rb1+ 7. Rb4'),
    ),
    related: ['Philidor position', 'Active rook', 'Rook behind the passed pawn'],
  },
  {
    title: 'Philidor position',
    aliases: ['Third-rank defence'],
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['Rook and pawn against rook', 'Your king in front of the pawn', 'The enemy pawn not yet on your third rank'],
    body: md(
      'The basic drawing method in rook-and-pawn against rook: the defending king stays in front of the pawn, and the rook holds its third rank (the sixth for Black), keeping the enemy king out. When the pawn advances onto that rank, the rook goes to the far end of the board and checks from behind — the king has no shelter left.',
      '4k3/8/r7/3PK3/8/8/8/7R b - - 0 1',
    ),
    related: ['Lucena position', 'Vancura position', 'Short side defence'],
  },
  {
    title: 'Vancura position',
    category: ENDGAMES,
    level: 'advanced',
    signs: ['Rook and a-pawn (or h-pawn) against rook', 'The attacking rook in front of its pawn', 'Your rook able to attack the pawn from the side'],
    body: md(
      'The drawing method against a rook’s pawn on the sixth with the rook in front of it: the defending rook attacks the pawn from the side, along the sixth rank, so the attacking rook is tied to it, and gives checks from behind when the king approaches. Named after Josef Vančura (1924).',
    ),
    related: ['Philidor position', 'Active rook'],
  },
  {
    title: 'Rook behind the passed pawn',
    aliases: ['Tarrasch rule'],
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['A passed pawn in a rook ending', 'A rook in front of or beside a passed pawn'],
    body: md(
      'Rooks belong behind passed pawns — your own and the opponent’s (the Tarrasch rule). Behind your pawn, the rook’s range grows as the pawn advances; behind the enemy pawn, it holds it back with growing activity, while a rook in front of a pawn is reduced to a passive blocker.',
    ),
    related: ['Active rook', 'Passed pawn'],
  },
  {
    title: 'Active rook',
    aliases: ['Rook activity'],
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['A rook ending', 'A rook tied to defending a pawn'],
    body: md(
      'In rook endings, activity outweighs material: an active rook is often worth more than a pawn. Rather than defending passively, give up a weak pawn to get your rook attacking pawns or checking the king.',
    ),
    related: ['Rook behind the passed pawn', 'Seventh rank', 'Lucena position'],
  },
  {
    title: 'Short side defence',
    aliases: ['Long side and short side'],
    category: ENDGAMES,
    level: 'advanced',
    signs: ['Rook and pawn against rook', 'The defending king driven to one side of the pawn'],
    body: md(
      'When the defending king is pushed off the pawn’s file, it should go to the **short side** (the side with fewer files to the edge) and leave the **long side** to its rook, which then checks the enemy king from far away — with at least three files between rook and pawn, the checks cannot be stopped.',
    ),
    related: ['Philidor position', 'Active rook'],
  },
  {
    title: 'Wrong-coloured bishop',
    aliases: ['Wrong rook pawn'],
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['Bishop and rook pawn against a lone king', 'The promotion square of the other colour from the bishop'],
    body: md(
      'Bishop and a rook pawn cannot win if the bishop does not control the promotion corner: the defending king sits in the corner and cannot be driven out. Before trading into such an ending, check the colour of the corner.',
    ),
    related: ['Fortress', 'Stalemate trick'],
  },
  {
    title: 'Fortress',
    category: ENDGAMES,
    level: 'advanced',
    signs: ['Material down but a position with no entry points', 'Opposite-coloured bishops, a wrong rook pawn'],
    body: md(
      'A defensive set-up the stronger side cannot break, however much more material it has. Fortresses save many lost endgames: opposite-coloured bishops, the wrong rook pawn, a rook holding against a queen behind a protected pawn.',
      'When defending a bad ending, look for a fortress before it is too late to build one.',
    ),
    related: ['Opposite-coloured bishops', 'Wrong-coloured bishop', 'Perpetual check'],
  },
  {
    title: 'King activity',
    aliases: ['Active king'],
    category: ENDGAMES,
    level: 'basic',
    signs: ['Queens off the board', 'Your king still behind its pawns'],
    body: md(
      'In the endgame the king becomes a strong fighting piece: bring it to the centre and towards the pawns as soon as the queens are off. The side whose king is more active usually wins king-and-pawn endings.',
    ),
    related: ['Centralization', 'Opposition', 'Outside passed pawn'],
  },
  {
    title: 'Breakthrough',
    aliases: ['Pawn breakthrough'],
    category: ENDGAMES,
    level: 'advanced',
    signs: ['Pawns facing each other on the same wing', 'Enemy king far away'],
    body: md(
      'A pawn sacrifice that creates a passed pawn out of a group of blocked pawns. With three pawns against three, the middle pawn goes first; whichever way it is taken, the next sacrifice opens the way:',
      '7k/ppp5/8/PPP5/8/8/8/7K w - - 0 1',
      line('1. b6 axb6 2. c6 bxc6 3. a6'),
      'If the c-pawn takes the first sacrifice instead, the a-pawn goes next and the c-pawn runs through.',
    ),
    related: ['Passed pawn', 'Connected passed pawns'],
  },
  {
    title: 'Réti manoeuvre',
    category: ENDGAMES,
    level: 'advanced',
    signs: ['A king outside the square of an enemy pawn', 'Your own pawn that could still use the king’s help'],
    body: md(
      'A king can chase two goals at once along a diagonal — catching an enemy pawn and supporting its own — since a diagonal route is as fast as a straight one. In Réti’s study (1921) the king seems hopelessly behind the h-pawn, yet draws:',
      '7K/8/k1P5/7p/8/8/8/8 w - - 0 1',
      line('1. Kg7 h4 2. Kf6 Kb6 3. Ke5 Kxc6 4. Kf4'),
      'If Black runs the pawn instead, the white king reaches d6 or d7 in time to support its own pawn’s promotion.',
    ),
    related: ['Rule of the square', 'King activity'],
  },
  {
    title: 'Queen against pawn on the seventh',
    category: ENDGAMES,
    level: 'advanced',
    signs: ['King and queen against king and pawn on the seventh (second) rank'],
    body: md(
      'The queen wins against a centre or knight pawn: with checks and pins it forces the king in front of the pawn, and each time it does, its own king steps closer. Against a bishop or rook pawn it is usually a draw, because the defending king can go into the corner and stalemate is the answer to taking the pawn — unless the winning king is already close.',
    ),
    related: ['Stalemate trick', 'Queen and king mate'],
  },
  {
    title: 'Queen and king mate',
    category: ENDGAMES,
    level: 'basic',
    signs: ['King and queen against a lone king'],
    body: md(
      'Restrict the king with the queen — a knight’s move away from it works well — until it is on the edge, then bring your own king up and mate. The danger is stalemate: once the king is on the edge, stop moving the queen closer and use the king.',
      'In the diagram, the final picture: the king has been driven to the corner, and the queen mates with the king\'s help.',
      '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
      line('1. Qf8#'),
    ),
    related: ['Rook and king mate', 'Ladder mate', 'Stalemate trick'],
  },
  {
    title: 'Rook and king mate',
    category: ENDGAMES,
    level: 'basic',
    signs: ['King and rook against a lone king'],
    body: md(
      'The rook cuts the king off in a box, the box shrinks one line at a time, and your king supports it, taking the opposition so the rook can check. Mate comes on the edge, with your king facing the enemy king and the rook checking along the edge.',
      'In the diagram, the final picture: the white king takes away the squares in front of the cornered king, and the rook mates along the edge.',
      '7k/8/6K1/8/8/8/8/R7 w - - 0 1',
      line('1. Ra8#'),
    ),
    related: ['Queen and king mate', 'Opposition', 'Ladder mate'],
  },
  {
    title: 'Two bishops mate',
    category: ENDGAMES,
    level: 'intermediate',
    signs: ['King and two bishops against a lone king'],
    body: md(
      'Two bishops side by side form a wall the king cannot cross. Use them and the king to push the defending king to the edge and then into a corner, where the bishops mate. It takes care to avoid stalemate, but always wins.',
    ),
    related: ['Bishop pair', 'Bishop and knight mate'],
  },
  {
    title: 'Bishop and knight mate',
    aliases: ['W manoeuvre', 'Delétang’s triangles'],
    category: ENDGAMES,
    level: 'advanced',
    signs: ['King, bishop and knight against a lone king'],
    body: md(
      'The hardest basic mate: it can only be forced in a corner of the bishop’s colour. Drive the king to the edge, then from the wrong corner to the right one, using the knight’s **W manoeuvre** to keep the king from escaping. It takes up to 33 moves with best play — within the 50-move rule only if you know the method.',
    ),
    related: ['Two bishops mate', 'Queen and king mate'],
  },
];
