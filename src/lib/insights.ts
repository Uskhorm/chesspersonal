import { type SlimAnalysis, type SlimMove } from './db';
import { Chess } from 'chess.js';
import { initialClock, parseClocks } from './analysis';
import { selfOf } from './chesscom';
import { isEndgame } from './classify';
import { computeLeaks } from './learning';
import { isMastered, type FsrsDrill } from './srs';
import type { AnalysedMove, Color, Drill, Motif, StoredGame } from './types';

export type Phase = 'opening' | 'middlegame' | 'endgame';
export interface TrendPoint { gameId: string; time: number; value: number }
export interface RatingTrend { timeClass: string; points: TrendPoint[]; delta7: number | null; delta30: number | null }
export interface AccuracyPoint extends TrendPoint { rollingAverage: number }
export interface Results { games: number; wins: number; draws: number; losses: number; scorePercent: number }
export interface OpeningResults extends Results { key: string; ecoFamily: string; name: string }
export interface PhaseAverage { moves: number; average: number | null }
export interface ClockUsage {
  byPhase: Record<Phase, PhaseAverage>;
  errors: number; errorsWithClock: number; errorsWithDuration: number;
  timeTroubleErrors: number; timeTroublePercent: number | null;
  rushedErrors: number; rushingPercent: number | null;
  timeTroublePointsLost: number; rushingPointsLost: number;
}
export interface OpportunityRate { opportunities: number; successes: number; percent: number | null }
export interface ErrorRates { moves: number; blunders: number; mistakes: number; blundersPer100: number; mistakesPer100: number }
export interface SwingMoment { gameId: string; ply: number; san: string; epLoss: number; winBefore: number; winAfter: number }
export interface PeriodSummary extends Results { accuracy: number | null; errorsPer100: number; analysedMoves: number }
export interface WeeklySummary {
  start: number; previousStart: number; end: number;
  thisWeek: PeriodSummary; lastWeek: PeriodSummary;
  delta: { games: number; accuracy: number | null; scorePercent: number | null; errorsPer100: number | null };
}
export interface FocusRecommendation { kind: 'leak' | 'clock' | 'opening' | 'review'; motif?: Motif; openingKey?: string; title: string; reason: string; drillIds: string[] }

const DAY = 86_400_000;
const finite = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n);
const average = (xs: number[]): number | null => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const percent = (n: number, d: number): number | null => d ? 100 * n / d : null;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const isError = (m: SlimMove) => m.cls === 'mistake' || m.cls === 'blunder';
const phaseOf = (m: Pick<AnalysedMove, 'ply' | 'fenBefore'>): Phase => isEndgame(m.fenBefore) ? 'endgame' : m.ply <= 20 ? 'opening' : 'middlegame';
const phaseValues = (): Record<Phase, number[]> => ({ opening: [], middlegame: [], endgame: [] });
const phaseAverages = (xs: Record<Phase, number[]>): Record<Phase, PhaseAverage> => ({
  opening: { moves: xs.opening.length, average: average(xs.opening) },
  middlegame: { moves: xs.middlegame.length, average: average(xs.middlegame) },
  endgame: { moves: xs.endgame.length, average: average(xs.endgame) },
});
// Select one (deepest, then newest) analysis per game; orphan analyses never count.
function pairs(games: StoredGame[], analyses: SlimAnalysis[]) {
  const byId = new Map<string, SlimAnalysis>();
  for (const a of analyses) {
    const old = byId.get(a.gameId);
    if (!old || a.depth > old.depth || (a.depth === old.depth && a.createdAt > old.createdAt)) byId.set(a.gameId, a);
  }
  return games.flatMap(g => { const a = byId.get(g.id); return a ? [{ g, a }] : []; });
}
function userMoves(games: StoredGame[], analyses: SlimAnalysis[]) {
  return pairs(games, analyses).flatMap(({ g, a }) => a.moves.filter(m => m.color === g.userColor).map(m => ({ g, m })));
}

/** Stored ratings are game observations, not guaranteed post-game ratings. Deltas require an observation at/before the cutoff. */
export function ratingTrend(games: StoredGame[], now: number): RatingTrend[] {
  const buckets = new Map<string, TrendPoint[]>();
  for (const g of games) if (g.rated && g.endTime <= now && finite(selfOf(g).rating)) {
    const xs = buckets.get(g.timeClass) ?? [];
    xs.push({ gameId: g.id, time: g.endTime, value: selfOf(g).rating });
    buckets.set(g.timeClass, xs);
  }
  return [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([timeClass, points]) => {
    points.sort((a, b) => a.time - b.time || a.gameId.localeCompare(b.gameId));
    const delta = (days: number) => {
      const baseline = points.findLast(p => p.time <= now - days * DAY);
      return baseline ? points[points.length - 1].value - baseline.value : null;
    };
    return { timeClass, points, delta7: delta(7), delta30: delta(30) };
  });
}

