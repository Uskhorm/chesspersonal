import type { AnalysedMove } from '../lib/types';
import { CLASS_COLOR } from '../lib/fx';

const MARK = new Set(['brilliant', 'great', 'blunder', 'mistake', 'miss']);

export function EvalGraph({ curve, moves, ply, onSelect, userColor }: {
  curve: number[];
  moves: AnalysedMove[];
  ply: number;
  onSelect: (ply: number) => void;
  userColor: 'w' | 'b';
}) {
  const W = 600;
  const H = 90;
  const n = Math.max(1, curve.length - 1);
  const x = (i: number) => (i / n) * W;
  const y = (v: number) => H - (v / 100) * H;
  const pts = curve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `0,${H} ${pts} ${W},${H}`;

  return (
    <svg
      className="evalgraph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const i = Math.round(((e.clientX - r.left) / r.width) * n);
        onSelect(Math.max(0, Math.min(n, i)));
      }}
    >
      <rect width={W} height={H} fill="#2a2d3e" />
      <polygon points={area} fill="#eef0f7" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#8890b5" strokeDasharray="4 4" strokeWidth="1" opacity=".5" />
      <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} stroke="#ffd34d" strokeWidth="2.5" />
      {moves.map((m) =>
        MARK.has(m.cls) ? (
          <circle
            key={m.ply}
            cx={x(m.ply)}
            cy={y(curve[m.ply])}
            r={m.color === userColor ? 5 : 3.5}
            fill={CLASS_COLOR[m.cls]}
            stroke="#0b0d17"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
    </svg>
  );
}
