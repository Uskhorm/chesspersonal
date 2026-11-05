import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type { AnalysedMove, Drill, GameAnalysis, StoredGame } from './types';

// FEN is needed for stale-position validation, legal corrections and opening drills.
export type SlimMove = Pick<AnalysedMove, 'ply' | 'color' | 'san' | 'uci' | 'from' | 'to' | 'fenBefore' | 'cls' | 'epLoss' | 'accuracy' | 'winBefore' | 'winAfter' | 'motifs' | 'clock' | 'bestSan' | 'bestUci' | 'opening'>;
export type SlimAnalysis = Omit<GameAnalysis, 'moves' | 'updatedAt'> & { moves: SlimMove[] };
export function slimAnalysis(a: SlimAnalysis): SlimAnalysis {
  return {
    gameId: a.gameId, depth: a.depth, createdAt: a.createdAt, white: a.white, black: a.black,
    winCurve: a.winCurve, opening: a.opening, eco: a.eco,
    moves: (a.moves ?? []).map(m => ({
      ply: m.ply, color: m.color, san: m.san, uci: m.uci, from: m.from, to: m.to,
      fenBefore: m.fenBefore, cls: m.cls, epLoss: m.epLoss, accuracy: m.accuracy,
      winBefore: m.winBefore, winAfter: m.winAfter, motifs: m.motifs,
      clock: m.clock, bestSan: m.bestSan, bestUci: m.bestUci, opening: m.opening,
    })),
  };
}

export interface AnalysisSummary {
  gameId: string;
  accuracy: number;
  counts: GameAnalysis['white']['counts'];
  curve: number[];
  opening?: string;
  eco?: string;
  userColor: StoredGame['userColor'];
}

function summarize(analysis: GameAnalysis, game?: StoredGame): AnalysisSummary {
  const userColor = game?.userColor ?? 'w';
  const side = userColor === 'w' ? analysis.white : analysis.black;
  const curve = analysis.winCurve ?? [];
  return {
    gameId: analysis.gameId, userColor, accuracy: side?.accuracy ?? 0,
    counts: side?.counts ?? {} as AnalysisSummary['counts'],
    curve: curve.length <= 64 ? [...curve] : Array.from({ length: 64 }, (_, i) => curve[Math.round(i * (curve.length - 1) / 63)]),
    opening: analysis.opening, eco: analysis.eco ?? game?.eco,
  };
}

export const collections = ['games', 'analyses', 'drills', 'activity'] as const;
export type Collection = typeof collections[number] | 'progress';
export interface OutboxEntry {
  id: string;
  collection: Collection;
  key: string;
  updated_at: string;
  deleted?: boolean;
  // Keep acknowledged versions, including tombstones, to reject stale pulls.
  synced?: boolean;
}
const serverTransactions = new WeakSet<IDBTransaction>();
export function suppressSync(transaction: Transaction) {
  serverTransactions.add(transaction.idbtrans);
}
const listeners = new Set<() => void>();
export function subscribeOutbox(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyOutbox() { listeners.forEach(listener => listener()); }
let clock = 0;
export function syncTimestamp(after = 0) {
  clock = Math.max(Date.now(), clock + 1, after + 1);
  return new Date(clock).toISOString();
}

export interface ActivityDay {
  updatedAt?: number;
  day: string; // YYYY-MM-DD
  xp: number;
  drills: number;
  correct: number;
  reviews: number;
}

class ChessDB extends Dexie {
  outbox!: EntityTable<OutboxEntry, 'id'>;
  games!: EntityTable<StoredGame, 'id'>;
  analyses!: EntityTable<GameAnalysis, 'gameId'>;
  drills!: EntityTable<Drill, 'id'>;
  activity!: EntityTable<ActivityDay, 'day'>;
  slim!: EntityTable<SlimAnalysis, 'gameId'>;
  summaries!: EntityTable<AnalysisSummary, 'gameId'>;

  constructor() {
    super('chesspersonal');
    this.version(1).stores({
      games: 'id, endTime, analysed',
      analyses: 'gameId',
      drills: 'id, due, gameId, cls',
      activity: 'day',
    });
    this.version(2).stores({
      games: 'id, endTime, analysed',
      analyses: 'gameId',
      drills: 'id, due, gameId, cls',
      activity: 'day',
      outbox: 'id, collection, updated_at',
    });
    this.version(3).stores({ summaries: 'gameId' }).upgrade(async transaction => {
      const games = new Map((await transaction.table<StoredGame>('games').toArray()).map(game => [game.id, game]));
      await transaction.table<GameAnalysis>('analyses').each(analysis => {
        transaction.idbtrans.objectStore('summaries').put(summarize(analysis, games.get(analysis.gameId)));
      });
    });
    this.version(4).stores({ slim: 'gameId' }).upgrade(async transaction => {
      await transaction.table<GameAnalysis>('analyses').each(analysis => {
        transaction.idbtrans.objectStore('slim').put(slimAnalysis(analysis));
      });
    });
    // Hooks run inside the originating transaction, including explicit single-table
    // transactions. Expand its native scope so the outbox write is atomic.
    this.use({ stack: 'dbcore', name: 'sync-outbox-scope', create: core => ({
      ...core,
      transaction: (stores, mode, options) => core.transaction(
        mode === 'readwrite' && stores.some(name => collections.includes(name as typeof collections[number]))
          ? [...new Set([...stores, 'outbox', ...(stores.includes('analyses') ? ['summaries', 'slim', 'games'] : [])])] : stores, mode, options),
    }) });
    const writeSummary = (analysis: GameAnalysis, transaction: Transaction) => {
      transaction.idbtrans.objectStore('slim').put(slimAnalysis(analysis));
      const request = transaction.idbtrans.objectStore('games').get(analysis.gameId);
      request.onsuccess = () => transaction.idbtrans.objectStore('summaries').put(summarize(analysis, request.result));
    };
    this.analyses.hook('creating', (key, analysis, transaction) => {
      writeSummary({ ...analysis, gameId: String(key ?? analysis.gameId) }, transaction);
    });
    this.analyses.hook('updating', (changes, key, analysis, transaction) => {
      const updated = structuredClone(analysis);
      for (const [path, value] of Object.entries(changes)) Dexie.setByKeyPath(updated, path, value);
      writeSummary({ ...updated, gameId: String(key) }, transaction);
    });
    this.analyses.hook('deleting', (key, _analysis, transaction) => {
      transaction.idbtrans.objectStore('summaries').delete(key);
      transaction.idbtrans.objectStore('slim').delete(key);
    });
    for (const collection of collections) {
      const table = this.table(collection);
      const enqueue = (key: unknown, transaction: Transaction, deleted = false, after = 0) => {
        if (serverTransactions.has(transaction.idbtrans)) return;
        const updated_at = syncTimestamp(after);
        transaction.idbtrans.objectStore('outbox').put({
          id: `${collection}:${key}`, collection, key: String(key), updated_at, deleted,
        } satisfies OutboxEntry);
        transaction.on('complete', notifyOutbox);
        return Date.parse(updated_at);
      };
      table.hook('creating', (key, object, transaction) => {
        const stamp = enqueue(key ?? object[table.schema.primKey.keyPath as string], transaction, false, object.updatedAt ?? 0);
        if (stamp) object.updatedAt = stamp;
      });
      table.hook('updating', (_changes, key, object, transaction) => {
        const stamp = enqueue(key, transaction, false, object.updatedAt ?? 0);
        if (stamp) return { updatedAt: stamp };
      });
      table.hook('deleting', (key, object, transaction) => { enqueue(key, transaction, true, object.updatedAt ?? 0); });
    }
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
