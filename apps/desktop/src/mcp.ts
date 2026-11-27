/**
 * The MCP server inside the installed app. The Claude desktop app starts the
 * program with ELECTRON_RUN_AS_NODE=1 and this script; the database, the
 * .env and Stockfish come from the environment the config passes in
 * (Settings → Claude desktop app shows that config).
 */
import '@chess/mcp/src/index.ts';
