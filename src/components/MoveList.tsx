import { useEffect, useRef } from 'react';
import type { AnalysedMove } from '../lib/types';
import { ClassIcon } from './ClassIcon';

const SHOW = new Set(['brilliant', 'great', 'best', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder', 'excellent']);

export function MoveList({ moves, ply, onSelect }: { moves: AnalysedMove[]; ply: number; onSelect: (p: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.mv.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [ply]);
  const rows: [AnalysedMove, AnalysedMove | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  return (
    <div className="movelist" ref={ref}>
      {rows.map(([w, b], i) => (
        <div className="mv-row" key={i}>
          <span className="mv-no">{i + 1}.</span>
          {[w, b].map((m) =>
            m ? (
              <button key={m.ply} className={`mv cls-${m.cls} ${m.ply === ply ? 'active' : ''}`} onClick={() => onSelect(m.ply)}>
                {SHOW.has(m.cls) && <ClassIcon cls={m.cls} size={15} />}
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
