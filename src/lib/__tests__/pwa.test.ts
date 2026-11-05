import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { classifyPWARequest, persistStorage, registerSW, shouldRemind, scheduleStreakReminder } from '../pwa';

const workerSource = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');

function worker(scope: string) {
  const handlers: Record<string, (event: any) => void> = {};
  const entries = new Map<string, Response>();
  const keyOf = (key: string | Request) => typeof key === 'string' ? key : key.url;
  const cache = {
    put: vi.fn(async (key: string | Request, value: Response) => { entries.set(keyOf(key), value.clone()); }),
    match: vi.fn(async (key: string | Request) => entries.get(keyOf(key))?.clone()),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [] as string[]),
    delete: vi.fn(async (_key: string) => true),
  };
  const fetch = vi.fn(async (_request: Request) => new Response('network'));
  const self = {
    registration: { scope, showNotification: vi.fn(async () => {}) },
    Notification: { permission: 'granted' },
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => [] as any[]), openWindow: vi.fn(async (_url: string) => {}) },
    skipWaiting: vi.fn(async () => {}),
    addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; },
  };
  const context = { self, caches, fetch, URL, Request, Response, Set, Date };
  runInNewContext(workerSource, context);
  return {
    cache, caches, fetch, self, handlers,
    classify: (request: object) => runInNewContext(`classifyRequest(${JSON.stringify(request)})`, context),
    async lifecycle(name: string, data?: object) {
      let pending: Promise<unknown> | undefined;
      handlers[name]({ data, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
      await pending;
    },
    async request(url: string, mode?: string) {
      let response: Promise<Response> | undefined;
      const background: Promise<unknown>[] = [];
      handlers.fetch({
        request: mode ? { url, method: 'GET', mode } : new Request(url),
        respondWith: (promise: Promise<Response>) => { response = promise; },
        waitUntil: (promise: Promise<unknown>) => { background.push(promise); },
      });
      const result = await response;
      await Promise.all(background);
      return result;
    },
  };
}

describe('PWA request routing (client helper and actual worker)', () => {
  for (const base of ['/', '/chesspersonal/', '/hindsight/']) {
    const scope = `https://example.com${base}`;
    const cases = [
      { url: `${scope}review/123`, mode: 'navigate', expected: 'navigation' },
      { url: `${scope}assets/openings-abc.js`, expected: 'immutable' },
      { url: `${scope}assets/index-abc.css?v=1`, expected: 'immutable' },
      { url: `${scope}engine/stockfish-19-lite-single.js`, expected: 'immutable' },
      { url: `${scope}engine/stockfish-19-lite-single.wasm`, expected: 'immutable' },
      { url: `${scope}engine/config.json`, expected: 'network' },
      { url: `${scope}api/sync`, expected: 'network' },
      { url: `${scope}assets/upload`, method: 'POST', expected: 'network' },
      { url: 'https://api.chess.com/pub/player/name', expected: 'network' },
      { url: 'https://lichess.org/api/cloud-eval', expected: 'network' },
      { url: 'https://project.supabase.co/functions/v1/api', expected: 'network' },
      { url: 'https://other.com/assets/app.js', expected: 'network' },
      { url: 'https://fonts.googleapis.com/css2?family=Inter', expected: 'font' },
      { url: 'https://fonts.gstatic.com/s/inter/font.woff2', expected: 'font' },
      { url: 'https://fonts.gstatic.com.evil.com/font.woff2', expected: 'network' },
    ];
    it(`classifies requests consistently under ${base}`, () => {
      const sw = worker(scope);
      for (const { expected, ...input } of cases) {
        const request = { method: 'GET', ...input };
        expect(classifyPWARequest(request, scope), request.url).toBe(expected);
        expect(sw.classify(request), request.url).toBe(expected);
      }
      if (base !== '/') {
        const outside = { method: 'GET', url: 'https://example.com/assets/other.js' };
        expect(classifyPWARequest(outside, scope)).toBe('network');
        expect(sw.classify(outside)).toBe('network');
      }
    });
  }
});

describe('service worker lifecycle and offline behavior', () => {
  const scope = 'https://example.com/chesspersonal/';

  it('installs the shell and its entry assets, then serves an offline navigation', async () => {
    const sw = worker(scope);
    const html = '<script type="module" src="/chesspersonal/assets/main-abc.js"></script>' +
      '<link rel="stylesheet" href="./assets/main-abc.css">' +
      '<link rel="modulepreload" href="./assets/vendor-abc.js">' +
      '<link rel="manifest" href="./manifest.webmanifest">';
    sw.fetch.mockImplementation(async request => new Response(request.url === scope ? html : 'asset'));
    await sw.lifecycle('install');
    expect(sw.fetch).toHaveBeenCalledTimes(4);
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await sw.request(`${scope}review/123`, 'navigate'))?.text()).toBe(html);
    expect(await (await sw.request(`${scope}assets/main-abc.js`))?.text()).toBe('asset');
  });

  it('caches engine/chunks on demand and never intercepts APIs', async () => {
    const sw = worker(scope);
    for (const path of ['engine/stockfish.wasm', 'assets/openings-abc.js']) {
      expect(await (await sw.request(`${scope}${path}`))?.text()).toBe('network');
      sw.fetch.mockRejectedValueOnce(new Error('offline'));
      expect(await (await sw.request(`${scope}${path}`))?.text()).toBe('network');
      sw.fetch.mockReset().mockResolvedValue(new Response('network'));
    }
    const before = sw.fetch.mock.calls.length;
    expect(await sw.request('https://api.chess.com/pub/player/name')).toBeUndefined();
    expect(sw.fetch).toHaveBeenCalledTimes(before);
  });

  it('uses cached fonts while revalidating and tolerates an offline revalidation', async () => {
    const sw = worker(scope);
    const url = 'https://fonts.gstatic.com/s/inter/font.woff2';
    await sw.request(url);
    sw.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await sw.request(url))?.text()).toBe('network');
  });

  it('does not cache errors and keeps successful responses when storage is full', async () => {
    const sw = worker(scope);
    sw.fetch.mockResolvedValueOnce(new Response('missing', { status: 404 }));
    expect((await sw.request(`${scope}assets/missing.js`))?.status).toBe(404);
    expect(sw.cache.put).not.toHaveBeenCalled();
    sw.cache.put.mockRejectedValue(new Error('quota'));
    expect(await (await sw.request(`${scope}assets/main.js`))?.text()).toBe('network');
  });

  it('refreshes navigation online and falls back on network/server failure', async () => {
    const sw = worker(scope);
    await sw.cache.put(scope, new Response('old shell'));
    sw.fetch.mockResolvedValueOnce(new Response('new shell'));
    expect(await (await sw.request(scope, 'navigate'))?.text()).toBe('new shell');
    sw.fetch.mockResolvedValueOnce(new Response('server error', { status: 503 }));
    expect(await (await sw.request(scope, 'navigate'))?.text()).toBe('new shell');
    sw.fetch.mockResolvedValueOnce(new Response('missing route', { status: 404 }));
    expect((await sw.request(`${scope}missing`, 'navigate'))?.status).toBe(404);
  });

  it('rejects installation if a required entry asset cannot be fetched', async () => {
    const sw = worker(scope);
    sw.fetch.mockResolvedValueOnce(new Response('<script src="./assets/main-abc.js"></script>'));
    sw.fetch.mockResolvedValueOnce(new Response('missing', { status: 404 }));
    await expect(sw.lifecycle('install')).rejects.toThrow('Unable to cache a shell asset');
    expect(await sw.cache.match(scope)).toBeUndefined();
  });

  it('removes only obsolete caches for its own deployment scope', async () => {
    const sw = worker(scope);
    const prefix = `hindsight:${scope}:`;
    sw.caches.keys.mockResolvedValue([`${prefix}v0`, `${prefix}v1`, `${prefix}streak`, 'unrelated', 'hindsight:https://example.com/hindsight/:v0']);
    await sw.lifecycle('activate');
    expect(sw.caches.delete.mock.calls).toEqual([[`${prefix}v0`]]);
    expect(sw.self.clients.claim).toHaveBeenCalledOnce();
    await sw.lifecycle('message', { type: 'SKIP_WAITING' });
    expect(sw.self.skipWaiting).toHaveBeenCalledOnce();
  });
});

