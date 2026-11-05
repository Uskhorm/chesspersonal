import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Chess } from 'chess.js';
import type { Arrow } from '../components/Board';
import { bestMovePlan, explainMove, hints, replaySan, type Explanation, type Hint, type MovePlan } from './coach';
import type { AnalysedMove, Color, GameAnalysis } from './types';
import { verifyMove, type VerifyResult } from './verify';

export type LearnPhase = 'intro' | 'solve' | 'checking' | 'wrong' | 'solved' | 'explain' | 'replay' | 'confirm' | 'complete';
export type LearnResult = 'first-try' | 'with-help' | 'failed';
export interface MomentProgress {
  phase: LearnPhase;
  attempts: number;
  hintsUsed: number;
  replayStep: number;
  replaySeen: number;
  confirmed: boolean;
  gaveUp: boolean;
  feedback?: string;
  attemptFen?: string;
  lastMove?: [string, string];
  result?: LearnResult;
}
export interface LearnState {
  analysis: GameAnalysis;
  userColor: Color;
  moments: AnalysedMove[];
  index: number;
  phase: LearnPhase;
  contextPly: number;
  browsingContext: boolean;
  progress: MomentProgress[];
  /** Sparse by moment index until a result is earned. */
  results: LearnResult[];
  requestId: number;
}
export type LearnAction =
  | { type: 'reset'; analysis: GameAnalysis; userColor: Color }
  | { type: 'start' | 'hint' | 'giveUp' | 'backToPuzzle' | 'beginReplay' | 'beginConfirm' | 'nextMoment' | 'prevMoment' | 'watchAgain' | 'skipMoment' }
  | { type: 'goToMoment'; index: number }
  | { type: 'stepContext'; delta: number }
  | { type: 'replayTo'; step: number }
  | { type: 'replayStep'; delta: 1 | -1 }
  | { type: 'checking'; lastMove: [string, string] }
  | { type: 'verified'; requestId: number; result: VerifyResult; feedback: string }
  | { type: 'verificationError'; requestId: number; message: string }
  | { type: 'confirmMove'; uci: string };

const fresh = (): MomentProgress => ({ phase: 'solve', attempts: 0, hintsUsed: 0, replayStep: 0, replaySeen: 0, confirmed: false, gaveUp: false });
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.trunc(n)));
const key = new Set(['mistake', 'miss', 'blunder']);

