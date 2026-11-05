import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, CornerUpLeft, Eye, Lightbulb, Play, RotateCcw, X } from 'lucide-react';
import type { GameAnalysis, StoredGame } from '../lib/types';
import { useLearnFlow, type LearnResult } from '../lib/learnflow';
import { useStore } from '../lib/store';
import { confettiBurst } from '../lib/fx';
import { sfx } from '../lib/sound';
import { markReviewed } from '../lib/sync';
import { db } from '../lib/db';
import { gradeFrom, schedule } from '../lib/srs';
import { useHotkeys } from '../lib/hotkeys';
import { Board, type Mark } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { MoveInput } from '../components/MoveInput';
import { Points } from '../components/Explain';
import { HintDots, LineReplay, Status, useReplayStart, useStickyHighlights } from '../components/Puzzle';
import { Ticker } from '../components/Ticker';
import { cap, plainMove } from '../components/plain';
import { spring, staggerDelay } from '../components/motion';
import { ContextLegend, mistakeArrow, useDrillContext, useIntroMove } from '../components/MoveContext';

const RESULT_LABEL: Record<LearnResult, string> = { 'first-try': 'Found it', 'with-help': 'With help', failed: 'Shown' };

/**
 * Key-moment trainer. Retrieval first (find the move yourself), then corrective feedback:
 * the answer, why it works (squares light up as you read), the line playing out, then you play it.
 * You can browse the game, skip, or go back at any point. Nothing auto-advances.
 */
