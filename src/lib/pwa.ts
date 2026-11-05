import { useSyncExternalStore } from 'react';

export type PWARoute = 'network' | 'font' | 'navigation' | 'immutable';

/** Pure counterpart of public/sw.js routing, usable without a browser. */
export function classifyPWARequest(
  request: { url: string; method: string; mode?: string },
  scope: string,
): PWARoute {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  const base = new URL(scope);
  if (url.origin !== base.origin) {
    return url.protocol === 'https:' &&
      ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
      ? 'font' : 'network';
  }
  if (!url.pathname.startsWith(base.pathname)) return 'network';
  const path = url.pathname.slice(base.pathname.length);
  if (request.mode === 'navigate') return 'navigation';
  if (path.startsWith('assets/')) return 'immutable';
  if (/^engine\/.+\.(?:js|wasm)$/.test(path)) return 'immutable';
  return 'network';
}

type InstallOutcome = 'accepted' | 'dismissed';
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome }>;
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
let registration: ServiceWorkerRegistration | undefined;
let registering: Promise<ServiceWorkerRegistration | undefined> | undefined;
let deferredPrompt: InstallPromptEvent | undefined;
let applyingUpdate = false;
let browserEventsReady = false;

function standalone(): boolean {
  return typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function initBrowserEvents() {
  if (typeof window === 'undefined' || browserEventsReady) return;
  browserEventsReady = true;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    emit();
  });
  window.addEventListener('online', emit);
  window.addEventListener('offline', emit);
  window.matchMedia?.('(display-mode: standalone)').addEventListener('change', emit);
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    emit();
    if (applyingUpdate) {
      applyingUpdate = false;
      window.location.reload();
    }
  });
}

// Capture install events before a UI component mounts.
initBrowserEvents();

/** Call once at startup. Development and unsupported browsers are harmless no-ops. */
export function registerSW(): Promise<ServiceWorkerRegistration | undefined> {
  initBrowserEvents();
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(undefined);
  }
  if (registering) return registering;
  registering = navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
    updateViaCache: 'none',
  }).then(value => {
    registration = value;
    const observeInstalling = () => {
      const worker = value.installing;
      worker?.addEventListener('statechange', emit);
      emit();
    };
    value.addEventListener('updatefound', observeInstalling);
    observeInstalling();
    return value;
  }).catch(() => {
    // Registration is optional; retry on a later call without breaking app startup.
    registering = undefined;
    return undefined;
  });
  return registering;
}

const updateAvailable = () => Boolean(registration?.waiting && navigator.serviceWorker.controller);
function applyUpdate(): void {
  if (!registration?.waiting) return;
  applyingUpdate = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function useSWUpdate(): { updateAvailable: boolean; applyUpdate(): void } {
  return { updateAvailable: useSyncExternalStore(subscribe, updateAvailable, () => false), applyUpdate };
}

async function promptInstall(): Promise<InstallOutcome> {
  const event = deferredPrompt;
  if (!event || standalone()) return 'dismissed';
  deferredPrompt = undefined;
  emit();
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return 'dismissed';
  }
}

export function useInstallPrompt(): {
  canInstall: boolean;
  promptInstall(): Promise<InstallOutcome>;
  isStandalone: boolean;
} {
  const isStandalone = useSyncExternalStore(subscribe, standalone, () => false);
  const canInstall = useSyncExternalStore(subscribe, () => Boolean(deferredPrompt) && !standalone(), () => false);
  return { canInstall, promptInstall, isStandalone };
}

/** Connectivity hint only: navigator.onLine does not prove an API is reachable. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/** Browsers may refuse persistence; callers can use the returned grant status. */
export async function persistStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface StreakReminderState {
  streakCount: number;
  lastActiveDay: string | null;
  dueCount: number;
  enabled: boolean;
}

function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Local evening eligibility; permission and daily delivery guards belong to the caller. */
export function shouldRemind(state: StreakReminderState, now: Date | number): boolean {
  const date = new Date(now);
  return state.enabled && state.streakCount >= 1 && date.getHours() >= 19 && state.lastActiveDay !== localDay(date);
}

/** Start once at app startup; reads fresh state on each check. Timers/background sync are best effort. */
export function scheduleStreakReminder(getState: () => StreakReminderState): () => void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return () => {};
  let stopped = false, checking = false;
  const check = async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      const state = getState();
      const reg = registration ?? await navigator.serviceWorker?.getRegistration?.();
      if (stopped) return;
      const scope = reg?.scope ?? new URL(import.meta.env.BASE_URL, window.location.href).href;
      const cacheName = `hindsight:${scope}:streak`;
      const stateKey = new URL('streak-state.json', scope).href;
      const sentKey = new URL('streak-sent.json', scope).href;
      const storageKey = `${cacheName}:sent`;
      let cache: Cache | undefined;
      try {
        cache = await caches.open(cacheName);
        await cache.put(stateKey, new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }));
      } catch { /* Private browsing and full storage must not break the app. */ }
      const periodic = (reg as (ServiceWorkerRegistration & { periodicSync?: { register(tag: string, options: { minInterval: number }): Promise<void> } }) | undefined)?.periodicSync;
      if (periodic && navigator.permissions?.query) {
        try {
          const permission = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
          if (!stopped && permission.state === 'granted') await periodic.register('streak-check', { minInterval: 6 * 60 * 60 * 1000 });
        } catch { /* Experimental API is optional; never request permission here. */ }
      }
      if (stopped || !reg || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const deliver = async () => {
        const now = new Date(), day = localDay(now);
        if (stopped || !shouldRemind(state, now)) return;
        let sent: string | undefined;
        try { sent = window.localStorage.getItem(storageKey) ?? undefined; } catch { /* optional */ }
        if (sent === day) return;
        try { sent = (await (await cache?.match(sentKey))?.json())?.day ?? sent; } catch { /* optional */ }
        if (sent === day) return;
        await reg.showNotification(`Your ${state.streakCount}-day streak ends at midnight`, {
          body: state.dueCount > 0 ? `${state.dueCount} mistake${state.dueCount === 1 ? '' : 's'} due. Two minutes keeps it alive.` : 'No mistakes due. Two minutes of practice keeps it alive.',
          tag: 'streak', data: { url: `${scope}#/train/session` },
        });
        try { window.localStorage.setItem(storageKey, day); } catch { /* optional */ }
        try { await cache?.put(sentKey, new Response(JSON.stringify({ day }))); } catch { /* optional */ }
      };
      // Shared with the worker to serialize delivery across tabs/background checks where supported.
      if (navigator.locks?.request) await navigator.locks.request(cacheName, deliver);
      else await deliver();
    } catch { /* Reminders are best effort, including notification delivery. */ }
    finally { checking = false; }
  };
  void check();
  const timer = window.setInterval(() => { void check(); }, 10 * 60 * 1000);
  const refresh = () => { void check(); };
  window.addEventListener('focus', refresh);
  window.addEventListener('visibilitychange', refresh);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('visibilitychange', refresh);
  };
}