export function createInitialLearnState(analysis: GameAnalysis, userColor: Color): LearnState {
  const moments = analysis.moves.filter(m => m.color === userColor && key.has(m.cls));
  return { analysis, userColor, moments, index: 0, phase: moments.length ? 'solve' : 'complete', contextPly: moments[0] ? moments[0].ply - 1 : 0, browsingContext: false, progress: moments.map(fresh), results: [], requestId: 0 };
}
function update(s: LearnState, patch: Partial<MomentProgress>): LearnState {
  const progress = [...s.progress];
  progress[s.index] = { ...progress[s.index], ...patch };
  const results = [...s.results];
  if (patch.result) results[s.index] = patch.result;
  return { ...s, progress, results, phase: progress[s.index].phase };
}
function navigate(s: LearnState, index: number): LearnState {
  if (!Number.isInteger(index) || index < 0 || index >= s.moments.length) return s;
  // Leaving a pending verification cancels its authority to change this session.
  let state = s.phase === 'checking' ? update(s, { phase: 'solve' }) : s;
  state = { ...state, index, phase: state.progress[index].phase, contextPly: state.moments[index].ply - 1, browsingContext: false, requestId: state.requestId + 1 };
  return state;
}
export function learnReducer(state: LearnState, action: LearnAction): LearnState {
  if (action.type === 'reset') return { ...createInitialLearnState(action.analysis, action.userColor), requestId: state.requestId + 1 };
  // Context is independent of puzzle progress, including an empty completed session.
  if (action.type === 'stepContext') {
    if (state.phase === 'checking' || !Number.isFinite(action.delta)) return state;
    const lastPly = Math.max(0, ...state.analysis.moves.map(move => move.ply));
    return { ...state, contextPly: clamp(state.contextPly + action.delta, lastPly), browsingContext: true };
  }
  if (action.type === 'backToPuzzle') return { ...state, browsingContext: false, contextPly: state.moments[state.index]?.ply ? state.moments[state.index].ply - 1 : 0 };
  const m = state.moments[state.index], p = state.progress[state.index];
  if (!m || !p) return state;
  switch (action.type) {
    case 'goToMoment': return navigate(state, action.index);
    case 'prevMoment': return navigate(state, state.index - 1);
    case 'nextMoment': {
      if (!p.confirmed) return state;
      if (state.index < state.moments.length - 1) return navigate(state, state.index + 1);
      if (state.moments.every((_, i) => (state.progress[i].confirmed || state.results[i] === 'failed'))) return { ...state, phase: 'complete', requestId: state.requestId + 1 };
      return state;
    }
    case 'skipMoment': {
      const skipped = update(state, { phase: p.phase === 'checking' ? 'solve' : p.phase, result: p.result ?? 'failed' });
      if (state.index < state.moments.length - 1) return navigate(skipped, state.index + 1);
      return { ...skipped, phase: 'complete', browsingContext: false, requestId: state.requestId + 1 };
    }
    case 'watchAgain': return state.phase === 'confirm' ? update({ ...state, browsingContext: false }, { phase: 'replay', replayStep: 0 }) : state;
    case 'start': return state.phase === 'intro' ? update(state, { phase: 'solve' }) : state;
    case 'hint': return ['intro', 'solve', 'wrong'].includes(state.phase) ? update(state, { phase: state.phase === 'intro' ? 'solve' : state.phase, hintsUsed: Math.min(3, p.hintsUsed + 1) }) : state;
    case 'checking': return !state.browsingContext && ['solve', 'wrong'].includes(state.phase) ? { ...update(state, { phase: 'checking', lastMove: action.lastMove }), requestId: state.requestId + 1 } : state;
    case 'verified': {
      if (state.phase !== 'checking' || action.requestId !== state.requestId) return state;
      const attempts = p.attempts + 1;
      if (action.result.ok) return update(state, { phase: 'solved', attempts, confirmed: true, result: p.result ?? (attempts === 1 && !p.hintsUsed ? 'first-try' : 'with-help'), feedback: action.feedback, attemptFen: action.result.fenAfter });
      return update(state, { phase: attempts >= 2 ? 'explain' : 'wrong', attempts, gaveUp: attempts >= 2, feedback: action.feedback, attemptFen: undefined });
    }
    case 'verificationError': return state.phase === 'checking' && action.requestId === state.requestId ? update(state, { phase: 'wrong', feedback: action.message }) : state;
    case 'giveUp': return ['intro', 'solve', 'wrong', 'checking'].includes(state.phase) ? { ...update(state, { phase: 'explain', gaveUp: true }), browsingContext: false, requestId: state.requestId + 1 } : state;
    case 'beginReplay': return ['explain', 'solved', 'confirm'].includes(state.phase) ? update({ ...state, browsingContext: false }, { phase: 'replay', replayStep: 0 }) : state;
    case 'replayStep': {
      if (state.phase === 'explain') return learnReducer(learnReducer(state, { type: 'beginReplay' }), { type: 'replayTo', step: Math.max(0, action.delta) });
      if (state.phase !== 'replay') return state;
      const total = bestMovePlan(m).line.length;
      if (action.delta === 1 && p.replayStep === total && p.replaySeen === total && total > 0) return update(state, { phase: 'confirm', attemptFen: undefined, lastMove: undefined });
      return learnReducer(state, { type: 'replayTo', step: p.replayStep + action.delta });
    }
    case 'replayTo': {
      if (!['explain', 'replay', 'solved', 'confirm'].includes(state.phase) || !Number.isFinite(action.step)) return state;
      const step = clamp(action.step, bestMovePlan(m).line.length);
      return update({ ...state, browsingContext: false }, { phase: 'replay', replayStep: step, replaySeen: Math.max(p.replaySeen, step) });
    }
    case 'beginConfirm': return state.phase === 'replay' && p.replaySeen >= bestMovePlan(m).line.length && p.replaySeen > 0 ? update(state, { phase: 'confirm', lastMove: undefined, attemptFen: undefined }) : state;
    case 'confirmMove': {
      if (state.phase !== 'confirm' || state.browsingContext) return state;
      if (action.uci !== m.bestUci) return update(state, { feedback: `Try the first move you just replayed, starting on ${m.bestUci.slice(0, 2)}.` });
      const c = new Chess(m.fenBefore);
      try {
        const move = c.move({ from: action.uci.slice(0, 2), to: action.uci.slice(2, 4), promotion: action.uci[4] });
        return update(state, { phase: 'solved', confirmed: true, result: p.result ?? (p.gaveUp ? 'failed' : 'with-help'), feedback: `${move.san}: correction played. Continue when you are ready.`, attemptFen: c.fen(), lastMove: [move.from, move.to] });
      } catch { return state; }
    }
  }
}

