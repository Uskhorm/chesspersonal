import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Chess } from 'chess.js';
import type { AnalysedMove, Drill } from './types';
import { hints, explainMove, bestMovePlan } from './coach';
import { MOTIF_INFO } from './classify';
import { verifyMove } from './verify';
import { db } from './db';
import { buildSession, computeLeaks } from './learning';
import { fetchPuzzle, type LichessPuzzle, type PuzzleDifficulty } from './lichess';
import { gradeFrom, schedule, type FsrsDrill } from './srs';

export type TrainMode = 'session' | 'leak' | 'rush';
export type TrainPhase = 'loading' | 'solve' | 'checking' | 'wrong' | 'explain' | 'replay' | 'confirm' | 'solved' | 'complete';
export type TrainItem = { kind: 'drill'; drill: Drill; move?: AnalysedMove } | { kind: 'puzzle'; p: LichessPuzzle; tag?: string };
export interface TrainResult {
  index: number; item: TrainItem; correct: boolean; firstTry: boolean; corrected: boolean;
  attempts: number; hintsUsed: number; ms: number; combo: number; cleanSolve: boolean;
}
export interface TrainSummary {
  mode: TrainMode; results: TrainResult[]; total: number; correct: number; failed: number;
  corrected: number; accuracy: number; bestCombo: number; elapsedMs: number;
}
export interface TrainState {
  mode: TrainMode; items: TrainItem[]; index: number; phase: TrainPhase;
  fen: string; lastMove?: [string, string]; solutionStep: number; replayStep: number;
  attempts: number; hintsUsed: number; results: TrainResult[]; combo: number; bestCombo: number;
  lives: number; timeLeft: number; difficulty: PuzzleDifficulty; startedAt: number;
  itemStartedAt: number; completedAt?: number; checkingFrom: 'solve' | 'confirm'; error?: string;
}
export type TrainAction =
  | { type: 'reset'; mode: TrainMode; now: number }
  | { type: 'load'; items: TrainItem[]; now: number }
  | { type: 'append'; items: TrainItem[] }
  | { type: 'transfer'; index: number; item: Extract<TrainItem, { kind: 'puzzle' }> }
  | { type: 'checking' }
  | { type: 'checked'; index: number; fenBefore: string; ok: boolean; fen: string; step: number; done: boolean; lastMove?: [string, string]; now: number }
  | { type: 'hint' } | { type: 'giveUp'; now: number }
  | { type: 'explain' } | { type: 'replay' } | { type: 'replayTo'; step: number }
  | { type: 'confirm' } | { type: 'next'; now: number }
  | { type: 'tick'; now: number } | { type: 'finish'; now: number }
  | { type: 'error'; message: string };

export function createTrainState(mode: TrainMode, items?: TrainItem[], now = Date.now()): TrainState {
  const state: TrainState = { mode, items: items ?? [], index: 0, phase: items ? 'solve' : 'loading',
    fen: '', solutionStep: 0, replayStep: 0, attempts: 0, hintsUsed: 0, results: [],
    combo: 0, bestCombo: 0, lives: 3, timeLeft: 180, difficulty: 'normal',
    startedAt: now, itemStartedAt: now, checkingFrom: 'solve' };
  return items ? activate(state, now) : state;
}
const startFen = (item: TrainItem) => item.kind === 'drill' ? item.drill.fen : item.p.fen;

/** Old drill rows omitted the analysis; callers can supply the original move. */
function momentOf(item: Extract<TrainItem, { kind: 'drill' }>): AnalysedMove {
  const d = item.drill;
  const stored = item.move ?? (d as FsrsDrill).move;
  if (stored) return stored;
  const c = new Chess(d.fen);
  let played = d.bestUci;
  let after = d.fen;
  try { const m = c.move(d.playedSan); played = m.lan; after = c.fen(); } catch { /* legacy SAN may be unavailable */ }
  return { ply: d.ply, color: d.color, san: d.playedSan, uci: played,
    from: played.slice(0, 2), to: played.slice(2, 4), fenBefore: d.fen, fenAfter: after,
    scoreBefore: {}, scoreAfter: {}, winBefore: d.winBefore, winAfter: d.winBefore,
    epLoss: 0, accuracy: 0, bestUci: d.bestUci, bestSan: d.bestSan,
    bestLineSan: [d.bestSan], replyLineSan: [], cls: d.cls, motifs: d.motifs, comment: '' };
}

