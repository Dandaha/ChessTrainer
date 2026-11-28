import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Server-sent events over a POST response, for work that reports as it goes (the coach's answer, an
 * import's progress). The response's own "close" tells when the browser has gone (the request's fires
 * as soon as the body is read); `signal` is then aborted.
 */
export async function streamEvents<E extends { type: string }>(
  reply: FastifyReply,
  run: (emit: (event: E) => void, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const left = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) left.abort();
  });
  const emit = (event: E | { type: 'error'; error: string }) => {
    if (!left.signal.aborted && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    await run(emit, left.signal);
  } catch (error) {
    emit({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
  res.end();
}

/** Whether the browser asked for events rather than one JSON answer. */
export function wantsEvents(req: FastifyRequest): boolean {
  return String(req.headers.accept ?? '').includes('text/event-stream');
}