/** Kept separate so worker verification can be mocked without mounting React. */
export async function verifyLearnAttempt(moment: AnalysedMove, uci: string): Promise<{ result: VerifyResult; feedback: string }> {
  const result = await verifyMove(moment.fenBefore, uci, moment.bestUci, moment.winBefore);
  if (result.ok) return { result, feedback: `${result.san} ${result.exact ? 'is the best move.' : 'also works: it preserves the position within the engine tolerance.'}` };
  // Avoid answer-first explanation text here: failed attempts must keep the solution hidden.
  const sameLine = result.fenAfter.split(' ').slice(0, 4).join(' ') === moment.fenAfter.split(' ').slice(0, 4).join(' ');
  // The answer-first detail has two sentences; only the second describes the played move.
  const detail = sameLine ? explainMove(moment).detail : '';
  const why = sameLine ? detail.slice(detail.indexOf('. ') + 2) : `${result.san} reduces your winning chances from ${moment.winBefore.toFixed(0)}% to ${Math.max(0, moment.winBefore - result.loss).toFixed(0)}% (a drop of ${result.loss.toFixed(1)} percentage points).`;
  return { result, feedback: `${why} Try again, or ask to see the correction.` };
}

export interface LearnOptions { onResult?: (moment: AnalysedMove, result: LearnResult, info?: { hintsUsed: number; attempts: number }) => void }
export interface LearnFlow {
  moments: AnalysedMove[];
  index: number;
  phase: LearnPhase;
  attempts: number;
  hintsUsed: number;
  hint?: Hint;
  explanation?: Explanation;
  plan?: MovePlan;
  feedback?: string;
  canNextMoment: boolean;
  /** Played outcome to best-play outcome, both in mover winning percentages. */
  recovered: { from: number; to: number } | undefined;
  board: { fen: string; lastMove?: [string, string]; arrows: Arrow[]; highlights: string[]; orientation: 'white' | 'black'; movable: boolean };
  replay: { step: number; total: number };
  contextPly: number;
  /** Sparse results indexed by moment; incomplete moments have no entry. */
  results: LearnResult[];
  actions: {
    start(): void;
    submitMove(from: string, to: string, promo?: string): Promise<void>;
    nextHint(): void;
    giveUp(): void;
    beginReplay(): void;
    beginConfirm(): void;
    watchAgain(): void;
    skipMoment(): void;
    replayStep(delta: 1 | -1): void;
    replayTo(step: number): void;
    confirmMove(from: string, to: string, promo?: string): void;
    nextMoment(): void;
    prevMoment(): void;
    goToMoment(index: number): void;
    stepContext(delta: number): void;
    backToPuzzle(): void;
  };
}
export function useLearnFlow(analysis: GameAnalysis, userColor: Color, options: LearnOptions = {}): LearnFlow {
  const [state, dispatch] = useReducer(learnReducer, undefined, () => createInitialLearnState(analysis, userColor));
  const ref = useRef(state);
  const reported = useRef(new Set<number>());
  const onResult = useRef(options.onResult);
  onResult.current = options.onResult;
  // Synchronously mirror the reducer so rapid clicks and worker replies cannot race.
  const send = (action: LearnAction) => { ref.current = learnReducer(ref.current, action); dispatch(action); };
  useEffect(() => {
    reported.current.clear();
    send({ type: 'reset', analysis, userColor });
  }, [analysis, userColor]);
  useEffect(() => {
    state.results.forEach((result, i) => {
      if (result && !reported.current.has(i)) {
        reported.current.add(i);
        onResult.current?.(state.moments[i], result, { hintsUsed: state.progress[i].hintsUsed, attempts: state.progress[i].attempts });
      }
    });
  }, [state.results, state.moments, state.progress]);
  const m = state.moments[state.index], p = state.progress[state.index];
  const plan = useMemo(() => m ? bestMovePlan(m) : undefined, [m]);
  const hintList = useMemo(() => m ? hints(m) : [], [m]);
  const revealed = ['explain', 'replay', 'confirm', 'solved', 'complete'].includes(state.phase);
  const hint = p?.hintsUsed ? hintList[p.hintsUsed - 1] : undefined;
  let fen = m?.fenBefore ?? analysis.moves[0]?.fenBefore ?? new Chess().fen();
  let lastMove: [string, string] | undefined;
  const arrows: Arrow[] = [];
  let highlights: string[] = [];
  if (state.browsingContext) {
    const preceding = analysis.moves.find(x => x.ply === state.contextPly);
    fen = state.contextPly === 0 ? analysis.moves[0]?.fenBefore ?? fen : preceding?.fenAfter ?? fen;
    if (preceding) lastMove = [preceding.from, preceding.to];
  } else if (m && state.phase === 'replay' && plan) {
    const line = replaySan(m.fenBefore, plan.line);
    const move = line[(p?.replayStep ?? 0) - 1];
    if (move) { fen = move.after; lastMove = [move.from, move.to]; }
    const next = line[p?.replayStep ?? 0];
    if (next) arrows.push({ from: next.from, to: next.to, brush: 'best' });
  } else if (p && state.phase === 'solved' && p.attemptFen) {
    fen = p.attemptFen; lastMove = p.lastMove;
  } else if (hint && ['solve', 'wrong'].includes(state.phase)) {
    highlights = hint.highlight?.squares ?? [];
    if (hint.highlight?.arrow) arrows.push({ from: hint.highlight.arrow[0], to: hint.highlight.arrow[1], brush: 'hint' });
  }
  if (!state.browsingContext && m && ['explain', 'solved'].includes(state.phase)) {
    arrows.push({ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4), brush: 'best' });
  } else if (!state.browsingContext && state.phase === 'wrong' && p?.lastMove) {
    arrows.push({ from: p.lastMove[0], to: p.lastMove[1], brush: 'played' });
  }
  const submitMove = async (from: string, to: string, promo?: string) => {
    const s = ref.current, moment = s.moments[s.index];
    if (!moment || s.browsingContext || !['solve', 'wrong'].includes(s.phase)) return;
    const c = new Chess(moment.fenBefore);
    let uci: string;
    try { const move = c.move({ from, to, promotion: promo ?? 'q' }); uci = move.from + move.to + (move.promotion ?? ''); }
    catch { return; }
    send({ type: 'checking', lastMove: [from, to] });
    const requestId = ref.current.requestId;
    try { const checked = await verifyLearnAttempt(moment, uci); send({ type: 'verified', requestId, ...checked }); }
    catch { send({ type: 'verificationError', requestId, message: `Could not check the move from ${from} to ${to}. Please retry when the engine is ready.` }); }
  };
  return {
    moments: state.moments, index: state.index, phase: state.phase, attempts: p?.attempts ?? 0,
    hintsUsed: p?.hintsUsed ?? 0, hint: !revealed ? hint : undefined,
    explanation: revealed && m ? explainMove(m) : undefined, plan: revealed ? plan : undefined,
    feedback: p?.feedback, canNextMoment: !!p?.confirmed,
    recovered: m ? { from: m.winAfter, to: m.winBefore } : undefined,
    board: { fen, lastMove, arrows, highlights, orientation: userColor === 'w' ? 'white' as const : 'black' as const, movable: !state.browsingContext && ['solve', 'wrong', 'confirm'].includes(state.phase) },
    replay: { step: p?.replayStep ?? 0, total: plan?.line.length ?? 0 }, contextPly: state.contextPly,
    results: state.results,
    actions: {
      start: () => send({ type: 'start' }), submitMove, nextHint: () => send({ type: 'hint' }), giveUp: () => send({ type: 'giveUp' }),
      beginReplay: () => send({ type: 'beginReplay' }), beginConfirm: () => send({ type: 'beginConfirm' }),
      watchAgain: () => send({ type: 'watchAgain' }), skipMoment: () => send({ type: 'skipMoment' }),
      replayStep: (delta: 1 | -1) => send({ type: 'replayStep', delta }), replayTo: (step: number) => send({ type: 'replayTo', step }),
      confirmMove: (from: string, to: string, promo?: string) => {
        const moment = ref.current.moments[ref.current.index];
        const piece = moment ? new Chess(moment.fenBefore).get(from as Parameters<Chess['get']>[0]) : undefined;
        send({ type: 'confirmMove', uci: from + to + (piece?.type === 'p' && /[18]$/.test(to) ? promo ?? 'q' : '') });
      },
      nextMoment: () => send({ type: 'nextMoment' }), prevMoment: () => send({ type: 'prevMoment' }), goToMoment: (index: number) => send({ type: 'goToMoment', index }),
      stepContext: (delta: number) => send({ type: 'stepContext', delta }), backToPuzzle: () => send({ type: 'backToPuzzle' }),
    },
  };
}
