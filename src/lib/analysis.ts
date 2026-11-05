import { Chess, type Move } from 'chess.js';
import { classify, detectMotifs, explain, isEndgame } from './classify';
import { cloudEval, engine, terminalEval } from './engine';
import { loadOpenings, lookupOpening } from './openings';
import type { AnalysedMove, Classification, Color, GameAnalysis, PositionEval, SideSummary } from './types';
import { estimateRating, gameAccuracy, moveAccuracy, scoreToWhiteWin, scoreToWin } from './winpct';

export const ALL_CLASSES: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder',
];

export function emptyCounts(): Record<Classification, number> {
  return Object.fromEntries(ALL_CLASSES.map((c) => [c, 0])) as Record<Classification, number>;
}

export function parseClocks(pgn: string): number[] {
  const out: number[] = [];
  const re = /%clk (\d+):(\d+):(\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pgn))) out.push(+m[1] * 3600 + +m[2] * 60 + +m[3]);
  return out;
}

export function initialClock(pgn: string): number | undefined {
  const tc = /\[TimeControl "([^"]+)"\]/.exec(pgn)?.[1];
  if (!tc || tc.includes('/')) return undefined;
  return Number(tc.split('+')[0]) || undefined;
}

export function uciToSan(fen: string, uci: string): { san: string; move: Move } | null {
  try {
    const c = new Chess(fen);
    const move = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { san: move.san, move };
  } catch {
    return null;
  }
}

