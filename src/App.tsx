import { lazy, Suspense, useEffect, useState } from 'react';
import { Topbar } from './components/Topbar';
import { FxHost } from './components/FxHost';
import { useStore } from './lib/store';
import { startAutoSync } from './lib/sync';
import { sfx } from './lib/sound';
import { useAuth } from './lib/auth';
import { scheduleStreakReminder } from './lib/pwa';
import { db } from './lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { isMastered } from './lib/srs';
import { Gate } from './pages/Gate';
import { Home } from './pages/Home';
import { Games } from './pages/Games';
import { Review } from './pages/Review';
import { Train } from './pages/Train';
import { Profile } from './pages/Profile';

const Insights = lazy(() => import('./pages/Insights').then((m) => ({ default: m.Insights })));

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
}

export function App() {
  const username = useStore((s) => s.username);
  const ensureDay = useStore((s) => s.ensureDay);
  const route = useHash();
  const token = useAuth((s) => s.token);
  const routeKey = route.join('/');

  useEffect(() => {
    ensureDay();
  }, [ensureDay]);
  useEffect(() => {
    if (!username) return;
    return startAutoSync();
  }, [username]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [routeKey]);
  // Streak-at-risk reminder (evening, once a day, only with notifications on).
  useEffect(() => {
    if (!username) return;
    let due = 0;
    const refresh = () => db.drills.where('due').below(Date.now()).count().then((n) => (due = n)).catch(() => {});
    void refresh();
    const iv = setInterval(refresh, 10 * 60_000);
    const stop = scheduleStreakReminder(() => {
      const s = useStore.getState();
      return { streakCount: s.streak.count, lastActiveDay: s.streak.lastDay, dueCount: due, enabled: s.settings.notify };
    });
    return () => {
      clearInterval(iv);
      stop();
    };
  }, [username]);
  // Mastery milestones feed chests (every 5th mistake retired for good).
  const masteredCount = useLiveQuery(async () => (await db.drills.toArray()).filter(isMastered).length, []);
  useEffect(() => {
    if (masteredCount !== undefined) useStore.getState().recordMastered(masteredCount);
  }, [masteredCount]);
  // Signed-in sessions resume cloud sync on every load.
  useEffect(() => {
    if (!token) return;
    let stop: (() => void) | undefined;
    import('./lib/cloudsync').then((m) => {
      m.start();
      stop = m.stop;
    });
    return () => stop?.();
  }, [token]);

  // A soft key-click on every press: the interface should feel like hardware.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = (e.target as HTMLElement).closest('.key, .chip, .mv, .line-chip');
      if (t && !(t as HTMLButtonElement).disabled) sfx.click();
    };
    addEventListener('pointerdown', onDown);
    return () => removeEventListener('pointerdown', onDown);
  }, []);

  if (!username) {
    return (
      <>
        <Gate />
        <FxHost />
      </>
    );
  }

  const [page, arg] = route;
  let view: React.ReactNode;
  switch (page) {
    case 'review':
      view = <Review id={arg} learn={route[2] === 'learn'} />;
      break;
    case 'train':
      view = <Train mode={arg} />;
      break;
    case 'games':
      view = <Games />;
      break;
    case 'insights':
      view = (
        <Suspense fallback={<div className="page"><span className="spin lg" /></div>}>
          <Insights />
        </Suspense>
      );
      break;
    case 'profile':
      view = <Profile />;
      break;
    default:
      view = <Home />;
  }

  return (
    <div className="shell">
      <Topbar page={page === 'review' ? 'games' : page ?? ''} focus={(page === 'review' && route[2] === 'learn') || (page === 'train' && ['session', 'leak', 'rush'].includes(arg))} />
      <main key={routeKey} className="route">
        {view}
      </main>
      <FxHost />
    </div>
  );
}
