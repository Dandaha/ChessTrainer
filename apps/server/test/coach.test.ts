import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Analysis } from '@chess/chess-tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CoachEvent, type StreamingClient, SYSTEM_PROMPT, reviewGame, runCoach } from '../coach/coach.ts';
import { openDatabase, runMigrations } from '../db/client.ts';
import { coachMessages } from '../db/schema.ts';
import { buildApp } from '../src/app.ts';
import { chessData } from '../src/toolData.ts';

const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

type Block = Record<string, unknown>;

/** A stand-in for the Claude API: plays back scripted replies and records each request. */
function scripted(replies: { content: Block[]; stop_reason: string }[]) {
  const requests: Record<string, unknown>[] = [];
  const client: StreamingClient = {
    stream(params) {
      requests.push(JSON.parse(JSON.stringify(params)));
      const reply = replies[requests.length - 1]!;
      const listeners: ((d: string) => void)[] = [];
      return {
        on(_event, listener) {
          listeners.push(listener);
          return this;
        },
        async finalMessage() {
          for (const b of reply.content) if (b.type === 'text') for (const l of listeners) l(String(b.text));
          return {
            id: `msg_${requests.length}`,
            type: 'message',
            role: 'assistant',
            model: String(params.model),
            content: reply.content,
            stop_reason: reply.stop_reason,
            usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 },
          } as never;
        },
      };
    },
  };
  return { client, requests };
}

const mate: Analysis = { fen: BACK_RANK, engine: 'Stockfish 17', depth: 18, lines: [{ multipv: 1, depth: 18, mate: 1, pv: ['d1d8'], san: ['Rd8#'] }] };

describe('the coach loop', () => {
  it('calls the tools, draws on the board, streams the answer and logs the tokens', async () => {
    const db = freshDb();
    const { client, requests } = scripted([
      { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 't1', name: 'evaluate', input: { fen: BACK_RANK } }] },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't2',
            name: 'show_on_board',
            input: { arrows: [{ from: 'd1', to: 'd8', color: 'green' }], lines: [{ label: 'Mate', moves: ['Rd8#', 'Kh7'] }] },
          },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Rd8# mates: the pawns on f7, g7 and h7 box the king in.' }] },
    ]);
    const events: CoachEvent[] = [];
    const analysed: string[] = [];
    await runCoach(
      { db, client, tools: { analyse: async (fen) => (analysed.push(fen), mate), data: chessData(db) } },
      { mode: 'ask', fen: BACK_RANK, startFen: BACK_RANK, moves: [], question: 'What should White play?' },
      (e) => events.push(e),
    );

    expect(analysed).toEqual([BACK_RANK]);
    expect(events.filter((e) => e.type === 'status')).toEqual([{ type: 'status', text: 'Asking Stockfish for the best lines…' }]);
    const annotations = events.find((e) => e.type === 'annotations');
    // Kh7 is not legal after the mate, so the line stops at Rd8#.
    expect(annotations).toMatchObject({ annotations: { arrows: [{ from: 'd1', to: 'd8' }], lines: [{ label: 'Mate', moves: ['Rd8#'] }] } });
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
    expect(text).toBe('Let me check.\n\nRd8# mates: the pawns on f7, g7 and h7 box the king in.');
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: 'done', model: 'claude-haiku-5-5', usage: { input: 3000, output: 600, cacheRead: 9000 } });

    // The tool result went back to the model as JSON from Stockfish.
    const second = requests[1] as { messages: { role: string; content: Block[] }[] };
    const result = second.messages[2]!.content[0]!;
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(JSON.parse(String(result.content)).lines[0]).toMatchObject({ score: '#1', moves: 'Rd8#' });

    // The context packet carries the position and the rating line.
    const first = requests[0] as { messages: { content: string }[]; system: Block[]; tools: Block[]; cache_control?: unknown };
    expect(first.messages[0]!.content).toContain(`Position (FEN): ${BACK_RANK}`);
    expect(first.messages[0]!.content).toContain('Question: What should White play?');
    expect(first.system[0]).toMatchObject({ text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } });
    expect(first.cache_control).toEqual({ type: 'ephemeral' });
    expect(first.tools.map((t) => t.name)).toContain('compare_moves');
    expect(first.tools.every((t) => t.eager_input_streaming === true)).toBe(true);
    expect(first.tools.some((t) => t.name === 'opening_stats')).toBe(false); // no Lichess token here

    // Both sides of the exchange are kept, with the tokens.
    const rows = db.select().from(coachMessages).all();
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(rows[1]).toMatchObject({ model: 'claude-haiku-5-5', inputTokens: 3000, outputTokens: 600, cacheReadTokens: 9000 });
  });

  it('keeps the system prompt rule about evaluations', () => {
    expect(SYSTEM_PROMPT).toContain('Never state an evaluation, a best move, a tactic');
  });

  it('uses the deeper model with fallbacks for plans, and Haiku without them for quick questions', async () => {
    const db = freshDb();
    const plan = scripted([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Plan.' }] }]);
    await runCoach({ db, client: plan.client, tools: { analyse: async () => mate } }, { mode: 'plan', fen: START, startFen: START, moves: [] }, () => {});
    expect(plan.requests[0]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], output_config: { effort: 'medium' } });

    const quick = scripted([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Quick.' }] }]);
    await runCoach({ db, client: quick.client, tools: { analyse: async () => mate } }, { mode: 'explain_move', fen: START, startFen: START, moves: [] }, () => {});
    expect(quick.requests[0]!.model).toBe('claude-haiku-5-5');
    expect(quick.requests[0]!.fallbacks).toBeUndefined();
  });

  it('stops on a refusal without running tools', async () => {
    const db = freshDb();
    const { client } = scripted([{ stop_reason: 'refusal', content: [] }]);
    const events: CoachEvent[] = [];
    await runCoach({ db, client, tools: { analyse: async () => mate } }, { mode: 'ask', fen: START, startFen: START, moves: [], question: 'x' }, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: 'error', error: expect.stringContaining('declined') });
  });

  it('collects tag suggestions for a position', async () => {
    const db = freshDb();
    const { client } = scripted([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 's', name: 'suggest_tags', input: { concepts: ['Back rank mate'], newConcepts: [], tags: ['mate in 1'] } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A classic back rank.' }] },
    ]);
    const events: CoachEvent[] = [];
    await runCoach({ db, client, tools: { analyse: async () => mate } }, { mode: 'tag_position', fen: BACK_RANK, startFen: BACK_RANK, moves: [] }, (e) => events.push(e));
    expect(events.find((e) => e.type === 'suggestions')).toMatchObject({ suggestions: { concepts: ['Back rank mate'], tags: ['mate in 1'] } });
  });
});

