import { describe, expect, it } from 'vitest';
import type { FsrsDrill } from '../srs';
import { Chess } from 'chess.js';
import { accuracyByPhase, accuracyTrend, bestWorstOpenings, biggestSwings, clockUsage, comebackRate, conversionRate, errorRates, focusRecommendation, recovery, dueForecast, progressScore, ratingTrend, resultsByColour, resultsByOpening, resultsByTimeClass, weeklySummary } from '../insights';
import type { AnalysedMove, Drill, GameAnalysis, SideSummary, StoredGame } from '../types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5, 12);
const START = new Chess().fen();
const ENDGAME = '8/8/8/8/8/3k4/8/3K4 w - - 0 30';
function game(id = 'g', extra: Partial<StoredGame> = {}): StoredGame {
  return { id, url: `https://chess.com/game/${id}`, pgn: '', endTime: NOW, timeClass: 'rapid', timeControl: '300', rated: true, white: { username: 'me', rating: 1200, result: 'win' }, black: { username: 'them', rating: 1300, result: 'resigned' }, userColor: 'w', userResult: 'win', analysed: true, ...extra };
}
function move(ply = 1, extra: Partial<AnalysedMove> = {}): AnalysedMove {
  return { ply, color: ply % 2 ? 'w' : 'b', san: 'e4', uci: 'e2e4', from: 'e2', to: 'e4', fenBefore: START, fenAfter: START, scoreBefore: { cp: 0 }, scoreAfter: { cp: 0 }, winBefore: 50, winAfter: 50, epLoss: 0, accuracy: 90, bestUci: 'e2e4', bestSan: 'e4', bestLineSan: [], replyLineSan: [], cls: 'good', comment: '', motifs: [], ...extra };
}
function summary(accuracy = 80): SideSummary { return { accuracy, estRating: 1200, counts: {} as SideSummary['counts'], phases: { opening: accuracy, middlegame: null, endgame: null } }; }
function analysis(gameId = 'g', moves: AnalysedMove[] = [], extra: Partial<GameAnalysis> = {}): GameAnalysis {
  return { gameId, moves, depth: 16, createdAt: NOW, winCurve: [], white: summary(), black: summary(60), ...extra };
}
function drill(id = 'd', extra: Partial<Drill> = {}): Drill {
  return { id, gameId: 'g', ply: 1, fen: START, color: 'w', bestUci: 'e2e4', bestSan: 'e4', playedSan: 'd4', cls: 'blunder', winBefore: 50, motifs: ['hung-piece'], reps: 0, lapses: 0, ease: 2.5, interval: 0, due: NOW, attempts: 0, solved: 0, createdAt: NOW, opponent: 'them', ...extra };
}

describe('empty input', () => {
  it('returns empty collections, zero counts and unknown measured rates', () => {
    expect(ratingTrend([], NOW)).toEqual([]);
    expect(accuracyTrend([], [])).toEqual([]);
    expect(resultsByColour([]).w).toEqual({ games: 0, wins: 0, draws: 0, losses: 0, scorePercent: 0 });
    expect(resultsByTimeClass([])).toEqual({});
    expect(resultsByOpening([], [])).toEqual([]);
    expect(bestWorstOpenings([], [])).toEqual({ best: null, worst: null });
    expect(clockUsage([], [])).toMatchObject({ errors: 0, timeTroublePercent: null, rushingPercent: null, byPhase: { opening: { moves: 0, average: null } } });
    expect(conversionRate([], [])).toEqual({ opportunities: 0, successes: 0, percent: null });
    expect(comebackRate([], [])).toEqual({ opportunities: 0, successes: 0, percent: null });
    expect(errorRates([], [])).toEqual({ moves: 0, blunders: 0, mistakes: 0, blundersPer100: 0, mistakesPer100: 0 });
    expect(accuracyByPhase([], []).endgame.average).toBeNull();
    expect(biggestSwings([], [])).toEqual([]);
    expect(weeklySummary([], [], NOW).delta.accuracy).toBeNull();
    expect(focusRecommendation([], [])).toMatchObject({ kind: 'review', drillIds: [] });
    expect(progressScore([], [], [], NOW)).toBe(0);
  });
});

