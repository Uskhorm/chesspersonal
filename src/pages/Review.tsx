import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CornerUpLeft,
  ExternalLink,
  FlipVertical2,
  Play,
  SkipForward,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { db } from '../lib/db';
import { enqueueAnalysis, markReviewed, useQueue } from '../lib/sync';
import type { AnalysedMove, Classification, Color, GameAnalysis, Score, StoredGame } from '../lib/types';
import { explainMove, type Explanation } from '../lib/coach';
import { useExplorer } from '../lib/explorer';
import { usePlayback, type PlaybackStep } from '../lib/playback';
import { useHotkeys } from '../lib/hotkeys';
import { formatScore } from '../lib/winpct';
import { celebrateClass, shake } from '../lib/fx';
import { sfx } from '../lib/sound';
import { Board, type Arrow, type Mark } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { Timeline } from '../components/Timeline';
import { MoveList } from '../components/MoveList';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { Points } from '../components/Explain';
import { PlaybackBar } from '../components/Playback';
import { MoveInput } from '../components/MoveInput';
import { Seg } from '../components/Seg';
import { Skeleton, PageSkeleton } from '../components/Skeleton';
import { Ticker } from '../components/Ticker';
import { CLASS_COLOR } from '../lib/fx';
import { cap, moveNo, plainLine, plainMove } from '../components/plain';
import { spring, staggerDelay } from '../components/motion';

const LearnMode = lazy(() => import('./LearnMode').then((m) => ({ default: m.LearnMode })));

const START = new Chess().fen();
const BAD = new Set<Classification>(['inaccuracy', 'mistake', 'miss', 'blunder']);
const KEY = new Set<Classification>(['mistake', 'miss', 'blunder']);
const GOOD = new Set<Classification>(['brilliant', 'great']);

export function Review({ id, learn }: { id: string; learn: boolean }) {
  const game = useLiveQuery(() => db.games.get(id).then((g) => g ?? null), [id]);
  const analysis = useLiveQuery(() => db.analyses.get(id).then((a) => a ?? null), [id]);

  useEffect(() => {
    if (analysis === null && game) void enqueueAnalysis(id, true).catch(() => {});
  }, [analysis === null, !!game, id]);

  if (game === undefined || analysis === undefined) return <PageSkeleton board />;
  if (game === null) {
    return (
      <div className="page narrow">
        <div className="empty">
          <h2>This game isn't on this device</h2>
          <p className="quiet">It may have been cleared. Your games list has everything that's synced.</p>
          <a className="btn primary" href="#/games">Go to games</a>
        </div>
      </div>
    );
  }
  if (!analysis) return <Analysing game={game} />;
  if (learn) {
    return (
      <Suspense fallback={<PageSkeleton board />}>
        <LearnMode a={analysis} game={game} />
      </Suspense>
    );
  }
  return <AnalysisView a={analysis} game={game} />;
}

/* ------------------------------------------------------------------ */
/* While Stockfish works: the finished game is already on the board.   */
/* ------------------------------------------------------------------ */

function Analysing({ game }: { game: StoredGame }) {
  const q = useQueue();
  const mine = q.current === game.id;
  const pct = mine && q.total ? q.done / q.total : 0;
  const ahead = mine ? 0 : Math.max(0, q.queued.indexOf(game.id)) + (q.current ? 1 : 0);
  const opp = game.userColor === 'w' ? game.black : game.white;
  const final = useMemo(() => {
    try {
      const c = new Chess();
      c.loadPgn(game.pgn);
      return c.fen();
    } catch {
      return START;
    }
  }, [game.pgn]);
  const R = 46;
  const C = 2 * Math.PI * R;
  return (
    <div className="page wide">
      <div className="boardpage">
        <div className="boardpage-main board-bleed">
          <div className="board-row">
            <EvalBar orientation={game.userColor === 'w' ? 'white' : 'black'} />
            <Board fen={final} orientation={game.userColor === 'w' ? 'white' : 'black'} />
          </div>
        </div>
        <aside className="boardpage-side">
          <div className="card card-pad-lg stack" style={{ gap: 16 }} aria-live="polite">
            <p className="label">{mine ? 'Stockfish is reviewing every move' : 'Waiting for the engine'}</p>
            <h1 className="display" style={{ fontSize: 'var(--fs-38)' }}>You vs {opp.username}</h1>
            <div className="row nowrap" style={{ gap: 18 }}>
              <div style={{ position: 'relative', width: 104, height: 104 }}>
                <svg viewBox="0 0 104 104" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }} aria-hidden="true">
                  <circle cx="52" cy="52" r={R} fill="none" strokeWidth="8" style={{ stroke: 'var(--surface-3)' }} />
                  <circle cx="52" cy="52" r={R} fill="none" strokeWidth="8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.02, pct))} style={{ stroke: 'var(--accent)', transition: 'stroke-dashoffset 500ms var(--ease-out)' }} />
                </svg>
                <span className="display num" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 30 }}>
                  {Math.round(pct * 100)}%
                </span>
              </div>
              <p className="quiet t-small">
                {mine ? 'This runs on your device. You can leave; the review keeps going and the page updates itself when it is done.' : `${ahead} game${ahead === 1 ? '' : 's'} ahead of this one. It moves to the front because you opened it.`}
              </p>
            </div>
            <Skeleton h={14} w="70%" />
            <Skeleton h={14} w="55%" />
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The analysis board                                                  */
/* ------------------------------------------------------------------ */

