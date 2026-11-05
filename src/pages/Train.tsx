import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, ChevronRight, Eye, Lightbulb, Play, Target, Timer, Zap } from 'lucide-react';
import { db, bumpActivity } from '../lib/db';
import { computeLeaks } from '../lib/learning';
import { dueLabel, isMastered } from '../lib/srs';
import { useTrainSession, type TrainMode, type TrainResult, type TrainSummary } from '../lib/trainflow';
import { useStore } from '../lib/store';
import { useDrillStats, useRecentGames } from '../lib/queries';
import { useHotkeys } from '../lib/hotkeys';
import { burst, confettiBurst } from '../lib/fx';
import { sfx } from '../lib/sound';
import { dueForecast } from '../lib/insights';
import { Board, type Mark } from '../components/Board';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { MoveInput } from '../components/MoveInput';
import { Points } from '../components/Explain';
import { HintDots, LineReplay, Status, TurnChip, useReplayStart, useStickyHighlights } from '../components/Puzzle';
import { PageSkeleton, Skeleton } from '../components/Skeleton';
import { Ticker } from '../components/Ticker';
import { playedPhrase } from '../components/plain';
import { enter, spring, staggerDelay } from '../components/motion';
import { ContextLegend, mistakeArrow, useDrillContext, useIntroMove } from '../components/MoveContext';

export function Train({ mode }: { mode?: string }) {
  const [run, setRun] = useState(0);
  if (mode === 'session' || mode === 'leak' || mode === 'rush') return <Runner key={mode + run} mode={mode} onAgain={() => setRun((r) => r + 1)} />;
  return <TrainHome />;
}

/* ------------------------------------------------------------------ */

