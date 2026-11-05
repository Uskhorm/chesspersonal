import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { animate, createTimeline, spring } from 'animejs';
import { onFx, type FxEvent, type Rarity } from '../lib/bus';
import { burst, confettiBurst, fireworks, floatText, pop } from '../lib/fx';
import { sfx } from '../lib/sound';
import { useStore } from '../lib/store';

interface Toast {
  id: number;
  text: string;
  emoji?: string;
  tone?: 'good' | 'bad' | 'info';
  onClick?: () => void;
}

const RARITY_COLOR: Record<Rarity, string> = { common: '#a7b0d8', rare: '#4da3ff', epic: '#b26bff', legendary: '#ffc83d' };

export function FxHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [level, setLevel] = useState<{ level: number; title: string } | null>(null);
  const [chest, setChest] = useState<{ rarity: Rarity; xp: number; extra?: string } | null>(null);

  useEffect(() => {
    let id = 0;
    const push = (t: Omit<Toast, 'id'>) => {
      const tid = ++id;
      setToasts((x) => [...x.slice(-3), { ...t, id: tid }]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== tid)), 4800);
    };
    return onFx((e: FxEvent) => {
      switch (e.type) {
        case 'xp': {
          const hud = document.getElementById('hud-xp')?.getBoundingClientRect();
          const x = e.x ?? (hud ? hud.left + hud.width / 2 : window.innerWidth / 2);
          const y = e.y ?? (hud ? hud.bottom + 10 : 80);
          floatText(e.crit ? `CRIT! +${e.amount} XP` : `+${e.amount} XP`, x, y, e.crit ? '#ff6bd6' : '#ffd34d', e.crit);
          if (e.crit) burst(x, y, '#ff6bd6', 16, 90);
          sfx.xp();
          pop(document.getElementById('hud-xp'), 1.15);
          break;
        }
        case 'levelup':
          setTimeout(() => {
            setLevel({ level: e.level, title: e.title });
            sfx.levelUp();
            fireworks();
          }, 700);
          break;
        case 'quest':
          push({ text: `Quest complete: ${e.label} (+${e.reward} XP)`, emoji: '🏆', tone: 'good' });
          sfx.correct();
          confettiBurst(['#ffd34d', '#ff9a3c'], 0.6, { x: 0.85, y: 0.9 });
          break;
        case 'achievement':
          push({ text: `Achievement unlocked: ${e.label} — chest earned!`, emoji: e.emoji, tone: 'good' });
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
      <div className="toasts">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.8 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
              className={`toast ${t.tone ?? 'info'} ${t.onClick ? 'clicky' : ''}`}
              onClick={() => {
                t.onClick?.();
                setToasts((x) => x.filter((y) => y.id !== t.id));
              }}
            >
              <span className="toast-emoji">{t.emoji ?? '✨'}</span>
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
    animate(num.current!, { scale: [0, 1], rotate: [-25, 0], ease: spring({ bounce: 0.6, duration: 900 }) });
  }, []);
  return (
    <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="modal levelup" initial={{ y: 40, scale: 0.9 }} animate={{ y: 0, scale: 1 }} exit={{ y: 40, scale: 0.9 }}>
        <div className="levelup-rays" />
        <div className="eyebrow">LEVEL UP</div>
        <div className="levelup-num" ref={num}>{level}</div>
        <div className="levelup-title">{title}</div>
        <p className="muted">+1 chest added. Keep the streak alive!</p>
        <button className="btn primary big" onClick={onClose}>Let's go</button>
      </motion.div>
    </motion.div>
  );
}

function ChestReveal({ rarity, xp, extra, onClose }: { rarity: Rarity; xp: number; extra?: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    sfx.chest();
    const tl = createTimeline({
      onComplete: () => {
        setOpen(true);
        confettiBurst([RARITY_COLOR[rarity], '#ffffff'], rarity === 'legendary' ? 2 : rarity === 'epic' ? 1.4 : 0.8);
        if (rarity === 'legendary') fireworks();
      },
    });
    tl.add(box.current!, { scale: [0.2, 1], ease: spring({ bounce: 0.5, duration: 500 }) })
      .add(box.current!, { rotate: [0, -12, 12, -16, 16, -20, 20, 0], duration: 650, ease: 'inOutSine' })
      .add(box.current!, { scale: [1, 1.35], duration: 150, ease: 'inQuad' });
  }, [rarity]);
  const color = RARITY_COLOR[rarity];
  return (
    <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => open && onClose()}>
      <motion.div className="modal chest-modal" style={{ ['--rarity' as string]: color }}>
        <div className={`chest-glow ${open ? 'on' : ''}`} />
        <div className="chest-box" ref={box}>{open ? '✨' : '🎁'}</div>
        {open && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="chest-reward">
            <div className="rarity" style={{ color }}>{rarity.toUpperCase()}</div>
            <div className="chest-xp">+{xp} XP</div>
            {extra && <div className="chest-extra">{extra}</div>}
            <button className="btn primary" onClick={onClose}>Collect</button>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Opens a chest if available (used by HUD). */
export function useOpenChest() {
  return () => useStore.getState().openChest();
}
