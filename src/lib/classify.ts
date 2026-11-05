import { Chess, type Move, type Square } from 'chess.js';
import type { Classification, Color, Motif, Score } from './types';
import { formatScore } from './winpct';

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** Static exchange evaluation on `sq` for the side to move, using only legal captures. */
function see(chess: Chess, sq: Square, depth = 0): number {
  if (depth > 8) return 0;
  const caps = chess.moves({ verbose: true }).filter((m) => m.to === sq && m.captured);
  if (!caps.length) return 0;
  caps.sort((a, b) => PIECE_VALUE[a.piece] - PIECE_VALUE[b.piece]);
  const m = caps[0];
  chess.move(m);
  const gain = PIECE_VALUE[m.captured!] - see(chess, sq, depth + 1);
  chess.undo();
  return Math.max(0, gain);
}

/** Best material the side to move can win immediately with one capture (SEE-checked). */
export function bestCaptureGain(fen: string): { gain: number; move?: Move } {
  const chess = new Chess(fen);
  let best: { gain: number; move?: Move } = { gain: 0 };
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    chess.move(m);
    const g = PIECE_VALUE[m.captured] - see(chess, m.to);
    chess.undo();
    if (g > best.gain) best = { gain: g, move: m };
  }
  return best;
}

/** Material the mover offers up with this move (>= 2 ≈ a real sacrifice). */
export function sacrificeAmount(fenAfter: string, move: Move): number {
  const opp = bestCaptureGain(fenAfter);
  if (opp.gain <= 0) return 0;
  const ourCapture = move.captured ? PIECE_VALUE[move.captured] : 0;
  const offset = opp.move?.to === move.to ? ourCapture : 0;
  return opp.gain - offset;
}

/** Does the piece that just moved attack two or more valuable targets (a fork)? */
export function isFork(fenAfter: string, to: Square, mover: Color): boolean {
  const chess = new Chess(fenAfter);
  const piece = chess.get(to);
  if (!piece) return false;
  let targets = 0;
  for (const row of chess.board())
    for (const p of row) {
      if (!p || p.color === mover) continue;
      const valuable = p.type === 'k' || (PIECE_VALUE[p.type] >= 3 && PIECE_VALUE[p.type] >= PIECE_VALUE[piece.type]);
      if (valuable && chess.attackers(p.square, mover).includes(to)) targets++;
    }
  return targets >= 2;
}

export const MOTIF_INFO: Record<Motif, { label: string; tip: string; angle: string; emoji: string }> = {
  'hung-piece': { label: 'Hanging pieces', tip: 'Before every move ask: “what can they capture now?”', angle: 'hangingPiece', emoji: '🫳' },
  'allowed-mate': { label: 'Allowed mate', tip: 'Check every enemy check before you move — especially near your king.', angle: 'mateIn2', emoji: '☠️' },
  'missed-mate': { label: 'Missed mates', tip: 'Look at all checks first. Forcing moves hide checkmates.', angle: 'mateIn2', emoji: '👑' },
  'missed-win': { label: 'Missed tactics', tip: 'After their move, scan Checks → Captures → Threats.', angle: 'advantage', emoji: '🎯' },
  'missed-fork': { label: 'Missed forks', tip: 'Knights and queens love double attacks — hunt for squares that hit two targets.', angle: 'fork', emoji: '🍴' },
  'time-trouble': { label: 'Time trouble', tip: 'Invest time at critical moments; play fast in simple positions.', angle: 'short', emoji: '⏱️' },
  opening: { label: 'Opening slips', tip: 'Drill your opening lines — the first 10 moves set the tone.', angle: 'opening', emoji: '📖' },
  endgame: { label: 'Endgame technique', tip: 'Activate your king and push passed pawns in endgames.', angle: 'endgame', emoji: '🏁' },
  positional: { label: 'Positional drift', tip: 'Improve your worst piece; avoid aimless pawn moves.', angle: 'middlegame', emoji: '🧭' },
};

export interface ClassifyInput {
  move: Move;
  fenAfter: string;
  legalCount: number;
  isBook: boolean;
  bestUci: string;
  winBefore: number; // mover POV, best play
  winAfter: number; // mover POV
  winSecond?: number; // mover POV for 2nd-best line
  scoreBefore: Score;
  scoreAfter: Score;
  prevOppLoss: number; // opponent's previous move EP loss
  prevMove?: Move;
}

const mateFor = (s: Score, c: Color) => s.mate !== undefined && (c === 'w' ? s.mate > 0 : s.mate < 0);

/**
 * Expected-points move classification (the same model family chess.com describes publicly):
 * loss of winning chances decides Best → Blunder, then special rules upgrade to
 * Brilliant / Great or re-label as Miss.
 */
