import { lazy, Suspense, useEffect, useState } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { Topbar } from './components/Topbar';
import { FxHost } from './components/FxHost';
import { PageSkeleton } from './components/Skeleton';
import { ease, spring } from './components/motion';
import { useStore } from './lib/store';
import { pauseAnalysis, startAutoSync } from './lib/sync';
import { sfx } from './lib/sound';
import { useAuth } from './lib/auth';
import { scheduleStreakReminder } from './lib/pwa';
import { setQuiet } from './lib/bus';
import { db } from './lib/db';
import { useDrillStats } from './lib/queries';
import { useHotkeys } from './lib/hotkeys';
import { Gate } from './pages/Gate';
import { Home } from './pages/Home';

// Heavy routes load on demand; Home and the gate are in the main bundle.
const Games = lazy(() => import('./pages/Games').then((m) => ({ default: m.Games })));
const Review = lazy(() => import('./pages/Review').then((m) => ({ default: m.Review })));
const Train = lazy(() => import('./pages/Train').then((m) => ({ default: m.Train })));
const Insights = lazy(() => import('./pages/Insights').then((m) => ({ default: m.Insights })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));

// Warm the chunks once the shell is idle so navigation feels instant.
const prefetch = () => {
  void import('./pages/Games');
  void import('./pages/Review');
  void import('./pages/Train');
  void import('./pages/Insights');
  void import('./pages/Profile');
};

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
  const [page, arg] = route;
  const learning = page === 'review' && route[2] === 'learn';
  const training = page === 'train' && ['session', 'leak', 'rush'].includes(arg);
  const inSession = learning || training;

  useEffect(() => {
    setQuiet(inSession);
    // The batch reviewer yields the CPU to the engine that checks your answers.
    pauseAnalysis(training);
  }, [inSession, training]);

  useHotkeys(
    {
      Escape: () => {
        if (!inSession) return;
        if (training) location.hash = '#/train';
        else location.hash = `#/review/${encodeURIComponent(arg)}`;
      },
    },
    [inSession, training, arg],
  );

  useEffect(() => {
    ensureDay();
  }, [ensureDay]);
  useEffect(() => {
    if (!username) return;
    const stop = startAutoSync();
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
    if (idle) idle(prefetch);
    else setTimeout(prefetch, 1500);
    return stop;
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
  const { mastered, total } = useDrillStats();
  useEffect(() => {
    if (total) useStore.getState().recordMastered(mastered);
  }, [mastered, total]);
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

  // A soft key-click on primary presses: the interface should feel like hardware.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = (e.target as HTMLElement).closest('.btn, .seg button, .moment-step');
      if (t && !(t as HTMLButtonElement).disabled) sfx.click();
    };
    addEventListener('pointerdown', onDown);
    return () => removeEventListener('pointerdown', onDown);
  }, []);

  if (!username) {
    return (
      <MotionConfig reducedMotion="user" transition={spring.smooth}>
        <Gate />
        <FxHost />
      </MotionConfig>
    );
  }

  let view: React.ReactNode;
  let boardPage = false;
  switch (page) {
    case 'review':
      boardPage = true;
      view = <Review id={arg} learn={learning} />;
      break;
    case 'train':
      boardPage = training;
      view = <Train mode={arg} />;
      break;
    case 'games':
      view = <Games />;
      break;
    case 'insights':
      view = <Insights />;
      break;
    case 'profile':
      view = <Profile />;
      break;
    default:
      view = <Home />;
  }

  return (
    <MotionConfig reducedMotion="user" transition={spring.smooth}>
      <div className="shell">
        <a href="#main" className="sr-only">Skip to content</a>
        <Topbar page={page === 'review' ? 'games' : page ?? ''} focus={inSession} />
        {/* Enter-only transition: the old route unmounts at once, so navigation can never get stuck. */}
        <motion.main
          id="main"
          key={routeKey.split('/').slice(0, page === 'review' ? 3 : 2).join('/')}
          className="route"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: ease.out }}
        >
          <Suspense fallback={<PageSkeleton board={boardPage} />}>{view}</Suspense>
        </motion.main>
        <FxHost />
      </div>
    </MotionConfig>
  );
}
