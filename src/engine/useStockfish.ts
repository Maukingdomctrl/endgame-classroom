import { useEffect, useRef, useState, useCallback } from 'react';

interface StockfishHook {
  ready: boolean;
  bar: number;
  cp: number | null;
  mate: number | null;
  analyze: (fen: string, depth?: number) => void;
  playMove: (fen: string, skillLevel?: number) => Promise<string | null>;
  sendCommand: (cmd: string) => void;
}

export function useStockfish(
  _fen: string,
  enabled: boolean,
  _depth: number = 16
): StockfishHook {
  const workerRef   = useRef<Worker | null>(null);
  const resolverRef = useRef<((move: string | null) => void) | null>(null);

  const [ready, setReady] = useState(false);
  const [cp,    setCp]    = useState<number | null>(null);
  const [mate,  setMate]  = useState<number | null>(null);
  const [bar,   setBar]   = useState(0);   // –5..+5 clamped, mapped to 0..1 in EvalBar

  useEffect(() => {
    if (!enabled) return;

    const worker = new Worker('/sf-worker.js');
    workerRef.current = worker;
    console.log('Worker Created');

    worker.onmessage = (e: MessageEvent) => {
      const line: string = e.data;
      console.log('[SF RAW]', line);

      if (line === 'SF_INIT_FAILED') {
        console.error('[Stockfish] Failed to initialize');
        return;
      }

      if (line.includes('uciok')) {
        console.log('[Stockfish] Ready');
        setReady(true);
        return;
      }

      // Parse eval from info lines
      if (line.startsWith('info') && line.includes('score')) {
        const cpMatch   = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);

        if (mateMatch) {
          const m = parseInt(mateMatch[1]);
          setMate(m);
          setCp(null);
          setBar(m > 0 ? 5 : -5);
        } else if (cpMatch) {
          const v = parseInt(cpMatch[1]);
          setCp(v);
          setMate(null);
          setBar(Math.max(-5, Math.min(5, v / 100)));
        }
      }

      // Capture best move for playMove()
      if (line.startsWith('bestmove') && resolverRef.current) {
        const parts = line.split(' ');
        const move  = parts[1] !== '(none)' ? parts[1] : null;
        resolverRef.current(move);
        resolverRef.current = null;
      }
    };

    worker.onerror = (err) => {
      console.error('[Stockfish Worker Error]', err);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      setReady(false);
    };
  }, [enabled]);

  const sendCommand = useCallback((cmd: string) => {
    workerRef.current?.postMessage(cmd);
  }, []);

  const analyze = useCallback((fen: string, depth = 16) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage('stop');
    workerRef.current.postMessage(`position fen ${fen}`);
    workerRef.current.postMessage(`go depth ${depth}`);
  }, []);

  const playMove = useCallback((fen: string, skillLevel = 10): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!workerRef.current) { resolve(null); return; }
      resolverRef.current = resolve;
      workerRef.current.postMessage('stop');
      workerRef.current.postMessage(`setoption name Skill Level value ${skillLevel}`);
      workerRef.current.postMessage(`position fen ${fen}`);
      workerRef.current.postMessage('go movetime 1500');
    });
  }, []);

  return { ready, bar, cp, mate, analyze, playMove, sendCommand };
}