export function classify(i: ClassifyInput): { cls: Classification; loss: number; sacrifice: number } {
  const mover = i.move.color;
  const played = i.move.from + i.move.to + (i.move.promotion ?? '');
  const isBest = played === i.bestUci;
  const loss = isBest ? 0 : Math.max(0, i.winBefore - i.winAfter) / 100;
  const sac = sacrificeAmount(i.fenAfter, i.move);

  if (i.legalCount === 1) return { cls: 'forced', loss, sacrifice: 0 };
  if (i.isBook) return { cls: 'book', loss, sacrifice: 0 };

  let cls: Classification;
  if (isBest) cls = 'best';
  else if (loss < 0.02) cls = 'excellent';
  else if (loss < 0.05) cls = 'good';
  else if (loss < 0.1) cls = 'inaccuracy';
  else if (loss < 0.2) cls = 'mistake';
  else cls = 'blunder';

  // Miss: a winning chance (usually gifted by the opponent) that slipped away.
  if ((cls === 'mistake' || cls === 'blunder' || cls === 'inaccuracy') && i.winAfter >= 30) {
    const missedMate = mateFor(i.scoreBefore, mover) && !mateFor(i.scoreAfter, mover);
    const opportunity = i.prevOppLoss >= 0.1 && i.winBefore >= 60 && loss >= 0.1;
    if (missedMate || opportunity) cls = 'miss';
  }

  // Brilliant: a sound sacrifice of real material that is (nearly) the best move.
  if ((cls === 'best' || cls === 'excellent') && sac >= 2 && i.winAfter >= 50 && i.winBefore < 97) {
    cls = 'brilliant';
  }

  // Great: the only move — every alternative changes the outcome (win→draw, draw→loss).
  if (cls === 'best' && i.winSecond !== undefined) {
    const gap = i.winBefore - i.winSecond;
    const outcome = (w: number) => (w >= 68 ? 2 : w >= 32 ? 1 : 0);
    const recapture = !!(i.prevMove?.captured && i.move.captured && i.prevMove.to === i.move.to);
    if (gap >= 15 && outcome(i.winSecond) < outcome(i.winBefore) && !recapture && i.legalCount > 2) cls = 'great';
  }

  return { cls, loss, sacrifice: sac };
}

export function detectMotifs(args: {
  cls: Classification;
  move: Move;
  fenAfter: string;
  bestMove?: Move;
  scoreBefore: Score;
  scoreAfter: Score;
  clockFrac?: number;
  clockSecs?: number;
  ply: number;
  endgame: boolean;
}): Motif[] {
  if (!['inaccuracy', 'mistake', 'blunder', 'miss'].includes(args.cls)) return [];
  const mover = args.move.color;
  const opp: Color = mover === 'w' ? 'b' : 'w';
  const out: Motif[] = [];
  if (mateFor(args.scoreAfter, opp)) out.push('allowed-mate');
  if (mateFor(args.scoreBefore, mover) && !mateFor(args.scoreAfter, mover)) out.push('missed-mate');
  if (bestCaptureGain(args.fenAfter).gain >= 3) out.push('hung-piece');
  if (args.bestMove) {
    if (isFork(args.bestMove.after, args.bestMove.to, mover)) out.push('missed-fork');
    else if ((args.bestMove.captured && PIECE_VALUE[args.bestMove.captured] >= 3) || args.cls === 'miss') out.push('missed-win');
  }
  if ((args.clockSecs !== undefined && args.clockSecs < 20) || (args.clockFrac !== undefined && args.clockFrac < 0.1)) out.push('time-trouble');
  if (args.ply <= 20) out.push('opening');
  if (args.endgame) out.push('endgame');
  if (!out.length) out.push('positional');
  return out;
}

export function isEndgame(fen: string): boolean {
  let mat = 0;
  for (const ch of fen.split(' ')[0]) {
    const t = ch.toLowerCase();
    if (t !== 'p' && PIECE_VALUE[t]) mat += PIECE_VALUE[t];
  }
  return mat <= 26;
}

export function explain(args: {
  cls: Classification;
  san: string;
  bestSan: string;
  move: Move;
  fenAfter: string;
  scoreBefore: Score;
  scoreAfter: Score;
  sacrifice: number;
  opening?: string;
}): string {
  const { cls, san, bestSan, move } = args;
  const mover = move.color;
  const opp: Color = mover === 'w' ? 'b' : 'w';
  const ev = `(${formatScore(args.scoreBefore)} → ${formatScore(args.scoreAfter)})`;
  const mateIn = (s: Score, c: Color) => (mateFor(s, c) ? Math.max(1, Math.round(Math.abs(s.mate!))) : 0);
  const hang = bestCaptureGain(args.fenAfter);
  const hangTxt =
    hang.gain >= 3 && hang.move ? ` It leaves your ${PIECE_NAME[hang.move.captured!]} on ${hang.move.to} en prise.` : '';
  switch (cls) {
    case 'brilliant':
      return `${san} is brilliant! You give up material and it still works perfectly.`;
    case 'great':
      return `${san} is a great move — the only move that holds. Every alternative was clearly worse.`;
    case 'best':
      return `${san} is the best move. Exactly what the engine wanted.`;
    case 'excellent':
      return `${san} is excellent — practically as strong as ${bestSan}.`;
    case 'good':
      return `${san} is a good move. ${bestSan} was a little more precise.`;
    case 'book':
      return `${san} is a book move${args.opening ? ` — ${args.opening}` : ''}.`;
    case 'forced':
      return `${san} was the only legal move.`;
    case 'inaccuracy':
      return `${san} is an inaccuracy ${ev}. ${bestSan} was better.`;
    case 'mistake':
      return `${san} is a mistake ${ev}.${hangTxt} Best was ${bestSan}.`;
    case 'miss': {
      const m = mateIn(args.scoreBefore, mover);
      if (m) return `You missed mate in ${m}! ${bestSan} starts it.`;
      return `Missed win! ${bestSan} would have punished your opponent ${ev}.`;
    }
    case 'blunder': {
      const m = mateIn(args.scoreAfter, opp);
      if (m) return `${san} is a blunder — it allows mate in ${m}. Best was ${bestSan}.`;
      return `${san} is a blunder ${ev}.${hangTxt} ${bestSan} was the move.`;
    }
  }
}