/** Rolling arithmetic mean over the last `window` games with known accuracy; analysis takes precedence over stored/provider accuracy. */
export function accuracyTrend(games: StoredGame[], analyses: SlimAnalysis[], window = 5): AccuracyPoint[] {
  const byId = new Map(pairs(games, analyses).map(({ g, a }) => [g.id, g.userColor === 'w' ? a.white.accuracy : a.black.accuracy]));
  const points = games.flatMap(g => {
    const value = byId.get(g.id) ?? g.userAccuracy ?? g.chesscomAccuracy?.[g.userColor === 'w' ? 'white' : 'black'];
    return finite(value) ? [{ gameId: g.id, time: g.endTime, value }] : [];
  }).sort((a, b) => a.time - b.time || a.gameId.localeCompare(b.gameId));
  const size = finite(window) ? Math.max(1, Math.floor(window)) : 5;
  return points.map((p, i) => ({ ...p, rollingAverage: average(points.slice(Math.max(0, i - size + 1), i + 1).map(x => x.value))! }));
}

function results(games: StoredGame[]): Results {
  const wins = games.filter(g => g.userResult === 'win').length;
  const draws = games.filter(g => g.userResult === 'draw').length;
  return { games: games.length, wins, draws, losses: games.length - wins - draws, scorePercent: percent(wins + draws / 2, games.length) ?? 0 };
}
export function resultsByColour(games: StoredGame[]): Record<Color, Results> {
  return { w: results(games.filter(g => g.userColor === 'w')), b: results(games.filter(g => g.userColor === 'b')) };
}
export function resultsByTimeClass(games: StoredGame[]): Record<string, Results> {
  return Object.fromEntries([...new Set(games.map(g => g.timeClass))].sort().map(c => [c, results(games.filter(g => g.timeClass === c))]));
}
function headers(pgn: string): Record<string, string> {
  return Object.fromEntries([...pgn.matchAll(/\[(\w+)\s+"((?:\\.|[^"\\])*)"\]/g)].map(m => [m[1], m[2].replace(/\\(["\\])/g, '$1')]));
}
/** ECO family is the two-character decade (e.g. B20–B29 => B2), combined with the opening name (variations after ':' are folded). */
export function resultsByOpening(games: StoredGame[], analyses: SlimAnalysis[]): OpeningResults[] {
  const byId = new Map(pairs(games, analyses).map(({ g, a }) => [g.id, a]));
  const buckets = new Map<string, { ecoFamily: string; name: string; games: StoredGame[] }>();
  for (const g of games) {
    const a = byId.get(g.id), h = headers(g.pgn);
    const eco = [a?.eco, h.ECO, g.eco].find(v => v && /^[A-E]\d\d$/i.test(v));
    const ecoFamily = eco ? eco.slice(0, 2).toUpperCase() : 'Unknown';
    const url = h.ECOUrl ?? (g.eco?.includes('/') ? g.eco : undefined);
    let urlName: string | undefined;
    if (url) { try { urlName = decodeURIComponent(url.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '').replace(/-/g, ' '); } catch { /* malformed optional metadata */ } }
    const name = (a?.opening ?? h.Opening ?? urlName ?? 'Unknown opening').split(/[:,]/)[0].trim() || 'Unknown opening';
    const key = `${ecoFamily}:${name.toLowerCase()}`;
    const bucket = buckets.get(key) ?? { ecoFamily, name, games: [] };
    bucket.games.push(g); buckets.set(key, bucket);
  }
  return [...buckets].map(([key, b]) => ({ key, ecoFamily: b.ecoFamily, name: b.name, ...results(b.games) })).sort((a, b) => b.games - a.games || a.key.localeCompare(b.key));
}
export function bestWorstOpenings(games: StoredGame[], analyses: SlimAnalysis[], minSample = 3): { best: OpeningResults | null; worst: OpeningResults | null } {
  const xs = resultsByOpening(games, analyses).filter(x => x.games >= Math.max(1, minSample)).sort((a, b) => b.scorePercent - a.scorePercent || b.games - a.games || a.key.localeCompare(b.key));
  return { best: xs[0] ?? null, worst: xs[xs.length - 1] ?? null };
}

