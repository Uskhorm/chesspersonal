export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg className="wordmark-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#1a1d24" />
      <path d="M43.5 20.5A17 17 0 1 0 49 33" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <path d="M38 13.5l8.5 6.5-7.5 7.5" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="25" y="25" width="14" height="14" rx="3" fill="#12b8a6" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <a href="#/" className="wordmark" aria-label="Hindsight home">
      <Mark />
      <span className="wordmark-text">Hindsight</span>
    </a>
  );
}

/** Small line icons, drawn for this app (24px grid, 2px stroke). */
export const Icon = {
  home: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 10.5L12 4l8 6.5V20h-5v-6H9v6H4z" /></svg>
  ),
  train: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="5" /></svg>
  ),
  games: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></svg>
  ),
  insights: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19l5-6 4 3 7-9" /><path d="M4 4v15h16" /></svg>
  ),
  flame: () => (
    <svg className="sb-flame" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4 6 6.5 6 12a6 6 0 0 1-12 0c0-3 1.5-4.5 3-6 .3 2 1.3 3 2.3 3.4C10.6 8.6 11 5 12 2z" /></svg>
  ),
  chest: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 10h18v10H3zM3 10a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5" /><path d="M10 10v4h4v-4" /></svg>
  ),
  key: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3M21 12v2" /></svg>
  ),
};
