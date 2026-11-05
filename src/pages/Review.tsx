import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'motion/react';
import { Chess } from 'chess.js';
import { db } from '../lib/db';
import { enqueueAnalysis, markReviewed, useQueue } from '../lib/sync';
import type { AnalysedMove, Classification, GameAnalysis, StoredGame } from '../lib/types';
import { Board, type Arrow } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { EvalGraph } from '../components/EvalGraph';
import { MoveList } from '../components/MoveList';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { CLASS_COLOR, celebrateClass, confettiBurst, countUp, shake } from '../lib/fx';
import { sfx } from '../lib/sound';
import { formatScore } from '../lib/winpct';
import { opponentOf, selfOf } from '../lib/chesscom';
import { useStore } from '../lib/store';
import { verifyMove } from '../lib/verify';
import { MOTIF_INFO } from '../lib/classify';

const START = new Chess().fen();
const BAD = new Set<Classification>(['inaccuracy', 'mistake', 'miss', 'blunder']);
const KEY = new Set<Classification>(['mistake', 'miss', 'blunder']);
const TIPS = [
  'Every mistake you make becomes a flashcard you will see again right before you would forget it.',
  'Before each move: Checks, Captures, Threats — for both sides.',
  'Retrieval beats re-reading: trying to find the move yourself makes it stick 2× better.',
  'Brilliant = a sound sacrifice that is also the best move.',
  'A "Miss" means your opponent gifted you something and you didn\'t take it.',
  'Losses teach the most. Review them first.',
];

