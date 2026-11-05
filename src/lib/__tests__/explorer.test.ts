import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
vi.mock('../live', () => ({ startLive: vi.fn(() => () => {}), createLiveSession: () => vi.fn(() => () => {}) }));
import { createExplorerState, explorerReducer } from '../explorer';

const initial = () => createExplorerState(new Chess().fen());
describe('explorer move tree', () => {
  it('plays a line and navigates backwards, forwards and directly', () => {
    const root = initial();
    const played = explorerReducer(root, { type: 'playLine', ucis: ['e2e4', 'e7e5', 'g1f3'] });
    expect(played.nodes[played.current].san).toBe('Nf3');
    const back = explorerReducer(played, { type: 'back' });
    expect(back.nodes[back.current].san).toBe('e5');
    expect(explorerReducer(back, { type: 'forward' }).current).toBe(played.current);
    expect(explorerReducer(played, { type: 'goto', id: 'root' }).current).toBe('root');
    expect(explorerReducer(played, { type: 'goto', id: 'missing' })).toBe(played);
    expect(root.nodes.root.children).toEqual([]);
    expect(Object.keys(root.nodes)).toEqual(['root']);
  });
  it('preserves variations and reuses existing children', () => {
    const first = explorerReducer(initial(), { type: 'playLine', ucis: ['e2e4', 'e7e5'] });
    const branch = explorerReducer(first, { type: 'back' });
    const second = explorerReducer(branch, { type: 'playLine', ucis: ['c7c5'] });
    expect(second.nodes[branch.current].children).toEqual([first.current, second.current]);
    expect(first.nodes[branch.current].children).toEqual([first.current]);
    const back = explorerReducer(second, { type: 'back' });
    expect(explorerReducer(back, { type: 'forward' }).current).toBe(first.current);
    const reused = explorerReducer(back, { type: 'playLine', ucis: ['c7c5'] });
    expect(reused.current).toBe(second.current);
    expect(reused.nextId).toBe(second.nextId);
  });
  it('rejects illegal moves and stops lines at the last legal position', () => {
    const state = initial();
    expect(explorerReducer(state, { type: 'playLine', ucis: ['e2e5'] })).toBe(state);
    const played = explorerReducer(state, { type: 'playLine', ucis: ['e2e4', 'e7e4', 'g1f3'] });
    expect(played.nodes[played.current].san).toBe('e4');
    expect(explorerReducer(state, { type: 'back' })).toBe(state);
    expect(explorerReducer(state, { type: 'forward' })).toBe(state);
  });
  it('handles promotions and resets to a new root', () => {
    const fen = '7k/P7/8/8/8/8/8/7K w - - 0 1';
    const state = explorerReducer(createExplorerState(fen), { type: 'playLine', ucis: ['a7a8n'] });
    expect(state.nodes[state.current].uci).toBe('a7a8n');
    expect(new Chess(state.nodes[state.current].fen).get('a8')?.type).toBe('n');
    const reset = explorerReducer(state, { type: 'reset', fen });
    expect(reset.current).toBe('root');
    expect(Object.keys(reset.nodes)).toHaveLength(1);
    expect(reset.nodes.root.fen).toBe(fen);
  });
});
