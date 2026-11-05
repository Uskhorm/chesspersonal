import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'motion/react';
import { Chess } from 'chess.js';
import { db, bumpActivity } from '../lib/db';
import type { Drill } from '../lib/types';
import { fetchPuzzle, type LichessPuzzle } from '../lib/lichess';
import { buildSession, computeLeaks, drillRating } from '../lib/learning';
import { gradeFrom, schedule, isMastered, dueLabel } from '../lib/srs';
import { useStore } from '../lib/store';
import { Board, type Arrow } from '../components/Board';
import { ClassIcon, CLASS_LABEL } from '../components/ClassIcon';
import { burst, confettiBurst, countUp, flash, pop, shake } from '../lib/fx';
import { sfx } from '../lib/sound';
import { verifyMove } from '../lib/verify';
import { MOTIF_INFO } from '../lib/classify';
import { selfOf } from '../lib/chesscom';

type Item = { kind: 'drill'; drill: Drill } | { kind: 'puzzle'; p: LichessPuzzle; tag?: string };
type Mode = 'session' | 'leak' | 'rush';

const RECENT_KEY = 'cp-recent-success';
const recentSuccess = (): number | null => {
  const xs: number[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  return xs.length >= 5 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const pushRecent = (ok: boolean) => {
  const xs: number[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  localStorage.setItem(RECENT_KEY, JSON.stringify([...xs, ok ? 1 : 0].slice(-30)));
};

export function Train({ mode }: { mode?: string }) {
  const [run, setRun] = useState(0);
  if (mode === 'session' || mode === 'leak' || mode === 'rush') return <Runner mode={mode} key={mode + run} onRestart={() => setRun((r) => r + 1)} />;
  return <TrainMenu />;
}

function TrainMenu() {
  const drills = useLiveQuery(() => db.drills.toArray(), []) ?? [];
  const games = useLiveQuery(() => db.games.toArray(), []) ?? [];
  const analyses = useLiveQuery(() => db.analyses.toArray(), []) ?? [];
  const leaks = useMemo(() => computeLeaks(games, analyses).filter((l) => l.motif !== 'opening' && l.motif !== 'endgame'), [games, analyses]);
  const due = drills.filter((d) => d.due <= Date.now());
  const rushBest = useStore((s) => s.stats.rushBest);
  const modes = [
    { href: '#/train/session', emoji: '🧠', title: 'Smart Session', sub: `${due.length} due · spaced repetition of YOUR mistakes, interleaved & adaptive`, color: '#5b8def', hot: due.length > 0 },
    { href: '#/train/leak', emoji: leaks[0]?.emoji ?? '🎯', title: `Fix your #1 leak${leaks[0] ? `: ${leaks[0].label}` : ''}`, sub: 'Targeted Lichess puzzles + your own positions with the same pattern', color: '#ff9a3c', hot: false },
    { href: '#/train/rush', emoji: '⚡', title: 'Blunder Rush', sub: `3 minutes · 3 lives · combos. Best: ${rushBest}`, color: '#ff6bd6', hot: false },
  ];
  return (
    <div className="page">
      <h1 className="h1">Train</h1>
      <p className="muted">Built on the most robust findings in learning science: spaced repetition, retrieval practice, interleaving, and an ~85% success sweet spot.</p>
      <div className="mode-grid">
        {modes.map((m, i) => (
          <motion.a key={m.href} href={m.href} className={`mode-card ${m.hot ? 'hot' : ''}`} style={{ ['--c' as string]: m.color, ['--burst' as string]: m.color }} initial={{ opacity: 0, y: 30, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: i * 0.08, type: 'spring', stiffness: 220, damping: 18 }} whileHover={{ y: -6, scale: 1.02 }} whileTap={{ scale: 0.96 }}>
            <span className="mode-emoji">{m.emoji}</span>
            <span className="mode-title">{m.title}</span>
            <span className="mode-sub">{m.sub}</span>
          </motion.a>
        ))}
      </div>
      <section className="card">
        <div className="card-head">
          <h2>Mistake bank</h2>
          <span className="muted">{drills.length} positions · {drills.filter(isMastered).length} mastered</span>
        </div>
        {!drills.length && <p className="muted">Review a game and every mistake, miss and blunder you made lands here automatically.</p>}
        <div className="bank">
          {[...drills].sort((a, b) => a.due - b.due).slice(0, 40).map((d) => (
            <a key={d.id} className="bank-item" href={`#/review/${encodeURIComponent(d.gameId)}`}>
              <ClassIcon cls={d.cls} size={18} />
              <span className="mono">{d.playedSan}</span>
              <span className="muted">→ {d.bestSan}</span>
              <span className="muted small">vs {d.opponent}</span>
              <span className="spacer" />
              <span className={`mono small ${d.due <= Date.now() ? 'due' : 'muted'}`}>{isMastered(d) ? '🧠 mastered' : dueLabel(d)}</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function Runner({ mode, onRestart }: { mode: Mode; onRestart: () => void }) {
  const st = useStore();
  const [items, setItems] = useState<Item[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [combo, setCombo] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [xpEarned, setXpEarned] = useState(0);
  const [ratingDelta, setRatingDelta] = useState(0);
  const [lives, setLives] = useState(3);
  const [timeLeft, setTimeLeft] = useState(180);
  const [over, setOver] = useState(false);
  const [leakLabel, setLeakLabel] = useState<string | null>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const requeued = useRef(new Set<string>());

  // Build the item list.
  useEffect(() => {
    (async () => {
      const drills = await db.drills.toArray();
      if (mode === 'session') {
        const s = buildSession(drills, 10, recentSuccess());
        const own: Item[] = s.map((d) => ({ kind: 'drill', drill: d }));
        if (own.length >= 6) return setItems(own);
        // Small bank: pad with puzzles aimed at your biggest leak (interleaved).
        const [games, analyses] = await Promise.all([db.games.toArray(), db.analyses.toArray()]);
        const leak = computeLeaks(games, analyses).filter((l) => l.motif !== 'opening' && l.motif !== 'endgame')[0];
        const ps: Item[] = (await fetchMany(leak?.angle, 6 - own.length)).map((p) => ({ kind: 'puzzle', p, tag: leak?.label }));
        const mixed: Item[] = [];
        while (own.length || ps.length) {
          if (own.length) mixed.push(own.shift()!);
          if (ps.length) mixed.push(ps.shift()!);
        }
        return setItems(mixed);
      }
      if (mode === 'leak') {
        const [games, analyses] = await Promise.all([db.games.toArray(), db.analyses.toArray()]);
        const leak = computeLeaks(games, analyses).filter((l) => l.motif !== 'opening' && l.motif !== 'endgame')[0];
        const angle = leak?.angle ?? 'advantage';
        setLeakLabel(leak ? `${leak.emoji} ${leak.label}` : null);
        const own = leak ? drills.filter((d) => d.motifs?.includes(leak.motif)).sort((a, b) => a.due - b.due).slice(0, 4) : [];
        const ps = await fetchMany(angle, 6);
        const mixed: Item[] = [];
        const a: Item[] = ps.map((p) => ({ kind: 'puzzle', p, tag: leak?.label }));
        const b: Item[] = own.map((d) => ({ kind: 'drill', drill: d }));
        while (a.length || b.length) {
          if (a.length) mixed.push(a.shift()!);
          if (b.length) mixed.push(b.shift()!);
        }
        return setItems(mixed);
      }
      // rush: own drills shuffled, then a stream of puzzles
      const own = [...drills].sort(() => Math.random() - 0.5).slice(0, 25);
      const ps = await fetchMany(undefined, 4);
      setItems([...own.map((d) => ({ kind: 'drill' as const, drill: d })), ...ps.map((p) => ({ kind: 'puzzle' as const, p }))]);
    })();
  }, [mode]);

  // Rush timer
  useEffect(() => {
    if (mode !== 'rush' || !items || over) return;
    const t = setInterval(() => setTimeLeft((x) => (x <= 1 ? (setOver(true), 0) : x - 1)), 1000);
    return () => clearInterval(t);
  }, [mode, items, over]);

  // Rush: top up with puzzles when running low.
  useEffect(() => {
    if (mode === 'rush' && items && items.length - idx < 3 && !over) {
      fetchMany(undefined, 3).then((ps) => setItems((x) => [...(x ?? []), ...ps.map((p) => ({ kind: 'puzzle' as const, p }))]));
    }
  }, [idx, mode, items?.length, over]);

  useEffect(() => {
    if (over) finish();
  }, [over]);

  const finish = () => {
    const acc = results.length ? results.filter(Boolean).length / results.length : 0;
    if (mode === 'rush') {
      const score = results.filter(Boolean).length;
      st.stat('rushBest', score, 'max');
      st.progressQuest('rush', score, 'max');
    }
    if (results.length >= 5 && acc >= 0.85) st.progressQuest('perfect', 1);
    if (results.length >= 5 && acc === 1) {
      st.addXP(30);
    }
    sfx.levelUp();
    confettiBurst(['#ffd34d', '#1fd1b9', '#5b8def', '#ff6bd6'], 1.5);
  };

  const onResult = async (ok: boolean, firstTry: boolean, ms: number, item: Item, at?: { x: number; y: number }) => {
    pushRecent(ok);
    setResults((r) => [...r, ok]);
    await bumpActivity({ drills: 1, correct: ok ? 1 : 0 });
    // training rating
    const opp = item.kind === 'puzzle' ? item.p.rating : drillRating(item.drill, gamesBaseRating.current);
    setRatingDelta((d) => d + st.rateTraining(opp, ok ? 1 : 0));

    if (item.kind === 'drill') {
      const next = schedule(item.drill, gradeFrom(ok, firstTry, ms));
      await db.drills.put(next);
      if (!ok && mode === 'session' && !requeued.current.has(item.drill.id)) {
        // relearn: see it again at the end of this session
        requeued.current.add(item.drill.id);
        setItems((x) => [...(x ?? []), { kind: 'drill', drill: next }]);
      }
    }

    if (ok) {
      const c = combo + 1;
      setCombo(c);
      st.stat('drillsSolved', 1);
      st.stat('bestCombo', c, 'max');
      st.progressQuest('solve', 1);
      st.progressQuest('combo', c, 'max');
      if (item.kind === 'puzzle' && mode === 'leak') st.progressQuest('theme', 1);
      const mult = 1 + 0.25 * Math.min(c - 1, 8);
      const gain = Math.round((mode === 'rush' ? 6 : 10) * mult * (firstTry ? 1 : 0.5));
      setXpEarned((x) => x + gain);
      st.addXP(gain, at);
      sfx.combo(c);
      pop(comboRef.current, 1.4);
      if (at) burst(at.x, at.y, '#7fc241', 14 + c * 2, 80 + c * 6);
      if (c > 0 && c % 5 === 0) {
        confettiBurst(['#ff6bd6', '#ffd34d', '#1fd1b9'], 1 + c / 10);
        flash('#ffd34d');
      }
    } else {
      setCombo(0);
      st.stat('drillsFailed', 1);
      if (mode === 'rush') {
        setLives((l) => {
          if (l <= 1) setOver(true);
          return l - 1;
        });
      }
    }
  };

  const gamesBaseRating = useRef(1200);
  useEffect(() => {
    db.games.orderBy('endTime').reverse().first().then((g) => g && (gamesBaseRating.current = selfOf(g).rating));
  }, []);

  if (!items) return <div className="page center"><span className="spinner big" /><p className="muted">Building your session…</p></div>;
  if (!items.length) return <div className="page center"><h2>Nothing to train yet</h2><p className="muted">Review a game first — your mistakes become drills.</p><a className="btn primary" href="#/games">Go to games</a></div>;

  const done = over || (mode !== 'rush' && idx >= items.length);
  if (done) return <SessionEnd mode={mode} results={results} xp={xpEarned} rating={ratingDelta} onRestart={onRestart} />;
  const item = items[idx];
  const comboLevel = combo >= 10 ? 'inferno' : combo >= 5 ? 'fire' : combo >= 3 ? 'warm' : '';

  return (
    <div className={`trainer ${comboLevel}`}>
      <div className="trainer-top">
        <a href="#/train" className="btn ghost small">✕</a>
        {mode === 'rush' ? (
          <div className="rush-hud">
            <span className="lives">{'❤️'.repeat(lives)}{'🖤'.repeat(Math.max(0, 3 - lives))}</span>
            <span className={`mono timer ${timeLeft <= 20 ? 'low' : ''}`}>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
            <span className="mono score">{results.filter(Boolean).length}</span>
          </div>
        ) : (
          <div className="dots">
            {items.map((_, i) => (
              <span key={i} className={`pdot ${i < results.length ? (results[i] ? 'ok' : 'bad') : i === idx ? 'cur' : ''}`} />
            ))}
          </div>
        )}
        <div className={`combo ${comboLevel}`} ref={comboRef}>
          <span className="combo-flame">{combo >= 3 ? '🔥' : '✦'}</span>
          <span className="mono combo-n">{combo}×</span>
          <span className="combo-label">combo</span>
        </div>
      </div>
      {leakLabel && <div className="leak-banner">Targeting your leak: <b>{leakLabel}</b></div>}
      <Solver key={idx + (item.kind === 'drill' ? item.drill.id : item.p.id)} item={item} onResult={(ok, ft, ms, at) => onResult(ok, ft, ms, item, at)} onNext={() => setIdx((i) => i + 1)} rush={mode === 'rush'} />
    </div>
  );
}

async function fetchMany(angle: string | undefined, n: number): Promise<LichessPuzzle[]> {
  const out: LichessPuzzle[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n * 2 && out.length < n; i++) {
    try {
      const p = await fetchPuzzle(angle);
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    } catch {
      break;
    }
  }
  return out;
}

type SolveState = 'solving' | 'thinking' | 'wrong' | 'right' | 'failed';

function Solver({ item, onResult, onNext, rush }: { item: Item; onResult: (ok: boolean, firstTry: boolean, ms: number, at?: { x: number; y: number }) => void; onNext: () => void; rush: boolean }) {
  const startFen = item.kind === 'drill' ? item.drill.fen : item.p.fen;
  const [fen, setFen] = useState(startFen);
  const [last, setLast] = useState<[string, string] | undefined>(item.kind === 'puzzle' && item.p.lastMove ? [item.p.lastMove.slice(0, 2), item.p.lastMove.slice(2, 4)] : undefined);
  const [state, setState] = useState<SolveState>('solving');
  const [step, setStep] = useState(0); // index into puzzle solution
  const [tries, setTries] = useState(0);
  const [hint, setHint] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const t0 = useRef(Date.now());
  const boardRef = useRef<HTMLDivElement>(null);
  const reported = useRef(false);
  const ratingRef = useRef<HTMLSpanElement>(null);
  const color = new Chess(startFen).turn();
  const orientation = color === 'w' ? 'white' : 'black';
  const best = item.kind === 'drill' ? item.drill.bestUci : item.p.solution[step];

  const center = () => {
    const r = boardRef.current?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined;
  };

  const report = (ok: boolean) => {
    if (reported.current) return;
    reported.current = true;
    onResult(ok, tries === 0 && hint === 0, Date.now() - t0.current, center());
  };

  useEffect(() => {
    if (state === 'right' && rush) {
      const t = setTimeout(onNext, 650);
      return () => clearTimeout(t);
    }
    if (state === 'failed' && rush) {
      const t = setTimeout(onNext, 1600);
      return () => clearTimeout(t);
    }
  }, [state]);

  useEffect(() => {
    if (state === 'right') countUp(ratingRef.current, useStore.getState().trainingRating, 0, 900, useStore.getState().trainingRating - 10);
  }, [state]);

  const onMove = async (from: string, to: string, promo?: string) => {
    const uci = from + to + (promo ?? '');
    if (item.kind === 'drill') {
      setState('thinking');
      const r = await verifyMove(fen, uci, item.drill.bestUci, item.drill.winBefore, 3);
      if (r.ok) {
        setFen(r.fenAfter);
        setLast([from, to]);
        setState('right');
        setMsg(r.exact ? `${r.san}! Exactly right.` : `${r.san} works too — great find.`);
        sfx.correct();
        report(true);
      } else wrong(`${r.san} loses ${r.loss.toFixed(0)}% winning chances.`);
      return;
    }
    // Lichess puzzle: follow the solution line; any checkmate also counts.
    const c = new Chess(fen);
    const m = c.move({ from, to, promotion: promo ?? 'q' });
    const expected = item.p.solution[step];
    if (m.from + m.to === expected.slice(0, 4) || c.isCheckmate()) {
      sfx.move();
      const nextStep = step + 1;
      if (nextStep >= item.p.solution.length || c.isCheckmate()) {
        setFen(c.fen());
        setLast([from, to]);
        setState('right');
        setMsg('Puzzle solved!');
        sfx.correct();
        report(true);
        return;
      }
      // play the opponent's reply
      const reply = item.p.solution[nextStep];
      setFen(c.fen());
      setLast([from, to]);
      setTimeout(() => {
        const c2 = new Chess(c.fen());
        const rm = c2.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
        rm.captured ? sfx.capture() : sfx.move();
        setFen(c2.fen());
        setLast([rm.from, rm.to]);
        setStep(nextStep + 1);
      }, 380);
    } else wrong(`${m.san} isn't the move.`);
  };

  const wrong = (text: string) => {
    sfx.wrong();
    shake(boardRef.current, 14);
    flash('#f2382f');
    setNonce((n) => n + 1);
    setTries((t) => t + 1);
    setMsg(text);
    if (rush || tries >= 1 || item.kind === 'puzzle') {
      setState('failed');
      report(false);
    } else setState('wrong');
  };

  const arrows: Arrow[] = [];
  if (state === 'failed' || (state === 'right' && item.kind === 'drill')) arrows.push({ from: best.slice(0, 2), to: best.slice(2, 4), brush: 'best' });
  else if (hint >= 2) arrows.push({ from: best.slice(0, 2), to: best.slice(0, 2), brush: 'hint' });

  const motif = item.kind === 'drill' ? item.drill.motifs?.[0] : undefined;

  return (
    <div className="solver">
      <div className="solver-board" ref={boardRef}>
        <Board fen={fen} orientation={orientation} lastMove={last} arrows={arrows} movable={state === 'solving' || state === 'wrong'} onMove={onMove} nonce={nonce} />
      </div>
      <div className="solver-side">
        <AnimatePresence mode="wait">
          <motion.div key={state} className={`card solver-card ${state}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            {item.kind === 'drill' ? (
              <>
                <div className="solver-src">
                  <ClassIcon cls={item.drill.cls} size={22} />
                  <span>From your game vs <b>{item.drill.opponent}</b></span>
                </div>
                <h2>{color === 'w' ? 'White' : 'Black'} to move</h2>
                <p className="muted">
                  You played <b className="bad">{item.drill.playedSan}</b> here — a {CLASS_LABEL[item.drill.cls].toLowerCase()}. {item.drill.cls === 'miss' ? 'Find the winning move.' : 'Find the best move.'}
                </p>
              </>
            ) : (
              <>
                <div className="solver-src">🧩 <span>Lichess puzzle · <span className="mono">{item.p.rating}</span>{item.tag ? ` · ${item.tag}` : ''}</span></div>
                <h2>{color === 'w' ? 'White' : 'Black'} to move</h2>
                <p className="muted">Find the best continuation{item.p.solution.length > 2 ? ` (${Math.ceil(item.p.solution.length / 2)} moves)` : ''}.</p>
              </>
            )}
            {state === 'thinking' && <p className="muted"><span className="spinner" /> Checking…</p>}
            {msg && <p className={state === 'right' ? 'good big-msg' : 'bad'}>{msg}</p>}
            {state === 'right' && (
              <div className="rating-tick">⚡ <span className="mono" ref={ratingRef}>{useStore.getState().trainingRating}</span> training rating</div>
            )}
            {state === 'failed' && <p className="small">Answer: <b>{item.kind === 'drill' ? item.drill.bestSan : uciSan(fen, best)}</b></p>}
            {hint >= 1 && motif && state !== 'right' && state !== 'failed' && <p className="hint small">💡 {MOTIF_INFO[motif].tip}</p>}
            <div className="row gap">
              {(state === 'solving' || state === 'wrong') && !rush && (
                <button className="btn ghost" onClick={() => setHint((h) => Math.min(2, h + 1))}>💡 Hint {hint ? `(${hint}/2)` : ''}</button>
              )}
              {(state === 'right' || state === 'failed') && !rush && <button className="btn primary big" autoFocus onClick={onNext}>Next →</button>}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function uciSan(fen: string, uci: string) {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

function SessionEnd({ mode, results, xp, rating, onRestart }: { mode: Mode; results: boolean[]; xp: number; rating: number; onRestart: () => void }) {
  const ok = results.filter(Boolean).length;
  const acc = results.length ? Math.round((ok / results.length) * 100) : 0;
  const a = useRef<HTMLSpanElement>(null);
  const b = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    countUp(a.current, mode === 'rush' ? ok : acc, 0, 1400);
    countUp(b.current, xp, 0, 1600);
  }, []);
  const line = acc === 100 ? 'Flawless. Your brain is rewiring.' : acc >= 85 ? 'Right in the learning sweet spot.' : acc >= 60 ? 'Good reps — the misses come back soon so they stick.' : 'Tough set. These will return until they click.';
  return (
    <div className="page center session-end">
      <motion.div className="card end-card" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }}>
        <div className="big-emoji">{acc === 100 ? '🏆' : acc >= 85 ? '🔥' : '💪'}</div>
        <h1 className="h1">{mode === 'rush' ? 'Rush over!' : 'Session complete'}</h1>
        <p className="muted">{line}</p>
        <div className="stat-row">
          <div className="stat"><span className="stat-num mono" ref={a}>0</span><span className="muted">{mode === 'rush' ? 'score' : '% accuracy'}</span></div>
          <div className="stat"><span className="stat-num mono" style={{ color: '#ffd34d' }} ref={b}>0</span><span className="muted">XP earned</span></div>
          <div className="stat"><span className={`stat-num mono ${rating >= 0 ? 'up' : 'down'}`}>{rating >= 0 ? '+' : ''}{rating}</span><span className="muted">training rating</span></div>
        </div>
        <div className="row gap center">
          <button className="btn primary big" onClick={onRestart}>Again ↻</button>
          <a className="btn big" href="#/">Home</a>
        </div>
      </motion.div>
    </div>
  );
}
