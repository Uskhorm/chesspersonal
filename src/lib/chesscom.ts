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

export interface PlayerTimeClassStats {
  current: number | null;
  best: number | null;
  record: { win: number; loss: number; draw: number };
}

export type PlayerStats = Record<'rapid' | 'blitz' | 'bullet' | 'daily', PlayerTimeClassStats>;

export async function fetchPlayerStats(username: string): Promise<PlayerStats> {
  const stats = await fetchStats(username);
  return Object.fromEntries((['rapid', 'blitz', 'bullet', 'daily'] as const).map(timeClass => {
    const info = stats[`chess_${timeClass}`];
    return [timeClass, {
      current: info?.last?.rating ?? null,
      best: info?.best?.rating ?? null,
      record: { win: info?.record?.win ?? 0, loss: info?.record?.loss ?? 0, draw: info?.record?.draw ?? 0 },
    }];
  })) as PlayerStats;
}

export interface FetchAllGamesOptions {
  onBatch: (games: StoredGame[]) => void | Promise<void>;
  signal?: AbortSignal;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Streams months newest first. A successfully delivered month is checkpointed until completion. */
export async function fetchAllGames(username: string, { onBatch, signal }: FetchAllGamesOptions): Promise<void> {
  const user = username.toLowerCase();
  const key = `hindsight-chesscom-history:${user}`;
  let completed: string[] = [];
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(saved)) completed = saved.filter((url): url is string => typeof url === 'string');
  } catch { /* Storage may be unavailable or contain an old checkpoint. */ }
  let lastRequest: number | undefined;
  async function request<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      if (lastRequest !== undefined) await wait(Math.max(0, 300 - (Date.now() - lastRequest)), signal);
      signal?.throwIfAborted();
      lastRequest = Date.now();
      const response = await fetch(url, { cache: 'no-store', signal });
      if (response.status === 429 && attempt < 5) {
        const header = response.headers.get('Retry-After');
        const seconds = header === null ? NaN : Number(header);
        const retryAfter = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : 0;
        await wait(Math.max(300, 1000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter : 0), signal);
        continue;
      }
      if (response.status === 404) throw new Error('Player not found on chess.com');
      if (!response.ok) throw new Error(`chess.com API error ${response.status}`);
      return response.json();
    }
  }
  const { archives } = await request<{ archives: string[] }>(`${API}/player/${encodeURIComponent(user)}/games/archives`);
  for (const url of [...new Set(archives)].sort().reverse()) {
    if (completed.includes(url)) continue;
    const { games } = await request<{ games: RawGame[] }>(url);
    signal?.throwIfAborted();
    const batch = games.map(game => toStored(game, username)).filter((game): game is StoredGame => game !== null)
      .sort((a, b) => b.endTime - a.endTime);
    await onBatch(batch);
    completed.push(url);
    try { localStorage.setItem(key, JSON.stringify(completed)); } catch { /* Import still works without storage. */ }
    signal?.throwIfAborted();
  }
  try { localStorage.removeItem(key); } catch { /* Storage is optional. */ }
}

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
