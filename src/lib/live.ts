import { Chess } from 'chess.js';
import type { Score } from './types';
import { scoreToWin } from './winpct';
import { describeMove } from './narrate';

export interface LiveLine {
  uci: string;
  san: string;
  plain: string;
  score: Score;
  win: number;
  pv: string[];
}
export interface LiveOptions {
  multipv?: number;
  onUpdate: (lines: LiveLine[], depth: number) => void;
}

/** Independent session for consumers needing a simultaneous hypothetical search. */
export function createLiveSession() {
  let previous: (() => void) | undefined;
  return (fen: string, { multipv = 3, onUpdate }: LiveOptions): (() => void) => {
    previous?.();
    const chess = new Chess(fen);
    if (typeof Worker === 'undefined' || chess.isGameOver()) return () => {};
    let worker: Worker;
    try { worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`); }
    catch { return () => {}; }
    let stopped = false;
    let searching = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lines = new Map<number, { line: LiveLine; depth: number }>();
    const count = Math.max(1, Math.floor(multipv) || 3);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      worker.postMessage('stop');
      worker.terminate();
    };
    previous = stop;
    worker.onerror = stop;
    worker.onmessage = (event) => {
      if (stopped) return;
      for (const text of String(event.data).split(/\r?\n/)) {
        if (text === 'uciok') {
          worker.postMessage('setoption name Hash value 16');
          worker.postMessage(`setoption name MultiPV value ${count}`);
          worker.postMessage('isready');
        } else if (text === 'readyok' && !searching) {
          searching = true;
          worker.postMessage('stop');
          worker.postMessage(`position fen ${fen}`);
          worker.postMessage('go infinite');
        } else if (searching && text.startsWith('info ') && !/\b(?:lowerbound|upperbound)\b/.test(text)) {
          const depth = Number(text.match(/\bdepth (\d+)/)?.[1]);
          const rank = Number(text.match(/\bmultipv (\d+)/)?.[1] ?? 1);
          const scoreMatch = text.match(/\bscore (cp|mate) (-?\d+)/);
          const pv = text.match(/\bpv (.+)$/)?.[1].trim().split(/\s+/);
          if (!scoreMatch || !pv?.length || !Number.isFinite(depth) || rank < 1 || rank > count) continue;
          if (depth < (lines.get(rank)?.depth ?? 0)) continue;
          try {
            const move = new Chess(fen).move(pv[0]);
            const value = Number(scoreMatch[2]) * (chess.turn() === 'w' ? 1 : -1);
            const score: Score = scoreMatch[1] === 'mate' ? { mate: value } : { cp: value };
            lines.set(rank, { depth, line: { uci: pv[0], san: move.san,
              plain: describeMove(fen, pv[0]), score, win: scoreToWin(score, chess.turn()), pv } });
            // Coalesce bursts without starving updates during an infinite search.
            timer ??= setTimeout(() => {
              timer = undefined;
              if (stopped) return;
              const ordered = [...lines.entries()].sort(([a], [b]) => a - b);
              onUpdate(ordered.map(([, item]) => item.line), lines.get(1)?.depth ?? depth);
            }, 100);
          } catch { /* Ignore malformed or illegal engine PVs. */ }
        }
      }
    };
    worker.postMessage('uci');
    return stop;
  };
}

/** The board's dedicated live worker never uses the batch engine pool. */
export const startLive = createLiveSession();
