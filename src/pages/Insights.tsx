import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import {
  accuracyTrend,
  biggestSwings,
  clockUsage,
  comebackRate,
  conversionRate,
  errorRates,
  focusRecommendation,
  progressScore,
  ratingTrend,
  weeklySummary,
} from '../lib/insights';
import { buildRepertoireAsync, openingDrills, openingLeaks, repertoireSummary, type Repertoire } from '../lib/repertoire';
import { emit } from '../lib/bus';

const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(d));
const signed = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? '' : `${n > 0 ? '+' : ''}${n.toFixed(d)}`);

export function Insights() {
  const games = useLiveQuery(() => db.games.toArray(), []) ?? [];
  const analyses = useLiveQuery(() => db.analyses.toArray(), []) ?? [];
  const drills = useLiveQuery(() => db.drills.toArray(), []) ?? [];
  const [rep, setRep] = useState<Repertoire | null>(null);
  const [tc, setTc] = useState<string | null>(null);
  const now = Date.now();

  useEffect(() => {
    if (!games.length) return;
    buildRepertoireAsync(games, analyses).then(setRep).catch(() => setRep(null));
  }, [games.length, analyses.length]);

  const data = useMemo(() => {
    if (!games.length) return null;
    return {
      ratings: ratingTrend(games, now),
      acc: accuracyTrend(games, analyses),
      week: weeklySummary(games, analyses, now),
      clock: clockUsage(games, analyses),
      conv: conversionRate(games, analyses),
      comeback: comebackRate(games, analyses),
      errors: errorRates(games, analyses),
      focus: focusRecommendation(games, analyses, drills),
      score: progressScore(games, analyses, drills, now),
      swings: biggestSwings(games, analyses, 6),
    };
  }, [games, analyses, drills]);

  const leaks = useMemo(() => (rep ? openingLeaks(rep).slice(0, 6) : []), [rep]);
  const summary = useMemo(() => (rep ? repertoireSummary(rep) : null), [rep]);

  if (!data) {
    return (
      <div className="page narrow">
        <h1 className="display t-1">Insights</h1>
        <p className="quiet" style={{ marginTop: 10 }}>Your trends appear here once your games have synced from chess.com.</p>
      </div>
    );
  }

  const series = data.ratings.filter((r) => r.points.length >= 2).sort((a, b) => b.points.length - a.points.length);
  const active = series.find((s) => s.timeClass === tc) ?? series[0];
  const focusHref = data.focus.kind === 'review' ? '#/games' : data.focus.kind === 'opening' ? '#/insights' : '#/train/leak';
  const w = data.week;

  const addOpeningDrills = async () => {
    if (!rep) return;
    const ds = openingDrills(rep);
    const existing = new Set(await db.drills.where('id').anyOf(ds.map((d) => d.id)).primaryKeys());
    const fresh = ds.filter((d) => !existing.has(d.id));
    await db.drills.bulkPut(fresh);
    emit({ type: 'toast', text: fresh.length ? `Added ${fresh.length} opening positions to your training.` : 'Your opening positions are already in training.', emoji: '✓', tone: 'good' });
  };

  return (
    <div className="page">
      <header className="today" style={{ marginBottom: 8 }}>
        <div>
          <h1 className="display t-1">Insights</h1>
          <p className="quiet measure" style={{ marginTop: 8 }}>
            Built from {games.length} games and {analyses.length} reviews. The point is one thing to fix next, not a wall of stats.
          </p>
        </div>
        <div className="panel panel-pad">
          <div className="goal">
            <div className="grow">
              <h2 className="t-3">Improvement score</h2>
              <p className="quiet t-small">Accuracy gains, fewer errors and drill success, combined.</p>
            </div>
            <span className="display num" style={{ fontSize: 56 }}>{Math.round(data.score)}</span>
          </div>
          <div className="meter" style={{ marginTop: 10 }}><i style={{ width: `${data.score}%`, background: 'var(--gold)' }} /></div>
        </div>
      </header>

      <section className="section">
        <div className="stage" style={{ padding: 26 }}>
          <p style={{ opacity: 0.7 }}>Your next focus</p>
          <h2 className="display" style={{ fontSize: 'clamp(30px, 3.2vw, 44px)', margin: '6px 0 10px', maxWidth: '22ch' }}>{data.focus.title}</h2>
          <p className="measure" style={{ opacity: 0.85, fontSize: 17 }}>{data.focus.reason}</p>
          <div className="on-stage" style={{ marginTop: 18 }}>
            <a className="key go big" href={focusHref}>Start on it</a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="t-2">This week</h2><span className="faint t-small">compared with the same days last week</span></div>
        <div className="panel versus" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {[
            { label: 'games', v: fmt(w.thisWeek.games), d: signed(w.delta.games) },
            { label: 'score', v: `${fmt(w.thisWeek.scorePercent)}%`, d: signed(w.delta.scorePercent) },
            { label: 'accuracy', v: fmt(w.thisWeek.accuracy, 1), d: signed(w.delta.accuracy, 1) },
            { label: 'errors per 100 moves', v: fmt(w.thisWeek.errorsPer100, 1), d: signed(w.delta.errorsPer100, 1), invert: true },
          ].map((x, i) => (
            <div key={x.label} style={i ? { borderLeft: '1px solid var(--rule)' } : undefined}>
              <div className="display num" style={{ fontSize: 48 }}>{x.v}</div>
              <p className="quiet t-small">{x.label} {x.d && <b className="num" style={{ color: (x.d.startsWith('+') ? !x.invert : !!x.invert) ? 'var(--c-best)' : 'var(--c-blunder)' }}>{x.d}</b>}</p>
            </div>
          ))}
        </div>
      </section>

      {active && (
        <section className="section">
          <div className="section-head">
            <h2 className="t-2">Rating</h2>
            <div className="chips">
              {series.map((s) => (
                <button key={s.timeClass} className={`chip ${s === active ? 'on' : ''}`} onClick={() => setTc(s.timeClass)} style={{ textTransform: 'capitalize' }}>{s.timeClass}</button>
              ))}
            </div>
          </div>
          <div className="panel panel-pad">
            <RatingChart points={active.points.map((p) => p.value)} />
            <p className="quiet t-small" style={{ marginTop: 8 }}>
              Last 7 days <b className="num">{signed(active.delta7) || '–'}</b>, last 30 days <b className="num">{signed(active.delta30) || '–'}</b>.
            </p>
          </div>
        </section>
      )}

      <section className="section today">
        <div className="plain">
          <h2 className="t-3">Clock</h2>
          <p className="quiet t-small" style={{ marginBottom: 12 }}>How your time management turns into mistakes.</p>
          <Stat label="of your errors happen in time trouble" value={`${fmt(data.clock.timeTroublePercent)}%`} />
          <Stat label="of your errors are played in under 3 seconds" value={`${fmt(data.clock.rushingPercent)}%`} />
          {(['opening', 'middlegame', 'endgame'] as const).map((p) => (
            <Stat key={p} label={`seconds per move in the ${p}`} value={fmt(data.clock.byPhase[p].average, 1)} />
          ))}
        </div>
        <div className="plain">
          <h2 className="t-3">Converting and saving games</h2>
          <p className="quiet t-small" style={{ marginBottom: 12 }}>Winning positions you won, and lost positions you saved.</p>
          <Stat label={`of ${data.conv.opportunities} winning positions converted`} value={`${fmt(data.conv.percent)}%`} />
          <Stat label={`of ${data.comeback.opportunities} lost positions saved`} value={`${fmt(data.comeback.percent)}%`} />
          <Stat label="blunders per 100 moves" value={fmt(data.errors.blundersPer100, 1)} />
          <Stat label="mistakes per 100 moves" value={fmt(data.errors.mistakesPer100, 1)} />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="t-2">Openings</h2>
          <span className="grow" />
          {leaks.length > 0 && <button className="key ink sm" onClick={addOpeningDrills}>Drill my opening mistakes</button>}
        </div>
        {!summary ? (
          <p className="quiet"><span className="spin" /> Building your repertoire…</p>
        ) : (
          <div className="today">
            {(['w', 'b'] as const).map((c) => (
              <div key={c} className="panel panel-pad">
                <h3 className="t-3" style={{ marginBottom: 8 }}>As {c === 'w' ? 'White' : 'Black'}</h3>
                {summary[c].openings.slice(0, 6).map((o) => {
                  const pct = o.count ? Math.round((100 * (o.wins + o.draws / 2)) / o.count) : 0;
                  return (
                    <div key={o.opening} className="leak-row" style={{ gridTemplateColumns: 'minmax(0,1fr) 90px 44px' }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.opening}>{o.opening}</span>
                      <span className="meter"><i style={{ width: `${pct}%`, background: pct >= 50 ? 'var(--ink)' : 'var(--c-mistake)' }} /></span>
                      <span className="num t-small" style={{ textAlign: 'right' }}>{pct}% <span className="faint">({o.count})</span></span>
                    </div>
                  );
                })}
                {summary[c].firstOutOfBook && (
                  <p className="quiet t-small" style={{ marginTop: 10 }}>
                    You most often leave known theory with <b>{summary[c].firstOutOfBook!.san}</b> on move {Math.ceil(summary[c].firstOutOfBook!.ply / 2)}.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {leaks.length > 0 && (
          <div className="panel panel-pad" style={{ marginTop: 16 }}>
            <h3 className="t-3" style={{ marginBottom: 6 }}>Habits that cost you in the opening</h3>
            {leaks.map((l) => (
              <a key={l.epd} className="bank-row" href={`#/review/${encodeURIComponent(l.gameIds[0])}`} style={{ gridTemplateColumns: '1fr auto' }}>
                <span>
                  {l.opening ?? 'Opening'}: you play <b>{l.move.san}</b> as {l.color === 'w' ? 'White' : 'Black'}
                  {l.bestSan ? <>, the engine prefers <b>{l.bestSan}</b></> : null}
                </span>
                <span className="faint t-small num">{l.move.count} games, {Math.round(l.scorePct)}%</span>
              </a>
            ))}
          </div>
        )}
      </section>

      {data.swings.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="t-2">Moments that swung games</h2></div>
          <div className="panel panel-pad">
            {data.swings.map((s) => (
              <a key={`${s.gameId}:${s.ply}`} className="bank-row" href={`#/review/${encodeURIComponent(s.gameId)}`} style={{ gridTemplateColumns: '80px 1fr auto' }}>
                <b className="num">{Math.ceil(s.ply / 2)}{s.ply % 2 ? '.' : '…'} {s.san}</b>
                <span className="quiet">winning chances {Math.round(s.winBefore)}% → {Math.round(s.winAfter)}%</span>
                <span className="due num">−{Math.round(s.epLoss * 100)}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {data.acc.length > 2 && (
        <p className="faint t-small" style={{ marginTop: 28 }}>
          Your rolling accuracy is {fmt(data.acc[data.acc.length - 1].rollingAverage, 1)} over the last five reviewed games.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--rule)', gap: 14 }}>
      <span className="display num" style={{ fontSize: 30, minWidth: 74 }}>{value}</span>
      <span className="quiet">{label}</span>
    </div>
  );
}

function RatingChart({ points }: { points: number[] }) {
  const W = 800;
  const H = 180;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const pad = Math.max(10, (max - min) * 0.1);
  const lo = min - pad;
  const hi = max + pad;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 180, display: 'block' }} role="img" aria-label={`Rating from ${points[0]} to ${last}`}>
        <line x1="0" x2={W} y1={y(points[0])} y2={y(points[0])} stroke="var(--rule-2)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span className="faint num t-small">{points[0]}</span>
        <span className="display num" style={{ fontSize: 34 }}>{last}</span>
      </div>
    </div>
  );
}
