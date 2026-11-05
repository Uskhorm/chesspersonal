import { Chess } from 'chess.js';
import { initialClock, parseClocks } from './analysis';
import { selfOf } from './chesscom';
import { isEndgame } from './classify';
import { computeLeaks } from './learning';
import { isMastered, type FsrsDrill } from './srs';
import type { AnalysedMove, Color, Drill, GameAnalysis, Motif, StoredGame } from './types';

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
const isError = (m: AnalysedMove) => m.cls === 'mistake' || m.cls === 'blunder';
const phaseOf = (m: Pick<AnalysedMove, 'ply' | 'fenBefore'>): Phase => isEndgame(m.fenBefore) ? 'endgame' : m.ply <= 20 ? 'opening' : 'middlegame';
const phaseValues = (): Record<Phase, number[]> => ({ opening: [], middlegame: [], endgame: [] });
const phaseAverages = (xs: Record<Phase, number[]>): Record<Phase, PhaseAverage> => ({
  opening: { moves: xs.opening.length, average: average(xs.opening) },
  middlegame: { moves: xs.middlegame.length, average: average(xs.middlegame) },
  endgame: { moves: xs.endgame.length, average: average(xs.endgame) },
});
// Select one (deepest, then newest) analysis per game; orphan analyses never count.
function pairs(games: StoredGame[], analyses: GameAnalysis[]) {
  const byId = new Map<string, GameAnalysis>();
  for (const a of analyses) {
    const old = byId.get(a.gameId);
    if (!old || a.depth > old.depth || (a.depth === old.depth && a.createdAt > old.createdAt)) byId.set(a.gameId, a);
  }
  return games.flatMap(g => { const a = byId.get(g.id); return a ? [{ g, a }] : []; });
}
function userMoves(games: StoredGame[], analyses: GameAnalysis[]) {
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
export function accuracyTrend(games: StoredGame[], analyses: GameAnalysis[], window = 5): AccuracyPoint[] {
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
export function resultsByOpening(games: StoredGame[], analyses: GameAnalysis[]): OpeningResults[] {
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
export function bestWorstOpenings(games: StoredGame[], analyses: GameAnalysis[], minSample = 3): { best: OpeningResults | null; worst: OpeningResults | null } {
  const xs = resultsByOpening(games, analyses).filter(x => x.games >= Math.max(1, minSample)).sort((a, b) => b.scorePercent - a.scorePercent || b.games - a.games || a.key.localeCompare(b.key));
  return { best: xs[0] ?? null, worst: xs[xs.length - 1] ?? null };
}

/** Uses same-side clock differences plus Fischer increment. Unknown/missing annotations break the duration chain; daily/staged controls are excluded. */
export function clockUsage(games: StoredGame[], analyses: GameAnalysis[]): ClockUsage {
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
        const error = 'cls' in m && isError(m as AnalysedMove);
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

function opportunityRate(games: StoredGame[], analyses: GameAnalysis[], comeback: boolean): OpportunityRate {
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
export function conversionRate(games: StoredGame[], analyses: GameAnalysis[]): OpportunityRate { return opportunityRate(games, analyses, false); }
export function comebackRate(games: StoredGame[], analyses: GameAnalysis[]): OpportunityRate { return opportunityRate(games, analyses, true); }
export function errorRates(games: StoredGame[], analyses: GameAnalysis[]): ErrorRates {
  const xs = userMoves(games, analyses), blunders = xs.filter(({ m }) => m.cls === 'blunder').length, mistakes = xs.filter(({ m }) => m.cls === 'mistake').length;
  return { moves: xs.length, blunders, mistakes, blundersPer100: percent(blunders, xs.length) ?? 0, mistakesPer100: percent(mistakes, xs.length) ?? 0 };
}
/** Move-weighted phase accuracy, matching analysis.ts phase boundaries. */
export function accuracyByPhase(games: StoredGame[], analyses: GameAnalysis[]): Record<Phase, PhaseAverage> {
  const values = phaseValues();
  for (const { m } of userMoves(games, analyses)) if (finite(m.accuracy)) values[phaseOf(m)].push(m.accuracy);
  return phaseAverages(values);
}
export function biggestSwings(games: StoredGame[], analyses: GameAnalysis[], topN = 5): SwingMoment[] {
  return userMoves(games, analyses).filter(({ m }) => finite(m.epLoss) && m.epLoss > 0).map(({ g, m }) => ({ gameId: g.id, ply: m.ply, san: m.san, epLoss: m.epLoss, winBefore: m.winBefore, winAfter: m.winAfter }))
    .sort((a, b) => b.epLoss - a.epLoss || a.gameId.localeCompare(b.gameId) || a.ply - b.ply).slice(0, finite(topN) ? Math.max(0, Math.floor(topN)) : 5);
}

/** UTC Monday-to-now versus the same elapsed portion of the previous week; games exactly at now are included. */
export function weeklySummary(games: StoredGame[], analyses: GameAnalysis[], now: number): WeeklySummary {
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
export function focusRecommendation(games: StoredGame[], analyses: GameAnalysis[], drills: Drill[] = []): FocusRecommendation {
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
      reason: `Opening moves in ${o.name} cost ${pointsLost.toFixed(2)} expected points across ${o.games} games (score ${Math.round(o.scorePercent)}%). Review recurring positions to recover those points.`,
      drillIds: drills.filter(d => d.motifs.includes('opening') && openingByGame.get(d.gameId) === o.key).map(d => d.id),
    } });
  }
  return candidates.sort((a, b) => b.weight - a.weight)[0]?.value ?? { kind: 'review', title: 'Review your next game', reason: 'Review a game to identify a recurring mistake and turn it into targeted practice.', drillIds: [] };
}

/** Heuristic, not an Elo estimate: 50 is neutral improvement; accuracy delta (45%), fewer errors (35%), and drill success (20%). Missing components are omitted; no evidence => 0. */
export function progressScore(games: StoredGame[], analyses: GameAnalysis[], drills: Drill[], now: number): number {
  const week = weeklySummary(games, analyses, now), components: [number, number][] = [];
  if (week.delta.accuracy !== null) components.push([clamp(50 + week.delta.accuracy * 5), .45]);
  if (week.delta.errorsPer100 !== null) components.push([clamp(50 - week.delta.errorsPer100 * 5), .35]);
  const attempts = drills.reduce((s, d) => s + Math.max(0, d.attempts), 0);
  if (attempts) components.push([clamp(100 * drills.reduce((s, d) => s + clamp(d.solved, 0, Math.max(0, d.attempts)), 0) / attempts), .2]);
  return components.length ? Math.round(components.reduce((s, [v, w]) => s + v * w, 0) / components.reduce((s, [, w]) => s + w, 0)) : 0;
}

/** Recovered win probability in percentage points, not a prediction of future results. */
export function recovery(drills: FsrsDrill[], analyses: GameAnalysis[] = []): { mastered: number; inProgress: number; winPctRecovered: number } {
  const selected = new Map<string, GameAnalysis>();
  for (const a of analyses) {
    const old = selected.get(a.gameId);
    if (!old || a.depth > old.depth || (a.depth === old.depth && a.createdAt > old.createdAt)) selected.set(a.gameId, a);
  }
  const moves = new Map<string, AnalysedMove>([...selected.values()].flatMap(a => a.moves.map(m => [`${a.gameId}:${m.ply}`, m] as const)));
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
