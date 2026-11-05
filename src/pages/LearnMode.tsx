import { useEffect, useRef, useState } from 'react';
import type { GameAnalysis, StoredGame } from '../lib/types';
import { useLearnFlow, type LearnResult } from '../lib/learnflow';
import { Board } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { useStore } from '../lib/store';
import { confettiBurst, countUp, shake } from '../lib/fx';
import { sfx } from '../lib/sound';
import { markReviewed } from '../lib/sync';
import { db } from '../lib/db';
import { gradeFrom, schedule } from '../lib/srs';

const RESULT_LABEL: Record<LearnResult, string> = { 'first-try': 'Found it', 'with-help': 'With help', failed: 'Shown' };

const TITLE: Record<string, string> = {
  intro: 'Find a better move',
  solve: 'Find a better move',
  checking: 'Checking…',
  wrong: 'Not quite',
  solved: 'That’s it',
  explain: 'Here’s what you missed',
  replay: 'Walk through it',
  confirm: 'Now you play it',
  complete: 'All moments done',
};

/**
 * Key-moment trainer. Retrieval first (find the move yourself), then corrective feedback:
 * the answer, the rule behind it, step through the line, and play it yourself.
 * You can browse the game, skip, or go back at any point. Nothing auto-advances.
 */
export function LearnMode({ a, game }: { a: GameAnalysis; game: StoredGame }) {
  const st = useStore();
  const stageRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<HTMLSpanElement>(null);
  const [showRecovered, setShowRecovered] = useState(false);
  const flow = useLearnFlow(a, game.userColor, {
    onResult: (m, result, info) => {
      if (result === 'first-try') {
        sfx.correct();
        confettiBurst(['#5baa2e', '#f2b705', '#ffffff'], 1);
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
      shake(stageRef.current, 10);
    }
    lastFeedback.current = flow.feedback;
  }, [phase, flow.feedback]);

  // The payoff: watch the winning chances you threw away come back.
  useEffect(() => {
    if ((phase === 'solved' || (phase === 'replay' && flow.replay.step === flow.replay.total)) && flow.recovered) {
      setShowRecovered(true);
      requestAnimationFrame(() => countUp(recRef.current, Math.max(0, flow.recovered!.to - flow.recovered!.from), 0, 900));
    } else if (phase === 'solve' || phase === 'wrong') setShowRecovered(false);
  }, [phase, flow.replay.step, index]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'replay') {
        if (e.key === 'ArrowRight') actions.replayStep(1);
        if (e.key === 'ArrowLeft') actions.replayStep(-1);
      } else if (phase !== 'checking' && phase !== 'complete') {
        if (e.key === 'ArrowLeft') actions.stepContext(-1);
        if (e.key === 'ArrowRight') actions.stepContext(1);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [phase, actions]);

  if (!moments.length) {
    return (
      <div className="page narrow">
        <h1 className="display t-1">No mistakes to learn from</h1>
        <p className="quiet" style={{ margin: '10px 0 20px' }}>Every move you made in this game held up. Step through it to see your best moments.</p>
        <a className="key ink" href={`#/review/${encodeURIComponent(game.id)}`}>Back to the review</a>
      </div>
    );
  }

  const moveNo = m ? `${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '…'}` : '';
  const browsing = phase !== 'replay' && phase !== 'complete' && flow.contextPly !== (m?.ply ?? 1) - 1;
  const answerShown = phase === 'explain' || phase === 'replay' || phase === 'confirm' || phase === 'solved';
  const ex = flow.explanation;

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 18, gap: 14 }}>
        <div className="progress-ticks" aria-label="Key moments">
          {moments.map((mm, i) => {
            const r = flow.results[i];
            return (
              <button
                key={mm.ply}
                className={`moment-tick ${i === index ? 'cur' : r ? (r === 'failed' ? 'failed' : 'ok') : ''}`}
                onClick={() => actions.goToMoment(i)}
                aria-label={`Moment ${i + 1}: ${mm.san}${r ? `, ${RESULT_LABEL[r]}` : ''}`}
                aria-current={i === index ? 'step' : undefined}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <span className="faint num t-small">{flow.results.filter(Boolean).length} of {moments.length} done</span>
      </div>

      <div className="review">
        <div className="stage" ref={stageRef}>
          <div className="board-line">
            <EvalBar score={answerShown ? m.scoreBefore : m.scoreAfter} orientation={board.orientation} />
            <Board
              fen={board.fen}
              orientation={board.orientation}
              lastMove={board.lastMove}
              arrows={board.arrows}
              highlight={board.highlights}
              movable={board.movable}
              onMove={(f, t, p) => (phase === 'confirm' ? actions.confirmMove(f, t, p) : void actions.submitMove(f, t, p))}
            />
          </div>
          <div className="transport on-stage" style={{ marginTop: 14 }}>
            {phase === 'replay' ? (
              <>
                <button className="key sq" onClick={() => actions.replayTo(0)} aria-label="Start of line">⏮</button>
                <button className="key sq" onClick={() => actions.replayStep(-1)} aria-label="Previous move in line">◀</button>
                <button className="key sq go" onClick={() => actions.replayStep(1)} aria-label="Next move in line">▶</button>
                <span className="num" style={{ opacity: 0.75, marginLeft: 6 }}>Move {flow.replay.step} of {flow.replay.total}</span>
              </>
            ) : phase !== 'complete' ? (
              <>
                <button className="key" onClick={() => actions.stepContext(-1)} disabled={phase === 'checking'} title="Arrow left">◀ Earlier in the game</button>
                {browsing && <button className="key" onClick={() => actions.stepContext(1)} title="Arrow right">Later ▶</button>}
                {browsing && <button className="key go" onClick={actions.backToPuzzle}>Back to the moment</button>}
              </>
            ) : null}
            <span className="grow" />
            {index > 0 && <button className="key" onClick={actions.prevMoment}>Previous</button>}
          </div>
          {browsing && <p style={{ opacity: 0.75, marginTop: 10 }} className="t-small">You're looking at an earlier position. Your progress on this moment is kept.</p>}
        </div>

        <aside className="review-side">
          <div className="verdict" style={{ ['--vc' as string]: 'var(--stage)', borderRadius: 14 }}>
            <div className="row" style={{ gap: 8, opacity: 0.9 }}>
              <ClassIcon cls={m.cls} size={20} white />
              <span>You played {moveNo} {m.san}, a {CLASS_LABEL[m.cls].toLowerCase()}</span>
            </div>
            <div className="display" style={{ fontSize: 40, marginTop: 10 }}>{TITLE[phase]}</div>
            <p style={{ opacity: 0.8, marginTop: 4 }}>{m.color === 'w' ? 'White' : 'Black'} to move.</p>
          </div>

          <div className="panel coach stack" style={{ gap: 14 }}>
            {(phase === 'solve' || phase === 'intro' || phase === 'wrong' || phase === 'checking') && (
              <>
                {phase === 'wrong' && flow.feedback && <p className="coach-text" style={{ color: 'var(--c-blunder)' }}>{flow.feedback}</p>}
                {phase === 'checking' && <p className="quiet"><span className="spin" /> Stockfish is checking your move…</p>}
                {flow.hint ? (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="faint t-small">Hint {flow.hint.level} of 3</span>
                    <p className="coach-text">{flow.hint.text}</p>
                  </div>
                ) : (
                  phase !== 'checking' && <p className="quiet">Drag a piece to answer. Any move that keeps the advantage counts.</p>
                )}
                <div className="row">
                  <button className="key" onClick={actions.nextHint} disabled={flow.hintsUsed >= 3 || phase === 'checking'}>
                    {flow.hintsUsed === 0 ? 'Hint' : flow.hintsUsed < 3 ? 'More specific hint' : 'No more hints'}
                  </button>
                  <button className="key flat" onClick={actions.giveUp} disabled={phase === 'checking'}>Show me the answer</button>
                </div>
              </>
            )}

            {(phase === 'explain' || phase === 'solved') && ex && (
              <>
                <p className="display" style={{ fontSize: 30 }}>{ex.headline}</p>
                {ex.detail && <p className="coach-text">{ex.detail}</p>}
                {ex.rule && (
                  <p className="tag" style={{ alignSelf: 'flex-start', borderRadius: 10, padding: '8px 12px', fontSize: 15, background: 'var(--paper)', borderColor: 'var(--ink)' }}>
                    Rule: {ex.rule}
                  </p>
                )}
                {showRecovered && flow.recovered && (
                  <p className="recovered">+<span className="display num" ref={recRef}>0</span>% winning chances back</p>
                )}
                <div className="row">
                  <button className="key ink" onClick={actions.beginReplay} autoFocus>Step through the line</button>
                  {phase === 'solved' && (
                    <button className="key" onClick={actions.nextMoment} disabled={!flow.canNextMoment}>{index + 1 < moments.length ? 'Next moment' : 'Finish'}</button>
                  )}
                </div>
              </>
            )}

            {phase === 'replay' && flow.plan && (
              <>
                <div className="line-chips">
                  {flow.plan.lineExplained.map((x, i) => (
                    <button key={i} className={`line-chip ${flow.replay.step === i + 1 ? 'now' : ''}`} onClick={() => actions.replayTo(i + 1)}>
                      {x.san}
                    </button>
                  ))}
                </div>
                <p className="coach-text">
                  {flow.replay.step === 0
                    ? flow.plan.idea || `Start with ${flow.plan.san}. Press ▶ to play the line.`
                    : (flow.plan.lineExplained[flow.replay.step - 1] as { note?: string } | undefined)?.note ?? 'Keep going.'}
                </p>
                {showRecovered && flow.recovered && (
                  <p className="recovered">+<span className="display num" ref={recRef}>0</span>% winning chances back</p>
                )}
                <button className="key ink" onClick={actions.beginConfirm} disabled={flow.replay.step < Math.min(2, flow.replay.total)}>
                  {flow.replay.step < Math.min(2, flow.replay.total) ? 'Play a couple of moves first' : 'I get it. Let me play it'}
                </button>
              </>
            )}

            {phase === 'confirm' && (
              <>
                <p className="coach-text">Play the first move yourself. Doing it once now is what makes it stick next time.</p>
                {flow.feedback && <p style={{ color: 'var(--c-blunder)', fontWeight: 600 }}>{flow.feedback}</p>}
                <button className="key" onClick={actions.watchAgain}>Watch the line again</button>
              </>
            )}

            {phase === 'complete' && (
              <>
                <div className="stack" style={{ gap: 8 }}>
                  {moments.map((mm, i) => (
                    <div key={mm.ply} className="row" style={{ justifyContent: 'space-between' }}>
                      <span><b className="num">{Math.ceil(mm.ply / 2)}{mm.color === 'w' ? '.' : '…'} {mm.san}</b> <span className="faint">→ {mm.bestSan}</span></span>
                      <span className={flow.results[i] === 'failed' ? 'due' : 'cls-text-best'} style={{ fontWeight: 650 }}>{flow.results[i] ? RESULT_LABEL[flow.results[i]] : 'Skipped'}</span>
                    </div>
                  ))}
                </div>
                <p className="quiet">These positions are in your training queue now. They come back right before you'd forget them.</p>
                <div className="row">
                  <a className="key ink" href="#/train/session">Train now</a>
                  <a className="key" href={`#/review/${encodeURIComponent(game.id)}`}>Back to review</a>
                </div>
              </>
            )}

            {phase !== 'complete' && (
              <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
                <button className="key flat sm" onClick={actions.skipMoment} disabled={phase === 'checking'}>Skip for now</button>
                {flow.canNextMoment && phase !== 'solved' && (
                  <button className="key sm" onClick={actions.nextMoment}>{index + 1 < moments.length ? 'Next moment' : 'Finish'}</button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
