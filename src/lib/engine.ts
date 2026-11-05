import { Chess } from 'chess.js';
import type { PositionEval, PVLine, Score } from './types';

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;

interface Job {
  fen: string;
  depth: number;
  multipv: number;
  resolve: (e: PositionEval) => void;
  reject: (e: unknown) => void;
  onInfo?: (e: PositionEval) => void;
  workerIndex?: number;
}

/** One Stockfish 19 WASM instance speaking UCI over postMessage. */
class EngineWorker {
  private w: Worker;
  private ready: Promise<void>;
  private listener: ((line: string) => void) | null = null;
  busy = false;
  private currentMultiPv = 1;

  constructor() {
    this.w = new Worker(ENGINE_URL);
    this.w.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      this.listener?.(line);
    };
    this.ready = this.waitFor('uci', 'uciok').then(() => {
      this.send('setoption name Hash value 32');
      return this.waitFor('isready', 'readyok');
    });
  }

  private send(cmd: string) {
    this.w.postMessage(cmd);
  }

  private waitFor(cmd: string, token: string): Promise<void> {
    return new Promise((res) => {
      this.listener = (line) => {
        if (line.startsWith(token)) {
          this.listener = null;
          res();
        }
      };
      this.send(cmd);
    });
  }

  async run(job: Job) {
    this.busy = true;
    try {
      await this.ready;
      if (this.currentMultiPv !== job.multipv) {
        this.send(`setoption name MultiPV value ${job.multipv}`);
        this.currentMultiPv = job.multipv;
      }
      const blackToMove = job.fen.split(' ')[1] === 'b';
      const result = await new Promise<PositionEval>((resolve) => {
        const lines: PVLine[] = [];
        let depth = 0;
        this.listener = (line) => {
          if (line.startsWith('info') && line.includes(' pv ') && line.includes(' score ')) {
            if (line.includes('lowerbound') || line.includes('upperbound')) return;
            const t = line.split(' ');
            const d = Number(t[t.indexOf('depth') + 1]);
            const mpvIdx = t.indexOf('multipv');
            const k = mpvIdx >= 0 ? Number(t[mpvIdx + 1]) - 1 : 0;
            const si = t.indexOf('score');
            const kind = t[si + 1];
            const val = Number(t[si + 2]);
            const sign = blackToMove ? -1 : 1;
            const score: Score = kind === 'mate' ? { mate: val * sign } : { cp: val * sign };
            const pv = t.slice(t.indexOf('pv') + 1);
            if (k === 0) depth = d;
            lines[k] = { score, pv };
            if (job.onInfo && k === 0) job.onInfo({ fen: job.fen, depth, lines: lines.filter(Boolean), source: 'local' });
          } else if (line.startsWith('bestmove')) {
            this.listener = null;
            resolve({ fen: job.fen, depth, lines: lines.filter(Boolean), source: 'local' });
          }
        };
        // Keep the transposition table: consecutive positions share most of
        // their search tree. A new position command does not require newgame.
        this.send(`position fen ${job.fen}`);
        this.send(`go depth ${job.depth}`);
      });
      job.resolve(result);
    } catch (e) {
      job.reject(e);
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.send('stop');
  }

  terminate() {
    this.w.terminate();
  }
}

/** A pool of single-threaded Stockfish workers analysing positions in parallel. */
class EnginePool {
  private workers: EngineWorker[] = [];
  private queue: Job[] = [];
  private generation = 0;
  readonly size: number;

  constructor() {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    this.size = Math.max(1, Math.min(4, cores - 1));
  }

  private ensure() {
    while (this.workers.length < this.size) this.workers.push(new EngineWorker());
  }

  private pump() {
    for (const [index, w] of this.workers.entries()) {
      const next = this.queue.findIndex((j) => j.workerIndex === undefined || j.workerIndex === index);
      if (!w.busy && next >= 0) {
        const [job] = this.queue.splice(next, 1);
        w.run(job).then(() => this.pump());
      }
    }
  }

  analyse(fen: string, depth: number, multipv = 2, onInfo?: (e: PositionEval) => void, priority = false): Promise<PositionEval> {
    return this.submit(fen, depth, multipv, onInfo, priority);
  }

  private submit(fen: string, depth: number, multipv: number, onInfo?: (e: PositionEval) => void, priority = false, workerIndex?: number): Promise<PositionEval> {
    this.ensure();
    return new Promise((resolve, reject) => {
      const job = { fen, depth, multipv, resolve, reject, onInfo, workerIndex };
      if (priority) this.queue.unshift(job);
      else this.queue.push(job);
      this.pump();
    });
  }

  /** Contiguous position chunks reuse hash within each worker, at full depth. */
  async analyseBatch(fens: string[], depth: number, multipv = 2, onResult?: (e: PositionEval, index: number) => void): Promise<PositionEval[]> {
    const results: PositionEval[] = new Array(fens.length);
    const generation = this.generation;
    let next = 0;
    await Promise.all(Array.from({ length: this.size }, async (_, workerIndex) => {
      while (next < fens.length) {
        const start = next;
        // Short consecutive runs retain useful hash without stranding workers
        // on one expensive middlegame chunk.
        next += 4;
        for (let i = start; i < Math.min(fens.length, start + 4); i++) {
          if (generation !== this.generation) throw new Error('cancelled');
          results[i] = await this.submit(fens[i], depth, multipv, undefined, false, workerIndex);
          if (generation !== this.generation) throw new Error('cancelled');
          onResult?.(results[i], i);
        }
      }
    }));
    return results;
  }

  cancelQueued() {
    this.generation++;
    const q = this.queue;
    this.queue = [];
    for (const j of q) j.reject(new Error('cancelled'));
  }
}

export const engine = new EnginePool();

// ---------- Lichess cloud evaluation (free, CORS-enabled) ----------
let cloudDisabledUntil = 0;

export async function cloudEval(fen: string, multipv = 2, timeoutMs = 1200): Promise<PositionEval | null> {
  if (Date.now() < cloudDisabledUntil) return null;
  try {
    const r = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multipv}`, { signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))) });
    if (r.status === 429) {
      cloudDisabledUntil = Date.now() + 60_000;
      return null;
    }
    if (!r.ok) return null;
    const j = await r.json();
    const lines: PVLine[] = (j.pvs ?? []).map((p: { cp?: number; mate?: number; moves: string }) => ({
      score: p.mate !== undefined ? { mate: p.mate } : { cp: p.cp ?? 0 },
      pv: p.moves.split(' '),
    }));
    if (!lines.length) return null;
    return { fen, depth: j.depth, lines, source: 'cloud' };
  } catch {
    return null;
  }
}

/** Evaluation for terminal positions (mate/stalemate) where the engine has nothing to say. */
export function terminalEval(fen: string): PositionEval | null {
  const c = new Chess(fen);
  if (c.isCheckmate()) {
    const whiteMated = c.turn() === 'w';
    return { fen, depth: 99, lines: [{ score: { mate: whiteMated ? -0.0001 : 0.0001 }, pv: [] }], source: 'terminal' };
  }
  if (c.isDraw() || c.isStalemate()) {
    return { fen, depth: 99, lines: [{ score: { cp: 0 }, pv: [] }], source: 'terminal' };
  }
  return null;
}
