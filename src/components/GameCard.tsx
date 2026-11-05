import { motion } from 'motion/react';
import type { StoredGame } from '../lib/types';
import { opponentOf, selfOf } from '../lib/chesscom';
import { ClassIcon } from './ClassIcon';
import { enqueueAnalysis, useQueue } from '../lib/sync';

const TC_ICON: Record<string, string> = { bullet: '⚡', blitz: '🔥', rapid: '⏱️', daily: '☀️', classical: '🐢' };

export function timeAgo(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function GameCard({ g, i = 0 }: { g: StoredGame; i?: number }) {
  const opp = opponentOf(g);
  const me = selfOf(g);
  const q = useQueue();
  const analysing = q.current === g.id;
  const queued = q.queued.includes(g.id);
  const acc = g.userAccuracy;
  const hl = g.highlights ?? {};
  return (
    <motion.a
      href={`#/review/${encodeURIComponent(g.id)}`}
      className={`game-card res-${g.userResult}`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04, type: 'spring', stiffness: 260, damping: 22 }}
      whileHover={{ y: -4, scale: 1.015 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => {
        if (!g.analysed) void enqueueAnalysis(g.id, true);
      }}
    >
      <div className="gc-top">
        <span className={`res-chip ${g.userResult}`}>{g.userResult === 'win' ? 'W' : g.userResult === 'loss' ? 'L' : 'D'}</span>
        <span className="gc-tc">{TC_ICON[g.timeClass] ?? '♟'} {g.timeClass}</span>
        <span className="muted gc-when">{timeAgo(g.endTime)}</span>
      </div>
      <div className="gc-opp">
        <span className={`dot ${g.userColor === 'w' ? 'black' : 'white'}`} />
        <span className="gc-oppname">{opp.username}</span>
        <span className="muted mono">({opp.rating})</span>
      </div>
      <div className="gc-bottom">
        {analysing ? (
          <span className="gc-status">
            <span className="spinner" /> {q.total ? Math.round((q.done / q.total) * 100) : 0}%
          </span>
        ) : g.analysed && acc !== undefined ? (
          <span className="gc-acc mono" style={{ color: acc >= 85 ? '#7fc241' : acc >= 70 ? '#ffd34d' : '#ff9a3c' }}>
            {acc.toFixed(1)}
          </span>
        ) : queued ? (
          <span className="muted">queued…</span>
        ) : (
          <span className="gc-cta">Review →</span>
        )}
        <span className="gc-hl">
          {(['brilliant', 'great', 'miss', 'blunder'] as const).map((c) =>
            hl[c] ? (
              <span key={c} className="gc-hl-item">
                <ClassIcon cls={c} size={16} />
                {hl[c]}
              </span>
            ) : null,
          )}
        </span>
        <span className="muted mono gc-myrating">{me.rating}</span>
      </div>
    </motion.a>
  );
}
