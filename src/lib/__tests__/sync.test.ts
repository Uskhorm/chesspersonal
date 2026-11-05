import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { db } from '../db';
import type { GameAnalysis, StoredGame } from '../types';

vi.mock('../analysis', () => ({ analysePgn: vi.fn() }));
vi.mock('../chesscom', () => ({ fetchRecentGames: vi.fn(), opponentOf: (g: StoredGame) => g.black }));
vi.mock('../bus', () => ({ emit: vi.fn() }));
vi.mock('../store', () => ({ useStore: create(() => ({ username: 'me' as string | null,
  settings: { depth: 16, notify: false, autoAnalyse: false }, setSynced: vi.fn(), unlock: vi.fn() })) }));
import { analysePgn } from '../analysis';
import { fetchRecentGames } from '../chesscom';
import { useStore } from '../store';
import { analyseRecent, enqueueAnalysis, pauseAnalysis, startAutoSync, syncGames, useQueue } from '../sync';

let hidden = false;
const doc = new EventTarget();
Object.defineProperty(doc, 'hidden', { get: () => hidden });
vi.stubGlobal('document', doc);
function visibility(value: boolean) { hidden = value; doc.dispatchEvent(new Event('visibilitychange')); }
function game(i: number): StoredGame {
  return { id: String(i), endTime: i, pgn: 'pgn', url: '', timeClass: 'rapid', timeControl: '600', rated: true,
    white: { username: 'me', rating: 1000, result: 'win' }, black: { username: 'them', rating: 1000, result: 'loss' },
    userColor: 'w', userResult: 'win', analysed: false };
}
function analysis(id: string): GameAnalysis {
  const side = { accuracy: 80, estRating: 1000, counts: { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, forced: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 }, phases: { opening: null, middlegame: null, endgame: null } };
  return { gameId: id, depth: 16, createdAt: 0, moves: [], winCurve: [], white: side, black: side };
}
async function idle() {
  await vi.waitFor(() => { expect(useQueue.getState().current).toBeNull(); expect(useQueue.getState().queued).toEqual([]); });
}
beforeEach(async () => {
  visibility(false);
  pauseAnalysis(false);
  await idle();
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  useStore.setState({ username: null });
  useStore.setState({ username: 'me' });
  useQueue.setState({ current: null, queued: [], batchTotal: 0, batchDone: 0, error: null });
  vi.mocked(fetchRecentGames).mockReset().mockResolvedValue([]);
  vi.mocked(analysePgn).mockReset().mockImplementation(async id => analysis(id));
});
afterEach(() => { vi.useRealTimers(); visibility(false); pauseAnalysis(false); });

it('first sync queues ten newest unanalysed games, including existing local history', async () => {
  await db.games.bulkPut(Array.from({ length: 13 }, (_, i) => game(i)));
  await db.games.update('12', { analysed: true });
  pauseAnalysis(true);
  await syncGames();
  expect(useQueue.getState()).toMatchObject({ queued: ['11','10','9','8','7','6','5','4','3','2'], batchTotal: 10, batchDone: 0 });
  pauseAnalysis(false);
  await idle();
  expect(vi.mocked(analysePgn).mock.calls.map(c => c[0])).toEqual(['11','10','9','8','7','6','5','4','3','2']);
  expect(useQueue.getState().batchDone).toBe(10);
  expect((await db.games.get('11'))?.analysed).toBe(true);
});

it('later sync queues all new games newest first and does not requeue the backlog', async () => {
  await syncGames();
  vi.mocked(fetchRecentGames).mockResolvedValue([game(2), game(4), game(3)]);
  pauseAnalysis(true);
  await syncGames();
  await syncGames();
  expect(useQueue.getState().queued).toEqual(['4', '3', '2']);
  pauseAnalysis(false);
  await idle();
  expect(analysePgn).toHaveBeenCalledTimes(3);
});

it('resets the initial selection on sign-in and retries after a failed fetch', async () => {
  vi.mocked(fetchRecentGames).mockRejectedValueOnce(new Error('offline'));
  await syncGames();
  expect(useQueue.getState().error).toBe('offline');
  await db.games.put(game(1));
  await syncGames();
  await idle();
  await db.games.put(game(2));
  useStore.setState({ username: null });
  useStore.setState({ username: 'me' });
  await syncGames();
  await idle();
  expect(vi.mocked(analysePgn).mock.calls.map(c => c[0])).toEqual(['1', '2']);
});

it('supports explicit limits, priority, duplicate waiters and cached analyses', async () => {
  await db.games.bulkPut([game(1), game(2), game(3)]);
  pauseAnalysis(true);
  await analyseRecent(2);
  const first = enqueueAnalysis('2', true);
  const duplicate = enqueueAnalysis('2');
  expect(useQueue.getState()).toMatchObject({ queued: ['2', '3'], batchTotal: 2 });
  pauseAnalysis(false);
  expect(await first).toEqual(await duplicate);
  await idle();
  await enqueueAnalysis('2');
  expect(analysePgn).toHaveBeenCalledTimes(2);
  expect(useQueue.getState()).toMatchObject({ batchTotal: 1, batchDone: 1 });
});

it('rejects missing or failed games and continues to the next queued game', async () => {
  await db.games.bulkPut([game(1), game(2)]);
  vi.mocked(analysePgn).mockRejectedValueOnce(new Error('engine failed'));
  pauseAnalysis(true);
  const missing = expect(enqueueAnalysis('missing')).rejects.toThrow('Game not found');
  const failed = expect(enqueueAnalysis('1')).rejects.toThrow('engine failed');
  const good = enqueueAnalysis('2');
  pauseAnalysis(false);
  await Promise.all([missing, failed, good]);
  await idle();
  expect(useQueue.getState().batchDone).toBe(3);
});

it('pauses after five hidden minutes and resumes when visible', async () => {
  await db.games.put(game(1));
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  visibility(true);
  await vi.advanceTimersByTimeAsync(300_000);
  const result = enqueueAnalysis('1');
  expect(useQueue.getState().queued).toEqual(['1']);
  expect(analysePgn).not.toHaveBeenCalled();
  visibility(false);
  vi.useRealTimers();
  await result;
  await idle();
});

it('allows work during the hidden grace period and training pauses between games', async () => {
  await db.games.bulkPut([game(1), game(2)]);
  visibility(true);
  let finish!: (a: GameAnalysis) => void;
  vi.mocked(analysePgn).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const one = enqueueAnalysis('1');
  const two = enqueueAnalysis('2');
  await vi.waitFor(() => expect(analysePgn).toHaveBeenCalledTimes(1));
  pauseAnalysis(true);
  finish(analysis('1'));
  await one;
  expect(useQueue.getState().queued).toEqual(['2']);
  pauseAnalysis(false);
  await two;
  await idle();
});

it('auto-sync reacts to sign-in and its cleanup removes polling and subscription', async () => {
  useStore.setState({ username: null });
  const stop = startAutoSync();
  useStore.setState({ username: 'me' });
  await vi.waitFor(() => expect(fetchRecentGames).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(useQueue.getState().syncing).toBe(false));
  stop();
  useStore.setState({ username: 'other' });
  expect(fetchRecentGames).toHaveBeenCalledTimes(1);
});
