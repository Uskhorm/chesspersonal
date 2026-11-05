import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import { db } from '../lib/db';
import { enqueueAnalysis, markReviewed, useQueue } from '../lib/sync';
import type { AnalysedMove, Classification, GameAnalysis, StoredGame } from '../lib/types';
import { Board, type Arrow } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { Timeline } from '../components/Timeline';
import { MoveList } from '../components/MoveList';
import { Verdict } from '../components/Verdict';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { celebrateClass, countUp, shake } from '../lib/fx';
import { sfx } from '../lib/sound';
import { formatScore } from '../lib/winpct';
import { MOTIF_INFO } from '../lib/classify';
import { LearnMode } from './LearnMode';
import { Coach } from '../components/Coach';

const START = new Chess().fen();
const BAD = new Set<Classification>(['inaccuracy', 'mistake', 'miss', 'blunder']);
export const KEY = new Set<Classification>(['mistake', 'miss', 'blunder']);

export function Review({ id, learn }: { id: string; learn: boolean }) {
  const game = useLiveQuery(() => db.games.get(id), [id]);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [stage, setStage] = useState<'summary' | 'browse'>('summary');
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

  if (!game) return <div className="page"><span className="spin lg" /></div>;
  if (!analysis) return <Analysing game={game} pct={q.current === id && q.total ? Math.round((q.done / q.total) * 100) : 0} queued={q.current !== id} />;
  if (learn) return <LearnMode a={analysis} game={game} />;
  if (stage === 'summary') return <Summary a={analysis} game={game} onBrowse={() => setStage('browse')} />;
  return <Browse a={analysis} game={game} />;
}

function Analysing({ game, pct, queued }: { game: StoredGame; pct: number; queued: boolean }) {
  const opp = game.userColor === 'w' ? game.black : game.white;
  return (
    <div className="page narrow">
      <div className="stage" style={{ padding: 28 }}>
        <p style={{ opacity: 0.7 }}>{queued ? 'Waiting for the engine' : 'Stockfish is reviewing every move'}</p>
        <h1 className="display t-1" style={{ margin: '6px 0 18px' }}>
          You vs {opp.username}
        </h1>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="display num" style={{ fontSize: 96 }}>{pct}</span>
          <span style={{ fontSize: 28, opacity: 0.6 }}>%</span>
        </div>
        <div className="meter" style={{ background: '#ffffff1a', marginTop: 12 }}>
          <i style={{ width: `${pct}%`, background: 'var(--c-brilliant)' }} />
        </div>
        <p style={{ opacity: 0.7, marginTop: 16 }} className="t-small">
          This runs on your device. You can leave this page; the review keeps going and you'll get a notification when it's ready.
        </p>
      </div>
    </div>
  );
}

const ORDER: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

