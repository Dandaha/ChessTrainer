import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { type ImportEvent, importGamesInBatches, listGames } from '../db/games.ts';
import { fetchLichessGames } from '../src/importers.ts';
import { buildApp } from '../src/app.ts';

/** A large import comes in batches and leaves the app answering in the meantime. */

const LINE =
  '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 ' +
  '11. c4 c6 12. cxb5 axb5 13. Nc3 Bb7 14. Bg5 b4 15. Nb1 h6 16. Bh4 c5 17. dxe5 Nxe4 18. Bxe7 Qxe7 19. exd6 Qf6 20. Nbd2 Nxd6 *';

function manyGames(n: number): string {
  return Array.from({ length: n }, (_, i) => `[Event "Club"]\n[Round "${i + 1}"]\n[White "A${i}"]\n[Black "B${i}"]\n\n${LINE}\n`).join('\n');
}

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('a large import', () => {
  it('imports everything, with broken games reported in order', async () => {
    const db = freshDb();
    const text = `${manyGames(300)}\n[Event "Bad"]\n\n1. e4 e5 2. Ke3 *\n\n${manyGames(2)}`;
    const report = await importGamesInBatches(db, text, { source: 'file' });
    // The two games after the broken one repeat the first two.
    expect(report).toMatchObject({ imported: 300, duplicates: 2, variants: 0 });
    expect(report.errors.map((e) => e.gameIndex)).toEqual([300]);
    expect(listGames(db).total).toBe(300);
  });

  it('lets other requests through while it runs', async () => {
    const db = freshDb();
    const app = buildApp(db);
    let finished = false;
    const importing = app
      .inject({ method: 'POST', url: '/api/games/import', payload: { pgn: manyGames(1500) } })
      .then((response) => {
        finished = true;
        return response.json();
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(finished).toBe(false);
    expect((await importing).imported).toBe(1500);
    await app.close();
  }, 120_000);

  it('streams its progress to a browser that asks for events, then the report', async () => {
    const app = buildApp(freshDb());
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${url}/api/games/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ pgn: manyGames(400) }),
    });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const events = (await response.text())
      .split('\n\n')
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.replace(/^data: /, '')) as ImportEvent);
    const progress = events.filter((e) => e.type === 'progress');
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.every((e) => e.phase === 'importing' && e.expected === 400)).toBe(true);
    const counts = progress.map((e) => e.games);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts.at(-1)).toBe(400);
    expect(events.at(-1)).toMatchObject({ type: 'done', report: { imported: 400 } });
    await app.close();
  }, 120_000);
});

describe('downloading from Lichess', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('counts the games as they arrive, even when a tag is split between two pieces', async () => {
    const text = manyGames(3);
    const cut = text.indexOf('[Event', 10) + 3;
    const pieces = [text.slice(0, cut), text.slice(cut)];
    vi.stubGlobal('fetch', async () => {
      const body = new ReadableStream({
        start(controller) {
          for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const seen: number[] = [];
    const pgn = await fetchLichessGames('someone', 3, undefined, (n) => seen.push(n));
    expect(pgn).toBe(text);
    expect(seen).toEqual([1, 3]);
  });
});
