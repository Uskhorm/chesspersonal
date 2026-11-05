#!/usr/bin/env node
/**
 * Reproducible public-game calibration. No dependency or package.json changes.
 * node scripts/calibrate.mjs --games=12 --depth=16 --workers=4
 * --refresh re-fetches the corpus; --users=a,b uses explicit public accounts.
 * --strategy=baseline,optimized; --sweep includes per-move chances for fitting.
 * Raw public games/evaluations and results live in scripts/calibrate/results/.
 * Public API accuracies do NOT expose chess.com's per-move labels, so label
 * frequency is a plausibility check, not a measured label agreement score.
 */
import { Worker } from 'node:worker_threads';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
import { Chess } from 'chess.js';

const flags = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [k, ...v] = s.replace(/^--/, '').split('=');
  return [k, v.join('=') || true];
}));
const count = Number(flags.games ?? 12), depth = Number(flags.depth ?? 16);
const workers = Number(flags.workers ?? 4);
if (![count, depth, workers].every((n) => Number.isInteger(n) && n > 0)) throw Error('Positive integer games/depth/workers required');
const directory = resolve('scripts/calibrate/results');
await mkdir(directory, { recursive: true });
const jsonRead = async (file) => JSON.parse(await readFile(file, 'utf8'));
const jsonWrite = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
async function api(path) {
  const url = path.startsWith('https:') ? path : `https://api.chess.com/pub/${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Hindsight/1.0' }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 429 || r.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw Error(`${r.status}: ${url}`);
    return r.json();
  }
  throw Error(`API retry limit: ${url}`);
}

async function discover() {
  const games = new Map(), queue = [], visited = new Set();
  const discoveredAmateurs = new Set();
  let visitedAmateur = false;
  const boards = await api('leaderboards');
  // Streamer/teaching accounts provide opponents across the amateur bands.
  queue.push(...(flags.users ? String(flags.users).split(',') : [
    boards.live_rapid[0].username, 'GothamChess', 'GothamBot', 'DanielNaroditsky',
    'BotezLive', 'AnnaCramling', 'chessbrah',
  ]));
  const bins = [[], [], []];
  for (let q = 0; q < queue.length && q < 60; q++) {
    const user = queue[q].toLowerCase();
    if (visited.has(user)) continue;
    visited.add(user);
    if (discoveredAmateurs.has(user)) visitedAmateur = true;
    try {
      const { archives } = await api(`player/${encodeURIComponent(user)}/games/archives`);
      for (const month of archives.slice(-3).reverse()) {
        let data;
        try { data = await api(month); } catch (e) { console.error(e.message); continue; }
        // Opponents are real, API-discovered accounts, never invented names.
        const opponents = data.games.flatMap((g) => [g.white, g.black])
          .filter((p) => p.username.toLowerCase() !== user && p.rating < 2200)
          .sort((a, b) => a.rating - b.rating);
        const candidates = [];
        for (const target of [800, 1500, 2100]) {
          const nearest = opponents.toSorted((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target));
          for (const p of nearest.slice(0, 2)) {
            candidates.push(p.username);
            if (p.rating < 2000) discoveredAmateurs.add(p.username.toLowerCase());
          }
        }
        // Visit genuine amateur opponents as well as titled/leaderboard seeds.
        queue.splice(q + 1, 0, ...new Set(candidates.filter((u) => !visited.has(u.toLowerCase()))));
        for (const g of data.games.toReversed()) {
          if (g.rules !== 'chess' || !g.accuracies || !Number.isFinite(g.accuracies.white) || !Number.isFinite(g.accuracies.black)) continue;
          const c = new Chess();
          try { c.loadPgn(g.pgn); } catch { continue; }
          if (c.history().length < 20 || games.has(g.url)) continue;
          const rating = Math.min(g.white.rating, g.black.rating);
          const bin = rating < 1200 ? 0 : rating < 2000 ? 1 : 2;
          games.set(g.url, g);
          bins[bin].push(g);
        }
        if (bins.every((b) => b.length >= Math.ceil(count / 3))) break;
      }
      console.error(`Discovery ${user}: ${bins.map((b) => b.length).join('/')} eligible low/mid/high`);
    } catch (e) { console.error(`Discovery ${user}: ${e.message}`); }
    if (visitedAmateur && bins.every((b) => b.length >= Math.ceil(count / 3))) break;
  }
  const selected = [];
  for (let i = 0; selected.length < count; i++) {
    const next = bins.flatMap((b) => b[i] ? [b[i]] : []);
    if (!next.length) break;
    selected.push(...next.slice(0, count - selected.length));
  }
  if (!selected.length) throw Error('No reviewed games discovered; supply --users=public,accounts');
  return selected;
}

const corpusPath = resolve(String(flags.corpus ?? resolve(directory, 'games.json')));
let games;
try { if (flags.refresh) throw Error(); games = (await jsonRead(corpusPath)).slice(0, count); if (games.length < count) throw Error(); }
catch { games = await discover(); await jsonWrite(corpusPath, games); }
if (flags['discover-only']) { console.log(JSON.stringify({ corpusPath, games: games.length, ratings: games.map(g=>[g.white.rating,g.black.rating]) },null,2)); process.exit(0); }

// Vite's SSR transformer loads the actual TS sources/JSON book without a second
// implementation or an extra TS runtime. It never starts a listening server.
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const { analyseWithEvaluator, secondLineCandidates } = await vite.ssrLoadModule('/src/lib/analysis.ts');
const { terminalEval } = await vite.ssrLoadModule('/src/lib/engine.ts');
const winpct = await vite.ssrLoadModule('/src/lib/winpct.ts');
const { sacrificeAmount } = await vite.ssrLoadModule('/src/lib/classify.ts');

class Evaluator {
  constructor(strategy) {
    this.strategy = strategy;
    this.listener = null;
    this.worker = new Worker(new URL('./calibrate/stockfish-worker.mjs', import.meta.url));
    this.worker.on('message', (line) => this.listener?.(line));
    this.sf = { processCommand: (command) => this.worker.postMessage(command) };
    this.ready = this.command('uci', 'uciok').then(async () => {
      this.sf.processCommand('setoption name Hash value 32');
      this.sf.processCommand('setoption name MultiPV value 2');
      await this.command('isready', 'readyok');
    });
  }
  command(cmd, token) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`Engine timeout: ${cmd}`)), 120_000);
      this.listener = (line) => { if (line.startsWith(token)) { clearTimeout(timer); this.listener = null; resolve(); } };
      this.sf.processCommand(cmd);
    });
  }
  async evaluate(fen, multipv = 2) {
    const terminal = terminalEval(fen);
    if (terminal) return terminal;
    await this.ready;
    this.sf.processCommand(`setoption name MultiPV value ${multipv}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Search timeout')), 120_000);
      const lines = [], depths = [];
      this.listener = (line) => {
        if (line.startsWith('info ') && line.includes(' pv ') && !/upperbound|lowerbound/.test(line)) {
          const m = /depth (\d+).*?(?:multipv (\d+).*?)?score (cp|mate) (-?\d+).*? pv (.+)/.exec(line);
          if (m) {
            const k = Number(m[2] ?? 1) - 1;
            depths[k] = Number(m[1]);
            lines[k] = { score: { [m[3]]: Number(m[4]) * (fen.split(' ')[1] === 'b' ? -1 : 1) }, pv: m[5].split(' ') };
          }
        }
        if (line.startsWith('bestmove')) {
          clearTimeout(timer); this.listener = null;
          if (!lines[0]) reject(Error('Engine returned no scored PV'));
          else resolve({ fen, depth: Math.min(...depths.filter(Number.isFinite)), lines: lines.filter(Boolean), source: 'local' });
        }
      };
      if (this.strategy === 'baseline') this.sf.processCommand('ucinewgame');
      this.sf.processCommand(`position fen ${fen}`);
      this.sf.processCommand(`go depth ${depth}`);
    });
  }
  terminate() { return this.worker.terminate(); }
}

