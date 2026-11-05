import { describe, expect, it } from 'vitest';
import { cpToWin, formatScore, gameAccuracy, moveAccuracy, scoreToWhiteWin, scoreToWin, scoreValue } from '../winpct';

describe('expected-points model', () => {
  it('is bounded, monotonic, symmetric, and neutral at equality', () => {
    expect(cpToWin(0)).toBe(50);
    for (const cp of [0, 20, 100, 300, 1000, 100000]) {
      expect(cpToWin(cp)).toBeGreaterThanOrEqual(50);
      expect(cpToWin(cp)).toBeLessThanOrEqual(100);
      expect(cpToWin(cp) + cpToWin(-cp)).toBeCloseTo(100);
    }
    expect(cpToWin(300)).toBeGreaterThan(cpToWin(100));
  });
  it('converts white POV to mover POV and preserves mates', () => {
    expect(scoreToWin({ cp: 200 }, 'b')).toBeCloseTo(100 - scoreToWin({ cp: 200 }, 'w'));
    expect(scoreToWhiteWin({ mate: 3 })).toBe(100);
    expect(scoreToWhiteWin({ mate: -2 })).toBe(0);
    expect(scoreToWhiteWin({ mate: 0 })).toBe(50);
    expect(scoreToWhiteWin({})).toBe(50);
    expect(scoreValue({ mate: 1 })).toBeGreaterThan(scoreValue({ mate: 5 }));
    expect(scoreValue({ mate: -5 })).toBeGreaterThan(scoreValue({ mate: -1 }));
  });
});

describe('accuracy and formatting', () => {
  it('gives full credit for maintained/improved chances and decreases with loss', () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(50, 60)).toBe(100);
    expect(moveAccuracy(80, 60)).toBeLessThan(moveAccuracy(80, 70));
    expect(moveAccuracy(100, 0)).toBeGreaterThanOrEqual(0);
  });
  it('keeps sides separate and handles empty input', () => {
    expect(gameAccuracy([], [], 'w')).toBe(0);
    expect(gameAccuracy([50,50,50,50,50], [100,50,100,50], 'w')).toBe(100);
    expect(gameAccuracy([50,50,50,50,50], [100,50,100,50], 'b')).toBe(50);
    expect(gameAccuracy([50,50], [100], 'b')).toBe(0);
  });
  it('penalizes catastrophic moves but keeps finite accuracy', () => {
    const result = gameAccuracy(Array(21).fill(50), [0,...Array(19).fill(100)], 'w');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(90);
    expect(Number.isFinite(result)).toBe(true);
  });
  it('supports games starting with black to move', () => {
    expect(gameAccuracy([50,50,50], [40,100], 'b', 'b')).toBe(40);
    expect(gameAccuracy([50,50,50], [40,100], 'w', 'b')).toBe(100);
  });
  it('formats cp and mate without losing signs', () => {
    expect(formatScore({cp:125})).toBe('+1.3');
    expect(formatScore({cp:-125})).toBe('-1.3');
    expect(formatScore({mate:3})).toBe('M3');
    expect(formatScore({mate:-3})).toBe('-M3');
    expect(formatScore({mate:0})).toBe('#');
    expect(formatScore(undefined)).toBe('0.0');
  });
});
