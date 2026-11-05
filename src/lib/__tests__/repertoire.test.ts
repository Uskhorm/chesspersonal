import { slimAnalysis } from '../db';
import { Chess } from 'chess.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRepertoire, buildRepertoireAsync, lineFor, openingDrills, openingLeaks, repertoireSummary,
  type OpeningLookup,
} from '../repertoire';
import type { AnalysedMove, Classification, Color, GameAnalysis, SideSummary, StoredGame } from '../types';

const epd = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
const start = epd(new Chess().fen());
const noBook: OpeningLookup = () => null;
function game(id: string, moves: string[], color: Color = 'w', result: StoredGame['userResult'] = 'loss', fen?: string): StoredGame {
  const chess = new Chess(fen);
  for (const san of moves) chess.move(san);
  return {
    id, pgn: chess.pgn(), url: `https://example.test/${id}`, endTime: 1, timeClass: 'rapid', timeControl: '600', rated: true,
    white: { username: color === 'w' ? 'user' : 'opponent', rating: 1200, result: '' },
    black: { username: color === 'b' ? 'user' : 'opponent', rating: 1200, result: '' },
    userColor: color, userResult: result, analysed: true,
  };
}
function history(g: StoredGame) {
  const chess = new Chess();
  chess.loadPgn(g.pgn);
  return chess.history({ verbose: true });
}
function analysed(g: StoredGame, overrides: Record<number, Partial<AnalysedMove>> = {}): GameAnalysis {
  const classes: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];
  const side: SideSummary = {
    accuracy: 90, estRating: 1200, counts: Object.fromEntries(classes.map(c => [c, 0])) as Record<Classification, number>,
    phases: { opening: 90, middlegame: null, endgame: null },
  };
  return {
    gameId: g.id, createdAt: 1, depth: 16, white: side, black: side, winCurve: [],
    moves: history(g).map((m, i) => ({
      ply: i + 1, color: m.color, san: m.san, uci: m.from + m.to + (m.promotion ?? ''), from: m.from, to: m.to,
      fenBefore: m.before, fenAfter: m.after, scoreBefore: { cp: 0 }, scoreAfter: { cp: 0 },
      winBefore: 50, winAfter: 50, epLoss: 0, accuracy: 100, bestUci: m.lan, bestSan: m.san,
      bestLineSan: [m.san], replyLineSan: [], cls: 'good', comment: '', motifs: [], ...overrides[i + 1],
    })),
  };
}
const badE4 = { cls: 'mistake' as const, epLoss: 0.2, bestUci: 'd2d4', bestSan: 'd4' };
function bookFor(entries: [string[], string, string][]): OpeningLookup {
  const book = new Map<string, [string, string]>();
  for (const [moves, eco, name] of entries) {
    const chess = new Chess();
    for (const move of moves) chess.move(move);
    book.set(epd(chess.fen()), [eco, name]);
  }
  return fen => book.get(epd(fen));
}

afterEach(() => vi.useRealTimers());