/** Uses same-side clock differences plus Fischer increment. Unknown/missing annotations break the duration chain; daily/staged controls are excluded. */
export function clockUsage(games: StoredGame[], analyses: SlimAnalysis[]): ClockUsage {
  const values = phaseValues();
  let errors = 0, errorsWithClock = 0, errorsWithDuration = 0, timeTroubleErrors = 0, rushedErrors = 0;
  let timeTroublePointsLost = 0, rushingPointsLost = 0;
  const byId = new Map(pairs(games, analyses).map(({ g, a }) => [g.id, a]));
  for (const g of games) {
    const h = headers(g.pgn), tc = h.TimeControl ?? g.timeControl;
    const supported = /^\d+(?:\+\d+(?:\.\d+)?)?$/.test(tc) && g.timeClass !== 'daily';
    const base = supported ? initialClock(`[TimeControl "${tc}"]`) : undefined;
    const increment = supported ? Number(tc.split('+')[1] ?? 0) : 0;
    const a = byId.get(g.id);
    let history: { ply: number; color: Color; fenBefore: string; clock?: number }[] = [];
    try {
      const chess = new Chess(); chess.loadPgn(g.pgn);
      const comments = new Map(chess.getComments().map(c => [c.fen, parseClocks(c.comment)[0]]));
      history = chess.history({ verbose: true }).map((m, i) => ({ ply: i + 1, color: m.color, fenBefore: m.before, clock: comments.get(m.after) }));
    } catch { /* Analysis clocks remain usable for malformed or absent PGN. */ }
    const moves = a ? a.moves.map(m => ({ ...m, clock: m.clock ?? history.find(hm => hm.ply === m.ply)?.clock })) : history;
    const previous: Partial<Record<Color, number>> = { w: base, b: base };
    const lastPly: Partial<Record<Color, number>> = {};
    for (const m of [...moves].sort((x, y) => x.ply - y.ply)) {
      const before = lastPly[m.color] === undefined ? (m.ply <= 2 ? base : undefined) : lastPly[m.color] === m.ply - 2 ? previous[m.color] : undefined;
      const after = finite(m.clock) && m.clock >= 0 ? m.clock : undefined;
      const elapsed = supported && finite(before) && finite(after) ? before + increment - after : undefined;
      const duration = finite(elapsed) && elapsed >= 0 ? elapsed : undefined;
      if (m.color === g.userColor) {
        if (finite(duration)) values[phaseOf(m)].push(duration);
        const error = 'cls' in m && isError(m as SlimMove);
        if (error) {
          errors++;
          const loss = 'epLoss' in m && finite(m.epLoss as number) ? Math.max(0, m.epLoss as number) : 0;
          if (supported && finite(before)) { errorsWithClock++; if (before < 20 || (base !== undefined && before < base * .1)) { timeTroubleErrors++; timeTroublePointsLost += loss; } }
          if (finite(duration)) { errorsWithDuration++; if (duration < 3) { rushedErrors++; rushingPointsLost += loss; } }
        }
      }
      previous[m.color] = after; lastPly[m.color] = m.ply;
    }
  }
  return { byPhase: phaseAverages(values), errors, errorsWithClock, errorsWithDuration, timeTroubleErrors, timeTroublePercent: percent(timeTroubleErrors, errorsWithClock), rushedErrors, rushingPercent: percent(rushedErrors, errorsWithDuration), timeTroublePointsLost, rushingPointsLost };
}

