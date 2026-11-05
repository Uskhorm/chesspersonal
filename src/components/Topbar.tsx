import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChartLine, Flame, Gift, House, Moon, Sun, Swords, Target, X } from 'lucide-react';
import { animate } from 'animejs';
import { DAILY_GOAL } from './constants';
import { levelFromXp, titleFor, useStore, xpForLevel } from '../lib/store';
import { useQueue } from '../lib/sync';
import { useTheme } from '../lib/theme';
import { useTodayActivity } from '../lib/queries';
import { today } from '../lib/db';
import { Wordmark } from './Brand';
import { SyncDot } from './SyncDot';
import { spring } from './motion';

export const NAV = [
  { href: '#/', key: '', label: 'Today', icon: House },
  { href: '#/train', key: 'train', label: 'Train', icon: Target },
  { href: '#/games', key: 'games', label: 'Games', icon: Swords },
  { href: '#/insights', key: 'insights', label: 'Insights', icon: ChartLine },
];

/** "Reviewing games 3/10": the auto-analysis queue, always visible but never in the way. */
export function ReviewStatus({ compact }: { compact?: boolean }) {
  const q = useQueue();
  const active = !!q.current || q.queued.length > 0;
  const total = Math.max(q.batchTotal, 1);
  const partial = q.current && q.total ? q.done / q.total : 0;
  const frac = Math.min(1, (q.batchDone + partial) / total);
  const R = 8;
  const C = 2 * Math.PI * R;
  const label = q.batchTotal > 1 ? `Reviewing games ${Math.min(q.batchDone + 1, q.batchTotal)} of ${q.batchTotal}` : `Reviewing a game, ${Math.round(partial * 100)}%`;
  return (
    <AnimatePresence initial={false}>
      {active && (
        <motion.a
          key="status"
          href={q.current ? `#/review/${encodeURIComponent(q.current)}` : '#/games'}
          className="status-pill"
          title={label}
          aria-label={label}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.94 }}
          transition={spring.snappy}
        >
          <svg className="ring" viewBox="0 0 20 20" aria-hidden="true">
            <circle className="t" cx="10" cy="10" r={R} fill="none" strokeWidth="2.5" />
            <circle className="f" cx="10" cy="10" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.04, frac))} />
          </svg>
          {compact ? (
            <b className="num">{q.batchTotal > 1 ? `${Math.min(q.batchDone + 1, q.batchTotal)}/${q.batchTotal}` : `${Math.round(partial * 100)}%`}</b>
          ) : q.batchTotal > 1 ? (
            <span>
              Reviewing games <b className="num">{Math.min(q.batchDone + 1, q.batchTotal)}/{q.batchTotal}</b>
            </span>
          ) : (
            <span>
              Reviewing <b className="num">{Math.round(partial * 100)}%</b>
            </span>
          )}
        </motion.a>
      )}
    </AnimatePresence>
  );
}

export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button className="btn ghost icon" onClick={() => setTheme(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={resolved}
          style={{ display: 'grid' }}
          initial={{ opacity: 0, rotate: -60, scale: 0.7 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 60, scale: 0.7 }}
          transition={spring.snappy}
        >
          {resolved === 'dark' ? <Moon /> : <Sun />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export function Topbar({ page, focus }: { page: string; focus?: boolean }) {
  const { xp, streak, chests, avatar, username, openChest } = useStore();
  const level = levelFromXp(xp);
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  const chestRef = useRef<HTMLButtonElement>(null);
  const lit = streak.lastDay === today();
  const xpToday = useTodayActivity()?.xp ?? 0;
  const R = 11;
  const C = 2 * Math.PI * R;
  const lvlFrac = Math.max(0, Math.min(1, (xp - lo) / Math.max(1, hi - lo)));

  useEffect(() => {
    if (!chests || !chestRef.current) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const a = animate(chestRef.current.querySelector('svg')!, {
      rotate: [0, -12, 10, -6, 0],
      duration: 600,
      loop: true,
      loopDelay: 4000,
      ease: 'inOutSine',
    });
    return () => {
      a.revert();
    };
  }, [chests]);

  return (
    <>
      <header className="topbar">
        <Wordmark />
        {focus ? (
          <button className="btn ghost sm" onClick={() => (page === 'train' ? (location.hash = '#/train') : history.length > 1 ? history.back() : (location.hash = '#/'))}>
            <X /> Exit session <span className="kbd hide-m">Esc</span>
          </button>
        ) : (
          <nav className="seg nav" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.key} href={n.href} aria-current={page === n.key ? 'page' : undefined}>
                {page === n.key && <motion.span layoutId="nav-pill" className="seg-pill" transition={spring.snappy} />}
                {n.label}
              </a>
            ))}
          </nav>
        )}
        <div className="topbar-right">
          {!focus && (
            <span className="hide-m">
              <ReviewStatus />
            </span>
          )}
          <div className="hud" role="group" aria-label="Your progress">
            <span className="hud-cell" id="hud-xp" title={`Level ${level}, ${titleFor(level)}. ${hi - xp} XP to level ${level + 1}.`}>
              <span className="lvl-ring" aria-label={`Level ${level}`}>
                <svg viewBox="0 0 28 28" aria-hidden="true">
                  <circle className="track" cx="14" cy="14" r={R} fill="none" strokeWidth="3" />
                  <circle className="fill" cx="14" cy="14" r={R} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - lvlFrac)} />
                </svg>
                <span className="num">{level}</span>
              </span>
              <span className="num hide-m faint" style={{ fontWeight: 600 }}>{xp - lo}/{hi - lo}</span>
            </span>
            <span className="hud-sep" />
            <span
              className={`hud-cell streak ${lit ? 'lit' : ''}`}
              title={`Daily goal ${Math.min(xpToday, DAILY_GOAL)} of ${DAILY_GOAL} XP. ${lit ? 'Streak safe today.' : 'Earn any XP today to keep your streak.'} Best ${streak.best} days.`}
            >
              <Flame className="flame" fill={lit ? 'currentColor' : 'none'} />
              <span className="num">{streak.count}</span>
            </span>
            {chests > 0 && (
              <>
                <span className="hud-sep" />
                <button ref={chestRef} className="hud-cell chest-btn" onClick={() => openChest()} aria-label={`Open a chest, ${chests} waiting`} title="Open a chest">
                  <Gift style={{ width: 18, height: 18, color: 'var(--gold-ink)' }} />
                  <span className="count">{chests}</span>
                </button>
              </>
            )}
          </div>
          <span className="hide-m">
            <ThemeToggle />
          </span>
          <a className="hud-cell" href="#/profile" title="Profile and settings" aria-label="Profile and settings" style={{ position: 'relative', padding: 0 }}>
            <span className="avatar">{avatar ? <img src={avatar} alt="" /> : (username?.[0] ?? '?').toUpperCase()}</span>
            <span style={{ position: 'absolute', right: -1, bottom: -1 }}>
              <SyncDot />
            </span>
          </a>
        </div>
      </header>
      {!focus && (
        <nav className="mobile-nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.key} href={n.href} aria-current={page === n.key ? 'page' : undefined}>
              {page === n.key && <motion.span layoutId="mnav-ind" className="ind" transition={spring.snappy} />}
              <n.icon />
              {n.label}
            </a>
          ))}
        </nav>
      )}
    </>
  );
}