describe('browser capability guards', () => {
  it('does not register a service worker in a test/development build', async () => {
    expect(await registerSW()).toBeUndefined();
  });

  it('registers once with the production base URL and observes update state', async () => {
    const events = vi.fn();
    const workerEvents = vi.fn();
    const registration = {
      installing: { addEventListener: workerEvents },
      addEventListener: events,
    };
    const register = vi.fn().mockResolvedValue(registration);
    try {
      vi.resetModules();
      vi.stubEnv('PROD', true);
      vi.stubEnv('BASE_URL', '/hindsight/');
      vi.stubGlobal('window', { addEventListener: vi.fn(), matchMedia: () => ({ addEventListener: vi.fn() }) });
      vi.stubGlobal('navigator', { serviceWorker: { register, addEventListener: vi.fn() } });
      const pwa = await import('../pwa');
      const [first, second] = await Promise.all([pwa.registerSW(), pwa.registerSW()]);
      expect(first).toBe(registration);
      expect(second).toBe(registration);
      expect(register).toHaveBeenCalledExactlyOnceWith('/hindsight/sw.js', {
        scope: '/hindsight/', updateViaCache: 'none',
      });
      expect(events).toHaveBeenCalledWith('updatefound', expect.any(Function));
      expect(workerEvents).toHaveBeenCalledWith('statechange', expect.any(Function));
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('returns persistence grant, rejection and unsupported status without throwing', async () => {
    try {
      vi.stubGlobal('navigator', {});
      expect(await persistStorage()).toBe(false);
      vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockResolvedValue(true) } });
      expect(await persistStorage()).toBe(true);
      vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockResolvedValue(false) } });
      expect(await persistStorage()).toBe(false);
      vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockRejectedValue(new Error('denied')) } });
      expect(await persistStorage()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


describe('streak reminders', () => {
  const state = { streakCount: 3, lastActiveDay: '2026-11-04', dueCount: 5, enabled: true };
  const evening = +new Date(2026, 10, 5, 19);
  it('requires an enabled active streak, local evening and no activity today', () => {
    expect(shouldRemind(state, evening - 1)).toBe(false);
    expect(shouldRemind(state, evening)).toBe(true);
    expect(shouldRemind({ ...state, lastActiveDay: '2026-11-05' }, evening)).toBe(false);
    expect(shouldRemind({ ...state, enabled: false }, evening)).toBe(false);
    expect(shouldRemind({ ...state, streakCount: 0 }, evening)).toBe(false);
    expect(shouldRemind({ ...state, dueCount: 0, lastActiveDay: null }, new Date(evening))).toBe(true);
  });

  it('mirrors fresh state, registers optional periodic sync and sends once daily through the scoped worker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(evening);
    const sw = worker('https://example.com/chesspersonal/');
    const periodicSync = { register: vi.fn(async () => {}) };
    const reg = { ...sw.self.registration, periodicSync };
    const saved = new Map<string, string>();
    const getState = vi.fn(() => ({ ...state }));
    let stop = () => {};
    try {
      vi.stubGlobal('window', { location: { href: reg.scope }, setInterval, clearInterval, addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage: { getItem: (k: string) => saved.get(k), setItem: (k: string, v: string) => saved.set(k, v) } });
      vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => reg }, permissions: { query: async () => ({ state: 'granted' }) } });
      vi.stubGlobal('Notification', { permission: 'granted' });
      vi.stubGlobal('caches', sw.caches);
      stop = scheduleStreakReminder(getState);
      await vi.advanceTimersByTimeAsync(0);
      expect(reg.showNotification).toHaveBeenCalledExactlyOnceWith('Your 3-day streak ends at midnight', {
        body: '5 mistakes due. Two minutes keeps it alive.', tag: 'streak', data: { url: `${reg.scope}#/train/session` },
      });
      expect(periodicSync.register).toHaveBeenCalledWith('streak-check', { minInterval: 21600000 });
      expect(await (await sw.cache.match(`${reg.scope}streak-state.json`))?.json()).toEqual(state);
      await vi.advanceTimersByTimeAsync(600000);
      expect(reg.showNotification).toHaveBeenCalledOnce();
      // The worker sees the page's delivery marker and cannot deliver again today.
      let pending: Promise<unknown> | undefined;
      sw.handlers.periodicsync({ tag: 'streak-check', waitUntil: (p: Promise<unknown>) => { pending = p; } });
      await pending;
      expect(reg.showNotification).toHaveBeenCalledOnce();
      getState.mockReturnValue({ ...state, enabled: false });
      await vi.advanceTimersByTimeAsync(600000);
      expect(await (await sw.cache.match(`${reg.scope}streak-state.json`))?.json()).toMatchObject({ enabled: false });
      stop();
      const calls = getState.mock.calls.length;
      await vi.advanceTimersByTimeAsync(600000);
      expect(getState).toHaveBeenCalledTimes(calls);
    } finally { stop(); vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it('does not deliver in the worker before evening, after activity, when disabled, or without permission', async () => {
    vi.useFakeTimers(); vi.setSystemTime(evening);
    try {
      const scope = 'https://example.com/hindsight/';
      for (const patch of [{ enabled: false }, { streakCount: 0 }, { lastActiveDay: '2026-11-05' }, {}]) {
        const sw = worker(scope);
        if (Object.keys(patch).length === 0) sw.self.Notification.permission = 'denied';
        await sw.cache.put(`${scope}streak-state.json`, new Response(JSON.stringify({ ...state, ...patch })));
        let pending: Promise<unknown> | undefined;
        sw.handlers.periodicsync({ tag: 'streak-check', waitUntil: (p: Promise<unknown>) => { pending = p; } });
        await pending;
        expect(sw.self.registration.showNotification).not.toHaveBeenCalled();
      }
      const sw = worker(scope);
      await sw.cache.put(`${scope}streak-state.json`, new Response(JSON.stringify(state)));
      vi.setSystemTime(evening - 1);
      let pending: Promise<unknown> | undefined;
      sw.handlers.periodicsync({ tag: 'streak-check', waitUntil: (p: Promise<unknown>) => { pending = p; } });
      await pending;
      expect(sw.self.registration.showNotification).not.toHaveBeenCalled();
      const waitUntil = vi.fn();
      sw.handlers.periodicsync({ tag: 'something-else', waitUntil });
      expect(waitUntil).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('delivers a periodic reminder once per local day and opens or focuses the training route', async () => {
    vi.useFakeTimers(); vi.setSystemTime(evening);
    try {
      const scope = 'https://example.com/chesspersonal/', sw = worker(scope);
      await sw.cache.put(`${scope}streak-state.json`, new Response(JSON.stringify({ ...state, dueCount: 0 })));
      const periodic = async () => {
        let pending: Promise<unknown> | undefined;
        sw.handlers.periodicsync({ tag: 'streak-check', waitUntil: (p: Promise<unknown>) => { pending = p; } });
        await pending;
      };
      await periodic(); await periodic();
      expect(sw.self.registration.showNotification).toHaveBeenCalledExactlyOnceWith('Your 3-day streak ends at midnight', expect.objectContaining({ body: 'No mistakes due. Two minutes of practice keeps it alive.' }));
      vi.setSystemTime(new Date(2026, 10, 6, 19)); await periodic();
      expect(sw.self.registration.showNotification).toHaveBeenCalledTimes(2);
      const click = async (url: string) => {
        let pending: Promise<unknown> | undefined;
        const close = vi.fn();
        sw.handlers.notificationclick({ notification: { close, data: { url } }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
        await pending; expect(close).toHaveBeenCalledOnce();
      };
      await click('https://evil.example/');
      expect(sw.self.clients.openWindow).toHaveBeenCalledWith(`${scope}#/train/session`);
      const client = { url: scope, navigate: vi.fn(async (_url: string) => {}), focus: vi.fn(async () => {}) };
      sw.self.clients.matchAll.mockResolvedValue([client]);
      await click(`${scope}#/train/session`);
      expect(client.navigate).toHaveBeenCalledWith(`${scope}#/train/session`);
      expect(client.focus).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