function TrainHome() {
  const stats = useDrillStats();
  const [shown, setShown] = useState(12);
  const drills = useLiveQuery(() => db.drills.orderBy('due').limit(shown).toArray(), [shown, stats.total]);
  const games = useRecentGames(30);
  const ids = useMemo(() => games.filter((g) => g.analysed).slice(0, 20).map((g) => g.id), [games]);
  const analyses = useLiveQuery(() => db.analyses.where('gameId').anyOf(ids).toArray(), [ids.join()]);
  const leak = useMemo(() => (analyses ? computeLeaks(games, analyses).find((l) => l.motif !== 'opening' && l.motif !== 'endgame') : undefined), [games, analyses]);
  const rushBest = useStore((s) => s.stats.rushBest);
  const now = Date.now();
  const first = drills?.find((d) => d.due <= now) ?? drills?.[0];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display t-1">Train</h1>
          <p className="quiet measure" style={{ marginTop: 8 }}>
            Your own mistakes, brought back right before you'd forget them, mixed with puzzles aimed at your weakest habit.
          </p>
        </div>
      </header>

      <motion.a {...enter} className="card train-hero" href="#/train/session">
        <div style={{ pointerEvents: 'none' }}>
          {first ? <Board fen={first.fen} orientation={first.color === 'w' ? 'white' : 'black'} coordinates={false} still /> : <Skeleton h="auto" style={{ aspectRatio: '1' }} />}
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <p className="label">Daily session</p>
          <div className="row" style={{ alignItems: 'baseline', gap: 12 }}>
            <Ticker className="display count" value={stats.due} />
            <span className="t-lead quiet">{stats.due === 1 ? 'position is' : 'positions are'} due</span>
          </div>
          <p className="quiet">
            {stats.due > 0 ? 'Positions from your games, spaced so they stick. About ' + Math.max(2, Math.round(Math.min(stats.due, 10) * 0.6)) + ' minutes.' : stats.dueTomorrow > 0 ? `${stats.dueTomorrow} come back tomorrow. A session now mixes in fresh puzzles.` : 'Nothing is due. A session now is puzzles aimed at your weakest habit.'}
          </p>
          <span className="btn go lg" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            Start session <ArrowRight />
          </span>
        </div>
      </motion.a>

      <div className="mode-rows">
        <a className="card mode-row" href="#/train/leak">
          <span className="glyph" style={{ color: 'var(--c-mistake)' }}><Target /></span>
          <span className="stack" style={{ gap: 2 }}>
            <span className="t-3">Fix a habit</span>
            <span className="quiet t-small">
              {leak ? `${leak.label}: ${Math.round(leak.share * 100)}% of the points you lose.` : 'Review a few games to find your weakest habit.'}
            </span>
          </span>
          <ChevronRight className="chev" />
        </a>
        <a className="card mode-row" href="#/train/rush">
          <span className="glyph" style={{ color: 'var(--flame)' }}><Zap /></span>
          <span className="stack" style={{ gap: 2 }}>
            <span className="t-3">Blunder Rush</span>
            <span className="quiet t-small">Three minutes, three lives. Your best is <b className="num">{rushBest}</b>.</span>
          </span>
          <ChevronRight className="chev" />
        </a>
      </div>

      <section className="section" aria-labelledby="bank-h">
        <div className="section-head">
          <h2 id="bank-h" className="t-2">Your mistakes</h2>
          <span className="faint t-small num">
            {stats.total} saved, {stats.mastered} mastered
          </span>
        </div>
        {stats.total === 0 ? (
          <div className="empty">
            <h2>Nothing saved yet</h2>
            <p className="quiet">Review a game and every mistake, miss and blunder you made lands here.</p>
            <a className="btn primary" href="#/games">Go to your games</a>
          </div>
        ) : (
          <div className="bank">
            {(drills ?? []).map((d, i) => (
              <motion.a
                key={d.id}
                className="bank-item"
                href={`#/review/${encodeURIComponent(d.gameId)}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: staggerDelay(i % 12, 12) }}
              >
                <Board fen={d.fen} orientation={d.color === 'w' ? 'white' : 'black'} coordinates={false} still />
                <span className="meta">
                  <ClassIcon cls={d.cls} size={14} />
                  {CLASS_LABEL[d.cls]}
                  <span className="grow" />
                  <span className={d.due <= now ? 'due' : ''}>{isMastered(d) ? 'Mastered' : dueLabel(d)}</span>
                </span>
                <span className="what">You {playedPhrase(d.fen, d.playedSan)} against {d.opponent}</span>
              </motion.a>
            ))}
          </div>
        )}
        {stats.total > shown && (
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setShown((s) => s + 24)}>
            Show more
          </button>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Runner({ mode, onAgain }: { mode: TrainMode; onAgain: () => void }) {
  const st = useStore();
  const stageRef = useRef<HTMLDivElement>(null);
  const [xpEarned, setXp] = useState(0);
  const [ratingDelta, setRatingDelta] = useState(0);
  const [fb, setFb] = useState<{ kind: 'good' | 'bad'; key: number } | null>(null);
  const [pointMarks, setPointMarks] = useState<Mark[]>([]);

  const center = () => {
    const r = stageRef.current?.querySelector('.board-wrap')?.getBoundingClientRect();
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
    if (r.item.kind === 'puzzle') setRatingDelta((d) => d + st.rateTraining(r.item.kind === 'puzzle' ? r.item.p.rating : 0, 1));
    void bumpActivity({ drills: 1, correct: 1 });
    if (r.cleanSolve) sfx.combo(r.combo);
    else sfx.correct();
    setFb({ kind: 'good', key: Date.now() });
    const c = center();
    if (c && r.combo >= 3) burst(c.x, c.y, '#3fb45a', 10 + r.combo * 2, 70 + r.combo * 5);
    if (r.combo > 0 && r.combo % 5 === 0) confettiBurst(['#f2b705', '#ff6a1a', '#ffffff'], 0.8 + r.combo / 10);
  };
  const onWrong = (r: TrainResult) => {
    st.stat('drillsFailed', 1);
    if (r.item.kind === 'puzzle') setRatingDelta((d) => d + st.rateTraining(r.item.kind === 'puzzle' ? r.item.p.rating : 0, 0));
    void bumpActivity({ drills: 1 });
    sfx.wrong();
    setFb({ kind: 'bad', key: Date.now() });
  };
  const onFinish = (s: TrainSummary) => {
    if (mode === 'rush') {
      st.stat('rushBest', s.correct, 'max');
      st.progressQuest('rush', s.correct, 'max');
    }
    if (s.total >= 5 && s.accuracy >= 0.85) st.progressQuest('perfect', 1);
    if (s.total >= 5 && s.failed === 0) st.addXP(30);
    sfx.levelUp();
    confettiBurst(['#f2b705', '#3fb45a', '#6e95ff'], 1);
  };

  const t = useTrainSession(mode, { onCorrect, onWrong, onFinish });
  const { phase, item, board, actions } = t;
  const solving = phase === 'solve';

  useEffect(() => {
    if (phase !== 'explain') setPointMarks([]);
  }, [phase, t.index]);
  // A first miss bounces the piece back with a soft cross; the second miss goes to the answer (onWrong).
  useEffect(() => {
    if (t.attempts > 0 && (phase === 'solve' || phase === 'confirm')) {
      sfx.wrong();
      setFb({ kind: 'bad', key: Date.now() });
    }
  }, [t.attempts]);

  useHotkeys(
    {
      h: () => { if (solving && mode !== 'rush' && t.hintsUsed < 3) { intro.cancel(); actions.nextHint(); } },
      s: () => solving && mode !== 'rush' && actions.giveUp(),
      Enter: () => {
        if (phase === 'solved') actions.next();
        else if (phase === 'wrong') actions.explain();
        else if (phase === 'explain') actions.startReplay();
      },
      ArrowLeft: () => phase === 'replay' && actions.replayStep(-1),
      ArrowRight: () => phase === 'replay' && actions.replayStep(1),
    },
    [phase, t.hintsUsed, mode],
  );

  const drill = item?.kind === 'drill' ? item.drill : undefined;
  const ctx = useDrillContext(drill);
  const intro = useIntroMove(t.index, ctx, board.fen, phase === 'solve', t.attempts === 0 && t.hintsUsed === 0);
  const replayStart = useReplayStart(phase === 'replay', t.replay.step, board.fen, t.index);
  const hintSquares = useStickyHighlights(board.highlights, phase === 'solve' || phase === 'checking', t.index);

  if (phase === 'loading') return <PageSkeleton board />;
  if (phase === 'complete') return <SessionEnd summary={t.summary} mode={mode} xp={xpEarned} rating={ratingDelta} onAgain={onAgain} />;
  if (!item) {
    return (
      <div className="page narrow">
        <div className="empty">
          <h2>Nothing to train yet</h2>
          <p className="quiet">Review a game first. Every mistake you made becomes a position here.</p>
          <a className="btn primary" href="#/games">Go to your games</a>
        </div>
      </div>
    );
  }

  const hot = t.combo >= 3;
  const turn: 'w' | 'b' = board.orientation === 'white' ? 'w' : 'b';
  const solvedIdx = new Map(t.results.map((r) => [r.index, r.correct]));
  const ex = t.explanation;
  const onMove = (f: string, to: string, p?: string) => void (phase === 'confirm' ? actions.confirmMove(f, to, p) : actions.submitMove(f, to, p));

  return (
    <div className="page wide visual-trainer">
      <div className="boardpage">
        <div className="boardpage-main board-bleed" ref={stageRef}>
          <div className="trainer-top">
            {mode === 'rush' ? (
              <div className="row nowrap grow" style={{ gap: 18 }}>
                <span className="lives" role="img" aria-label={`${t.lives} lives left`}>
                  {[0, 1, 2].map((i) => (
                    <i key={i} className={i < t.lives ? '' : 'gone'} />
                  ))}
                </span>
                <span className={`display num clock-big ${t.timeLeft <= 20 ? 'low' : ''}`} aria-label="Time left">
                  <Timer style={{ display: 'inline', width: 20, height: 20, marginRight: 6, verticalAlign: -2, color: 'var(--ink-3)' }} />
                  {Math.floor(t.timeLeft / 60)}:{String(t.timeLeft % 60).padStart(2, '0')}
                </span>
                <span className="grow" />
                <span className="quiet strong">
                  Score <Ticker className="display" value={t.summary.correct} />
                </span>
              </div>
            ) : (
              <div className="progress-ticks" aria-label={`Position ${t.index + 1} of ${t.items.length}`}>
                {t.items.map((_, i) => (
                  <i key={i} className={solvedIdx.has(i) ? (solvedIdx.get(i) ? 'ok' : 'bad') : i === t.index ? 'cur' : ''} />
                ))}
              </div>
            )}
            <motion.span key={t.combo} className={`combo ${hot ? 'hot' : ''}`} initial={{ scale: t.combo ? 1.15 : 1 }} animate={{ scale: 1 }} transition={spring.pop} aria-label={`${t.combo} in a row`}>
              <span className="display num">{t.combo}</span> in a row
            </motion.span>
          </div>
          {drill && ['solve', 'checking', 'wrong'].includes(phase) && (
            <div className="ctx-mobile">
              <ContextLegend ctx={ctx} cls={drill.cls} turn={turn} onReplay={solving ? intro.replay : undefined} onReplayMine={solving ? intro.replayMine : undefined} showing={intro.showing} compact />
            </div>
          )}
          <div className="board-row">
            <Board
              fen={intro.fen}
              orientation={board.orientation}
              labelSquares
              lastMoveTone={intro.showing === 'mine' ? 'mine' : 'theirs'}
              lastMove={intro.animating ? intro.lastMove : board.lastMove ?? (solving || phase === 'checking' || phase === 'wrong' ? intro.lastMove : undefined)}
              arrows={intro.animating ? intro.showing === 'mine' ? mistakeArrow(ctx) : [] : ['solve', 'checking', 'wrong', 'explain'].includes(phase) ? [...mistakeArrow(ctx), ...board.arrows] : board.arrows}
              highlight={hintSquares}
              marks={pointMarks}
              movable={board.movable && !intro.animating}
              feedback={fb}
              nonce={t.attempts * 1000 + t.index}
              sound
              onMove={onMove}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            {phase === 'replay' && t.plan ? (
              <LineReplay key={t.index} step={t.replay.step} total={t.replay.total} goTo={actions.replayTo} line={t.plan.line} startFen={replayStart} perspective={turn} notes={t.plan.lineExplained.map((x) => (x as { note?: string }).note)} />
            ) : (
              board.movable && !intro.animating && (
                <div className="under-board" style={{ marginTop: 0 }}>
                  <MoveInput fen={board.fen} onMove={onMove} />
                </div>
              )
            )}
          </div>
        </div>

        <aside className="boardpage-side scroll">
          <div className="card">
            <div className="coach-card">
              <div className="context-line">
                {item.kind === 'drill' ? (
                  <>
                    <ClassIcon cls={item.drill.cls} size={16} /> From your game against {item.drill.opponent}
                  </>
                ) : (
                  <>
                    Puzzle rated <b className="num">{item.p.rating}</b>
                    {item.tag ? `, for ${item.tag.toLowerCase()}` : ''}
                  </>
                )}
              </div>

              {phase === 'explain' || phase === 'replay' ? (
                <p className="headline">{ex?.headline ?? 'Here is the idea'}</p>
              ) : (
                <>
                  {item.kind === 'drill' && ['solve', 'checking', 'wrong'].includes(phase) ? (
                    <div className="ctx-desktop">
                      <ContextLegend ctx={ctx} cls={item.drill.cls} turn={turn} onReplay={solving ? intro.replay : undefined} onReplayMine={solving ? intro.replayMine : undefined} showing={intro.showing} />
                    </div>
                  ) : (
                    <>
                      <p className="prompt">Find the strongest continuation.</p>
                      <TurnChip color={turn} />
                    </>
                  )}
                </>
              )}

              {phase === 'checking' && (
                <Status tone="info" id="checking" busy>
                  Checking your move
                </Status>
              )}
              {solving && t.error && !t.hint && (
                <Status tone="bad" id={`retry-${t.attempts}`}>
                  <p className="strong">Not that one.</p>
                  <p>{t.error === 'Try once more.' ? 'One more try. Look for the most forcing move.' : t.error}</p>
                </Status>
              )}
              {phase === 'wrong' && (
                <Status tone="bad" id={`wrong-${t.index}`}>
                  <p className="strong">Not this time.</p>
                  <p>The green arrow shows the move. See why it works, then play it yourself.</p>
                </Status>
              )}
              {solving && t.hint && (
                <Status tone="hint" id={`hint-${t.hint.level}`}>
                  <p className="strong">
                    Hint {t.hint.level} of 3 <HintDots used={t.hintsUsed} />
                  </p>
                  <p>{t.hint.text}</p>
                </Status>
              )}
              {phase === 'solved' && (
                <Status tone="good" id={`solved-${t.index}`}>
                  <p className="strong">Correct.</p>
                  {item.kind === 'drill' && ex && <p>{ex.headline}</p>}
                </Status>
              )}
              {phase === 'confirm' && (
                <Status tone="info" id={`confirm-${t.error ?? ''}`}>
                  <p className="strong">Now you play it.</p>
                  <p>{t.error ?? 'Play the line yourself from the start. Doing it once is what makes it stick.'}</p>
                </Status>
              )}

              {phase === 'explain' && ex && <Points ex={{ rule: '', ...ex }} onSquares={setPointMarks} />}
              {phase === 'explain' && t.plan?.idea && <p className="quiet t-small">{t.plan.idea}</p>}

              <div className="panel-actions">
                {solving && mode !== 'rush' && (
                  <>
                    <button className="btn" onClick={() => { intro.cancel(); actions.nextHint(); }} disabled={t.hintsUsed >= 3}>
                      <Lightbulb /> {t.hintsUsed === 0 ? 'Hint' : t.hintsUsed < 3 ? 'More specific' : 'No more hints'} <span className="kbd hide-m">H</span>
                    </button>
                    <button className="btn ghost" onClick={actions.giveUp}>
                      <Eye /> Show me <span className="kbd hide-m">S</span>
                    </button>
                  </>
                )}
                {phase === 'wrong' && (
                  <button className="btn go" onClick={actions.explain} autoFocus>
                    Explain it <span className="kbd hide-m">Enter</span>
                  </button>
                )}
                {phase === 'explain' && (
                  <button className="btn go" onClick={actions.startReplay} autoFocus>
                    <Play fill="currentColor" /> Watch the line
                  </button>
                )}
                {phase === 'replay' && (
                  <button className="btn go" onClick={actions.startConfirm} disabled={t.replay.step < t.replay.total}>
                    {t.replay.step < t.replay.total ? 'Watch it to the end' : 'Now let me play it'}
                  </button>
                )}
                {phase === 'solved' && (
                  <button className="btn go lg" onClick={actions.next} autoFocus>
                    {t.index + 1 < t.items.length || mode === 'rush' ? 'Next position' : 'Finish'} <ArrowRight />
                  </button>
                )}
              </div>
            </div>
            <div className="panel-foot">
              <button className="btn ghost sm" onClick={actions.finish}>
                End session
              </button>
              <span className="kbd-hints hide-m">
                <span>
                  <span className="kbd">/</span> type a move
                </span>
                <span>
                  <span className="kbd">Esc</span> exit
                </span>
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SessionEnd({ summary, mode, xp, rating, onAgain }: { summary: TrainSummary; mode: TrainMode; xp: number; rating: number; onAgain: () => void }) {
  const acc = Math.round(summary.accuracy * 100);
  const drills = useLiveQuery(() => db.drills.toArray(), []);
  const forecast = drills ? dueForecast(drills, Date.now()) : null;
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
      <motion.h1 {...enter} className="display t-hero">{mode === 'rush' ? 'Time' : 'Session done'}</motion.h1>
      <p className="t-lead quiet" style={{ margin: '10px 0 28px' }}>{line}</p>
      <div className="card stat-strip" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div>
          <div className="display">
            <Ticker value={mode === 'rush' ? summary.correct : acc} suffix={mode === 'rush' ? '' : '%'} />
          </div>
          <p className="faint t-small">{mode === 'rush' ? 'solved' : 'accuracy'}</p>
        </div>
        <div>
          <div className="display gold-text">
            <Ticker value={xp} prefix="+" />
          </div>
          <p className="faint t-small">XP</p>
        </div>
        <div>
          <div className="display" style={{ color: rating >= 0 ? 'var(--good)' : 'var(--bad)' }}>
            {rating >= 0 ? '+' : ''}
            {rating}
          </div>
          <p className="faint t-small">training rating</p>
        </div>
      </div>
      {forecast && mode !== 'rush' && (
        <p className="t-3" style={{ marginTop: 22 }}>
          {forecast.dueNow > 0
            ? `${forecast.dueNow} more ${forecast.dueNow === 1 ? 'is' : 'are'} ready now.`
            : forecast.dueTomorrow > 0
              ? `${forecast.dueTomorrow} come back tomorrow. See you then.`
              : 'Nothing else is due. Play a game and Hindsight will find your next lessons.'}
        </p>
      )}
      <div className="row" style={{ marginTop: 24 }}>
        <button className="btn go lg" onClick={onAgain} autoFocus>
          {forecast && forecast.dueNow > 0 ? 'One more round' : 'Go again'}
        </button>
        <a className="btn lg" href="#/">Back to today</a>
      </div>
    </div>
  );
}
