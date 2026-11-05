export type Color = 'w' | 'b';

/** Engine score, always from WHITE's point of view. */
export interface Score {
  cp?: number;
  mate?: number; // >0 white mates in n, <0 black mates in n
}

export interface PVLine {
  score: Score;
  pv: string[]; // UCI moves
}

export interface PositionEval {
  fen: string;
  depth: number;
  lines: PVLine[]; // sorted best first
  source: 'local' | 'cloud' | 'terminal';
}

export type Motif =
  | 'hung-piece'
  | 'allowed-mate'
  | 'missed-mate'
  | 'missed-win'
  | 'missed-fork'
  | 'time-trouble'
  | 'opening'
  | 'endgame'
  | 'positional';

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'forced'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

export interface AnalysedMove {
  ply: number; // 1-based
  color: Color;
  san: string;
  uci: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
  scoreBefore: Score; // best-play eval of position before move (white POV)
  scoreAfter: Score; // eval of position after move (white POV)
  winBefore: number; // mover POV 0-100
  winAfter: number; // mover POV 0-100
  epLoss: number; // expected points lost 0-1
  accuracy: number; // 0-100
  bestUci: string;
  bestSan: string;
  bestLineSan: string[];
  replyLineSan: string[]; // engine line after the played move
  cls: Classification;
  opening?: string;
  comment: string;
  sacrifice?: number;
  motifs: Motif[];
  clock?: number; // seconds left after the move
}

export interface SideSummary {
  accuracy: number;
  estRating: number;
  counts: Record<Classification, number>;
  phases: { opening: number | null; middlegame: number | null; endgame: number | null };
}

export interface GameAnalysis {
  gameId: string;
  depth: number;
  createdAt: number;
  moves: AnalysedMove[];
  winCurve: number[]; // white win% per position (index 0 = start)
  white: SideSummary;
  black: SideSummary;
  opening?: string;
  eco?: string;
}

export interface StoredGame {
  id: string; // chess.com uuid or url
  url: string;
  pgn: string;
  endTime: number; // ms
  timeClass: string;
  timeControl: string;
  rated: boolean;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
  userColor: Color;
  userResult: 'win' | 'loss' | 'draw';
  chesscomAccuracy?: { white: number; black: number };
  eco?: string;
  analysed: boolean;
  userAccuracy?: number;
  highlights?: Partial<Record<Classification, number>>;
}

export interface Drill {
  id: string; // gameId:ply
  gameId: string;
  ply: number;
  fen: string;
  color: Color;
  bestUci: string;
  bestSan: string;
  playedSan: string;
  cls: Classification;
  winBefore: number;
  motifs: Motif[];
  // SM-2 style scheduling
  reps: number;
  lapses: number;
  ease: number;
  interval: number; // days
  due: number; // ms
  lastSeen?: number;
  attempts: number;
  solved: number;
  createdAt: number;
  opponent: string;
}