describe('rating and accuracy trends', () => {
  it('sorts per class, uses self colour, and requires a historical baseline', () => {
    const games = [game('new', { white: { username: 'me', rating: 1250, result: 'win' } }), game('old', { endTime: NOW - 31 * DAY }), game('week', { endTime: NOW - 7 * DAY, white: { username: 'me', rating: 1220, result: 'win' } }), game('black', { userColor: 'b', timeClass: 'blitz' }), game('unrated', { rated: false }), game('future', { endTime: NOW + DAY })];
    const trends = ratingTrend(games, NOW);
    expect(trends).toHaveLength(2);
    expect(trends[0]).toMatchObject({ timeClass: 'blitz', delta7: null, delta30: null, points: [{ value: 1300 }] });
    expect(trends[1]).toMatchObject({ timeClass: 'rapid', delta7: 30, delta30: 50 });
    expect(trends[1].points.map(p => p.gameId)).toEqual(['old', 'week', 'new']);
    expect(games[0].id).toBe('new');
  });
  it('keeps zero accuracy, skips missing values and rolls over known games', () => {
    const games = [game('c', { userAccuracy: 100 }), game('a', { endTime: NOW - 3 * DAY, userAccuracy: 0 }), game('b', { endTime: NOW - DAY, userColor: 'b', userAccuracy: 99 }), game('missing')];
    const points = accuracyTrend(games, [analysis('b')], 2);
    expect(points.map(p => p.value)).toEqual([0, 60, 100]);
    expect(points.map(p => p.rollingAverage)).toEqual([0, 30, 80]);
    expect(accuracyTrend([game('provider', { chesscomAccuracy: { white: 71, black: 42 }, userColor: 'b' })], [], 0)[0].rollingAverage).toBe(42);
  });
  it('selects deepest then newest analysis and ignores orphan analyses', () => {
    const games = [game()];
    const as = [analysis('g', [move(1, { cls: 'blunder' })], { depth: 10 }), analysis('g', [move()], { depth: 20, createdAt: 1, white: summary(70) }), analysis('g', [move(1, { cls: 'mistake' })], { depth: 20, createdAt: 2, white: summary(75) }), analysis('orphan', [move()])];
    expect(accuracyTrend(games, as)[0].value).toBe(75);
    expect(errorRates(games, as)).toMatchObject({ moves: 1, blunders: 0, mistakes: 1 });
  });
});

describe('results and openings', () => {
  it('counts W/D/L and half-points for draws by colour and class', () => {
    const games = [game(), game('d', { userResult: 'draw' }), game('l', { userColor: 'b', userResult: 'loss', timeClass: 'blitz' })];
    expect(resultsByColour(games)).toMatchObject({ w: { games: 2, wins: 1, draws: 1, losses: 0, scorePercent: 75 }, b: { games: 1, losses: 1, scorePercent: 0 } });
    expect(resultsByTimeClass(games).rapid.games).toBe(2);
  });
  it('groups ECO decades and opening names while folding colon variations', () => {
    const games = [game('a'), game('b', { pgn: '[ECO "B23"]\n[Opening "Sicilian Defense: Closed"]' }), game('c', { pgn: '[ECO "C20"]\n[ECOUrl "https://www.chess.com/openings/Kings-Pawn-Game"]' }), game('d', { eco: 'https://www.chess.com/openings/French-Defense' }), game('unknown')];
    const rows = resultsByOpening(games, [analysis('a', [], { eco: 'B20', opening: 'Sicilian Defense: Open' })]);
    expect(rows[0]).toMatchObject({ ecoFamily: 'B2', name: 'Sicilian Defense', games: 2 });
    expect(rows.find(r => r.ecoFamily === 'C2')?.name).toBe('Kings Pawn Game');
    expect(rows.find(r => r.name === 'French Defense')).toBeDefined();
    expect(rows.find(r => r.name === 'Unknown opening')?.games).toBe(1);
  });
  it('respects minimum samples and sorts by score percentage', () => {
    const games = ['a', 'b', 'c'].map(id => game(id, { pgn: '[ECO "B20"]\n[Opening "Sicilian"]', userResult: 'loss' }));
    games.push(...['d', 'e', 'f'].map(id => game(id, { pgn: '[ECO "C00"]\n[Opening "French"]' })), game('lucky', { pgn: '[Opening "Rare"]' }));
    expect(bestWorstOpenings(games, [])).toMatchObject({ best: { name: 'French', games: 3 }, worst: { name: 'Sicilian', games: 3 } });
    expect(bestWorstOpenings(games, [], 4)).toEqual({ best: null, worst: null });
  });
  it('handles malformed optional ECO URLs', () => {
    expect(resultsByOpening([game('g', { pgn: '[ECOUrl "https://x/%bad"]' })], [])[0].name).toBe('Unknown opening');
  });
});

