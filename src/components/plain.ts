import { Chess } from 'chess.js';
import { describeLine, describeMove } from '../lib/narrate';
import type { Color } from '../lib/types';

/** Plain-English move, never throws (falls back to SAN for malformed input). */
export function plainMove(fenBefore: string, move: string, perspective?: Color, style: 'full' | 'short' = 'full'): string {
  try {
    return describeMove(fenBefore, move, { perspective, style });
  } catch {
    return move;
  }
}

/** Plain-English line, stopping at the first move that doesn't parse. */
export function plainLine(fen: string, moves: string[], perspective?: Color, style: 'full' | 'short' = 'full'): string[] {
  try {
    return describeLine(fen, moves, { perspective, style });
  } catch {
    const out: string[] = [];
    const c = new Chess(fen);
    for (const m of moves) {
      try {
        const before = c.fen();
        c.move(m);
        out.push(describeMove(before, m, { perspective, style }));
      } catch {
        break;
      }
    }
    return out;
  }
}

/** UCI line to SAN + fens, stopping on the first illegal move. */
export function uciLine(fen: string, ucis: string[]): { san: string; fen: string; from: string; to: string }[] {
  const out: { san: string; fen: string; from: string; to: string }[] = [];
  try {
    const c = new Chess(fen);
    for (const u of ucis) {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push({ san: m.san, fen: c.fen(), from: m.from, to: m.to });
    }
  } catch {
    /* stop at first illegal */
  }
  return out;
}

export const moveNo = (ply: number, color: Color) => `${Math.ceil(ply / 2)}${color === 'w' ? '.' : '...'}`;

export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** First letter upper-case, for sentence starts. */
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** First letter lower-case, for mid-sentence use of a narrated move. */
export const low = (s: string) => (s && !/^(I |White|Black)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** "You played bishop takes e6" style phrase for prompts (short narration, no check marks). */
export function playedPhrase(fenBefore: string, san: string): string {
  const s = plainMove(fenBefore, san, undefined, 'short').replace(/[+#]$/, '');
  if (/^castle/i.test(s)) return `castled ${s.split(' ')[1] ?? ''}`.trim();
  return `played ${low(s)}`;
}
