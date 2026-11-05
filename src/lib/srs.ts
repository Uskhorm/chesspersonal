import type { AnalysedMove, Drill, StoredGame } from './types';
import { opponentOf } from './chesscom';

/**
 * Spaced repetition for your own mistakes (SM-2 family, the algorithm behind Anki).
 * Spacing + retrieval practice are the two most robust findings in learning science:
 * reviewing a position right before you'd forget it makes it stick.
 */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

const DAY = 86_400_000;

export function newDrill(game: StoredGame, m: AnalysedMove): Drill {
  return {
    id: `${game.id}:${m.ply}`,
    gameId: game.id,
    ply: m.ply,
    fen: m.fenBefore,
    color: m.color,
    bestUci: m.bestUci,
    bestSan: m.bestSan,
    playedSan: m.san,
    cls: m.cls,
    winBefore: m.winBefore,
    motifs: m.motifs,
    reps: 0,
    lapses: 0,
    ease: 2.5,
    interval: 0,
    due: Date.now(),
    attempts: 0,
    solved: 0,
    createdAt: Date.now(),
    opponent: opponentOf(game).username,
  };
}

/** Grade from performance: wrong → again; solved slowly/2nd try → hard; fast (<8s) → easy. */
export function gradeFrom(correct: boolean, firstTry: boolean, ms: number): Grade {
  if (!correct) return 'again';
  if (!firstTry) return 'hard';
  return ms < 8000 ? 'easy' : 'good';
}

export function schedule(d: Drill, g: Grade): Drill {
  const n = { ...d, attempts: d.attempts + 1, lastSeen: Date.now() };
  if (g === 'again') {
    n.lapses++;
    n.reps = 0;
    n.ease = Math.max(1.3, n.ease - 0.2);
    n.interval = 0;
    n.due = Date.now() + 10 * 60_000; // relearn within the same session / day
    return n;
  }
  n.solved++;
  n.reps++;
  const q = g === 'hard' ? 3 : g === 'good' ? 4 : 5;
  n.ease = Math.max(1.3, n.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  if (n.reps === 1) n.interval = g === 'easy' ? 3 : 1;
  else if (n.reps === 2) n.interval = g === 'easy' ? 8 : 4;
  else n.interval = Math.round(n.interval * n.ease * (g === 'hard' ? 0.8 : g === 'easy' ? 1.3 : 1));
  n.due = Date.now() + n.interval * DAY;
  return n;
}

export const isMastered = (d: Drill) => d.interval >= 21;

export function dueLabel(d: Drill): string {
  const diff = d.due - Date.now();
  if (diff <= 0) return 'due now';
  const h = diff / 3_600_000;
  if (h < 24) return `in ${Math.ceil(h)}h`;
  return `in ${Math.round(h / 24)}d`;
}
