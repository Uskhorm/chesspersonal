import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
vi.mock('../verify', () => ({ verifyMove: vi.fn() }));
// Exercise the hook's board projection without requiring a DOM or extra packages.
const hook = vi.hoisted(() => ({ state: undefined as LearnState | undefined, effects: [] as (() => void)[] }));
vi.mock('react', () => ({
  useReducer: () => [hook.state, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useMemo: (make: () => unknown) => make(),
  useEffect: (effect: () => void) => { hook.effects.push(effect); },
}));
import { hints } from '../coach';
import { verifyMove, type VerifyResult } from '../verify';
import { createInitialLearnState, learnReducer, useLearnFlow, verifyLearnAttempt, type LearnState } from '../learnflow';
import type { AnalysedMove, GameAnalysis } from '../types';

function game(): GameAnalysis {
  const c = new Chess();
  const moves = ['e4', 'e5', 'Nf3', 'Nc6'].map((san, i): AnalysedMove => {
    const fenBefore = c.fen(), b = new Chess(fenBefore);
    const best = b.move(['d4', 'd5', 'Bc4', 'Nf6'][i]);
    const move = c.move(san);
    return { ply: i + 1, color: move.color, san, uci: move.from + move.to, from: move.from, to: move.to, fenBefore, fenAfter: c.fen(), scoreBefore: { cp: 0 }, scoreAfter: { cp: -200 }, winBefore: 50, winAfter: 25, epLoss: .25, accuracy: 30, bestUci: best.from + best.to, bestSan: best.san, bestLineSan: [best.san], replyLineSan: [], cls: 'mistake', motifs: [], comment: '' };
  });
  return { gameId: 'test', depth: 16, createdAt: 0, moves, winCurve: [], white: {} as GameAnalysis['white'], black: {} as GameAnalysis['black'] };
}
const wrong = (): VerifyResult => ({ ok: false, exact: false, loss: 25, san: 'e4', fenAfter: game().moves[0].fenAfter, mate: false });
function attempt(s: LearnState, ok = false) {
  s = learnReducer(s, { type: 'checking', lastMove: ['e2', 'e4'] });
  return learnReducer(s, { type: 'verified', requestId: s.requestId, result: { ...wrong(), ok }, feedback: 'Concrete feedback' });
}
const start = () => learnReducer(createInitialLearnState(game(), 'w'), { type: 'start' });

describe('pure learn reducer', () => {
  it('selects the user moments and starts without advancing', () => {
    const s = createInitialLearnState(game(), 'w');
    expect(s.moments.map(m => m.ply)).toEqual([1, 3]);
    expect(s.phase).toBe('solve');
    expect(learnReducer(s, { type: 'start' }).phase).toBe('solve');
    expect(createInitialLearnState({ ...game(), moves: [] }, 'w').phase).toBe('complete');
  });

  it('excludes inaccuracies and other colours, retaining mistake, miss, and blunder', () => {
    const analysis = game();
    const base = analysis.moves[0];
    analysis.moves = (['inaccuracy', 'mistake', 'miss', 'blunder', 'good'] as const).flatMap((cls, i) => [
      { ...base, cls, ply: i * 2 + 1 }, { ...base, cls, color: 'b' as const, ply: i * 2 + 2 },
    ]);
    expect(createInitialLearnState(analysis, 'w').moments.map(m => m.cls)).toEqual(['mistake', 'miss', 'blunder']);
  });
  it('blocks context browsing during verification', () => {
    const s = learnReducer(start(), { type: 'checking', lastMove: ['e2', 'e4'] });
    expect(learnReducer(s, { type: 'stepContext', delta: 1 })).toBe(s);
  });
  it('rewatches from confirm without forgetting how much replay was seen', () => {
    let s = learnReducer(start(), { type: 'giveUp' });
    s = learnReducer(s, { type: 'replayTo', step: 1 });
    s = learnReducer(s, { type: 'beginConfirm' });
    const seen = s.progress[0].replaySeen;
    s = learnReducer(s, { type: 'watchAgain' });
    expect(s.phase).toBe('replay');
    expect(s.progress[0].replayStep).toBe(0);
    expect(s.progress[0].replaySeen).toBe(seen);
    expect(learnReducer(s, { type: 'beginConfirm' }).phase).toBe('confirm');
    expect(learnReducer(start(), { type: 'watchAgain' }).phase).toBe('solve');
  });
  it('skips unfinished moments as failed and completes on the last skip', () => {
    let s = learnReducer(start(), { type: 'hint' });
    s = learnReducer(s, { type: 'skipMoment' });
    expect(s.index).toBe(1);
    expect(s.phase).toBe('solve');
    expect(s.results[0]).toBe('failed');
    expect(s.progress[0].hintsUsed).toBe(1);
    expect(s.progress[0].confirmed).toBe(false);
    s = learnReducer(s, { type: 'skipMoment' });
    expect(s.phase).toBe('complete');
    expect(s.results).toEqual(['failed', 'failed']);
  });
  it('finishes normally after an earlier moment was explicitly skipped', () => {
    let s = learnReducer(start(), { type: 'skipMoment' });
    s = attempt(s, true);
    expect(learnReducer(s, { type: 'nextMoment' }).phase).toBe('complete');
  });
  it('does not overwrite an earned result on skip and invalidates pending checks', () => {
    let s = learnReducer(attempt(start(), true), { type: 'skipMoment' });
    expect(s.results[0]).toBe('first-try');
    s = learnReducer(s, { type: 'checking', lastMove: ['f1', 'c4'] });
    const id = s.requestId;
    s = learnReducer(s, { type: 'skipMoment' });
    expect(learnReducer(s, { type: 'verified', requestId: id, result: { ...wrong(), ok: true }, feedback: 'late' })).toBe(s);
    expect(learnReducer(s, { type: 'goToMoment', index: 1 }).phase).toBe('solve');
  });
  it('retains feedback for retry, then explains after two wrong tries', () => {
    let s = attempt(start());
    expect(s.phase).toBe('wrong');
    expect(s.index).toBe(0);
    expect(s.progress[0].feedback).toBe('Concrete feedback');
    expect(learnReducer(s, { type: 'nextMoment' })).toBe(s);
    s = attempt(s);
    expect(s.phase).toBe('explain');
    expect(s.progress[0].attempts).toBe(2);
    expect(s.results).toEqual([]);
  });
  it('requires replay and the correct first move after giving up', () => {
    let s = learnReducer(start(), { type: 'giveUp' });
    expect(s.phase).toBe('explain');
    expect(learnReducer(s, { type: 'beginConfirm' })).toBe(s);
    s = learnReducer(s, { type: 'beginReplay' });
    expect(s.phase).toBe('replay');
    expect(learnReducer(s, { type: 'beginConfirm' })).toBe(s);
    s = learnReducer(s, { type: 'replayStep', delta: 1 });
    expect(s.progress[0].replayStep).toBe(1);
    s = learnReducer(s, { type: 'replayStep', delta: -1 });
    expect(s.progress[0].replayStep).toBe(0);
    s = learnReducer(s, { type: 'beginConfirm' });
    expect(s.phase).toBe('confirm');
    s = learnReducer(s, { type: 'confirmMove', uci: 'e2e4' });
    expect(s.phase).toBe('confirm');
    expect(learnReducer(s, { type: 'nextMoment' })).toBe(s);
    s = learnReducer(s, { type: 'confirmMove', uci: 'd2d4' });
    expect(s.phase).toBe('solved');
    expect(s.results[0]).toBe('failed');
    expect(s.index).toBe(0);
    s = learnReducer(s, { type: 'nextMoment' });
    expect(s.index).toBe(1);
  });
  it('accepts verified alternatives and classifies first try versus help', () => {
    expect(attempt(start(), true).results[0]).toBe('first-try');
    expect(attempt(learnReducer(start(), { type: 'hint' }), true).results[0]).toBe('with-help');
    expect(attempt(attempt(start()), true).results[0]).toBe('with-help');
  });
  it('caps hints at three and restores attempts/hints on navigation', () => {
    let s = start();
    for (let i = 0; i < 5; i++) s = learnReducer(s, { type: 'hint' });
    s = attempt(s);
    s = learnReducer(s, { type: 'goToMoment', index: 1 });
    expect(s.phase).toBe('solve');
    s = learnReducer(s, { type: 'prevMoment' });
    expect(s.phase).toBe('wrong');
    expect(s.progress[0].hintsUsed).toBe(3);
    expect(s.progress[0].attempts).toBe(1);
    expect(learnReducer(s, { type: 'goToMoment', index: 99 })).toBe(s);
  });
  it('browses the preceding game moves and returns without losing puzzle progress', () => {
    let s = learnReducer(start(), { type: 'goToMoment', index: 1 });
    s = learnReducer(s, { type: 'start' });
    s = learnReducer(s, { type: 'stepContext', delta: -1 });
    expect(s.contextPly).toBe(1);
    expect(s.browsingContext).toBe(true);
    s = learnReducer(s, { type: 'stepContext', delta: -99 });
    expect(s.contextPly).toBe(0);
    s = learnReducer(s, { type: 'stepContext', delta: 99 });
    expect(s.contextPly).toBe(4);
    expect(learnReducer(s, { type: 'checking', lastMove: ['f1', 'c4'] })).toBe(s);
    s = learnReducer(s, { type: 'backToPuzzle' });
    expect(s.phase).toBe('solve');
    expect(s.browsingContext).toBe(false);
  });
  it('ignores stale engine replies after navigation, give-up, and reset', () => {
    let s = learnReducer(start(), { type: 'checking', lastMove: ['e2', 'e4'] });
    const reply = { type: 'verified' as const, requestId: s.requestId, result: { ...wrong(), ok: true }, feedback: 'old' };
    const nav = learnReducer(s, { type: 'goToMoment', index: 1 });
    expect(learnReducer(nav, reply)).toBe(nav);
    const givenUp = learnReducer(s, { type: 'giveUp' });
    expect(learnReducer(givenUp, reply)).toBe(givenUp);
    s = learnReducer(s, { type: 'reset', analysis: game(), userColor: 'w' });
    s = learnReducer(s, { type: 'start' });
    s = learnReducer(s, { type: 'checking', lastMove: ['e2', 'e4'] });
    expect(learnReducer(s, reply)).toBe(s);
  });
  it('worker failures allow retry without counting a chess mistake', () => {
    let s = learnReducer(start(), { type: 'checking', lastMove: ['e2', 'e4'] });
    s = learnReducer(s, { type: 'verificationError', requestId: s.requestId, message: 'Engine unavailable' });
    expect(s.phase).toBe('wrong');
    expect(s.progress[0].attempts).toBe(0);
  });
  it('does not mark the session complete while skipped moments remain', () => {
    let s = learnReducer(start(), { type: 'goToMoment', index: 1 });
    s = learnReducer(s, { type: 'start' });
    s = attempt(s, true);
    expect(learnReducer(s, { type: 'nextMoment' }).phase).toBe('solved');
    s = learnReducer(s, { type: 'prevMoment' });
    s = attempt(s, true);
    s = learnReducer(s, { type: 'nextMoment' });
    expect(learnReducer(s, { type: 'nextMoment' }).phase).toBe('complete');
  });
});

describe('mocked worker verification', () => {
  beforeEach(() => vi.mocked(verifyMove).mockReset());
  it('uses the existing verifyMove signature and accepts a good alternative', async () => {
    const m = game().moves[0];
    vi.mocked(verifyMove).mockResolvedValue({ ...wrong(), ok: true, loss: 1 });
    const checked = await verifyLearnAttempt(m, 'e2e4');
    expect(verifyMove).toHaveBeenCalledWith(m.fenBefore, 'e2e4', m.bestUci, m.winBefore);
    expect(checked.feedback).toContain('also works');
  });
  it('uses saved concrete reply coaching only for the matching position, without revealing the best move', async () => {
    const m = game().moves[0];
    vi.mocked(verifyMove).mockResolvedValue(wrong());
    const checked = await verifyLearnAttempt(m, 'e2e4');
    expect(checked.feedback.length).toBeGreaterThan(20); // concrete coaching (wording owned by coach.ts)
    expect(checked.feedback).not.toContain('Instead');
    expect(checked.feedback).not.toContain('d4');
  });
  it('falls back to a measured eval drop for an unfamiliar attempt', async () => {
    const result = { ...wrong(), fenAfter: new Chess().fen(), san: 'a3' };
    vi.mocked(verifyMove).mockResolvedValue(result);
    expect((await verifyLearnAttempt(game().moves[0], 'a2a3')).feedback).toContain('from 50% to 25%');
  });
});


describe('learn board arrows', () => {
  function board(s: LearnState) {
    hook.state = s;
    return useLearnFlow(s.analysis, s.userColor).board;
  }
  const best = { from: 'd2', to: 'd4', brush: 'best' };
  const played = { from: 'e2', to: 'e4', brush: 'played' };

  it('shows the correction arrow when an explanation is revealed', () => {
    const s = learnReducer(start(), { type: 'giveUp' });
    expect(board(s).arrows).toEqual([best]);
    expect(board(s).fen).toBe(s.moments[0].fenBefore);
    expect(board(attempt(attempt(start()))).arrows).toEqual([best]);
  });

  it('shows the best arrow even when a verified alternative was played', () => {
    const s = attempt(start(), true);
    expect(board(s).arrows).toEqual([best]);
    expect(board(s).fen).toBe(s.progress[0].attemptFen);
    expect(board(s).lastMove).toEqual(['e2', 'e4']);
  });

  it('shows the actual failed attempt without leaking the best move', () => {
    const s = attempt(start());
    expect(board(s).arrows).toEqual([played]);
    expect(board(s).fen).toBe(s.moments[0].fenBefore);
  });

  it('keeps hint arrows alongside the attempted move', () => {
    let s = start();
    for (let i = 0; i < 3; i++) s = learnReducer(s, { type: 'hint' });
    expect(board(attempt(s)).arrows).toEqual([{ ...best, brush: 'hint' }, played]);
  });

  it('handles a wrong phase with no attempted move', () => {
    const s = start();
    s.phase = 'wrong';
    s.progress[0].phase = 'wrong';
    expect(board(s).arrows).toEqual([]);
  });

  it('hides puzzle arrows while browsing game context', () => {
    for (const s of [attempt(start()), attempt(start(), true), learnReducer(start(), { type: 'giveUp' })]) {
      expect(board(learnReducer(s, { type: 'stepContext', delta: 0 })).arrows).toEqual([]);
    }
  });

  it('keeps solve and confirm phases free of solution arrows and replay arrows intact', () => {
    expect(board(start()).arrows).toEqual([]);
    let s = learnReducer(learnReducer(start(), { type: 'giveUp' }), { type: 'beginReplay' });
    expect(board(s).arrows).toEqual([best]);
    s = learnReducer(s, { type: 'replayStep', delta: 1 });
    expect(board(s).arrows).toEqual([]);
    s = learnReducer(s, { type: 'beginConfirm' });
    expect(board(s).arrows).toEqual([]);
  });
});


describe('flow additions and context restoration', () => {
  function flow(s: LearnState) {
    hook.state = s;
    hook.effects = [];
    return useLearnFlow(s.analysis, s.userColor);
  }
  it('keeps replay captions on the played move and arrows on the next move, including rewind', () => {
    const analysis = game();
    const fen = 'rn3rk1/3pppbp/b4np1/1BpPP3/Pq6/2N5/1PQB1PPP/R3K1NR b KQ - 0 12';
    const line = ['Bxb5', 'Nxb5', 'Qe4+', 'Qxe4'];
    analysis.moves = [{ ...analysis.moves[1], fenBefore: fen, bestLineSan: line, bestSan: 'Bxb5', bestUci: 'a6b5' }];
    let s = learnReducer(createInitialLearnState(analysis, 'b'), { type: 'giveUp' });
    s = learnReducer(s, { type: 'beginReplay' });
    const c = new Chess(fen);
    const moves = line.map(san => c.move(san));
    for (const step of [0, 1, 2, 3, 4, 2, 0]) {
      s = learnReducer(s, { type: 'replayTo', step });
      const view = flow(s), played = moves[step - 1], next = moves[step];
      expect(view.board.fen).toBe(played?.after ?? fen);
      expect(view.board.lastMove).toEqual(played ? [played.from, played.to] : undefined);
      expect(view.board.arrows).toEqual(next ? [{ from: next.from, to: next.to, brush: 'best' }] : []);
      expect(view.plan?.lineExplained[step - 1]?.san).toBe(played?.san);
      if (step === 1) expect(view.plan?.lineExplained[step - 1]?.note).toBe('Takes the bishop on b5.');
      if (step === 3) expect(view.plan?.lineExplained[step - 1]?.note).toBe('Forks the king on e1 and queen on c2.');
    }
  });
  it.each(['intro', 'solve', 'wrong', 'solved', 'explain', 'replay', 'confirm', 'complete'] as const)('restores the exact %s board and progress after browsing', phase => {
    let s = attempt(learnReducer(start(), { type: 'hint' }), true);
    s = { ...s, phase, progress: s.progress.map((p, i) => i ? p : { ...p, phase, replayStep: 1, replaySeen: 1 }) };
    const before = flow(s);
    let browsed = learnReducer(s, { type: 'stepContext', delta: 99 });
    expect(browsed.contextPly).toBe(4);
    expect(flow(browsed).board.fen).toBe(s.analysis.moves[3].fenAfter);
    expect(flow(browsed).board.movable).toBe(false);
    browsed = learnReducer(browsed, { type: 'stepContext', delta: -99 });
    expect(flow(browsed).board.fen).toBe(s.analysis.moves[0].fenBefore);
    const restored = learnReducer(browsed, { type: 'backToPuzzle' });
    expect(restored.phase).toBe(phase);
    expect(restored.progress).toEqual(s.progress);
    expect(flow(restored).board).toEqual(before.board);
    expect(flow(restored).replay).toEqual(before.replay);
  });
  it('allows browsing a completed session with no training moments', () => {
    const analysis = game();
    analysis.moves = analysis.moves.map(m => ({ ...m, cls: 'good' }));
    const initial = createInitialLearnState(analysis, 'w');
    const browsed = learnReducer(initial, { type: 'stepContext', delta: 3 });
    expect(browsed.phase).toBe('complete');
    expect(flow(browsed).board.fen).toBe(analysis.moves[2].fenAfter);
    expect(learnReducer(browsed, { type: 'backToPuzzle' })).toEqual(initial);
  });
  it('exposes played-to-best recovery percentages in mover POV for either colour', () => {
    const analysis = game();
    analysis.moves[1] = { ...analysis.moves[1], winBefore: 81, winAfter: 12 };
    expect(flow(createInitialLearnState(analysis, 'b')).recovered).toEqual({ from: 12, to: 81 });
    expect(flow(start()).recovered).toEqual({ from: 25, to: 50 });
    expect(flow(createInitialLearnState({ ...analysis, moves: [] }, 'w')).recovered).toBeUndefined();
    expect(typeof flow(start()).actions.watchAgain).toBe('function');
    expect(typeof flow(start()).actions.skipMoment).toBe('function');
  });
  it.each(['success', 'skip', 'confirm'] as const)('reports per-moment hints and attempts once on %s', path => {
    let s = attempt(learnReducer(start(), { type: 'hint' }));
    if (path === 'success') s = attempt(s, true);
    if (path === 'skip') s = learnReducer(s, { type: 'skipMoment' });
    if (path === 'confirm') {
      s = learnReducer(s, { type: 'giveUp' });
      s = learnReducer(s, { type: 'replayTo', step: 1 });
      s = learnReducer(s, { type: 'beginConfirm' });
      s = learnReducer(s, { type: 'confirmMove', uci: 'd2d4' });
    }
    hook.state = s;
    hook.effects = [];
    const onResult = vi.fn();
    useLearnFlow(s.analysis, s.userColor, { onResult });
    // The second effect reports results; the first resets the session on mount.
    hook.effects[1]();
    hook.effects[1]();
    expect(onResult).toHaveBeenCalledExactlyOnceWith(s.moments[0], path === 'success' ? 'with-help' : 'failed', { hintsUsed: 1, attempts: path === 'success' ? 2 : 1 });
  });
});


it('retains every revealed hint square and adds the level-three arrow', () => {
  let s = start();
  const expected = new Set<string>();
  const hs = hints(s.moments[0]);
  for (let level = 1; level <= 3; level++) {
    s = learnReducer(s, { type: 'hint' });
    hs[level - 1].highlight?.squares?.forEach(sq => expected.add(sq));
    hook.state = s;
    const view = useLearnFlow(s.analysis, s.userColor);
    expect(view.hint?.highlight?.squares?.length).toBeGreaterThan(0);
    expect(view.board.highlights).toEqual([...expected]);
    expect(view.board.arrows).toEqual(level === 3 ? [{ from: 'd2', to: 'd4', brush: 'hint' }] : []);
  }
});
