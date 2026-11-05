import { Chess } from 'chess.js';
import { loadOpenings, lookupOpening } from './openings';
import type { AnalysedMove, Classification, Color, Drill, GameAnalysis, StoredGame } from './types';

export type OpeningLookup = (fen: string) => readonly [string, string] | null | undefined;
export interface RepertoireOptions {
  /** Half-moves, clamped to 0–24. */
  maxPly?: number;
  /** Supply a book lookup for pure builds; otherwise uses the already-loaded book. */
  lookup?: OpeningLookup;
}
export interface Results {
  count: number;
  wins: number;
  draws: number;
  losses: number;
}
export interface MoveEvidence {
  gameId: string;
  opponent: string;
  move: AnalysedMove;
}
export interface RepertoireMove extends Results {
  san: string;
  uci: string;
  nextEpd: string;
  opening?: string;
  eco?: string;
  gameIds: string[];
  analysedCount: number;
  classifications: Partial<Record<Classification, number>>;
  /** Mean error severity: other classes = 0, inaccuracy = 1, mistake/miss = 2, blunder = 3. */
  avgClassification: number | null;
  avgEpLoss: number | null;
  evidence: MoveEvidence[];
}
export interface RepertoireNode extends Results {
  epd: string;
  fen: string;
  /** Earliest 1-based outgoing ply; transpositions may arrive at other plies. */
  ply: number;
  turn: Color;
  gameIds: string[];
  opening?: string;
  eco?: string;
  /** Populated only when it is the repertoire owner's turn. Key = UCI. */
  moves: Record<string, RepertoireMove>;
  /** Populated only when it is the opponent's turn. Key = UCI. */
  opponentReplies: Record<string, RepertoireMove>;
}
export interface OpeningStats extends Results {
  opening: string;
  eco?: string;
  gameIds: string[];
  scorePct: number;
}
export interface BookDeparture {
  ply: number;
  san: string;
  uci: string;
  epd: string;
  count: number;
  gameIds: string[];
}
export interface RepertoireTree {
  color: Color;
  nodes: Record<string, RepertoireNode>;
  roots: string[];
  games: number;
  openings: OpeningStats[];
  bookDepartures: BookDeparture[];
}
export interface Repertoire {
  w: RepertoireTree;
  b: RepertoireTree;
  maxPly: number;
  skippedGameIds: string[];
}
export interface LeakOptions {
  minOccurrences?: number;
  minShare?: number;
  /** Minimum distinct games on a move, so repetitions cannot inflate the sample. */
  minResultSample?: number;
  /** Percentage points, 0–100. A line must score strictly below this. */
  poorScorePct?: number;
}
export interface OpeningLeak {
  color: Color;
  epd: string;
  fen: string;
  ply: number;
  opening?: string;
  eco?: string;
  move: RepertoireMove;
  reasons: ('engine' | 'results')[];
  scorePct: number;
  priority: number;
  gameIds: string[];
  bestSan?: string;
  bestUci?: string;
  cls?: Classification;
  /** Source for the recommended correction, when an analysed alternative is legal. */
  source?: MoveEvidence;
}
export interface RepertoireLineMove {
  color: Color;
  epd: string;
  nextEpd: string;
  san: string;
  uci: string;
  count: number;
  opening?: string;
}
export interface ColorRepertoireSummary {
  games: number;
  openings: OpeningStats[];
  /** Most common first departure by the user; null if unknown or opponent left first. */
  firstOutOfBook: BookDeparture | null;
}
export type RepertoireSummary = Record<Color, ColorRepertoireSummary>;

const colors: Color[] = ['w', 'b'];
const epdOf = (fen: string) => fen.trim().split(/\s+/).slice(0, 4).join(' ');
const severity = (cls: Classification) => cls === 'blunder' ? 3 : cls === 'mistake' || cls === 'miss' ? 2 : cls === 'inaccuracy' ? 1 : 0;
const results = (): Results => ({ count: 0, wins: 0, draws: 0, losses: 0 });
const score = (r: Results) => r.count ? 100 * (r.wins + r.draws / 2) / r.count : 0;
const addResult = (r: Results, outcome: StoredGame['userResult']) => {
  r.count++;
  if (outcome === 'win') r.wins++;
  else if (outcome === 'draw') r.draws++;
  else r.losses++;
};
const addId = (ids: string[], id: string) => { if (!ids.includes(id)) ids.push(id); };
const tree = (color: Color): RepertoireTree => ({ color, nodes: {}, roots: [], games: 0, openings: [], bookDepartures: [] });
const mostPlayed = (a: RepertoireMove, b: RepertoireMove) => b.count - a.count || a.uci.localeCompare(b.uci);

/**
 * No I/O. Call loadOpenings first, use buildRepertoireAsync, or inject opts.lookup.
 * Nodes include both turns so continuations preserve opponent replies. Counts are
 * position/move occurrences (including repetitions); gameIds and opening totals
 * are unique games. Invalid PGNs are skipped, duplicate game ids counted once.
 */