function lineOf(item: TrainItem): string[] {
  if (item.kind === 'puzzle') return item.p.solution;
  const line = bestMovePlan(momentOf(item)).line;
  const c = new Chess(item.drill.fen);
  const result: string[] = [];
  for (const san of line.length ? line : [item.drill.bestSan]) {
    try { result.push(c.move(san).lan); } catch { break; }
  }
  return result.length ? result : [item.drill.bestUci];
}
function replayBoard(item: TrainItem, step: number): { fen: string; lastMove?: [string, string] } {
  const c = new Chess(startFen(item));
  let lastMove: [string, string] | undefined;
  for (const uci of lineOf(item).slice(0, step)) {
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    lastMove = [m.from, m.to];
  }
  return { fen: c.fen(), lastMove };
}
function activate(s: TrainState, now: number): TrainState {
  const item = s.items[s.index];
  if (!item) return { ...s, phase: 'complete', completedAt: now };
  return { ...s, phase: 'solve', fen: startFen(item), solutionStep: 0, replayStep: 0,
    attempts: 0, hintsUsed: 0, lastMove: item.kind === 'puzzle' && item.p.lastMove
      ? [item.p.lastMove.slice(0, 2), item.p.lastMove.slice(2, 4)] : undefined,
    itemStartedAt: now, error: undefined };
}
const difficulties: PuzzleDifficulty[] = ['easiest', 'easier', 'normal', 'harder', 'hardest'];
function record(s: TrainState, correct: boolean, now: number): TrainState {
  if (s.results.some((r) => r.index === s.index)) return s;
  const cleanSolve = correct && s.hintsUsed === 0 && s.attempts === 0;
  const combo = correct ? s.combo + (cleanSolve ? 1 : 0) : 0;
  const result: TrainResult = { cleanSolve, index: s.index, item: s.items[s.index], correct,
    firstTry: correct && s.hintsUsed === 0 && s.attempts === 0, corrected: false,
    attempts: s.attempts + 1, hintsUsed: s.hintsUsed, ms: Math.max(0, now - s.itemStartedAt), combo };
  const results = [...s.results, result];
  const recent = results.slice(-10);
  const success = recent.filter((r) => r.correct).length / recent.length;
  const change = recent.length >= 5 && results.length % 5 === 0 ? success < 0.85 ? -1 : success > 0.9 ? 1 : 0 : 0;
  const difficulty = difficulties[Math.max(0, Math.min(4, difficulties.indexOf(s.difficulty) + change))];
  const lives = s.lives - (!correct && s.mode === 'rush' ? 1 : 0);
  return { ...s, results, combo, bestCombo: Math.max(s.bestCombo, combo), difficulty, lives };
}