// Original accuracy curve, frozen here for an honest before/after comparison.
function baselineMove(before, after) {
  return Math.max(0, Math.min(100, 103.1668100711649 * Math.exp(-0.04354415386753951 * Math.max(0, before - after)) - 3.166924740191411 + 1));
}
function baselineGame(curve, moves, color) {
  const window = Math.max(2, Math.min(8, Math.floor(curve.length / 10)));
  let weighted = 0, weightSum = 0, reciprocals = 0, n = 0;
  moves.forEach((m, i) => {
    if (m.color !== color) return;
    const xs = curve.slice(Math.max(0, Math.min(i, curve.length - window)), Math.max(0, Math.min(i, curve.length - window)) + window);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const weight = Math.max(.5, Math.min(12, Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length)));
    const acc = m.cls === 'book' || m.uci === m.bestUci ? 100 : baselineMove(m.winBefore, m.winAfter);
    weighted += acc * weight; weightSum += weight; reciprocals += 1 / Math.max(acc, 1); n++;
  });
  return n ? Math.round((weighted / weightSum + n / reciprocals) * 5) / 10 : 0;
}
function metrics(rows, field) {
  const pairs = rows.flatMap((r) => ['white', 'black'].map((c) => [r[field][c], r.reference[c]]));
  const n = pairs.length, mx = pairs.reduce((s, p) => s + p[0], 0) / n, my = pairs.reduce((s, p) => s + p[1], 0) / n;
  const covariance = pairs.reduce((s, [x,y]) => s + (x-mx)*(y-my), 0);
  const variance = Math.sqrt(pairs.reduce((s,[x])=>s+(x-mx)**2,0)*pairs.reduce((s,[,y])=>s+(y-my)**2,0));
  return { sides: n, mae: pairs.reduce((s,[x,y])=>s+Math.abs(x-y),0)/n, correlation: variance ? covariance/variance : null };
}

