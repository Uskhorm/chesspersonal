import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from '../lib/db';
import { levelFromXp, titleFor, useStore, xpForLevel } from '../lib/store';
import { useQueue } from '../lib/sync';
import { animate } from 'animejs';

export const DAILY_GOAL = 60;

export function Ring({ value, size = 44, stroke = 5, color = '#ffd34d', children }: { value: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.2,1.4,.4,1)', transform: 'rotate(-90deg)', transformOrigin: 'center' }}
        />
      </svg>
      <div className="ring-inner">{children}</div>
    </div>
  );
}

export function Hud() {
  const { xp, streak, chests, trainingRating, avatar, username, openChest } = useStore();
  const level = levelFromXp(xp);
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  const todayAct = useLiveQuery(() => db.activity.get(today()), []);
  const q = useQueue();
  const chestRef = useRef<HTMLButtonElement>(null);
  const activeToday = streak.lastDay === today();

  useEffect(() => {
    if (!chests || !chestRef.current) return;
    const a = animate(chestRef.current, { rotate: [0, -10, 10, -6, 6, 0], duration: 700, loop: true, loopDelay: 2200, ease: 'inOutSine' });
    return () => {
      a.revert();
    };
  }, [chests]);

  return (
    <header className="hud">
      <a href="#/" className="brand clicky">
        <span className="brand-mark">♞</span>
        <span className="brand-name">ChessPersonal</span>
      </a>
      {q.current && (
        <a className="hud-analysing clicky" href={`#/review/${encodeURIComponent(q.current)}`}>
          <span className="spinner" /> Analysing {q.total ? Math.round((q.done / q.total) * 100) : 0}%
          {q.queued.length > 0 && <span className="muted"> +{q.queued.length}</span>}
        </a>
      )}
      <div className="hud-right">
        <div className="hud-pill" title="Daily goal">
          <Ring value={(todayAct?.xp ?? 0) / DAILY_GOAL} size={30} stroke={4} color="#1fd1b9">
            <span style={{ fontSize: 11 }}>🎯</span>
          </Ring>
          <span className="mono">{Math.min(todayAct?.xp ?? 0, 999)}/{DAILY_GOAL}</span>
        </div>
        <div className={`hud-pill streak ${activeToday ? 'lit' : ''}`} title={`Best streak: ${streak.best} · Freezes: ${streak.freezes}`}>
          <span className="flame">🔥</span>
          <span className="mono">{streak.count}</span>
          {streak.freezes > 0 && <span className="freeze">🧊{streak.freezes}</span>}
        </div>
        <div className="hud-pill" title="Training rating — rises as you solve your own mistakes">
          <span>⚡</span>
          <span className="mono">{trainingRating}</span>
        </div>
        <button ref={chestRef} className={`hud-pill chest ${chests ? 'has' : ''}`} onClick={() => chests && openChest()} title="Open a chest">
          <span>🎁</span>
          {chests > 0 && <span className="chest-count">{chests}</span>}
        </button>
        <div className="hud-level" id="hud-xp" title={`${xp - lo}/${hi - lo} XP to level ${level + 1}`}>
          <Ring value={(xp - lo) / (hi - lo)} size={44} stroke={5}>
            <span className="mono lvl">{level}</span>
          </Ring>
          <div className="hud-level-text">
            <span className="lvl-title">{titleFor(level)}</span>
            <span className="muted mono">{xp - lo}/{hi - lo} XP</span>
          </div>
        </div>
        {username && (
          <a href="#/profile" className="avatar clicky">
            {avatar ? <img src={avatar} alt="" /> : <span>{username[0].toUpperCase()}</span>}
          </a>
        )}
      </div>
    </header>
  );
}