/** Pure state machine. A failed item cannot advance until its correction is played. */
export function trainReducer(s: TrainState, a: TrainAction): TrainState {
  if (a.type === 'reset') return createTrainState(a.mode, undefined, a.now);
  if (a.type === 'load') return createTrainState(s.mode, a.items, a.now);
  if (a.type === 'transfer') {
    if (s.mode === 'rush' || s.phase !== 'checking' || a.index !== s.index || s.items[s.index]?.kind !== 'drill'
      || s.items.filter(isTransfer).length >= 3 || s.items.some((i) => i.kind === 'puzzle' && i.p.id === a.item.p.id)) return s;
    const items = [...s.items];
    items.splice(s.index + 1, 0, { ...a.item, tag: TRANSFER_TAG });
    return { ...s, items };
  }
  if (a.type === 'append') {
    const ids = new Set(s.items.map((i) => i.kind === 'drill' ? `d:${i.drill.id}` : `p:${i.p.id}`));
    const items = a.items.filter((i) => { const id = i.kind === 'drill' ? `d:${i.drill.id}` : `p:${i.p.id}`;
      if (ids.has(id)) return false; ids.add(id); return true; });
    return { ...s, items: [...s.items, ...items] };
  }
  if (a.type === 'error') return { ...s, error: a.message,
    phase: s.phase === 'checking' ? s.checkingFrom : s.phase };
  if (s.phase === 'complete' || s.phase === 'loading') return s;
  const item = s.items[s.index];
  switch (a.type) {
    case 'checking': return s.phase === 'solve' || s.phase === 'confirm'
      ? { ...s, phase: 'checking', checkingFrom: s.phase, error: undefined } : s;
    case 'checked': {
      if (s.phase !== 'checking' || a.index !== s.index || a.fenBefore !== s.fen) return s;
      if (!a.ok) {
        if (s.checkingFrom === 'confirm') return { ...s, phase: 'confirm', attempts: s.attempts + 1, error: 'Try the best continuation again.' };
        if (s.mode !== 'rush' && s.attempts < 1) return { ...s, phase: 'solve', attempts: s.attempts + 1, error: 'Try once more.' };
        const failed = record(s, false, a.now);
        return { ...failed, phase: failed.lives <= 0 ? 'complete' : 'wrong', attempts: s.attempts + 1,
          completedAt: failed.lives <= 0 ? a.now : undefined };
      }
      if (!a.done) return { ...s, phase: s.checkingFrom, fen: a.fen, solutionStep: a.step, lastMove: a.lastMove };
      if (s.checkingFrom === 'confirm') return { ...s, phase: 'solved', fen: a.fen, lastMove: a.lastMove,
        results: s.results.map((r) => r.index === s.index ? { ...r, corrected: true } : r) };
      return { ...record(s, true, a.now), phase: 'solved', fen: a.fen, lastMove: a.lastMove };
    }
    case 'giveUp': {
      if (s.phase !== 'solve') return s;
      const failed = record(s, false, a.now);
      return { ...failed, phase: failed.lives <= 0 ? 'complete' : 'wrong', attempts: s.attempts + 1,
        completedAt: failed.lives <= 0 ? a.now : undefined };
    }
    case 'hint': return s.phase === 'solve' ? { ...s, hintsUsed: Math.min(3, s.hintsUsed + 1) } : s;
    case 'explain': return s.phase === 'wrong' ? { ...s, phase: 'explain' } : s;
    case 'replay': return s.phase === 'explain' ? { ...s, phase: 'replay', replayStep: 0, ...replayBoard(item, 0) } : s;
    case 'replayTo': {
      if (s.phase !== 'replay') return s;
      const step = Math.max(0, Math.min(lineOf(item).length, Math.floor(a.step)));
      return { ...s, replayStep: step, ...replayBoard(item, step) };
    }
    case 'confirm': return s.phase === 'replay' && s.replayStep >= Math.min(2, lineOf(item).length)
      ? { ...s, phase: 'confirm', solutionStep: 0, ...replayBoard(item, 0) } : s;
    case 'next': return s.phase === 'solved' ? activate({ ...s, index: s.index + 1 }, a.now) : s;
    case 'tick': {
      if (s.mode !== 'rush') return s;
      const timeLeft = Math.max(0, 180 - Math.floor((a.now - s.startedAt) / 1000));
      return { ...s, timeLeft, phase: timeLeft ? s.phase : 'complete', completedAt: timeLeft ? undefined : a.now };
    }
    case 'finish': return { ...s, phase: 'complete', completedAt: a.now };
    default: return s;
  }
}