function baselineLabel(m, i, moves, evaluations) {
  if (m.cls === 'book' || m.cls === 'forced') return m.cls;
  const best = m.uci === m.bestUci, loss = m.epLoss;
  let cls = best ? 'best' : loss < .02 ? 'excellent' : loss < .05 ? 'good' : loss < .1 ? 'inaccuracy' : loss < .2 ? 'mistake' : 'blunder';
  const mateFor = (s) => s.mate !== undefined && (m.color === 'w' ? s.mate > 0 : s.mate < 0);
  if (['mistake','blunder','inaccuracy'].includes(cls) && m.winAfter >= 30 &&
      ((mateFor(m.scoreBefore) && !mateFor(m.scoreAfter)) || (moves[i-1]?.epLoss >= .1 && m.winBefore >= 60 && loss >= .1))) cls = 'miss';
  const move = new Chess(m.fenBefore).move(m.san);
  if (['best','excellent'].includes(cls) && sacrificeAmount(m.fenAfter, move) >= 2 && m.winAfter >= 50 && m.winBefore < 97) cls = 'brilliant';
  const second = evaluations[i].lines[1];
  if (cls === 'best' && second) {
    const winSecond = winpct.scoreToWin(second.score, m.color);
    const outcome = (w) => w >= 68 ? 2 : w >= 32 ? 1 : 0;
    const prev = moves[i-1] && new Chess(moves[i-1].fenBefore).move(moves[i-1].san);
    const recapture = prev?.captured && move.captured && prev.to === move.to;
    if (m.winBefore-winSecond >= 15 && outcome(winSecond)<outcome(m.winBefore) && !recapture && new Chess(m.fenBefore).moves().length>2) cls='great';
  }
  return cls;
}

