import Dexie, { type EntityTable } from 'dexie';
import type { Drill, GameAnalysis, StoredGame } from './types';

export interface ActivityDay {
  day: string; // YYYY-MM-DD
  xp: number;
  drills: number;
  correct: number;
  reviews: number;
}

class ChessDB extends Dexie {
  games!: EntityTable<StoredGame, 'id'>;
  analyses!: EntityTable<GameAnalysis, 'gameId'>;
  drills!: EntityTable<Drill, 'id'>;
  activity!: EntityTable<ActivityDay, 'day'>;

  constructor() {
    super('chesspersonal');
    this.version(1).stores({
      games: 'id, endTime, analysed',
      analyses: 'gameId',
      drills: 'id, due, gameId, cls',
      activity: 'day',
    });
  }
}

export const db = new ChessDB();

export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function bumpActivity(patch: Partial<Omit<ActivityDay, 'day'>>) {
  const day = today();
  await db.transaction('rw', db.activity, async () => {
    const cur = (await db.activity.get(day)) ?? { day, xp: 0, drills: 0, correct: 0, reviews: 0 };
    for (const [k, v] of Object.entries(patch)) (cur as unknown as Record<string, number>)[k] += v as number;
    await db.activity.put(cur);
  });
}