export function Review({ id, learn }: { id: string; learn: boolean }) {
  const game = useLiveQuery(() => db.games.get(id), [id]);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [stage, setStage] = useState<'summary' | 'review'>(learn ? 'review' : 'summary');
  const q = useQueue();

  useEffect(() => {
    let alive = true;
    db.analyses.get(id).then((a) => {
      if (!alive) return;
      if (a) setAnalysis(a);
      else enqueueAnalysis(id, true).then((x) => alive && setAnalysis(x));
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!game) return <div className="page center"><span className="spinner big" /></div>;
  if (!analysis) {
    const pct = q.current === id && q.total ? Math.round((q.done / q.total) * 100) : 0;
    return <Analysing pct={pct} queued={q.current !== id} />;
  }
  if (stage === 'summary') return <Summary a={analysis} gameId={id} onStart={(l) => (l ? (location.hash = `#/review/${encodeURIComponent(id)}/learn`) : setStage('review'))} />;
  return <Stepper a={analysis} game={game} gameId={id} learn={learn} />;
}

function Analysing({ pct, queued }: { pct: number; queued: boolean }) {
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTip((x) => (x + 1) % TIPS.length), 3500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="page center analysing">
      <div className="analysing-orb">
        <motion.div className="orb-ring" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2.4, ease: 'linear' }} />
        <span className="mono orb-pct">{pct}%</span>
      </div>
      <h2>{queued ? 'Queued for review…' : 'Stockfish 19 is reviewing your game'}</h2>
      <AnimatePresence mode="wait">
        <motion.p key={tip} className="muted tip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          💡 {TIPS[tip]}
        </motion.p>
      </AnimatePresence>
      <div className="bar thick" style={{ width: 320 }}>
        <motion.div className="bar-fill" animate={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const ORDER: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

function Summary({ a, gameId, onStart }: { a: GameAnalysis; gameId: string; onStart: (learn: boolean) => void }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId]);
  const wAcc = useRef<HTMLSpanElement>(null);
  const bAcc = useRef<HTMLSpanElement>(null);
  const wElo = useRef<HTMLSpanElement>(null);
  const bElo = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    countUp(wAcc.current, a.white.accuracy, 1, 1600);
    countUp(bAcc.current, a.black.accuracy, 1, 1600);
    countUp(wElo.current, a.white.estRating, 0, 1800);
    countUp(bElo.current, a.black.estRating, 0, 1800);
    const mine = game ? (game.userColor === 'w' ? a.white : a.black) : null;
    if (mine?.counts.brilliant) setTimeout(() => (sfx.brilliant(), confettiBurst([CLASS_COLOR.brilliant, '#fff'], 1.2)), 900);
  }, [a, game?.userColor]);
  if (!game) return null;
  const keyMoments = a.moves.filter((m) => m.color === game.userColor && KEY.has(m.cls)).length;
  const W = game.white;
  const B = game.black;
  return (
    <div className="page summary">
      <div className="summary-card card">
        <div className="eyebrow">GAME REVIEW</div>
        <h1 className="h1">{a.opening ?? 'Game'} </h1>
        <div className="sum-players">
          {[
            { p: W, acc: wAcc, elo: wElo, me: game.userColor === 'w', side: 'white' },
            { p: B, acc: bAcc, elo: bElo, me: game.userColor === 'b', side: 'black' },
          ].map((x) => (
            <div key={x.side} className={`sum-player ${x.me ? 'me' : ''}`}>
              <div className="sum-name">
                <span className={`dot ${x.side}`} /> {x.p.username} <span className="muted mono">({x.p.rating})</span>
              </div>
              <div className="sum-acc mono"><span ref={x.acc}>0</span></div>
              <div className="muted small">accuracy</div>
              <div className="sum-elo mono">≈ <span ref={x.elo}>0</span></div>
              <div className="muted small">est. game rating</div>
            </div>
          ))}
        </div>
        <div className="sum-table">
          {ORDER.map((c, i) => (
            <motion.div key={c} className="sum-row" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }}>
              <span className="mono sum-n" style={{ color: CLASS_COLOR[c] }}>{a.white.counts[c]}</span>
              <span className="sum-cls">
                <ClassIcon cls={c} size={22} /> {CLASS_LABEL[c]}
              </span>
              <span className="mono sum-n" style={{ color: CLASS_COLOR[c] }}>{a.black.counts[c]}</span>
            </motion.div>
          ))}
        </div>
        <div className="sum-phases">
          {(['opening', 'middlegame', 'endgame'] as const).map((p) => (
            <div key={p} className="phase">
              <PhaseDot v={a.white.phases[p]} />
              <span className="muted">{p}</span>
              <PhaseDot v={a.black.phases[p]} />
            </div>
          ))}
        </div>
        <div className="sum-actions">
          {keyMoments > 0 && (
            <motion.button className="btn primary big pulse" onClick={() => onStart(true)} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}>
              🧠 Learn mode — fix your {keyMoments} key moment{keyMoments > 1 ? 's' : ''}
            </motion.button>
          )}
          <motion.button className={`btn ${keyMoments ? '' : 'primary'} big`} onClick={() => onStart(false)} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}>
            ▶ Step through the game
          </motion.button>
          <a className="btn ghost" href={game.url} target="_blank" rel="noreferrer">View on chess.com ↗</a>
        </div>
      </div>
    </div>
  );
}

function PhaseDot({ v }: { v: number | null }) {
  if (v === null) return <span className="phase-dot muted">—</span>;
  const c = v >= 90 ? '#7fc241' : v >= 75 ? '#98c44a' : v >= 60 ? '#f5c430' : v >= 45 ? '#ff9a3c' : '#f2382f';
  return <span className="phase-dot mono" style={{ background: c }}>{v}</span>;
}

type Retry = { status: 'idle' | 'thinking' | 'wrong' | 'right' | 'revealed'; tries: number; msg?: string; userMove?: [string, string]; fen?: string };