const strategies = flags.strategy ? String(flags.strategy).split(',') : ['baseline', 'optimized'];
if (strategies.some((s) => !['baseline','optimized'].includes(s))) throw Error('Use --strategy=baseline,optimized');
const report = { settings: { depth, workers, games: games.length }, strategies: {} };
try {
  for (const strategy of strategies) {
    const pool = Array.from({ length: workers }, () => new Evaluator(strategy));
    const rows = [];
    try {
      await Promise.all(pool.map((e) => e.ready));
      for (const g of games) {
        const cache = resolve(directory, `${g.uuid ?? g.url.split('/').at(-1)}-${strategy}-d${depth}-w${workers}.json`);
        let record;
        try { if (flags.rerun) throw Error(); record = await jsonRead(cache); }
        catch {
          const start = performance.now();
          let evaluations;
          await analyseWithEvaluator(g.url, g.pgn, { depth }, async (fens) => {
            evaluations = new Array(fens.length);
            let next = 0;
            await Promise.all(pool.map(async (e, worker) => {
              if (strategy === 'optimized') {
                while (next < fens.length) {
                  const start = next; next += 4;
                  for (let i = start; i < Math.min(fens.length, start + 4); i++) evaluations[i] = await e.evaluate(fens[i], 1);
                }
                return;
              }
              while (true) {
                const i = next++;
                if (i >= fens.length) break;
                evaluations[i] = await e.evaluate(fens[i]);
              }
            }));
            if (strategy === 'optimized') {
              const chess = new Chess(); chess.loadPgn(g.pgn);
              const candidates = secondLineCandidates(chess.history({ verbose: true }), evaluations);
              next = 0;
              await Promise.all(pool.map(async (e) => {
                while (next < candidates.length) {
                  const start = next; next += 4;
                  for (let j = start; j < Math.min(candidates.length, start + 4); j++) {
                    const i = candidates[j]; evaluations[i] = await e.evaluate(fens[i], 2);
                  }
                }
              }));
            }
            return evaluations;
          }, true);
          record = { milliseconds: performance.now() - start, evaluations };
          await jsonWrite(cache, record);
        }
        const analysis = await analyseWithEvaluator(g.url, g.pgn, { depth }, async () => record.evaluations, true);
        const row = {
          url: g.url, ratings: [g.white.rating, g.black.rating], reference: g.accuracies,
          baseline: { white: baselineGame(analysis.winCurve, analysis.moves, 'w'), black: baselineGame(analysis.winCurve, analysis.moves, 'b') },
          current: { white: analysis.white.accuracy, black: analysis.black.accuracy },
          milliseconds: record.milliseconds, plies: analysis.moves.length,
          meanDepth: record.evaluations.filter(e=>e.source!=='terminal').reduce((s,e)=>s+e.depth,0)/record.evaluations.filter(e=>e.source!=='terminal').length,
          counts: Object.fromEntries(['brilliant','great','miss','blunder','mistake','inaccuracy'].map((k) => [k, analysis.white.counts[k] + analysis.black.counts[k]])),
          classifications: analysis.moves.map(m=>m.cls),
        };
        const oldLabels = analysis.moves.map((m,i)=>baselineLabel(m,i,analysis.moves,record.evaluations));
        row.baselineCounts = Object.fromEntries(['brilliant','great','miss','blunder','mistake','inaccuracy'].map(k=>[k,oldLabels.filter(c=>c===k).length]));
        if (flags.sweep) row.moveChances = analysis.moves.map(m=>({color:m.color,before:m.winBefore,after:m.winAfter,best:m.uci===m.bestUci,book:m.cls==='book'}));
        rows.push(row);
        console.error(`${strategy} ${rows.length}/${games.length}: ${row.ratings.join('/')} ${row.plies} plies ${(row.milliseconds/1000).toFixed(2)}s; chess.com ${Object.values(row.reference).join('/')} ours ${Object.values(row.current).join('/')}`);
      }
    } finally { await Promise.allSettled(pool.map((e) => e.terminate())); }
    report.strategies[strategy] = {
      baseline: metrics(rows, 'baseline'), current: metrics(rows, 'current'),
      fit: { baseline: metrics(rows.slice(0,6), 'baseline'), current: metrics(rows.slice(0,6), 'current') },
      holdout: rows.length > 6 ? { baseline: metrics(rows.slice(6), 'baseline'), current: metrics(rows.slice(6), 'current') } : null,
      meanSeconds: rows.reduce((s,r)=>s+r.milliseconds,0)/rows.length/1000,
      secondsPer80Plies: rows.reduce((s,r)=>s+r.milliseconds,0)/rows.reduce((s,r)=>s+r.plies,0)*80/1000,
      perGame: Object.fromEntries(['brilliant','great','miss','blunder','mistake','inaccuracy'].map(k=>[k,rows.reduce((s,r)=>s+r.counts[k],0)/rows.length])), rows,
      baselinePerGame: Object.fromEntries(['brilliant','great','miss','blunder','mistake','inaccuracy'].map(k=>[k,rows.reduce((s,r)=>s+r.baselineCounts[k],0)/rows.length])),
    };
  }
  if (report.strategies.baseline && report.strategies.optimized) {
    const deltas = [];
    let movesAgree = 0, positions = 0, labelsAgree = 0, plies = 0;
    for (let i = 0; i < games.length; i++) {
      const g = games[i], id = g.uuid ?? g.url.split('/').at(-1);
      const before = (await jsonRead(resolve(directory, `${id}-baseline-d${depth}-w${workers}.json`))).evaluations;
      const after = (await jsonRead(resolve(directory, `${id}-optimized-d${depth}-w${workers}.json`))).evaluations;
      before.forEach((e,j)=>{
        deltas.push(Math.abs(winpct.scoreToWhiteWin(e.lines[0].score)-winpct.scoreToWhiteWin(after[j].lines[0].score)));
        if(e.lines[0].pv[0]===after[j].lines[0].pv[0]) movesAgree++;
        positions++;
      });
      report.strategies.baseline.rows[i].classifications.forEach((c,j)=>{
        if(c===report.strategies.optimized.rows[i].classifications[j]) labelsAgree++;
        plies++;
      });
    }
    report.comparison = {
      speedup: report.strategies.baseline.meanSeconds/report.strategies.optimized.meanSeconds,
      positions, meanWinPointDelta: deltas.reduce((s,x)=>s+x,0)/positions,
      p95WinPointDelta: deltas.toSorted((a,b)=>a-b)[Math.floor(positions*.95)],
      bestMoveAgreement: movesAgree/positions, classificationAgreement: labelsAgree/plies,
    };
  }
  await jsonWrite(resolve(directory, `report-d${depth}.json`), report);
  console.log(JSON.stringify(report, null, 2));
} finally { await vite.close(); }
