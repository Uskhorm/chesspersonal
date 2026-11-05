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
  syncing: boolean;
  error: string | null;
}

export const useQueue = create<QueueState>(() => ({ current: null, done: 0, total: 0, queued: [], syncing: false, error: null }));

const DRILL_CLASSES = new Set(['mistake', 'blunder', 'miss']);

export async function syncGames(): Promise<StoredGame[]> {
  const username = useStore.getState().username;
  if (!username) return [];
  useQueue.setState({ syncing: true, error: null });
  try {
    const games = await fetchRecentGames(username, 2);
    const existing = new Set(await db.games.toCollection().primaryKeys());
    const fresh = games.filter((g) => !existing.has(g.id));
    if (fresh.length) await db.games.bulkPut(fresh);
    useStore.getState().setSynced();
    return fresh;
  } catch (e) {
    useQueue.setState({ error: (e as Error).message });
    return [];
  } finally {
    useQueue.setState({ syncing: false });
  }
}

let running = false;
const waiters = new Map<string, ((a: GameAnalysis) => void)[]>();

export function enqueueAnalysis(id: string, priority = false): Promise<GameAnalysis> {
  const q = useQueue.getState();
  return new Promise((resolve) => {
    waiters.set(id, [...(waiters.get(id) ?? []), resolve]);
    if (q.current !== id && !q.queued.includes(id)) {
      useQueue.setState({ queued: priority ? [id, ...q.queued] : [...q.queued, id] });
    } else if (priority && q.queued.includes(id)) {
      useQueue.setState({ queued: [id, ...q.queued.filter((x) => x !== id)] });
    }
    void pump();
  });
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (useQueue.getState().queued.length) {
      const [id, ...rest] = useQueue.getState().queued;
      useQueue.setState({ queued: rest, current: id, done: 0, total: 0 });
      const game = await db.games.get(id);
      if (!game) continue;
      try {
        const a = await analyseAndStore(game);
        for (const w of waiters.get(id) ?? []) w(a);
        waiters.delete(id);
      } catch (e) {
        console.error(e);
        emit({ type: 'toast', text: `Analysis failed: ${(e as Error).message}`, tone: 'bad', emoji: '⚠️' });
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
  let first = true;
  const tick = async () => {
    if (document.hidden && !first) return;
    const fresh = await syncGames();
    const st = useStore.getState();
    if (st.settings.autoAnalyse && fresh.length) {
      const toAnalyse = first ? fresh.slice(0, 3) : fresh;
      if (!first)
        emit({ type: 'toast', text: `New game found vs ${opponentOf(fresh[0]).username} — reviewing…`, emoji: '⚡', tone: 'info' });
      for (const g of toAnalyse) void enqueueAnalysis(g.id);
    }
    first = false;
  };
  void tick();
  const iv = setInterval(tick, 60_000);
  const vis = () => !document.hidden && void tick();
  document.addEventListener('visibilitychange', vis);
  return () => {
    clearInterval(iv);
    document.removeEventListener('visibilitychange', vis);
  };
}
