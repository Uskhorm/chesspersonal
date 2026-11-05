import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { db, suppressSync } from '../db';
import { flushProgress, progressSnapshot, useStore } from '../store';
import type { StoredGame } from '../types';

vi.mock('../auth', () => ({ useAuth: { getState: () => ({ token: 'test-token' }) } }));
let cloud: typeof import('../cloudsync');
const storage = new Map<string, string>();
const initial = progressSnapshot(useStore.getState());
const fetchMock = vi.fn();
let pulled: unknown[] = [];
function game(id: string, pgn = ''): StoredGame {
  return { id, url: '', pgn, endTime: 1, timeClass: 'rapid', timeControl: '600', rated: true,
    white: { username: 'a', rating: 1, result: 'win' }, black: { username: 'b', rating: 1, result: 'loss' }, userColor: 'w', userResult: 'win', analysed: false };
}
function response(data: unknown) { return new Response(JSON.stringify(data), { status: 200 }); }
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', 'https://sync.test/api');
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  cloud = await import('../cloudsync');
});
beforeEach(async () => {
  cloud.stop();
  await flushProgress();
  await db.transaction('rw', [...db.tables], async tx => {
    suppressSync(tx);
    for (const table of db.tables) await table.clear();
  });
  useStore.getState().hydrate(initial);
  storage.clear();
  storage.set('hindsight-auth', JSON.stringify({ state: { token: 'test-token', user: { id: 'user-a' } } }));
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('fetch', fetchMock);
  pulled = [];
  fetchMock.mockReset().mockImplementation(async (url: string) => response(url.endsWith('/pull')
    ? { items: pulled, now: '2030-01-01T00:00:00.000Z', more: false }
    : { ok: true, now: '2030-01-01T00:00:00.000Z' }));
});
afterEach(() => { cloud.stop(); vi.useRealTimers(); });

