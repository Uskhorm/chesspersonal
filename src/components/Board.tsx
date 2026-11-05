import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, X } from 'lucide-react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { Chess, type Square } from 'chess.js';
import type { Classification } from '../lib/types';
import { ClassIcon } from './ClassIcon';
import { useStore } from '../lib/store';
import { sfx } from '../lib/sound';
import { themeFor } from './themes';
import { spring } from './motion';
import { PromotionPicker, type PromotionRole } from './PromotionPicker';

export interface Arrow {
  from: string;
  to: string;
  brush: 'best' | 'played' | 'alt' | 'hint' | 'threat' | 'faint';
  label?: string;
}

export type MarkTone = 'good' | 'bad' | 'hint' | 'focus' | 'goodring' | 'badring';
export interface Mark {
  square: string;
  tone: MarkTone;
}

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: [string, string];
  arrows?: Arrow[];
  badge?: { square: string; cls: Classification } | null;
  movable?: boolean;
  onMove?: (from: string, to: string, promotion?: string) => void;
  /** Squares to pulse as a hint. */
  highlight?: string[];
  /** Tinted squares (explanations, feedback). */
  marks?: Mark[];
  /** Big centred tick or cross, re-triggered whenever `key` changes. */
  feedback?: { kind: 'good' | 'bad'; key: number } | null;
  className?: string;
  /** Bump to force a resync (e.g. undo a wrong move). */
  nonce?: number;
  coordinates?: boolean;
  /** Play move sounds when the position advances by one move. */
  sound?: boolean;
  /** Snap instead of animating (thumbnails). */
  still?: boolean;
  /** Skip the picker and promote to queen immediately. */
  autoQueen?: boolean;
}

export function legalDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  try {
    const c = new Chess(fen);
    for (const m of c.moves({ verbose: true })) {
      const arr = dests.get(m.from as Key) ?? [];
      arr.push(m.to as Key);
      dests.set(m.from as Key, arr);
    }
  } catch {
    /* invalid fen: no moves */
  }
  return dests;
}