describe('game review', () => {
  it('finds the biggest drops with the engine and asks the coach about them', async () => {
    const db = freshDb();
    // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#: the drop is 3...Nf6.
    const moves = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
    const scores = [0.3, 0.3, 0.3, 0.1, 0.2, 0.2, null, null];
    let i = 0;
    const analyse = async (fen: string): Promise<Analysis> => {
      const n = i++;
      if (n === 6) return { fen, engine: 'SF', depth: 12, lines: [{ multipv: 1, depth: 12, mate: 1, pv: ['h5f7'], san: ['Qxf7#'] }] };
      if (n === 7) return { fen, engine: 'SF', depth: 12, lines: [] };
      return { fen, engine: 'SF', depth: 12, lines: [{ multipv: 1, depth: 12, cp: (scores[n] ?? 0) * 100, pv: ['g7g6'], san: [n === 5 ? 'g6' : 'Nf3'] }] };
    };
    const { client, requests } = scripted([{ stop_reason: 'end_turn', content: [{ type: 'text', text: '3...Nf6?? allows Qxf7#.' }] }]);
    const events: CoachEvent[] = [];
    await reviewGame({ db, client, tools: { analyse } }, { startFen: START, moves }, (e) => events.push(e));
    const moments = events.find((e) => e.type === 'moments') as { moments: { move: string; best: string }[] };
    expect(moments.moments.map((m) => m.move)).toEqual(['3...Nf6']);
    expect(moments.moments[0]!.best).toBe('3...g6');
    expect((requests[0] as { model: string }).model).toBe('claude-sonnet-5-5');
    expect(JSON.stringify(requests[0])).toContain('3...Nf6: score +0.20 before, winning for White (mate) after');
  });
});

describe('the coach API', () => {
  let envFile: string;
  beforeEach(() => {
    envFile = join(mkdtempSync(join(tmpdir(), 'coach-')), '.env');
    process.env.CHESS_ENV_FILE = envFile;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    delete process.env.CHESS_ENV_FILE;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('is off without a key and says how to connect it', async () => {
    const app = buildApp(freshDb());
    const status = (await app.inject({ method: 'GET', url: '/api/coach/status' })).json();
    expect(status).toMatchObject({ connected: false, message: 'Coach not connected - add an API key in Settings' });
    const ask = await app.inject({ method: 'POST', url: '/api/coach/ask', payload: { mode: 'ask', fen: START, startFen: START, moves: [] } });
    expect(ask.statusCode).toBe(409);
    await app.close();
  });

  it('stores the key in .env only, never sends it back, and streams answers', async () => {
    const { client } = scripted([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Develop your pieces.' }] }]);
    const app = buildApp(freshDb(), undefined, () => client);
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    expect((await app.inject({ method: 'PUT', url: '/api/coach/key', payload: { apiKey: 'nope' } })).statusCode).toBe(400);
    const set = await app.inject({ method: 'PUT', url: '/api/coach/key', payload: { apiKey: key } });
    expect(set.body).not.toContain(key);
    expect(readFileSync(envFile, 'utf8')).toBe(`ANTHROPIC_API_KEY=${key}\n`);
    const status = await app.inject({ method: 'GET', url: '/api/coach/status' });
    expect(status.body).not.toContain(key);
    expect(status.json().connected).toBe(true);

    const ask = await app.inject({ method: 'POST', url: '/api/coach/ask', payload: { mode: 'ask', fen: START, startFen: START, moves: [], question: 'Plan?' } });
    const events = ask.body
      .split('\n\n')
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.replace(/^data: /, '')));
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
    const history = (await app.inject({ method: 'GET', url: `/api/coach/history?fen=${encodeURIComponent(START)}` })).json();
    expect(history.map((h: { role: string; content: string }) => [h.role, h.content])).toEqual([
      ['user', 'Plan?'],
      ['assistant', 'Develop your pieces.'],
    ]);
    const month = (await app.inject({ method: 'GET', url: '/api/coach/status' })).json().month;
    expect(month[0]).toMatchObject({ model: 'claude-haiku-5-5', answers: 1, output: 200 });

    await app.inject({ method: 'DELETE', url: '/api/coach/key' });
    expect(readFileSync(envFile, 'utf8')).toBe('\n');
    expect((await app.inject({ method: 'GET', url: '/api/coach/status' })).json().connected).toBe(false);
    await app.close();
  });
});
