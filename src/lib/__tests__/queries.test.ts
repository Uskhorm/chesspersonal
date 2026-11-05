import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { db, slimAnalysis, suppressSync, today } from '../db';
import type { GameAnalysis, StoredGame, Drill } from '../types';

// Exercise the live-query callbacks against IndexedDB without a DOM renderer.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
import { useSlimAnalyses, useRecentGames, useGamesPage, useGameCount, useSummaries, useAnalysis, useDrillStats, useTodayActivity } from '../queries';
const game = (id: string, endTime = 1): StoredGame => ({ id, endTime, userColor: 'b', white: { username: 'Alice' }, black: { username: 'Bob' }, timeClass: 'rapid', analysed: true } as StoredGame);
const analysis = (gameId: string): GameAnalysis => ({ gameId, white: { accuracy: 80, counts: { best: 4 } }, black: { accuracy: 90, counts: { best: 8 } }, winCurve: Array.from({ length: 200 }, (_, i) => i), opening: 'Italian', eco: 'C50', moves: [] } as unknown as GameAnalysis);
beforeEach(async () => {
  await db.transaction('rw', db.tables, async tx => {
    suppressSync(tx);
    for (const table of db.tables) await table.clear();
  });
});
describe('derived summaries', () => {
  it('creates compact user-side summaries and updates nested fields in one-table transactions', async () => {
    await db.games.put(game('a'));
    await db.transaction('rw', db.analyses, () => db.analyses.put(analysis('a')));
    expect(await db.slim.get('a')).toEqual(slimAnalysis((await db.analyses.get('a'))!));
    const summary = (await db.summaries.get('a'))!;
    expect(summary).toMatchObject({ gameId: 'a', accuracy: 90, counts: { best: 8 }, userColor: 'b', opening: 'Italian', eco: 'C50' });
    expect(summary.curve).toHaveLength(64);
    expect([summary.curve[0], summary.curve[63]]).toEqual([0, 199]);
    expect(summary).not.toHaveProperty('moves');
    await db.analyses.update('a', { 'black.accuracy': 95, winCurve: [10, 20] });
    expect(await db.slim.get('a')).toEqual(slimAnalysis((await db.analyses.get('a'))!));
    expect(await db.summaries.get('a')).toMatchObject({ accuracy: 95, curve: [10, 20] });
    expect((await db.outbox.toArray()).some(row => (row.collection as string) === 'summaries')).toBe(false);
  });
  it('derives suppressed server writes and deletes without echoing, and rolls back atomically', async () => {
    await db.transaction('rw', db.analyses, async tx => { suppressSync(tx); await db.analyses.put(analysis('remote')); });
    expect(await db.slim.get('remote')).toEqual(slimAnalysis(analysis('remote')));
    await db.transaction('rw', db.analyses, async tx => { suppressSync(tx); await db.analyses.update('remote', { 'white.accuracy': 42 }); });
    expect((await db.slim.get('remote'))?.white.accuracy).toBe(42);
    expect(await db.summaries.get('remote')).toMatchObject({ accuracy: 42, userColor: 'w' });
    expect(await db.outbox.count()).toBe(0);
    await expect(db.transaction('rw', db.analyses, async () => { await db.analyses.put(analysis('abort')); throw Error('abort'); })).rejects.toThrow('abort');
    expect(await db.summaries.get('abort')).toBeUndefined();
    expect(await db.slim.get('abort')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
    await db.transaction('rw', db.analyses, async tx => { suppressSync(tx); await db.analyses.delete('remote'); });
    expect(await db.summaries.count()).toBe(0);
    expect(await db.slim.count()).toBe(0);
  });
  it('backfills a real version-2 database on version-3 upgrade', async () => {
    db.close();
    await Dexie.delete(db.name);
    const old = new Dexie(db.name);
    old.version(2).stores({ games: 'id, endTime, analysed', analyses: 'gameId', drills: 'id, due, gameId, cls', activity: 'day', outbox: 'id, collection, updated_at' });
    await old.table('games').put(game('legacy'));
    await old.table('analyses').put(analysis('legacy'));
    old.close();
    await db.open();
    expect(await db.slim.get('legacy')).toEqual(slimAnalysis(analysis('legacy')));
    expect(await db.summaries.get('legacy')).toMatchObject({ accuracy: 90, userColor: 'b' });
    expect(await db.outbox.count()).toBe(0);
  });
});
it('backfills version 3 analyses without sync entries', async () => {
  db.close();
  await Dexie.delete(db.name);
  const old = new Dexie(db.name);
  old.version(3).stores({ games: 'id, endTime, analysed', analyses: 'gameId', drills: 'id, due, gameId, cls', activity: 'day', outbox: 'id, collection, updated_at', summaries: 'gameId' });
  await old.table('analyses').put(analysis('v3'));
  old.close();
  await db.open();
  expect(await db.slim.get('v3')).toEqual(slimAnalysis(analysis('v3')));
  expect(await db.outbox.count()).toBe(0);
});
describe('query callbacks', () => {
  it('paginates and counts filtered games newest first without loading analyses', async () => {
    await db.games.bulkPut([game('a', 1), game('b', 2), { ...game('c', 3), timeClass: 'blitz' }]);
    expect((await useRecentGames(2)).map(g => g.id)).toEqual(['c', 'b']);
    expect((await useGamesPage({ timeClass: 'rapid', search: 'ALICE' }, 1, 1)).map(g => g.id)).toEqual(['a']);
    expect(await useGameCount({ timeClass: 'rapid' })).toBe(2);
    expect(await useRecentGames(0)).toEqual([]);
    await db.analyses.put(analysis('a'));
    expect((await useSummaries(['a'])).map(s => s.gameId)).toEqual(['a']);
    expect(await useSummaries([])).toEqual([]);
    expect(await useSummaries()).toHaveLength(1);
    expect(await useAnalysis('a')).toMatchObject({ gameId: 'a', moves: [] });
    expect(await useAnalysis('missing')).toBeUndefined();
    expect(await useSlimAnalyses()).toHaveLength(1);
    expect(await useSlimAnalyses(['a'])).toEqual([slimAnalysis((await db.analyses.get('a'))!)]);
    expect(await useSlimAnalyses([])).toEqual([]);
  });
  it('reports mastery and calendar-day due counts plus today activity', async () => {
    const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
    await db.drills.bulkPut([
      { id: 'due', due: Date.now() - 1 },
      { id: 'tomorrow', due: +tomorrow, fsrs: { stability: 21 } },
      { id: 'later', due: +tomorrow + 3 * 86400000 },
    ] as unknown as Drill[]);
    expect(await useDrillStats()).toEqual({ due: 1, dueTomorrow: 1, mastered: 1, total: 3 });
    expect(await useTodayActivity()).toEqual({ day: today(), xp: 0, drills: 0, correct: 0, reviews: 0 });
    await db.activity.put({ day: today(), xp: 15, drills: 2, correct: 1, reviews: 3 });
    expect(await useTodayActivity()).toMatchObject({ xp: 15, reviews: 3 });
  });
});
