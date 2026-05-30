import { useEffect, useRef, useState, useCallback } from 'react';

export interface StockfishHook {
  ready:       boolean;
  bar:         number;
  cp:          number | null;
  mate:        number | null;
  hintSquares: string[];
  analyze:     (fen: string, depth?: number) => void;
  playMove:    (fen: string, skillLevel?: number) => Promise<string | null>;
  getHint:     (fen: string) => Promise<string | null>;
  clearHint:   () => void;
  sendCommand: (cmd: string) => void;
}

function cpToWinPct(cp: number): number {
  const c = Math.max(-2000, Math.min(2000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-c / 328.36)) - 1);
}

function fenSide(fen: string): 'w' | 'b' {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
}

type JobKind = 'analyze' | 'move' | 'hint';
interface Job {
  kind:     JobKind;
  fen:      string;
  depth?:   number;
  skill?:   number;
  resolve?: (move: string | null) => void;
}

export function useStockfish(
  _fen:    string,
  enabled: boolean,
  _depth:  number = 16,
): StockfishHook {

  const workerRef  = useRef<Worker | null>(null);
  const busy       = useRef(false);
  const activeJob  = useRef<Job | null>(null);
  const queuedJob  = useRef<Job | null>(null);
  const currentFen = useRef('');
  const evalGot    = useRef(false);
  const bestEval   = useRef<{ cp: number | null; mate: number | null; bar: number }>({
    cp: null, mate: null, bar: 50,
  });

  const [ready,       setReady]       = useState(false);
  const [hintSquares, setHintSquares] = useState<string[]>([]);
  const [evalState,   setEvalState]   = useState<{ cp: number | null; mate: number | null; bar: number }>({
    cp: null, mate: null, bar: 50,
  });

  const executeJob = useCallback((job: Job) => {
    const w = workerRef.current;
    if (!w) { job.resolve?.(null); return; }

    activeJob.current  = job;
    currentFen.current = job.fen;
    evalGot.current    = false;
    bestEval.current   = { cp: null, mate: null, bar: 50 };
    busy.current       = true;

    if (job.kind === 'move') {
      w.postMessage(`setoption name Skill Level value ${job.skill ?? 10}`);
    }
    w.postMessage(`position fen ${job.fen}`);
    switch (job.kind) {
      case 'move':  w.postMessage('go movetime 1500'); break;
      case 'hint':  w.postMessage('go depth 12');      break;
      default:      w.postMessage(`go depth ${job.depth ?? 16}`);
    }
  }, []);

  const submitJob = useCallback((job: Job) => {
    if (busy.current) {
      queuedJob.current = job;
      workerRef.current?.postMessage('stop');
    } else {
      executeJob(job);
    }
  }, [executeJob]);

  useEffect(() => {
    if (!enabled) return;

    const worker = new Worker('/sf-worker.js');
    workerRef.current = worker;
    busy.current      = false;
    activeJob.current = null;
    queuedJob.current = null;

    const readyFallback = setTimeout(() => setReady(true), 3000);

    worker.onmessage = (e: MessageEvent) => {
      // ── DIAGNOSTIC: log every raw line from the worker ──────────────────
      const raw  = e.data;
      const line = typeof raw === 'string' ? raw : (raw instanceof ArrayBuffer ? '[ArrayBuffer]' : JSON.stringify(raw));

      console.log('[SF raw]', JSON.stringify(line));

      if (line.includes('uciok')) {
        worker.postMessage('isready');
        return;
      }
      if (line.includes('readyok')) {
        clearTimeout(readyFallback);
        setReady(true);
        return;
      }

      // ── Parse eval from info lines ──────────────────────────────────────
      if (busy.current && line.includes('score')) {
        const side  = fenSide(currentFen.current);

        // Very lenient patterns — catches any whitespace variation
        const mateM = line.match(/score\s+mate\s+([-\d]+)/);
        const cpM   = !mateM ? line.match(/score\s+cp\s+([-\d]+)/) : null;

        if (mateM) {
          const m     = parseInt(mateM[1], 10);
          const wMate = side === 'w' ? m : -m;
          console.log('[SF eval] mate raw=', mateM[1], 'side=', side, 'wMate=', wMate);
          bestEval.current = { cp: null, mate: wMate, bar: wMate > 0 ? 100 : wMate < 0 ? 0 : 50 };
          evalGot.current  = true;
        } else if (cpM) {
          const rawCp = parseInt(cpM[1], 10);
          const wCp   = side === 'w' ? rawCp : -rawCp;
          console.log('[SF eval] cp raw=', cpM[1], 'side=', side, 'wCp=', wCp, 'bar=', cpToWinPct(wCp).toFixed(1));
          bestEval.current = { cp: wCp, mate: null, bar: cpToWinPct(wCp) };
          evalGot.current  = true;
        } else {
          console.warn('[SF eval] SCORE LINE NOT PARSED:', JSON.stringify(line));
        }
      }

      if (line.startsWith('bestmove')) {
        console.log('[SF bestmove] evalGot=', evalGot.current, 'eval=', JSON.stringify(bestEval.current));
        busy.current = false;
        const job    = activeJob.current;
        activeJob.current = null;

        if (evalGot.current) {
          setEvalState({ ...bestEval.current });
        }

        if (job?.resolve) {
          const parts = line.split(' ');
          const move  = (parts[1] && parts[1] !== '(none)') ? parts[1] : null;
          job.resolve(move);
        }

        if (queuedJob.current) {
          const next        = queuedJob.current;
          queuedJob.current = null;
          executeJob(next);
        }
      }
    };

    worker.onerror = (err) => console.error('[SF Worker error]', err);

    // BUG-SF-3 Fix: Explicitly send isready now that the onmessage handler is ready to catch it
    worker.postMessage('isready');

    return () => {
      clearTimeout(readyFallback);
      worker.terminate();
      workerRef.current = null;
      busy.current      = false;
      setReady(false);
    };
  }, [enabled, executeJob]);

  const sendCommand = useCallback((cmd: string) => {
    workerRef.current?.postMessage(cmd);
  }, []);

  const analyze = useCallback((fen: string, depth = 16) => {
    console.log('[SF analyze] submitting fen=', fen, 'depth=', depth);
    submitJob({ kind: 'analyze', fen, depth });
  }, [submitJob]);

  const playMove = useCallback((fen: string, skillLevel = 10): Promise<string | null> =>
    new Promise((resolve) => {
      console.log('[SF playMove] submitting fen=', fen, 'skill=', skillLevel);
      submitJob({ kind: 'move', fen, skill: skillLevel, resolve });
    }),
  [submitJob]);

  const getHint = useCallback((fen: string): Promise<string | null> => {
    // BUG-SF-2 Fix: Clear hint squares immediately so stale hints don't show during slow SF responses
    setHintSquares([]);
    
    return new Promise((resolve) =>
      submitJob({
        kind: 'hint', fen,
        resolve: (move) => {
          if (move && move.length >= 4) {
            setHintSquares([move.slice(0, 2), move.slice(2, 4)]);
            // BUG-SF-1 Fix: 3000ms timeout removed to prevent premature hint wiping
          }
          resolve(move);
        },
      })
    );
  }, [submitJob]);

  // BUG-SF-1 Fix: Expose clearHint so parent can control when it clears
  const clearHint = useCallback(() => {
    setHintSquares([]);
  }, []);

  return {
    ready,
    bar:  evalState.bar,
    cp:   evalState.cp,
    mate: evalState.mate,
    hintSquares,
    analyze,
    playMove,
    getHint,
    clearHint,
    sendCommand,
  };
}