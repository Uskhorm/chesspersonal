import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';

/**
 * Number ticker. Tweens from the previous value to the new one (first mount counts up from `from`).
 * Writes textContent directly so React doesn't re-render 60 times a second.
 */
export function Ticker({ value, decimals = 0, from = 0, duration = 0.9, className, prefix = '', suffix = '' }: {
  value: number;
  decimals?: number;
  from?: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(from);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !Number.isFinite(value)) return;
    const fmt = (v: number) => `${prefix}${v.toFixed(decimals)}${suffix}`;
    if (reduce) {
      el.textContent = fmt(value);
      last.current = value;
      return;
    }
    const c = animate(last.current, value, {
      duration,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (v) => (el.textContent = fmt(v)),
    });
    last.current = value;
    return () => c.stop();
  }, [value, decimals, duration, reduce, prefix, suffix]);
  return (
    <span ref={ref} className={`num ${className ?? ''}`} aria-label={`${prefix}${Number.isFinite(value) ? value.toFixed(decimals) : '–'}${suffix}`}>
      {prefix}
      {from.toFixed(decimals)}
      {suffix}
    </span>
  );
}
