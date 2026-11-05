import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { bestCaptureGain, classify, isFork, type ClassifyInput } from '../classify';
import { analyseWithEvaluator, parseClocks, pvToSan, secondLineCandidates, uciToSan } from '../analysis';
import { engine, terminalEval } from '../engine';
import { verifyMove } from '../verify';
import type { PositionEval } from '../types';

function input(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  const move = new Chess().move('e4');
  return { move, fenAfter: move.after, legalCount: 20, isBook: false,
    bestUci: 'd2d4', winBefore: 60, winAfter: 60, scoreBefore: { cp: 100 },
    scoreAfter: { cp: 100 }, prevOppLoss: 0, ...overrides };
}

describe('expected-points classification', () => {
  it.each([
    [0, 'excellent'], [1.99, 'excellent'], [2, 'good'], [4.99, 'good'],
    [5, 'inaccuracy'], [9.99, 'inaccuracy'], [10, 'mistake'], [19.99, 'mistake'], [20, 'blunder'],
  ])('classifies a %s point loss as %s', (loss, cls) => {
    const result = classify(input({ winAfter: 60 - Number(loss) }));
    expect(result.cls).toBe(cls);
    expect(result.loss).toBeCloseTo(Number(loss) / 100);
  });
  it('does not penalize best moves for search noise or improving alternatives', () => {
    expect(classify(input({ bestUci: 'e2e4', winAfter: 30 }))).toMatchObject({ cls: 'best', loss: 0 });
    expect(classify(input({ winAfter: 65 }))).toMatchObject({ cls: 'excellent', loss: 0 });
  });
  it('prioritizes forced and book moves', () => {
    expect(classify(input({ legalCount: 1, isBook: true })).cls).toBe('forced');
    expect(classify(input({ isBook: true })).cls).toBe('book');
  });
  it('requires a changed outcome and a large gap for great', () => {
    expect(classify(input({ bestUci: 'e2e4', winBefore: 75, winAfter: 75, winSecond: 45 })).cls).toBe('great');
    expect(classify(input({ bestUci: 'e2e4', winBefore: 75, winAfter: 75, winSecond: 60 })).cls).toBe('best');
    expect(classify(input({ bestUci: 'e2e4', winBefore: 99, winAfter: 99, winSecond: 45 })).cls).toBe('best');
    expect(classify(input({ bestUci: 'e2e4' })).cls).toBe('best');
  });
  it('only calls a surrendered winning opportunity a miss', () => {
    expect(classify(input({ winBefore: 80, winAfter: 55, prevOppLoss: .2 })).cls).toBe('miss');
    expect(classify(input({ winBefore: 85, winAfter: 70, prevOppLoss: .2 })).cls).toBe('mistake');
    expect(classify(input({ winBefore: 80, winAfter: 55, prevOppLoss: 0 })).cls).toBe('blunder');
  });
  it('recognizes a sound new bishop sacrifice without rewarding an unsound one', () => {
    const c = new Chess('rnbq1rk1/ppp2ppp/4pn2/3p4/3P4/2PBPN2/PP3PPP/RNBQ1RK1 w - - 0 1');
    const move = c.move('Bxh7+');
    const sacrifice = input({ move, fenAfter: move.after, bestUci: move.lan, winBefore: 65, winAfter: 65 });
    expect(classify(sacrifice)).toMatchObject({ cls: 'brilliant', sacrifice: 2 });
    expect(classify({ ...sacrifice, bestUci: 'f3g5', winAfter: 30 }).cls).toBe('blunder');
    expect(classify({ ...sacrifice, winBefore: 99, winAfter: 99 }).cls).toBe('best');
  });
  it('handles black winning chances symmetrically', () => {
    const c = new Chess(); c.move('e4'); const move = c.move('e5');
    expect(classify(input({ move, fenAfter: move.after, bestUci: 'c7c5', winBefore: 80, winAfter: 55, prevOppLoss: .2 })).cls).toBe('miss');
  });
  it('does not award Great for a routine recapture', () => {
    const c = new Chess(); c.move('e4'); c.move('d5'); const prevMove = c.move('exd5'); const move = c.move('Qxd5');
    expect(classify(input({ move, fenAfter: move.after, prevMove, bestUci: move.lan, winBefore: 70, winAfter: 70, winSecond: 40 })).cls).toBe('best');
  });
});