function Summary({ a, game, onBrowse }: { a: GameAnalysis; game: StoredGame; onBrowse: () => void }) {
  const wAcc = useRef<HTMLSpanElement>(null);
  const bAcc = useRef<HTMLSpanElement>(null);
  const mine = game.userColor === 'w' ? a.white : a.black;
  useEffect(() => {
    countUp(wAcc.current, a.white.accuracy, 1, 1400);
    countUp(bAcc.current, a.black.accuracy, 1, 1400);
    if (mine.counts.brilliant) setTimeout(() => (sfx.brilliant(), celebrateClass('brilliant')), 700);
  }, [a]);
  const moments = a.moves.filter((m) => m.color === game.userColor && KEY.has(m.cls));
  const sides = [
    { key: 'w', p: game.white, s: a.white, ref: wAcc },
    { key: 'b', p: game.black, s: a.black, ref: bAcc },
  ] as const;
  const result = game.userResult === 'win' ? 'You won' : game.userResult === 'loss' ? 'You lost' : 'Draw';

  return (
    <div className="page">
      <header style={{ marginBottom: 24 }}>
        <p className="quiet">
          {result}, {game.timeClass}. {a.opening ?? 'Unnamed opening'}
        </p>
        <h1 className="display t-hero" style={{ marginTop: 6 }}>
          {moments.length === 0 ? 'Clean game' : `${moments.length} moment${moments.length > 1 ? 's' : ''} to learn from`}
        </h1>
      </header>
      <div className="summary-grid">
        <div className="stack" style={{ gap: 18 }}>
          <div className="panel versus">
            {sides.map((x) => (
              <div key={x.key} className={game.userColor === x.key ? 'me' : ''}>
                <div className="row" style={{ gap: 8, fontWeight: 650 }}>
                  <span className={`piece-dot ${x.key}`} style={{ borderColor: '#0002' }} /> {x.p.username}
                  <span className="faint num" style={{ fontWeight: 500 }}>{x.p.rating}</span>
                </div>
                <div className="display acc num"><span ref={x.ref}>0</span></div>
                <p className="quiet t-small">accuracy, played like about <b className="num">{x.s.estRating}</b></p>
                <div className="row t-small" style={{ marginTop: 12, gap: 14 }}>
                  {(['opening', 'middlegame', 'endgame'] as const).map((ph) => (
                    <span key={ph} className="faint" style={{ textTransform: 'capitalize' }}>
                      {ph} <b className="num" style={{ color: 'var(--ink)' }}>{x.s.phases[ph] ?? '–'}</b>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="row">
            {moments.length > 0 && (
              <a className="key ink big" href={`#/review/${encodeURIComponent(game.id)}/learn`}>
                Learn from {moments.length === 1 ? 'it' : `all ${moments.length}`}
              </a>
            )}
            <button className={`key big ${moments.length ? '' : 'ink'}`} onClick={onBrowse}>Step through the game</button>
            <a className="key flat" href={game.url} target="_blank" rel="noreferrer">Open on chess.com</a>
          </div>
          {moments.length > 0 && (
            <div className="panel panel-pad">
              <h2 className="t-3" style={{ marginBottom: 6 }}>Your key moments</h2>
              {moments.map((m) => (
                <div key={m.ply} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--rule)' }}>
                  <ClassIcon cls={m.cls} size={20} />
                  <b className="num">{Math.ceil(m.ply / 2)}{m.color === 'w' ? '.' : '…'} {m.san}</b>
                  <span className="quiet t-small grow">{(m.motifs ?? []).filter((x) => x !== 'opening' && x !== 'endgame').map((x) => MOTIF_INFO[x].label.toLowerCase()).join(', ') || CLASS_LABEL[m.cls].toLowerCase()}</span>
                  <span className="faint num t-small">best was {m.bestSan}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel panel-pad">
          <table className="tally">
            <thead>
              <tr>
                <td className="n t-small" style={{ fontSize: 13, fontWeight: 600, fontVariationSettings: "'wdth' 100" }}>{game.white.username.slice(0, 8)}</td>
                <td />
                <td className="n t-small" style={{ fontSize: 13, fontWeight: 600, fontVariationSettings: "'wdth' 100" }}>{game.black.username.slice(0, 8)}</td>
              </tr>
            </thead>
            <tbody>
              {ORDER.map((c) => (
                <tr key={c}>
                  <td className={`n cls-text-${c} ${a.white.counts[c] ? '' : 'zero'}`}>{a.white.counts[c]}</td>
                  <td><span className="label" style={{ justifyContent: 'center' }}><ClassIcon cls={c} size={20} /> {CLASS_LABEL[c]}</span></td>
                  <td className={`n cls-text-${c} ${a.black.counts[c] ? '' : 'zero'}`}>{a.black.counts[c]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Positions along a SAN line starting at fen. */
export function lineFens(fen: string, line: string[]): { fen: string; from: string; to: string; san: string }[] {
  const c = new Chess(fen);
  const out: { fen: string; from: string; to: string; san: string }[] = [];
  for (const san of line) {
    try {
      const m = c.move(san);
      out.push({ fen: c.fen(), from: m.from, to: m.to, san: m.san });
    } catch {
      break;
    }
  }
  return out;
}

function Browse({ a, game }: { a: GameAnalysis; game: StoredGame }) {
  const moves = a.moves;
  const userColor = game.userColor;
  const [ply, setPly] = useState(0);
  const [variation, setVariation] = useState<{ base: AnalysedMove; idx: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reviewedRef = useRef(false);
  const go = useCallback(
    (p: number, stepped = false) => {
      const np = Math.max(0, Math.min(moves.length, p));
      setVariation(null);
      setPly(np);
      const m = moves[np - 1];
      if (!m || !stepped) return;
      if (m.san.includes('+')) sfx.check();
      else if (m.san.includes('x')) sfx.capture();
      else sfx.move();
      if (m.cls === 'brilliant' || m.cls === 'great') {
        setTimeout(() => (m.cls === 'brilliant' ? sfx.brilliant() : sfx.great()), 120);
        celebrateClass(m.cls);
      } else if (m.cls === 'blunder' && m.color === userColor) {
        sfx.blunder();
        shake(stageRef.current, 5);
      }
    },
    [moves, userColor],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'ArrowRight') go(ply + 1, true);
      else if (e.key === 'ArrowLeft') go(ply - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(moves.length);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [ply, go, moves.length]);

  useEffect(() => {
    if (!reviewedRef.current && ply === moves.length) {
      reviewedRef.current = true;
      const k = `reviewed:${game.id}`;
      if (!localStorage.getItem(k)) {
        localStorage.setItem(k, '1');
        void markReviewed(); // XP is earned in Learn mode, not by scrolling to the end
      }
    }
  }, [ply]);

  const cur = moves[ply - 1];
  const orientation = userColor === 'w' ? 'white' : 'black';
  const best = cur && BAD.has(cur.cls) && cur.bestUci !== cur.uci ? cur : null;
  const bestLine = useMemo(() => (best ? lineFens(best.fenBefore, best.bestLineSan) : []), [best]);

  let fen = ply === 0 ? START : cur.fenAfter;
  let lastMove: [string, string] | undefined = cur ? [cur.from, cur.to] : undefined;
  const arrows: Arrow[] = [];
  let badge: { square: string; cls: Classification } | null = cur ? { square: cur.to, cls: cur.cls } : null;
  let evalScore = cur ? cur.scoreAfter : { cp: 20 };
  if (variation && bestLine[variation.idx]) {
    const v = bestLine[variation.idx];
    fen = v.fen;
    lastMove = [v.from, v.to];
    badge = null;
    evalScore = variation.base.scoreBefore;
  } else if (best) {
    arrows.push({ from: best.bestUci.slice(0, 2), to: best.bestUci.slice(2, 4), brush: 'best' });
  }
  const top = userColor === 'w' ? game.black : game.white;
  const bottom = userColor === 'w' ? game.white : game.black;
  const moveNo = cur ? `${Math.ceil(cur.ply / 2)}${cur.color === 'w' ? '.' : '…'}` : '';

  return (
    <div className="page">
      <div className="review">
        <div className="stage" ref={stageRef}>
          <div className="stage-player"><span className={`piece-dot ${userColor === 'w' ? 'b' : 'w'}`} /> {top.username} <span className="rating num">{top.rating}</span></div>
          <div className="board-line">
            <EvalBar score={evalScore} orientation={orientation} />
            <Board fen={fen} orientation={orientation} lastMove={lastMove} arrows={arrows} badge={badge} />
          </div>
          <div className="stage-player"><span className={`piece-dot ${userColor}`} /> {bottom.username} <span className="rating num">{bottom.rating}</span></div>
          <Timeline curve={a.winCurve} moves={moves} ply={ply} onSelect={(p) => go(p)} userColor={userColor} />
          <div className="transport on-stage" style={{ marginTop: 14 }}>
            <button className="key sq" onClick={() => go(0)} aria-label="First move">⏮</button>
            <button className="key sq" onClick={() => go(ply - 1)} aria-label="Previous move">◀</button>
            <button className="key sq go" onClick={() => go(ply + 1, true)} aria-label="Next move">▶</button>
            <button className="key sq" onClick={() => go(moves.length)} aria-label="Last move">⏭</button>
            <span className="grow" />
            <button
              className="key"
              onClick={() => {
                const next = moves.find((m) => m.ply > ply && m.color === userColor && BAD.has(m.cls));
                if (next) go(next.ply, true);
              }}
            >
              Next mistake
            </button>
          </div>
        </div>

        <aside className="review-side">
          {cur ? (
            <Verdict cls={cur.cls} san={cur.san} moveNo={moveNo} sub={`eval ${formatScore(cur.scoreAfter)}`} />
          ) : (
            <div className="verdict neutral">
              <div className="verdict-word display" style={{ fontSize: 40 }}>Start</div>
              <div className="verdict-move">{a.opening ?? 'Starting position'}</div>
            </div>
          )}
          {cur && (
            <div className="panel">
              <Coach move={cur} mine={cur.color === userColor} />
              {best && bestLine.length > 0 && (
                <div style={{ padding: '0 20px 18px' }}>
                  <p className="t-small quiet" style={{ marginBottom: 8 }}>Better was {best.bestSan}. Tap through the line:</p>
                  <div className="line-chips">
                    {bestLine.map((v, i) => (
                      <button key={i} className={`line-chip ${variation?.idx === i ? 'now' : ''}`} onClick={() => setVariation({ base: best, idx: i })}>
                        {v.san}
                      </button>
                    ))}
                    {variation && <button className="line-chip" onClick={() => setVariation(null)}>Back to game</button>}
                  </div>
                </div>
              )}
              {cur.color === userColor && KEY.has(cur.cls) && (
                <div style={{ padding: '0 20px 20px' }}>
                  <a className="key ink" href={`#/review/${encodeURIComponent(game.id)}/learn`}>Practise this moment</a>
                </div>
              )}
            </div>
          )}
          <MoveList moves={moves} ply={ply} onSelect={(p) => go(p)} />
        </aside>
      </div>
    </div>
  );
}