/** Async verification is outside the reducer; illegal moves reject without consuming a life. */
export async function checkTrainMove(s: TrainState, from: string, to: string, promotion?: string): Promise<TrainAction> {
  const item = s.items[s.index];
  const c = new Chess(s.fen);
  const m = c.move({ from, to, promotion: promotion ?? 'q' });
  const uci = m.lan;
  const base = { type: 'checked' as const, index: s.index, fenBefore: s.fen };
  if (item.kind === 'drill') {
    if (item.drill.bestUci.length === 5 && uci.slice(0, 4) === item.drill.bestUci.slice(0, 4) && uci !== item.drill.bestUci) {
      return { ...base, ok: false, fen: s.fen, step: 0, done: false, now: Date.now() };
    }
    const result = await verifyMove(s.fen, uci, item.drill.bestUci, item.drill.winBefore, 3);
    return { ...base, ok: result.ok, fen: result.fenAfter, lastMove: [from, to], step: 1, done: true, now: Date.now() };
  }
  const expected = item.p.solution[s.solutionStep];
  if (uci !== expected && !c.isCheckmate()) return { ...base, ok: false, fen: s.fen, step: s.solutionStep, done: false, now: Date.now() };
  let step = s.solutionStep + 1;
  let lastMove: [string, string] = [from, to];
  if (step < item.p.solution.length && !c.isCheckmate()) {
    const reply = item.p.solution[step++];
    const r = c.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
    lastMove = [r.from, r.to];
  }
  return { ...base, ok: true, fen: c.fen(), lastMove, step,
    done: step >= item.p.solution.length || c.isCheckmate(), now: Date.now() };
}

export function trainSummary(s: TrainState, now = Date.now()): TrainSummary {
  const correct = s.results.filter((r) => r.correct).length;
  return { mode: s.mode, results: s.results, total: s.results.length, correct,
    failed: s.results.length - correct, corrected: s.results.filter((r) => r.corrected).length,
    accuracy: s.results.length ? correct / s.results.length : 0, bestCombo: s.bestCombo,
    elapsedMs: Math.max(0, (s.completedAt ?? now) - s.startedAt) };
}

const TRANSFER_TAG = 'Same idea, new position';
const isTransfer = (item: TrainItem) => item.kind === 'puzzle' && item.tag === TRANSFER_TAG;

/** Best-effort transfer practice, bounded across the whole session queue. */
export async function fetchTransferPuzzle(s: TrainState): Promise<Extract<TrainItem, { kind: 'puzzle' }> | undefined> {
  const item = s.items[s.index];
  if (s.mode === 'rush' || item?.kind !== 'drill' || s.items.filter(isTransfer).length >= 3) return;
  const motif = item.drill.motifs[0];
  if (!motif) return;
  try { return { kind: 'puzzle', p: await fetchPuzzle(MOTIF_INFO[motif].angle, s.difficulty), tag: TRANSFER_TAG }; }
  catch { /* Offline practice remains available. */ }
}

export interface TrainOptions {
  /** Supply a queue to bypass database/network loading, e.g. offline training. */
  items?: TrainItem[];
  onCorrect?: (info: TrainResult) => void;
  onWrong?: (info: TrainResult) => void;
  onFinish?: (summary: TrainSummary) => void;
}

async function makeQueue(mode: TrainMode): Promise<TrainItem[]> {
  const [drills, games, analyses] = await Promise.all([db.drills.toArray(), db.games.toArray(), db.analyses.toArray()]);
  const leak = computeLeaks(games, analyses).find((l) => l.motif !== 'opening' && l.motif !== 'endgame');
  const own = buildSession(mode === 'leak' && leak ? drills.filter((d) => d.motifs.includes(leak.motif)) : drills,
    mode === 'rush' ? 25 : mode === 'leak' ? 4 : 10, null);
  const moves = new Map<string, AnalysedMove>(analyses.flatMap((a) => a.moves.map((m) => [`${a.gameId}:${m.ply}`, m] as const)));
  const items: TrainItem[] = own.map((drill) => ({ kind: 'drill', drill, move: moves.get(drill.id) }));
  const count = mode === 'leak' ? 6 : mode === 'rush' ? 3 : Math.max(0, 6 - items.length);
  for (let i = 0; i < count; i++) {
    try {
      const p = await fetchPuzzle(leak?.angle, mode === 'rush' ? 'easier' : 'normal');
      items.splice(Math.min(i * 2 + 1, items.length), 0, { kind: 'puzzle', p, tag: leak?.label });
    } catch { break; } // own positions remain available offline
  }
  return items;
}

