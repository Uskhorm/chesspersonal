import { useEffect, useRef } from 'react';
import type { AnalysedMove, Classification } from '../lib/types';
import { ClassIcon } from './ClassIcon';

const SHOW = new Set<Classification>(['brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'miss', 'blunder']);

/** Compact score sheet. SAN lives here as a reference; the coach panel speaks plain English. */
export function MoveList({ moves, ply, onSelect, maxHeight = 260 }: { moves: AnalysedMove[]; ply: number; onSelect: (p: number) => void; maxHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector('.mv.here') as HTMLElement | null;
    if (el && box) {
      const top = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
      box.scrollTo({ top, behavior: 'smooth' });
    } else box?.scrollTo({ top: 0 });
  }, [ply]);
  const rows: [AnalysedMove, AnalysedMove | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  return (
    <div className="movelist" ref={ref} style={{ maxHeight, position: 'relative' }} role="list" aria-label="Moves">
      {rows.map(([w, b], i) => (
        <div key={i} style={{ display: 'contents' }} role="listitem">
          <span className="no">{i + 1}</span>
          {[w, b].map((m, j) =>
            m ? (
              <button key={m.ply} className={`mv ${m.ply === ply ? 'here' : ''}`} onClick={() => onSelect(m.ply)} aria-current={m.ply === ply ? 'step' : undefined}>
                <span>{m.san}</span>
                {SHOW.has(m.cls) && <ClassIcon cls={m.cls} size={14} />}
              </button>
            ) : (
              <span key={`e${j}`} />
            ),
          )}
        </div>
      ))}
    </div>
  );
}
