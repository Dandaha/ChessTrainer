import { existsSync } from 'node:fs';
import { openDatabase, runMigrations } from '@chess/server/db/client.ts';
import { createConcept } from '@chess/server/db/concepts.ts';
import { EngineService } from '@chess/server/src/engineService.ts';
import { updateSettings } from '@chess/server/db/library.ts';
import { chessData } from '@chess/server/src/toolData.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createChessMcpServer } from '../src/server.ts';

const STOCKFISH = process.env.STOCKFISH_PATH ?? '/usr/games/stockfish';
let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});

async function connect() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  const engines = new EngineService(db);
  const data = chessData(db);
  delete data.openingStats;
  const server = createChessMcpServer({ analyse: (fen, o) => engines.evaluate(fen, o), data });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  cleanup.push(async () => {
    await client.close();
    await engines.shutdown();
  });
  return { db, client };
}

function json(result: unknown) {
  return JSON.parse((result as { content: { text: string }[] }).content[0]!.text);
}

describe('the MCP server', () => {
  it('offers the chess tools and only those', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'evaluate',
      'compare_moves',
      'play_line',
      'position_facts',
      'find_threats',
      'search_concepts',
      'get_repertoire',
      'search_games',
    ]);
    expect(client.getInstructions()).toContain('Never state an evaluation');
  });

  it('answers from the chess database and computed facts', async () => {
    const { db, client } = await connect();
    createConcept(db, { title: 'Back rank mate', bodyMd: 'The king is boxed in by its own pawns.' });
    expect(json(await client.callTool({ name: 'search_concepts', arguments: { query: 'back rank' } }))[0].title).toBe('Back rank mate');
    const facts = json(await client.callTool({ name: 'position_facts', arguments: { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1' } }));
    expect(facts.checksAvailable).toEqual(['Rd8#']);
  });

  it('reports bad input as a tool error', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: 'position_facts', arguments: { fen: 'nonsense' } });
    expect(result.isError).toBe(true);
  });

  it.skipIf(!existsSync(STOCKFISH))('runs Stockfish for evaluate', async () => {
    const { db, client } = await connect();
    updateSettings(db, { enginePath: STOCKFISH });
    const result = json(await client.callTool({ name: 'evaluate', arguments: { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', multipv: 1 } }));
    expect(result.lines[0]).toMatchObject({ score: '#1', moves: 'Rd8#' });
  }, 30_000);
});