describe('clock usage', () => {
  it('accounts for increments, per-side clocks, pressure before the move and rushing', () => {
    const g = game('g', { timeControl: '60+2' });
    const a = analysis('g', [move(1, { clock: 15, cls: 'blunder', epLoss: .4 }), move(2, { clock: 55 }), move(3, { clock: 15, cls: 'mistake', epLoss: .2 }), move(4, { clock: 52 }), move(5, { clock: 14, cls: 'blunder', epLoss: .3 })]);
    const clocks = clockUsage([g], [a]);
    expect(clocks.byPhase.opening).toEqual({ moves: 3, average: 52 / 3 });
    expect(clocks).toMatchObject({ errors: 3, errorsWithClock: 3, errorsWithDuration: 3, timeTroubleErrors: 2, rushedErrors: 1 });
    expect(clocks.timeTroublePercent).toBeCloseTo(200 / 3);
    expect(clocks.timeTroublePointsLost).toBeCloseTo(.5);
    expect(clocks.rushingPointsLost).toBeCloseTo(.2);
  });
  it('uses 10% clock on long controls and strictly less than 20 seconds', () => {
    const long = clockUsage([game('g', { timeControl: '600' })], [analysis('g', [move(1, { clock: 59 }), move(3, { clock: 58, cls: 'mistake' })])]);
    expect(long.timeTroubleErrors).toBe(1);
    const edge = clockUsage([game('g', { timeControl: '60' })], [analysis('g', [move(1, { clock: 20 }), move(3, { clock: 17, cls: 'mistake' })])]);
    expect(edge.timeTroubleErrors).toBe(0);
    expect(edge.rushedErrors).toBe(0);
  });
  it('does not bridge missing clock annotations or missing plies', () => {
    const clocks = clockUsage([game()], [analysis('g', [move(1, { clock: 10 }), move(3), move(5, { clock: 8, cls: 'blunder' }), move(9, { clock: 6, cls: 'mistake' })])]);
    expect(clocks).toMatchObject({ errors: 2, errorsWithClock: 0, errorsWithDuration: 0, rushingPercent: null });
    expect(clocks.byPhase.opening.moves).toBe(1);
  });
  it('reads real PGN comments and leaves sparse clocks attached to their actual moves', () => {
    const pgn = '[TimeControl "60+2"]\n\n1. e4 {[%clk 0:00:59.5]} e5 {[%clk 0:00:58]} 2. Nf3 Nc6 {[%clk 0:00:56]} 3. Bb5 {[%clk 0:00:50]} *';
    expect(clockUsage([game('g', { pgn })], []).byPhase.opening).toEqual({ moves: 1, average: 2.5 });
    const a = analysis('g', [move(1), move(2), move(3), move(4), move(5, { cls: 'blunder' })]);
    expect(clockUsage([game('g', { pgn })], [a])).toMatchObject({ errors: 1, errorsWithClock: 0, errorsWithDuration: 0 });
  });
  it('handles Black, missing PGN headers, daily controls and impossible negative durations', () => {
    const black = clockUsage([game('g', { userColor: 'b', timeControl: '60' })], [analysis('g', [move(1, { clock: 10 }), move(2, { clock: 55 }), move(4, { clock: 53 })])]);
    expect(black.byPhase.opening).toEqual({ moves: 2, average: 3.5 });
    for (const extra of [{ timeControl: '1/86400' }, { timeClass: 'daily' }]) expect(clockUsage([game('g', extra)], [analysis('g', [move(1, { clock: 1, cls: 'mistake' })])]).errorsWithClock).toBe(0);
    expect(clockUsage([game('g', { timeControl: '60' })], [analysis('g', [move(1, { clock: 80 })])]).byPhase.opening.average).toBeNull();
  });
});

