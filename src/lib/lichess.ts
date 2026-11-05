import { Chess } from 'chess.js';

export interface LichessPuzzle {
  id: string;
  fen: string;
  solution: string[];
  rating: number;
  themes: string[];
  lastMove?: string;
}
export type PuzzleDifficulty = 'easiest' | 'easier' | 'normal' | 'harder' | 'hardest';
const queues = new Map<string, LichessPuzzle[]>();
const filling = new Map<string, Promise<void>>();
const taking = new Map<string, Promise<LichessPuzzle>>();
const seen = new Set<string>();
const MAX_SEEN = 1000;

/** The API may supply either a solver FEN or a PGN + initialPly. */
function parsePuzzle(j: { puzzle: Record<string, unknown>; game?: { pgn?: string } }): LichessPuzzle {
  const p = j.puzzle;
  let fen = p.fen as string | undefined;
  let lastMove = p.lastMove as string | undefined;
  if (!fen && j.game?.pgn && typeof p.initialPly === 'number') {
    const game = new Chess();
    game.loadPgn(j.game.pgn);
    const moves = game.history({ verbose: true });
    const position = moves[p.initialPly - 1];
    if (position) { fen = position.after; lastMove = position.lan; }
  }
  if (!fen || typeof p.id !== 'string' || !Array.isArray(p.solution) || !p.solution.length ||
      !p.solution.every((m) => typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) ||
      typeof p.rating !== 'number') throw new Error('Invalid Lichess puzzle response');
  const c = new Chess(fen);
  for (const uci of p.solution as string[]) c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return { id: p.id, fen, solution: p.solution as string[], rating: p.rating,
    themes: Array.isArray(p.themes) ? p.themes.filter((x): x is string => typeof x === 'string') : [], lastMove };
}

async function fill(angle: string | undefined, difficulty: PuzzleDifficulty, count: number): Promise<void> {
  const key = `${angle ?? ''}:${difficulty}`;
  const active = filling.get(key);
  if (active) return active;
  const job = (async () => {
    const queue = queues.get(key) ?? [];
    queues.set(key, queue);
    for (let attempt = 0; queue.length < Math.min(3, count) && attempt < count + 3; attempt++) {
      const params = new URLSearchParams({ difficulty });
      if (angle) params.set('angle', angle);
      const response = await fetch(`https://lichess.org/api/puzzle/next?${params}`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`Lichess puzzle error ${response.status}`);
      const puzzle = parsePuzzle(await response.json());
      if (seen.has(puzzle.id)) continue;
      seen.add(puzzle.id);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value!);
      queue.push(puzzle);
    }
  })();
  filling.set(key, job);
  try { await job; } finally { filling.delete(key); }
}

/** Bounded in-memory prefetch; repeated IDs never enter the queue twice. */
export async function prefetchPuzzles(angle?: string, difficulty: PuzzleDifficulty = 'normal', count = 2): Promise<void> {
  await fill(angle, difficulty, Math.max(1, Math.min(3, Math.floor(count))));
}

export async function fetchPuzzle(angle?: string, difficulty: PuzzleDifficulty = 'normal'): Promise<LichessPuzzle> {
  const key = `${angle ?? ''}:${difficulty}`;
  const previous = taking.get(key);
  // Serialize consumers, not just fills: parallel callers must receive distinct cards.
  const request = (async () => {
    if (previous) await previous.catch(() => {});
    if (!queues.get(key)?.length) await fill(angle, difficulty, 1);
    const puzzle = queues.get(key)?.shift();
    if (!puzzle) throw new Error('No unseen Lichess puzzle available');
    // Prefetch failures must not reject a puzzle already obtained successfully.
    void prefetchPuzzles(angle, difficulty).catch(() => {});
    return { ...puzzle, solution: [...puzzle.solution], themes: [...puzzle.themes] };
  })();
  taking.set(key, request);
  try { return await request; } finally { if (taking.get(key) === request) taking.delete(key); }
}
