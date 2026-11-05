import { create } from 'zustand';
import { api, cloudEnabled } from './api';
import { db, collections, suppressSync, subscribeOutbox, syncTimestamp, type Collection, type OutboxEntry } from './db';
import { flushProgress, progressSnapshot, useStore, type ProgressState } from './store';

export interface SyncItem { collection: Collection; key: string; data: unknown; updated_at: string; deleted?: boolean }
export interface CloudSyncState {
  status: 'off' | 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncedAt: number | null;
  pending: number;
  error?: string;
}
export const useCloudSync = create<CloudSyncState>(() => ({ status: 'off', lastSyncedAt: null, pending: 0 }));

/** Monotonic progress counters merge by max, never by summing shared history. */
export function mergeProgress(local: Partial<ProgressState>, remote: Partial<ProgressState>): Partial<ProgressState> {
  const newer = (remote.updatedAt ?? 0) > (local.updatedAt ?? 0) ? remote : local;
  const older = newer === local ? remote : local;
  const result = { ...older, ...newer };
  for (const key of ['xp', 'trainingRating', 'chests', 'updatedAt'] as const) {
    if (local[key] !== undefined || remote[key] !== undefined) result[key] = Math.max(local[key] ?? 0, remote[key] ?? 0);
  }
  for (const key of ['achievements', 'unlockedThemes'] as const) {
    if (local[key] || remote[key]) result[key] = [...new Set([...(local[key] ?? []), ...(remote[key] ?? [])])];
  }
  if (local.stats && remote.stats) result.stats = Object.fromEntries(
    Object.keys({ ...local.stats, ...remote.stats }).map(key => [key, Math.max(local.stats![key as keyof ProgressState['stats']] ?? 0, remote.stats![key as keyof ProgressState['stats']] ?? 0)]),
  ) as ProgressState['stats'];
  if (local.streak && remote.streak) {
    const a = local.streak, b = remote.streak;
    const winner = (b.lastDay ?? '') > (a.lastDay ?? '') || (b.lastDay === a.lastDay && b.count > a.count) ? b : a;
    result.streak = { ...winner, best: Math.max(a.best, b.best) };
  }
  if (local.quests && remote.quests) {
    if (local.quests.day === remote.quests.day) {
      const quests = new Map(local.quests.list.map(q => [q.id, { ...q }]));
      for (const q of remote.quests.list) {
        const old = quests.get(q.id);
        quests.set(q.id, old ? { ...q, progress: Math.max(old.progress, q.progress), done: old.done || q.done } : { ...q });
      }
      result.quests = { day: local.quests.day, list: [...quests.values()] };
    } else result.quests = local.quests.day > remote.quests.day ? local.quests : remote.quests;
  }
  return result;
}

const CURSOR = 'hindsight-sync-cursor';
const LIMIT = 3 * 1024 * 1024;
let active = false;
let generation = 0;
let flight: Promise<void> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let unsubscribe: (() => void) | undefined;
function session(): { token: string; owner: string } | undefined {
  try {
    const state = JSON.parse(localStorage.getItem('hindsight-auth') ?? '{}').state;
    return state?.token ? { token: state.token, owner: state.user?.id ?? state.user?.username ?? 'signed-in' } : undefined;
  } catch { return undefined; }
}
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const pendingEntries = () => db.outbox.filter(entry => !entry.synced).toArray();
async function updatePending() { useCloudSync.setState({ pending: (await pendingEntries()).length }); }
function schedule() {
  if (!active) return;
  void updatePending().catch(() => {});
  clearTimeout(debounce);
  debounce = setTimeout(() => { void syncNow(); }, 2000);
}
function valid(token: string, run: number) { return generation === run && session()?.token === token; }

