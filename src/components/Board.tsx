import { useEffect, useMemo, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { Chess, type Square } from 'chess.js';
import type { Classification } from '../lib/types';
import { ClassIcon } from './ClassIcon';
import { popIn } from '../lib/fx';
import { BOARD_THEMES, useStore } from '../lib/store';

export interface Arrow {
  from: string;
  to: string;
  brush: 'best' | 'played' | 'alt' | 'hint';
}

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: [string, string];
  arrows?: Arrow[];
  badge?: { square: string; cls: Classification } | null;
  movable?: boolean;
  onMove?: (from: string, to: string, promotion?: string) => void;
  highlight?: string[];
  className?: string;
  nonce?: number; // bump to force a resync (e.g. undo a wrong move)
}

export function legalDests(fen: string): Map<Key, Key[]> {
  const c = new Chess(fen);
  const dests = new Map<Key, Key[]>();
  for (const m of c.moves({ verbose: true })) {
    const arr = dests.get(m.from as Key) ?? [];
    arr.push(m.to as Key);
    dests.set(m.from as Key, arr);
  }
  return dests;
}

function expand(fen: string): string {
  return fen.split(' ')[0].replace(/\d/g, (d) => '.'.repeat(Number(d))).replace(/\//g, '');
}

function squareDiff(a: string, b: string): number {
  const x = expand(a);
  const y = expand(b);
  let n = 0;
  for (let i = 0; i < 64; i++) if (x[i] !== y[i]) n++;
  return n;
}

export function Board({ fen, orientation, lastMove, arrows = [], badge, movable, onMove, className, nonce }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const themeId = useStore((s) => s.settings.boardTheme);
  const theme = BOARD_THEMES.find((t) => t.id === themeId) ?? BOARD_THEMES[0];

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      fen,
      orientation,
      animation: { enabled: true, duration: 220 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      coordinates: true,
      drawable: {
        enabled: true,
        brushes: {
          green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
          red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
          blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
          yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
          best: { key: 'best', color: '#7fc241', opacity: 0.85, lineWidth: 11 },
          played: { key: 'played', color: '#ff6b4a', opacity: 0.7, lineWidth: 9 },
          alt: { key: 'alt', color: '#5b8def', opacity: 0.6, lineWidth: 8 },
          hint: { key: 'hint', color: '#ffd34d', opacity: 0.8, lineWidth: 10 },
        },
      },
    });
    return () => api.current?.destroy();
  }, []);

  const turnColor = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const inCheck = useMemo(() => new Chess(fen).inCheck(), [fen]);

  const prevFen = useRef(fen);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    // Only animate single-move changes; big jumps snap instantly (no piece soup).
    const small = squareDiff(prevFen.current, fen) <= 4;
    prevFen.current = fen;
    a.set({
      animation: { enabled: small, duration: 220 },
      fen,
      orientation,
      turnColor,
      check: inCheck ? turnColor : false,
      lastMove: lastMove as Key[] | undefined,
      viewOnly: false,
      movable: movable
        ? {
            free: false,
            color: turnColor,
            dests: legalDests(fen),
            showDests: true,
            events: {
              after: (orig, dest) => {
                const c = new Chess(fen);
                const p = c.get(orig as Square);
                const promo = p?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
                onMoveRef.current?.(orig, dest, promo);
              },
            },
          }
        : { free: false, color: undefined, dests: new Map() },
      draggable: { enabled: !!movable },
      selectable: { enabled: !!movable },
    });
  }, [fen, orientation, lastMove?.[0], lastMove?.[1], movable, turnColor, inCheck, nonce]);

  useEffect(() => {
    const shapes: DrawShape[] = arrows.map((x) => (x.from === x.to ? { orig: x.from as Key, brush: x.brush } : { orig: x.from as Key, dest: x.to as Key, brush: x.brush }));
    api.current?.setAutoShapes(shapes);
  }, [JSON.stringify(arrows)]);

  useEffect(() => {
    if (badge) popIn(badgeRef.current);
  }, [badge?.square, badge?.cls, fen]);

  const badgePos = badge
    ? (() => {
        const f = badge.square.charCodeAt(0) - 97;
        const r = Number(badge.square[1]) - 1;
        const col = orientation === 'white' ? f : 7 - f;
        const row = orientation === 'white' ? 7 - r : r;
        return { left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%` };
      })()
    : null;

  return (
    <div className={`board-wrap ${className ?? ''}`} style={{ ['--light' as string]: theme.light, ['--dark' as string]: theme.dark }}>
      <div ref={el} className="cg-host" />
      {badge && badgePos && (
        <div ref={badgeRef} className="board-badge" style={badgePos} key={badge.square + badge.cls + fen}>
          <ClassIcon cls={badge.cls} size={34} />
        </div>
      )}
    </div>
  );
}
