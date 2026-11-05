import type { Classification } from '../lib/types';
import { CLASS_COLOR } from '../lib/fx';

export const CLASS_LABEL: Record<Classification, string> = {
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  forced: 'Forced',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
};

const GLYPH: Partial<Record<Classification, string>> = {
  brilliant: '!!',
  great: '!',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

export function ClassIcon({ cls, size = 22, className }: { cls: Classification; size?: number; className?: string }) {
  const c = CLASS_COLOR[cls];
  const g = GLYPH[cls];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-label={CLASS_LABEL[cls]} role="img">
      <circle cx="12" cy="12" r="11" fill={c} stroke="rgba(0,0,0,.25)" strokeWidth="1" />
      <circle cx="12" cy="10" r="9" fill="rgba(255,255,255,.12)" />
      {g && (
        <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize={g.length > 1 ? 11 : 14} fontWeight="900" fill="#fff" fontFamily="'Bricolage Grotesque', system-ui">
          {g}
        </text>
      )}
      {cls === 'best' && <path d="M12 5.5l1.9 4 4.3.5-3.2 2.9.9 4.3L12 15l-3.9 2.2.9-4.3L5.8 10l4.3-.5z" fill="#fff" />}
      {cls === 'excellent' && <path d="M6.5 12.5l3 3 2-2m0 0l1 1 5-6m-6 5l4.5-5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {cls === 'good' && <path d="M7 12.5l3.3 3.3L17 9" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {cls === 'book' && <path d="M6.5 7.5c2-.8 3.8-.6 5.5.6 1.7-1.2 3.5-1.4 5.5-.6v9c-2-.8-3.8-.6-5.5.6-1.7-1.2-3.5-1.4-5.5-.6z M12 8.1v9" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinejoin="round" />}
      {cls === 'forced' && <path d="M6.5 12h10m-3.5-4 4 4-4 4" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {cls === 'miss' && <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />}
    </svg>
  );
}
