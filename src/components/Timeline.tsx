import { useRef, useState } from 'react';
import type { AnalysedMove, Classification } from '../lib/types';
import { CLASS_COLOR } from '../lib/fx';
import { CLASS_LABEL } from './ClassIcon';

const MARK = new Set<Classification>(['brilliant', 'great', 'blunder', 'mistake', 'miss']);

/**
 * The game graph. White's winning chances are the light area; drag anywhere to scrub.
 * Markers show the moments that decided the game; yours are larger.
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
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 100;
  const n = Math.max(1, curve.length - 1);
  const x = (i: number) => (i / n) * W;
  const y = (v: number) => H - (v / 100) * H;
  const path = curve.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n, Math.round(((clientX - r.left) / r.width) * n)));
  };
  const hm = hover !== null && hover > 0 ? moves[hover - 1] : undefined;

  return (
    <div
      ref={ref}
      className="timeline"
      role="slider"
      aria-label="Game graph: drag to move through the game"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={ply}
      aria-valuetext={ply ? `Move ${Math.ceil(ply / 2)}` : 'Start'}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        onSelect(at(e.clientX));
      }}
      onPointerMove={(e) => {
        const i = at(e.clientX);
        if (e.pointerType === 'mouse') setHover(i);
        if (dragging.current) onSelect(i);
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSelect(Math.min(n, ply + 1));
        else if (e.key === 'ArrowLeft') onSelect(Math.max(0, ply - 1));
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <svg className="tl-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`${path}L${W},${H}L0,${H}Z`} className="tl-area-w" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="tl-mid" vectorEffect="non-scaling-stroke" />
      </svg>
      {moves.map((m) =>
        MARK.has(m.cls) ? (
          <button
            key={m.ply}
            type="button"
            tabIndex={-1}
            className="tl-marker"
            aria-label={`${CLASS_LABEL[m.cls]} on move ${Math.ceil(m.ply / 2)}`}
            style={{
              left: `${(m.ply / n) * 100}%`,
              top: `${100 - (curve[m.ply] ?? 50)}%`,
              width: m.color === userColor ? 12 : 8,
              height: m.color === userColor ? 12 : 8,
              background: CLASS_COLOR[m.cls],
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(m.ply);
            }}
          />
        ) : null,
      )}
      {hover !== null && <span className="tl-hover" style={{ left: `${(hover / n) * 100}%` }} />}
      {hover !== null && (
        <span className="tl-tip" style={{ left: `${Math.min(92, Math.max(8, (hover / n) * 100))}%` }}>
          {hm ? `${Math.ceil(hm.ply / 2)}${hm.color === 'w' ? '.' : '...'} ${hm.san}` : 'Start'}
        </span>
      )}
      <span className="tl-head" style={{ left: `${(ply / n) * 100}%` }} />
    </div>
  );
}
