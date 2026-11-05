import type { StoredGame } from './types';

/**
 * chess.com Published-Data API (https://www.chess.com/news/view/published-data-api).
 * Read-only and public: no password or OAuth needed — your games are fetched by username.
 */
const API = 'https://api.chess.com/pub';

export interface ChessComProfile {
  username: string;
  name?: string;
  avatar?: string;
  url: string;
  country?: string;
  followers?: number;
  joined?: number;
  status?: string;
}

export interface RatingInfo {
  last?: { rating: number; date: number };
  best?: { rating: number; date: number };
  record?: { win: number; loss: number; draw: number };
}

export interface ChessComStats {
  chess_rapid?: RatingInfo;
  chess_blitz?: RatingInfo;
  chess_bullet?: RatingInfo;
  chess_daily?: RatingInfo;
  tactics?: { highest?: { rating: number } };
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) throw new Error('Player not found on chess.com');
  if (!r.ok) throw new Error(`chess.com API error ${r.status}`);
  return r.json();
}

export const fetchProfile = (u: string) => get<ChessComProfile>(`${API}/player/${u.toLowerCase()}`);
export const fetchStats = (u: string) => get<ChessComStats>(`${API}/player/${u.toLowerCase()}/stats`);

interface RawGame {
  url: string;
  pgn?: string;
  uuid?: string;
  end_time: number;
  time_class: string;
  time_control: string;
  rated: boolean;
  rules: string;
  accuracies?: { white: number; black: number };
  eco?: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

function toStored(g: RawGame, username: string): StoredGame | null {
  if (!g.pgn || g.rules !== 'chess') return null;
  const userColor = g.white.username.toLowerCase() === username.toLowerCase() ? 'w' : 'b';
  const me = userColor === 'w' ? g.white : g.black;
  const userResult = me.result === 'win' ? 'win' : DRAWS.has(me.result) ? 'draw' : 'loss';
  return {
    id: g.uuid ?? g.url,
    url: g.url,
    pgn: g.pgn,
    endTime: g.end_time * 1000,
    timeClass: g.time_class,
    timeControl: g.time_control,
    rated: g.rated,
    white: { username: g.white.username, rating: g.white.rating, result: g.white.result },
    black: { username: g.black.username, rating: g.black.rating, result: g.black.result },
    userColor,
    userResult,
    chesscomAccuracy: g.accuracies,
    eco: g.eco,
    analysed: false,
  };
}

/** Fetch the most recent games (current + previous month archives by default). */
export async function fetchRecentGames(username: string, months = 2): Promise<StoredGame[]> {
  const { archives } = await get<{ archives: string[] }>(`${API}/player/${username.toLowerCase()}/games/archives`);
  const recent = archives.slice(-months);
  const all: StoredGame[] = [];
  for (const url of recent.reverse()) {
    const { games } = await get<{ games: RawGame[] }>(url);
    for (const g of games) {
      const s = toStored(g, username);
      if (s) all.push(s);
    }
  }
  return all.sort((a, b) => b.endTime - a.endTime);
}

export function opponentOf(g: StoredGame) {
  return g.userColor === 'w' ? g.black : g.white;
}

export function selfOf(g: StoredGame) {
  return g.userColor === 'w' ? g.white : g.black;
}
