import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAllGames, fetchPlayerStats, fetchRecentGames, opponentOf, selfOf } from '../chesscom';

const root = 'https://api.chess.com/pub/player/me/games';
const months = [`${root}/2026/09`, `${root}/2026/10`];
const raw = (id: string, end = 1) => ({
  uuid: id, url: `https://chess.com/game/${id}`, pgn: '1. e4 e5', end_time: end,
  time_class: 'rapid', time_control: '600', rated: true, rules: 'chess',
  white: { username: 'Me', rating: 1200, result: 'win' },
  black: { username: 'Other', rating: 1300, result: 'resigned' },
});
const response = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });

beforeEach(() => {
  vi.useFakeTimers();
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('full history', () => {
  it('fetches the archives list and both months newest first, spaced by 300 ms', async () => {
    const times: number[] = [];
    const mock = vi.fn(async (url: string) => {
      times.push(Date.now());
      if (url.endsWith('/archives')) return response({ archives: months });
      return response({ games: url === months[1] ? [raw('new', 3), raw('middle', 2), { ...raw('variant'), rules: 'chess960' }] : [raw('old')] });
    });
    vi.stubGlobal('fetch', mock);
    const batches: string[][] = [];
    const task = fetchAllGames('Me', { onBatch: games => { batches.push(games.map(g => g.id)); } });
    await vi.runAllTimersAsync();
    await task;
    expect(mock.mock.calls.map(call => call[0])).toEqual([`${root}/archives`, months[1], months[0]]);
    expect(batches).toEqual([['new', 'middle'], ['old']]);
    expect(times.slice(1).every((time, i) => time - times[i] >= 300)).toBe(true);
    expect(localStorage.getItem('hindsight-chesscom-history:me')).toBeNull();
  });

  it('retries 429 with exponential backoff and Retry-After', async () => {
    const times: number[] = [];
    const mock = vi.fn(async () => {
      times.push(Date.now());
      if (times.length <= 2) return response({}, 429, times.length === 2 ? { 'Retry-After': '3' } : undefined);
      return response({ archives: [] });
    });
    vi.stubGlobal('fetch', mock);
    const task = fetchAllGames('me', { onBatch: vi.fn() });
    await vi.runAllTimersAsync();
    await task;
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(3000);
  });

  it('resumes after abort without delivering a completed month again', async () => {
    const mock = vi.fn(async (url: string) => url.endsWith('/archives')
      ? response({ archives: months }) : response({ games: [raw(url)] }));
    vi.stubGlobal('fetch', mock);
    const controller = new AbortController();
    const first = vi.fn(() => { controller.abort(); });
    const task = fetchAllGames('Me', { signal: controller.signal, onBatch: first });
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync();
    await rejected;
    expect(first).toHaveBeenCalledTimes(1);
    const second = vi.fn();
    const resumed = fetchAllGames('me', { onBatch: second });
    await vi.runAllTimersAsync();
    await resumed;
    expect(second.mock.calls[0][0][0].id).toBe(months[0]);
    expect(mock.mock.calls.filter(call => call[0] === months[1])).toHaveLength(1);
  });

  it('does not request anything for an already aborted signal', async () => {
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchAllGames('me', { signal: controller.signal, onBatch: vi.fn() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock).not.toHaveBeenCalled();
  });
});

it('normalises current, best and records with missing-class defaults', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ chess_rapid: {
    last: { rating: 1400, date: 1 }, best: { rating: 1500, date: 1 }, record: { win: 3, loss: 2, draw: 1 },
  } })));
  const stats = await fetchPlayerStats('Me');
  expect(stats.rapid).toEqual({ current: 1400, best: 1500, record: { win: 3, loss: 2, draw: 1 } });
  expect(stats.daily).toEqual({ current: null, best: null, record: { win: 0, loss: 0, draw: 0 } });
});

it('preserves recent games and player helpers', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/archives')
    ? response({ archives: months }) : response({ games: [raw(url)] })));
  const games = await fetchRecentGames('me');
  expect(games).toHaveLength(2);
  expect(selfOf(games[0]).username).toBe('Me');
  expect(opponentOf(games[0]).username).toBe('Other');
});
