import { useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { db } from '../lib/db';
import { useStore } from '../lib/store';
import { computeLeaks } from '../lib/learning';
import { GameCard } from '../components/GameCard';
import { countUp, staggerIn } from '../lib/fx';
import { selfOf } from '../lib/chesscom';
import { isMastered } from '../lib/srs';
import { syncGames, useQueue } from '../lib/sync';

export function Home() {
  const { displayName, username, quests, ensureDay } = useStore();
  const games = useLiveQuery(() => db.games.orderBy('endTime').reverse().toArray(), []) ?? [];
  const analyses = useLiveQuery(() => db.analyses.toArray(), []) ?? [];
  const drills = useLiveQuery(() => db.drills.toArray(), []) ?? [];
  const syncing = useQueue((s) => s.syncing);
  const syncErr = useQueue((s) => s.error);

  useEffect(() => ensureDay(), [ensureDay]);
  useEffect(() => {
    staggerIn(document.querySelectorAll('.home .card'), 60);
  }, []);

  const due = drills.filter((d) => d.due <= Date.now()).length;
  const mastered = drills.filter(isMastered).length;
  const latestUnreviewed = games.find((g) => g.analysed);
  const leaks = useMemo(() => computeLeaks(games, analyses).filter((l) => l.motif !== 'opening' && l.motif !== 'endgame'), [games, analyses]);
  const topLeak = leaks[0];

  let cta: { title: string; sub: string; href: string; emoji: string };
  if (due > 0) cta = { title: `Fix ${due} of your mistakes`, sub: `≈ ${Math.max(1, Math.round(due * 0.4))} min · spaced repetition`, href: '#/train/session', emoji: '🧠' };
  else if (latestUnreviewed) cta = { title: 'Review your latest game', sub: 'Learn mode: find better moves yourself', href: `#/review/${encodeURIComponent(latestUnreviewed.id)}/learn`, emoji: '🔍' };
  else if (topLeak) cta = { title: `Train: ${topLeak.label}`, sub: 'Targeted puzzles for your #1 leak', href: `#/train/leak`, emoji: topLeak.emoji };
  else cta = { title: 'Play a game on chess.com', sub: "It'll be reviewed automatically when you finish", href: 'https://www.chess.com/play/online', emoji: '♟️' };

  return (
    <div className="home">
      <section className="home-hero card">
        <div>
          <div className="eyebrow">WELCOME BACK</div>
          <h1 className="h1">Hey {displayName?.split(' ')[0] || username} 👋</h1>
          <p className="muted">
            {games.length} games synced · {analyses.length} reviewed · {drills.length} mistakes captured · {mastered} mastered
            {syncing && ' · syncing…'}
            {syncErr && <span className="err"> · {syncErr}</span>}
          </p>
        </div>
        <motion.a href={cta.href} target={cta.href.startsWith('http') ? '_blank' : undefined} className="cta" whileHover={{ scale: 1.03, rotate: -0.5 }} whileTap={{ scale: 0.96 }}>
          <span className="cta-emoji">{cta.emoji}</span>
          <span>
            <span className="cta-title">{cta.title}</span>
            <span className="cta-sub">{cta.sub}</span>
          </span>
          <span className="cta-arrow">→</span>
        </motion.a>
      </section>

      <div className="home-grid">
        <section className="card quests">
          <div className="card-head">
            <h2>Daily quests</h2>
            <span className="muted">reset at midnight · finish all 3 for a chest</span>
          </div>
          {quests.list.map((q) => (
            <div key={q.id} className={`quest ${q.done ? 'done' : ''}`}>
              <div className="quest-top">
                <span>{q.done ? '✅' : '◻️'} {q.label}</span>
                <span className="mono xp-tag">+{q.reward}</span>
              </div>
              <div className="bar">
                <motion.div className="bar-fill" initial={{ width: 0 }} animate={{ width: `${(q.progress / q.target) * 100}%` }} transition={{ type: 'spring', stiffness: 80, damping: 15 }} />
              </div>
              <div className="muted mono small">{q.progress}/{q.target}</div>
            </div>
          ))}
        </section>

        <section className="card leaks">
          <div className="card-head">
            <h2>Your Elo leaks</h2>
            <span className="muted">where your points actually go</span>
          </div>
          {leaks.length === 0 && <p className="muted">Review a few games and your personal weakness report shows up here.</p>}
          {leaks.slice(0, 5).map((l, i) => (
            <div key={l.motif} className="leak">
              <div className="leak-top">
                <span className="leak-name">{l.emoji} {l.label}</span>
                <span className="mono muted">{(l.share * 100).toFixed(0)}%</span>
              </div>
              <div className="bar">
                <motion.div className="bar-fill leak-fill" initial={{ width: 0 }} animate={{ width: `${l.share * 100}%` }} transition={{ delay: 0.2 + i * 0.08, type: 'spring', stiffness: 70, damping: 14 }} />
              </div>
              {i === 0 && (
                <div className="leak-tip">
                  💡 {l.tip}{' '}
                  <a className="link" href="#/train/leak">Train it →</a>
                </div>
              )}
            </div>
          ))}
        </section>

        <RatingCard />
        <StatsCard due={due} total={drills.length} mastered={mastered} />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Latest games</h2>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => syncGames()} disabled={syncing}>
            {syncing ? <span className="spinner" /> : '↻'} Sync
          </button>
          <a className="btn ghost" href="#/games">All games</a>
        </div>
        <div className="game-grid">
          {games.slice(0, 8).map((g, i) => (
            <GameCard key={g.id} g={g} i={i} />
          ))}
          {!games.length && <p className="muted">{syncing ? 'Fetching your games from chess.com…' : 'No games found in the last two months.'}</p>}
        </div>
      </section>
    </div>
  );
}