describe('evaluation and phase insights', () => {
  it('converts White win curves for Black and counts opportunities once per game', () => {
    const games = [game('w'), game('b', { userColor: 'b', userResult: 'draw' }), game('l', { userResult: 'loss' }), game('none')];
    const as = [analysis('w', [], { winCurve: [50, 80, 90, 20] }), analysis('b', [], { winCurve: [50, 20, 80] }), analysis('l', [], { winCurve: [50, 20, 80] })];
    expect(conversionRate(games, as)).toMatchObject({ opportunities: 3, successes: 1 });
    expect(comebackRate(games, as)).toMatchObject({ opportunities: 3, successes: 2 });
  });
  it('uses opponent move evaluations when the curve is unavailable', () => {
    const g = game('g', { userColor: 'b' });
    expect(conversionRate([g], [analysis('g', [move(1, { winBefore: 50, winAfter: 20 })])]).percent).toBe(100);
    expect(comebackRate([g], [analysis('g', [move(1, { winBefore: 80 })])]).percent).toBe(100);
  });
  it('counts only user moves, separates mistakes and blunders, and weights phases by moves', () => {
    const a = analysis('g', [move(1, { accuracy: 80, cls: 'mistake' }), move(2, { cls: 'blunder', epLoss: .9 }), move(3, { accuracy: 100 }), move(21, { accuracy: 60, cls: 'blunder' }), move(23, { accuracy: 40, fenBefore: ENDGAME })]);
    expect(errorRates([game()], [a])).toEqual({ moves: 4, blunders: 1, mistakes: 1, blundersPer100: 25, mistakesPer100: 25 });
    expect(accuracyByPhase([game()], [a])).toEqual({ opening: { moves: 2, average: 90 }, middlegame: { moves: 1, average: 60 }, endgame: { moves: 1, average: 40 } });
  });
  it('returns top positive user swings with deep-link identifiers, without mutation', () => {
    const a = analysis('g', [move(1, { epLoss: .2 }), move(2, { epLoss: 1 }), move(3, { epLoss: .6 }), move(5)]);
    expect(biggestSwings([game()], [a], 1)).toEqual([{ gameId: 'g', ply: 3, san: 'e4', epLoss: .6, winBefore: 50, winAfter: 50 }]);
    expect(biggestSwings([game()], [a], -1)).toEqual([]);
    expect(a.moves[0].ply).toBe(1);
  });
});

describe('weekly comparisons, recommendations and progress', () => {
  const monday = Date.UTC(2026, 10, 2);
  it('compares equivalent UTC week-to-date windows, excluding future and prior-week tail', () => {
    const games = [game('current', { endTime: monday }), game('last', { endTime: monday - 7 * DAY, userResult: 'loss' }), game('tail', { endTime: monday - DAY }), game('future', { endTime: NOW + 1 })];
    const as = [analysis('current', [move()], { white: summary(90) }), analysis('last', [move(1, { cls: 'blunder' })], { white: summary(70) })];
    const weekly = weeklySummary(games, as, NOW);
    expect(weekly.start).toBe(monday);
    expect(weekly.thisWeek.games).toBe(1);
    expect(weekly.lastWeek.games).toBe(1);
    expect(weekly.delta).toEqual({ games: 0, accuracy: 20, scorePercent: 100, errorsPer100: -100 });
    expect(weeklySummary([], [], Date.UTC(2026, 10, 8)).start).toBe(monday);
  });
  it('selects the largest leak and links relevant drills', () => {
    const a = analysis('g', [move(1, { epLoss: .6, motifs: ['hung-piece'], cls: 'blunder' }), move(3, { epLoss: .1, motifs: ['opening'] })]);
    expect(focusRecommendation([game()], [a], [drill(), drill('other', { motifs: ['opening'] })])).toMatchObject({ kind: 'leak', motif: 'hung-piece', drillIds: ['d'] });
  });
  it('recommends time trouble or rushing using measured errors', () => {
    const a = analysis('g', [move(1, { clock: 10 }), move(3, { clock: 6, cls: 'blunder', epLoss: .4 }), move(5, { clock: 2, cls: 'mistake', epLoss: .2 })]);
    expect(focusRecommendation([game('g', { timeControl: '60' })], [a]).kind).toBe('clock');
    const rushed = analysis('g', [move(1, { clock: 59, cls: 'blunder', epLoss: .4 }), move(3, { clock: 58, cls: 'mistake', epLoss: .2 })]);
    expect(focusRecommendation([game('g', { timeControl: '60' })], [rushed]).title).toBe('Pause before critical moves');
  });
  it('requires eight opening games and ranks measured losses rather than results', () => {
    const games = Array.from({ length: 8 }, (_, i) => game(`f${i}`, { pgn: '[ECO "C00"]\n[Opening "French Defense: Advance"]' }));
    const as = games.map(g => analysis(g.id, [move(1, { epLoss: .2, motifs: ['opening', 'hung-piece'] })]));
    games.push(...Array.from({ length: 8 }, (_, i) => game(`c${i}`, { userResult: 'loss', pgn: '[ECO "B10"]\n[Opening "Caro-Kann, Exchange"]' })));
    as.push(...games.slice(8).map(g => analysis(g.id, [move(1, { epLoss: .01 })])));
    const result = focusRecommendation(games, as, [drill('opening', { gameId: 'f0', motifs: ['opening'] })]);
    expect(result).toMatchObject({ kind: 'opening', openingKey: 'C0:french defense', title: 'Your French Defense is leaking points', drillIds: ['opening'] });
    expect(result.reason).toContain('1.60 expected points');
    expect(focusRecommendation(games.slice(0, 7), as).kind).toBe('leak');
    expect(focusRecommendation(games, []).kind).toBe('review');
  });
  it('folds comma variations and bounds long opening family titles', () => {
    const name = 'An Extremely Long Opening Family Name';
    const games = Array.from({ length: 8 }, (_, i) => game(`${i}`, { pgn: `[Opening "${name}, Variation"]` }));
    const result = focusRecommendation(games, games.map(g => analysis(g.id, [move(1, { epLoss: .2 })])));
    expect(result.kind).toBe('opening');
    expect(result.title.length).toBeLessThanOrEqual(40);
    expect(result.reason).toContain(name);
  });
  it('scores improvement, decline, neutral performance and training within 0–100', () => {
    const games = [game('new'), game('old', { endTime: NOW - 7 * DAY })];
    const improving = [analysis('new', [move()], { white: summary(90) }), analysis('old', [move(1, { cls: 'blunder' })], { white: summary(60) })];
    expect(progressScore(games, improving, [], NOW)).toBe(100);
    const declining = [analysis('new', [move(1, { cls: 'blunder' })], { white: summary(60) }), analysis('old', [move()], { white: summary(90) })];
    expect(progressScore(games, declining, [], NOW)).toBe(0);
    expect(progressScore(games, [analysis('new', [move()]), analysis('old', [move()])], [], NOW)).toBe(50);
    expect(progressScore([], [], [drill('d', { attempts: 4, solved: 3 })], NOW)).toBe(75);
    expect(progressScore([], [], [drill('d', { attempts: 1, solved: 5 })], NOW)).toBe(100);
  });
  it('does not mutate input arrays or nested records', () => {
    const games = [game()], as = [analysis('g', [move()])], ds = [drill()];
    const before = JSON.stringify({ games, as, ds });
    Object.freeze(games); Object.freeze(as); Object.freeze(ds); Object.freeze(as[0].moves);
    ratingTrend(games, NOW); accuracyTrend(games, as); clockUsage(games, as); focusRecommendation(games, as, ds); progressScore(games, as, ds, NOW);
    expect(JSON.stringify({ games, as, ds })).toBe(before);
  });
});