async function seedLocal() {
  // Existing v1 records have no hooks/history. Queue them before pulling so they
  // participate in conflict resolution rather than disappearing on first login.
  await db.transaction('rw', [...collections.map(c => db.table(c)), db.outbox], async () => {
    for (const collection of collections) {
      const table = db.table(collection);
      for (const row of await table.toArray()) {
        const key = String(row[table.schema.primKey.keyPath as string]);
        const id = `${collection}:${key}`;
        if (!await db.outbox.get(id)) await db.outbox.put({ id, collection, key, updated_at: new Date(row.updatedAt ?? 0).toISOString() });
      }
    }
    if (!await db.outbox.get('progress:state')) await db.outbox.put({ id: 'progress:state', collection: 'progress', key: 'state', updated_at: new Date(useStore.getState().updatedAt ?? 0).toISOString() });
  });
}

async function apply(item: SyncItem) {
  if (![...collections, 'progress'].includes(item.collection) || !Number.isFinite(Date.parse(item.updated_at))) throw new Error('Invalid sync item');
  syncTimestamp(Date.parse(item.updated_at));
  const id = `${item.collection}:${item.key}`;
  if (item.collection === 'progress') {
    if (item.key !== 'state' || item.deleted) return;
    const remote = item.data as Partial<ProgressState>;
    const merged = mergeProgress(progressSnapshot(useStore.getState()), { ...remote, updatedAt: Date.parse(item.updated_at) });
    const differs = JSON.stringify(merged) !== JSON.stringify(mergeProgress(remote, remote));
    if (differs) merged.updatedAt = Math.max(Date.parse(syncTimestamp()), Date.parse(item.updated_at) + 1);
    useStore.getState().hydrate(merged);
    await db.outbox.put({ id, collection: 'progress', key: 'state', updated_at: new Date(merged.updatedAt ?? 0).toISOString(), synced: !differs });
    return;
  }
  const table = db.table(item.collection);
  await db.transaction('rw', table, db.outbox, async transaction => {
    const version = await db.outbox.get(id);
    const current = await table.get(item.key);
    const currentTime = Math.max(Date.parse(version?.updated_at ?? '') || 0, current?.updatedAt ?? 0);
    if (currentTime >= Date.parse(item.updated_at)) return;
    suppressSync(transaction);
    if (item.deleted) await table.delete(item.key);
    else {
      if (!item.data || typeof item.data !== 'object' || Array.isArray(item.data)) throw new Error('Invalid sync record');
      await table.put({ ...item.data, [table.schema.primKey.keyPath as string]: item.key, updatedAt: Date.parse(item.updated_at) });
    }
    await db.outbox.put({ id, collection: item.collection, key: item.key, updated_at: item.updated_at, deleted: item.deleted, synced: true });
  });
}
async function push(token: string, run: number) {
  const entries = await pendingEntries();
  let batch: SyncItem[] = [], versions: OutboxEntry[] = [];
  async function send() {
    if (!batch.length || !valid(token, run)) return;
    await api('/sync/push', { items: batch });
    if (!valid(token, run)) return;
    await db.transaction('rw', db.outbox, async () => {
      for (const entry of versions) {
        const current = await db.outbox.get(entry.id);
        if (current?.updated_at === entry.updated_at) await db.outbox.update(entry.id, { synced: true });
      }
    });
    batch = []; versions = [];
  }
  for (const entry of entries) {
    if (!valid(token, run)) return;
    const data = entry.deleted ? null : entry.collection === 'progress' ? progressSnapshot(useStore.getState()) : await db.table(entry.collection).get(entry.key);
    const item: SyncItem = { collection: entry.collection, key: entry.key, updated_at: entry.updated_at, data: data ?? null, deleted: entry.deleted || data === undefined };
    if (new TextEncoder().encode(JSON.stringify({ items: [item] })).byteLength > LIMIT) throw new Error(`Sync record exceeds 3 MB: ${entry.collection}`);
    if (batch.length >= 100 || new TextEncoder().encode(JSON.stringify({ items: [...batch, item] })).byteLength > LIMIT) await send();
    batch.push(item); versions.push(entry);
  }
  await send();
}

