import { create } from 'zustand';
import { analysePgn } from './analysis';
import { emit } from './bus';
import { fetchRecentGames, opponentOf } from './chesscom';
import { bumpActivity, db } from './db';
import { newDrill } from './srs';
import { useStore } from './store';
import type { GameAnalysis, StoredGame } from './types';

interface QueueState {
  current: string | null;
  done: number;
  total: number;
  queued: string[];
  batchTotal: number;
  batchDone: number;
  syncing: boolean;
  error: string | null;
}

export const useQueue = create<QueueState>(() => ({ current: null, done: 0, total: 0, queued: [], batchTotal: 0, batchDone: 0, syncing: false, error: null }));

const DRILL_CLASSES = new Set(['mistake', 'blunder', 'miss']);

let syncedUsername: string | null = null;
let syncing: Promise<StoredGame[]> | undefined;
let syncingUsername: string | null = null;
useStore.subscribe((state, previous) => {
  if (state.username !== previous.username) syncedUsername = null;
});

export function syncGames(): Promise<StoredGame[]> {
  const username = useStore.getState().username;
  if (!username) return Promise.resolve([]);
  if (syncing) return syncingUsername === username ? syncing : syncing.then(() => syncGames());
  syncingUsername = username;
  syncing = performSync().finally(() => { syncing = undefined; });
  return syncing;
}

async function performSync(): Promise<StoredGame[]> {
  const username = useStore.getState().username;
  if (!username) return [];
  useQueue.setState({ syncing: true, error: null });
  try {
    const games = await fetchRecentGames(username, 2);
    if (useStore.getState().username !== username) return [];
    const existing = new Set(await db.games.toCollection().primaryKeys());
    const fresh = games.filter((g) => !existing.has(g.id));
    if (fresh.length) await db.games.bulkPut(fresh);
    useStore.getState().setSynced();
    if (syncedUsername !== username) {
      await analyseRecent();
      syncedUsername = username;
    } else {
      for (const game of fresh.sort((a, b) => b.endTime - a.endTime)) {
        void enqueueAnalysis(game.id).catch(() => { /* reported by pump */ });
      }
    }
    return fresh;
  } catch (e) {
    useQueue.setState({ error: (e as Error).message });
    return [];
  } finally {
    useQueue.setState({ syncing: false });
  }
}

let running = false;
const waiters = new Map<string, { resolve: (a: GameAnalysis) => void; reject: (error: unknown) => void }[]>();
let trainingPaused = false;
let hiddenSince: number | null = null;
let visibilityInstalled = false;
let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
const HIDDEN_LIMIT = 5 * 60_000;

function installVisibility() {
  if (visibilityInstalled || typeof document === 'undefined') return;
  visibilityInstalled = true;
  const changed = () => {
    clearTimeout(hiddenTimer);
    hiddenSince = document.hidden ? Date.now() : null;
    if (hiddenSince !== null) hiddenTimer = setTimeout(() => { void pump(); }, HIDDEN_LIMIT);
    else void pump();
  };
  document.addEventListener('visibilitychange', changed);
  changed();
}

/** Pauses between games; an engine search already in flight finishes safely. */
export function pauseAnalysis(paused: boolean): void {
  trainingPaused = paused;
  if (!paused) void pump();
}

/** Queue the newest unanalysed local games. Resolves once queued, not analysed. */
export async function analyseRecent(n = 10): Promise<void> {
  if (!Number.isFinite(n) || n <= 0) return;
  const games = await db.games.orderBy('endTime').reverse().filter(g => !g.analysed).limit(Math.floor(n)).toArray();
  for (const game of games) void enqueueAnalysis(game.id).catch(() => { /* reported by pump */ });
}

