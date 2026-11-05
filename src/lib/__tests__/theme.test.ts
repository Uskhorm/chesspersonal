import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../theme';

describe('resolveTheme', () => {
  it('honours explicit themes regardless of the system preference', () => {
    for (const systemDark of [false, true]) {
      expect(resolveTheme('light', systemDark)).toBe('light');
      expect(resolveTheme('dark', systemDark)).toBe('dark');
    }
  });
  it('follows the system for system, missing, and invalid preferences', () => {
    for (const preference of ['system', null, undefined, '', 'sepia', {}, 1]) {
      expect(resolveTheme(preference, false)).toBe('light');
      expect(resolveTheme(preference, true)).toBe('dark');
    }
  });
  it('defaults safely to light when no system preference is available', () => {
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme(undefined)).toBe('light');
  });
});
