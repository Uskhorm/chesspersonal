import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { animate, createTimeline, spring } from 'animejs';
import { onFx, type FxEvent, type Rarity } from '../lib/bus';
import { burst, confettiBurst, fireworks, floatText, pop } from '../lib/fx';
import { sfx } from '../lib/sound';

interface Toast {
  id: number;
  text: string;
  emoji?: string;
  tone?: 'good' | 'bad' | 'info';
  onClick?: () => void;
}

const RARITY: Record<Rarity, { color: string; word: string }> = {
  common: { color: '#c9d2e3', word: 'Common' },
  rare: { color: '#4c7ef3', word: 'Rare' },
  epic: { color: '#b86bff', word: 'Epic' },
  legendary: { color: '#f2b705', word: 'Legendary' },
};

export function FxHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [level, setLevel] = useState<{ level: number; title: string } | null>(null);
  const [chest, setChest] = useState<{ rarity: Rarity; xp: number; extra?: string } | null>(null);

  useEffect(() => {
    let id = 0;
    const push = (t: Omit<Toast, 'id'>) => {
      const tid = ++id;
      setToasts((x) => [...x.slice(-2), { ...t, id: tid }]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== tid)), 4600);
    };
    return onFx((e: FxEvent) => {
      switch (e.type) {
        case 'xp': {
          const hud = document.getElementById('hud-xp')?.getBoundingClientRect();
          const x = e.x ?? (hud ? hud.left + hud.width / 2 : window.innerWidth / 2);
          const y = e.y ?? (hud ? hud.bottom + 18 : 80);
          floatText(e.crit ? `Double! +${e.amount}` : `+${e.amount}`, x, y, e.crit ? '#b86bff' : '#6b4f00', e.crit);
          if (e.crit) burst(x, y, '#b86bff', 14, 70);
          sfx.xp();
          pop(document.getElementById('hud-xp'), 1.08);
          break;
        }
        case 'levelup':
          setTimeout(() => {
            setLevel({ level: e.level, title: e.title });
            sfx.levelUp();
            fireworks();
          }, 600);
          break;
        case 'quest':
          push({ text: `Quest done: ${e.label}. +${e.reward} XP`, emoji: '✓', tone: 'good' });
          sfx.correct();
          break;
        case 'achievement':
          push({ text: `Achievement: ${e.label}. You earned a chest.`, emoji: '★', tone: 'good' });
          sfx.great();
          break;
        case 'chest':
          setChest({ rarity: e.rarity, xp: e.xp, extra: e.extra });
          break;
        case 'toast':
          push({ text: e.text, emoji: e.emoji, tone: e.tone, onClick: e.onClick });
          break;
      }
    });
  }, []);

  return (
    <>
      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className={`toast ${t.tone ?? 'info'} ${t.onClick ? 'clickable' : ''}`}
              onClick={() => {
                t.onClick?.();
                setToasts((x) => x.filter((y) => y.id !== t.id));
              }}
            >
              <span className="ico">{t.emoji ?? '•'}</span>
              <span>{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>{level && <LevelUp {...level} onClose={() => setLevel(null)} />}</AnimatePresence>
      <AnimatePresence>{chest && <ChestReveal {...chest} onClose={() => setChest(null)} />}</AnimatePresence>
    </>
  );
}

function LevelUp({ level, title, onClose }: { level: number; title: string; onClose: () => void }) {
  const num = useRef<HTMLDivElement>(null);
  useEffect(() => {
    animate(num.current!, { scale: [0.2, 1], ease: spring({ bounce: 0.55, duration: 800 }) });
  }, []);
  return (
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="sheet" initial={{ y: 30 }} animate={{ y: 0 }} exit={{ y: 30 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Level ${level}`}>
        <p className="quiet">You reached level</p>
        <div ref={num} className="display levelup-num num">{level}</div>
        <h2 className="t-2" style={{ marginTop: 8 }}>{title}</h2>
        <p className="quiet" style={{ margin: '10px 0 22px' }}>A chest has been added to your scoreboard.</p>
        <button className="key ink big" style={{ width: '100%' }} onClick={onClose} autoFocus>
          Keep going
        </button>
      </motion.div>
    </motion.div>
  );
}

function ChestSvg({ open, color }: { open: boolean; color: string }) {
  return (
    <svg viewBox="0 0 120 120" className="chest-box" aria-hidden="true">
      <rect x="18" y="56" width="84" height="46" rx="8" fill="#1a2235" stroke={color} strokeWidth="4" />
      <rect x="52" y="64" width="16" height="16" rx="3" fill={color} />
      <g style={{ transformOrigin: '60px 56px', transform: open ? 'rotate(-28deg) translate(-6px,-10px)' : 'none', transition: 'transform 400ms cubic-bezier(.3,1.5,.5,1)' }}>
        <path d="M18 56c0-16 12-26 42-26s42 10 42 26z" fill="#1a2235" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      </g>
      {open && <circle cx="60" cy="50" r="22" fill={color} opacity=".35" />}
    </svg>
  );
}

function ChestReveal({ rarity, xp, extra, onClose }: { rarity: Rarity; xp: number; extra?: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const r = RARITY[rarity];
  useEffect(() => {
    sfx.chest();
    const tl = createTimeline({
      onComplete: () => {
        setOpen(true);
        confettiBurst([r.color, '#ffffff'], rarity === 'legendary' ? 2 : rarity === 'epic' ? 1.4 : 0.8);
        if (rarity === 'legendary') fireworks();
      },
    });
    tl.add(box.current!, { scale: [0.3, 1], ease: spring({ bounce: 0.5, duration: 500 }) }).add(box.current!, {
      rotate: [0, -10, 10, -14, 14, -18, 18, 0],
      duration: 700,
      ease: 'inOutSine',
    });
  }, [rarity]);
  return (
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => open && onClose()}>
      <motion.div className="sheet chest-sheet" style={{ ['--rarity' as string]: r.color }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Chest">
        <div ref={box}>
          <ChestSvg open={open} color={r.color} />
        </div>
        {open ? (
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
            <div className="display rarity-word">{r.word}</div>
            <div className="display num" style={{ fontSize: 56, color: '#fff' }}>+{xp} XP</div>
            {extra && <p style={{ marginTop: 6, fontWeight: 600 }}>{extra}</p>}
            <button className="key gold big" style={{ width: '100%', marginTop: 20 }} onClick={onClose} autoFocus>
              Collect
            </button>
          </motion.div>
        ) : (
          <p style={{ opacity: 0.7 }}>Opening…</p>
        )}
      </motion.div>
    </motion.div>
  );
}
