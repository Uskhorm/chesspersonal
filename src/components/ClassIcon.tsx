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

/** Move-quality badge. `white` inverts it for use on a coloured background. */
export function ClassIcon({ cls, size = 22, className, white }: { cls: Classification; size?: number; className?: string; white?: boolean }) {
  const c = CLASS_COLOR[cls];
  const bg = white ? '#fff' : c;
  const fg = white ? c : '#fff';
  const g = GLYPH[cls];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-label={CLASS_LABEL[cls]} role="img">
      <circle cx="12" cy="12" r="11.5" fill={bg} />
      {g && (
        <text x="12" y="12.6" textAnchor="middle" dominantBaseline="central" fontSize={g.length > 1 ? 11.5 : 15} fontWeight="900" fill={fg} fontFamily="Archivo, system-ui" style={{ fontVariationSettings: "'wdth' 75" }}>
          {g}
        </text>
      )}
      {cls === 'best' && <path d="M12 5.2l2 4.2 4.6.6-3.4 3.1.9 4.5L12 15.3l-4.1 2.3.9-4.5L5.4 10l4.6-.6z" fill={fg} />}
      {cls === 'excellent' && <path d="M6.6 12.4l3.2 3.2 7.6-7.6" stroke={fg} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {cls === 'good' && <path d="M7.5 12.5l3 3 6-6" stroke={fg} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {cls === 'book' && <path d="M6.5 7.5c2-.8 3.8-.6 5.5.6 1.7-1.2 3.5-1.4 5.5-.6v9c-2-.8-3.8-.6-5.5.6-1.7-1.2-3.5-1.4-5.5-.6z M12 8.1v9" stroke={fg} strokeWidth="1.6" fill="none" strokeLinejoin="round" />}
      {cls === 'forced' && <path d="M6.5 12h10m-3.5-4 4 4-4 4" stroke={fg} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {cls === 'miss' && <path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke={fg} strokeWidth="2.6" strokeLinecap="round" />}
    </svg>
  );
}
