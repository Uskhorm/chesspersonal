/** Achievement medals: one drawn glyph per achievement, gold when earned, a dashed outline when locked. */
const GLYPHS: Record<string, string> = {
  'first-review': 'M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm4.5 10.5L20 20',
  brilliant: 'M12 3l7 6-7 12-7-12z M5 9h14',
  great: 'M13 2L5 13h6l-1 9 8-12h-6z',
  'solve-10': 'M4 4h7v4a2 2 0 1 0 0 4v4H4zM13 4h7v7h-4a2 2 0 1 0-4 0',
  'solve-100': 'M5 19L19 5M14 5h5v5M5 14l5 5',
  'combo-10': 'M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 0 2 1 3 2 3 0-3 0-6 1-8z',
  'streak-7': 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h2M12 14h2M16 14h0',
  'streak-30': 'M3 20l6-11 4 6 3-4 5 9z',
  'master-10': 'M12 4a5 5 0 0 0-5 5c0 2 1 3 2 4v3h6v-3c1-1 2-2 2-4a5 5 0 0 0-5-5zM9 20h6',
  'rush-15': 'M12 7v5l3 3M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z',
  'accuracy-90': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  legendary: 'M4 18l2-10 4 4 2-7 2 7 4-4 2 10z',
};

export function Medal({ id, got }: { id: string; got: boolean }) {
  return (
    <svg width="48" height="48" viewBox="0 0 56 56" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="28" cy="28" r="26" fill={got ? '#f2b705' : 'none'} stroke={got ? '#c99300' : 'var(--line-3)'} strokeWidth="2" strokeDasharray={got ? undefined : '4 4'} />
      {got && <circle cx="28" cy="28" r="20" fill="none" stroke="#ffffff70" strokeWidth="1.5" />}
      <g transform="translate(16 16)">
        <path d={GLYPHS[id] ?? 'M12 4l2 6h6l-5 4 2 6-5-4-5 4 2-6-5-4h6z'} fill="none" stroke={got ? '#2a1e00' : 'var(--ink-3)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
