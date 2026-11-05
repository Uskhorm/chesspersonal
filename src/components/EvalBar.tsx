import type { Score } from '../lib/types';
import { formatScore, scoreToWhiteWin } from '../lib/winpct';

/** Vertical win-chance gauge. The fill is a single scaled element, so it animates on the GPU. */
export function EvalBar({ score, orientation }: { score?: Score; orientation: 'white' | 'black' }) {
  const w = score ? scoreToWhiteWin(score) : 50;
  const whiteAhead = w >= 50;
  const label = score ? formatScore(score).replace('+', '').replace('-', '') : '';
  // White's share fills from White's side of the board.
  const flip = orientation === 'black';
  const labelAtWhiteSide = whiteAhead;
  const pos = labelAtWhiteSide !== flip ? 'bottom' : 'top';
  return (
    <div className={`evalbar ${flip ? 'flip' : ''}`} role="meter" aria-label="Evaluation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)} aria-valuetext={`White ${Math.round(w)}% to win${label ? `, ${formatScore(score)}` : ''}`}>
      <div className="evalbar-fill" style={{ ['--w' as string]: String(w / 100) }} />
      {label && <span className={`evalbar-label ${pos}`} style={{ color: whiteAhead ? '#2a2c30' : '#f4f3ef' }}>{label}</span>}
    </div>
  );
}
