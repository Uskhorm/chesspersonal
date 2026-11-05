import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { GameCard } from '../components/GameCard';
import { enqueueAnalysis, syncGames, useQueue } from '../lib/sync';

const FILTERS = ['all', 'bullet', 'blitz', 'rapid', 'daily'];

export function Games() {
  const [f, setF] = useState('all');
  const [res, setRes] = useState<'all' | 'win' | 'loss' | 'draw'>('all');
  const games = useLiveQuery(() => db.games.orderBy('endTime').reverse().toArray(), []) ?? [];
  const syncing = useQueue((s) => s.syncing);
  const shown = games.filter((g) => (f === 'all' || g.timeClass === f) && (res === 'all' || g.userResult === res));
  const unanalysed = shown.filter((g) => !g.analysed);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="h1">Your games</h1>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => syncGames()} disabled={syncing}>
          {syncing ? <span className="spinner" /> : '↻'} Sync chess.com
        </button>
        {unanalysed.length > 0 && (
          <button className="btn primary" onClick={() => unanalysed.slice(0, 20).forEach((g) => enqueueAnalysis(g.id))}>
            Analyse {Math.min(20, unanalysed.length)} games
          </button>
        )}
      </div>
      <div className="chips">
        {FILTERS.map((x) => (
          <button key={x} className={`chip ${f === x ? 'on' : ''}`} onClick={() => setF(x)}>{x}</button>
        ))}
        <span className="chip-sep" />
        {(['all', 'win', 'loss', 'draw'] as const).map((x) => (
          <button key={x} className={`chip ${res === x ? 'on' : ''}`} onClick={() => setRes(x)}>{x}</button>
        ))}
      </div>
      <p className="muted small">Tip: losses are the best teachers. Review them first — they hold the most new drills.</p>
      <div className="game-grid">
        {shown.map((g, i) => (
          <GameCard key={g.id} g={g} i={Math.min(i, 12)} />
        ))}
      </div>
    </div>
  );
}
