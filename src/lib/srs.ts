import type { AnalysedMove, Drill, StoredGame } from './types';
import { opponentOf } from './chesscom';
import { FSRS, createEmptyCard, Rating, type Card } from 'ts-fsrs';

/**
 * FSRS-6 using the synchronous compatibility API shipped with ts-fsrs v6.
 * Spacing + retrieval practice are the two most robust findings in learning science:
 * reviewing a position right before you'd forget it makes it stick.
 */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

const DAY = 86_400_000;
const scheduler = new FSRS({ request_retention: 0.85, enable_fuzz: false });
export type SerializedCard = Omit<Card, 'due' | 'last_review'> & { due: number; last_review?: number };
export type FsrsDrill = Drill & { fsrs?: SerializedCard; introducedAt?: number; updatedAt?: number; move?: AnalysedMove };

function serialize(card: Card): SerializedCard {
  return { ...card, due: card.due.getTime(), last_review: card.last_review?.getTime() };
}

function cardOf(d: Drill, now: number): Card {
  const c = (d as FsrsDrill).fsrs;
  return c ? { ...c, due: new Date(c.due), last_review: c.last_review === undefined ? undefined : new Date(c.last_review) }
    : createEmptyCard(new Date(now));
}

/** New/legacy cards have no measured recall probability yet. */
export function retrievability(d: Drill, now = Date.now()): number {
  return scheduler.retrievability(cardOf(d, now), new Date(now));
}

export function isNewCard(d: Drill): boolean {
  return !(d as FsrsDrill).fsrs?.reps;
}

export function newDrill(game: StoredGame, m: AnalysedMove): FsrsDrill {
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
    fsrs: serialize(createEmptyCard(new Date())),
    move: m,
  };
}

/** Assistance limits recall evidence; rush records only success or failure. */
export function gradeFrom(correct: boolean, firstTry: boolean, ms: number, opts?: { hintsUsed?: number; mode?: 'session' | 'leak' | 'rush' | 'learn' }): Grade {
  if (opts?.mode === 'rush') return correct && (opts.hintsUsed ?? 0) < 2 ? 'good' : 'again';
  if (!correct || (opts?.hintsUsed ?? 0) >= 2) return 'again';
  if (!firstTry || opts?.hintsUsed === 1) return 'hard';
  return ms < 8000 ? 'easy' : 'good';
}

export function schedule(d: Drill, g: Grade): FsrsDrill {
  const now = Date.now();
  const rating = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;
  const card = scheduler.next(cardOf(d, now), new Date(now), rating[g]).card;
  return {
    ...d, fsrs: serialize(card), updatedAt: now,
    introducedAt: (d as FsrsDrill).introducedAt ?? now,
    attempts: d.attempts + 1, solved: d.solved + (g === 'again' ? 0 : 1),
    lastSeen: now, reps: card.reps, lapses: card.lapses,
    interval: (card.due.getTime() - now) / DAY, due: card.due.getTime(),
  };
}

export const isMastered = (d: Drill) => ((d as FsrsDrill).fsrs?.stability ?? 0) >= 21;

export function dueLabel(d: Drill): string {
  const diff = d.due - Date.now();
  if (diff <= 0) return 'due now';
  const h = diff / 3_600_000;
  if (h < 24) return `in ${Math.ceil(h)}h`;
  return `in ${Math.round(h / 24)}d`;
}