export function pvToSan(fen: string, pv: string[], max = 8): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      out.push(c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

export interface AnalyseOptions {
  depth: number;
  onProgress?: (done: number, total: number) => void;
  useCloud?: boolean;
}

/** Evaluate every position of the game: Lichess cloud for opening positions, local Stockfish for the rest. */
async function evaluatePositions(fens: string[], opts: AnalyseOptions): Promise<PositionEval[]> {
  const evals: PositionEval[] = new Array(fens.length);
  let done = 0;
  const tick = () => opts.onProgress?.(++done, fens.length);

  let cloudOk = opts.useCloud !== false;
  const local: Promise<void>[] = [];
  for (let i = 0; i < fens.length; i++) {
    const t = terminalEval(fens[i]);
    if (t) {
      evals[i] = t;
      tick();
      continue;
    }
    if (cloudOk && i < 30) {
      const c = await cloudEval(fens[i], 2);
      if (c && c.lines.length >= Math.min(2, new Chess(fens[i]).moves().length)) {
        evals[i] = c;
        tick();
        continue;
      }
      cloudOk = false;
    }
    local.push(
      engine.analyse(fens[i], opts.depth, 2).then((e) => {
        evals[i] = e;
        tick();
      }),
    );
  }
  await Promise.all(local);
  return evals;
}

export async function analysePgn(gameId: string, pgn: string, opts: AnalyseOptions): Promise<GameAnalysis> {
  await loadOpenings();
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  if (!history.length) throw new Error('Game has no moves');
  const fens = [history[0].before, ...history.map((m) => m.after)];
  const evals = await evaluatePositions(fens, opts);

  const clocks = parseClocks(pgn);
  const init = initialClock(pgn);
  const winCurve = evals.map((e) => scoreToWhiteWin(e.lines[0].score));

  const moves: AnalysedMove[] = [];
  let inBook = true;
  let opening: string | undefined;
  let eco: string | undefined;
  let prevLoss = 0;

  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    const mover = m.color as Color;
    const before = evals[i];
    const after = evals[i + 1];
    const best = before.lines[0];
    const second = before.lines[1];
    const bestUci = best.pv[0] ?? m.lan;
    const played = m.from + m.to + (m.promotion ?? '');

    let winBefore = scoreToWin(best.score, mover);
    let winAfter = scoreToWin(after.lines[0].score, mover);
    const winSecond = second ? scoreToWin(second.score, mover) : undefined;
    // Use the same search for the played move when it's one of the PV lines (less depth noise).
    if (played === bestUci) winAfter = Math.max(winAfter, winBefore);
    else if (second && played === second.pv[0] && winSecond !== undefined) winAfter = winSecond;
    // Engine can see deeper after the move; never reward a move above the best-play eval.
    if (played !== bestUci) winAfter = Math.min(winAfter, winBefore);
    winBefore = Math.max(winBefore, 0);

    const book = inBook ? lookupOpening(m.after) : null;
    if (book) {
      eco = book[0];
      opening = book[1];
    } else inBook = false;

    const legalCount = new Chess(m.before).moves().length;
    const { cls, loss, sacrifice } = classify({
      move: m,
      fenAfter: m.after,
      legalCount,
      isBook: !!book,
      bestUci,
      winBefore,
      winAfter,
      winSecond,
      scoreBefore: best.score,
      scoreAfter: after.lines[0].score,
      prevOppLoss: prevLoss,
      prevMove: history[i - 1],
    });
    prevLoss = loss;

    const bestInfo = uciToSan(m.before, bestUci);
    const bestSan = bestInfo?.san ?? m.san;
    const clock = clocks[i];
    const motifs = detectMotifs({
      cls,
      move: m,
      fenAfter: m.after,
      bestMove: played === bestUci ? undefined : bestInfo?.move,
      scoreBefore: best.score,
      scoreAfter: after.lines[0].score,
      clockSecs: clock,
      clockFrac: clock !== undefined && init ? clock / init : undefined,
      ply: i + 1,
      endgame: isEndgame(m.before),
    });

    moves.push({
      ply: i + 1,
      color: mover,
      san: m.san,
      uci: played,
      from: m.from,
      to: m.to,
      fenBefore: m.before,
      fenAfter: m.after,
      scoreBefore: best.score,
      scoreAfter: after.lines[0].score,
      winBefore,
      winAfter,
      epLoss: loss,
      accuracy: cls === 'book' || played === bestUci ? 100 : moveAccuracy(winBefore, winAfter),
      bestUci,
      bestSan,
      bestLineSan: pvToSan(m.before, best.pv),
      replyLineSan: pvToSan(m.after, after.lines[0].pv, 6),
      cls,
      opening: book?.[1],
      comment: explain({ cls, san: m.san, bestSan, move: m, fenAfter: m.after, scoreBefore: best.score, scoreAfter: after.lines[0].score, sacrifice, opening: book?.[1] }),
      sacrifice,
      motifs,
      clock,
    });
  }

  const ratings = {
    w: Number(/\[WhiteElo "(\d+)"\]/.exec(pgn)?.[1]) || undefined,
    b: Number(/\[BlackElo "(\d+)"\]/.exec(pgn)?.[1]) || undefined,
  };
  const summary = (c: Color): SideSummary => {
    const mine = moves.filter((m) => m.color === c);
    const counts = emptyCounts();
    for (const m of mine) counts[m.cls]++;
    const accs = moves.map((m) => m.accuracy);
    const accuracy = gameAccuracy(winCurve, accs, c);
    const phase = (pred: (m: AnalysedMove) => boolean) => {
      const xs = mine.filter(pred);
      return xs.length ? Math.round(xs.reduce((a, m) => a + m.accuracy, 0) / xs.length) : null;
    };
    const eg = (m: AnalysedMove) => isEndgame(m.fenBefore);
    return {
      accuracy,
      estRating: estimateRating(accuracy, c === 'w' ? ratings.b : ratings.w),
      counts,
      phases: {
        opening: phase((m) => m.ply <= 20 && !eg(m)),
        middlegame: phase((m) => m.ply > 20 && !eg(m)),
        endgame: phase(eg),
      },
    };
  };

  return {
    gameId,
    depth: opts.depth,
    createdAt: Date.now(),
    moves,
    winCurve,
    white: summary('w'),
    black: summary('b'),
    opening,
    eco,
  };
}
