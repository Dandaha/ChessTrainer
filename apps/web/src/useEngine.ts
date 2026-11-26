import { useEffect, useState } from 'react';
import { type Analysis, api } from './api.ts';

export interface EngineState {
  analysis: Analysis | null;
  /** 'running' while it searches, 'done' at full depth, 'error' with a reason. */
  status: 'off' | 'starting' | 'running' | 'done' | 'error';
  error: string | null;
}

/**
 * Live Stockfish lines for a position while `enabled`. The stream closes when
 * the panel is turned off, the position changes or the screen goes away, and
 * the server then stops the search.
 */
export function useEngine(fen: string, enabled: boolean, multipv = 3): EngineState {
  const [state, setState] = useState<EngineState>({ analysis: null, status: 'off', error: null });

  useEffect(() => {
    if (!enabled) {
      setState({ analysis: null, status: 'off', error: null });
      return;
    }
    if (typeof EventSource === 'undefined') {
      setState({ analysis: null, status: 'error', error: 'This browser cannot stream engine lines.' });
      return;
    }
    setState((s) => ({ analysis: s.analysis?.fen === fen ? s.analysis : null, status: 'starting', error: null }));
    const source = new EventSource(api.engineStreamUrl(fen, multipv));
    source.addEventListener('update', (e) => {
      setState({ analysis: JSON.parse((e as MessageEvent).data) as Analysis, status: 'running', error: null });
    });
    source.addEventListener('done', (e) => {
      setState({ analysis: JSON.parse((e as MessageEvent).data) as Analysis, status: 'done', error: null });
      source.close();
    });
    source.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data;
      setState((s) => ({
        analysis: s.analysis,
        status: s.status === 'done' ? 'done' : 'error',
        error: data ? (JSON.parse(data) as { error: string }).error : s.status === 'done' ? null : 'Lost the connection to the engine.',
      }));
      source.close();
    });
    return () => source.close();
  }, [fen, enabled, multipv]);

  return state;
}
