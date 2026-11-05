import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Check, RefreshCw } from 'lucide-react';
import { db } from '../lib/db';
import { useStore } from '../lib/store';
import { computeLeaks } from '../lib/learning';
import { syncGames, useQueue } from '../lib/sync';
import { useDrillStats, useRecentGames, useSummaries, useTodayActivity } from '../lib/queries';
import { recovery } from '../lib/insights';
import type { FsrsDrill } from '../lib/srs';
import { Board } from '../components/Board';
import { GameRow } from '../components/GameRow';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { DAILY_GOAL } from '../components/constants';
import { Skeleton } from '../components/Skeleton';
import { Ticker } from '../components/Ticker';
import { playedPhrase } from '../components/plain';
import { enter, spring, staggerDelay } from '../components/motion';

const dateLine = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export function Home() {
  const quests = useStore((s) => s.quests);
  const games = useRecentGames(30);
  const recent = games.slice(0, 6);
  const ids = useMemo(() => recent.map((g) => g.id), [recent.map((g) => g.id).join()]);
  const summaries = useSummaries(ids);
  const sumById = useMemo(() => new Map(summaries.map((s) => [s.gameId, s])), [summaries]);
  const stats = useDrillStats();
  const act = useTodayActivity();
  const focus = useLiveQuery(() => db.drills.where('due').below(Date.now()).sortBy('due').then((d) => d[0]), [stats.due]);
  // Habits from your recent reviewed games only; never loads every analysis on this page.
  const analysedIds = useMemo(() => games.filter((g) => g.analysed).slice(0, 20).map((g) => g.id), [games]);
  const recentAnalyses = useLiveQuery(() => db.analyses.where('gameId').anyOf(analysedIds).toArray(), [analysedIds.join()]);
  const leaks = useMemo(() => (recentAnalyses ? computeLeaks(games, recentAnalyses).filter((l) => l.motif !== 'opening' && l.motif !== 'endgame') : null), [games, recentAnalyses]);
  const drills = useLiveQuery(() => db.drills.toArray(), [stats.total]);
  const rec = useMemo(() => (drills && recentAnalyses ? recovery(drills as FsrsDrill[], recentAnalyses) : null), [drills, recentAnalyses]);
  const syncing = useQueue((s) => s.syncing);
  const syncErr = useQueue((s) => s.error);
  const q = useQueue();
  const xpToday = act?.xp ?? 0;
  const loaded = act !== undefined;
  const unreviewed = games.find((g) => g.analysed && !localStorage.getItem(`reviewed:${g.id}`));
  const importing = (games.length === 0 && syncing) || (!games.some((g) => g.analysed) && (!!q.current || q.queued.length > 0));

  const title = !loaded ? null : stats.due > 0 ? `${stats.due} mistake${stats.due > 1 ? 's' : ''} to fix` : unreviewed ? 'A game to review' : importing ? 'Getting your games ready' : 'All caught up';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="faint strong t-small">{dateLine()}</p>
          {title ? <motion.h1 {...enter} className="display t-1" style={{ marginTop: 6 }}>{title}</motion.h1> : <Skeleton h={48} w={340} style={{ marginTop: 6 }} />}
        </div>
        <span className="grow" />
        {rec && rec.mastered > 0 && (
          <p className="recovered">
            <Ticker className="display" value={rec.mastered} /> mistakes retired for good
          </p>
        )}
      </header>

      <div className="today-grid">
        {importing ? (
          <SetupCard games={games.length} />
        ) : focus ? (
          <motion.a {...enter} className="card focus-card" href="#/train/session">
            <div className="mini">
              <Board fen={focus.fen} orientation={focus.color === 'w' ? 'white' : 'black'} coordinates={false} still />
            </div>
            <div className="stack" style={{ gap: 14 }}>
              <span className="chip" style={{ alignSelf: 'flex-start' }}>
                <ClassIcon cls={focus.cls} size={14} /> {CLASS_LABEL[focus.cls]} against {focus.opponent}
              </span>
              <p className="t-lead">
                You {playedPhrase(focus.fen, focus.playedSan)} here. There was something much better.
              </p>
              <p className="faint t-small">
                {stats.due} position{stats.due === 1 ? '' : 's'} from your games {stats.due === 1 ? 'is' : 'are'} due. About {Math.max(2, Math.round(Math.min(stats.due, 10) * 0.6))} minutes.
              </p>
              <span className="btn go lg" style={{ alignSelf: 'flex-start' }}>
                Start training <ArrowRight />
              </span>
            </div>
          </motion.a>
        ) : unreviewed ? (
          <motion.a {...enter} className="card focus-card" href={`#/review/${encodeURIComponent(unreviewed.id)}/learn`} style={{ gridTemplateColumns: '1fr' }}>
            <div className="stack" style={{ gap: 14 }}>
              <p className="t-lead strong">Your game against {unreviewed.userColor === 'w' ? unreviewed.black.username : unreviewed.white.username} is reviewed.</p>
              <p className="quiet">Replay the moments that cost you and find the moves you missed. Anything you get wrong comes back later as a drill.</p>
              <span className="btn go lg" style={{ alignSelf: 'flex-start' }}>
                Learn from this game <ArrowRight />
              </span>
            </div>
          </motion.a>
        ) : loaded ? (
          <motion.div {...enter} className="card focus-card" style={{ gridTemplateColumns: '1fr' }}>
            <div className="stack" style={{ gap: 14 }}>
              <p className="t-lead strong">Nothing is due right now.</p>
              <p className="quiet">Play a game on chess.com. Hindsight picks it up within a minute of the last move and reviews it for you.</p>
              <div className="row">
                <a className="btn primary" href="https://www.chess.com/play/online" target="_blank" rel="noreferrer">Play on chess.com</a>
                <a className="btn" href="#/train/rush">Blunder Rush</a>
              </div>
            </div>
          </motion.div>
        ) : (
          <Skeleton h={260} r={14} />
        )}

        <section className="card card-pad" aria-labelledby="today-h">
          <div className="row nowrap" style={{ gap: 16 }}>
            <GoalRing value={xpToday} goal={DAILY_GOAL} />
            <div className="grow">
              <h2 id="today-h" className="t-3">Today</h2>
              <p className="faint t-small">{xpToday >= DAILY_GOAL ? 'Daily goal reached. Your streak is safe.' : `${DAILY_GOAL - xpToday} XP to your daily goal.`}</p>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {quests.list.map((x, i) => (
              <motion.div key={x.id} className={`quest ${x.done ? 'done' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: staggerDelay(i, 3) }}>
                <motion.span className="box" aria-hidden="true" animate={x.done ? { scale: [0.8, 1] } : {}} transition={spring.pop}>
                  {x.done && <Check strokeWidth={3.5} />}
                </motion.span>
                <span className="q-label">
                  {x.label}
                  {!x.done && x.target > 1 && (
                    <span className="qmeter" aria-hidden="true">
                      <i style={{ transform: `scaleX(${Math.min(1, x.progress / x.target)})` }} />
                    </span>
                  )}
                </span>
                <span className="reward num">{!x.done && x.target > 1 ? `${x.progress}/${x.target}` : `+${x.reward}`}</span>
              </motion.div>
            ))}
          </div>
          <p className="faint t-tiny" style={{ marginTop: 6 }}>Finish all three for a chest.</p>
        </section>
      </div>

      <section className="section" aria-labelledby="leaks-h">
        <div className="section-head">
          <h2 id="leaks-h" className="t-2">Where your points go</h2>
          <span className="faint t-small">across your last {analysedIds.length || 'few'} reviewed games</span>
          <span className="grow" />
          {leaks?.[0] && (
            <a className="btn sm" href="#/train/leak">
              Train {leaks[0].label.toLowerCase()}
            </a>
          )}
        </div>
        {leaks === null ? (
          <Skeleton h={180} r={14} />
        ) : leaks.length === 0 ? (
          <p className="quiet measure">Once a few games are reviewed, this ranks the habits that cost you the most, from hanging pieces to time trouble.</p>
        ) : (
          <div className="card card-pad">
            {leaks.slice(0, 5).map((l, i) => (
              <div key={l.motif} className={`leak-row ${i === 0 ? 'top' : ''}`}>
                <span className="strong">{l.label}</span>
                <span className="bar" aria-hidden="true">
                  <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.03, l.share) }} transition={{ ...spring.smooth, delay: staggerDelay(i, 5) }} style={{ width: '100%' }} />
                </span>
                <span className="num strong" style={{ textAlign: 'right' }}>{Math.round(l.share * 100)}%</span>
              </div>
            ))}
            <p className="quiet t-small" style={{ marginTop: 12 }}>{leaks[0].tip}</p>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="recent-h">
        <div className="section-head">
          <h2 id="recent-h" className="t-2">Recent games</h2>
          <span className="faint t-small">
            {stats.total} mistakes saved, {stats.mastered} mastered
          </span>
          <span className="grow" />
          <button className="btn sm ghost" onClick={() => syncGames()} disabled={syncing}>
            {syncing ? <span className="spinner" /> : <RefreshCw />} Check chess.com
          </button>
        </div>
        {syncErr && <p className="err" style={{ marginBottom: 10 }}>{syncErr}</p>}
        <div>
          {recent.map((g, i) => (
            <motion.div key={g.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: staggerDelay(i, recent.length) }}>
              <GameRow g={g} summary={sumById.get(g.id)} />
            </motion.div>
          ))}
          {!games.length && (syncing ? [0, 1, 2].map((i) => <Skeleton key={i} h={64} r={10} style={{ marginBottom: 6 }} />) : <p className="quiet">No games in the last two months yet.</p>)}
        </div>
        {games.length > 6 && (
          <a className="btn ghost" href="#/games" style={{ marginTop: 8 }}>
            See all games <ArrowRight />
          </a>
        )}
      </section>
    </div>
  );
}

function GoalRing({ value, goal }: { value: number; goal: number }) {
  const R = 32;
  const C = 2 * Math.PI * R;
  const f = Math.min(1, value / goal);
  return (
    <div className="goal-ring" role="img" aria-label={`${Math.min(value, goal)} of ${goal} XP today`}>
      <svg viewBox="0 0 76 76" aria-hidden="true">
        <circle className="t" cx="38" cy="38" r={R} fill="none" strokeWidth="7" />
        <circle className="f" cx="38" cy="38" r={R} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - f)} />
      </svg>
      <span className="c display num">{f >= 1 ? <Check strokeWidth={3} color="var(--gold-ink)" /> : <Ticker value={value} />}</span>
    </div>
  );
}

function SetupCard({ games }: { games: number }) {
  const q = useQueue();
  const total = Math.max(1, Math.min(10, q.batchTotal || 10));
  const done = q.batchDone;
  const pct = q.current && q.total ? Math.round((q.done / q.total) * 100) : 0;
  return (
    <motion.div {...enter} className="card setup-card" aria-live="polite">
      <p className="label">Setting up</p>
      <h2 className="display" style={{ fontSize: 'var(--fs-38)', margin: '8px 0 6px' }}>
        {games === 0 ? 'Fetching your games from chess.com' : `Reviewing your last ${total} games`}
      </h2>
      <p className="quiet">
        {games === 0
          ? 'This takes a few seconds.'
          : `${games} games found. Stockfish is going through your most recent ones on this device; every mistake becomes a position to train.`}
      </p>
      <div className="setup-ticks" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={games === 0 ? '' : i < done ? 'done' : ''}>
            {games > 0 && i === done && <b className="tick-fill" style={{ transform: `scaleX(${Math.max(0.04, pct / 100)})` }} />}
          </i>
        ))}
      </div>
      {games > 0 && (
        <p className="faint t-small num" style={{ marginTop: 10 }}>
          Game {Math.min(done + 1, total)} of {total}, {pct}% through
        </p>
      )}
    </motion.div>
  );
}
