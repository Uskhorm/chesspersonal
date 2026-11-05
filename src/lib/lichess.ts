/** Lichess open puzzle API (https://lichess.org/api#tag/Puzzles) — free, no auth needed. */
export interface LichessPuzzle {
  id: string;
  fen: string; // solver to move
  solution: string[]; // UCI, alternating solver / opponent
  rating: number;
  themes: string[];
  lastMove?: string;
}

export async function fetchPuzzle(angle?: string): Promise<LichessPuzzle> {
  const url = `https://lichess.org/api/puzzle/next${angle ? `?angle=${encodeURIComponent(angle)}` : ''}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Lichess puzzle error ${r.status}`);
  const j = await r.json();
  return {
    id: j.puzzle.id,
    fen: j.puzzle.fen,
    solution: j.puzzle.solution,
    rating: j.puzzle.rating,
    themes: j.puzzle.themes,
    lastMove: j.puzzle.lastMove,
  };
}