function opportunityRate(games: StoredGame[], analyses: SlimAnalysis[], comeback: boolean): OpportunityRate {
  let opportunities = 0, successes = 0;
  for (const { g, a } of pairs(games, analyses)) {
    const curve = a.winCurve.filter(finite).map(w => g.userColor === 'w' ? w : 100 - w);
    // Moves also support older/partial analyses without a populated curve.
    const chances = [...curve, ...a.moves.flatMap(m => m.color === g.userColor ? [m.winBefore, m.winAfter] : [100 - m.winBefore, 100 - m.winAfter])].filter(finite);
    if (chances.some(w => comeback ? w <= 20 : w >= 80)) {
      opportunities++; if (comeback ? g.userResult !== 'loss' : g.userResult === 'win') successes++;
    }
  }
  return { opportunities, successes, percent: percent(successes, opportunities) };
}
export function conversionRate(games: StoredGame[], analyses: SlimAnalysis[]): OpportunityRate { return opportunityRate(games, analyses, false); }
export function comebackRate(games: StoredGame[], analyses: SlimAnalysis[]): OpportunityRate { return opportunityRate(games, analyses, true); }
export function errorRates(games: StoredGame[], analyses: SlimAnalysis[]): ErrorRates {
  const xs = userMoves(games, analyses), blunders = xs.filter(({ m }) => m.cls === 'blunder').length, mistakes = xs.filter(({ m }) => m.cls === 'mistake').length;
  return { moves: xs.length, blunders, mistakes, blundersPer100: percent(blunders, xs.length) ?? 0, mistakesPer100: percent(mistakes, xs.length) ?? 0 };
}
/** Move-weighted phase accuracy, matching analysis.ts phase boundaries. */
export function accuracyByPhase(games: StoredGame[], analyses: SlimAnalysis[]): Record<Phase, PhaseAverage> {
  const values = phaseValues();
  for (const { m } of userMoves(games, analyses)) if (finite(m.accuracy)) values[phaseOf(m)].push(m.accuracy);
  return phaseAverages(values);
}
export function biggestSwings(games: StoredGame[], analyses: SlimAnalysis[], topN = 5): SwingMoment[] {
  return userMoves(games, analyses).filter(({ m }) => finite(m.epLoss) && m.epLoss > 0).map(({ g, m }) => ({ gameId: g.id, ply: m.ply, san: m.san, epLoss: m.epLoss, winBefore: m.winBefore, winAfter: m.winAfter }))
    .sort((a, b) => b.epLoss - a.epLoss || a.gameId.localeCompare(b.gameId) || a.ply - b.ply).slice(0, finite(topN) ? Math.max(0, Math.floor(topN)) : 5);
}

/** UTC Monday-to-now versus the same elapsed portion of the previous week; games exactly at now are included. */
export function weeklySummary(games: StoredGame[], analyses: SlimAnalysis[], now: number): WeeklySummary {
  const date = new Date(now); date.setUTCHours(0, 0, 0, 0);
  const start = date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY, previousStart = start - 7 * DAY;
  const period = (from: number, to: number): PeriodSummary => {
    const gs = games.filter(g => g.endTime >= from && g.endTime <= to);
    const rates = errorRates(gs, analyses);
    return { ...results(gs), accuracy: average(accuracyTrend(gs, analyses).map(p => p.value)), errorsPer100: rates.blundersPer100 + rates.mistakesPer100, analysedMoves: rates.moves };
  };
  const thisWeek = period(start, now), lastWeek = period(previousStart, now - 7 * DAY);
  return { start, previousStart, end: now, thisWeek, lastWeek, delta: {
    games: thisWeek.games - lastWeek.games,
    accuracy: thisWeek.accuracy !== null && lastWeek.accuracy !== null ? thisWeek.accuracy - lastWeek.accuracy : null,
    scorePercent: thisWeek.games && lastWeek.games ? thisWeek.scorePercent - lastWeek.scorePercent : null,
    errorsPer100: thisWeek.analysedMoves && lastWeek.analysedMoves ? thisWeek.errorsPer100 - lastWeek.errorsPer100 : null,
  } };
}

