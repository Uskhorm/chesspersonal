import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { RefreshCw, Sparkles } from 'lucide-react';
import { analyseRecent, syncGames, useQueue } from '../lib/sync';
import { useGameCount, useGamesPage, useSummaries, type GameFilter } from '../lib/queries';
import type { StoredGame } from '../lib/types';
import { GameRow } from '../components/GameRow';
import { Seg } from '../components/Seg';
import { Skeleton } from '../components/Skeleton';

const CLASSES = [
  ['all', 'All'],
  ['bullet', 'Bullet'],
  ['blitz', 'Blitz'],
  ['rapid', 'Rapid'],
  ['daily', 'Daily'],
] as const;
const RESULTS = [
  ['all', 'All results'],
  ['loss', 'Losses'],
  ['win', 'Wins'],
  ['draw', 'Draws'],
] as const;
const CHUNK = 60;

function dayLabel(t: number) {
  const d = new Date(t);
  const now = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

type Item = { kind: 'day'; label: string } | { kind: 'game'; g: StoredGame };

export function Games() {
  const [tc, setTc] = useState<(typeof CLASSES)[number][0]>('all');
  const [res, setRes] = useState<(typeof RESULTS)[number][0]>('all');
  const [limit, setLimit] = useState(CHUNK);
  const filter = useMemo<GameFilter>(() => ({ timeClass: tc === 'all' ? undefined : tc, userResult: res === 'all' ? undefined : res }), [tc, res]);
  const games = useGamesPage(filter, 0, limit);
  const count = useGameCount(filter);
  const unreviewedCount = useGameCount({ analysed: false });
  const ids = useMemo(() => games.map((g) => g.id), [games]);
  const summaries = useSummaries(ids);
  const sumById = useMemo(() => new Map(summaries.map((s) => [s.gameId, s])), [summaries]);
  const syncing = useQueue((s) => s.syncing);
  const [loadedOnce, setLoadedOnce] = useState(false);
  useEffect(() => {
    if (games.length || count === 0) setLoadedOnce(true);
  }, [games.length, count]);
  useEffect(() => setLimit(CHUNK), [tc, res]);

  const items = useMemo(() => {
    const out: Item[] = [];
    let last = '';
    for (const g of games) {
      const label = dayLabel(g.endTime);
      if (label !== last) out.push({ kind: 'day', label });
      last = label;
      out.push({ kind: 'game', g });
    }
    return out;
  }, [games]);

  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) setMargin(el.getBoundingClientRect().top + window.scrollY);
  }, [loadedOnce, items.length > 0]);
  const mobile = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches;
  const v = useWindowVirtualizer({
    count: items.length,
    estimateSize: (i) => (items[i]?.kind === 'day' ? 44 : mobile ? 74 : 70),
    overscan: 8,
    scrollMargin: margin,
    getItemKey: (i) => (items[i].kind === 'day' ? `d:${(items[i] as { label: string }).label}` : (items[i] as { g: StoredGame }).g.id),
  });
  const vItems = v.getVirtualItems();
  const lastIndex = vItems[vItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= items.length - 10 && games.length < count) setLimit((l) => l + CHUNK);
  }, [lastIndex, items.length, games.length, count]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display t-1">Games</h1>
          <p className="faint t-small num" style={{ marginTop: 6 }}>
            {count} game{count === 1 ? '' : 's'}
            {unreviewedCount > 0 ? `, ${unreviewedCount} not reviewed yet` : ', all reviewed'}
          </p>
        </div>
        <span className="grow" />
        <button className="btn ghost" onClick={() => syncGames()} disabled={syncing}>
          {syncing ? <span className="spinner" /> : <RefreshCw />} Check chess.com
        </button>
        {unreviewedCount > 0 && (
          <button className="btn primary" onClick={() => void analyseRecent(10)}>
            <Sparkles /> Review the latest {Math.min(10, unreviewedCount)}
          </button>
        )}
      </header>
      <div className="gl-filters">
        <Seg label="Time control" value={tc} options={CLASSES} onChange={setTc} />
        <Seg label="Result" value={res} options={RESULTS} onChange={setRes} />
      </div>
      <p className="faint t-small" style={{ marginBottom: 4 }}>Losses hold the most lessons. Reviewing one adds every mistake you made to your training.</p>

      {!loadedOnce ? (
        <div style={{ marginTop: 44 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} h={64} r={10} style={{ marginBottom: 6 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty" style={{ marginTop: 20 }}>
          <h2>No games match these filters</h2>
          <p className="quiet">Try a different time control or result.</p>
        </div>
      ) : (
        <div ref={listRef} style={{ height: v.getTotalSize(), position: 'relative' }} role="list" aria-label="Games">
          {vItems.map((row) => {
            const it = items[row.index];
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={v.measureElement}
                role="listitem"
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${row.start - v.options.scrollMargin}px)` }}
              >
                {it.kind === 'day' ? <div className="gl-day">{it.label}</div> : <GameRow g={it.g} summary={sumById.get(it.g.id)} />}
              </div>
            );
          })}
        </div>
      )}
      {games.length < count && loadedOnce && <Skeleton h={64} r={10} style={{ marginTop: 6 }} />}
    </div>
  );
}
