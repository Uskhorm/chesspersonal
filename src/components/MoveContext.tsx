import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { RotateCcw } from 'lucide-react';
import { db } from '../lib/db';
import type { Classification, Color, Drill } from '../lib/types';
import { CLASS_LABEL } from './ClassIcon';
import type { Arrow } from './Board';
import { plainMove } from './plain';

export interface MoveRef {
  from: string;
  to: string;
  text: string; // plain English, e.g. "Their knight jumps to g4"
}

export interface DrillContext {
  fen?: string;
  mineAfterFen?: string;
  /** Position before the opponent's last move (to animate it in). */
  prevFen?: string;
  /** The opponent's move that led to this position. */
  theirs?: MoveRef;
  /** The move you actually played here (the mistake). */
  mine?: MoveRef;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type ContextDrill = Pick<Drill, 'gameId' | 'ply' | 'fen' | 'playedSan' | 'color'>;
type PreviousMove = { ply: number; fenBefore: string; san: string };

/** Reconstruct moves legally, so an old or mismatched analysis cannot show the wrong context. */
export function drillContext(drill: ContextDrill, previous?: PreviousMove): DrillContext {
  const ctx: DrillContext = { fen: drill.fen };
  try {
    const c = new Chess(drill.fen);
    const m = c.move(drill.playedSan);
    ctx.mine = { from: m.from, to: m.to, text: cap(plainMove(drill.fen, drill.playedSan, drill.color)) };
    ctx.mineAfterFen = c.fen();
  } catch { /* Older drills may lack playable notation. */ }
  if (previous?.ply !== drill.ply - 1) return ctx;
  try {
    const c = new Chess(previous.fenBefore);
    const m = c.move(previous.san);
    if (c.fen() !== new Chess(drill.fen).fen()) return ctx;
    ctx.prevFen = previous.fenBefore;
    ctx.theirs = { from: m.from, to: m.to, text: cap(plainMove(previous.fenBefore, previous.san, drill.color)) };
  } catch { /* Keep the usable mistake even without opponent context. */ }
  return ctx;
}

/** Looks up what happened around a mistake: their previous move and your move. */
export function useDrillContext(drill?: ContextDrill): DrillContext {
  const id = JSON.stringify([drill?.gameId, drill?.ply, drill?.fen, drill?.playedSan, drill?.color]);
  const initial = useMemo(() => drill ? drillContext(drill) : {}, [id]);
  const [loaded, setLoaded] = useState<{ id: string; ctx: DrillContext }>();
  useEffect(() => {
    if (!drill) return;
    let alive = true;
    db.slim
      .get(drill.gameId)
      .then((a) => {
        if (!alive) return;
        const prev = a?.moves.find((x) => x.ply === drill.ply - 1);
        setLoaded({ id, ctx: drillContext(drill, prev) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  return loaded?.id === id ? loaded.ctx : initial;
}

/**
 * Plays the opponent's last move onto the board when a new position opens, so you see
 * what you're responding to. Returns the fen to show and the last-move highlight.
 */
export function useIntroMove(key: string | number, ctx: DrillContext, fen: string, active: boolean, auto = active) {
  const identity = `${key}:${ctx.fen}:${ctx.prevFen}`;
  const seen = useRef<string | undefined>(undefined);
  const [preview, setPreview] = useState<{ identity: string; kind: 'theirs' | 'mine'; after: boolean; automatic?: boolean }>();
  useEffect(() => {
    if (!active || !auto || !ctx.prevFen || seen.current === identity) return;
    seen.current = identity;
    setPreview({ identity, kind: 'theirs', after: false, automatic: true });
  }, [identity, active, auto]);
  useEffect(() => {
    if (!preview) return;
    if (!active || preview.identity !== identity || (preview.automatic && !auto)) {
      setPreview(current => current === preview ? undefined : current);
      return;
    }
    const t = setTimeout(() => {
      setPreview(preview.after ? undefined : { ...preview, after: true });
    }, preview.after ? 1100 : 650);
    return () => clearTimeout(t);
  }, [preview, identity, active, auto]);
  const current = active && preview?.identity === identity && (!preview.automatic || auto) ? preview : undefined;
  const previewFen = current?.kind === 'mine'
    ? current.after ? ctx.mineAfterFen : ctx.fen
    : current ? current.after ? ctx.fen : ctx.prevFen : undefined;
  const move = current?.kind === 'mine' ? ctx.mine : ctx.theirs;
  return {
    fen: previewFen ?? fen,
    lastMove: current && !current.after ? undefined : move ? ([move.from, move.to] as [string, string]) : undefined,
    animating: !!current,
    showing: current?.kind,
    cancel: () => setPreview(undefined),
    replay: () => active && ctx.prevFen && setPreview({ identity, kind: 'theirs', after: false }),
    replayMine: () => active && ctx.mineAfterFen && setPreview({ identity, kind: 'mine', after: false }),
  };
}

/** The original move is red; Board adds a readable "You" tag beside its origin. */
export function mistakeArrow(ctx: DrillContext): Arrow[] {
  return ctx.mine ? [{ from: ctx.mine.from, to: ctx.mine.to, brush: 'played' }] : [];
}

/**
 * The legend that ties words to colours on the board:
 *   yellow square  = their last move
 *   red arrow      = the move you played
 */
export function ContextLegend({ ctx, cls, turn, onReplay, onReplayMine, showing, compact }: { ctx: DrillContext; cls?: Classification; turn: Color; onReplay?: () => void; onReplayMine?: () => void; showing?: 'theirs' | 'mine'; compact?: boolean }) {
  return (
    <div className={`ctx-legend ${compact ? 'compact' : ''}`}>
      {ctx.theirs && (
        <div className="ctx-row">
          <span className="ctx-key theirs" aria-hidden="true" />
          <span className="ctx-text">
            <span className="ctx-label">They played</span> {ctx.theirs.text.replace(/^Their /, '').replace(/^(\w)/, (c) => c.toLowerCase())}
          </span>
          {onReplay && (
            <button className="ctx-replay" onClick={onReplay} aria-label="Show their move again" title="Show their move again" aria-pressed={showing === 'theirs'}>
              <RotateCcw />
            </button>
          )}
        </div>
      )}
      {ctx.mine && (
        <div className="ctx-row">
          <span className="ctx-key mine" aria-hidden="true" />
          <span className="ctx-text">
            <span className="ctx-label">You played</span> {ctx.mine.text.replace(/^Your /, '').replace(/^You /, '').replace(/^(\w)/, (c) => c.toLowerCase())}
            {cls && <span className={`ctx-verdict cls-text-${cls}`}> · {CLASS_LABEL[cls].toLowerCase()}</span>}
          </span>
          {onReplayMine && (
            <button className="ctx-replay" onClick={onReplayMine} aria-label="Replay your mistake" title="Replay your mistake" aria-pressed={showing === 'mine'}>
              <RotateCcw />
            </button>
          )}
        </div>
      )}
      <div className="ctx-ask" role="status">
        <span className={`ctx-turn ${turn}`} aria-hidden="true" /> {showing === 'mine' ? 'Your mistake — then try again' : showing === 'theirs' ? 'Watch their last move' : `Find a better move for ${turn === 'w' ? 'White' : 'Black'}`}
      </div>
    </div>
  );
}