/** Rank actionable candidates by measured expected points lost; openings require eight games. */
export function focusRecommendation(games: StoredGame[], analyses: SlimAnalysis[], drills: Drill[] = []): FocusRecommendation {
  const selected = pairs(games, analyses).map(({ a }) => a);
  const candidates: { weight: number; value: FocusRecommendation }[] = computeLeaks(games, selected).filter(l => l.pointsLost > 0).map(l => ({ weight: l.pointsLost, value: {
    kind: 'leak', motif: l.motif, title: l.label, reason: `${l.label} cost ${l.pointsLost.toFixed(2)} expected points across ${l.count} moves, making it a valuable training target.`, drillIds: drills.filter(d => d.motifs.includes(l.motif)).map(d => d.id),
  } }));
  const clock = clockUsage(games, analyses);
  if (clock.timeTroubleErrors >= 2) candidates.push({ weight: clock.timeTroublePointsLost, value: { kind: 'clock', motif: 'time-trouble', title: 'Practise clock management', reason: `${Math.round(clock.timeTroublePercent!)}% of your errors with known clocks happened in time trouble; practise keeping a reserve for critical decisions.`, drillIds: drills.filter(d => d.motifs.includes('time-trouble')).map(d => d.id) } });
  if (clock.rushedErrors >= 2) candidates.push({ weight: clock.rushingPointsLost, value: { kind: 'clock', title: 'Pause before critical moves', reason: `${clock.rushedErrors} mistakes or blunders took less than three seconds; practise checking threats before committing.`, drillIds: [] } });
  const openingByGame = new Map(games.map(g => [g.id, resultsByOpening([g], selected)[0].key]));
  for (const o of resultsByOpening(games, selected).filter(o => o.games >= 8 && o.name !== 'Unknown opening')) {
    const pointsLost = userMoves(games, selected).filter(({ g, m }) => openingByGame.get(g.id) === o.key && m.ply <= 20 && finite(m.epLoss))
      .reduce((sum, { m }) => sum + Math.max(0, m.epLoss), 0);
    if (pointsLost <= 0) continue;
    // Leave room for the full sentence even for unusually long opening families.
    const family = o.name.length <= 17 ? o.name : `${o.name.slice(0, 16).trimEnd()}…`;
    candidates.push({ weight: pointsLost, value: {
      kind: 'opening', motif: 'opening', openingKey: o.key, title: `Your ${family} is leaking points`,
      reason: `Opening moves in ${o.name} cost ${pointsLost.toFixed(2)} expected points across ${o.games} game${(o.games) === 1 ? '' : 's'} (score ${Math.round(o.scorePercent)}%). Review recurring positions to recover those points.`,
      drillIds: drills.filter(d => d.motifs.includes('opening') && openingByGame.get(d.gameId) === o.key).map(d => d.id),
    } });
  }
  return candidates.sort((a, b) => b.weight - a.weight)[0]?.value ?? { kind: 'review', title: 'Review your next game', reason: 'Review a game to identify a recurring mistake and turn it into targeted practice.', drillIds: [] };
}

/** Heuristic, not an Elo estimate: 50 is neutral improvement; accuracy delta (45%), fewer errors (35%), and drill success (20%). Missing components are omitted; no evidence => 0. */
export function progressScore(games: StoredGame[], analyses: SlimAnalysis[], drills: Drill[], now: number): number {
  const week = weeklySummary(games, analyses, now), components: [number, number][] = [];
  if (week.delta.accuracy !== null) components.push([clamp(50 + week.delta.accuracy * 5), .45]);
  if (week.delta.errorsPer100 !== null) components.push([clamp(50 - week.delta.errorsPer100 * 5), .35]);
  const attempts = drills.reduce((s, d) => s + Math.max(0, d.attempts), 0);
  if (attempts) components.push([clamp(100 * drills.reduce((s, d) => s + clamp(d.solved, 0, Math.max(0, d.attempts)), 0) / attempts), .2]);
  return components.length ? Math.round(components.reduce((s, [v, w]) => s + v * w, 0) / components.reduce((s, [, w]) => s + w, 0)) : 0;
}

/** Recovered win probability in percentage points, not a prediction of future results. */
export function recovery(drills: FsrsDrill[], analyses: SlimAnalysis[] = []): { mastered: number; inProgress: number; winPctRecovered: number } {
  const selected = new Map<string, SlimAnalysis>();
  for (const a of analyses) {
    const old = selected.get(a.gameId);
    if (!old || a.depth > old.depth || (a.depth === old.depth && a.createdAt > old.createdAt)) selected.set(a.gameId, a);
  }
  const moves = new Map<string, SlimMove>([...selected.values()].flatMap(a => a.moves.map(m => [`${a.gameId}:${m.ply}`, m] as const)));
  let mastered = 0, winPctRecovered = 0;
  for (const d of drills) if (isMastered(d)) {
    mastered++;
    const m = moves.get(d.id) ?? d.move;
    if (m && finite(m.winBefore) && finite(m.winAfter)) winPctRecovered += m.winBefore - m.winAfter;
  }
  return { mastered, inProgress: drills.length - mastered, winPctRecovered };
}

