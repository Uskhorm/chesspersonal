import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, bumpActivity } from '../lib/db';
import { computeLeaks } from '../lib/learning';
import { dueLabel, isMastered } from '../lib/srs';
import { useTrainSession, type TrainMode, type TrainResult, type TrainSummary } from '../lib/trainflow';
import { useStore } from '../lib/store';
import { Board } from '../components/Board';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { burst, confettiBurst, countUp, flash, pop, shake } from '../lib/fx';
import { sfx } from '../lib/sound';
import { dueForecast } from '../lib/insights';

export function Train({ mode }: { mode?: string }) {
  const [run, setRun] = useState(0);
  if (mode === 'session' || mode === 'leak' || mode === 'rush') return <Runner key={mode + run} mode={mode} onAgain={() => setRun((r) => r + 1)} />;
  return <TrainHome />;
}

function TrainHome() {
  const drills = useLiveQuery(() => db.drills.toArray(), []) ?? [];
  const games = useLiveQuery(() => db.games.toArray(), []) ?? [];
  const analyses = useLiveQuery(() => db.analyses.toArray(), []) ?? [];
  const leak = useMemo(() => computeLeaks(games, analyses).find((l) => l.motif !== 'opening' && l.motif !== 'endgame'), [games, analyses]);
  const rushBest = useStore((s) => s.stats.rushBest);
  const now = Date.now();
  const due = drills.filter((d) => d.due <= now).length;
  const mastered = drills.filter(isMastered).length;
  const sorted = [...drills].sort((a, b) => a.due - b.due);

  return (
    <div className="page">
      <header style={{ marginBottom: 24 }}>
        <h1 className="display t-1">Train</h1>
        <p className="quiet measure" style={{ marginTop: 6 }}>
          Your own mistakes, brought back right before you'd forget them. Mixed with puzzles that target your weakest habit.
        </p>
      </header>
      <div className="modes">
        <a className="mode lead" href="#/train/session">
          <div>
            <h2 className="t-2">Daily session</h2>
            <p style={{ opacity: 0.75, marginTop: 4 }}>Positions from your games, spaced for memory.</p>
          </div>
          <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <span><span className="display big num">{due}</span> <span style={{ opacity: 0.75 }}>due</span></span>
            <span className="key go">Start</span>
          </div>
        </a>
        <a className="mode" href="#/train/leak">
          <div>
            <h2 className="t-2">Fix a habit</h2>
            <p className="quiet" style={{ marginTop: 4 }}>{leak ? `${leak.label}: ${Math.round(leak.share * 100)}% of the points you lose.` : 'Review a few games to find your weakest habit.'}</p>
          </div>
          <span className="key" style={{ alignSelf: 'flex-start' }}>Train {leak ? leak.label.toLowerCase() : 'tactics'}</span>
        </a>
        <a className="mode" href="#/train/rush">
          <div>
            <h2 className="t-2">Blunder Rush</h2>
            <p className="quiet" style={{ marginTop: 4 }}>Three minutes, three lives. Speed builds pattern recognition.</p>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <span className="quiet">Best <b className="display num" style={{ fontSize: 30, color: 'var(--ink)' }}>{rushBest}</b></span>
            <span className="key">Play</span>
          </div>
        </a>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="t-2">Your mistakes</h2>
          <span className="faint t-small">{drills.length} saved, {mastered} mastered</span>
        </div>
        {!drills.length && <p className="quiet">Review a game and every mistake, miss and blunder you made lands here.</p>}
        <div>
          {sorted.slice(0, 50).map((d) => (
            <a key={d.id} className="bank-row" href={`#/review/${encodeURIComponent(d.gameId)}`}>
              <ClassIcon cls={d.cls} size={20} />
              <b className="num">{d.playedSan}</b>
              <span className="quiet">vs {d.opponent}, better was {d.bestSan}</span>
              <span className={`t-small ${d.due <= now ? 'due' : 'faint'}`}>{isMastered(d) ? 'Mastered' : dueLabel(d)}</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

const PHASE_TITLE: Record<string, string> = {
  solve: 'Your move',
  checking: 'Checking…',
  wrong: 'Not this time',
  explain: 'Here’s the idea',
  replay: 'Walk through it',
  confirm: 'Now you play it',
  solved: 'Correct',
};

function Runner({ mode, onAgain }: { mode: TrainMode; onAgain: () => void }) {
  const st = useStore();
  const stageRef = useRef<HTMLDivElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const [xpEarned, setXp] = useState(0);
  const [ratingDelta, setRatingDelta] = useState(0);

  const center = () => {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined;
  };

  const onCorrect = (r: TrainResult) => {
    const mult = 1 + 0.25 * Math.min(Math.max(r.combo - 1, 0), 8);
    const gain = Math.round((mode === 'rush' ? 6 : 10) * mult * (r.cleanSolve ? 1 : 0.4));
    // Variable reward lands on the behaviour we want: a fast, clean recall of a card you once forgot.
    const crit = r.cleanSolve && r.ms < 8000 && r.item.kind === 'drill' && r.item.drill.lapses > 0;
    setXp((x) => x + gain * (crit ? 2 : 1));
    st.addXP(gain, center(), { crit });
    st.stat('drillsSolved', 1);
    st.stat('bestCombo', r.combo, 'max');
    st.progressQuest('solve', 1);
    st.progressQuest('combo', r.combo, 'max');
    if (r.item.kind === 'puzzle' && mode === 'leak') st.progressQuest('theme', 1);
    // Training rating only moves on puzzles with a real, externally calibrated rating.
    if (r.item.kind === 'puzzle') setRatingDelta((d) => d + st.rateTraining(r.item.kind === 'puzzle' ? r.item.p.rating : 0, 1));
    void bumpActivity({ drills: 1, correct: 1 });
    if (r.cleanSolve) sfx.combo(r.combo);
    else sfx.correct();
    pop(comboRef.current, 1.3);
    const c = center();
    if (c) burst(c.x, c.y, '#5baa2e', 12 + r.combo * 2, 70 + r.combo * 5);
    if (r.combo > 0 && r.combo % 5 === 0) confettiBurst(['#f2b705', '#ff6a1a', '#ffffff'], 1 + r.combo / 10);
  };
  const onWrong = (r: TrainResult) => {
    st.stat('drillsFailed', 1);
    if (r.item.kind === 'puzzle') setRatingDelta((d) => d + st.rateTraining(r.item.kind === 'puzzle' ? r.item.p.rating : 0, 0));
    void bumpActivity({ drills: 1 });
    sfx.wrong();
    shake(stageRef.current, 10);
    flash('#d7263d');
  };
  const onFinish = (s: TrainSummary) => {
    if (mode === 'rush') {
      st.stat('rushBest', s.correct, 'max');
      st.progressQuest('rush', s.correct, 'max');
    }
    if (s.total >= 5 && s.accuracy >= 0.85) st.progressQuest('perfect', 1);
    if (s.total >= 5 && s.failed === 0) st.addXP(30);
    sfx.levelUp();
    confettiBurst(['#f2b705', '#12b8a6', '#4c7ef3'], 1.2);
  };

  const t = useTrainSession(mode, { onCorrect, onWrong, onFinish });
  const { phase, item, board, actions } = t;

  useEffect(() => {
    if (phase === 'solved') sfx.correct();
  }, [phase, t.index]);

  if (phase === 'loading') return <div className="page"><span className="spin lg" /> <span className="quiet">Building your session…</span></div>;
  if (phase === 'complete') return <SessionEnd summary={t.summary} mode={mode} xp={xpEarned} rating={ratingDelta} onAgain={onAgain} />;
  if (!item) {
    return (
      <div className="page narrow">
        <h1 className="display t-1">Nothing to train yet</h1>
        <p className="quiet" style={{ margin: '10px 0 20px' }}>Review a game first. Every mistake you made becomes a position here.</p>
        <a className="key ink" href="#/games">Go to your games</a>
      </div>
    );
  }

  const heat = t.combo >= 8 ? 'blazing' : t.combo >= 3 ? 'hot' : '';
  const turn = board.orientation === 'white' ? 'White' : 'Black';
  const solvedIdx = new Map(t.results.map((r) => [r.index, r.correct]));

  return (
    <div className="page">
      <div className="trainer-head">
        {mode === 'rush' ? (
          <div className="row grow" style={{ gap: 18 }}>
            <span className="lives" aria-label={`${t.lives} lives`}>{[0, 1, 2].map((i) => <i key={i} className={i < t.lives ? '' : 'gone'} />)}</span>
            <span className="display num" style={{ fontSize: 32, color: t.timeLeft <= 20 ? 'var(--c-blunder)' : undefined }}>
              {Math.floor(t.timeLeft / 60)}:{String(t.timeLeft % 60).padStart(2, '0')}
            </span>
            <span className="grow" />
            <span className="quiet">Score <b className="display num" style={{ fontSize: 32, color: 'var(--ink)' }}>{t.summary.correct}</b></span>
          </div>
        ) : (
          <div className="progress-ticks">
            {t.items.map((_, i) => (
              <i key={i} className={solvedIdx.has(i) ? (solvedIdx.get(i) ? 'ok' : 'bad') : i === t.index ? 'cur' : ''} />
            ))}
          </div>
        )}
        <div ref={comboRef} className={`combo ${heat}`} aria-label={`Combo ${t.combo}`}>
          <span className="display num" style={{ fontVariationSettings: `'wdth' ${Math.min(125, 68 + t.combo * 7)}` }}>{t.combo}</span>
          <span className="t-small" style={{ fontWeight: 650 }}>in a row</span>
        </div>
      </div>

      <div className="solve">
        <div className={`stage ${heat}`} ref={stageRef}>
          <Board
            fen={board.fen}
            orientation={board.orientation}
            lastMove={board.lastMove}
            arrows={board.arrows}
            highlight={board.highlights}
            movable={board.movable}
            onMove={(f, to, p) => void (phase === 'confirm' ? actions.confirmMove(f, to, p) : actions.submitMove(f, to, p))}
          />
          {phase === 'replay' && (
            <div className="transport on-stage" style={{ marginTop: 14 }}>
              <button className="key sq" onClick={() => actions.replayTo(0)} aria-label="Start of line">⏮</button>
              <button className="key sq" onClick={() => actions.replayStep(-1)} aria-label="Back">◀</button>
              <button className="key sq go" onClick={() => actions.replayStep(1)} aria-label="Forward">▶</button>
              <span style={{ opacity: 0.7 }} className="num">Move {t.replay.step} of {t.replay.total}</span>
            </div>
          )}
        </div>

        <aside className="stack" style={{ gap: 14 }}>
          <div className="panel panel-pad stack" style={{ gap: 6 }}>
            {item.kind === 'drill' ? (
              <span className="row t-small quiet" style={{ gap: 6 }}>
                <ClassIcon cls={item.drill.cls} size={18} /> From your game vs {item.drill.opponent}
              </span>
            ) : (
              <span className="t-small quiet">Lichess puzzle, rated <b className="num">{item.p.rating}</b>{item.tag ? `, for ${item.tag.toLowerCase()}` : ''}</span>
            )}
            <h2 className="display" style={{ fontSize: 40 }}>{PHASE_TITLE[phase] ?? ''}</h2>
            <p className="quiet">
              {turn} to move.{' '}
              {item.kind === 'drill' && phase === 'solve' && (
                <>You played <b style={{ color: 'var(--c-blunder)' }}>{item.drill.playedSan}</b> here, a {CLASS_LABEL[item.drill.cls].toLowerCase()}. Find the better move.</>
              )}
              {item.kind === 'puzzle' && phase === 'solve' && 'Find the strongest continuation.'}
            </p>
          </div>

          <div className="panel coach stack" style={{ gap: 12 }}>
            {(phase === 'solve' || phase === 'checking') && (
              <>
                {t.hint ? (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="faint t-small">Hint {t.hint.level} of 3</span>
                    <p className="coach-text">{t.hint.text}</p>
                  </div>
                ) : (
                  <p className="quiet">Hints get more specific each time, but cost part of the XP.</p>
                )}
                {mode !== 'rush' && (
                  <div className="row">
                    <button className="key" onClick={actions.nextHint} disabled={t.hintsUsed >= 3 || phase === 'checking'}>
                      {t.hintsUsed === 0 ? 'Give me a hint' : t.hintsUsed < 3 ? 'More specific' : 'No more hints'}
                    </button>
                    <button className="key flat" onClick={actions.giveUp} disabled={phase === 'checking'}>Show me</button>
                  </div>
                )}
              </>
            )}
            {phase === 'wrong' && (
              <>
                <p className="coach-text">The green arrow shows the move. Let’s see why it works before moving on.</p>
                <button className="key ink" onClick={actions.explain} autoFocus>Explain it</button>
              </>
            )}
            {phase === 'explain' && t.explanation && (
              <>
                <p className="coach-text"><b>{t.explanation.headline}</b></p>
                <p>{t.explanation.detail}</p>
                {t.plan?.idea && <p className="quiet">{t.plan.idea}</p>}
                <button className="key ink" onClick={actions.startReplay} autoFocus>Step through the line</button>
              </>
            )}
            {phase === 'replay' && t.plan && (
              <>
                <div className="line-chips">
                  {t.plan.lineExplained.map((x, i) => (
                    <button key={i} className={`line-chip ${t.replay.step === i + 1 ? 'now' : ''}`} onClick={() => actions.replayTo(i + 1)}>{x.san}</button>
                  ))}
                </div>
                {(() => { const n = (t.plan.lineExplained[t.replay.step - 1] as { note?: string } | undefined)?.note; return n ? <p className="coach-text">{n}</p> : null; })()}
                <button className="key ink" onClick={actions.startConfirm} disabled={t.replay.step < t.replay.total}>
                  {t.replay.step < t.replay.total ? 'Play the line to the end first' : 'Now let me play it'}
                </button>
              </>
            )}
            {phase === 'confirm' && (
              <>
                <p className="coach-text">Play the line yourself from the start. Doing it once is what makes it stick.</p>
                {t.error && <p style={{ color: 'var(--c-blunder)', fontWeight: 600 }}>{t.error}</p>}
              </>
            )}
            {phase === 'solved' && (
              <>
                {item.kind === 'drill' && t.explanation && <p className="coach-text">{t.explanation.headline}</p>}
                <button className="key go big" onClick={actions.next} autoFocus>{t.index + 1 < t.items.length || mode === 'rush' ? 'Next position' : 'Finish'}</button>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SessionEnd({ summary, mode, xp, rating, onAgain }: { summary: TrainSummary; mode: TrainMode; xp: number; rating: number; onAgain: () => void }) {
  const a = useRef<HTMLSpanElement>(null);
  const b = useRef<HTMLSpanElement>(null);
  const acc = Math.round(summary.accuracy * 100);
  const drills = useLiveQuery(() => db.drills.toArray(), []);
  const forecast = drills ? dueForecast(drills, Date.now()) : null;
  useEffect(() => {
    countUp(a.current, mode === 'rush' ? summary.correct : acc, 0, 1200);
    countUp(b.current, xp, 0, 1400);
  }, []);
  const line =
    mode === 'rush'
      ? `Best streak in this run: ${summary.bestCombo}.`
      : acc === 100
        ? 'Every position, first time.'
        : acc >= 80
          ? 'Right where learning happens fastest: hard enough to stretch you.'
          : 'The ones you missed come back sooner, so they stick.';
  return (
    <div className="page narrow">
      <h1 className="display t-hero">{mode === 'rush' ? 'Time' : 'Session done'}</h1>
      <p className="quiet t-3" style={{ fontWeight: 450, margin: '8px 0 28px' }}>{line}</p>
      <div className="panel versus" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div>
          <div className="display acc num" style={{ fontSize: 64 }}><span ref={a}>0</span>{mode === 'rush' ? '' : '%'}</div>
          <p className="quiet">{mode === 'rush' ? 'solved' : 'accuracy'}</p>
        </div>
        <div style={{ borderLeft: '1px solid var(--rule)' }}>
          <div className="display acc num" style={{ fontSize: 64, color: 'var(--gold-ink)' }}>+<span ref={b}>0</span></div>
          <p className="quiet">XP</p>
        </div>
        <div style={{ borderLeft: '1px solid var(--rule)' }}>
          <div className="display acc num" style={{ fontSize: 64, color: rating >= 0 ? 'var(--c-best)' : 'var(--c-blunder)' }}>{rating >= 0 ? '+' : ''}{rating}</div>
          <p className="quiet">training rating</p>
        </div>
      </div>
      {forecast && mode !== 'rush' && (
        <p className="t-3" style={{ marginTop: 22, fontWeight: 500 }}>
          {forecast.dueNow > 0
            ? `${forecast.dueNow} more ${forecast.dueNow === 1 ? 'is' : 'are'} ready now.`
            : forecast.dueTomorrow > 0
              ? `${forecast.dueTomorrow} come back tomorrow. See you then.`
              : 'Nothing else is due. Play a game and Hindsight will find your next lessons.'}
        </p>
      )}
      <div className="row" style={{ marginTop: 24 }}>
        <button className="key ink big" onClick={onAgain}>{forecast && forecast.dueNow > 0 ? 'One more round' : 'Go again'}</button>
        <a className="key big" href="#/">Back to today</a>
      </div>
    </div>
  );
}
