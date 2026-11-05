import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';

export interface Pt {
  t: number;
  v: number;
}

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = Math.max(1, hi - lo);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * Single-series line chart. Recessive grid, one direct end label, crosshair + tooltip on hover.
 * The series is named by the surrounding heading, so there is no legend box.
 */
export function LineChart({ points, height = 200, format = (v: number) => String(Math.round(v)), label, baseline }: {
  points: Pt[];
  height?: number;
  format?: (v: number) => string;
  label: string;
  /** Optional reference value drawn as a dashed line (e.g. the starting rating). */
  baseline?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = height;
  const padL = 0;
  const padR = 0;
  const padT = 0;
  const padB = 0;
  const { lo, hi, ticks } = useMemo(() => {
    const vs = points.map((p) => p.v);
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const pad = Math.max(4, (max - min) * 0.12);
    const ticks = niceTicks(min - pad, max + pad, 4);
    return { lo: Math.min(min - pad, ticks[0]), hi: Math.max(max + pad, ticks[ticks.length - 1]), ticks };
  }, [points]);
  const n = points.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${d}L${x(n - 1).toFixed(1)},${H - padB}L${x(0).toFixed(1)},${H - padB}Z`;
  const last = points[n - 1];
  const xTicks = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
  const hp = hover !== null ? points[hover] : null;

  const onMove = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((sx - padL) / (W - padL - padR)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="chart" style={{ padding: '8px 52px 26px 44px' }}>
    <div
      ref={ref}
      style={{ position: 'relative' }}
      onPointerMove={(e) => onMove(e.clientX)}
      onPointerDown={(e) => onMove(e.clientX)}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={`${label}: from ${format(points[0].v)} on ${fmtDate(points[0].t)} to ${format(last.v)} on ${fmtDate(last.t)}`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} preserveAspectRatio="none">
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        {baseline !== undefined && <line className="cross" x1={padL} x2={W - padR} y1={y(baseline)} y2={y(baseline)} vectorEffect="non-scaling-stroke" />}
        <motion.path className="area" d={area} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} />
        <motion.path className="series" d={d} vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }} />
        {hp && hover !== null && (
          <>
            <line className="cross" x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {/* Text and markers live in HTML so they don't stretch with the plot. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="t-tiny faint num" style={{ position: 'absolute', right: 'calc(100% + 10px)', top: `${(y(t) / H) * 100}%`, transform: 'translateY(-50%)', fontWeight: 600 }}>
            {format(t)}
          </span>
        ))}
        {xTicks.map((i) => (
          <span key={i} className="t-tiny faint" style={{ position: 'absolute', top: 'calc(100% + 6px)', whiteSpace: 'nowrap', left: `${(x(i) / W) * 100}%`, transform: i === 0 ? 'none' : i === n - 1 ? 'translateX(-100%)' : 'translateX(-50%)', fontWeight: 600 }}>
            {fmtDate(points[i].t)}
          </span>
        ))}
        <span className="num" style={{ position: 'absolute', left: `${(x(n - 1) / W) * 100}%`, top: `${(y(last.v) / H) * 100}%`, transform: 'translate(10px, -50%)', fontWeight: 780, fontSize: 14 }}>
          {format(last.v)}
        </span>
        <span style={{ position: 'absolute', left: `${(x(n - 1) / W) * 100}%`, top: `${(y(last.v) / H) * 100}%`, width: 8, height: 8, margin: '-4px 0 0 -4px', borderRadius: '50%', background: 'var(--ink)', boxShadow: '0 0 0 2px var(--surface)' }} />
        {hp && hover !== null && (
          <>
            <span style={{ position: 'absolute', left: `${(x(hover) / W) * 100}%`, top: `${(y(hp.v) / H) * 100}%`, width: 10, height: 10, margin: '-5px 0 0 -5px', borderRadius: '50%', background: 'var(--surface)', border: '2px solid var(--ink)' }} />
            <span className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hp.v) / H) * 100}%` }}>
              {format(hp.v)}, {fmtDate(hp.t)}
            </span>
          </>
        )}
      </div>
    </div>
    </div>
  );
}

/** Win / draw / loss as one segmented bar with a 2px gap between segments. */
export function WdlBar({ w, d, l }: { w: number; d: number; l: number }) {
  const t = Math.max(1, w + d + l);
  return (
    <div className="wdl" role="img" aria-label={`${w} wins, ${d} draws, ${l} losses`}>
      {w > 0 && <motion.i className="w" initial={{ flexGrow: 0 }} animate={{ flexGrow: w / t }} transition={{ duration: 0.4 }} style={{ flexBasis: 0 }} />}
      {d > 0 && <motion.i className="d" initial={{ flexGrow: 0 }} animate={{ flexGrow: d / t }} transition={{ duration: 0.4 }} style={{ flexBasis: 0 }} />}
      {l > 0 && <motion.i className="l" initial={{ flexGrow: 0 }} animate={{ flexGrow: l / t }} transition={{ duration: 0.4 }} style={{ flexBasis: 0 }} />}
    </div>
  );
}