/** Tomorrow is the next local calendar day; nextDueAt is the earliest future review. */
export function dueForecast(drills: Drill[], now: number): { dueNow: number; dueTomorrow: number; nextDueAt: number | null } {
  const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0);
  const end = new Date(tomorrow); end.setDate(end.getDate() + 1);
  const future = drills.filter(d => finite(d.due) && d.due > now).map(d => d.due);
  return {
    dueNow: drills.filter(d => d.due <= now).length,
    dueTomorrow: future.filter(due => due >= +tomorrow && due < +end).length,
    nextDueAt: future.length ? future.reduce((earliest, due) => Math.min(earliest, due), Infinity) : null,
  };
}

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface PieceBlunders { piece: PieceType; name: string; blunders: number; percent: number }
export interface Performance extends Results { accuracy: number | null; accuracyGames: number }
export interface MotifComparison { motif: Motif; thisMonth: number; lastMonth: number; thisMonthPer100: number | null; lastMonthPer100: number | null }
export interface InsightCard {
  id: string; title: string; body: string;
  metric?: { value: string; label: string; trend?: 'up' | 'down' | 'flat' };
  cta?: { label: string; href: string }; severity: 'win' | 'warn' | 'info';
}
const pieceNames: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** Piece making the blunder, not necessarily the piece subsequently lost. Invalid positions are omitted. */
export function blundersByPiece(games: StoredGame[], analyses: SlimAnalysis[]): PieceBlunders[] {
  const counts = new Map<PieceType, number>();
  for (const { m } of userMoves(games, analyses)) if (m.cls === 'blunder') {
    try {
      const piece = new Chess(m.fenBefore).get(m.from as Parameters<Chess['get']>[0]);
      if (piece?.color === m.color) counts.set(piece.type, (counts.get(piece.type) ?? 0) + 1);
    } catch { /* No trustworthy piece attribution for an invalid position. */ }
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  return [...counts].map(([piece, blunders]) => ({ piece, name: pieceNames[piece], blunders, percent: 100 * blunders / total }))
    .sort((a, b) => b.blunders - a.blunders || a.name.localeCompare(b.name));
}

/** Calendar months in UTC, comparing month-to-date with the complete previous month; rates use user moves. */
export function motifBreakdown(games: StoredGame[], analyses: SlimAnalysis[], now: number): MotifComparison[] {
  const date = new Date(now), start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const previous = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
  const moves = userMoves(games.filter(g => g.endTime >= previous && g.endTime <= now), analyses);
  const current = moves.filter(({ g }) => g.endTime >= start), last = moves.filter(({ g }) => g.endTime < start);
  const motifs = [...new Set(moves.flatMap(({ m }) => m.motifs))].sort();
  return motifs.map(motif => {
    const thisMonth = current.filter(({ m }) => m.motifs.includes(motif)).length;
    const lastMonth = last.filter(({ m }) => m.motifs.includes(motif)).length;
    return { motif, thisMonth, lastMonth, thisMonthPer100: percent(thisMonth, current.length), lastMonthPer100: percent(lastMonth, last.length) };
  });
}
function performance(games: StoredGame[], analyses: SlimAnalysis[]): Performance {
  const values = accuracyTrend(games, analyses).map(p => p.value);
  return { ...results(games), accuracy: average(values), accuracyGames: values.length };
}
/** Similar means within 100 rating points, inclusively. Missing ratings are excluded. */
export function performanceByRatingBand(games: StoredGame[], analyses: SlimAnalysis[] = []): Record<'lower' | 'similar' | 'higher', Performance> {
  const buckets: Record<'lower' | 'similar' | 'higher', StoredGame[]> = { lower: [], similar: [], higher: [] };
  for (const g of games) {
    const own = selfOf(g).rating, other = (g.userColor === 'w' ? g.black : g.white).rating;
    if (!finite(own) || !finite(other)) continue;
    const difference = other - own;
    buckets[difference < -100 ? 'lower' : difference > 100 ? 'higher' : 'similar'].push(g);
  }
  return { lower: performance(buckets.lower, analyses), similar: performance(buckets.similar, analyses), higher: performance(buckets.higher, analyses) };
}
/** Immediate next chronological game, across all time controls; draws do not start either cohort. */
export function tiltDetection(games: StoredGame[], analyses: SlimAnalysis[] = []) {
  const ordered = [...games].sort((a, b) => a.endTime - b.endTime || a.id.localeCompare(b.id));
  const afterLoss: StoredGame[] = [], afterWin: StoredGame[] = [];
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i - 1].userResult === 'loss') afterLoss.push(ordered[i]);
    if (ordered[i - 1].userResult === 'win') afterWin.push(ordered[i]);
  }
  const loss = performance(afterLoss, analyses), win = performance(afterWin, analyses);
  return { afterLoss: loss, afterWin: win, accuracyDelta: loss.accuracy !== null && win.accuracy !== null ? loss.accuracy - win.accuracy : null,
    scoreDelta: loss.games && win.games ? loss.scorePercent - win.scorePercent : null };
}
/** Local hours (0–23): the player's own clock is what matters for habits. */
export function performanceByTimeOfDay(games: StoredGame[], analyses: SlimAnalysis[] = []): (Performance & { hour: number })[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, ...performance(games.filter(g => new Date(g.endTime).getHours() === hour), analyses) }));
}
/** Local weekday, Sunday = 0. */
export function performanceByDayOfWeek(games: StoredGame[], analyses: SlimAnalysis[] = []): (Performance & { day: number; name: string })[] {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((name, day) => ({ day, name,
    ...performance(games.filter(g => new Date(g.endTime).getDay() === day), analyses) }));
}
/** Exact control and class are kept separate (e.g. 300 and 300+5). */
export function performanceByTimeControl(games: StoredGame[], analyses: SlimAnalysis[] = []): (Performance & { timeControl: string; timeClass: string })[] {
  const buckets = new Map<string, StoredGame[]>();
  for (const g of games) { const key = JSON.stringify([g.timeClass, g.timeControl]); buckets.set(key, [...(buckets.get(key) ?? []), g]); }
  return [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([, xs]) => ({ timeControl: xs[0].timeControl, timeClass: xs[0].timeClass, ...performance(xs, analyses) }));
}
/** Before includes both sides' move 30 (plies 59–60); after starts at move 31. Move-weighted accuracy. */
export function accuracyAfterMove30(games: StoredGame[], analyses: SlimAnalysis[]) {
  const moves = userMoves(games, analyses).map(({ m }) => m).filter(m => finite(m.accuracy));
  const beforeValues = moves.filter(m => m.ply <= 60).map(m => m.accuracy), afterValues = moves.filter(m => m.ply > 60).map(m => m.accuracy);
  const before = { moves: beforeValues.length, average: average(beforeValues) }, after = { moves: afterValues.length, average: average(afterValues) };
  return { before, after, delta: before.average !== null && after.average !== null ? after.average - before.average : null };
}
/** Monday-based UTC week to date. Ranked by known user accuracy, then game id. */
export function bestWorstGameThisWeek(games: StoredGame[], analyses: SlimAnalysis[], now: number) {
  const start = weeklySummary([], [], now).start;
  const points = accuracyTrend(games.filter(g => g.endTime >= start && g.endTime <= now), analyses)
    .sort((a, b) => b.value - a.value || a.gameId.localeCompare(b.gameId));
  return { best: points[0] ?? null, worst: points[points.length - 1] ?? null };
}

