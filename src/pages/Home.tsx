import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from '../lib/db';
import { useStore } from '../lib/store';
import { computeLeaks } from '../lib/learning';
import { isMastered } from '../lib/srs';
import { syncGames, useQueue } from '../lib/sync';
import { Board } from '../components/Board';
import { TapeRow } from '../components/TapeRow';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { DAILY_GOAL } from '../components/constants';
import { recovery } from '../lib/insights';
import type { FsrsDrill } from '../lib/srs';

const dateLine = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export function Home() {
  const { quests, ensureDay, stats } = useStore();
  const games = useLiveQuery(() => db.games.orderBy('endTime').reverse().toArray(), []) ?? [];
  const analyses = useLiveQuery(() => db.analyses.toArray(), []) ?? [];
  const drills = useLiveQuery(() => db.drills.toArray(), []) ?? [];
  const todayAct = useLiveQuery(() => db.activity.get(today()), []);
  const syncing = useQueue((s) => s.syncing);
  const syncErr = useQueue((s) => s.error);

  useEffect(() => {
    ensureDay();
  }, [ensureDay]);

  const now = Date.now();
  const due = drills.filter((d) => d.due <= now).sort((a, b) => a.due - b.due);
  const mastered = drills.filter(isMastered).length;
  const rec = useMemo(() => recovery(drills as FsrsDrill[], analyses), [drills, analyses]);
  const leaks = useMemo(() => computeLeaks(games, analyses).filter((l) => l.motif !== 'opening' && l.motif !== 'endgame'), [games, analyses]);
  const unreviewed = games.find((g) => g.analysed && !localStorage.getItem(`reviewed:${g.id}`));
  const xpToday = todayAct?.xp ?? 0;
  const focusDrill = due[0];
  const q = useQueue();
  const importing = (games.length === 0 && syncing) || (analyses.length === 0 && !!q.current);

  return (
    <div className="page">
      <header style={{ marginBottom: 28 }}>
        <p className="quiet">{dateLine()}</p>
        {rec.mastered > 0 && (
          <p className="recovered" style={{ marginTop: 10 }}>
            <span className="display num">{rec.mastered}</span> mistakes retired for good, worth <span className="num">{Math.round(rec.winPctRecovered)}%</span> of winning chances
          </p>
        )}
        <h1 className="display t-hero" style={{ marginTop: 6 }}>
          {due.length > 0 ? `${due.length} mistake${due.length > 1 ? 's' : ''} to fix` : unreviewed ? 'A game to review' : 'All caught up'}
        </h1>
      </header>

      <div className="today">
        {importing ? (
          <div className="stage" style={{ padding: 26 }}>
            <p style={{ opacity: 0.7 }}>Setting up</p>
            <h2 className="display" style={{ fontSize: 40, margin: '6px 0 14px' }}>
              {games.length === 0 ? 'Fetching your games from chess.com' : 'Reviewing your latest game'}
            </h2>
            <div className="meter" style={{ background: '#ffffff1a' }}>
              <i style={{ width: `${games.length === 0 ? 8 : q.total ? (q.done / q.total) * 100 : 5}%`, background: 'var(--gold)' }} />
            </div>
            <p style={{ opacity: 0.75, marginTop: 14 }} className="t-small">
              {games.length === 0 ? 'This takes a few seconds.' : `${games.length} games found. Your three most recent are being reviewed now; the mistakes you made become your first training set.`}
            </p>
          </div>
        ) : focusDrill ? (
          <a className="panel focus" href="#/train/session">
            <div className="mini">
              <Board fen={focusDrill.fen} orientation={focusDrill.color === 'w' ? 'white' : 'black'} coordinates={false} />
            </div>
            <div className="stack" style={{ gap: 14 }}>
              <span className="tag" style={{ alignSelf: 'flex-start' }}>
                <ClassIcon cls={focusDrill.cls} size={16} /> {CLASS_LABEL[focusDrill.cls]} vs {focusDrill.opponent}
              </span>
              <p className="t-3">
                You played <b>{focusDrill.playedSan}</b> here. There was something much better.
              </p>
              <p className="quiet t-small">
                {due.length} positions from your games are due. A session takes about {Math.max(2, Math.round(Math.min(due.length, 10) * 0.6))} minutes.
              </p>
              <span className="key ink big" style={{ alignSelf: 'flex-start' }}>Start training</span>
            </div>
          </a>
        ) : unreviewed ? (
          <a className="panel focus" href={`#/review/${encodeURIComponent(unreviewed.id)}/learn`} style={{ gridTemplateColumns: '1fr' }}>
            <div className="stack" style={{ gap: 14 }}>
              <p className="t-3">Your game against {unreviewed.userColor === 'w' ? unreviewed.black.username : unreviewed.white.username} is analysed.</p>
              <p className="quiet">Walk through your key moments and find the moves you missed. Each one you get wrong comes back later as a drill.</p>
              <span className="key ink big" style={{ alignSelf: 'flex-start' }}>Review key moments</span>
            </div>
          </a>
        ) : (
          <div className="panel focus" style={{ gridTemplateColumns: '1fr' }}>
            <div className="stack" style={{ gap: 14 }}>
              <p className="t-3">Nothing is due right now.</p>
              <p className="quiet">Play a game on chess.com. Hindsight picks it up within a minute of the last move and reviews it for you.</p>
              <div className="row">
                <a className="key ink" href="https://www.chess.com/play/online" target="_blank" rel="noreferrer">Play on chess.com</a>
                <a className="key" href="#/train/rush">Blunder Rush</a>
              </div>
            </div>
          </div>
        )}

        <section className="panel panel-pad">
          <div className="goal">
            <div className="grow">
              <h2 className="t-3">Today</h2>
              <p className="quiet t-small">{xpToday >= DAILY_GOAL ? 'Daily goal reached. Streak is safe.' : `${DAILY_GOAL - xpToday} XP until your daily goal.`}</p>
            </div>
            <span className="display num" style={{ fontSize: 40 }}>
              {Math.min(xpToday, 999)}<span className="faint" style={{ fontSize: 22 }}>/{DAILY_GOAL}</span>
            </span>
          </div>
          <div className="meter" style={{ margin: '12px 0 10px' }}>
            <i style={{ width: `${Math.min(100, (xpToday / DAILY_GOAL) * 100)}%`, background: 'var(--gold)' }} />
          </div>
          <div>
            {quests.list.map((q) => (
              <div key={q.id} className={`quest ${q.done ? 'done' : ''}`}>
                <span className="box" aria-hidden="true">{q.done ? '✓' : ''}</span>
                <span className="q-label">
                  {q.label}
                  {!q.done && q.target > 1 && <span className="faint num"> {q.progress}/{q.target}</span>}
                </span>
                <span className="reward">+{q.reward}</span>
              </div>
            ))}
          </div>
          <p className="faint t-tiny" style={{ marginTop: 8 }}>Finish all three for a chest.</p>
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="t-2">Where your points go</h2>
          <span className="grow" />
          {leaks[0] && <a className="key sm" href="#/train/leak">Train {leaks[0].label.toLowerCase()}</a>}
        </div>
        {leaks.length === 0 ? (
          <p className="quiet measure">Once a few games are reviewed, this ranks the habits that cost you the most, from hanging pieces to time trouble.</p>
        ) : (
          <div className="panel panel-pad">
            {leaks.slice(0, 5).map((l) => (
              <div key={l.motif} className="leak-row">
                <span style={{ fontWeight: 650 }}>{l.label}</span>
                <span className="meter"><i style={{ width: `${Math.max(4, l.share * 100)}%` }} /></span>
                <span className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{Math.round(l.share * 100)}%</span>
              </div>
            ))}
            <p className="quiet t-small" style={{ marginTop: 10 }}>{leaks[0].tip}</p>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="t-2">Recent games</h2>
          <span className="faint t-small">
            {analyses.length} reviewed, {drills.length} mistakes saved, {mastered} mastered, {stats.drillsSolved} solved
          </span>
          <span className="grow" />
          <button className="key sm" onClick={() => syncGames()} disabled={syncing}>
            {syncing ? <span className="spin" /> : null} Check chess.com
          </button>
        </div>
        {syncErr && <p className="err" style={{ marginBottom: 10 }}>{syncErr}</p>}
        <div className="tape">
          {games.slice(0, 8).map((g) => (
            <TapeRow key={g.id} g={g} />
          ))}
          {!games.length && <p className="quiet">{syncing ? 'Fetching your games from chess.com…' : 'No games in the last two months yet.'}</p>}
        </div>
        {games.length > 8 && (
          <a className="key flat" href="#/games" style={{ marginTop: 10 }}>See all {games.length} games</a>
        )}
      </section>
    </div>
  );
}