type LineMode = { which: 'best' | 'reply' | 'engine'; startFen: string; moves: string[]; title: string; base?: AnalysedMove };

function stepsFor(fen: string, moves: string[], perspective: Color): PlaybackStep[] {
  const steps: PlaybackStep[] = [{ fen }];
  const labels = plainLine(fen, moves, perspective);
  try {
    const c = new Chess(fen);
    for (let i = 0; i < moves.length && i < labels.length; i++) {
      const m = c.move(moves[i]);
      steps.push({ fen: c.fen(), lastMove: [m.from, m.to], label: `${labels[i]}|${m.san}` });
    }
  } catch {
    /* keep the legal prefix */
  }
  return steps;
}

function clockAt(moves: AnalysedMove[], ply: number, color: Color): number | undefined {
  for (let i = Math.min(ply, moves.length) - 1; i >= 0; i--) if (moves[i].color === color && moves[i].clock !== undefined) return moves[i].clock;
  return undefined;
}
const fmtClock = (s?: number) => (s === undefined ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

function AnalysisView({ a, game }: { a: GameAnalysis; game: StoredGame }) {
  const moves = a.moves;
  const userColor = game.userColor;
  const [ply, setPly] = useState(0);
  const [tab, setTab] = useState<'report' | 'analysis'>('report');
  const [flip, setFlip] = useState(false);
  const [engineOn, setEngineOn] = useState(() => localStorage.getItem('hindsight-engine') !== 'off');
  const [line, setLine] = useState<LineMode | null>(null);
  const [pointMarks, setPointMarks] = useState<Mark[]>([]);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reviewedRef = useRef(false);

  const cur = ply > 0 ? moves[ply - 1] : undefined;
  const gameFen = cur ? cur.fenAfter : START;
  const ex = useExplorer(gameFen, { perspective: userColor, engine: engineOn });
  const inVariation = ex.path.length > 1;

  const steps = useMemo(() => (line ? stepsFor(line.startFen, line.moves, userColor) : []), [line]);
  const pb = usePlayback(steps, { interval: 1000 });
  useEffect(() => {
    if (line) pb.play();
  }, [line]);

  const orientation: 'white' | 'black' = (userColor === 'w') !== flip ? 'white' : 'black';

  const go = useCallback(
    (p: number, stepped = false) => {
      const np = Math.max(0, Math.min(moves.length, p));
      setLine(null);
      setPly(np);
      if (np > 0) setTab('analysis');
      const m = moves[np - 1];
      if (!m || !stepped) return;
      if (GOOD.has(m.cls)) {
        setTimeout(() => (m.cls === 'brilliant' ? sfx.brilliant() : sfx.great()), 140);
        celebrateClass(m.cls);
      } else if (m.cls === 'blunder' && m.color === userColor) {
        setTimeout(() => sfx.blunder(), 140);
        shake(stageRef.current, 4);
      }
    },
    [moves, userColor],
  );

  const nextMistake = () => {
    const next = moves.find((m) => m.ply > ply && m.color === userColor && BAD.has(m.cls)) ?? moves.find((m) => m.color === userColor && BAD.has(m.cls));
    if (next) go(next.ply, true);
  };
  const back = () => {
    if (line) return pb.prev();
    if (ex.canBack) return ex.actions.back();
    go(ply - 1);
  };
  const fwd = () => {
    if (line) return pb.next();
    if (ex.canForward) return ex.actions.forward();
    if (!inVariation) go(ply + 1, true);
  };
  const toggleEngine = () =>
    setEngineOn((v) => {
      localStorage.setItem('hindsight-engine', v ? 'off' : 'on');
      return !v;
    });

  useHotkeys(
    {
      ArrowLeft: back,
      ArrowRight: fwd,
      Home: () => go(0),
      End: () => go(moves.length),
      ' ': () => line && pb.toggle(),
      f: () => setFlip((x) => !x),
      e: toggleEngine,
      n: nextMistake,
      Backspace: () => (line ? setLine(null) : inVariation ? ex.actions.reset(gameFen) : undefined),
    },
    [ply, line, inVariation, ex.canBack, ex.canForward, pb.index, gameFen],
  );

  useEffect(() => {
    if (!reviewedRef.current && ply === moves.length && moves.length > 0) {
      reviewedRef.current = true;
      const k = `reviewed:${game.id}`;
      if (!localStorage.getItem(k)) {
        localStorage.setItem(k, '1');
        void markReviewed();
      }
    }
  }, [ply]);

  const playLine = (l: LineMode) => {
    setPointMarks([]);
    setLine(l);
  };

  const onBoardMove = (from: string, to: string, promo?: string) => {
    if (line) {
      setLine(null);
      return;
    }
    const next = moves[ply];
    if (!inVariation && next && next.uci.slice(0, 4) === from + to) {
      go(ply + 1);
      return;
    }
    ex.actions.play(from, to, promo);
  };

  // What the board shows
  let fen = gameFen;
  let lastMove: [string, string] | undefined = cur ? [cur.from, cur.to] : undefined;
  let arrows: Arrow[] = [];
  let badge: { square: string; cls: Classification } | null = cur ? { square: cur.to, cls: cur.cls } : null;
  let evalScore: Score | undefined = cur ? cur.scoreAfter : { cp: 20 };
  let marks: Mark[] = pointMarks;
  const engineArrows: Arrow[] = engineOn
    ? ex.lines.slice(0, 3).map((l, i) => ({ from: l.uci.slice(0, 2), to: l.uci.slice(2, 4), brush: i === 0 ? 'best' : i === 1 ? 'alt' : 'faint' }))
    : [];
  if (hoverLine !== null && engineArrows[hoverLine]) engineArrows.splice(0, engineArrows.length, { ...engineArrows[hoverLine], brush: 'best' });
  const badMove = cur && BAD.has(cur.cls) && cur.bestUci && cur.bestUci !== cur.uci ? cur : null;

  if (line && pb.step) {
    fen = pb.step.fen;
    lastMove = pb.step.lastMove;
    arrows = [];
    badge = null;
    marks = [];
    evalScore = line.base ? (line.which === 'best' ? line.base.scoreBefore : line.base.scoreAfter) : ex.lines[0]?.score;
  } else if (inVariation) {
    fen = ex.fen;
    lastMove = ex.lastMove;
    arrows = engineArrows;
    badge = null;
    marks = [];
    evalScore = ex.lines[0]?.score ?? evalScore;
  } else if (badMove && pointMarks.length === 0) {
    arrows = [{ from: badMove.bestUci.slice(0, 2), to: badMove.bestUci.slice(2, 4), brush: 'best' }];
  } else if (pointMarks.length === 0) {
    arrows = engineArrows;
  }

  const players = { top: orientation === 'white' ? game.black : game.white, bottom: orientation === 'white' ? game.white : game.black };
  const topColor: Color = orientation === 'white' ? 'b' : 'w';
  const bottomColor: Color = topColor === 'w' ? 'b' : 'w';
  const crumbs = ex.path.slice(1);
  const stepLabel = pb.step?.label?.split('|');

  return (
    <div className="page wide">
      <div className="boardpage">
        <div className="boardpage-main board-bleed" ref={stageRef}>
          <PlayerBar name={players.top.username} rating={players.top.rating} color={topColor} clock={fmtClock(clockAt(moves, ply, topColor))} />
          <div className="board-row">
            <EvalBar score={evalScore} orientation={orientation} />
            <Board fen={fen} orientation={orientation} lastMove={lastMove} arrows={arrows} badge={badge} marks={marks} movable={!line} onMove={onBoardMove} sound />
          </div>
          <PlayerBar name={players.bottom.username} rating={players.bottom.rating} color={bottomColor} clock={fmtClock(clockAt(moves, ply, bottomColor))} />

          <AnimatePresence mode="popLayout" initial={false}>
            {line ? (
              <motion.div key="pb" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }} transition={spring.smooth} style={{ marginTop: 12 }}>
                <PlaybackBar
                  index={pb.index}
                  total={Math.max(0, steps.length - 1)}
                  playing={pb.playing}
                  speed={pb.speed}
                  onToggle={pb.toggle}
                  onPrev={pb.prev}
                  onNext={pb.next}
                  onSeek={pb.seek}
                  onSpeed={pb.setSpeed}
                  tone={line.which === 'reply' ? 'bad' : 'good'}
                  caption={pb.index === 0 ? line.title : stepLabel?.[0]}
                  sub={pb.index === 0 ? undefined : stepLabel?.[1]}
                  onExit={() => setLine(null)}
                />
              </motion.div>
            ) : (
              <motion.div key="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                <div className="under-board">
                  <div className="transport" role="group" aria-label="Move through the game">
                    <button className="btn icon sm" onClick={() => go(0)} aria-label="First move (Home)"><ChevronsLeft /></button>
                    <button className="btn icon" onClick={back} aria-label="Previous move (left arrow)"><ChevronLeft /></button>
                    <button className="btn icon" onClick={fwd} aria-label="Next move (right arrow)"><ChevronRight /></button>
                    <button className="btn icon sm" onClick={() => go(moves.length)} aria-label="Last move (End)"><ChevronsRight /></button>
                    <span className="sep" />
                    <button className="btn icon sm" onClick={() => setFlip((x) => !x)} aria-label="Flip board (F)"><FlipVertical2 /></button>
                  </div>
                  <button className="btn" onClick={nextMistake}>
                    <SkipForward /> Next mistake <span className="kbd hide-m">N</span>
                  </button>
                  <MoveInput fen={inVariation ? ex.fen : gameFen} onMove={onBoardMove} />
                </div>
                <Timeline curve={a.winCurve} moves={moves} ply={ply} onSelect={(p) => go(p)} userColor={userColor} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="boardpage-side scroll">
          <div className="row between">
            <Seg
              label="Panel"
              value={tab}
              options={[
                ['report', 'Game report'],
                ['analysis', 'Analysis'],
              ]}
              onChange={setTab}
            />
            <a className="btn ghost sm" href={game.url} target="_blank" rel="noreferrer">
              chess.com <ExternalLink />
            </a>
          </div>

          <AnimatePresence initial={false}>
            {inVariation && !line && (
              <motion.nav
                key="crumbs"
                className="crumbs"
                aria-label="Your line"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring.smooth}
                style={{ overflow: 'hidden', marginBottom: 0 }}
              >
                <button className="crumb" onClick={() => ex.actions.goto('root')}>{ply ? `Game, move ${Math.ceil(ply / 2)}` : 'Game start'}</button>
                {crumbs.map((n) => {
                  const parent = ex.path.find((p) => p.id === n.parent);
                  const txt = parent ? plainMove(parent.fen, n.uci ?? '', undefined, 'short') : n.san;
                  return (
                    <span key={n.id} className="row nowrap" style={{ gap: 2 }}>
                      <ChevronRight className="chev" />
                      <button className={`crumb ${n.id === ex.node.id ? 'here' : ''}`} onClick={() => ex.actions.goto(n.id)} title={n.san ?? ''}>
                        {txt}
                      </button>
                    </span>
                  );
                })}
                <span className="grow" />
                <button className="btn sm subtle" onClick={() => ex.actions.reset(gameFen)}>
                  <CornerUpLeft /> Back to game
                </button>
              </motion.nav>
            )}
          </AnimatePresence>

          {tab === 'report' ? (
            <Report a={a} game={game} onMoment={(p) => go(p)} />
          ) : (
            <>
              {inVariation && !line ? (
                <VariationCard threat={ex.threat} lines={ex.lines.length} fen={ex.fen} perspective={userColor} />
              ) : (
                <MoveCard
                  key={ply}
                  m={cur}
                  userColor={userColor}
                  opening={a.opening}
                  gameId={game.id}
                  onSquares={setPointMarks}
                  onLine={playLine}
                  active={line?.which}
                />
              )}
              <EngineCard
                on={engineOn}
                onToggle={toggleEngine}
                fen={inVariation ? ex.fen : gameFen}
                lines={ex.lines}
                depth={ex.depth}
                threat={inVariation ? '' : ex.threat}
                perspective={userColor}
                onPick={(uci) => {
                  setLine(null);
                  ex.actions.play(uci.slice(0, 2), uci.slice(2, 4), uci[4]);
                }}
                onPlay={(l) => playLine({ which: 'engine', startFen: inVariation ? ex.fen : gameFen, moves: l.pv.slice(0, 10), title: 'Engine line from this position' })}
                onHover={setHoverLine}
              />
              <div className="card">
                <MoveList moves={moves} ply={inVariation ? -1 : ply} onSelect={(p) => go(p)} />
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function PlayerBar({ name, rating, color, clock }: { name: string; rating: number; color: Color; clock?: string }) {
  return (
    <div className="player-bar">
      <span className={`piece-dot ${color}`} aria-hidden="true" />
      <span>{name}</span>
      <span className="faint num">{rating}</span>
      {clock && <span className="clock">{clock}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MoveCard({ m, userColor, opening, gameId, onSquares, onLine, active }: {
  m?: AnalysedMove;
  userColor: Color;
  opening?: string;
  gameId: string;
  onSquares: (marks: Mark[]) => void;
  onLine: (l: LineMode) => void;
  active?: LineMode['which'];
}) {
  const ex = useMemo<Explanation | null>(() => {
    if (!m) return null;
    try {
      return explainMove(m);
    } catch {
      return { headline: m.comment, detail: '', tags: [], rule: '' };
    }
  }, [m]);
  if (!m || !ex) {
    return (
      <div className="card movecard">
        <p className="label">Starting position</p>
        <p className="movecard-plain">{opening ?? 'Make a move on the board, or press the right arrow to step through the game.'}</p>
        <p className="faint t-small" style={{ marginTop: 8 }}>Drag any piece to try your own ideas. The engine follows you.</p>
      </div>
    );
  }
  const mine = m.color === userColor;
  const bad = BAD.has(m.cls);
  const plain = plainMove(m.fenBefore, m.san, userColor);
  const quiet = m.cls === 'book' || m.cls === 'forced' || m.cls === 'good';
  const before = Math.round(m.winBefore);
  const after = Math.round(m.winAfter);
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
      <div className="movecard">
        <div className="movecard-head">
          <motion.span initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={spring.pop}>
            <ClassIcon cls={m.cls} size={22} />
          </motion.span>
          <span className="movecard-cls" style={{ color: quiet ? 'var(--ink-2)' : `color-mix(in oklab, ${CLASS_COLOR[m.cls]} 78%, var(--ink))` }}>
            {CLASS_LABEL[m.cls]}
          </span>
          <span className="grow" />
          <span className="san">
            {moveNo(m.ply, m.color)} {m.san}
          </span>
        </div>
        <p className="movecard-plain">{plain}.</p>
        <div className="winchange" aria-label={`${mine ? 'Your' : 'Their'} winning chances went from ${before}% to ${after}%`}>
          <span className="num">{before}%</span>
          <span className="bar" aria-hidden="true">
            <i style={{ left: 0, width: `${Math.min(before, after)}%`, background: 'var(--ink-3)' }} />
            <motion.i
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={spring.smooth}
              style={{ left: `${Math.min(before, after)}%`, width: `${Math.abs(after - before)}%`, background: after < before ? 'var(--bad-fill)' : 'var(--good-fill)', transformOrigin: after < before ? 'right' : 'left' }}
            />
          </span>
          <span className="num strong" style={{ color: after < before - 2 ? 'var(--bad)' : undefined }}>{after}%</span>
          <span>{mine ? 'your chances' : 'their chances'}</span>
        </div>
      </div>
      <div className="card-sep" />
      <div className="movecard stack" style={{ gap: 12 }}>
        <p className="strong">{ex.headline}</p>
        <Points ex={ex} onSquares={onSquares} showRule={mine} />
        {bad && m.bestSan && m.bestSan !== m.san && (
          <div className="panel-actions">
            <button className={`btn ${active === 'best' ? 'primary' : 'go'}`} onClick={() => onLine({ which: 'best', startFen: m.fenBefore, moves: m.bestLineSan.length ? m.bestLineSan : [m.bestSan], title: `Better: ${plainMove(m.fenBefore, m.bestSan, userColor)}`, base: m })}>
              <Play fill="currentColor" /> Play the better move
            </button>
            {m.replyLineSan.length > 0 && (
              <button className="btn" onClick={() => onLine({ which: 'reply', startFen: m.fenBefore, moves: [m.san, ...m.replyLineSan], title: 'What your move allowed', base: m })}>
                <TriangleAlert /> What it allowed
              </button>
            )}
          </div>
        )}
        {mine && KEY.has(m.cls) && (
          <a className="btn ghost sm" href={`#/review/${encodeURIComponent(gameId)}/learn`} style={{ alignSelf: 'flex-start' }}>
            <Target /> Practise this moment
          </a>
        )}
      </div>
    </motion.div>
  );
}

function VariationCard({ threat, lines, fen, perspective }: { threat: string; lines: number; fen: string; perspective: Color }) {
  return (
    <div className="card movecard stack" style={{ gap: 8 }}>
      <p className="label">Your line</p>
      <p className="movecard-plain" style={{ marginTop: 0 }}>You're exploring off the game.</p>
      <p className="quiet t-small">Keep dragging pieces to test ideas. The engine re-evaluates every position{lines ? '' : ' as soon as it warms up'}.</p>
      {threat && <p className="threat" style={{ margin: 0 }}>{threatLabel(fen, perspective)} {threat.charAt(0).toLowerCase() + threat.slice(1)}.</p>}
    </div>
  );
}

/** The explorer's threat is the best move for the side NOT to move, as if they could move twice. */
function threatLabel(fen: string, perspective: Color) {
  const toMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  return toMove === perspective ? 'Their threat:' : 'Your threat:';
}

function evalPill(score: Score) {
  const s = formatScore(score);
  const whiteBetter = (score.mate ?? 0) > 0 || (score.mate === undefined && (score.cp ?? 0) >= 0);
  return <span className={`ev ${whiteBetter ? 'w' : 'b'}`}>{s}</span>;
}

function EngineCard({ on, onToggle, fen, lines, depth, threat, perspective, onPick, onPlay, onHover }: {
  on: boolean;
  onToggle: () => void;
  fen: string;
  lines: ReturnType<typeof useExplorer>['lines'];
  depth: number;
  threat: string;
  perspective: Color;
  onPick: (uci: string) => void;
  onPlay: (l: ReturnType<typeof useExplorer>['lines'][number]) => void;
  onHover: (i: number | null) => void;
}) {
  return (
    <div className="card">
      <div className="engine-meta">
        <span className="strong" style={{ color: 'var(--ink)', fontSize: 'var(--fs-14)' }}>Engine</span>
        {on && <span className="num">{depth ? `depth ${depth}` : 'warming up'}</span>}
        <span className="grow" />
        <button className="switch" role="switch" aria-checked={on} aria-label="Show engine lines (E)" onClick={onToggle}>
          <span className="knob" />
        </button>
      </div>
      {on && (
        <div className="lines" onMouseLeave={() => onHover(null)}>
          {lines.length === 0
            ? [0, 1, 2].map((i) => (
                <div key={i} className="eline" style={{ cursor: 'default' }}>
                  <Skeleton h={22} r={4} />
                  <Skeleton h={14} w={`${70 - i * 12}%`} />
                </div>
              ))
            : lines.slice(0, 3).map((l, i) => {
                const rest = plainLine(fen, l.pv.slice(0, 4), perspective, 'short');
                return (
                  <motion.div key={i} layout="position" transition={spring.smooth} className={`eline ${i === 0 ? 'first' : ''}`} role="button" tabIndex={0} onMouseEnter={() => onHover(i)} onFocus={() => onHover(i)} onClick={() => onPick(l.uci)} onKeyDown={(e) => e.key === 'Enter' && onPick(l.uci)} aria-label={`${plainMove(fen, l.uci, perspective)}, evaluation ${formatScore(l.score)}. Press to play it.`}>
                    {evalPill(l.score)}
                    <span className="txt">
                      <span className="plain">{cap(plainMove(fen, l.uci, perspective))}</span>
                      <span className="cont">
                        {rest.slice(1).join(', then ') || l.san}
                        <span className="san" style={{ marginLeft: 6 }}>{l.san}</span>
                      </span>
                    </span>
                    <button
                      className="btn icon sm ghost"
                      style={{ position: 'absolute', right: 12 }}
                      aria-label="Play this line out on the board"
                      title="Play this line out"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlay(l);
                      }}
                    >
                      <Play />
                    </button>
                  </motion.div>
                );
              })}
          {threat && <p className="threat">{threatLabel(fen, perspective)} {threat.charAt(0).toLowerCase() + threat.slice(1)}.</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const ORDER: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

function Report({ a, game, onMoment }: { a: GameAnalysis; game: StoredGame; onMoment: (ply: number) => void }) {
  const mineSide = game.userColor === 'w' ? a.white : a.black;
  useEffect(() => {
    if (mineSide.counts.brilliant) {
      const t = setTimeout(() => (sfx.brilliant(), celebrateClass('brilliant')), 500);
      return () => clearTimeout(t);
    }
  }, []);
  const moments = a.moves.filter((m) => m.color === game.userColor && KEY.has(m.cls));
  const result = game.userResult === 'win' ? 'You won' : game.userResult === 'loss' ? 'You lost' : 'Draw';
  const sides = [
    { key: 'w' as const, p: game.white, s: a.white },
    { key: 'b' as const, p: game.black, s: a.black },
  ];
  return (
    <motion.div className="stack" style={{ gap: 12 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }}>
      <div className="card">
        <div className="movecard">
          <p className="label" style={{ textTransform: 'none' }}>
            {result}, {game.timeClass}
          </p>
          <p className="headline" style={{ marginTop: 6 }}>{moments.length === 0 ? 'No costly mistakes' : `${moments.length} move${moments.length === 1 ? '' : 's'} to learn from`}</p>
          {a.opening && <p className="faint t-small" style={{ marginTop: 4 }}>{a.opening}</p>}
        </div>
        <div className="card-sep" />
        <div className="report-acc">
          {sides.map((x) => (
            <div key={x.key} className={game.userColor === x.key ? 'me' : ''}>
              <div className="row nowrap" style={{ gap: 6, fontSize: 'var(--fs-13)', fontWeight: 650 }}>
                <span className={`piece-dot ${x.key}`} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.p.username}</span>
              </div>
              <div className="display big" style={{ marginTop: 6, color: game.userColor === x.key ? undefined : 'var(--ink-3)' }}>
                <Ticker value={x.s.accuracy} decimals={1} />
              </div>
              <p className="faint t-tiny">accuracy, played like <b className="num">{x.s.estRating}</b></p>
            </div>
          ))}
        </div>
        {moments.length > 0 && (
          <div style={{ padding: '0 var(--s-5) var(--s-5)' }}>
            <a className="btn go lg block" href={`#/review/${encodeURIComponent(game.id)}/learn`}>
              Learn from {moments.length === 1 ? 'this moment' : `these ${moments.length} moments`} <ArrowRight />
            </a>
          </div>
        )}
      </div>

      {moments.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head">
            <h2>Your key moments</h2>
          </div>
          <div style={{ padding: '6px 0' }}>
            {moments.map((m, i) => (
              <motion.button key={m.ply} className="moment-row" onClick={() => onMoment(m.ply)} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.16, delay: staggerDelay(i, moments.length) }}>
                <ClassIcon cls={m.cls} size={20} />
                <span className="t">{cap(plainMove(m.fenBefore, m.san, game.userColor, 'short').replace(/[+#]$/, ''))}</span>
                <span className="san">move {Math.ceil(m.ply / 2)}</span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="tally">
          <span className="faint t-tiny strong" style={{ textAlign: 'center' }}>{game.white.username.slice(0, 10)}</span>
          <span />
          <span className="faint t-tiny strong" style={{ textAlign: 'center' }}>{game.black.username.slice(0, 10)}</span>
          {ORDER.map((c) => (
            <TallyRow key={c} c={c} w={a.white.counts[c] ?? 0} b={a.black.counts[c] ?? 0} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function TallyRow({ c, w, b }: { c: Classification; w: number; b: number }) {
  const col = `color-mix(in oklab, ${CLASS_COLOR[c]} 80%, var(--ink))`;
  return (
    <>
      <span className={`n ${w ? '' : 'zero'}`} style={w ? { color: col } : undefined}>{w}</span>
      <span className="lbl">
        <ClassIcon cls={c} size={18} /> {CLASS_LABEL[c]}
      </span>
      <span className={`n ${b ? '' : 'zero'}`} style={b ? { color: col } : undefined}>{b}</span>
    </>
  );
}