/** Ranked measured findings first; sparse histories receive factual coverage cards, never invented comparisons. */
export function insightCards(games: StoredGame[], analyses: SlimAnalysis[], drills: Drill[], now: number): InsightCard[] {
  const past = games.filter(g => g.endTime <= now), candidates: { rank: number; card: InsightCard }[] = [];
  const add = (rank: number, card: InsightCard) => candidates.push({ rank, card });
  const round = (n: number) => Number(n.toFixed(1)).toString();
  const tilt = tiltDetection(past, analyses);
  if (tilt.accuracyDelta !== null) add(100, { id: 'tilt', title: 'Your game after a loss', severity: tilt.accuracyDelta < 0 ? 'warn' : 'win',
    body: `After a loss your accuracy averages ${round(tilt.afterLoss.accuracy!)} across ${tilt.afterLoss.accuracyGames} game${(tilt.afterLoss.accuracyGames) === 1 ? '' : 's'}, versus ${round(tilt.afterWin.accuracy!)} across ${tilt.afterWin.accuracyGames} game${tilt.afterWin.accuracyGames === 1 ? '' : 's'} after a win.${tilt.accuracyDelta < 0 ? ` That is ${round(-tilt.accuracyDelta)} points lower; try a 5-minute break before the next game.` : ''}` });
  const pieces = blundersByPiece(past, analyses), errors = errorRates(past, analyses);
  if (pieces.length) add(95, { id: 'piece-blunders', title: `Check your ${pieces[0].name} moves`, severity: 'warn', body: `${pieces[0].blunders} of your ${errors.blunders} blunders were moves with your ${pieces[0].name}${pieces.length > 1 && pieces[0].blunders === pieces[1].blunders ? ', tied for the most' : ', the most of any piece'}. Check what your opponent can capture before moving it.` });
  const late = accuracyAfterMove30(past, analyses);
  if (late.delta !== null) add(90, { id: 'late-accuracy', title: 'Keep your focus after move 30', severity: late.delta < 0 ? 'warn' : 'win', body: `Your accuracy is ${round(late.before.average!)} through move 30 (${late.before.moves} moves) and ${round(late.after.average!)} afterwards (${late.after.moves} moves).`, metric: { value: round(late.delta), label: 'accuracy point change', trend: late.delta > 0 ? 'up' : late.delta < 0 ? 'down' : 'flat' } });
  for (const row of motifBreakdown(past, analyses, now).sort((a, b) => b.thisMonth - a.thisMonth).slice(0, 1)) add(85, { id: 'motif-month', title: 'Your recurring pattern', severity: 'info', body: `${({ 'hung-piece': 'Leaving a piece available to capture', 'allowed-mate': 'Allowing checkmate', 'missed-mate': 'Missing checkmate', 'missed-win': 'Missing a winning opportunity', 'missed-fork': 'Missing a fork', 'time-trouble': 'Time pressure', opening: 'An opening issue', endgame: 'An endgame issue', positional: 'A positional issue' } satisfies Record<Motif, string>)[row.motif]} appeared on ${row.thisMonth} moves this month so far and ${row.lastMonth} last month.${row.thisMonthPer100 !== null && row.lastMonthPer100 !== null ? ` That is ${round(row.thisMonthPer100)} versus ${round(row.lastMonthPer100)} per 100 moves.` : ''}` });
  const bands = performanceByRatingBand(past, analyses);
  const band = (Object.keys(bands) as (keyof typeof bands)[]).filter(key => bands[key].games).sort((a, b) => bands[b].games - bands[a].games)[0];
  if (band) add(70, { id: 'rating-band', title: `Against ${band}-rated opponents`, severity: 'info', body: `You scored ${round(bands[band].scorePercent)}% across ${bands[band].games} game${(bands[band].games) === 1 ? '' : 's'} against ${band}-rated opponents: ${bands[band].wins} wins, ${bands[band].draws} draws and ${bands[band].losses} losses. Similar means within 100 rating points.` });
  const controls = performanceByTimeControl(past, analyses).sort((a, b) => b.games - a.games);
  if (controls.length) add(65, { id: 'time-control', title: 'Your most-played time control', severity: 'info', body: `In ${controls[0].timeClass} with time-control setting ${controls[0].timeControl}, you scored ${round(controls[0].scorePercent)}% across ${controls[0].games} game${(controls[0].games) === 1 ? '' : 's'}.` });
  const days = performanceByDayOfWeek(past, analyses).filter(d => d.games >= 3).sort((a, b) => b.scorePercent - a.scorePercent || b.games - a.games);
  if (days.length) add(60, { id: 'weekday', title: `Your ${days[0].name} results`, severity: 'info', body: `On ${days[0].name}s, you scored ${round(days[0].scorePercent)}% across ${days[0].games} game${(days[0].games) === 1 ? '' : 's'}.` });
  const hours = performanceByTimeOfDay(past, analyses).filter(h => h.games >= 3).sort((a, b) => b.scorePercent - a.scorePercent || b.games - a.games);
  if (hours.length) add(59, { id: 'hour', title: 'Your time-of-day results', severity: 'info', body: `Between ${hours[0].hour}:00 and ${hours[0].hour}:59, you scored ${round(hours[0].scorePercent)}% across ${hours[0].games} game${(hours[0].games) === 1 ? '' : 's'}.` });
  const week = bestWorstGameThisWeek(past, analyses, now);
  if (week.best) add(80, { id: 'week-games', title: 'Your best and worst games this week', severity: 'info', body: `Your best accuracy this week is ${round(week.best.value)}; your lowest is ${round(week.worst!.value)}${week.best.gameId === week.worst!.gameId ? ' (only one game has known accuracy)' : ''}.`, cta: { label: 'Review your lowest-accuracy game', href: `#/review/${encodeURIComponent(week.worst!.gameId)}` } });
  const measured = pairs(past, analyses).length, attempts = drills.reduce((sum, d) => sum + Math.max(0, d.attempts), 0);
  add(10, { id: 'coverage', title: 'Your analysis coverage', severity: 'info', body: `${measured} of your ${past.length} game${past.length === 1 ? '' : 's'} have engine analysis. Analyse more games to uncover recurring patterns.` });
  add(9, { id: 'training', title: 'Your training practice', severity: 'info', body: `You have ${drills.length} practice positions and ${attempts} recorded attempts.` });
  add(8, { id: 'results', title: 'Your results so far', severity: 'info', body: `${results(past).wins} wins, ${results(past).draws} draws and ${results(past).losses} losses across ${past.length} game${(past.length) === 1 ? '' : 's'}.` });
  add(7, { id: 'errors', title: 'Your analysed moves', severity: 'info', body: `Across ${errors.moves} analysed moves, you made ${errors.blunders} blunders and ${errors.mistakes} mistakes.` });
  return candidates.sort((a, b) => b.rank - a.rank || a.card.id.localeCompare(b.card.id)).slice(0, 8).map(c => c.card);
}
