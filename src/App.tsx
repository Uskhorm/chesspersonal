import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Hud } from './components/Hud';
import { FxHost } from './components/FxHost';
import { useStore } from './lib/store';
import { startAutoSync } from './lib/sync';
import { burst } from './lib/fx';
import { sfx } from './lib/sound';
import { Connect } from './pages/Connect';
import { Home } from './pages/Home';
import { Games } from './pages/Games';
import { Review } from './pages/Review';
import { Train } from './pages/Train';
import { Profile } from './pages/Profile';

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
}

const NAV = [
  { href: '#/', key: '', label: 'Home', icon: '🏠' },
  { href: '#/train', key: 'train', label: 'Train', icon: '🧠' },
  { href: '#/games', key: 'games', label: 'Games', icon: '♟️' },
  { href: '#/profile', key: 'profile', label: 'Profile', icon: '🏆' },
];

export function App() {
  const username = useStore((s) => s.username);
  const ensureDay = useStore((s) => s.ensureDay);
  const route = useHash();

  useEffect(() => {
    ensureDay();
  }, [ensureDay]);

  useEffect(() => {
    if (!username) return;
    return startAutoSync();
  }, [username]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.join('/')]);

  // Every click gets a tiny particle pop + tick. Small, constant positive feedback.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = (e.target as HTMLElement).closest('button, .clicky, a');
      if (!t || (t as HTMLButtonElement).disabled) return;
      const color = getComputedStyle(t).getPropertyValue('--burst').trim() || '#ffd34d';
      burst(e.clientX, e.clientY, color, 7, 34);
      sfx.click();
    };
    addEventListener('pointerdown', onDown);
    return () => removeEventListener('pointerdown', onDown);
  }, []);

  if (!username) {
    return (
      <>
        <Connect />
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
    case 'profile':
      view = <Profile />;
      break;
    default:
      view = <Home />;
  }

  return (
    <div className="app">
      <Hud />
      <nav className="sidenav">
        {NAV.map((n) => (
          <a key={n.key} href={n.href} className={`nav-item ${page === n.key || (!page && !n.key) ? 'active' : ''}`}>
            <span className="nav-icon">{n.icon}</span>
            <span className="nav-label">{n.label}</span>
          </a>
        ))}
      </nav>
      <main className="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={route.join('/')}
            initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
            transition={{ duration: 0.28, ease: [0.2, 0.9, 0.3, 1] }}
          >
            {view}
          </motion.div>
        </AnimatePresence>
      </main>
      <FxHost />
    </div>
  );
}