describe('outbox', () => {
  it('enqueues create/update/delete, including explicit one-table transactions', async () => {
    await db.games.add(game('one'));
    expect(await db.outbox.get('games:one')).toMatchObject({ collection: 'games', key: 'one', deleted: false });
    const first = (await db.outbox.get('games:one'))!.updated_at;
    await db.transaction('rw', db.games, () => db.games.update('one', { analysed: true }));
    expect((await db.outbox.get('games:one'))!.updated_at > first).toBe(true);
    await db.games.delete('one');
    expect(await db.outbox.get('games:one')).toMatchObject({ deleted: true });
  });
  it('suppresses remote writes and rolls back outbox atomically', async () => {
    await db.transaction('rw', db.games, async tx => { suppressSync(tx); await db.games.put(game('remote')); });
    expect(await db.outbox.count()).toBe(0);
    await expect(db.transaction('rw', db.games, async () => { await db.games.add(game('abort')); throw new Error('abort'); })).rejects.toThrow('abort');
    expect(await db.games.get('abort')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
  it('tracks all four collections', async () => {
    await db.analyses.put({ gameId: 'a' } as never);
    await db.drills.put({ id: 'd' } as never);
    await db.activity.put({ day: '2026-01-01', xp: 1, drills: 0, correct: 0, reviews: 0 });
    expect((await db.outbox.toArray()).map(x => x.collection).sort()).toEqual(['activity', 'analyses', 'drills']);
  });
  it('upgrades a v1 database without losing data', async () => {
    const name = 'cloudsync-upgrade-test';
    const old = new Dexie(name);
    old.version(1).stores({ games: 'id, endTime, analysed', analyses: 'gameId', drills: 'id, due, gameId, cls', activity: 'day' });
    await old.table('games').put(game('survivor')); old.close();
    const upgraded = new Dexie(name);
    upgraded.version(1).stores({ games: 'id, endTime, analysed', analyses: 'gameId', drills: 'id, due, gameId, cls', activity: 'day' });
    upgraded.version(2).stores({ outbox: 'id, collection, updated_at' });
    expect(await upgraded.table('games').get('survivor')).toMatchObject({ id: 'survivor' });
    upgraded.close(); await Dexie.delete(name);
  });
});

describe('progress', () => {
  it('merges counters, unions, same-day quests and newer settings', () => {
    const a = { ...initial, xp: 500, trainingRating: 1300, achievements: ['a'], chests: 2, updatedAt: 1,
      stats: { ...initial.stats, drillsSolved: 10 }, quests: { day: '2026-01-01', list: [{ id: 'q', kind: 'solve' as const, label: '', target: 5, reward: 1, progress: 4, done: false }] } };
    const b = { ...initial, xp: 100, trainingRating: 1400, achievements: ['b'], chests: 4, updatedAt: 2,
      settings: { ...initial.settings, sound: false }, stats: { ...initial.stats, gamesReviewed: 3 },
      quests: { ...a.quests, list: [{ ...a.quests.list[0], progress: 5, done: true }] } };
    const merged = cloud.mergeProgress(a, b);
    expect(merged).toMatchObject({ xp: 500, trainingRating: 1400, chests: 4, settings: { sound: false }, stats: { drillsSolved: 10, gamesReviewed: 3 } });
    expect(merged.achievements).toEqual(['a', 'b']);
    expect(merged.quests!.list[0]).toMatchObject({ progress: 5, done: true });
    expect(a.quests.list[0].progress).toBe(4);
  });
  it('merges the additive mastery counter with legacy progress without losing it on hydration', () => {
    const { mastered: _mastered, ...legacyStats } = initial.stats;
    const legacy = { ...initial, stats: legacyStats, updatedAt: 3 };
    const modern = { ...initial, stats: { ...initial.stats, mastered: 7 }, updatedAt: 2 };
    const merged = cloud.mergeProgress(legacy, modern);
    expect(merged.stats?.mastered).toBe(7);
    useStore.getState().hydrate(merged);
    expect(useStore.getState().stats.mastered).toBe(7);
    expect(cloud.mergeProgress(modern, { ...modern, stats: { ...modern.stats, mastered: 12 } }).stats?.mastered).toBe(12);
  });
  it('chooses later streak/day and higher streak count on ties', () => {
    const a = { ...initial, streak: { count: 20, best: 30, freezes: 1, lastDay: '2026-01-01' } };
    const b = { ...initial, streak: { count: 2, best: 2, freezes: 0, lastDay: '2026-01-02' }, quests: { day: '2026-01-02', list: [] } };
    expect(cloud.mergeProgress(a, b).streak).toMatchObject({ count: 2, best: 30 });
    expect(cloud.mergeProgress(a, b).quests!.day).toBe('2026-01-02');
    expect(cloud.mergeProgress(b, { ...b, streak: { ...b.streak, count: 5 } }).streak!.count).toBe(5);
    expect(cloud.mergeProgress({ xp: 5 }, { achievements: ['x'] })).toMatchObject({ xp: 5, achievements: ['x'] });
  });
  it('marks mutations dirty but hydration does not enqueue', async () => {
    useStore.getState().hydrate({ xp: 100 });
    await flushProgress();
    expect(await db.outbox.count()).toBe(0);
    useStore.setState({ xp: 200 });
    await flushProgress();
    expect((await db.outbox.get('progress:state'))!.synced).not.toBe(true);
    expect(useStore.getState().updatedAt).toBeGreaterThan(0);
  });
});

describe('sync transport', () => {
  it('uses backend page cursors and commits the first watermark after the full pull', async () => {
    storage.set('hindsight-sync-cursor', '2020-01-01T00:00:00Z');
    let page = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/push')) return response({ ok: true });
      const body = JSON.parse(init.body as string);
      expect(body.since).toBe('2020-01-01T00:00:00Z');
      if (page++ === 0) return response({ items: [{ collection: 'games', key: 'page-a', data: game('page-a'), updated_at: '2029-01-01T00:00:00Z' }], more: true, cursor: 'opaque-page-cursor', now: '2030-01-01T00:00:00Z' });
      expect(body.cursor).toBe('opaque-page-cursor');
      expect(storage.get('hindsight-sync-cursor')).toBe('2020-01-01T00:00:00Z');
      return response({ items: [{ collection: 'games', key: 'page-b', data: game('page-b'), updated_at: '2029-01-01T00:00:00Z' }], more: false, now: '2030-01-02T00:00:00Z' });
    });
    await cloud.syncNow();
    expect(await db.games.count()).toBe(2);
    expect(storage.get('hindsight-sync-cursor')).toBe('2030-01-01T00:00:00Z');
  });
  it('rejects a single oversized record without acknowledging it', async () => {
    await db.games.put(game('huge', 'x'.repeat(3 * 1024 * 1024)));
    await cloud.syncNow();
    expect(cloud.useCloudSync.getState().status).toBe('error');
    expect((await db.outbox.get('games:huge'))!.synced).not.toBe(true);
  });
  it('merges remote progress and sends the combined state', async () => {
    useStore.getState().hydrate({ ...initial, xp: 500, achievements: ['local'], updatedAt: 1 });
    pulled = [{ collection: 'progress', key: 'state', data: { ...initial, xp: 100, achievements: ['remote'], updatedAt: Date.parse('2029-01-01T00:00:00Z') }, updated_at: '2029-01-01T00:00:00Z' }];
    await cloud.syncNow();
    expect(useStore.getState().xp).toBe(500);
    expect(useStore.getState().achievements).toEqual(['local', 'remote']);
    const sent = fetchMock.mock.calls.filter(([url]) => url.endsWith('/push')).flatMap(([, init]) => JSON.parse(init.body).items);
    expect(sent.find((x: { collection: string }) => x.collection === 'progress').data).toMatchObject({ xp: 500, achievements: ['local', 'remote'] });
  });
  it('batches UTF-8 payloads by 3 MB and 100 records', async () => {
    await db.games.bulkPut(Array.from({ length: 104 }, (_, i) => game(String(i))));
    await db.games.bulkPut(Array.from({ length: 5 }, (_, i) => game(`large${i}`, '♟'.repeat(350_000))));
    await cloud.syncNow();
    const pushes = fetchMock.mock.calls.filter(([url]) => url.endsWith('/push'));
    expect(pushes.length).toBeGreaterThanOrEqual(3);
    for (const [, init] of pushes) {
      expect(JSON.parse(init.body).items.length).toBeLessThanOrEqual(100);
      expect(new TextEncoder().encode(init.body).byteLength).toBeLessThanOrEqual(3 * 1024 * 1024);
    }
    expect(await db.outbox.filter(x => !x.synced).count()).toBe(0);
    expect(cloud.useCloudSync.getState().status).toBe('idle');
  });
  it('applies remote LWW without echo, preserving newer local writes and tombstones', async () => {
    await db.games.put(game('local'));
    await db.games.put(game('deleted')); await db.games.delete('deleted');
    pulled = [
      { collection: 'games', key: 'remote', data: game('wrong-id'), updated_at: '2029-01-01T00:00:00Z' },
      { collection: 'games', key: 'local', data: game('local', 'old'), updated_at: '2020-01-01T00:00:00Z' },
      { collection: 'games', key: 'deleted', data: game('deleted'), updated_at: '2020-01-01T00:00:00Z' },
    ];
    await cloud.syncNow();
    expect(await db.games.get('remote')).toMatchObject({ id: 'remote', updatedAt: Date.parse('2029-01-01T00:00:00Z') });
    expect((await db.games.get('local'))!.pgn).toBe('');
    expect(await db.games.get('deleted')).toBeUndefined();
    const sent = fetchMock.mock.calls.filter(([url]) => url.endsWith('/push')).flatMap(([, init]) => JSON.parse(init.body).items);
    expect(sent.some((x: { key: string }) => x.key === 'remote')).toBe(false);
  });
  it('uploads preexisting local records and pulls before pushing', async () => {
    await db.transaction('rw', db.games, async tx => { suppressSync(tx); await db.games.put(game('legacy')); });
    await cloud.syncNow();
    expect(fetchMock.mock.calls[0][0]).toContain('/pull');
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith('/push') && JSON.parse(init.body).items.some((x: { key: string }) => x.key === 'legacy'))).toBe(true);
    expect(storage.get('hindsight-sync-cursor')).toBe('2030-01-01T00:00:00.000Z');
  });
  it('keeps a concurrently edited record pending after push acknowledgement', async () => {
    await db.games.put(game('race'));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/push')) { await db.games.update('race', { pgn: 'changed' }); return response({ ok: true }); }
      return response({ items: [], now: '2030-01-01T00:00:00Z' });
    });
    await cloud.syncNow();
    expect((await db.outbox.get('games:race'))!.synced).not.toBe(true);
  });
  it('no-ops without auth and detects offline', async () => {
    storage.delete('hindsight-auth'); await cloud.syncNow();
    expect(fetchMock).not.toHaveBeenCalled(); expect(cloud.useCloudSync.getState().status).toBe('off');
    storage.set('hindsight-auth', JSON.stringify({ state: { token: 'test-token' } }));
    vi.stubGlobal('navigator', { onLine: false }); await cloud.syncNow();
    expect(fetchMock).not.toHaveBeenCalled(); expect(cloud.useCloudSync.getState().status).toBe('offline');
  });
  it('retains failed pushes and retries with backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await db.games.put(game('retry'));
    fetchMock.mockImplementation(async () => { throw new Error('network'); });
    cloud.start(); await cloud.syncNow();
    expect(cloud.useCloudSync.getState().status).toBe('error');
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000); await cloud.syncNow();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    expect((await db.outbox.get('games:retry'))!.synced).not.toBe(true);
  });
});