function Stepper({ a, game, gameId, learn }: { a: GameAnalysis; game: StoredGame; gameId: string; learn: boolean }) {
  const moves = a.moves;
  const userColor = game.userColor;
  const keyMoments = useMemo(() => moves.filter((m) => m.color === userColor && KEY.has(m.cls)), [moves, userColor]);
  const [ply, setPly] = useState(learn && keyMoments.length ? keyMoments[0].ply - 1 : 0);
  const [retry, setRetry] = useState<Retry | null>(learn && keyMoments.length ? { status: 'idle', tries: 0 } : null);
  const [learnIdx, setLearnIdx] = useState(0);
  const [learnDone, setLearnDone] = useState(false);
  const [showBest, setShowBest] = useState(true);
  const [nonce, setNonce] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const reviewedRef = useRef(false);
  const st = useStore();

  const cur: AnalysedMove | undefined = moves[ply - 1];
  const retryMove: AnalysedMove | undefined = retry ? moves[ply] : undefined; // in retry we sit BEFORE the move

  const go = useCallback(
    (p: number, fromStep = false) => {
      const np = Math.max(0, Math.min(moves.length, p));
      setRetry(null);
      setPly(np);
      const m = moves[np - 1];
      if (!m || !fromStep) return;
      if (m.san.includes('+')) sfx.check();
      else if (m.san.includes('x')) sfx.capture();
      else sfx.move();
      if (m.cls === 'brilliant') {
        setTimeout(() => sfx.brilliant(), 150);
        celebrateClass('brilliant');
      } else if (m.cls === 'great') {
        setTimeout(() => sfx.great(), 150);
        celebrateClass('great');
      } else if (m.cls === 'blunder' && m.color === userColor) {
        sfx.blunder();
        shake(boardRef.current, 6);
      }
    },
    [moves, userColor],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (retry) return;
      if (e.key === 'ArrowRight') go(ply + 1, true);
      else if (e.key === 'ArrowLeft') go(ply - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(moves.length);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [ply, go, retry, moves.length]);

  useEffect(() => {
    if (!reviewedRef.current && (ply === moves.length || learnDone)) {
      reviewedRef.current = true;
      const k = `reviewed:${gameId}`;
      if (!localStorage.getItem(k)) {
        localStorage.setItem(k, '1');
        void markReviewed();
        st.addXP(25);
      }
    }
  }, [ply, learnDone]);

  const orientation = userColor === 'w' ? 'white' : 'black';

  // --- Retry / Learn-mode logic ---
  const startRetry = () => {
    if (!cur) return;
    setPly(cur.ply - 1);
    setRetry({ status: 'idle', tries: 0 });
  };

  const onRetryMove = async (from: string, to: string, promo?: string) => {
    if (!retryMove || !retry) return;
    setRetry({ ...retry, status: 'thinking', userMove: [from, to] });
    const res = await verifyMove(retryMove.fenBefore, from + to + (promo ?? ''), retryMove.bestUci, retryMove.winBefore);
    const rect = boardRef.current?.getBoundingClientRect();
    const at = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 } : undefined;
    if (res.ok) {
      sfx.correct();
      confettiBurst(['#7fc241', '#ffd34d', '#fff'], retry.tries === 0 ? 1.2 : 0.7);
      st.addXP(retry.tries === 0 ? 20 : 10, at);
      st.progressQuest('retry', 1);
      st.stat('retriesFixed', 1);
      // retrieving it now counts as a successful drill rep too
      const d = await db.drills.get(`${gameId}:${retryMove.ply}`);
      if (d && d.reps === 0) await db.drills.update(d.id, { lastSeen: Date.now() });
      setRetry({ status: 'right', tries: retry.tries + 1, fen: res.fenAfter, userMove: [from, to], msg: res.exact ? `${res.san} — exactly the engine's move!` : `${res.san} works too! (within ${res.loss.toFixed(1)}% of best)` });
    } else {
      sfx.wrong();
      shake(boardRef.current, 12);
      setNonce((n) => n + 1);
      setRetry({ status: retry.tries >= 1 ? 'revealed' : 'wrong', tries: retry.tries + 1, msg: `${res.san} isn't it — it drops ${res.loss.toFixed(0)}% winning chances.` });
    }
  };

  const nextMoment = () => {
    const ni = learnIdx + 1;
    if (ni >= keyMoments.length) {
      setLearnDone(true);
      setRetry(null);
      setPly(moves.length);
      sfx.levelUp();
      confettiBurst(['#ffd34d', '#1fd1b9', '#5b8def'], 1.6);
      return;
    }
    setLearnIdx(ni);
    setPly(keyMoments[ni].ply - 1);
    setRetry({ status: 'idle', tries: 0 });
    setNonce((n) => n + 1);
  };

  // --- Board state ---
  let fen = ply === 0 ? START : moves[ply - 1].fenAfter;
  let lastMove: [string, string] | undefined = cur ? [cur.from, cur.to] : undefined;
  const arrows: Arrow[] = [];
  let badge: { square: string; cls: Classification } | null = cur ? { square: cur.to, cls: cur.cls } : null;
  if (retry && retryMove) {
    badge = null;
    if (retry.status === 'right' && retry.fen) {
      fen = retry.fen;
      lastMove = retry.userMove;
    }
    if (retry.status === 'revealed' || retry.status === 'right')
      arrows.push({ from: retryMove.bestUci.slice(0, 2), to: retryMove.bestUci.slice(2, 4), brush: 'best' });
  } else if (cur && showBest && BAD.has(cur.cls) && cur.bestUci !== cur.uci) {
    arrows.push({ from: cur.bestUci.slice(0, 2), to: cur.bestUci.slice(2, 4), brush: 'best' });
  }
  const evalScore = retry ? retryMove?.scoreBefore : cur ? cur.scoreAfter : { cp: 20 };
  const top = userColor === 'w' ? game.black : game.white;
  const bottom = selfOf(game);

  return (
    <div className="review">
      <div className="review-board-col">
        <div className="player-row"><span className={`dot ${userColor === 'w' ? 'black' : 'white'}`} /> {top.username} <span className="muted mono">({top.rating})</span></div>
        <div className="board-row" ref={boardRef}>
          <EvalBar score={evalScore} orientation={orientation} />
          <Board
            fen={fen}
            orientation={orientation}
            lastMove={lastMove}
            arrows={arrows}
            badge={badge}
            movable={!!retry && (retry.status === 'idle' || retry.status === 'wrong')}
            onMove={onRetryMove}
            nonce={nonce}
          />
        </div>
        <div className="player-row"><span className={`dot ${userColor === 'w' ? 'white' : 'black'}`} /> {bottom.username} <span className="muted mono">({bottom.rating})</span></div>
        <EvalGraph curve={a.winCurve} moves={moves} ply={ply} onSelect={(p) => go(p)} userColor={userColor} />
      </div>

      <div className="review-side">
        {learn && !learnDone && keyMoments.length > 0 && (
          <div className="learn-progress">
            {keyMoments.map((m, i) => (
              <span key={m.ply} className={`lp-dot ${i < learnIdx ? 'done' : i === learnIdx ? 'cur' : ''}`} style={{ ['--c' as string]: CLASS_COLOR[m.cls] }} />
            ))}
            <span className="muted small">Key moment {learnIdx + 1}/{keyMoments.length}</span>
          </div>
        )}

        <AnimatePresence mode="wait">
          {learnDone ? (
            <motion.div key="done" className="coach card done-card" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <div className="big-emoji">🏁</div>
              <h2>Key moments cleared!</h2>
              <p className="muted">All {keyMoments.length} positions are now in your mistake bank — you'll see them again just before you'd forget them.</p>
              <div className="row gap">
                <a className="btn primary" href="#/train/session">Train now</a>
                <button className="btn" onClick={() => go(0)}>Replay game</button>
              </div>
            </motion.div>
          ) : retry && retryMove ? (
            <motion.div key={`retry-${ply}-${retry.status}`} className={`coach card retry ${retry.status}`} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <div className="coach-head">
                <span className="coach-avatar">🎯</span>
                <div>
                  <div className="coach-title">{retry.status === 'right' ? 'Nailed it!' : retry.status === 'revealed' ? 'Here was the move' : 'Find a better move'}</div>
                  <div className="muted small">
                    You played <b>{retryMove.san}</b> here ({CLASS_LABEL[retryMove.cls].toLowerCase()}). {retryMove.color === 'w' ? 'White' : 'Black'} to move.
                  </div>
                </div>
              </div>
              {retry.status === 'thinking' && <p className="muted"><span className="spinner" /> Checking with Stockfish…</p>}
              {retry.msg && <p className={retry.status === 'right' ? 'good' : 'bad'}>{retry.msg}</p>}
              {retry.status === 'idle' && retryMove.motifs?.length > 0 && (
                <p className="hint muted small">Hint: think about <b>{MOTIF_INFO[retryMove.motifs[0]].label.toLowerCase()}</b>.</p>
              )}
              {(retry.status === 'revealed' || retry.status === 'right') && (
                <p className="small">Best: <b>{retryMove.bestSan}</b> <span className="muted">— {retryMove.bestLineSan.slice(0, 5).join(' ')}</span></p>
              )}
              <div className="row gap">
                {retry.status === 'wrong' && <button className="btn" onClick={() => setRetry({ status: 'revealed', tries: retry.tries, msg: retry.msg })}>Show me</button>}
                {(retry.status === 'right' || retry.status === 'revealed') &&
                  (learn ? (
                    <button className="btn primary" onClick={nextMoment}>{learnIdx + 1 >= keyMoments.length ? 'Finish ✓' : 'Next moment →'}</button>
                  ) : (
                    <button className="btn primary" onClick={() => go(retryMove.ply)}>Continue</button>
                  ))}
                {!learn && retry.status !== 'right' && <button className="btn ghost" onClick={() => go(retryMove.ply)}>Cancel</button>}
              </div>
            </motion.div>
          ) : (
            <motion.div key={`c-${ply}`} className="coach card" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} style={{ ['--accent' as string]: cur ? CLASS_COLOR[cur.cls] : '#5b8def' }}>
              {cur ? (
                <>
                  <div className="coach-head">
                    <ClassIcon cls={cur.cls} size={36} />
                    <div>
                      <div className="coach-title" style={{ color: CLASS_COLOR[cur.cls] }}>
                        {cur.san} is {['inaccuracy', 'excellent'].includes(cur.cls) ? 'an' : 'a'} {CLASS_LABEL[cur.cls].toLowerCase()}{['brilliant', 'great'].includes(cur.cls) ? ' move' : ''}
                      </div>
                      <div className="mono muted small">eval {formatScore(cur.scoreAfter)}</div>
                    </div>
                  </div>
                  <p>{cur.comment}</p>
                  {BAD.has(cur.cls) && (
                    <p className="small">Best line: <b>{cur.bestLineSan.slice(0, 6).join(' ')}</b></p>
                  )}
                  {cur.motifs?.length > 0 && cur.color === userColor && (
                    <div className="motifs">
                      {cur.motifs.map((m) => <span key={m} className="motif">{MOTIF_INFO[m].emoji} {MOTIF_INFO[m].label}</span>)}
                    </div>
                  )}
                  <div className="row gap">
                    {BAD.has(cur.cls) && cur.color === userColor && <button className="btn primary" onClick={startRetry}>↺ Retry</button>}
                    {BAD.has(cur.cls) && <button className="btn ghost" onClick={() => setShowBest((s) => !s)}>{showBest ? 'Hide' : 'Show'} best</button>}
                  </div>
                </>
              ) : (
                <>
                  <div className="coach-head"><span className="coach-avatar">♟️</span><div className="coach-title">{a.opening ?? 'Starting position'}</div></div>
                  <p className="muted">Use → / ← or the buttons to step through. Your mistakes have a Retry button — find the better move yourself.</p>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="controls">
          <button className="btn icon" onClick={() => go(0)} disabled={!!retry}>⏮</button>
          <button className="btn icon" onClick={() => go(ply - 1)} disabled={!!retry}>◀</button>
          <button className="btn icon primary" onClick={() => go(ply + 1, true)} disabled={!!retry}>▶</button>
          <button className="btn icon" onClick={() => go(moves.length)} disabled={!!retry}>⏭</button>
          <span className="spacer" />
          <button
            className="btn ghost small"
            disabled={!!retry}
            onClick={() => {
              const next = moves.find((m) => m.ply > ply && m.color === userColor && BAD.has(m.cls));
              if (next) go(next.ply, true);
            }}
          >
            Next mistake ⤼
          </button>
        </div>
        <MoveList moves={moves} ply={ply} onSelect={(p) => !retry && go(p)} />
        <div className="muted small opp-line">vs {opponentOf(game).username} · depth {a.depth} · {game.timeClass}</div>
      </div>
    </div>
  );
}