export function enqueueAnalysis(id: string, priority = false): Promise<GameAnalysis> {
  installVisibility();
  const q = useQueue.getState();
  return new Promise((resolve, reject) => {
    waiters.set(id, [...(waiters.get(id) ?? []), { resolve, reject }]);
    if (q.current !== id && !q.queued.includes(id)) {
      const idle = !q.current && !q.queued.length;
      useQueue.setState({
        queued: priority ? [id, ...q.queued] : [...q.queued, id],
        batchTotal: idle ? 1 : q.batchTotal + 1,
        batchDone: idle ? 0 : q.batchDone,
      });
    } else if (priority && q.queued.includes(id)) {
      useQueue.setState({ queued: [id, ...q.queued.filter(x => x !== id)] });
    }
    void pump();
  });
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (useQueue.getState().queued.length) {
      if (trainingPaused || (hiddenSince !== null && Date.now() - hiddenSince >= HIDDEN_LIMIT)) break;
      const [id, ...rest] = useQueue.getState().queued;
      useQueue.setState({ queued: rest, current: id, done: 0, total: 0 });
      try {
        const game = await db.games.get(id);
        if (!game) throw new Error(`Game not found: ${id}`);
        const a = await db.analyses.get(id) ?? await analyseAndStore(game);
        for (const waiter of waiters.get(id) ?? []) waiter.resolve(a);
      } catch (e) {
        useQueue.setState({ error: (e as Error).message });
        for (const waiter of waiters.get(id) ?? []) waiter.reject(e);
        emit({ type: 'toast', text: `Analysis failed: ${(e as Error).message}`, tone: 'bad', emoji: '⚠️' });
      } finally {
        waiters.delete(id);
        useQueue.setState(q => ({ current: null, batchDone: q.batchDone + 1 }));
      }
    }
  } finally {
    running = false;
    useQueue.setState({ current: null });
  }
}

async function analyseAndStore(game: StoredGame): Promise<GameAnalysis> {
  const { depth } = useStore.getState().settings;
  const a = await analysePgn(game.id, game.pgn, {
    depth,
    onProgress: (done, total) => useQueue.setState({ done, total }),
  });
  await db.analyses.put(a);
  const side = game.userColor === 'w' ? a.white : a.black;
  const highlights = Object.fromEntries(Object.entries(side.counts).filter(([, n]) => n > 0));
  await db.games.update(game.id, { analysed: true, userAccuracy: side.accuracy, highlights });

  // Every one of your mistakes becomes a spaced-repetition card.
  const mine = a.moves.filter((m) => m.color === game.userColor && DRILL_CLASSES.has(m.cls));
  const drills = mine.map((m) => newDrill(game, m));
  const existing = new Set(await db.drills.where('gameId').equals(game.id).primaryKeys());
  await db.drills.bulkPut(drills.filter((d) => !existing.has(d.id)));

  const st = useStore.getState();
  if (side.counts.brilliant) st.unlock('brilliant');
  if (side.counts.great) st.unlock('great');
  if (side.accuracy >= 90) st.unlock('accuracy-90');

  const opp = opponentOf(game).username;
  const bits = [`${side.accuracy.toFixed(1)}% accuracy`];
  if (side.counts.brilliant) bits.push(`${side.counts.brilliant} brilliant`);
  if (side.counts.great) bits.push(`${side.counts.great} great`);
  if (drills.length) bits.push(`${drills.length} new drills`);
  emit({
    type: 'toast',
    text: `Game vs ${opp} reviewed — ${bits.join(' · ')}`,
    emoji: side.counts.brilliant ? '💎' : '✅',
    tone: 'good',
    onClick: () => (location.hash = `#/review/${encodeURIComponent(game.id)}`),
  });
  if (st.settings.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Game reviewed ♟️', { body: `vs ${opp}: ${bits.join(' · ')}`, icon: `${import.meta.env.BASE_URL}icon.svg` });
  }
  return a;
}

/** Called after a full review is watched. */
export async function markReviewed() {
  const st = useStore.getState();
  st.stat('gamesReviewed', 1);
  st.unlock('first-review');
  st.progressQuest('review', 1);
  await bumpActivity({ reviews: 1 });
}

export async function getOrAnalyse(id: string): Promise<GameAnalysis> {
  const a = await db.analyses.get(id);
  if (a) return a;
  return enqueueAnalysis(id, true);
}

/** Poll chess.com while the app is open; auto-review games as you finish them. */
export function startAutoSync(): () => void {
  installVisibility();
  let stopped = false;
  const tick = async () => {
    if (!stopped && !document.hidden) await syncGames();
  };
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.username !== previous.username) void tick();
  });
  void tick();
  const iv = setInterval(tick, 60_000);
  const vis = () => !document.hidden && void tick();
  document.addEventListener('visibilitychange', vis);
  return () => {
    stopped = true;
    unsubscribe();
    clearInterval(iv);
    document.removeEventListener('visibilitychange', vis);
  };
}