describe('worker scheduling', () => {
  it('retains hash, requests the full depth, and keeps short consecutive runs together', async () => {
    const workers: FakeWorker[] = [];
    class FakeWorker {
      commands: string[] = [];
      onmessage?: (event: { data: string }) => void;
      constructor() { workers.push(this); }
      postMessage(command: string) {
        this.commands.push(command);
        const emit = (data: string) => queueMicrotask(() => this.onmessage?.({ data }));
        if (command === 'uci') emit('uciok');
        if (command === 'isready') emit('readyok');
        if (command.startsWith('go ')) {
          emit('info depth 16 multipv 1 score cp 10 pv e2e4');
          emit('bestmove e2e4');
        }
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const c = new Chess();
      const fens = [c.fen()];
      for (const san of ['e4','e5','Nf3','Nc6','Bc4','Bc5','O-O','Nf6']) { c.move(san); fens.push(c.fen()); }
      const results = await engine.analyseBatch(fens, 16, 1);
      expect(results.map(e=>e.fen)).toEqual(fens);
      const commands = workers.flatMap(w=>w.commands);
      expect(commands.filter(c=>c==='ucinewgame')).toHaveLength(0);
      expect(commands.filter(c=>c.startsWith('go '))).toEqual(Array(fens.length).fill('go depth 16'));
      expect(workers[0].commands.filter(c=>c.startsWith('position ')).slice(0,4)).toEqual(fens.slice(0,4).map(f=>`position fen ${f}`));
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('tactical helpers and shared pipeline', () => {
  it('uses legal captures and finds forks', () => {
    expect(bestCaptureGain('4k3/8/8/8/8/8/q7/R3K3 w Q - 0 1').gain).toBe(9);
    expect(isFork('4k3/8/5N2/8/8/8/8/4K2r b - - 0 1', 'f6', 'w')).toBe(false);
    expect(isFork('4k3/8/5N2/7q/8/8/8/4K3 b - - 0 1', 'f6', 'w')).toBe(true);
  });
  it('converts legal PVs, stopping at invalid moves', () => {
    const fen = new Chess().fen();
    expect(pvToSan(fen, ['e2e4', 'e7e5', 'e1e8'])).toEqual(['e4', 'e5']);
    expect(uciToSan(fen, 'e1e8')).toBeNull();
    expect(parseClocks('{[%clk 0:10:02.5]} {[%clk 1:00:00]}')).toEqual([602.5, 3600]);
  });
  it('runs the actual classification pipeline with an injected evaluator', async () => {
    const result = await analyseWithEvaluator('test', '1. f3 e5 2. g4 Qh4#', { depth: 12 }, async (fen) =>
      terminalEval(fen) ?? { fen, depth: 12, lines: [{ score: { cp: 0 }, pv: [] }], source: 'local' });
    expect(result.moves).toHaveLength(4);
    expect(result.winCurve.at(-1)).toBe(0);
    expect(Object.values(result.white.counts).reduce((a,b)=>a+b,0)).toBe(2);
  });
  it('rejects malformed evaluator output', async () => {
    await expect(analyseWithEvaluator('bad', '1. e4', { depth: 12 }, async (fen) =>
      ({ fen, depth: 12, lines: [], source: 'local' }))).rejects.toThrow('nonempty evaluation');
  });
  it('requests a second PV only for eligible played best moves', () => {
    const c = new Chess('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    const m = c.move('e4');
    const e: PositionEval = { fen: m.before, depth: 16, lines: [{score:{cp:100},pv:[m.lan]}], source:'local' };
    expect(secondLineCandidates([m], [e])).toEqual([0]);
    expect(secondLineCandidates([m], [{...e,lines:[{score:{cp:100},pv:['e1d1']}]}])).toEqual([]);
    expect(secondLineCandidates([m], [{...e,lines:[{score:{cp:1000},pv:[m.lan]}]}])).toEqual([]);
    expect(secondLineCandidates([m], [{...e,lines:[...e.lines,...e.lines]}])).toEqual([]);
  });
  it('checks an underpromotion instead of accepting matching from/to squares', async () => {
    const fen = '7k/P7/8/8/8/8/8/7K w - - 0 1';
    const spy = vi.spyOn(engine, 'analyse').mockImplementation(async (after) => ({
      fen: after, depth: 13, lines: [{score:{cp:0},pv:[]}], source:'local',
    }));
    try {
      const result = await verifyMove(fen, 'a7a8n', 'a7a8q', 99);
      expect(result.exact).toBe(false);
      expect(result.ok).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
      const exact = await verifyMove(fen, 'a7a8q', 'a7a8q', 99);
      expect(exact).toMatchObject({exact:true,ok:true});
    } finally { spy.mockRestore(); }
  });
});
