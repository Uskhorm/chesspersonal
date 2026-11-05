import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { drillContext } from '../../components/MoveContext';

const base = { gameId: 'context-test', ply: 3, color: 'w' as const };

describe('visual move context', () => {
  it('reconstructs the actual opponent move and mistake as separate playable positions', () => {
    const c = new Chess();
    c.move('e4');
    const before = c.fen();
    c.move('e5');
    const fen = c.fen();
    const ctx = drillContext({ ...base, fen, playedSan: 'Qh5' }, { ply: 2, fenBefore: before, san: 'e5' });
    expect(ctx.theirs).toMatchObject({ from: 'e7', to: 'e5' });
    expect(ctx.mine).toMatchObject({ from: 'd1', to: 'h5' });
    expect(ctx.prevFen).toBe(before);
    expect(ctx.fen).toBe(fen);
    expect(new Chess(ctx.mineAfterFen).get('h5')).toMatchObject({ type: 'q', color: 'w' });
    expect(new Chess(ctx.fen).get('d1')).toMatchObject({ type: 'q', color: 'w' });
  });

  it('keeps the mistake when the preceding move is missing or belongs to another position', () => {
    const c = new Chess();
    c.move('e4'); c.move('e5');
    const drill = { ...base, fen: c.fen(), playedSan: 'Qh5' };
    for (const prev of [undefined, { ply: 2, fenBefore: new Chess().fen(), san: 'd4' }, { ply: 1, fenBefore: new Chess().fen(), san: 'e4' }]) {
      const ctx = drillContext(drill, prev);
      expect(ctx.mine?.to).toBe('h5');
      expect(ctx.theirs).toBeUndefined();
      expect(ctx.prevFen).toBeUndefined();
    }
  });

  it('handles the first move and malformed legacy notation without inventing a move', () => {
    expect(drillContext({ ...base, ply: 1, fen: new Chess().fen(), playedSan: 'e4' }).mine?.to).toBe('e4');
    const invalid = drillContext({ ...base, fen: new Chess().fen(), playedSan: 'Qh9' });
    expect(invalid.mine).toBeUndefined();
    expect(invalid.mineAfterFen).toBeUndefined();
  });

  it.each([
    ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'O-O', 'g1', 'k'],
    ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'exd6', 'd6', 'p'],
    ['4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a8=N', 'a8', 'n'],
  ])('replays special moves legally: %s %s', (fen, playedSan, to, type) => {
    const ctx = drillContext({ ...base, fen, playedSan });
    expect(ctx.mine?.to).toBe(to);
    expect(new Chess(ctx.mineAfterFen).get(to as 'g1')).toMatchObject({ type, color: 'w' });
  });
});
