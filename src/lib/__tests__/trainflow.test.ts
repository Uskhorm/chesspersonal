import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
vi.mock('../engine', () => ({ engine: { analyse: vi.fn() } }));
vi.mock('../verify', () => ({ verifyMove: vi.fn() }));
import { verifyMove } from '../verify';
import { checkTrainMove, createTrainState, trainReducer, trainSummary, fetchTransferPuzzle, type TrainState, type TrainItem } from '../trainflow';
import * as lichess from '../lichess';
import { fetchPuzzle, prefetchPuzzles } from '../lichess';

const item: TrainItem = { kind: 'puzzle', p: { id: 'test', fen: new Chess().fen(),
  solution: ['e2e4', 'e7e5', 'g1f3'], rating: 1000, themes: ['opening'] } };
async function play(s: TrainState, from: string, to: string, promotion?: string) {
  const checking = trainReducer(s, { type: 'checking' });
  return trainReducer(checking, await checkTrainMove(s, from, to, promotion));
}
async function fail() { return play(await play(createTrainState('session', [item], 0), 'd2', 'd4'), 'd2', 'd4'); }

describe('training state machine', () => {
  it.each(['session', 'leak'] as const)('allows one puzzle retry in %s without recording a failure', async (mode) => {
    let s = await play({ ...createTrainState(mode, [item]), combo: 3 }, 'd2', 'd4');
    expect(s).toMatchObject({ phase: 'solve', attempts: 1, results: [] });
    s = await play(s, 'e2', 'e4'); s = await play(s, 'g1', 'f3');
    expect(s.results[0]).toMatchObject({ correct: true, firstTry: false, cleanSolve: false, attempts: 2 });
    expect(s.combo).toBe(3);
  });
  it.each(['session', 'leak', 'rush'] as const)('uses the correct own-drill retry limit in %s', async (mode) => {
    const own: TrainItem = { kind: 'drill', drill: { id: 'retry', fen: new Chess().fen(), bestUci: 'e2e4',
      winBefore: 50, bestSan: 'e4', playedSan: 'a3', motifs: [] } as unknown as import('../types').Drill };
    vi.mocked(verifyMove).mockResolvedValue({ ok: false, exact: false, loss: 50, san: 'd4', fenAfter: new Chess().fen(), mate: false });
    let s = await play(createTrainState(mode, [own]), 'd2', 'd4');
    if (mode !== 'rush') {
      expect(s).toMatchObject({ phase: 'solve', attempts: 1, results: [] });
      s = await play(s, 'd2', 'd4');
    }
    expect(s.phase).toBe('wrong');
    expect(s.results[0]).toMatchObject({ correct: false, cleanSolve: false, attempts: mode === 'rush' ? 1 : 2 });
    s = trainReducer(trainReducer(s, { type: 'explain' }), { type: 'replay' });
    expect(trainReducer(s, { type: 'confirm' })).toBe(s);
    s = trainReducer(s, { type: 'replayTo', step: 1 });
    expect(trainReducer(s, { type: 'confirm' }).phase).toBe('confirm');
  });
  it('fails a rush puzzle on the first wrong move', async () => {
    const s = await play(createTrainState('rush', [item]), 'd2', 'd4');
    expect(s).toMatchObject({ phase: 'wrong', lives: 2, attempts: 1 });
    expect(s.results[0].correct).toBe(false);
  });
  it('holds combo for hinted correct answers, increments clean solves and resets failures', async () => {
    let s = { ...createTrainState('session', [item, item, item]), combo: 4, bestCombo: 4 };
    s = trainReducer(s, { type: 'hint' });
    s = await play(s, 'e2', 'e4'); s = await play(s, 'g1', 'f3');
    expect(s.results[0]).toMatchObject({ hintsUsed: 1, firstTry: false, cleanSolve: false, combo: 4 });
    s = trainReducer(s, { type: 'next', now: 100 });
    s = await play(s, 'e2', 'e4'); s = await play(s, 'g1', 'f3');
    expect(s.results[1]).toMatchObject({ cleanSolve: true, combo: 5 });
    s = trainReducer(s, { type: 'next', now: 200 });
    s = trainReducer(s, { type: 'giveUp', now: 300 });
    expect(s.combo).toBe(0);
  });
  it('fetches same-motif transfers immediately after the source, caps at three and skips rush/failures', async () => {
    const own: TrainItem = { kind: 'drill', drill: { id: 'transfer', fen: new Chess().fen(), bestUci: 'e2e4',
      motifs: ['missed-fork'] } as unknown as import('../types').Drill };
    const fetcher = vi.spyOn(lichess, 'fetchPuzzle');
    let s = createTrainState('session', [own, item]);
    for (let n = 0; n < 3; n++) {
      fetcher.mockResolvedValue({ ...(item as Extract<TrainItem, {kind: 'puzzle'}>).p, id: `transfer-${n}` });
      const transfer = await fetchTransferPuzzle(s);
      expect(fetcher).toHaveBeenLastCalledWith('fork', 'normal');
      expect(transfer?.tag).toBe('Same idea, new position');
      s = trainReducer({ ...s, phase: 'checking' }, { type: 'transfer', index: 0, item: transfer! });
      expect(s.items[1]).toEqual(transfer);
    }
    fetcher.mockClear();
    expect(await fetchTransferPuzzle(s)).toBeUndefined();
    expect(await fetchTransferPuzzle(createTrainState('rush', [own]))).toBeUndefined();
    expect(await fetchTransferPuzzle(createTrainState('session', [item]))).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error('offline'));
    expect(await fetchTransferPuzzle(createTrainState('leak', [own]))).toBeUndefined();
    fetcher.mockResolvedValue((item as Extract<TrainItem, {kind: 'puzzle'}>).p);
    const transfer = (await fetchTransferPuzzle(createTrainState('leak', [own])))!;
    const checking = { ...s, phase: 'checking' as const };
    expect(trainReducer(checking, { type: 'transfer', index: 0, item: transfer })).toBe(checking);
    const fresh = { ...createTrainState('leak', [own, item]), phase: 'checking' as const };
    expect(trainReducer(fresh, { type: 'transfer', index: 0, item: transfer })).toBe(fresh);
    expect(trainReducer(fresh, { type: 'transfer', index: 9, item: transfer })).toBe(fresh);
  });

  afterEach(() => vi.restoreAllMocks());
  it('plays opponent replies and awards a result only after the whole solution', async () => {
    let s = await play(createTrainState('session', [item]), 'e2', 'e4');
    expect(s.phase).toBe('solve'); expect(s.solutionStep).toBe(2);
    expect(s.lastMove).toEqual(['e7', 'e5']); expect(s.results).toEqual([]);
    s = await play(s, 'g1', 'f3');
    expect(s.phase).toBe('solved'); expect(s.results).toHaveLength(1);
    expect(s.combo).toBe(1);
    expect(trainReducer(s, { type: 'next', now: 100 }).phase).toBe('complete');
  });
  it('requires explanation, two replay steps and self-play after a failure', async () => {
    let s = await fail();
    expect(s.phase).toBe('wrong'); expect(s.results[0].correct).toBe(false);
    expect(trainReducer(s, { type: 'next', now: 1 })).toBe(s);
    s = trainReducer(s, { type: 'explain' });
    expect(s.phase).toBe('explain');
    s = trainReducer(s, { type: 'replay' });
    expect(trainReducer(s, { type: 'confirm' })).toBe(s);
    s = trainReducer(s, { type: 'replayTo', step: 3 });
    const replayed = new Chess(); replayed.move('e4'); replayed.move('e5'); replayed.move('Nf3');
    expect(s.fen).toBe(replayed.fen());
    s = trainReducer(s, { type: 'replayTo', step: 1 });
    expect(s.replayStep).toBe(1);
    expect(trainReducer(s, { type: 'confirm' })).toBe(s);
    s = trainReducer(s, { type: 'replayTo', step: 2 });
    s = trainReducer(s, { type: 'confirm' });
    expect(s.phase).toBe('confirm'); expect(s.fen).toBe(item.kind === 'puzzle' ? item.p.fen : '');
    s = await play(s, 'd2', 'd4');
    expect(s.phase).toBe('confirm'); expect(s.results).toHaveLength(1);
    s = await play(s, 'e2', 'e4'); s = await play(s, 'g1', 'f3');
    expect(s.phase).toBe('solved'); expect(s.results[0].corrected).toBe(true);
    expect(s.combo).toBe(0); expect(trainSummary(s).accuracy).toBe(0);
    expect(trainSummary(s).corrected).toBe(1);
  });
  it('uses three progressive hints and marks success with help', async () => {
    let s = createTrainState('session', [item]);
    for (let i = 0; i < 4; i++) s = trainReducer(s, { type: 'hint' });
    expect(s.hintsUsed).toBe(3);
    s = await play(s, 'e2', 'e4'); s = await play(s, 'g1', 'f3');
    expect(s.results[0].firstTry).toBe(false);
  });
  it('ignores stale async results and prevents duplicate submissions', async () => {
    const s = createTrainState('session', [item]);
    const a = await checkTrainMove(s, 'e2', 'e4');
    expect(trainReducer(s, a)).toBe(s);
    const checking = trainReducer(s, { type: 'checking' });
    expect(trainReducer(checking, { type: 'checking' })).toBe(checking);
    expect(trainReducer(checking, { ...a, type: 'checked', index: 9 } as typeof a)).toBe(checking);
  });
  it('does not consume a life for illegal moves', async () => {
    const s = createTrainState('rush', [item]);
    await expect(checkTrainMove(s, 'e2', 'e5')).rejects.toThrow();
    const checking = trainReducer(s, { type: 'checking' });
    expect(trainReducer(checking, { type: 'error', message: 'Illegal move' })).toMatchObject({ phase: 'solve', lives: 3 });
  });
  it('handles rush lives and the wall-clock deadline', () => {
    let s = createTrainState('rush', [item, item, item], 1000);
    s = trainReducer(s, { type: 'tick', now: 181000 });
    expect(s).toMatchObject({ phase: 'complete', timeLeft: 0 });
    s = createTrainState('rush', [item], 0);
    s = trainReducer({ ...s, lives: 1 }, { type: 'giveUp', now: 1 });
    expect(s).toMatchObject({ lives: 0, phase: 'complete' });
    expect(trainSummary(s).failed).toBe(1);
  });
  it('adapts difficulty after five outcomes and resets mode cleanly', () => {
    let s = createTrainState('rush', [item], 0);
    for (let i = 0; i < 5; i++) {
      s = trainReducer({ ...s, index: i, items: Array(6).fill(item), phase: 'solve' }, { type: 'checking' });
      s = trainReducer(s, { type: 'checked', index: i, fenBefore: s.fen, fen: s.fen, ok: true, done: true, step: 3, now: i });
    }
    expect(s.difficulty).toBe('harder');
    expect(trainReducer(s, { type: 'reset', mode: 'leak', now: 10 })).toMatchObject({ mode: 'leak', phase: 'loading', results: [] });
  });
  it('checks complete UCI promotion choice', async () => {
    const promotion: TrainItem = { kind: 'puzzle', p: { id: 'promote',
      fen: '7k/P7/8/8/8/8/8/7K w - - 0 1', solution: ['a7a8n'], themes: [], rating: 1000 } };
    const s = createTrainState('session', [promotion]);
    expect(await checkTrainMove(s, 'a7', 'a8', 'q')).toMatchObject({ ok: false });
    expect(await checkTrainMove(s, 'a7', 'a8', 'n')).toMatchObject({ ok: true, done: true });
  });
  it('delegates own-position alternatives to engine verification', async () => {
    const own: TrainItem = { kind: 'drill', drill: { id: 'd', fen: new Chess().fen(), bestUci: 'e2e4',
      winBefore: 50, bestSan: 'e4', playedSan: 'a3', motifs: [] } as unknown as import('../types').Drill };
    vi.mocked(verifyMove).mockResolvedValue({ ok: true, exact: false, loss: 0, san: 'd4', fenAfter: new Chess().fen(), mate: false });
    const s = await play(createTrainState('session', [own]), 'd2', 'd4');
    expect(verifyMove).toHaveBeenCalledWith(own.drill.fen, 'd2d4', 'e2e4', 50, 3);
    expect(s.phase).toBe('solved');
  });
});

