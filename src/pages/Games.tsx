import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { TapeRow } from '../components/TapeRow';
import { enqueueAnalysis, syncGames, useQueue } from '../lib/sync';
import type { StoredGame } from '../lib/types';

const CLASSES = ['all', 'bullet', 'blitz', 'rapid', 'daily'];
const RESULTS = [
  ['all', 'All results'],
  ['loss', 'Losses'],
  ['win', 'Wins'],
  ['draw', 'Draws'],
] as const;
const PAGE = 30;

function dayLabel(t: number) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function Games() {
  const [tc, setTc] = useState('all');
  const [res, setRes] = useState<(typeof RESULTS)[number][0]>('all');
  const [limit, setLimit] = useState(PAGE);
  const games = useLiveQuery(() => db.games.orderBy('endTime').reverse().toArray(), []) ?? [];
  const curves = useLiveQuery(async () => {
    const m = new Map<string, number[]>();
    await db.analyses.each((a) => {
      m.set(a.gameId, a.winCurve);
    });
    return m;
  }, []);
  const syncing = useQueue((s) => s.syncing);
  const shown = games.filter((g) => (tc === 'all' || g.timeClass === tc) && (res === 'all' || g.userResult === res));
  const unreviewed = shown.filter((g) => !g.analysed);
  const groups = useMemo(() => {
    const out: { label: string; games: StoredGame[] }[] = [];
    for (const g of shown.slice(0, limit)) {
      const label = dayLabel(g.endTime);
      if (out[out.length - 1]?.label !== label) out.push({ label, games: [] });
      out[out.length - 1].games.push(g);
    }
    return out;
  }, [shown, limit]);

  return (
    <div className="page">
      <header className="section-head" style={{ marginBottom: 20 }}>
        <h1 className="display t-1">Games</h1>
        <span className="faint">{shown.length} games</span>
        <span className="grow" />
        <button className="key" onClick={() => syncGames()} disabled={syncing}>
          {syncing && <span className="spin" />} Check chess.com
        </button>
        {unreviewed.length > 0 && (
          <button className="key ink" onClick={() => unreviewed.slice(0, 10).forEach((g) => enqueueAnalysis(g.id))}>
            Review the latest {Math.min(10, unreviewed.length)}
          </button>
        )}
      </header>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="chips" role="group" aria-label="Time control">
          {CLASSES.map((x) => (
            <button key={x} className={`chip ${tc === x ? 'on' : ''}`} onClick={() => (setTc(x), setLimit(PAGE))} style={{ textTransform: 'capitalize' }}>
              {x === 'all' ? 'All time controls' : x}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Result">
          {RESULTS.map(([k, label]) => (
            <button key={k} className={`chip ${res === k ? 'on' : ''}`} onClick={() => (setRes(k), setLimit(PAGE))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="faint t-small" style={{ margin: '10px 0 4px' }}>
        Losses hold the most lessons. Reviewing one adds every mistake you made to your training queue.
      </p>
      <div className="tape">
        {groups.map((grp) => (
          <div key={grp.label}>
            <div className="tape-day">{grp.label}</div>
            {grp.games.map((g) => (
              <TapeRow key={g.id} g={g} curve={curves?.get(g.id)} />
            ))}
          </div>
        ))}
        {!shown.length && <p className="quiet">No games match these filters.</p>}
      </div>
      {shown.length > limit && (
        <button className="key" style={{ marginTop: 16 }} onClick={() => setLimit((l) => l + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more
        </button>
      )}
    </div>
  );
}
