import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { gradeFrom, isMastered, isNewCard, newDrill, retrievability, schedule, dueLabel, type FsrsDrill } from '../srs';
import { buildSession } from '../learning';
import type { AnalysedMove, Drill, StoredGame } from '../types';
const DAY = 86400000;
const drill = (patch: Partial<FsrsDrill> = {}): FsrsDrill => ({ id: 'game:1', gameId: 'game', ply: 1,
  fen: new Chess().fen(), color: 'w', bestUci: 'e2e4', bestSan: 'e4', playedSan: 'd4',
  cls: 'mistake', winBefore: 50, motifs: ['positional'], reps: 0, lapses: 0, ease: 2.5,
  interval: 0, due: Date.now(), attempts: 0, solved: 0, createdAt: Date.now(), opponent: 'test', ...patch });

describe('FSRS scheduling', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  it('maps outcomes and help to ratings', () => {
    expect(gradeFrom(false, true, 1)).toBe('again');
    expect(gradeFrom(true, false, 1)).toBe('hard');
    expect(gradeFrom(true, true, 7999)).toBe('easy');
    expect(gradeFrom(true, true, 8000)).toBe('good');
    expect(gradeFrom(true, true, 100, { hintsUsed: 1 })).toBe('hard');
    expect(gradeFrom(true, true, 100, { hintsUsed: 2 })).toBe('again');
    expect(gradeFrom(true, false, 100, { hintsUsed: 3, mode: 'learn' })).toBe('again');
    expect(gradeFrom(false, true, 100, { hintsUsed: 1 })).toBe('again');
    for (const mode of ['session', 'leak', 'learn'] as const) {
      expect(gradeFrom(true, true, 7999, { mode, hintsUsed: 0 })).toBe('easy');
      expect(gradeFrom(true, true, 8000, { mode, hintsUsed: 0 })).toBe('good');
    }
    for (const firstTry of [true, false]) for (const hintsUsed of [0, 1, 2, 3]) {
      expect(gradeFrom(true, firstTry, 1, { mode: 'rush', hintsUsed })).toBe(hintsUsed >= 2 ? 'again' : 'good');
      expect(gradeFrom(false, firstTry, 1, { mode: 'rush', hintsUsed })).toBe('again');
    }

  });
  it('lazily migrates old rows as new, preserving lifetime counts', () => {
    const old = drill({ interval: 80, reps: 8, attempts: 10, solved: 8 });
    expect(isMastered(old)).toBe(false);
    const next = schedule(old, 'easy');
    const fresh = schedule(drill(), 'easy');
    expect(next.fsrs).toEqual(fresh.fsrs);
    expect(next.attempts).toBe(11);
    expect(next.solved).toBe(9);
    expect(old.fsrs).toBeUndefined();
    expect(next.updatedAt).toBe(Date.now());
  });
  it('uses actual FSRS grades, serialized dates, and stable round trips', () => {
    const again = schedule(drill(), 'again');
    const easy = schedule(drill(), 'easy');
    expect(again.due).toBeGreaterThan(Date.now());
    expect(easy.due).toBeGreaterThan(again.due);
    expect(easy.fsrs!.stability).toBeGreaterThan(again.fsrs!.stability);
    expect(typeof easy.fsrs!.last_review).toBe('number');
    vi.setSystemTime(easy.due);
    expect(schedule(JSON.parse(JSON.stringify(easy)), 'good')).toEqual(schedule(easy, 'good'));
  });
  it('tracks review lapses and mastery by stability rather than interval', () => {
    let card = schedule(drill(), 'easy');
    for (let i = 0; i < 5; i++) { vi.setSystemTime(card.due); card = schedule(card, 'easy'); }
    expect(card.fsrs!.stability).toBeGreaterThanOrEqual(21);
    expect(isMastered({ ...card, interval: 0 })).toBe(true);
    vi.setSystemTime(card.due);
    expect(schedule(card, 'again').fsrs!.lapses).toBe(card.fsrs!.lapses + 1);
  });
  it('estimates decreasing FSRS recall probability', () => {
    expect(retrievability(drill())).toBe(0);
    const card = schedule(drill(), 'easy');
    expect(isNewCard(card)).toBe(false);
    expect(retrievability(card, Date.now() + 20 * DAY)).toBeLessThan(retrievability(card, Date.now() + DAY));
  });
  it('creates drills with source analysis for coaching', () => {
    const m = { ply: 1, fenBefore: new Chess().fen(), color: 'w', bestUci: 'e2e4', bestSan: 'e4', san: 'd4',
      cls: 'mistake', winBefore: 50, motifs: ['positional'] } as AnalysedMove;
    const game = { id: 'g', userColor: 'w', white: { username: 'self' }, black: { username: 'opponent' } } as StoredGame;
    const card = newDrill(game, m);
    expect(card.id).toBe('g:1'); expect(card.move).toBe(m); expect(card.fsrs!.reps).toBe(0);
  });
  it('keeps due labels compatible', () => {
    expect(dueLabel(drill())).toBe('due now');
    expect(dueLabel(drill({ due: Date.now() + 1 }))).toBe('in 1h');
    expect(dueLabel(drill({ due: Date.now() + 2 * DAY }))).toBe('in 2d');
  });
  it('caps new cards at 15 minus today’s introductions', () => {
    const cards = Array.from({ length: 30 }, (_, i) => drill({ id: String(i) }));
    expect(buildSession(cards, 30, null)).toHaveLength(15);
    const reviewed = cards.slice(0, 12).map((d) => schedule(d, 'easy'));
    const session = buildSession([...reviewed, ...cards.slice(12)], 30, null);
    expect(session.filter(isNewCard)).toHaveLength(3);
    vi.setSystemTime(Date.now() + DAY);
    expect(buildSession([...reviewed, ...cards.slice(12)], 30, null).filter(isNewCard)).toHaveLength(15);
  });
  it('keeps due reviews ahead of new/future cards and interleaves motifs', () => {
    const old = schedule(drill({ id: 'a' }), 'easy');
    const other = schedule(drill({ id: 'b', motifs: ['missed-fork'] }), 'easy');
    vi.setSystemTime(old.due + DAY);
    const cards: Drill[] = [drill({ id: 'fresh' }), { ...old, id: 'future', due: Date.now() + DAY },
      old, { ...old, id: 'c' }, other];
    const session = buildSession(cards, 5, 0.6);
    expect(session.slice(0, 3).every((d) => d.due <= Date.now() && !isNewCard(d))).toBe(true);
    expect(session[0].motifs[0]).not.toBe(session[1].motifs[0]);
    expect(buildSession(cards, 0, null)).toEqual([]);
  });
  it('reviews lower retrievability first within a motif and targets 85% for extra practice', () => {
    const card = schedule(drill(), 'easy');
    const now = Date.now();
    const atRecall = (id: string, days: number, due: number): FsrsDrill => ({ ...card, id, due,
      fsrs: { ...card.fsrs!, last_review: now - days * DAY } });
    const weakest = atRecall('weakest', 40, now - 1);
    const stronger = atRecall('stronger', 1, now - 1);
    expect(buildSession([stronger, weakest], 2, null)[0].id).toBe('weakest');
    const candidates = Array.from({ length: 30 }, (_, i) => atRecall(String(i), i + 1, now + DAY));
    const session = buildSession(candidates, 1, null);
    const best = [...candidates].sort((a, b) => Math.abs(retrievability(a) - 0.85) - Math.abs(retrievability(b) - 0.85))[0];
    expect(session[0].id).toBe(best.id);
  });
});