export function useTrainSession(mode: TrainMode, options: TrainOptions = {}) {
  const [state, dispatch] = useReducer(trainReducer, mode, (m) => createTrainState(m));
  const current = useRef(state); current.current = state;
  const opts = useRef(options); opts.current = options;
  const generation = useRef(0);
  const busy = useRef(false);
  const reported = useRef(0);
  const finished = useRef(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    generation.current++; busy.current = false; reported.current = 0; finished.current = false;
    // Set mode immediately, including when this hook instance is reused.
    dispatch({ type: 'reset', mode, now: Date.now() });
    const queue = options.items ? Promise.resolve(options.items) : makeQueue(mode);
    queue.then((items) => { if (!cancelled) dispatch({ type: 'load', items, now: Date.now() }); })
      .catch((e: unknown) => { if (!cancelled) dispatch({ type: 'error', message: String(e) }); });
    return () => { cancelled = true; generation.current++; };
  }, [mode, options.items]);

  useEffect(() => {
    for (const info of state.results.slice(reported.current)) {
      if (info.item.kind === 'drill') {
        const drill = info.item.drill;
        writes.current = writes.current.then(async () => {
          const latest = await db.drills.get(drill.id) ?? drill;
          await db.drills.put(schedule(latest, gradeFrom(info.correct, info.firstTry, info.ms, { hintsUsed: info.hintsUsed, mode: state.mode })));
        }).catch((e: unknown) => dispatch({ type: 'error', message: `Could not save review: ${String(e)}` }));
      }
      if (info.correct) opts.current.onCorrect?.(info); else opts.current.onWrong?.(info);
    }
    reported.current = state.results.length;
    if (state.phase === 'complete' && !finished.current) {
      finished.current = true;
      opts.current.onFinish?.(trainSummary(state));
    }
  }, [state]);
  useEffect(() => {
    if (mode !== 'rush' || state.phase === 'loading' || state.phase === 'complete') return;
    const timer = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), 250);
    return () => clearInterval(timer);
  }, [mode, state.phase === 'complete', state.phase === 'loading']);
  useEffect(() => {
    if (mode !== 'rush' || state.phase === 'loading' || state.phase === 'complete' || state.items.length - state.index > 3) return;
    let cancelled = false;
    fetchPuzzle(undefined, state.difficulty).then((p) => { if (!cancelled) dispatch({ type: 'append', items: [{ kind: 'puzzle', p }] }); })
      .catch((e: unknown) => { if (!cancelled) dispatch({ type: 'error', message: String(e) }); });
    return () => { cancelled = true; };
  }, [mode, state.index, state.items.length, state.difficulty, state.phase === 'loading', state.phase === 'complete']);

  const submitMove = useCallback(async (from: string, to: string, promotion?: string) => {
    const s = current.current;
    if (busy.current || (s.phase !== 'solve' && s.phase !== 'confirm')) return;
    busy.current = true;
    const token = generation.current;
    dispatch({ type: 'checking' });
    try {
      const action = await checkTrainMove(s, from, to, promotion);
      if (token === generation.current && action.type === 'checked' && action.ok && action.done && s.phase === 'solve') {
        const transfer = await fetchTransferPuzzle(s);
        if (transfer && token === generation.current) dispatch({ type: 'transfer', index: s.index, item: transfer });
      }
      if (token === generation.current) dispatch(action);
    } catch (e) { if (token === generation.current) dispatch({ type: 'error', message: String(e) }); }
    finally { if (token === generation.current) busy.current = false; }
  }, []);
  const item = state.items[state.index];
  const coaching = useMemo(() => item?.kind === 'drill' ? {
    hints: hints(momentOf(item)), explanation: explainMove(momentOf(item)), plan: bestMovePlan(momentOf(item)),
  } : undefined, [item]);
  const hint = state.hintsUsed ? coaching?.hints[state.hintsUsed - 1] : undefined;
  const line = item ? lineOf(item) : [];
  const nextMove = line[state.solutionStep];
  const from = nextMove?.slice(0, 2), to = nextMove?.slice(2, 4);
  const puzzleHints = item?.kind === 'puzzle' && from && to ? [
    { level: 1 as const, text: `Look at the highlighted piece for ${item.p.themes.join(', ') || 'a forcing continuation'}.`,
      highlight: { squares: [from] } },
    { level: 2 as const, text: 'Consider the highlighted piece and the squares lit up around its target.',
      highlight: { squares: [from, ...Array.from({ length: 64 }, (_, i) => `${String.fromCharCode(97 + i % 8)}${1 + Math.floor(i / 8)}`)
        .filter(sq => Math.abs(sq.charCodeAt(0) - to.charCodeAt(0)) <= 1 && Math.abs(Number(sq[1]) - Number(to[1])) <= 1)] } },
    { level: 3 as const, text: 'Follow the highlighted move.',
      highlight: { squares: [from, to], arrow: [from, to] as [string, string] } },
  ] : [];
  const usedHints = (coaching?.hints ?? puzzleHints).slice(0, state.hintsUsed);
  const activeHint = hint ?? usedHints[usedHints.length - 1];
  // Replay captions describe step - 1; the arrow previews step, the next move.
  const reveal = state.phase === 'replay' ? line[state.replayStep]
    : ['wrong', 'explain'].includes(state.phase) ? line[state.solutionStep] : undefined;
  const arrow = reveal ? [reveal.slice(0, 2), reveal.slice(2, 4)] : state.phase === 'solve' ? activeHint?.highlight?.arrow : undefined;
  return { ...state, item, hint: activeHint,
    explanation: coaching?.explanation ?? (item?.kind === 'puzzle' ? { headline: 'Follow the forcing line',
      detail: `Play the solution against the opponent's best replies: ${item.p.themes.join(', ')}.`, tags: item.p.themes } : undefined),
    plan: coaching?.plan ?? (item ? { san: '', idea: 'Find the complete continuation.', line,
      lineExplained: line.map((san) => ({ san })) } : undefined),
    board: { fen: state.fen, lastMove: state.lastMove,
      orientation: item && new Chess(startFen(item)).turn() === 'b' ? 'black' as const : 'white' as const,
      movable: state.phase === 'solve' || state.phase === 'confirm',
      arrows: arrow ? [{ from: arrow[0], to: arrow[1], brush: reveal ? 'best' as const : 'hint' as const }] : [],
      highlights: state.phase === 'solve' ? [...new Set(usedHints.flatMap(h => h.highlight?.squares ?? []))] : [] },
    replay: { step: state.replayStep, total: line.length }, summary: trainSummary(state),
    actions: { submitMove, confirmMove: submitMove,
      nextHint: () => dispatch({ type: 'hint' }), giveUp: () => dispatch({ type: 'giveUp', now: Date.now() }),
      explain: () => dispatch({ type: 'explain' }), startReplay: () => dispatch({ type: 'replay' }),
      replayStep: (delta: 1 | -1) => dispatch({ type: 'replayTo', step: current.current.replayStep + delta }),
      replayTo: (step: number) => dispatch({ type: 'replayTo', step }),
      startConfirm: () => dispatch({ type: 'confirm' }), next: () => dispatch({ type: 'next', now: Date.now() }),
      finish: () => dispatch({ type: 'finish', now: Date.now() }) } };
}
