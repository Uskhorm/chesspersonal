import type { StoredGame } from '../lib/types';
import { opponentOf } from '../lib/chesscom';
import { ClassIcon } from './ClassIcon';
import { enqueueAnalysis, useQueue } from '../lib/sync';

export function timeAgo(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}

const RESULT = { win: 'Won', loss: 'Lost', draw: 'Drew' } as const;

/** One game on the tape: result stripe, opponent, decisive moments, your accuracy. */
/** Silhouette of a game's eval curve, the app's recurring motif. */
export function TapeSpark({ curve, userColor }: { curve: number[]; userColor: 'w' | 'b' }) {
  const W = 120;
  const H = 26;
  const n = Math.max(1, curve.length - 1);
  const pts = curve.map((v, i) => `${((i / n) * W).toFixed(1)},${(H - ((userColor === 'w' ? v : 100 - v) / 100) * H).toFixed(1)}`).join(' ');
  return (
    <svg className="tape-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <rect width={W} height={H} rx="3" fill="#253047" />
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="#dfe5ec" />
    </svg>
  );
}

export function TapeRow({ g, curve }: { g: StoredGame; curve?: number[] }) {
  const opp = opponentOf(g);
  const q = useQueue();
  const analysing = q.current === g.id;
  const queued = q.queued.includes(g.id);
  const hl = g.highlights ?? {};
  return (
    <a
      href={`#/review/${encodeURIComponent(g.id)}`}
      className={`tape-row ${g.userResult}`}
      onClick={() => {
        if (!g.analysed) void enqueueAnalysis(g.id, true);
      }}
    >
      <span className="res" aria-label={RESULT[g.userResult]} />
      <span className="when">{timeAgo(g.endTime)}</span>
      <span className="opp">
        {RESULT[g.userResult]} vs {opp.username} <span className="faint num" style={{ fontWeight: 500 }}>{opp.rating}</span>
        <span className="faint t-small" style={{ display: 'block', fontWeight: 500, textTransform: 'capitalize' }}>
          {g.timeClass}, played {g.userColor === 'w' ? 'white' : 'black'}
        </span>
      </span>
      <span className="acc display num">
        {analysing ? <span className="spin" /> : g.analysed && g.userAccuracy !== undefined ? <>{g.userAccuracy.toFixed(1)}<span className="acc-label">accuracy</span></> : <span className="faint t-small" style={{ fontWeight: 600, fontVariationSettings: "'wdth' 100" }}>{queued ? 'Queued' : '—'}</span>}
      </span>
      <span className="marks">
        {curve && <TapeSpark curve={curve} userColor={g.userColor} />}
        {(['brilliant', 'great', 'miss', 'blunder'] as const).map((c) =>
          hl[c] ? (
            <span key={c}>
              <ClassIcon cls={c} size={18} />
              {hl[c]}
            </span>
          ) : null,
        )}
      </span>
      <span className="cta cta-col">{g.analysed ? 'Open review' : analysing ? `${q.total ? Math.round((q.done / q.total) * 100) : 0}%` : 'Review game'}</span>
    </a>
  );
}
