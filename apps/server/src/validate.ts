import { z } from 'zod';
import { CONCEPT_LINK_TARGETS } from '../db/schema.ts';

/**
 * What each write route accepts. A body is read through its schema: fields the route does not know
 * are dropped, so only known fields ever reach the database, and a body that does not fit is answered
 * with 400 and a sentence saying which field is wrong, never with a server error.
 */

export class BadRequest extends Error {
  readonly statusCode = 400;
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  throw new BadRequest(sentenceFor(result.error.issues[0]!));
}

/** Fields whose name alone would not say what they are. */
const FIELD_WORDS: Record<string, string> = { max: 'number of games', pgn: 'PGN', fen: 'FEN', bodyMd: 'text', notesMd: 'notes', sans: 'moves', ids: 'items' };

/** A field as the person knows it: "the name", "the number of games"; one item of a list: "a tag". */
function fieldWords(path: PropertyKey[]): { the: string; one: string; words: string } {
  const key = [...path].reverse().find((p): p is string => typeof p === 'string');
  if (!key) return { the: 'the request', one: 'an item', words: 'items' };
  const words = FIELD_WORDS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const single = words.endsWith('s') && !words.endsWith('ss') ? words.slice(0, -1) : words;
  return { the: `the ${words}`, one: `${/^[aeiou]/i.test(single) ? 'an' : 'a'} ${single}`, words };
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A sentence for what was wrong with a body: "The name is too long: at most 200 characters." */
export function sentenceFor(issue: z.core.$ZodIssue): string {
  // A schema's own message is a sentence already ("A concept needs a title.").
  if (!/^(Too (big|small)|Invalid)/.test(issue.message)) return issue.message;
  const { the, one, words } = fieldWords(issue.path);
  const inList = typeof issue.path.at(-1) === 'number';
  const subject = capital(inList ? one : the);
  const be = !inList && the.endsWith('s') && !the.endsWith('ss') ? 'are' : 'is';
  if (issue.code === 'too_big') {
    if (issue.origin === 'string') return `${subject} ${be} too long: at most ${issue.maximum} characters.`;
    if (issue.origin === 'array') return `Too many ${words}: at most ${issue.maximum}.`;
    return `${subject} can be at most ${issue.maximum}.`;
  }
  if (issue.code === 'too_small') {
    if (issue.origin === 'string') return `${subject} cannot be empty.`;
    if (issue.origin === 'array') return `${subject} needs at least ${issue.minimum}.`;
    return `${subject} must be at least ${issue.minimum}.`;
  }
  if (issue.code === 'invalid_type' && (issue.expected === 'int' || issue.expected === 'number')) {
    return `${subject} must be a${issue.expected === 'int' ? ' whole' : ''} number.`;
  }
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return `${where}${issue.message}`;
}

const id = z.string().min(1).max(64);
const ids = z.array(id).max(100_000);
const fen = z.string().min(1).max(200);
const color = z.enum(['white', 'black']);
const tags = z.array(z.string().max(100)).max(200);
const longText = z.string().max(200_000);
const optionalText = (max: number) => z.string().max(max).nullable().optional();

const savedPosition = z.object({
  fen,
  title: z.string().max(300),
  notesMd: optionalText(200_000),
  category: optionalText(40),
  keyIdea: optionalText(10_000),
  answer: optionalText(1000),
  sideToSolve: color.optional(),
  difficulty: z.number().int().min(1).max(5).nullable().optional(),
  inTraining: z.boolean().optional(),
  sourceGameId: id.nullable().optional(),
  sourcePly: z.number().int().min(0).nullable().optional(),
  sourceLabel: optionalText(500),
  tags: tags.optional(),
  setIds: ids.optional(),
});

const concept = z.object({
  title: z.string().trim().min(1, 'A concept needs a title.').max(200),
  aliases: z.array(z.string().max(200)).max(100).optional(),
  category: z.string().max(200).nullable().optional(),
  bodyMd: longText.nullable().optional(),
  keySigns: z.array(z.string().max(1000)).max(100).optional(),
  tags: tags.optional(),
});

const username = z.string().trim().max(60);

export const bodies = {
  // Games and collections
  pgn: z.object({ pgn: z.string().min(1, 'The PGN is empty.') }),
  gameUpdate: z.object({
    pgn: z.string().min(1).optional(),
    notes: longText.nullable().optional(),
    tags: tags.optional(),
    myColor: color.nullable().optional(),
  }),
  pgnImport: z.object({ pgn: z.string().min(1, 'The PGN is empty.'), collectionId: id.optional() }),
  accountImport: z.object({
    username: username.min(1, 'Give a username.'),
    max: z.number().int().min(1).max(5000).optional(),
    collectionId: id.optional(),
    mine: z.boolean().optional(),
  }),
  ids: z.object({ ids }),
  gameIds: z.object({ gameIds: ids }),
  collectionPlaces: z.object({ places: z.array(z.object({ gameId: id, sortOrder: z.number().int() })).max(100_000) }),
  named: z.object({ name: z.string().max(200), description: z.string().max(10_000).optional() }),
  namedUpdate: z.object({ name: z.string().max(200).optional(), description: z.string().max(10_000).optional() }),
  name: z.object({ name: z.string().max(200) }),

  // Saved positions, settings, trash
  savedPosition,
  savedPositionUpdate: savedPosition.omit({ fen: true }).partial(),
  settings: z.object({
    lichessUsername: username.nullable().optional(),
    chesscomUsername: username.nullable().optional(),
    rating: z.number().int().min(100).max(3500).nullable().optional(),
    enginePath: z.string().max(1000).nullable().optional(),
    coachQuickModel: z.string().max(100).nullable().optional(),
    coachDeepModel: z.string().max(100).nullable().optional(),
  }),
  restore: z
    .object({ kind: z.enum(['game', 'saved_position', 'position_set', 'collection', 'repertoire', 'concept']), id: id.optional(), ids: ids.optional() })
    .refine((b) => b.id || b.ids, 'Say what to restore: id or ids.'),

  // Concepts
  concept,
  conceptUpdate: concept.partial(),
  conceptLink: z.object({ targetType: z.enum(CONCEPT_LINK_TARGETS), targetId: id.optional(), fen: fen.optional() }),
  conceptUnlink: z.object({ targetType: z.enum(CONCEPT_LINK_TARGETS), targetId: id }),

  // Repertoires
  repertoire: z.object({ name: z.string().max(200), color }),
  line: z.object({ fen: fen.optional(), sans: z.array(z.string().min(1).max(20)).max(1000) }),
  repertoireMove: z.object({
    isMain: z.boolean().optional(),
    priority: z.enum(['must', 'nice']).optional(),
    comment: longText.nullable().optional(),
    nags: z.array(z.number().int().min(1).max(255)).max(20).optional(),
  }),
  gameCheck: z.object({ pgn: z.string().min(1), color: color.optional() }),

  // Engine, training, coach
  evaluate: z.object({ fen, depth: z.number().int().min(1).max(30).optional(), multipv: z.number().int().min(1).max(5).optional() }),
  engineTest: z.object({ path: z.string().max(1000) }),
  review: z.object({ cardId: id, rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), correct: z.boolean() }),
  check: z.object({
    fen,
    uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/, 'A move is written like e2e4.'),
    answer: z.string().max(1000).nullable().optional(),
  }),
  coachKey: z.object({ apiKey: z.string().max(500) }),
  lichessToken: z.object({ token: z.string().max(200) }),
  coachReview: z.object({ startFen: fen, moves: z.array(z.string().max(20)).max(1000), myColor: color.optional() }),
};
