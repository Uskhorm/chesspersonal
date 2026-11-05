import { useRef } from 'react';
import type { AnalysedMove, Classification } from '../lib/types';
import { CLASS_COLOR } from '../lib/fx';

const MARK = new Set<Classification>(['brilliant', 'great', 'blunder', 'mistake', 'miss']);

/**
 * The game tape. White's share of the winning chances is the light area; drag anywhere
 * to scrub. Markers show the moments that decided the game; yours are larger.
 */
export function Timeline({ curve, moves, ply, onSelect, userColor }: {
  curve: number[];
  moves: AnalysedMove[];
  ply: number;
  onSelect: (ply: number) => void;
  userColor: 'w' | 'b';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const W = 1000;
  const H = 120;
  const n = Math.max(1, curve.length - 1);
  const x = (i: number) => (i / n) * W;
  const y = (v: number) => H - (v / 100) * H;
  // smooth-ish monotone path
  const pts = curve.map((v, i) => [x(i), y(v)] as const);
  const path = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');

  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const i = Math.round(((clientX - r.left) / r.width) * n);
    onSelect(Math.max(0, Math.min(n, i)));
  };

  const moveCount = Math.ceil(moves.length / 2);
  const ticks = [1, Math.round(moveCount / 4), Math.round(moveCount / 2), Math.round((moveCount * 3) / 4), moveCount].filter((v, i, a) => v > 0 && a.indexOf(v) === i);

  return (
    <div
      ref={ref}
      className="timeline"
      role="slider"
      aria-label="Game timeline"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={ply}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && pick(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSelect(Math.min(n, ply + 1));
        if (e.key === 'ArrowLeft') onSelect(Math.max(0, ply - 1));
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <rect width={W} height={H} className="tl-area-b" rx="8" />
        <path d={`${path}L${W},${H}L0,${H}Z`} className="tl-area-w" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="tl-mid" vectorEffect="non-scaling-stroke" />
        <line x1={x(ply)} x2={x(ply)} y1={-6} y2={H + 6} className="tl-head" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* markers live in HTML so they stay round while the SVG stretches */}
      <div style={{ position: 'absolute', inset: 0, height: 120, pointerEvents: 'none' }}>
        {moves.map((m) =>
          MARK.has(m.cls) ? (
            <span
              key={m.ply}
              className="tl-marker"
              title={`${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '…'} ${m.san}`}
              style={{
                position: 'absolute',
                left: `${(m.ply / n) * 100}%`,
                top: `${100 - curve[m.ply]}%`,
                width: m.color === userColor ? 14 : 9,
                height: m.color === userColor ? 14 : 9,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background: CLASS_COLOR[m.cls],
                boxShadow: '0 0 0 2px #253047',
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(m.ply);
              }}
            />
          ) : null,
        )}
        <span
          style={{
            position: 'absolute',
            left: `${(ply / n) * 100}%`,
            top: -10,
            width: 14,
            height: 14,
            transform: 'translateX(-50%) rotate(45deg)',
            background: 'var(--gold)',
            borderRadius: 3,
          }}
        />
      </div>
      <div className="tl-ticks">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}
