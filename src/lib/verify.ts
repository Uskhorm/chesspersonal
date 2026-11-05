import { Chess } from 'chess.js';
import { engine } from './engine';
import { scoreToWin } from './winpct';
import type { Color } from './types';

export interface VerifyResult {
  ok: boolean;
  exact: boolean;
  loss: number; // win% points lost vs best
  san: string;
  fenAfter: string;
  mate: boolean;
}

/**
 * Accepts the engine's move, any checkmate, or any move that keeps (almost) all of
 * the winning chances — so you're never punished for finding a different good move.
 */
export async function verifyMove(fen: string, uci: string, bestUci: string, winBefore: number, tolerance = 3): Promise<VerifyResult> {
  const c = new Chess(fen);
  const mover = c.turn() as Color;
  const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });
  const played = m.from + m.to;
  const exact = played === bestUci.slice(0, 4);
  if (exact || c.isCheckmate()) return { ok: true, exact, loss: 0, san: m.san, fenAfter: c.fen(), mate: c.isCheckmate() };
  const e = await engine.analyse(c.fen(), 13, 1, undefined, true);
  const win = scoreToWin(e.lines[0]?.score ?? { cp: 0 }, mover);
  const loss = Math.max(0, winBefore - win);
  return { ok: loss <= tolerance, exact, loss, san: m.san, fenAfter: c.fen(), mate: false };
}
