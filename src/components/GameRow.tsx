import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { StoredGame } from '../lib/types';
import type { AnalysisSummary } from '../lib/db';
import { opponentOf } from '../lib/chesscom';
import { enqueueAnalysis, useQueue } from '../lib/sync';
import { ClassIcon } from './ClassIcon';

export function timeAgo(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}

const RESULT = { win: 'Won', loss: 'Lost', draw: 'Drew' } as const;

/** Silhouette of a game's winning chances from your side: light is yours. */
export function Spark({ curve, userColor }: { curve: number[]; userColor: 'w' | 'b' }) {
  const W = 132;
  const H = 30;
  const n = Math.max(1, curve.length - 1);
  const pts = curve.map((v, i) => `${((i / n) * W).toFixed(1)},${(H - ((userColor === 'w' ? v : 100 - v) / 100) * H).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <rect className="sb" width={W} height={H} />
      <polygon className="sw" points={`0,${H} ${pts} ${W},${H}`} />
    </svg>
  );
}

function Progress({ id }: { id: string }) {
  const pct = useQueue((q) => (q.current === id && q.total ? q.done / q.total : null));
  const queued = useQueue((q) => q.queued.includes(id));
  if (pct === null) return <span className="faint t-small">{queued ? 'Queued' : 'Not reviewed'}</span>;
  const R = 9;
  const C = 2 * Math.PI * R;
  return (
    <span className="row nowrap" style={{ gap: 6 }} aria-label={`Reviewing, ${Math.round(pct * 100)}%`}>
      <svg className="mini-ring" viewBox="0 0 22 22" aria-hidden="true">
        <circle className="t" cx="11" cy="11" r={R} fill="none" strokeWidth="2.5" />
        <circle className="f" cx="11" cy="11" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.05, pct))} />
      </svg>
      <span className="num t-small strong">{Math.round(pct * 100)}%</span>
    </span>
  );
}

export const GameRow = memo(function GameRow({ g, summary, style }: { g: StoredGame; summary?: AnalysisSummary; style?: React.CSSProperties }) {
  const opp = opponentOf(g);
  const hl = g.highlights ?? {};
  const analysing = useQueue((q) => q.current === g.id);
  const acc = summary?.accuracy ?? g.userAccuracy;
  return (
    <a
      href={`#/review/${encodeURIComponent(g.id)}`}
      className={`grow-row ${g.userResult}`}
      style={style}
      onClick={() => {
        if (!g.analysed) void enqueueAnalysis(g.id, true);
      }}
      aria-label={`${RESULT[g.userResult]} against ${opp.username}, ${g.timeClass}${acc !== undefined ? `, ${acc.toFixed(1)} accuracy` : ''}`}
    >
      <span className="res" aria-hidden="true" />
      <span className="opp">
        <b>
          {RESULT[g.userResult]} vs {opp.username} <span className="faint num" style={{ fontWeight: 500 }}>{opp.rating}</span>
        </b>
        <span>
          {g.timeClass.charAt(0).toUpperCase() + g.timeClass.slice(1)}, as {g.userColor === 'w' ? 'white' : 'black'}, {timeAgo(g.endTime).toLowerCase()}
        </span>
      </span>
      <span className="acc">
        {g.analysed && acc !== undefined ? (
          <>
            <span className="display num">{acc.toFixed(1)}</span>
            <small>accuracy</small>
          </>
        ) : analysing ? null : (
          <span className="faint">–</span>
        )}
      </span>
      {summary?.curve?.length ? <Spark curve={summary.curve} userColor={g.userColor} /> : <span className="spark hide-s" />}
      <span className="marks">
        {g.analysed ? (
          (['brilliant', 'great', 'miss', 'blunder'] as const).map((c) =>
            hl[c] ? (
              <span key={c}>
                <ClassIcon cls={c} size={16} />
                {hl[c]}
              </span>
            ) : null,
          )
        ) : (
          <Progress id={g.id} />
        )}
      </span>
      <span className="cta">
        {g.analysed ? 'Open' : analysing ? 'Watch' : 'Review'}
        <ChevronRight size={16} />
      </span>
    </a>
  );
});
