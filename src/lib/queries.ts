import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from './db';
import { isMastered } from './srs';
import type { StoredGame } from './types';

/** Exact game-field matches, with optional case-insensitive player search. */
export type GameFilter = Partial<Pick<StoredGame, 'analysed' | 'timeClass' | 'userColor' | 'userResult' | 'rated'>> & { search?: string };
export interface DrillStats { due: number; mastered: number; total: number; dueTomorrow: number }

function gamesMatching(filter: GameFilter) {
  const { search, ...fields } = filter;
  const needle = search?.trim().toLowerCase();
  return db.games.orderBy('endTime').reverse().filter(game =>
    Object.entries(fields).every(([key, value]) => value === undefined || game[key as keyof StoredGame] === value)
    && (!needle || `${game.white.username} ${game.black.username}`.toLowerCase().includes(needle)));
}
const bounded = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function useRecentGames(limit = 10) {
  return useLiveQuery(() => bounded(limit) ? db.games.orderBy('endTime').reverse().limit(bounded(limit)).toArray() : [], [limit], []);
}
export function useGamesPage(filter: GameFilter = {}, offset = 0, limit = 20) {
  return useLiveQuery(() => bounded(limit) ? gamesMatching(filter).offset(bounded(offset)).limit(bounded(limit)).toArray() : [], [JSON.stringify(filter), offset, limit], []);
}
export function useGameCount(filter: GameFilter = {}) {
  return useLiveQuery(() => gamesMatching(filter).count(), [JSON.stringify(filter)], 0);
}
export function useSummaries(gameIds?: string[]) {
  return useLiveQuery(() => gameIds === undefined ? db.summaries.toArray() : db.summaries.where('gameId').anyOf(gameIds).toArray(), [JSON.stringify(gameIds)], []);
}
export function useAnalysis(gameId: string) {
  return useLiveQuery(() => db.analyses.get(gameId), [gameId]);
}
export function useDrillStats() {
  return useLiveQuery(async (): Promise<DrillStats> => {
    const now = Date.now();
    const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0);
    const end = new Date(tomorrow); end.setDate(end.getDate() + 1);
    const drills = await db.drills.toArray();
    return {
      total: drills.length, mastered: drills.filter(isMastered).length,
      due: drills.filter(drill => drill.due <= now).length,
      dueTomorrow: drills.filter(drill => drill.due >= +tomorrow && drill.due < +end).length,
    };
  }, [], { due: 0, mastered: 0, total: 0, dueTomorrow: 0 });
}
export function useTodayActivity() {
  return useLiveQuery(async () => {
    const day = today();
    return (await db.activity.get(day)) ?? { day, xp: 0, drills: 0, correct: 0, reviews: 0 };
  }, []);
}
