import { MOTIF_INFO } from './classify';
import type { Drill, GameAnalysis, Motif, StoredGame } from './types';

export interface Leak {
  motif: Motif;
  label: string;
  emoji: string;
  tip: string;
  angle: string;
  count: number;
  pointsLost: number; // expected points (≈ fraction of a game) lost in total
  perGame: number;
  share: number; // 0-1 of all lost points
}

/**
 * The "Elo leak" report: where your expected points actually go.
 * Deliberate practice works best when aimed at your single biggest weakness.
 */
export function computeLeaks(games: StoredGame[], analyses: GameAnalysis[]): Leak[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  const tally = new Map<Motif, { count: number; loss: number }>();
  let total = 0;
  let n = 0;
  for (const a of analyses) {
    const g = byId.get(a.gameId);
    if (!g) continue;
    n++;
    for (const m of a.moves) {
      if (m.color !== g.userColor || !m.motifs?.length) continue;
      // split the loss across tags so totals add up
      const share = m.epLoss / m.motifs.length;
      for (const mo of m.motifs) {
        const t = tally.get(mo) ?? { count: 0, loss: 0 };
        t.count++;
        t.loss += share;
        tally.set(mo, t);
      }
      total += m.epLoss;
    }
  }
  return [...tally.entries()]
    .map(([motif, t]) => ({
      motif,
      ...MOTIF_INFO[motif],
      count: t.count,
      pointsLost: t.loss,
      perGame: n ? t.loss / n : 0,
      share: total ? t.loss / total : 0,
    }))
    .sort((a, b) => b.pointsLost - a.pointsLost);
}

/**
 * Builds an interleaved, adaptive session:
 * - due cards first (spacing), then the soonest-due as extra practice
 * - round-robin across motifs (interleaving beats blocked practice for transfer)
 * - difficulty nudged toward an ~85% success rate (Wilson et al., 2019)
 */
export function buildSession(drills: Drill[], size: number, recentSuccess: number | null): Drill[] {
  const now = Date.now();
  const due = drills.filter((d) => d.due <= now).sort((a, b) => a.due - b.due);
  const later = drills.filter((d) => d.due > now).sort((a, b) => a.due - b.due);
  let pool = [...due, ...later].slice(0, size * 3);

  // Adaptive difficulty: hard = many lapses / blunders that cost a lot.
  const hardness = (d: Drill) => d.lapses * 2 + (d.cls === 'blunder' ? 1 : 0) - d.reps;
  if (recentSuccess !== null && recentSuccess > 0.9) pool.sort((a, b) => hardness(b) - hardness(a));
  else if (recentSuccess !== null && recentSuccess < 0.75) pool.sort((a, b) => hardness(a) - hardness(b));
  pool = pool.slice(0, size * 2);

  // Interleave by primary motif.
  const buckets = new Map<string, Drill[]>();
  for (const d of pool) {
    const k = d.motifs?.[0] ?? 'positional';
    buckets.set(k, [...(buckets.get(k) ?? []), d]);
  }
  const out: Drill[] = [];
  while (out.length < size && [...buckets.values()].some((b) => b.length)) {
    for (const b of buckets.values()) {
      const d = b.shift();
      if (d && out.length < size) out.push(d);
    }
  }
  return out;
}

/** Drill "puzzle rating" for the training-rating system. */
export function drillRating(d: Drill, base: number): number {
  const clsAdj = d.cls === 'blunder' ? -150 : d.cls === 'miss' ? 50 : 0;
  return Math.round(base + clsAdj + d.lapses * 60 - d.reps * 20);
}
