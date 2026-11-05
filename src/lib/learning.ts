import { type SlimAnalysis } from './db';
import { MOTIF_INFO } from './classify';
import type { Drill, Motif, StoredGame } from './types';
import { isNewCard, retrievability, type FsrsDrill } from './srs';

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
export function computeLeaks(games: StoredGame[], analyses: SlimAnalysis[]): Leak[] {
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
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const unique = [...new Map(drills.map((d) => [d.id, d])).values()];
  const introduced = unique.filter((d) => ((d as FsrsDrill).introducedAt ?? 0) >= +start).length;
  let newBudget = Math.max(0, 15 - introduced);
  const due = unique.filter((d) => !isNewCard(d) && d.due <= now)
    .sort((a, b) => retrievability(a, now) - retrievability(b, now) || a.due - b.due);
  const fresh = unique.filter(isNewCard).filter((d) => d.due <= now).sort((a, b) => a.createdAt - b.createdAt);
  const later = unique.filter((d) => !isNewCard(d) && d.due > now);
  const out: Drill[] = [];
  let predicted = 0;
  // New-card recall is unknown: use a prior, never pretend it is measured by FSRS.
  const probability = (d: Drill) => isNewCard(d) ? 0.85 : retrievability(d, now);
  const target = Math.min(0.95, Math.max(0.75, 0.85 + (0.85 - (recentSuccess ?? 0.85)) * 0.25));
  while (out.length < Math.max(0, Math.floor(size))) {
    const pool = due.length ? due : newBudget && fresh.length ? fresh : later;
    if (!pool.length) break;
    const lastMotif = out.at(-1)?.motifs?.[0];
    // Preserve urgent-first ordering; an adjacent motif may move ahead of a
    // repeated motif. Future practice can freely target 85% recall. Mandatory
    // overdue reviews take precedence when an 85% mean is unattainable.
    const candidates = pool === due ? pool.slice(0, 4) : pool;
    const score = (d: Drill) => Math.abs((predicted + probability(d)) / (out.length + 1) - target)
      + (lastMotif && d.motifs?.[0] === lastMotif ? 0.15 : 0);
    const pick = pool === due
      ? candidates.find((d) => !lastMotif || d.motifs?.[0] !== lastMotif) ?? candidates[0]
      : [...candidates].sort((a, b) => score(a) - score(b))[0];
    pool.splice(pool.indexOf(pick), 1);
    if (isNewCard(pick)) newBudget--;
    out.push(pick); predicted += probability(pick);
  }
  return out;
}

/** Drill "puzzle rating" for the training-rating system. */
export function drillRating(d: Drill, base: number): number {
  const clsAdj = d.cls === 'blunder' ? -150 : d.cls === 'miss' ? 50 : 0;
  return Math.round(base + clsAdj + d.lapses * 60 - d.reps * 20);
}
