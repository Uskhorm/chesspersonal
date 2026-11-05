import { useIdleInput, useSlimAnalyses } from '../lib/queries';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { db } from '../lib/db';
import {
  accuracyTrend,
  biggestSwings,
  blundersByPiece,
  insightCards,
  performanceByTimeControl,
  ratingTrend,
  weeklySummary,
  type InsightCard,
} from '../lib/insights';
import { buildRepertoireAsync, openingDrills, openingLeaks, repertoireSummary, type Repertoire } from '../lib/repertoire';
import { emit } from '../lib/bus';
import { LineChart, WdlBar } from '../components/Chart';
import { Seg } from '../components/Seg';
import { PageSkeleton, Skeleton } from '../components/Skeleton';
import { enter, spring, staggerDelay } from '../components/motion';
import { cap, plainMove } from '../components/plain';

const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(d));
const signed = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`);
const SEV = {
  win: { color: 'var(--good-fill)', word: 'Going well' },
  warn: { color: 'var(--bad-fill)', word: 'Costing you' },
  info: { color: 'var(--accent)', word: 'Worth knowing' },
} as const;

export function Insights() {
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useSlimAnalyses();
  const drills = useLiveQuery(() => db.drills.toArray(), []);
  const [rep, setRep] = useState<Repertoire | null>(null);
  const [tc, setTc] = useState<string | null>(null);

  const input = useMemo(() => ({ games, analyses, drills }), [games, analyses, drills]);
  const idle = useIdleInput(input);
  useEffect(() => {
    let active = true;
    setRep(null);
    if (!idle?.games?.length || !idle.analyses) return;
    buildRepertoireAsync(idle.games, idle.analyses).then(value => { if (active) setRep(value); }).catch(() => { if (active) setRep(null); });
    return () => { active = false; };
  }, [idle]);

  const data = useMemo(() => {
    if (!idle?.games?.length || !idle.analyses || !idle.drills) return null;
    const { games, analyses, drills } = idle;
    const now = Date.now();
    return {
      cards: insightCards(games, analyses, drills, now),
      ratings: ratingTrend(games, now),
      acc: accuracyTrend(games, analyses),
      week: weeklySummary(games, analyses, now),
      tcs: performanceByTimeControl(games, analyses).filter((x) => x.games >= 3).sort((a, b) => b.games - a.games).slice(0, 5),
      pieces: blundersByPiece(games, analyses).filter((p) => p.blunders > 0),
      swings: biggestSwings(games, analyses, 5),
    };
  }, [idle]);

  const leaks = useMemo(() => (rep ? openingLeaks(rep).slice(0, 5) : []), [rep]);
  const summary = useMemo(() => (rep ? repertoireSummary(rep) : null), [rep]);
  const gameById = useMemo(() => new Map((games ?? []).map((g) => [g.id, g])), [games]);
  const analysisById = useMemo(() => new Map((analyses ?? []).map((a) => [a.gameId, a])), [analyses]);

  if (!idle || !games || !analyses || !drills) return <PageSkeleton />;
  if (!data) {
    return (
      <div className="page narrow">
        <h1 className="display t-1">Insights</h1>
        <div className="empty" style={{ marginTop: 20 }}>
          <h2>Nothing to analyse yet</h2>
          <p className="quiet">Your trends appear here once your games have synced from chess.com and a few have been reviewed.</p>
          <a className="btn primary" href="#/games">Go to your games</a>
        </div>
      </div>
    );
  }

  const series = data.ratings.filter((r) => r.points.length >= 2).sort((a, b) => b.points.length - a.points.length);
  const active = series.find((s) => s.timeClass === tc) ?? series[0];
  const w = data.week;
  const [lead, ...rest] = data.cards;

  const addOpeningDrills = async () => {
    if (!rep) return;
    const ds = openingDrills(rep);
    const existing = new Set(await db.drills.where('id').anyOf(ds.map((d) => d.id)).primaryKeys());
    const fresh = ds.filter((d) => !existing.has(d.id));
    await db.drills.bulkPut(fresh);
    emit({ type: 'toast', text: fresh.length ? `Added ${fresh.length} opening positions to your training.` : 'Your opening positions are already in training.', tone: 'good' });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display t-1">Insights</h1>
          <p className="faint t-small num" style={{ marginTop: 6 }}>
            From {games.length} games and {analyses.length} reviews
          </p>
        </div>
      </header>

      {lead && <LeadCard c={lead} />}

      {rest.length > 0 && (
        <div className="insights-grid" style={{ marginTop: 16 }}>
          {rest.map((c, i) => (
            <Card key={c.id} c={c} i={i} span={spanFor(i, rest.length)} total={rest.length} />
          ))}
        </div>
      )}

      <section className="section" aria-labelledby="week-h">
        <div className="section-head">
          <h2 id="week-h" className="t-2">This week</h2>
          <span className="faint t-small">compared with the same days last week</span>
        </div>
        <div className="card stat-strip">
          {[
            { label: 'games', v: fmt(w.thisWeek.games), d: w.delta.games, dd: 0 },
            { label: 'score', v: `${fmt(w.thisWeek.scorePercent)}%`, d: w.delta.scorePercent, dd: 0 },
            { label: 'accuracy', v: fmt(w.thisWeek.accuracy, 1), d: w.delta.accuracy, dd: 1 },
            { label: 'errors per 100 moves', v: fmt(w.thisWeek.errorsPer100, 1), d: w.delta.errorsPer100, dd: 1, invert: true },
          ].map((x) => {
            const good = x.d !== null && x.d !== undefined && x.d !== 0 ? (x.d > 0) !== !!x.invert : null;
            return (
              <div key={x.label}>
                <div className="display num">{x.v}</div>
                <p className="faint t-small">
                  {x.label}{' '}
                  {signed(x.d, x.dd) && good !== null && (
                    <span className={`delta ${good ? 'up' : 'down'}`}>{signed(x.d, x.dd)}</span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {active && (
        <section className="section" aria-labelledby="rating-h">
          <div className="section-head">
            <h2 id="rating-h" className="t-2">Rating</h2>
            <span className="grow" />
            {series.length > 1 && (
              <Seg
                label="Time control"
                value={active.timeClass}
                options={series.map((s) => [s.timeClass, cap(s.timeClass)] as const)}
                onChange={setTc}
              />
            )}
          </div>
          <div className="card card-pad">
            <LineChart key={active.timeClass} label={`${cap(active.timeClass)} rating`} points={active.points.map((p) => ({ t: p.time, v: p.value }))} baseline={active.points[0].value} />
            <p className="faint t-small" style={{ marginTop: 6 }}>
              Last 7 days <b className="num" style={{ color: 'var(--ink)' }}>{signed(active.delta7) || '–'}</b>, last 30 days <b className="num" style={{ color: 'var(--ink)' }}>{signed(active.delta30) || '–'}</b>. The dashed line is where this period started.
            </p>
          </div>
        </section>
      )}

      <div className="cols-even section">
        {data.acc.length > 2 && (
          <section className="card card-pad" aria-labelledby="acc-h">
            <h2 id="acc-h" className="t-3">Accuracy, five-game average</h2>
            <LineChart label="Accuracy, rolling five-game average" height={160} points={data.acc.map((p) => ({ t: p.time, v: p.rollingAverage }))} format={(v) => v.toFixed(0)} />
          </section>
        )}
        {data.tcs.length > 0 && (
          <section className="card card-pad" aria-labelledby="tc-h">
            <h2 id="tc-h" className="t-3">Results by time control</h2>
            <p className="faint t-small" style={{ marginBottom: 10 }}>Wins, draws and losses; the number is your score.</p>
            {data.tcs.map((x, i) => (
              <motion.div key={x.timeControl} className="hbar-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: staggerDelay(i, data.tcs.length) }}>
                <span className="lbl" style={{ textTransform: 'capitalize' }}>
                  {x.timeClass} <span className="faint num">{fmtTc(x.timeControl)}</span>
                </span>
                <WdlBar w={x.wins} d={x.draws} l={x.losses} />
                <span className="v">{Math.round(x.scorePercent)}%</span>
              </motion.div>
            ))}
            <div className="row t-tiny faint strong" style={{ gap: 14, marginTop: 10 }}>
              <span className="row" style={{ gap: 5 }}><span className="dot" style={{ background: 'var(--good-fill)' }} /> Won</span>
              <span className="row" style={{ gap: 5 }}><span className="dot" style={{ background: 'var(--ink-4)' }} /> Drew</span>
              <span className="row" style={{ gap: 5 }}><span className="dot" style={{ background: 'var(--bad-fill)' }} /> Lost</span>
            </div>
          </section>
        )}
        {data.pieces.length > 0 && (
          <section className="card card-pad" aria-labelledby="pc-h">
            <h2 id="pc-h" className="t-3">Which piece you blunder with</h2>
            <p className="faint t-small" style={{ marginBottom: 10 }}>The piece that made the losing move.</p>
            {data.pieces.map((p, i) => (
              <div key={p.piece} className="hbar-row">
                <span className="lbl">{cap(p.name)}</span>
                <span className="bar" style={{ height: 10, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
                  <motion.i
                    style={{ display: 'block', height: '100%', borderRadius: 3, background: i === 0 ? 'var(--c-blunder)' : 'var(--ink-3)', transformOrigin: 'left' }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: Math.max(0.02, p.percent / 100) }}
                    transition={{ ...spring.smooth, delay: staggerDelay(i, data.pieces.length) }}
                  />
                </span>
                <span className="v">{p.blunders}</span>
              </div>
            ))}
          </section>
        )}
        {data.swings.length > 0 && (
          <section className="card" aria-labelledby="sw-h" style={{ overflow: 'hidden' }}>
            <div className="card-head" style={{ paddingBottom: 8 }}>
              <h2 id="sw-h">Moments that swung games</h2>
            </div>
            {data.swings.map((s) => {
              const g = gameById.get(s.gameId);
              const m = analysisById.get(s.gameId)?.moves[s.ply - 1];
              return (
                <a key={`${s.gameId}:${s.ply}`} className="moment-row" href={`#/review/${encodeURIComponent(s.gameId)}`} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <span className="t">
                    {m ? cap(plainMove(m.fenBefore, m.san, g?.userColor, 'short').replace(/[+#]$/, '')) : s.san}
                    <span className="faint" style={{ fontWeight: 500, display: 'block', fontSize: 'var(--fs-12)' }}>
                      {g ? `against ${g.userColor === 'w' ? g.black.username : g.white.username}, ` : ''}move {Math.ceil(s.ply / 2)}
                    </span>
                  </span>
                  <span className="num t-small strong">
                    {Math.round(s.winBefore)}% <span className="faint">to</span> <span className="bad-text">{Math.round(s.winAfter)}%</span>
                  </span>
                </a>
              );
            })}
          </section>
        )}
      </div>

      <section className="section" aria-labelledby="op-h">
        <div className="section-head">
          <h2 id="op-h" className="t-2">Openings</h2>
          <span className="grow" />
          {leaks.length > 0 && (
            <button className="btn primary sm" onClick={addOpeningDrills}>
              Drill my opening mistakes
            </button>
          )}
        </div>
        {!summary ? (
          <div className="cols-even">
            <Skeleton h={220} r={14} />
            <Skeleton h={220} r={14} />
          </div>
        ) : (
          <div className="cols-even">
            {(['w', 'b'] as const).map((c) => (
              <div key={c} className="card card-pad">
                <h3 className="t-3 row" style={{ marginBottom: 8, gap: 8 }}>
                  <span className={`piece-dot ${c}`} /> As {c === 'w' ? 'White' : 'Black'}
                </h3>
                {summary[c].openings.slice(0, 6).map((o) => (
                  <div key={o.opening} className="hbar-row" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr) 64px' }}>
                    <span className="lbl" title={o.opening}>{o.opening}</span>
                    <WdlBar w={o.wins} d={o.draws} l={o.count - o.wins - o.draws} />
                    <span className="v">
                      {o.count ? Math.round((100 * (o.wins + o.draws / 2)) / o.count) : 0}% <span className="faint" style={{ fontWeight: 500 }}>{o.count}</span>
                    </span>
                  </div>
                ))}
                {summary[c].firstOutOfBook && (
                  <p className="faint t-small" style={{ marginTop: 10 }}>
                    You most often leave known theory on move {Math.ceil(summary[c].firstOutOfBook!.ply / 2)} ({summary[c].firstOutOfBook!.san}).
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {leaks.length > 0 && (
          <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
            <div className="card-head" style={{ paddingBottom: 8 }}>
              <h3>Habits that cost you in the opening</h3>
            </div>
            {leaks.map((l) => (
              <a key={l.epd} className="moment-row" href={`#/review/${encodeURIComponent(l.gameIds[0])}`} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span className="t">
                  In the {l.opening ?? 'opening'} you play {plainMove(l.fen, l.move.san, l.color, 'short').toLowerCase()}
                  {l.bestSan ? <span className="faint" style={{ fontWeight: 500 }}>; the engine prefers {plainMove(l.fen, l.bestSan, l.color, 'short').toLowerCase()}</span> : null}
                </span>
                <span className="faint t-small num">
                  {l.move.count} games, {Math.round(l.scorePct)}%
                </span>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function fmtTc(tc: string) {
  const [base, inc] = tc.split('+').map(Number);
  if (!Number.isFinite(base)) return tc;
  const m = base >= 60 ? `${Math.round(base / 60)} min` : `${base} s`;
  return inc ? `${m} + ${inc}` : m;
}

function Trend({ t }: { t?: 'up' | 'down' | 'flat' }) {
  if (!t) return null;
  const I = t === 'up' ? TrendingUp : t === 'down' ? TrendingDown : Minus;
  return (
    <span className="trend faint">
      <I />
    </span>
  );
}

function LeadCard({ c }: { c: InsightCard }) {
  const sev = SEV[c.severity];
  return (
    <motion.div {...enter} className="card insight-lead">
      <div className="stack" style={{ gap: 10 }}>
        <span className="row strong t-small" style={{ gap: 8, color: 'var(--ink-2)' }}>
          <span className="dot" style={{ background: sev.color }} /> {sev.word}
        </span>
        <h2 className="display" style={{ fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', maxWidth: '22ch' }}>{c.title}</h2>
        <p className="quiet measure" style={{ fontSize: 'var(--fs-16)' }}>{c.body}</p>
        {c.cta && (
          <a className="btn go" href={c.cta.href} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
            {c.cta.label} <ArrowRight />
          </a>
        )}
      </div>
      {c.metric && (
        <div style={{ textAlign: 'right' }}>
          <div className="display metric num">{c.metric.value}</div>
          <p className="faint t-small row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            {c.metric.label} <Trend t={c.metric.trend} />
          </p>
        </div>
      )}
    </motion.div>
  );
}

/** Two wide cards lead, then rows of three; the last row stretches so the grid never ends ragged. */
function spanFor(i: number, n: number): number {
  const lead = n >= 4 ? 2 : n % 2 === 0 ? n : n - 1;
  if (i < lead) return 3;
  const m = n - lead;
  const j = i - lead;
  const tail = m % 3;
  if (tail === 1 && j === m - 1) return 6;
  if (tail === 2 && j >= m - 2) return 3;
  return 2;
}

function Card({ c, i, span, total }: { c: InsightCard; i: number; span: number; total: number }) {
  const sev = SEV[c.severity];
  return (
    <motion.article className="card insight" style={{ ['--span' as string]: span }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: staggerDelay(i, total) }}>
      <span className="sev" style={{ color: 'var(--ink-3)' }}>
        <span className="dot" style={{ background: sev.color }} /> {sev.word}
      </span>
      {c.metric && (
        <div className="metric">
          <span className="display num">{c.metric.value}</span>
          <span className="faint t-small">{c.metric.label}</span>
          <Trend t={c.metric.trend} />
        </div>
      )}
      <h3>{c.title}</h3>
      <p>{c.body}</p>
      {c.cta && (
        <a className="btn sm" href={c.cta.href}>
          {c.cta.label}
        </a>
      )}
    </motion.article>
  );
}