function expand(fen: string): string {
  return fen.split(' ')[0].replace(/\d/g, (d) => '.'.repeat(Number(d))).replace(/\//g, '');
}

function diff(a: string, b: string): { changed: number; captured: boolean } {
  const x = expand(a);
  const y = expand(b);
  let changed = 0;
  let pa = 0;
  let pb = 0;
  for (let i = 0; i < 64; i++) {
    if (x[i] !== y[i]) changed++;
    if (x[i] !== '.') pa++;
    if (y[i] !== '.') pb++;
  }
  return { changed, captured: pb < pa };
}

const BRUSHES = {
  green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
  best: { key: 'best', color: '#2f9e44', opacity: 0.88, lineWidth: 11 },
  played: { key: 'played', color: '#d7263d', opacity: 0.78, lineWidth: 9 },
  alt: { key: 'alt', color: '#2f9e44', opacity: 0.42, lineWidth: 8 },
  faint: { key: 'faint', color: '#2f9e44', opacity: 0.26, lineWidth: 7 },
  hint: { key: 'hint', color: '#f2b705', opacity: 0.92, lineWidth: 10 },
  threat: { key: 'threat', color: '#e5394f', opacity: 0.55, lineWidth: 8 },
};

export function Board({
  fen,
  orientation,
  lastMove,
  arrows = [],
  badge,
  movable,
  onMove,
  className,
  nonce,
  highlight = [],
  marks = [],
  feedback,
  coordinates = true,
  sound,
  still,
  autoQueen = false,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key; color: 'white' | 'black' } | null>(null);
  const promotionPending = useRef(false);
  const [resync, setResync] = useState(0);
  useEffect(() => {
    promotionPending.current = false;
    setPromotion(null);
  }, [fen, orientation, nonce, movable, autoQueen]);
  const finishPromotion = (role?: PromotionRole) => {
    if (!promotion || !promotionPending.current) return;
    promotionPending.current = false;
    setPromotion(null);
    setResync((n) => n + 1);
    if (role) onMoveRef.current?.(promotion.orig, promotion.dest, role);
  };
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const themeId = useStore((s) => s.settings.boardTheme);
  const theme = themeFor(themeId);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      fen,
      orientation,
      animation: { enabled: !still, duration: 180 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      coordinates,
      viewOnly: !movable && still,
      drawable: { enabled: true, brushes: BRUSHES },
    });
    // Chessground caches its bounds; re-measure whenever the container changes size.
    const ro = new ResizeObserver(() => api.current?.redrawAll());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      api.current?.destroy();
    };
  }, []);

  const turnColor = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const inCheck = useMemo(() => {
    try {
      return new Chess(fen).inCheck();
    } catch {
      return false;
    }
  }, [fen]);

  const custom = useMemo(() => {
    const m = new Map<Key, string>();
    for (const x of marks) m.set(x.square as Key, `hl-${x.tone}`);
    for (const sq of highlight) m.set(sq as Key, 'hl-hint');
    return m;
  }, [JSON.stringify(marks), highlight.join()]);

  const prevFen = useRef(fen);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    // Only animate single-move changes; big jumps snap instantly (no piece soup).
    const d = diff(prevFen.current, fen);
    const small = d.changed > 0 && d.changed <= 4;
    if (sound && small && prevFen.current !== fen) {
      if (inCheck) sfx.check();
      else if (d.changed === 4) sfx.castle();
      else if (d.captured) sfx.capture();
      else sfx.move();
    }
    prevFen.current = fen;
    a.set({
      animation: { enabled: small && !still, duration: 180 },
      fen,
      orientation,
      turnColor,
      check: inCheck ? turnColor : false,
      lastMove: lastMove as Key[] | undefined,
      highlight: { lastMove: true, check: true, custom },
      viewOnly: false,
      movable: movable && !promotionPending.current
        ? {
            free: false,
            color: turnColor,
            dests: legalDests(fen),
            showDests: true,
            events: {
              after: (orig, dest) => {
                if (promotionPending.current) return;
                let promo: string | undefined;
                try {
                  const p = new Chess(fen).get(orig as Square);
                  promo = p?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
                  if (promo && !autoQueen && p) {
                    promotionPending.current = true;
                    a.set({ movable: { color: undefined, dests: new Map() }, draggable: { enabled: false }, selectable: { enabled: false } });
                    setPromotion({ orig, dest, color: p.color === 'w' ? 'white' : 'black' });
                    return;
                  }
                } catch {
                  /* ignore */
                }
                onMoveRef.current?.(orig, dest, promo);
              },
            },
          }
        : { free: false, color: undefined, dests: new Map() },
      draggable: { enabled: !!movable && !promotionPending.current },
      selectable: { enabled: !!movable && !promotionPending.current },
    });
  }, [fen, orientation, lastMove?.[0], lastMove?.[1], movable, turnColor, inCheck, nonce, custom, resync, autoQueen]);

  const arrowKey = JSON.stringify(arrows);
  useEffect(() => {
    const shapes: DrawShape[] = arrows.map((x) =>
      x.from === x.to
        ? { orig: x.from as Key, brush: x.brush }
        : { orig: x.from as Key, dest: x.to as Key, brush: x.brush, label: x.label ? { text: x.label, fill: BRUSHES[x.brush].color } : undefined },
    );
    api.current?.setAutoShapes(shapes);
  }, [arrowKey]);

  const sqPos = (sq: string, corner = false) => {
    const f = sq.charCodeAt(0) - 97;
    const r = Number(sq[1]) - 1;
    const col = orientation === 'white' ? f : 7 - f;
    const row = orientation === 'white' ? 7 - r : r;
    return { left: `${(col + (corner ? 1 : 0)) * 12.5}%`, top: `${row * 12.5}%` };
  };

  const [fb, setFb] = useState<{ kind: 'good' | 'bad'; key: number } | null>(null);
  useEffect(() => {
    if (!feedback) return;
    setFb(feedback);
    const t = setTimeout(() => setFb(null), 720);
    return () => clearTimeout(t);
  }, [feedback?.key]);

  return (
    <div className={`board-wrap ${className ?? ''}`} style={{ ['--light' as string]: theme.light, ['--dark' as string]: theme.dark }}>
      <div ref={el} className="cg-host" tabIndex={-1} />
      {promotion && (
        <PromotionPicker
          square={promotion.dest}
          color={promotion.color}
          orientation={orientation}
          onChoose={(role) => finishPromotion(role)}
          onCancel={() => finishPromotion()}
        />
      )}
      <AnimatePresence>
        {badge && (
          <motion.div
            key={badge.square + badge.cls + fen}
            className="board-badge"
            style={sqPos(badge.square, true)}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={spring.pop}
          >
            <ClassIcon cls={badge.cls} size={30} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {fb && (
          <motion.div key={fb.key} className="board-feedback" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }}>
            <motion.div className={`mark ${fb.kind}`} initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={spring.pop}>
              {fb.kind === 'good' ? <Check strokeWidth={3} /> : <X strokeWidth={3} />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
