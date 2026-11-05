let book: Record<string, [string, string]> | null = null;
let loading: Promise<void> | null = null;

/** Lazy-loads the opening book (built from the CC0 lichess-org/chess-openings dataset). */
export function loadOpenings(): Promise<void> {
  if (book) return Promise.resolve();
  if (!loading) {
    loading = import('../data/openings.json').then((m) => {
      book = (m.default ?? m) as unknown as Record<string, [string, string]>;
    });
  }
  return loading;
}

const epd = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/** Returns [eco, name] if this position appears in the opening book. */
export function lookupOpening(fen: string): [string, string] | null {
  return book?.[epd(fen)] ?? null;
}