export function LearnMode({ a, game }: { a: GameAnalysis; game: StoredGame }) {
  const st = useStore();
  const stageRef = useRef<HTMLDivElement>(null);
  const [fb, setFb] = useState<{ kind: 'good' | 'bad'; key: number } | null>(null);
  const [pointMarks, setPointMarks] = useState<Mark[]>([]);
  const flow = useLearnFlow(a, game.userColor, {
    onResult: (m, result, info) => {
      if (result === 'first-try') {
        sfx.correct();
        confettiBurst(['#3fb45a', '#f2b705', '#ffffff'], 0.8);
        st.addXP(20);
      } else if (result === 'with-help') {
        sfx.great();
        st.addXP(8);
      }
      if (result !== 'failed') {
        st.progressQuest('retry', 1);
        st.stat('retriesFixed', 1);
      }
      // The attempt is a spaced-repetition review of this mistake; hints lower the grade.
      void db.drills
        .get(`${game.id}:${m.ply}`)
        .then((d) => d && db.drills.put(schedule(d, gradeFrom(result !== 'failed', result === 'first-try', 15000, { hintsUsed: info?.hintsUsed ?? 0, mode: 'learn' }))));
    },
  });
  const { moments, index, phase, board, actions } = flow;
  const m = moments[index];
  const lastFeedback = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (phase === 'wrong' && flow.feedback !== lastFeedback.current) {
      sfx.wrong();
      setFb({ kind: 'bad', key: Date.now() });
    }
    if (phase === 'solved') setFb({ kind: 'good', key: Date.now() });
    lastFeedback.current = flow.feedback;
  }, [phase, flow.feedback]);

  useEffect(() => {
    if (phase !== 'explain' && phase !== 'solved') setPointMarks([]);
  }, [phase, index]);

  useEffect(() => {
    if (phase === 'complete') {
      const k = `reviewed:${game.id}`;
      if (!localStorage.getItem(k)) {
        localStorage.setItem(k, '1');
        void markReviewed();
        st.addXP(25);
      }
      sfx.levelUp();
    }
  }, [phase]);

  const solving = phase === 'solve' || phase === 'intro' || phase === 'wrong';
  useHotkeys(
    {
      ArrowLeft: () => (phase === 'replay' ? actions.replayStep(-1) : phase !== 'checking' && phase !== 'complete' && actions.stepContext(-1)),
      ArrowRight: () => (phase === 'replay' ? actions.replayStep(1) : phase !== 'checking' && phase !== 'complete' && actions.stepContext(1)),
      h: () => { if (solving && flow.hintsUsed < 3) { intro.cancel(); actions.nextHint(); } },
      s: () => solving && actions.giveUp(),
      Enter: () => {
        if (phase === 'explain' || phase === 'solved') actions.beginReplay();
      },
      n: () => flow.canNextMoment && actions.nextMoment(),
    },
    [phase, flow.hintsUsed, flow.canNextMoment, actions],
  );

  const replayStart = useReplayStart(phase === 'replay', flow.replay.step, board.fen, index);
  const mm0 = moments[index];
  const ctx = useDrillContext(mm0 ? { gameId: game.id, ply: mm0.ply, fen: mm0.fenBefore, playedSan: mm0.san, color: mm0.color } : undefined);
  const atMoment = !!mm0 && flow.contextPly === mm0.ply - 1 && board.fen === mm0.fenBefore;
  const intro = useIntroMove(index, ctx, board.fen, solving && atMoment, flow.attempts === 0 && flow.hintsUsed === 0);
  const hintSquares = useStickyHighlights(board.highlights, phase === 'solve' || phase === 'wrong' || phase === 'checking' || phase === 'intro', `${index}:${flow.contextPly}`);

  if (!moments.length) {
    return (
      <div className="page narrow">
        <div className="empty">
          <h2>No mistakes to learn from</h2>
          <p className="quiet">Every move you made in this game held up. Step through it to see your best moments.</p>
          <a className="btn primary" href={`#/review/${encodeURIComponent(game.id)}`}>Back to the review</a>
        </div>
      </div>
    );
  }

  const browsing = phase !== 'replay' && phase !== 'complete' && flow.contextPly !== (m?.ply ?? 1) - 1;
  const answerShown = phase === 'explain' || phase === 'replay' || phase === 'confirm' || phase === 'solved';
  const ex = flow.explanation;
  const opp = game.userColor === 'w' ? game.black.username : game.white.username;
  const doneCount = flow.results.filter(Boolean).length;
  const bestPlain = m ? plainMove(m.fenBefore, m.bestSan, game.userColor) : '';

  return (
    <div className="page wide visual-trainer">
      <div className="boardpage">
        <div className="boardpage-main board-bleed" ref={stageRef}>
          <div className="trainer-top">
            <div className="moment-steps" role="tablist" aria-label="Key moments">
              {moments.map((mm, i) => {
                const r = flow.results[i];
                return (
                  <motion.button
                    key={mm.ply}
                    role="tab"
                    className={`moment-step ${i === index ? 'cur' : r ? (r === 'failed' ? 'failed' : 'ok') : ''}`}
                    onClick={() => actions.goToMoment(i)}
                    aria-label={`Moment ${i + 1}, move ${Math.ceil(mm.ply / 2)}${r ? `, ${RESULT_LABEL[r]}` : ''}`}
                    aria-selected={i === index}
                    layout
                    transition={spring.snappy}
                  >
                    {r && i !== index ? r === 'failed' ? <X strokeWidth={3} /> : <Check strokeWidth={3} /> : i + 1}
                  </motion.button>
                );
              })}
            </div>
            <span className="faint num t-small">
              {doneCount} of {moments.length} done
            </span>
          </div>
          {!answerShown && atMoment && phase !== 'complete' && (
            <div className="ctx-mobile">
              <ContextLegend ctx={ctx} cls={m.cls} turn={m.color} onReplay={solving ? intro.replay : undefined} onReplayMine={solving ? intro.replayMine : undefined} showing={intro.showing} compact />
            </div>
          )}
          <div className="board-row">
            <EvalBar score={answerShown ? m.scoreBefore : undefined} orientation={board.orientation} />
            <Board
              fen={atMoment ? intro.fen : board.fen}
              orientation={board.orientation}
              labelSquares
              lastMoveTone={intro.showing === 'mine' ? 'mine' : 'theirs'}
              lastMove={intro.animating ? intro.lastMove : board.lastMove ?? (atMoment ? intro.lastMove : undefined)}
              arrows={intro.animating ? intro.showing === 'mine' ? mistakeArrow(ctx) : [] : atMoment && ['solve', 'intro', 'checking', 'wrong', 'explain'].includes(phase) ? [...mistakeArrow(ctx), ...board.arrows] : board.arrows}
              highlight={hintSquares}
              marks={pointMarks}
              movable={board.movable && !intro.animating}
              feedback={fb}
              nonce={flow.attempts * 1000 + index}
              sound
              onMove={(f, t, p) => (phase === 'confirm' ? actions.confirmMove(f, t, p) : void actions.submitMove(f, t, p))}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            {phase === 'replay' && flow.plan ? (
              <LineReplay
                key={index}
                step={flow.replay.step}
                total={flow.replay.total}
                goTo={actions.replayTo}
                line={flow.plan.line}
                startFen={replayStart ?? m.fenBefore}
                perspective={game.userColor}
                notes={flow.plan.lineExplained.map((x) => x.note)}
              />
            ) : phase !== 'complete' ? (
              <div className="under-board" style={{ marginTop: 0 }}>
                <div className="transport" role="group" aria-label="Browse the game before this moment">
                  <button className="btn icon" onClick={() => actions.stepContext(-1)} disabled={phase === 'checking'} aria-label="Earlier in the game (left arrow)">
                    <ChevronLeft />
                  </button>
                  <button className="btn icon" onClick={() => actions.stepContext(1)} disabled={phase === 'checking' || !browsing} aria-label="Later in the game (right arrow)">
                    <ChevronRight />
                  </button>
                </div>
                {browsing ? (
                  <button className="btn go" onClick={actions.backToPuzzle}>
                    <CornerUpLeft /> Back to the moment
                  </button>
                ) : (
                  board.movable && !intro.animating && <MoveInput fen={board.fen} onMove={(f, t, p) => (phase === 'confirm' ? actions.confirmMove(f, t, p) : void actions.submitMove(f, t, p))} />
                )}
              </div>
            ) : null}
            {browsing && <p className="faint t-small" style={{ marginTop: 8 }}>You're looking at an earlier position. Your progress on this moment is kept.</p>}
          </div>
        </div>

        <aside className="boardpage-side scroll">
          <div className="card">
            {phase === 'complete' ? (
              <Complete moments={moments} results={flow.results} gameId={game.id} userColor={game.userColor} />
            ) : (
              <>
                <div className="coach-card">
                  <div className="context-line">
                    <ClassIcon cls={m.cls} size={16} />
                    <span>
                      {CLASS_LABEL[m.cls]} on move {Math.ceil(m.ply / 2)} against {opp}
                    </span>
                  </div>

                  {!answerShown ? (
                    atMoment ? (
                      <div className="ctx-desktop">
                        <ContextLegend ctx={ctx} cls={m.cls} turn={m.color} onReplay={solving ? intro.replay : undefined} onReplayMine={solving ? intro.replayMine : undefined} showing={intro.showing} />
                      </div>
                    ) : <p className="quiet">Browse the moves, then return to the moment to try again.</p>
                  ) : (
                    <p className="headline">{ex?.headline ?? cap(bestPlain)}</p>
                  )}

                  {phase === 'checking' && (
                    <Status tone="info" id="checking" busy>
                      Checking your move with Stockfish
                    </Status>
                  )}
                  {phase === 'wrong' && flow.feedback && (
                    <Status tone="bad" id={`wrong-${flow.attempts}`}>
                      {flow.feedback}
                    </Status>
                  )}
                  {solving && flow.hint && (
                    <Status tone="hint" id={`hint-${flow.hint.level}`}>
                      <p className="strong">
                        Hint {flow.hint.level} of 3 <HintDots used={flow.hintsUsed} />
                      </p>
                      <p>{flow.hint.text}</p>
                    </Status>
                  )}
                  {phase === 'solved' && (
                    <Status tone="good" id="solved">
                      <p className="strong">That's it: {bestPlain.charAt(0).toLowerCase() + bestPlain.slice(1)}.</p>
                    </Status>
                  )}
                  {phase === 'confirm' && (
                    <Status tone="info" id={`confirm-${flow.feedback ?? ''}`}>
                      <p className="strong">Now you play it.</p>
                      <p>{flow.feedback ?? 'Make the first move yourself. Doing it once now is what makes it stick next time.'}</p>
                    </Status>
                  )}

                  {(phase === 'explain' || phase === 'solved') && ex && <Points ex={ex} onSquares={setPointMarks} />}
                  {phase === 'replay' && flow.plan?.idea && <p className="quiet">{flow.plan.idea}</p>}

                  {(phase === 'solved' || (phase === 'replay' && flow.replay.step === flow.replay.total)) && flow.recovered && flow.recovered.to > flow.recovered.from && (
                    <motion.p className="recovered" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring.pop}>
                      +<Ticker className="display" value={Math.round(flow.recovered.to - flow.recovered.from)} />% winning chances back
                    </motion.p>
                  )}

                  <div className="panel-actions">
                    {solving && (
                      <>
                        <button className="btn" onClick={() => { intro.cancel(); actions.nextHint(); }} disabled={flow.hintsUsed >= 3}>
                          <Lightbulb /> {flow.hintsUsed === 0 ? 'Hint' : flow.hintsUsed < 3 ? 'More specific' : 'No more hints'} <span className="kbd hide-m">H</span>
                        </button>
                        <button className="btn ghost" onClick={actions.giveUp}>
                          <Eye /> Show me <span className="kbd hide-m">S</span>
                        </button>
                      </>
                    )}
                    {(phase === 'explain' || phase === 'solved') && (
                      <button className={`btn ${phase === 'explain' ? 'go' : ''}`} onClick={actions.beginReplay} autoFocus={phase === 'explain'}>
                        <Play fill="currentColor" /> Watch the line
                      </button>
                    )}
                    {phase === 'solved' && (
                      <button className="btn go" onClick={actions.nextMoment} disabled={!flow.canNextMoment} autoFocus>
                        {index + 1 < moments.length ? 'Next moment' : 'Finish'} <ArrowRight />
                      </button>
                    )}
                    {phase === 'replay' && (
                      <button className="btn go" onClick={actions.beginConfirm} disabled={flow.replay.step < Math.min(2, flow.replay.total)}>
                        {flow.replay.step < Math.min(2, flow.replay.total) ? 'Watch a couple of moves first' : 'I get it, let me play it'}
                      </button>
                    )}
                    {phase === 'confirm' && (
                      <button className="btn ghost" onClick={actions.watchAgain}>
                        <RotateCcw /> Watch again
                      </button>
                    )}
                  </div>
                </div>
                <div className="panel-foot">
                  {index > 0 && (
                    <button className="btn ghost sm" onClick={actions.prevMoment}>
                      <ArrowLeft /> Previous
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={actions.skipMoment} disabled={phase === 'checking'}>
                    Skip
                  </button>
                  {flow.canNextMoment && phase !== 'solved' && (
                    <button className="btn sm" onClick={actions.nextMoment}>
                      {index + 1 < moments.length ? 'Next moment' : 'Finish'}
                    </button>
                  )}
                  <span className="kbd-hints hide-m">
                    <span>
                      <span className="kbd">←</span>
                      <span className="kbd">→</span> browse
                    </span>
                    <span>
                      <span className="kbd">/</span> type
                    </span>
                  </span>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Complete({ moments, results, gameId, userColor }: { moments: GameAnalysis['moves']; results: LearnResult[]; gameId: string; userColor: 'w' | 'b' }) {
  const firstTry = results.filter((r) => r === 'first-try').length;
  return (
    <div className="coach-card">
      <p className="label">All moments done</p>
      <p className="headline">
        {firstTry === moments.length ? 'Every one, first time.' : `${firstTry} of ${moments.length} found on your own.`}
      </p>
      <div className="stack" style={{ gap: 0 }}>
        {moments.map((mm, i) => (
          <motion.div
            key={mm.ply}
            className="quest"
            style={{ gridTemplateColumns: '22px minmax(0,1fr) auto' }}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.16, delay: staggerDelay(i, moments.length) }}
          >
            <ClassIcon cls={mm.cls} size={18} />
            <span className="t-small">
              Better was <b>{plainMove(mm.fenBefore, mm.bestSan, userColor, 'short').replace(/[+#]$/, '').toLowerCase()}</b>
            </span>
            <span className={`chip ${results[i] === 'failed' ? 'bad' : results[i] ? 'good' : ''}`}>{results[i] ? RESULT_LABEL[results[i]] : 'Skipped'}</span>
          </motion.div>
        ))}
      </div>
      <p className="quiet t-small">These positions are in your training now. They come back right before you'd forget them.</p>
      <div className="panel-actions">
        <a className="btn go lg" href="#/train/session">
          Train now <ArrowRight />
        </a>
        <a className="btn lg" href={`#/review/${encodeURIComponent(gameId)}`}>Back to the review</a>
      </div>
    </div>
  );
}