export function buildRepertoire(
  games: readonly StoredGame[], analyses: readonly GameAnalysis[], opts: RepertoireOptions = {},
): Repertoire {
  const requested = opts.maxPly ?? 24;
  const maxPly = Number.isFinite(requested) ? Math.max(0, Math.min(24, Math.floor(requested))) : 24;
  const rep: Repertoire = { w: tree('w'), b: tree('b'), maxPly, skippedGameIds: [] };
  const lookup = opts.lookup ?? lookupOpening;
  // Prefer the newest snapshot if the caller supplies duplicate analyses.
  const byGame = new Map<string, GameAnalysis>();
  for (const analysis of analyses) {
    if (!byGame.has(analysis.gameId) || byGame.get(analysis.gameId)!.createdAt < analysis.createdAt) byGame.set(analysis.gameId, analysis);
  }
  const seenGames = new Set<string>();
  for (const game of games) {
    if (seenGames.has(game.id)) continue;
    seenGames.add(game.id);
    const chess = new Chess();
    try { chess.loadPgn(game.pgn); } catch { rep.skippedGameIds.push(game.id); continue; }
    const history = chess.history({ verbose: true }).slice(0, maxPly);
    const t = rep[game.userColor];
    t.games++;
    const analysis = byGame.get(game.id);
    const byPly = new Map(analysis?.moves.map(m => [m.ply, m]));
    let opening: string | undefined;
    let eco: string | undefined;
    let bookSeen = false;
    let departed = false;
    for (let i = 0; i < history.length; i++) {
      const m = history[i];
      const epd = epdOf(m.before);
      const nextEpd = epdOf(m.after);
      const uci = m.from + m.to + (m.promotion ?? '');
      const candidate = byPly.get(i + 1);
      // Never attach a stale analysis belonging to a different PGN/position.
      const a = candidate?.uci === uci && candidate.color === m.color && epdOf(candidate.fenBefore) === epd ? candidate : undefined;
      const beforeBook = lookup(m.before);
      const afterBook = lookup(m.after);
      if (beforeBook) { [eco, opening] = beforeBook; bookSeen = true; }
      const node = t.nodes[epd] ??= {
        ...results(), epd, fen: m.before, ply: i + 1, turn: m.color,
        gameIds: [], moves: {}, opponentReplies: {}, opening, eco,
      };
      node.ply = Math.min(node.ply, i + 1);
      // A direct position lookup takes precedence over an inherited line name.
      if (beforeBook || !node.opening) { node.opening = opening ?? a?.opening; node.eco = eco; }
      addResult(node, game.userResult);
      addId(node.gameIds, game.id);
      if (i === 0) addId(t.roots, epd);
      const edges = m.color === game.userColor ? node.moves : node.opponentReplies;
      const edge = edges[uci] ??= {
        ...results(), san: m.san, uci, nextEpd, gameIds: [], analysedCount: 0,
        classifications: {}, avgClassification: null, avgEpLoss: null, evidence: [],
      };
      if (afterBook || !edge.opening) {
        edge.opening = afterBook?.[1] ?? opening ?? a?.opening;
        edge.eco = afterBook?.[0] ?? eco;
      }
      addResult(edge, game.userResult);
      addId(edge.gameIds, game.id);
      if (a) {
        const n = edge.analysedCount;
        edge.avgClassification = ((edge.avgClassification ?? 0) * n + severity(a.cls)) / (n + 1);
        edge.avgEpLoss = ((edge.avgEpLoss ?? 0) * n + a.epLoss) / (n + 1);
        edge.analysedCount++;
        edge.classifications[a.cls] = (edge.classifications[a.cls] ?? 0) + 1;
        edge.evidence.push({ gameId: game.id, opponent: game.userColor === 'w' ? game.black.username : game.white.username, move: a });
      }
      const isBook = !!afterBook || a?.cls === 'book';
      // Do not infer departure from an unloaded/unavailable book. Analysed book
      // labels also establish the prefix when callers have no book lookup.
      if (!departed && !isBook && (bookSeen || !!opts.lookup)) {
        departed = true;
        if (m.color === game.userColor) {
          let departure = t.bookDepartures.find(d => d.epd === epd && d.uci === uci);
          if (!departure) t.bookDepartures.push(departure = { ply: i + 1, san: m.san, uci, epd, count: 0, gameIds: [] });
          departure.count++;
          addId(departure.gameIds, game.id);
        }
      }
      if (isBook) bookSeen = true;
      if (afterBook) [eco, opening] = afterBook;
      else if (!opening && a?.opening) opening = a.opening;
    }
    // One opening per game, at its deepest recognised position inside the cap.
    const name = opening ?? 'Unknown opening';
    let stats = t.openings.find(o => o.opening === name && o.eco === eco);
    if (!stats) t.openings.push(stats = { ...results(), opening: name, eco, gameIds: [], scorePct: 0 });
    addResult(stats, game.userResult);
    addId(stats.gameIds, game.id);
    stats.scorePct = score(stats);
  }
  return rep;
}

