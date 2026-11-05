import { useEffect, useRef } from 'react';
import type { AnalysedMove, Classification } from '../lib/types';
import { ClassIcon } from './ClassIcon';

const SHOW = new Set<Classification>(['brilliant', 'great', 'best', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder', 'excellent']);

export function MoveList({ moves, ply, onSelect, disabled }: { moves: AnalysedMove[]; ply: number; onSelect: (p: number) => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('.mv.here') as HTMLElement | null;
    if (el && ref.current) {
      const box = ref.current;
      const top = el.offsetTop - box.clientHeight / 2;
      box.scrollTo({ top, behavior: 'smooth' });
    }
  }, [ply]);
  const rows: [AnalysedMove, AnalysedMove | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  return (
    <div className="movelist panel" ref={ref}>
      {rows.map(([w, b], i) => (
        <div className="mv-row" key={i}>
          <span className="mv-no">{i + 1}</span>
          {[w, b].map((m) =>
            m ? (
              <button key={m.ply} disabled={disabled} className={`mv cls-${m.cls} ${m.ply === ply ? 'here' : ''}`} onClick={() => onSelect(m.ply)}>
                {SHOW.has(m.cls) && <ClassIcon cls={m.cls} size={16} white={m.ply === ply} />}
                <span>{m.san}</span>
              </button>
            ) : (
              <span key="empty" />
            ),
          )}
        </div>
      ))}
    </div>
  );
}