describe('recovery and due forecast', () => {
  const mastered = (id: string, stability = 21): FsrsDrill => ({ ...drill(id), fsrs: { stability } as FsrsDrill['fsrs'] });
  it('counts FSRS mastery and sums percentage-point recovery using selected analyses or embedded moves', () => {
    const ds = [mastered('game:with:colons:1'), { ...mastered('embedded'), move: move(1, { winBefore: 70, winAfter: 40 }) }, mastered('unknown'), mastered('learning', 20.9), drill('legacy', { reps: 99 })];
    const as = [analysis('game:with:colons', [move(1, { winBefore: 80, winAfter: 10 })], { depth: 10 }), analysis('game:with:colons', [move(1, { winBefore: 60, winAfter: 40 })], { depth: 20 })];
    expect(recovery(ds, as)).toEqual({ mastered: 3, inProgress: 2, winPctRecovered: 50 });
    expect(recovery([])).toEqual({ mastered: 0, inProgress: 0, winPctRecovered: 0 });
    expect(recovery([{ ...mastered('invalid'), move: move(1, { winBefore: NaN }) }]).winPctRecovered).toBe(0);
  });
  it('uses local calendar boundaries and excludes overdue cards from nextDueAt', () => {
    const now = +new Date(2026, 10, 5, 19), tomorrow = +new Date(2026, 10, 6), after = +new Date(2026, 10, 7);
    const ds = [now - 1, now, now + 1, tomorrow, after - 1, after].map((due, i) => drill(`${i}`, { due }));
    expect(dueForecast(ds, now)).toEqual({ dueNow: 2, dueTomorrow: 2, nextDueAt: now + 1 });
    expect(dueForecast(ds.slice(0, 2), now)).toEqual({ dueNow: 2, dueTomorrow: 0, nextDueAt: null });
    expect(dueForecast([], now)).toEqual({ dueNow: 0, dueTomorrow: 0, nextDueAt: null });
  });
});