/** Lazy-load the bundled Lichess book before building. */
export async function buildRepertoireAsync(
  games: readonly StoredGame[], analyses: readonly GameAnalysis[], opts: RepertoireOptions = {},
): Promise<Repertoire> {
  if (!opts.lookup) await loadOpenings();
  return buildRepertoire(games, analyses, opts);
}

/** Ranked habitual user moves with any stored inaccuracy+ or sufficiently poor results. */
export function openingLeaks(rep: Repertoire, opts: LeakOptions = {}): OpeningLeak[] {
  const leaks: OpeningLeak[] = [];
  for (const color of colors) for (const node of Object.values(rep[color].nodes)) {
    for (const move of Object.values(node.moves)) {
      if (move.count < (opts.minOccurrences ?? 2) && move.count / node.count < (opts.minShare ?? 0.3)) continue;
      const bad = move.evidence.filter(e => severity(e.move.cls) > 0);
      const reasons: OpeningLeak['reasons'] = [];
      if (bad.length) reasons.push('engine');
      const scorePct = score(move);
      if (move.gameIds.length >= (opts.minResultSample ?? 5) && scorePct < (opts.poorScorePct ?? 40)) reasons.push('results');
      if (!reasons.length) continue;
      // Keep correction, classification, position and source game from the same
      // analysis. Result-only leaks can still have a sound engine alternative.
      const evidence = [...move.evidence].sort((a, b) => severity(b.move.cls) - severity(a.move.cls) || b.move.epLoss - a.move.epLoss || a.gameId.localeCompare(b.gameId));
      const source = evidence.find(e => legalCorrection(e.move, move.uci));
      const worst = bad.reduce((max, e) => Math.max(max, severity(e.move.cls)), 0);
      leaks.push({
        color, epd: node.epd, fen: source?.move.fenBefore ?? node.fen, ply: source?.move.ply ?? node.ply,
        opening: move.opening ?? node.opening, eco: move.eco ?? node.eco, move, reasons, scorePct,
        priority: (worst + (move.avgEpLoss ?? 0) * 10 + (reasons.includes('results') ? 1 - scorePct / 100 : 0)) * Math.log2(move.count + 1),
        gameIds: [...move.gameIds], bestSan: source?.move.bestSan, bestUci: source?.move.bestUci,
        cls: source?.move.cls ?? bad[0]?.move.cls, source,
      });
    }
  }
  return leaks.sort((a, b) => b.priority - a.priority || a.color.localeCompare(b.color) || a.epd.localeCompare(b.epd) || a.move.uci.localeCompare(b.move.uci));
}

function legalCorrection(m: AnalysedMove, playedUci: string): boolean {
  if (!m.bestSan || m.bestUci === playedUci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m.bestUci)) return false;
  try {
    const best = new Chess(m.fenBefore).move({ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4), promotion: m.bestUci[4] });
    return best.san === m.bestSan;
  } catch { return false; }
}

/** One actionable card per colour/position, choosing the highest-ranked leak. */
export function openingDrills(rep: Repertoire): Drill[] {
  const drills: Drill[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  for (const leak of openingLeaks(rep)) {
    const source = leak.source;
    if (!source) continue;
    const id = `opening:${leak.color}:${leak.epd}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const m = source.move;
    drills.push({
      id, gameId: source.gameId, ply: m.ply, fen: m.fenBefore, color: leak.color,
      bestUci: m.bestUci, bestSan: m.bestSan, playedSan: leak.move.san, cls: m.cls,
      winBefore: m.winBefore, motifs: ['opening'], reps: 0, lapses: 0, ease: 2.5,
      interval: 0, due: now, attempts: 0, solved: 0, createdAt: now, opponent: source.opponent,
    });
  }
  return drills;
}

/** Greedy most-played continuation, both sides; stops at missing nodes or cycles. Accepts EPD or FEN. */
export function lineFor(rep: Repertoire, color: Color, epd: string): RepertoireLineMove[] {
  const line: RepertoireLineMove[] = [];
  const seen = new Set<string>();
  let current = epdOf(epd);
  while (!seen.has(current) && line.length < rep.maxPly) {
    seen.add(current);
    const node = rep[color].nodes[current];
    if (!node) break;
    const move = Object.values(node.turn === color ? node.moves : node.opponentReplies).sort(mostPlayed)[0];
    if (!move) break;
    line.push({ color: node.turn, epd: current, nextEpd: move.nextEpd, san: move.san, uci: move.uci, count: move.count, opening: node.opening });
    current = move.nextEpd;
  }
  return line;
}

export function repertoireSummary(rep: Repertoire): RepertoireSummary {
  const summarize = (t: RepertoireTree): ColorRepertoireSummary => ({
    games: t.games,
    openings: t.openings.map(o => ({ ...o, gameIds: [...o.gameIds] })).sort((a, b) => b.count - a.count || a.opening.localeCompare(b.opening)),
    firstOutOfBook: [...t.bookDepartures].sort((a, b) => b.count - a.count || a.ply - b.ply || a.uci.localeCompare(b.uci))
      .map(d => ({ ...d, gameIds: [...d.gameIds] }))[0] ?? null,
  });
  return { w: summarize(rep.w), b: summarize(rep.b) };
}
