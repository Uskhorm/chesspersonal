import type { Score } from '../lib/types';
import { formatScore, scoreToWhiteWin } from '../lib/winpct';

export function EvalBar({ score, orientation }: { score?: Score; orientation: 'white' | 'black' }) {
  const w = score ? scoreToWhiteWin(score) : 50;
  const whiteAhead = w >= 50;
  const label = formatScore(score).replace('+', '').replace('-', '');
  return (
    <div className={`evalbar ${orientation === 'black' ? 'flip' : ''}`}>
      <div className="evalbar-white" style={{ height: `${w}%` }} />
      <span className={`evalbar-label ${whiteAhead ? 'bottom' : 'top'}`}>{label}</span>
    </div>
  );
}
