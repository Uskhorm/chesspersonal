import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { DAILY_GOAL } from './constants';
import { animate } from 'animejs';
import { levelFromXp, titleFor, useStore, xpForLevel } from '../lib/store';
import { useQueue } from '../lib/sync';
import { today } from '../lib/db';
import { Icon, Wordmark } from './Brand';
import { SyncDot } from './SyncDot';

export const NAV = [
  { href: '#/', key: '', label: 'Today', icon: Icon.home },
  { href: '#/train', key: 'train', label: 'Train', icon: Icon.train },
  { href: '#/games', key: 'games', label: 'Games', icon: Icon.games },
  { href: '#/insights', key: 'insights', label: 'Insights', icon: Icon.insights },
];

export function Topbar({ page, focus }: { page: string; focus?: boolean }) {
  const { xp, streak, chests, avatar, username, openChest } = useStore();
  const level = levelFromXp(xp);
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  const q = useQueue();
  const chestRef = useRef<HTMLButtonElement>(null);
  const lit = streak.lastDay === today();
  const xpToday = useLiveQuery(() => db.activity.get(today()), [])?.xp ?? 0;
  const goal = Math.min(1, xpToday / DAILY_GOAL);
  const R = 13;
  const C = 2 * Math.PI * R;

  useEffect(() => {
    if (!chests || !chestRef.current) return;
    const a = animate(chestRef.current.querySelector('svg')!, {
      rotate: [0, -14, 12, -8, 0],
      duration: 650,
      loop: true,
      loopDelay: 3200,
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
          <button className="key sm" onClick={() => (page === 'train' ? (location.hash = '#/train') : history.back())}>Exit session</button>
        ) : (
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.key} href={n.href} className={page === n.key ? 'here' : ''} aria-current={page === n.key ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        )}
        {q.current && !focus && (
          <a className="analysing-chip sb-hide-m" href={`#/review/${encodeURIComponent(q.current)}`}>
            Reviewing
            <span className="track"><i style={{ width: `${q.total ? (q.done / q.total) * 100 : 4}%` }} /></span>
            {q.queued.length > 0 && <span className="faint">+{q.queued.length}</span>}
          </a>
        )}
        <div className="scoreboard" role="group" aria-label="Your progress">
          <div className="sb-cell sb-level" id="hud-xp" title={`${titleFor(level)} — ${hi - xp} XP to level ${level + 1}`}>
            <span className="t-tiny faint" style={{ fontWeight: 700 }}>Lv</span>
            <span className="display lv num">{level}</span>
            <span className="sb-meter">
              <span className="sb-meter-bar"><span className="sb-meter-fill" style={{ width: `${((xp - lo) / (hi - lo)) * 100}%`, display: 'block' }} /></span>
              <span className="sb-meter-label num">{xp - lo}/{hi - lo} XP</span>
            </span>
          </div>
          <div className={`sb-cell sb-streak ${lit ? 'lit' : ''}`} title={`Daily goal ${Math.min(xpToday, DAILY_GOAL)}/${DAILY_GOAL} XP. ` + `${lit ? 'Streak safe today' : 'Earn any XP today to keep your streak'}. Best ${streak.best} days. ${streak.freezes} streak freeze${streak.freezes === 1 ? '' : 's'} saved.`}>
            <span className="flame-ring" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 32 32">
                <circle cx="16" cy="16" r={R} fill="none" stroke="#0000000f" strokeWidth="3" />
                <circle cx="16" cy="16" r={R} fill="none" stroke="var(--flame)" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - goal)} transform="rotate(-90 16 16)" style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(.3,1.4,.5,1)' }} />
              </svg>
              <Icon.flame />
            </span>
            {streak.count > 0 ? <span className="display num">{streak.count}</span> : <span className="t-small sb-hide-m" style={{ fontWeight: 650 }}>Start a streak</span>}

          </div>
          <button ref={chestRef} className={`sb-cell sb-chest ${chests ? 'has' : ''}`} onClick={() => chests && openChest()} title={chests ? 'Open a chest' : 'Earn chests from quests, levels and achievements'} aria-label={`${chests} chests`}>
            <Icon.chest />
            {chests > 0 && <span className="count">{chests}</span>}
          </button>
          <a className="sb-cell" href="#/profile" title="Profile and settings">
            <SyncDot />
            <span className="avatar">{avatar ? <img src={avatar} alt="" /> : (username?.[0] ?? '?').toUpperCase()}</span>
          </a>
        </div>
      </header>
      {!focus && <nav className="mobile-nav" aria-label="Main">
        {NAV.map((n) => (
          <a key={n.key} href={n.href} className={page === n.key ? 'here' : ''}>
            <n.icon />
            {n.label}
          </a>
        ))}
      </nav>}
    </>
  );
}