function StatsCard({ due, total, mastered }: { due: number; total: number; mastered: number }) {
  const a = useRef<HTMLSpanElement>(null);
  const b = useRef<HTMLSpanElement>(null);
  const c = useRef<HTMLSpanElement>(null);
  const stats = useStore((s) => s.stats);
  useEffect(() => {
    countUp(a.current, due);
    countUp(b.current, mastered);
    countUp(c.current, stats.drillsSolved);
  }, [due, mastered, stats.drillsSolved]);
  return (
    <section className="card stats">
      <div className="card-head">
        <h2>Mistake bank</h2>
      </div>
      <div className="stat-row">
        <div className="stat">
          <span ref={a} className="stat-num mono" style={{ color: '#ff9a3c' }}>0</span>
          <span className="muted">due now</span>
        </div>
        <div className="stat">
          <span ref={b} className="stat-num mono" style={{ color: '#7fc241' }}>0</span>
          <span className="muted">mastered</span>
        </div>
        <div className="stat">
          <span ref={c} className="stat-num mono" style={{ color: '#5b8def' }}>0</span>
          <span className="muted">solved</span>
        </div>
      </div>
      <div className="bar thick">
        <motion.div className="bar-fill mastery" initial={{ width: 0 }} animate={{ width: `${total ? (mastered / total) * 100 : 0}%` }} />
      </div>
      <p className="muted small">A mistake is mastered once you've recalled it correctly over a 3-week interval.</p>
      <div className="row gap">
        <a href="#/train/session" className="btn primary">Train now</a>
        <a href="#/train/rush" className="btn">⚡ Blunder Rush</a>
      </div>
    </section>
  );
}

function RatingCard() {
  const games = useLiveQuery(() => db.games.orderBy('endTime').toArray(), []) ?? [];
  const byClass = new Map<string, number>();
  for (const g of games) byClass.set(g.timeClass, (byClass.get(g.timeClass) ?? 0) + 1);
  const tc = [...byClass.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const series = games.filter((g) => g.timeClass === tc && g.rated).map((g) => ({ r: selfOf(g).rating, acc: g.userAccuracy }));
  const W = 320;
  const H = 110;
  if (series.length < 2)
    return (
      <section className="card">
        <div className="card-head"><h2>Rating</h2></div>
        <p className="muted">Play a few rated games to see your trend.</p>
      </section>
    );
  const min = Math.min(...series.map((s) => s.r)) - 10;
  const max = Math.max(...series.map((s) => s.r)) + 10;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (r: number) => H - ((r - min) / (max - min)) * H;
  const path = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.r).toFixed(1)}`).join(' ');
  const last = series[series.length - 1].r;
  const first = series[0].r;
  const delta = last - first;
  return (
    <section className="card rating">
      <div className="card-head">
        <h2>{tc} rating</h2>
        <span className="spacer" />
        <span className={`mono delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}</span>
      </div>
      <div className="rating-big mono">{last}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="spark">
        <defs>
          <linearGradient id="rg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#5b8def" stopOpacity=".45" />
            <stop offset="100%" stopColor="#5b8def" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#rg)" />
        <motion.path d={path} fill="none" stroke="#5b8def" strokeWidth="2.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: 'easeOut' }} />
        <circle cx={x(series.length - 1)} cy={y(last)} r="4" fill="#ffd34d" />
      </svg>
      <p className="muted small">Last {series.length} rated {tc} games (from your synced history).</p>
    </section>
  );
}
