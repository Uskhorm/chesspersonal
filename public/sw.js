/* Bump VERSION whenever the shell or un-hashed engine files change. */
const VERSION = 'v1';
const SCOPE = self.registration.scope;
const PREFIX = `hindsight:${SCOPE}:`;
const CACHE = `${PREFIX}${VERSION}`;
const SHELL = new URL('./', SCOPE).href;

// Mirrored by classifyPWARequest in src/lib/pwa.ts; keep both in sync.
function classifyRequest(request) {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  const scope = new URL(SCOPE);
  if (url.origin !== scope.origin) {
    return url.protocol === 'https:' &&
      ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
      ? 'font' : 'network';
  }
  if (!url.pathname.startsWith(scope.pathname)) return 'network';
  const path = url.pathname.slice(scope.pathname.length);
  if (request.mode === 'navigate') return 'navigation';
  if (path.startsWith('assets/')) return 'immutable';
  if (/^engine\/.+\.(?:js|wasm)$/.test(path)) return 'immutable';
  return 'network';
}

function cacheable(response, opaque = false) {
  return response.ok || (opaque && response.type === 'opaque');
}

async function save(cache, key, response, opaque = false) {
  if (cacheable(response, opaque)) {
    // A full storage quota must never turn a successful network request into a failure.
    await cache.put(key, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(new Request(SHELL, { cache: 'reload' }));
    if (!response.ok) throw new Error('Unable to cache the Hindsight shell');
    const html = await response.clone().text();
    // Cache entry scripts, styles and modulepreloads before this worker is usable.
    // Lazy chunks (including openings) are cached on their first request.
    const assets = new Set();
    for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      const url = new URL(match[1], SHELL);
      if (classifyRequest({ method: 'GET', url: url.href }) === 'immutable') assets.add(url.href);
    }
    await Promise.all([...assets].map(async url => {
      const asset = await fetch(new Request(url, { cache: 'reload' }));
      if (!asset.ok) throw new Error('Unable to cache a shell asset');
      await cache.put(url, asset);
    }));
    await cache.put(SHELL, response);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE && key !== `${PREFIX}streak`)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const route = classifyRequest(event.request);
  if (route === 'network') return; // Includes all chess.com, Lichess and Supabase calls.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (route === 'navigation') {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          // Always use the canonical shell key, including visits to nested routes.
          return await save(cache, SHELL, response);
        }
        if (response.status < 500) return response;
        return (await cache.match(SHELL)) || response;
      } catch {
        return (await cache.match(SHELL)) || Response.error();
      }
    }
    const cached = await cache.match(event.request);
    if (route === 'font') {
      const fresh = fetch(event.request).then(response => save(cache, event.request, response, true));
      // Keep revalidation alive even when the cached response is returned immediately.
      event.waitUntil(fresh.catch(() => {}));
      return cached || fresh;
    }
    return cached || save(cache, event.request, await fetch(event.request));
  })());
});

// Keep local-day eligibility, notification copy and storage keys aligned with pwa.ts.
const STREAK_CACHE = `${PREFIX}streak`;
const STREAK_STATE = new URL('streak-state.json', SCOPE).href;
const STREAK_SENT = new URL('streak-sent.json', SCOPE).href;
function localDay(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function shouldRemind(state, now) {
  return state.enabled && state.streakCount >= 1 && now.getHours() >= 19 && state.lastActiveDay !== localDay(now);
}
async function checkStreak() {
  try {
    const cache = await caches.open(STREAK_CACHE);
    const state = await (await cache.match(STREAK_STATE))?.json();
    const now = new Date(), day = localDay(now);
    if (!state || !shouldRemind(state, now) || self.Notification?.permission !== 'granted') return;
    const sent = await (await cache.match(STREAK_SENT))?.json();
    if (sent?.day === day) return;
    await self.registration.showNotification(`Your ${state.streakCount}-day streak ends at midnight`, {
      body: state.dueCount > 0 ? `${state.dueCount} mistake${state.dueCount === 1 ? '' : 's'} due. Two minutes keeps it alive.` : 'No mistakes due. Two minutes of practice keeps it alive.',
      tag: 'streak', data: { url: `${SCOPE}#/train/session` },
    });
    await cache.put(STREAK_SENT, new Response(JSON.stringify({ day })));
  } catch { /* Storage, permissions and background delivery are all best effort. */ }
}
self.addEventListener('periodicsync', event => {
  if (event.tag !== 'streak-check') return;
  event.waitUntil(self.navigator?.locks?.request
    ? self.navigator.locks.request(STREAK_CACHE, checkStreak) : checkStreak());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    // Never navigate outside this app's deployment scope, even with malformed data.
    let url;
    try { url = new URL(event.notification.data?.url ?? `${SCOPE}#/train/session`, SCOPE); } catch { url = new URL(`${SCOPE}#/train/session`); }
    if (!url.href.startsWith(SCOPE)) url = new URL(`${SCOPE}#/train/session`);
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = clients.find(client => client.url.startsWith(SCOPE));
    if (client) {
      await client.navigate(url.href);
      await client.focus();
    } else await self.clients.openWindow(url.href);
  })());
});

