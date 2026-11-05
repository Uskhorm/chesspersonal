/** Exploratory grid fit on first six games; final three are held out.
 * Run after calibrate has populated depth-16 baseline evaluations.
 * This does not modify production constants. */
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const games = JSON.parse(await readFile('scripts/calibrate/results/games.json', 'utf8'));
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { analyseWithEvaluator } = await vite.ssrLoadModule('/src/lib/analysis.ts');
  const rows = [];
  for (const g of games) {
    const { evaluations } = JSON.parse(await readFile(`scripts/calibrate/results/${g.uuid}-baseline-d16-w4.json`, 'utf8'));
    const a = await analyseWithEvaluator(g.url, g.pgn, { depth: 16 }, async () => evaluations, true);
    rows.push({ g, a });
  }
  const candidates = [];
  for (let k = .03; k <= .120001; k += .0025) for (let blend = 0; blend <= 1.00001; blend += .05) {
    const errors = [];
    for (const { g, a } of rows) {
      const window = Math.max(2, Math.min(8, Math.floor(a.winCurve.length / 10)));
      for (const color of ['w','b']) {
        let weighted = 0, weights = 0, inv = 0, count = 0;
        a.moves.forEach((m,i) => {
          if (m.color !== color) return;
          const start = Math.max(0, Math.min(i, a.winCurve.length - window));
          const xs = a.winCurve.slice(start, start + window), mean = xs.reduce((s,x)=>s+x,0)/xs.length;
          const weight = Math.max(.5, Math.min(12, Math.sqrt(xs.reduce((s,x)=>s+(x-mean)**2,0)/xs.length)));
          const acc = m.cls === 'book' || m.uci === m.bestUci ? 100 : Math.max(0, Math.min(100, 103.1668100711649*Math.exp(-k*Math.max(0,m.winBefore-m.winAfter))-3.166924740191411+1));
          weighted += acc*weight; weights += weight; inv += 1/Math.max(acc,1); count++;
        });
        const value = (1-blend)*weighted/weights + blend*count/inv;
        errors.push(Math.abs(value - g.accuracies[color==='w'?'white':'black']));
      }
    }
    candidates.push({k:+k.toFixed(4),blend:+blend.toFixed(2),train:errors.slice(0,12).reduce((s,x)=>s+x,0)/12,holdout:errors.slice(12).reduce((s,x)=>s+x,0)/(errors.length-12),all:errors.reduce((s,x)=>s+x,0)/errors.length});
  }
  console.log(JSON.stringify(candidates.toSorted((a,b)=>a.train-b.train).slice(0,20),null,2));
} finally { await vite.close(); }
