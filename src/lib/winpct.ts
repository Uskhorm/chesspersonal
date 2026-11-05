import type { Score } from './types';

/** Lichess win-percentage model: maps centipawns to 0-100 winning chances. */
export function cpToWin(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Win% for WHITE from a white-POV score. */
export function scoreToWhiteWin(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 100 : s.mate < 0 ? 0 : 50;
  return cpToWin(s.cp ?? 0);
}

export function scoreToWin(s: Score, pov: 'w' | 'b'): number {
  const w = scoreToWhiteWin(s);
  return pov === 'w' ? w : 100 - w;
}

/** Comparable numeric value, white POV, mates squashed to large cp. */
export function scoreValue(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 10000 - s.mate : -10000 - s.mate;
  return s.cp ?? 0;
}

export function formatScore(s: Score | undefined): string {
  if (!s) return '0.0';
  if (s.mate !== undefined) {
    if (s.mate === 0) return '#';
    return (s.mate > 0 ? '' : '-') + 'M' + Math.abs(s.mate);
  }
  const v = (s.cp ?? 0) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
}

/** Lichess move-accuracy formula from win% drop (mover POV). */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const diff = Math.max(0, winBefore - winAfter);
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

function stdDev(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/**
 * Lichess-style game accuracy: volatility-weighted mean blended with harmonic mean.
 * winCurve = white win% for each position (length = plies + 1).
 */
export function gameAccuracy(winCurve: number[], accs: number[], color: 'w' | 'b'): number {
  const n = accs.length;
  if (n === 0) return 0;
  const win = Math.max(2, Math.min(8, Math.floor(winCurve.length / 10)));
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, Math.min(i, winCurve.length - win));
    const slice = winCurve.slice(start, start + win);
    weights.push(Math.max(0.5, Math.min(12, stdDev(slice))));
  }
  let ws = 0;
  let wsum = 0;
  let hs = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const mover = i % 2 === 0 ? 'w' : 'b';
    if (mover !== color) continue;
    ws += accs[i] * weights[i];
    wsum += weights[i];
    hs += 1 / Math.max(accs[i], 1);
    cnt++;
  }
  if (!cnt) return 0;
  const weighted = ws / wsum;
  const harmonic = cnt / hs;
  return Math.round(((weighted + harmonic) / 2) * 10) / 10;
}

/** Rough accuracy -> rating curve (an estimate, not chess.com's model). */
export function estimateRating(acc: number, avgOppRating?: number): number {
  const pts: [number, number][] = [
    [30, 250], [50, 450], [60, 700], [70, 1050], [78, 1400], [84, 1750],
    [88, 2050], [92, 2400], [95, 2700], [98, 3000], [100, 3200],
  ];
  let r = pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [a0, r0] = pts[i - 1];
    const [a1, r1] = pts[i];
    if (acc <= a1) {
      r = r0 + ((Math.max(acc, a0) - a0) / (a1 - a0)) * (r1 - r0);
      break;
    }
    r = r1;
  }
  if (avgOppRating) r = r * 0.75 + avgOppRating * 0.25;
  return Math.round(r / 25) * 25;
}