export function syncNow(): Promise<void> {
  if (!cloudEnabled || !session()) { useCloudSync.setState({ status: 'off' }); return Promise.resolve(); }
  if (flight) return flight;
  if (!online()) { useCloudSync.setState({ status: 'offline' }); return Promise.resolve(); }
  const { token, owner } = session()!;
  const run = generation;
  flight = (async () => {
    useCloudSync.setState({ status: 'syncing', error: undefined });
    try {
      await flushProgress();
      if (!valid(token, run)) return;
      const previousOwner = localStorage.getItem('hindsight-sync-owner');
      if (previousOwner && previousOwner !== owner) {
        localStorage.removeItem(CURSOR);
        await db.outbox.toCollection().modify({ synced: false });
      }
      localStorage.setItem('hindsight-sync-owner', owner);
      if (!localStorage.getItem(CURSOR)) await seedLocal();
      let since = localStorage.getItem(CURSOR) ?? undefined;
      let cursor: string | undefined;
      let watermark: string | undefined;
      for (;;) {
        const result = await api<{ items: SyncItem[]; now: string; more?: boolean; cursor?: string | null }>('/sync/pull', {
          ...(since ? { since } : {}), ...(cursor ? { cursor } : {}),
        });
        if (!valid(token, run)) return;
        for (const item of result.items) {
          if (!valid(token, run)) return;
          await apply(item);
        }
        if (!result.now || !Number.isFinite(Date.parse(result.now))) throw new Error('Invalid sync cursor');
        watermark ??= result.now;
        if (!result.more) {
          // Advance only after every page succeeds. The first page's watermark
          // also covers records written while later pages were being fetched.
          localStorage.setItem(CURSOR, watermark);
          break;
        }
        if (!result.items.length || (result.cursor ? result.cursor === cursor : result.now === since)) throw new Error('Sync cursor did not advance');
        // M1 supplies an opaque tuple cursor so equal-timestamp records cannot
        // fall between pages. Support the original timestamp-only contract too.
        if (result.cursor) cursor = result.cursor;
        else since = result.now;
      }
      await flushProgress();
      await push(token, run);
      if (!valid(token, run)) return;
      failures = 0;
      clearTimeout(retry);
      await updatePending();
      useCloudSync.setState({ status: 'idle', lastSyncedAt: Date.now(), error: undefined });
    } catch (error) {
      if (!valid(token, run)) return;
      useCloudSync.setState({ status: online() ? 'error' : 'offline', error: error instanceof Error ? error.message : String(error) });
      await updatePending().catch(() => {});
      if (active) {
        clearTimeout(retry);
        retry = setTimeout(() => { void syncNow(); }, Math.min(90_000, 2000 * 2 ** Math.min(failures++, 6)));
      }
    }
  })().finally(() => { flight = undefined; });
  return flight;
}
function wake() { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void syncNow(); }
function offline() { useCloudSync.setState({ status: 'offline' }); }
export function start(): void {
  if (!cloudEnabled || !session()) { useCloudSync.setState({ status: 'off' }); return; }
  if (active) { void syncNow(); return; }
  active = true;
  unsubscribe = subscribeOutbox(schedule);
  interval = setInterval(wake, 90_000);
  globalThis.addEventListener?.('focus', wake);
  globalThis.addEventListener?.('online', wake);
  globalThis.addEventListener?.('offline', offline);
  globalThis.document?.addEventListener('visibilitychange', wake);
  if (flight) void flight.then(() => { if (active) void syncNow(); });
  else void syncNow();
}
export function stop(): void {
  active = false;
  generation++;
  clearTimeout(debounce); clearTimeout(retry); clearInterval(interval);
  unsubscribe?.(); unsubscribe = undefined;
  globalThis.removeEventListener?.('focus', wake);
  globalThis.removeEventListener?.('online', wake);
  globalThis.removeEventListener?.('offline', offline);
  globalThis.document?.removeEventListener('visibilitychange', wake);
  useCloudSync.setState({ status: 'off', error: undefined });
}
