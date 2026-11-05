import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { BookOpen, Check, X } from 'lucide-react';
import type { Explanation } from '../lib/coach';
import type { Mark } from './Board';
import { staggerDelay } from './motion';

/**
 * Explanation points. Each point lights up its squares on the board while you read it
 * (hover, focus or tap). The first point is lit by default so the board always shows something.
 */
export function Points({ ex, onSquares, showRule = true }: { ex: Explanation; onSquares: (marks: Mark[]) => void; showRule?: boolean }) {
  const points = ex.points?.length ? ex.points : null;
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [ex]);
  useEffect(() => {
    const p = points?.[active];
    onSquares(p?.squares?.length ? p.squares.map((s) => ({ square: s, tone: p.kind === 'good' ? 'goodring' : 'badring' })) : []);
  }, [active, points]);
  useEffect(() => () => onSquares([]), []);
  if (!points) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        {ex.detail && <p className="quiet">{ex.detail}</p>}
        {showRule && ex.rule && <Rule text={ex.rule} />}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <ul className="points">
        {points.map((p, i) => (
          <motion.li
            key={i}
            className={`point ${p.kind} ${active === i ? 'on' : ''}`}
            data-has-squares={!!p.squares?.length}
            tabIndex={p.squares?.length ? 0 : -1}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: staggerDelay(i, points.length) }}
          >
            <span className="pdot" aria-hidden="true">{p.kind === 'good' ? <Check strokeWidth={3} /> : <X strokeWidth={3} />}</span>
            <span>
              {p.text}
              {p.squares?.slice(0, 3).map((s) => (
                <span key={s} className="sq">{s}</span>
              ))}
            </span>
          </motion.li>
        ))}
      </ul>
      {showRule && ex.rule && <Rule text={ex.rule} />}
    </div>
  );
}

export function Rule({ text }: { text: string }) {
  return (
    <p className="rule">
      <BookOpen aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
