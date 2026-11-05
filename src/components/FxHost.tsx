import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Info, Sparkles, X } from 'lucide-react';
import { createTimeline, spring as animeSpring } from 'animejs';
import { onFx, type FxEvent, type Rarity } from '../lib/bus';
import { burst, confettiBurst, fireworks, floatText, pop } from '../lib/fx';
import { sfx } from '../lib/sound';
import { spring } from './motion';

interface Toast {
  id: number;
  text: string;
  tone?: 'good' | 'bad' | 'info';
  star?: boolean;
  onClick?: () => void;
}

const RARITY: Record<Rarity, { color: string; word: string }> = {
  common: { color: '#c9d2e3', word: 'Common' },
  rare: { color: '#6e95ff', word: 'Rare' },
  epic: { color: '#c08bff', word: 'Epic' },
  legendary: { color: '#f2b705', word: 'Legendary' },
};

/** Strip emoji the library layer still sends; the UI speaks with icons and colour instead. */
const clean = (t: string) => t.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\s+·\s+/g, ', ').replace(/\s{2,}/g, ' ').trim();

export function FxHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [level, setLevel] = useState<{ level: number; title: string } | null>(null);
  const [chest, setChest] = useState<{ rarity: Rarity; xp: number; extra?: string } | null>(null);

  useEffect(() => {
    let id = 0;
    const push = (t: Omit<Toast, 'id'>) => {
      const tid = ++id;
      setToasts((x) => [...x.slice(-2), { ...t, text: clean(t.text), id: tid }]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== tid)), 4800);
    };
    return onFx((e: FxEvent) => {
      switch (e.type) {
        case 'xp': {
          const hud = document.getElementById('hud-xp')?.getBoundingClientRect();
          const x = e.x ?? (hud ? hud.left + hud.width / 2 : window.innerWidth / 2);
          const y = e.y ?? (hud ? hud.bottom + 18 : 80);
          const css = getComputedStyle(document.documentElement);
          floatText(e.crit ? `Double +${e.amount}` : `+${e.amount}`, x, y, e.crit ? '#a26bff' : css.getPropertyValue('--gold-ink').trim() || '#7a5600', e.crit);
          if (e.crit) burst(x, y, '#a26bff', 14, 70);
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
          push({ text: `Quest done: ${e.label}. +${e.reward} XP`, tone: 'good' });
          sfx.correct();
          break;
        case 'achievement':
          push({ text: `Achievement: ${e.label}. You earned a chest.`, tone: 'good', star: true });
          sfx.great();
          break;
        case 'chest':
          setChest({ rarity: e.rarity, xp: e.xp, extra: e.extra });
          break;
        case 'toast':
          push({ text: e.text, tone: e.tone, onClick: e.onClick });
          break;
      }
    });
  }, []);

  return (
    <>
      <div className="toasts" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.14 } }}
              transition={spring.smooth}
              className={`toast ${t.tone ?? 'info'} ${t.onClick ? 'clickable' : ''}`}
              role={t.onClick ? 'button' : undefined}
              tabIndex={t.onClick ? 0 : undefined}
              onClick={() => {
                t.onClick?.();
                setToasts((x) => x.filter((y) => y.id !== t.id));
              }}
            >
              <span className="ico">{t.star ? <Sparkles /> : t.tone === 'good' ? <Check strokeWidth={3} /> : t.tone === 'bad' ? <X strokeWidth={3} /> : <Info />}</span>
              <span className="grow">{t.text}</span>
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
  return (
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="sheet"
        initial={{ y: 24, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={spring.smooth}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Level ${level}`}
      >
        <p className="quiet">You reached level</p>
        <motion.div className="display levelup-num num" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ ...spring.pop, delay: 0.08 }}>
          {level}
        </motion.div>
        <h2 className="t-2" style={{ marginTop: 10 }}>{title}</h2>
        <p className="quiet" style={{ margin: '8px 0 22px' }}>A chest is waiting in your scoreboard.</p>
        <button className="btn primary lg block" onClick={onClose} autoFocus>
          Keep going
        </button>
      </motion.div>
    </motion.div>
  );
}

function ChestSvg({ open, color }: { open: boolean; color: string }) {
  return (
    <svg viewBox="0 0 120 120" className="chest-box" aria-hidden="true">
      <rect x="18" y="56" width="84" height="46" rx="8" fill="#22252b" stroke={color} strokeWidth="4" />
      <rect x="52" y="64" width="16" height="16" rx="3" fill={color} />
      <g style={{ transformOrigin: '60px 56px', transform: open ? 'rotate(-28deg) translate(-6px,-10px)' : 'none', transition: 'transform 380ms cubic-bezier(.34,1.45,.64,1)' }}>
        <path d="M18 56c0-16 12-26 42-26s42 10 42 26z" fill="#22252b" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      </g>
      {open && <circle cx="60" cy="50" r="22" fill={color} opacity=".3" />}
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
    tl.add(box.current!, { scale: [0.8, 1], ease: animeSpring({ bounce: 0.45, duration: 420 }) }).add(box.current!, {
      rotate: [0, -8, 8, -12, 12, -14, 14, 0],
      duration: 620,
      ease: 'inOutSine',
    });
    return () => {
      tl.revert();
    };
  }, [rarity]);
  return (
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => open && onClose()}>
      <motion.div className="sheet chest-sheet" style={{ ['--rarity' as string]: r.color }} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring.smooth} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Chest">
        <div ref={box}>
          <ChestSvg open={open} color={r.color} />
        </div>
        {open ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
            <div className="display rarity-word">{r.word}</div>
            <div className="display num" style={{ fontSize: 52, marginTop: 4 }}>+{xp} XP</div>
            {extra && <p style={{ marginTop: 8, fontWeight: 600, opacity: 0.85 }}>{extra}</p>}
            <button className="btn gold lg block" style={{ marginTop: 22 }} onClick={onClose} autoFocus>
              Collect
            </button>
          </motion.div>
        ) : (
          <p style={{ opacity: 0.6 }}>Opening</p>
        )}
      </motion.div>
    </motion.div>
  );
}