describe('Lichess queue', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses angle and difficulty, reconstructs PGN positions and deduplicates', async () => {
    let n = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      n++;
      return { ok: true, json: async () => ({ game: { pgn: '1. e4 e5 2. Nf3' },
        puzzle: { id: n <= 2 ? 'unique-one' : `unique-${n}`, initialPly: 1, solution: ['e7e5', 'g1f3'], rating: 900, themes: [] } }) };
    });
    vi.stubGlobal('fetch', fetcher);
    const first = await fetchPuzzle('fork', 'easier');
    expect(first.fen).toContain(' b '); expect(first.lastMove).toBe('e2e4');
    await prefetchPuzzles('fork', 'easier');
    const next = await fetchPuzzle('fork', 'easier');
    expect(next.id).not.toBe(first.id);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('difficulty=easier&angle=fork');
    await prefetchPuzzles('fork', 'easier');
  });
  it('gives concurrent consumers distinct puzzles and preserves full FEN responses', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ puzzle: {
      id: `parallel-${n++}`, fen: new Chess().fen(), solution: ['e2e4'], rating: 1200, themes: [],
    } }) })));
    const results = await Promise.all(Array.from({ length: 4 }, () => fetchPuzzle('mate', 'harder')));
    expect(new Set(results.map((p) => p.id)).size).toBe(4);
    expect(results.every((p) => p.fen === new Chess().fen())).toBe(true);
    await prefetchPuzzles('mate', 'harder');
  });
  it('reports HTTP failures without swallowing errors or poisoning the next request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })));
    await expect(fetchPuzzle('test-error', 'hardest')).rejects.toThrow('429');
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ puzzle: {
      id: `recovered-${n++}`, fen: new Chess().fen(), solution: ['e2e4'], rating: 1200, themes: [],
    } }) })));
    expect((await fetchPuzzle('test-error', 'hardest')).id).toContain('recovered');
    await prefetchPuzzles('test-error', 'hardest');
  });
});
