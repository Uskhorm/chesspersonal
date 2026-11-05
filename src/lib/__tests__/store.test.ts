import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal('window', { localStorage });
  return values;
});
vi.mock('../db', () => ({
  today: (date = new Date()) => date.toISOString().slice(0, 10),
  bumpActivity: vi.fn(), notifyOutbox: vi.fn(),
  syncTimestamp: () => new Date().toISOString(),
  db: { outbox: { put: vi.fn() } },
}));
import { progressSnapshot, useStore } from '../store';
import { onFx, type FxEvent } from '../bus';

const initial = progressSnapshot(useStore.getState());
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  useStore.getState().hydrate(initial);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('reward economy', () => {
  it('grants level XP without chests or random critical hits', () => {
    const events: FxEvent[] = [];
    const off = onFx(e => events.push(e));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    useStore.getState().addXP(100);
    off();
    expect(useStore.getState()).toMatchObject({ xp: 100, chests: initial.chests });
    expect(random).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'xp', amount: 100, x: undefined, y: undefined, crit: false });
    expect(events.some(e => e.type === 'levelup')).toBe(true);
    useStore.getState().addXP(5, undefined, { crit: true });
    expect(useStore.getState().xp).toBe(110);
  });
  it('chest XP cannot start or extend a streak and never critically doubles', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    useStore.getState().hydrate({ chests: 1, xp: 0,
      streak: { count: 4, best: 4, lastDay: '2026-11-03', freezes: 2 } });
    const before = { ...useStore.getState().streak };
    useStore.getState().openChest();
    vi.advanceTimersByTime(1600);
    expect(useStore.getState()).toMatchObject({ xp: 40, chests: 0, streak: before });
    useStore.getState().hydrate({ streak: initial.streak });
    useStore.getState().addXP(10, undefined, { countsForStreak: false });
    expect(useStore.getState().streak).toEqual(initial.streak);
  });
  it('awards one chest on completion of all three daily quests, plus achievement chests once', () => {
    useStore.getState().ensureDay();
    const quests = useStore.getState().quests.list;
    quests.forEach((q, i) => {
      useStore.getState().progressQuest(q.kind, q.target);
      expect(useStore.getState().chests).toBe(i === 2 ? 1 : 0);
    });
    useStore.getState().progressQuest(quests[2].kind, 100);
    vi.advanceTimersByTime(900);
    expect(useStore.getState().chests).toBe(1);
    useStore.getState().unlock('first-review');
    useStore.getState().unlock('first-review');
    expect(useStore.getState().chests).toBe(2);
  });
  it('awards every fifth mastery once, supports batched counts and grants the mastery achievement', () => {
    for (let i = 0; i < 4; i++) useStore.getState().onMastered();
    expect(useStore.getState().chests).toBe(0);
    useStore.getState().onMastered();
    expect(useStore.getState()).toMatchObject({ chests: 1, stats: { mastered: 5 } });
    useStore.getState().recordMastered(16);
    expect(useStore.getState()).toMatchObject({ chests: 4, stats: { mastered: 16 } });
    expect(useStore.getState().achievements).toContain('master-10');
    for (const count of [16, 10, NaN, Infinity]) useStore.getState().recordMastered(count);
    expect(useStore.getState().chests).toBe(4);
  });
});

describe('streaks', () => {
  it.each([
    ['2026-11-04', 2, 5, 2],
    ['2026-11-03', 2, 5, 1],
    ['2026-11-01', 3, 5, 0],
    ['2026-11-01', 2, 1, 2],
  ])('charges each missed day after %s with %i freezes', (lastDay, freezes, count, remaining) => {
    useStore.getState().hydrate({ streak: { count: 4, best: 7, lastDay, freezes } });
    useStore.getState().addXP(1);
    expect(useStore.getState().streak).toEqual({ count, best: 7, lastDay: '2026-11-05', freezes: remaining });
    useStore.getState().addXP(1);
    expect(useStore.getState().streak.count).toBe(count);
  });
});

describe('persisted progress compatibility', () => {
  it('migrates v1 data and preserves XP, quests, and stats on rehydration', async () => {
    const { mastered: _mastered, ...oldStats } = initial.stats;
    const old = { ...initial, xp: 123, chests: 7, stats: { ...oldStats, drillsSolved: 42 } };
    storage.set('chesspersonal-progress', JSON.stringify({ version: 1, state: old }));
    await useStore.persist.rehydrate();
    expect(useStore.getState()).toMatchObject({ xp: 123, chests: 7, stats: { drillsSolved: 42, mastered: 0 } });
    expect(JSON.parse(storage.get('chesspersonal-progress')!).version).toBe(2);
    useStore.getState().recordMastered(4);
    useStore.getState().hydrate({ stats: oldStats });
    expect(useStore.getState().stats.mastered).toBe(4);
  });
});
