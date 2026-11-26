import { CHESS_TOOLS, type ToolContext, runTool } from '@chess/chess-tools';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Rules for the model, sent with the server's description. */
export const INSTRUCTIONS = `Chess tools for the user's own workspace: Stockfish analysis, computed position facts, and their concepts library, repertoire and game library.
Rules:
- Never state an evaluation, a best move or a tactic without a tool result that supports it. Call evaluate, compare_moves, play_line or find_threats first.
- Translate engine numbers into ideas: say why a line works (which piece lands where, what falls), not just "+1.8".
- When the engine's best move is a deep computer move, say so, and give a practical human alternative if one is within about 0.3 pawns.
- Cite the user's concepts (search_concepts) and repertoire (get_repertoire) by name when they apply.
- Scores are from White's point of view.`;

/**
 * The MCP server: the chess tools and nothing else. It reads the chess
 * database and runs Stockfish; it has no file or shell access. Opening
 * statistics (an online call to Lichess) are left out on purpose.
 */
export function createChessMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'chess-workspace', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  for (const tool of CHESS_TOOLS) {
    if (tool.name === 'opening_stats') continue;
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.shape }, async (input: unknown) => {
      const result = await runTool(tool.name, input, ctx);
      const isError = typeof result === 'object' && result !== null && 'error' in result;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError };
    });
  }
  return server;
}
