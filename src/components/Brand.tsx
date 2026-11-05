/**
 * The mark: a square of the board (the green square is the move you should have played)
 * inside an arrow turning back on itself — hindsight. Drawn with theme tokens so it
 * inverts cleanly in dark mode.
 */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="wordmark-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" style={{ fill: 'var(--inverse)' }} />
      <path d="M44.5 21A17 17 0 1 0 49 34" fill="none" strokeWidth="6" strokeLinecap="round" style={{ stroke: 'var(--on-inverse)' }} />
      <path d="M38.5 13.5l8 7.5-8 7" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--on-inverse)' }} />
      <rect x="25" y="25" width="14" height="14" rx="3" fill="#3fb45a" />
    </svg>
  );
}

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <a href="#/" className="wordmark" aria-label="Hindsight, today">
      <Mark />
      {!compact && <span>Hindsight</span>}
    </a>
  );
}
