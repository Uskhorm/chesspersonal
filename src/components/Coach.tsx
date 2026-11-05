import { useMemo } from 'react';
import type { AnalysedMove } from '../lib/types';
import { explainMove } from '../lib/coach';
import { MOTIF_INFO } from '../lib/classify';

/** Concrete coaching for one move: what it did, what it allowed, what was better. */
export function Coach({ move, mine }: { move: AnalysedMove; mine: boolean }) {
  const ex = useMemo(() => {
    try {
      return explainMove(move);
    } catch {
      return { headline: move.comment, detail: '', tags: [] as string[], rule: '' };
    }
  }, [move]);
  const motifs = mine ? (move.motifs ?? []).filter((m) => m !== 'opening' && m !== 'endgame') : [];
  return (
    <div className="coach stack" style={{ gap: 10 }}>
      <p className="coach-text"><b>{ex.headline}</b></p>
      {ex.detail && <p className="quiet">{ex.detail}</p>}
      {mine && ex.rule && <p className="t-small" style={{ fontWeight: 650 }}>Rule: {ex.rule}</p>}
      {motifs.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {motifs.map((m) => (
            <span key={m} className="tag">{MOTIF_INFO[m].label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
