import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { buildSteps, PlaybackController } from '../playback';

vi.mock('../narrate', () => ({ describeMove: (fen: string, move: string) => `Move ${move} from ${fen}` }));

describe('buildSteps', () => {
  it('includes the starting position and legal SAN/UCI positions and narration', () => {
    const steps = buildSteps(DEFAULT_POSITION, ['e4', 'e7e5', 'Nf3']);
    const chess = new Chess();
    expect(steps[0]).toEqual({ fen: DEFAULT_POSITION });
    for (const [index, move] of ['e4', 'e7e5', 'Nf3'].entries()) {
      const before = chess.fen();
      chess.move(move);
      expect(steps[index + 1].fen).toBe(chess.fen());
      expect(steps[index + 1].label).toBe(`Move ${move} from ${before}`);
    }
    expect(steps[3].lastMove).toEqual(['g1', 'f3']);
  });
  it('handles empty lines, castling, promotion and invalid moves', () => {
    expect(buildSteps(DEFAULT_POSITION, [])).toHaveLength(1);
    expect(buildSteps('4k3/8/8/8/8/8/8/4K2R w K - 0 1', ['O-O'])[1].lastMove).toEqual(['e1', 'g1']);
    expect(buildSteps('7k/P7/8/8/8/8/8/7K w - - 0 1', ['a7a8q'])[1].fen).toContain('Q6k');
    expect(() => buildSteps(DEFAULT_POSITION, ['e5'])).toThrow();
    expect(() => buildSteps('bad fen', [])).toThrow();
  });
});

describe('PlaybackController (the hook timer store, without a DOM)', () => {
  const steps = [{ fen: 'start' }, { fen: 'middle' }, { fen: 'end' }];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  it('chains default timers and stops immediately at the end', () => {
    const c = new PlaybackController(steps);
    c.play();
    vi.advanceTimersByTime(899);
    expect(c.getSnapshot().index).toBe(0);
    vi.advanceTimersByTime(1);
    expect(c.getSnapshot()).toMatchObject({ index: 1, progress: 0.5, playing: true });
    vi.advanceTimersByTime(900);
    expect(c.getSnapshot()).toMatchObject({ index: 2, progress: 1, playing: false });
    expect(vi.getTimerCount()).toBe(0);
    c.play();
    expect(c.getSnapshot().index).toBe(0);
  });
  it('scales speed and cancels pending timeouts on pause, navigation and disposal', () => {
    const c = new PlaybackController(steps, { interval: 1000 });
    c.setSpeed(2); c.play();
    vi.advanceTimersByTime(500);
    expect(c.getSnapshot().index).toBe(1);
    c.setSpeed(0.5);
    vi.advanceTimersByTime(1999);
    expect(c.getSnapshot().index).toBe(1);
    c.pause(); vi.advanceTimersByTime(5000);
    expect(c.getSnapshot().index).toBe(1);
    c.prev(); c.toggle(); c.seek(1);
    expect(vi.getTimerCount()).toBe(1);
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('loops and pauses when hidden without silently restarting on visibility', () => {
    const c = new PlaybackController(steps, { interval: 100, loop: true });
    c.play(); vi.advanceTimersByTime(300);
    expect(c.getSnapshot()).toMatchObject({ index: 0, playing: true });
    c.setHidden(true); c.play(); vi.advanceTimersByTime(1000);
    expect(c.getSnapshot()).toMatchObject({ index: 0, playing: false });
    c.setHidden(false); vi.advanceTimersByTime(1000);
    expect(c.getSnapshot().playing).toBe(false);
    c.play(); vi.advanceTimersByTime(100);
    expect(c.getSnapshot().index).toBe(1);
  });
  it('clamps seeking, handles short lists, reconfigures and notifies subscribers', () => {
    const c = new PlaybackController(steps);
    const listener = vi.fn(); const unsubscribe = c.subscribe(listener);
    c.seek(99); expect(c.getSnapshot().index).toBe(2);
    c.seek(-1); expect(c.getSnapshot().index).toBe(0);
    c.next(); c.prev(); expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe(); c.configure([]); c.play();
    expect(c.getSnapshot()).toMatchObject({ index: 0, step: undefined, progress: 0, playing: false });
    c.configure([steps[0]]); c.toggle();
    expect(c.getSnapshot().playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