describe('buildRepertoire', () => {
  it('returns separate empty trees and empty consumers', () => {
    const rep = buildRepertoire([], []);
    expect(rep.w.nodes).toEqual({});
    expect(rep.b.nodes).toEqual({});
    expect(openingLeaks(rep)).toEqual([]);
    expect(openingDrills(rep)).toEqual([]);
    expect(lineFor(rep, 'w', start)).toEqual([]);
    expect(repertoireSummary(rep).w).toEqual({ games: 0, openings: [], firstOutOfBook: null });
  });

  it('aggregates user moves, opponent replies and user-perspective results by colour', () => {
    const games = [game('win', ['e4', 'e5', 'Nf3'], 'w', 'win'), game('draw', ['e4', 'c5'], 'w', 'draw'), game('loss', ['d4', 'd5']), game('black', ['e4', 'e5'], 'b', 'win')];
    const rep = buildRepertoire(games, []);
    const root = rep.w.nodes[start];
    expect(root).toMatchObject({ count: 3, wins: 1, draws: 1, losses: 1, ply: 1 });
    expect(root.moves.e2e4).toMatchObject({ san: 'e4', count: 2, wins: 1, draws: 1, losses: 0, analysedCount: 0, avgEpLoss: null, avgClassification: null });
    const afterE4 = rep.w.nodes[root.moves.e2e4.nextEpd];
    expect(Object.keys(afterE4.moves)).toEqual([]);
    expect(Object.values(afterE4.opponentReplies).map(m => m.san).sort()).toEqual(['c5', 'e5']);
    expect(rep.b.nodes[start].opponentReplies.e2e4.count).toBe(1);
    expect(rep.b.nodes[afterE4.epd].moves.e7e5).toMatchObject({ wins: 1, losses: 0 });
    expect(root.gameIds).toEqual(['win', 'draw', 'loss']);
  });

  it('averages only analysed occurrences and retains the class distribution', () => {
    const games = [game('a', ['e4']), game('b', ['e4']), game('c', ['e4'])];
    const rep = buildRepertoire(games, [analysed(games[0], { 1: badE4 }), analysed(games[1], { 1: { cls: 'blunder', epLoss: 0.4 } })]);
    expect(rep.w.nodes[start].moves.e2e4).toMatchObject({ count: 3, analysedCount: 2, avgClassification: 2.5, classifications: { mistake: 1, blunder: 1 } });
    expect(rep.w.nodes[start].moves.e2e4.avgEpLoss).toBeCloseTo(0.3);
  });

  it('merges transpositions using the first four FEN fields', () => {
    const a = game('a', ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2']);
    const b = game('b', ['g3', 'Nf6', 'Nf3', 'd5', 'Bg2']);
    const rep = buildRepertoire([a, b], []);
    const position = epd(history(a)[4].before);
    expect(position).toBe(epd(history(b)[4].before));
    expect(history(a)[4].before).not.toBe(history(b)[4].before);
    expect(rep.w.nodes[position].moves.f1g2.count).toBe(2);
    expect(rep.w.nodes[position].gameIds).toEqual(['a', 'b']);
    expect(position.split(' ')).toHaveLength(4);
  });

  it('counts repeated visits but dedupes game ids and games', () => {
    const g = game('repeat', ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3']);
    const rep = buildRepertoire([g, g], []);
    expect(rep.w.games).toBe(1);
    expect(rep.w.nodes[start].count).toBe(2);
    expect(rep.w.nodes[start].moves.g1f3.count).toBe(2);
    expect(rep.w.nodes[start].gameIds).toEqual(['repeat']);
    expect(rep.w.openings[0].count).toBe(1);
  });

  it('caps at 24 plies and honours shorter/zero limits', () => {
    const moves = Array.from({ length: 7 }, () => ['Nf3', 'Nf6', 'Ng1', 'Ng8']).flat();
    const g = game('long', moves);
    const count = (limit?: number) => Object.values(buildRepertoire([g], [], { maxPly: limit }).w.nodes).reduce((n, node) => n + node.count, 0);
    expect(count()).toBe(24);
    expect(count(99)).toBe(24);
    expect(count(3)).toBe(3);
    expect(count(0)).toBe(0);
    expect(count(-1)).toBe(0);
    expect(count(NaN)).toBe(24);
  });

  it('skips malformed PGNs without corrupting valid games', () => {
    const g = game('ok', ['e4']);
    const rep = buildRepertoire([{ ...g, id: 'bad', pgn: '1. e4 not-a-move' }, g], []);
    expect(rep.skippedGameIds).toEqual(['bad']);
    expect(rep.w.games).toBe(1);
    expect(rep.w.nodes[start].count).toBe(1);
  });

  it('supports setup FEN, Black to move, and promotion UCI', () => {
    const g = game('promotion', ['a1=Q+'], 'b', 'win', '7k/8/8/8/8/8/p7/7K b - - 0 30');
    const rep = buildRepertoire([g], []);
    const root = rep.b.nodes[rep.b.roots[0]];
    expect(root.turn).toBe('b');
    expect(root.moves.a2a1q.san).toBe('a1=Q+');
  });

  it('uses the newest analysis and ignores stale position/move evidence', () => {
    const g = game('a', ['e4', 'e5']);
    const old = analysed(g, { 1: badE4 });
    const recent = { ...analysed(g), createdAt: 2 };
    expect(openingLeaks(buildRepertoire([g], [recent, old]))).toEqual([]);
    const wrongPosition = analysed(g, { 1: { ...badE4, fenBefore: history(g)[1].before } });
    expect(buildRepertoire([g], [wrongPosition]).w.nodes[start].moves.e2e4.analysedCount).toBe(0);
    const wrongMove = analysed(g, { 1: { ...badE4, uci: 'd2d4' } });
    expect(buildRepertoire([g], [wrongMove]).w.nodes[start].moves.e2e4.analysedCount).toBe(0);
  });

  it('does not mutate games, analyses or caller arrays', () => {
    const g = game('a', ['e4']);
    const games = [g];
    const analyses = [analysed(g, { 1: badE4 })];
    const before = JSON.stringify({ games, analyses });
    const rep = buildRepertoire(games, analyses);
    openingLeaks(rep); openingDrills(rep); repertoireSummary(rep); lineFor(rep, 'w', start);
    expect(JSON.stringify({ games, analyses })).toBe(before);
  });

  it('loads the real lazy opening book in the async variant', async () => {
    const g = game('a', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4']);
    const rep = await buildRepertoireAsync([g], []);
    expect(rep.w.openings[0].opening).toContain('Ruy Lopez');
    const node = rep.w.nodes[epd(history(g)[6].before)];
    expect(node.opening).toContain('Ruy Lopez');
    expect(node.eco).toMatch(/^C/);
  });
});

describe('openingLeaks and openingDrills', () => {
  it('finds engine leaks, ranks severity and carries deep links and corrections', () => {
    const a = game('a', ['e4']);
    const b = game('b', ['d4']);
    const rep = buildRepertoire([a, b], [analysed(a, { 1: badE4 }), analysed(b, { 1: { cls: 'blunder', epLoss: 0.5, bestSan: 'e4', bestUci: 'e2e4' } })]);
    const leaks = openingLeaks(rep);
    expect(leaks.map(l => l.move.san)).toEqual(['d4', 'e4']);
    expect(leaks[1]).toMatchObject({ color: 'w', epd: start, bestSan: 'd4', bestUci: 'd2d4', cls: 'mistake', gameIds: ['a'], reasons: ['engine'] });
  });

  it('uses occurrence OR share thresholds and excludes rare low-share moves', () => {
    const games = Array.from({ length: 10 }, (_, i) => game(String(i), [i === 0 ? 'e4' : 'd4'], 'w', 'win'));
    const analyses = [analysed(games[0], { 1: badE4 })];
    const rep = buildRepertoire(games, analyses);
    expect(openingLeaks(rep)).toEqual([]);
    expect(openingLeaks(rep, { minShare: 0.1 })).toHaveLength(1);
    const extra = game('extra', ['e4']);
    expect(openingLeaks(buildRepertoire([...games, extra], analyses))).toHaveLength(1);
    expect(openingLeaks(buildRepertoire(games.slice(0, 3), analyses))).toHaveLength(1);
    expect(openingLeaks(rep, { minOccurrences: 1 })).toHaveLength(1);
  });

  it('includes inaccuracy, miss, mistake and blunder; excludes good/forced/book', () => {
    const g = game('a', ['e4']);
    for (const cls of ['inaccuracy', 'miss', 'mistake', 'blunder', 'good', 'forced', 'book'] as const) {
      const rep = buildRepertoire([g], [analysed(g, { 1: { ...badE4, cls } })]);
      expect(openingLeaks(rep)).toHaveLength(['good', 'forced', 'book'].includes(cls) ? 0 : 1);
    }
  });

  it('requires a minimum result sample and uses half-points for draws', () => {
    const games = Array.from({ length: 5 }, (_, i) => game(String(i), ['e4'], 'b', i === 0 ? 'win' : i === 1 ? 'draw' : 'loss'));
    // The move at the root is the opponent's; it must never become a Black leak.
    expect(openingLeaks(buildRepertoire(games, []))).toEqual([]);
    const white = games.map(g => ({ ...g, userColor: 'w' as const }));
    expect(openingLeaks(buildRepertoire(white.slice(0, 4), []))).toEqual([]);
    const leaks = openingLeaks(buildRepertoire(white, []));
    expect(leaks[0]).toMatchObject({ scorePct: 30, reasons: ['results'] });
    expect(openingLeaks(buildRepertoire(white, []), { poorScorePct: 30 })).toEqual([]);
    expect(openingLeaks(buildRepertoire(white, []), { minResultSample: 6 })).toEqual([]);
    expect(openingDrills(buildRepertoire(white, []))).toEqual([]);
  });

  it('builds deduped cards with exact IDs, original classifications and new-card scheduling', () => {
    vi.useFakeTimers(); vi.setSystemTime(10_000);
    const a = game('a', ['e4']);
    const b = game('b', ['d4']);
    const rep = buildRepertoire([a, b], [analysed(a, { 1: badE4 }), analysed(b, { 1: { cls: 'blunder', epLoss: 0.5, bestSan: 'e4', bestUci: 'e2e4' } })]);
    expect(openingDrills(rep)).toEqual([{
      id: `opening:w:${start}`, gameId: 'b', ply: 1, fen: new Chess().fen(), color: 'w', bestUci: 'e2e4', bestSan: 'e4', playedSan: 'd4', cls: 'blunder',
      winBefore: 50, motifs: ['opening'], reps: 0, lapses: 0, ease: 2.5, interval: 0, due: 10_000,
      attempts: 0, solved: 0, createdAt: 10_000, opponent: 'opponent',
    }]);
  });

  it('supports Black corrections and keeps their result/eval perspective', () => {
    const g = game('black', ['e4', 'e5'], 'b', 'loss');
    const rep = buildRepertoire([g], [analysed(g, { 2: { cls: 'inaccuracy', epLoss: 0.1, bestUci: 'c7c5', bestSan: 'c5', winBefore: 61 } })]);
    expect(openingLeaks(rep)[0]).toMatchObject({ color: 'b', bestSan: 'c5', scorePct: 0 });
    expect(openingDrills(rep)[0]).toMatchObject({ color: 'b', winBefore: 61, cls: 'inaccuracy', ply: 2, bestUci: 'c7c5' });
  });

  it('labels a starting-position leak with the opening reached by its move', () => {
    const g = game('a', ['e4']);
    const lookup = bookFor([[['e4'], 'B00', 'King Pawn']]);
    const leak = openingLeaks(buildRepertoire([g], [analysed(g, { 1: badE4 })], { lookup }))[0];
    expect(leak).toMatchObject({ opening: 'King Pawn', eco: 'B00' });
  });

  it('does not treat repeated positions in one game as independent result samples', () => {
    const moves = Array.from({ length: 6 }, () => ['Nf3', 'Nf6', 'Ng1', 'Ng8']).flat();
    const rep = buildRepertoire([game('one', moves)], []);
    expect(rep.w.nodes[start].moves.g1f3.count).toBe(6);
    expect(openingLeaks(rep)).toEqual([]);
  });

  it('retains result-only leaks and skips illegal, absent, identical or inconsistent corrections', () => {
    const g = game('a', ['e4']);
    for (const correction of [
      { bestSan: '', bestUci: '' }, { bestSan: 'e5', bestUci: 'e2e5' },
      { bestSan: 'e4', bestUci: 'e2e4' }, { bestSan: 'Nf3', bestUci: 'd2d4' },
    ]) {
      const rep = buildRepertoire([g], [analysed(g, { 1: { ...badE4, ...correction } })]);
      expect(openingLeaks(rep)).toHaveLength(1);
      expect(openingDrills(rep)).toEqual([]);
    }
    const games = Array.from({ length: 5 }, (_, i) => game(String(i), ['e4']));
    const rep = buildRepertoire(games, [analysed(games[0], { 1: { ...badE4, cls: 'good' } })]);
    expect(openingLeaks(rep)[0].reasons).toEqual(['results']);
    expect(openingDrills(rep)[0].cls).toBe('good');
  });
});

describe('lineFor and repertoireSummary', () => {
  it('follows the most-played moves for both sides, with stable ties and FEN input', () => {
    const rep = buildRepertoire([
      game('a', ['e4', 'e5', 'Nf3']), game('b', ['e4', 'e5', 'Nc3']),
      game('c', ['e4', 'c5']), game('d', ['d4', 'd5']),
    ], []);
    expect(lineFor(rep, 'w', new Chess().fen()).map(m => m.san)).toEqual(['e4', 'e5', 'Nc3']);
    const afterE4 = rep.w.nodes[start].moves.e2e4.nextEpd;
    expect(lineFor(rep, 'w', afterE4).map(m => m.color)).toEqual(['b', 'w']);
    expect(lineFor(rep, 'b', start)).toEqual([]);
    expect(lineFor(rep, 'w', 'unknown')).toEqual([]);
  });

  it('terminates at repeated positions rather than looping forever', () => {
    const g = game('repeat', ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3']);
    const rep = buildRepertoire([g], []);
    expect(lineFor(rep, 'w', start).map(m => m.san)).toEqual(['Nf3', 'Nf6', 'Ng1', 'Ng8']);
  });

  it('reports deepest openings per game, sorted by popularity and colour, with scores', () => {
    const lookup = bookFor([
      [['e4'], 'B00', 'King Pawn'], [['e4', 'c5'], 'B20', 'Sicilian'], [['d4'], 'A40', 'Queen Pawn'],
    ]);
    const rep = buildRepertoire([
      game('a', ['e4', 'c5'], 'w', 'win'), game('b', ['e4', 'c5'], 'w', 'draw'),
      game('c', ['d4'], 'w', 'loss'), game('d', ['e4', 'c5'], 'b', 'loss'),
    ], [], { lookup });
    const summary = repertoireSummary(rep);
    expect(summary.w.openings).toMatchObject([
      { opening: 'Sicilian', eco: 'B20', count: 2, scorePct: 75, gameIds: ['a', 'b'] },
      { opening: 'Queen Pawn', count: 1, scorePct: 0 },
    ]);
    expect(summary.b.openings[0]).toMatchObject({ opening: 'Sicilian', count: 1, scorePct: 0 });
    expect(rep.w.nodes[rep.w.nodes[start].moves.e2e4.nextEpd].opening).toBe('King Pawn');
    summary.w.openings[0].gameIds.push('mutated');
    expect(rep.w.openings[0].gameIds).toEqual(['a', 'b']);
  });

  it('finds the most common first user departure and ignores subsequent deviations', () => {
    const lookup = bookFor([[['e4'], 'C20', 'King Pawn'], [['e4', 'e5'], 'C20', 'Open Game']]);
    const rep = buildRepertoire([
      game('a', ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4']), game('b', ['e4', 'e5', 'Qh5']),
      game('c', ['e4', 'e5', 'Nc3']), game('opponent-left', ['e4', 'c5', 'Nf3']),
    ], [], { lookup });
    expect(repertoireSummary(rep).w.firstOutOfBook).toMatchObject({ ply: 3, san: 'Qh5', count: 2, gameIds: ['a', 'b'] });
    expect(rep.w.bookDepartures.map(d => d.san).sort()).toEqual(['Nc3', 'Qh5']);
    const epd3 = epd(history(game('d', ['e4', 'e5', 'Qh5']))[2].before);
    expect(rep.w.nodes[epd3].opening).toBe('Open Game');
  });

  it('uses analysed book labels without a loaded book and does not invent departures', () => {
    const g = game('a', ['e4', 'e5', 'Qh5']);
    const rep = buildRepertoire([g], [analysed(g, { 1: { cls: 'book' }, 2: { cls: 'book' } })], { lookup: noBook });
    expect(repertoireSummary(rep).w.firstOutOfBook?.ply).toBe(3);
    const empty = buildRepertoire([], []);
    expect(repertoireSummary(empty).b.firstOutOfBook).toBeNull();
  });
});

it('preserves repertoire, leaks and drills with compact analysis evidence', () => {
  const games = [game('slim', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])];
  const full = [analysed(games[0], { 1: badE4 })];
  const rep = buildRepertoire(games, full, { lookup: noBook });
  const compact = buildRepertoire(games, full.map(slimAnalysis), { lookup: noBook });
  expect(compact).toEqual(rep);
  expect(openingLeaks(compact)).toEqual(openingLeaks(rep));
  vi.useFakeTimers(); vi.setSystemTime(1000);
  expect(openingDrills(compact)).toEqual(openingDrills(rep));
});

it('measures a realistic 80-ply analysis payload', () => {
  const chess = new Chess();
  // Legal repeated knight manoeuvres give a reproducible long history.
  for (let i = 0; i < 20; i++) for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) chess.move(san);
  const g = { ...game('size', []), pgn: chess.pgn() };
  const full = analysed(g);
  for (const m of full.moves) {
    m.bestLineSan = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
    m.replyLineSan = [...m.bestLineSan];
    m.comment = 'This move gives up control of the centre and allows the opponent to develop with tempo. '.repeat(6);
    m.clock = 300 - m.ply;
  }
  const bytes = (a: unknown) => new TextEncoder().encode(JSON.stringify(a)).length;
  const original = bytes(full), compact = bytes(slimAnalysis(full));
  console.log('Analysis JSON bytes:', { full: original, slim: compact, reduction: (100 * (1 - compact / original)).toFixed(1) + '%' });
  expect(compact).toBeLessThan(original / 2);
});
