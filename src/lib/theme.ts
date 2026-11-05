import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Invalid or absent saved preferences behave like system. Safe outside the browser. */
export function resolveTheme(theme: unknown, systemDark = false): ResolvedTheme {
  return theme === 'light' || theme === 'dark' ? theme : systemDark ? 'dark' : 'light';
}

const KEY = 'hindsight-theme';
let theme: Theme = 'system';
let initialized = false;
let media: MediaQueryList | undefined;
const listeners = new Set<() => void>();
let snapshot: { theme: Theme; resolved: ResolvedTheme } = { theme, resolved: 'light' };

function apply() {
  const resolved = resolveTheme(theme, media?.matches);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = resolved === 'dark' ? '#17191c' : '#faf9f6';
  }
  if (snapshot.theme !== theme || snapshot.resolved !== resolved) {
    snapshot = { theme, resolved };
    listeners.forEach(listener => listener());
  }
}

/** Call before rendering React to apply the saved preference without a flash. */
export function initTheme(): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') theme = saved;
  } catch { /* Storage may be unavailable in private or restricted contexts. */ }
  media = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (media?.addEventListener) media.addEventListener('change', apply);
  else media?.addListener(apply);
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    theme = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system';
    apply();
  });
  apply();
}

function setTheme(next: Theme): void {
  initTheme();
  theme = next === 'light' || next === 'dark' ? next : 'system';
  try { window.localStorage.setItem(KEY, theme); } catch { /* Keep the in-memory preference. */ }
  apply();
}

const serverSnapshot = { theme: 'system' as Theme, resolved: 'light' as ResolvedTheme };
const subscribe = (listener: () => void) => {
  initTheme();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useTheme(): { theme: Theme; resolved: ResolvedTheme; setTheme: (theme: Theme) => void } {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot);
  return { ...state, setTheme };
}

