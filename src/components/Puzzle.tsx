import { useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Info, Lightbulb, X } from 'lucide-react';
import type { Color } from '../lib/types';
import { PlaybackBar, useAutoStep } from './Playback';
import { plainLine, uciLine } from './plain';
import { spring } from './motion';

export function TurnChip({ color }: { color: Color }) {
  return (
    <span className="turn-chip">
      <span className={`piece-dot ${color}`} aria-hidden="true" /> {color === 'w' ? 'White' : 'Black'} to move
    </span>
  );
}

export type StatusTone = 'good' | 'bad' | 'info' | 'hint' | 'plain';

/**
 * One status line that morphs between states (checking, wrong, hint, solved) instead of stacking alerts.
 * The box swaps when the tone changes; within a tone, only the text cross-fades, so nothing overlaps.
 */
export function Status({ tone, id, children, busy }: { tone: StatusTone; id: string; children: React.ReactNode; busy?: boolean }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={tone}
        layout
        className={`status ${tone}`}
        role={tone === 'bad' ? 'alert' : 'status'}
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
        transition={spring.smooth}
      >
        <motion.span key={`i-${id}`} className="ico" aria-hidden="true" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring.pop}>
          {busy ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : tone === 'good' ? <Check strokeWidth={3} /> : tone === 'bad' ? <X strokeWidth={3} /> : tone === 'hint' ? <Lightbulb /> : <Info />}
        </motion.span>
        <motion.div key={id} className="body" initial={{ opacity: 0, x: -3 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.16 }}>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function HintDots({ used }: { used: number }) {
  return (
    <span className="hint-dots" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= used ? 'on' : ''} />
      ))}
    </span>
  );
}

/**
 * The corrective line plays out on the board like a video: autoplay, pause, step, scrub, speed.
 * `step`/`total`/`goTo` come from the session hook; this only drives them on a timer.
 */
export function LineReplay({ step, total, goTo, line, startFen, perspective, notes, autoplay = true }: {
  step: number;
  total: number;
  goTo: (i: number) => void;
  line: string[];
  startFen?: string;
  perspective: Color;
  notes?: (string | undefined)[];
  autoplay?: boolean;
}) {
  const auto = useAutoStep(step, total, goTo, { autoplay, interval: 1100 });
  const labels = useMemo(() => (startFen ? plainLine(startFen, line, perspective) : []), [startFen, line.join()]);
  const sans = useMemo(() => {
    if (!startFen) return line;
    const u = /^[a-h][1-8][a-h][1-8]/.test(line[0] ?? '') ? uciLine(startFen, line).map((x) => x.san) : line;
    return u;
  }, [startFen, line.join()]);
  const note = step > 0 ? notes?.[step - 1] : undefined;
  return (
    <PlaybackBar
      index={step}
      total={total}
      playing={auto.playing}
      speed={auto.speed}
      onToggle={auto.toggle}
      onPrev={() => (auto.pause(), goTo(Math.max(0, step - 1)))}
      onNext={() => (auto.pause(), goTo(Math.min(total, step + 1)))}
      onSeek={(i) => (auto.pause(), goTo(i))}
      onSpeed={auto.setSpeed}
      caption={
        step === 0 ? (
          'Watch the better line'
        ) : (
          <span>
            {labels[step - 1] ?? sans[step - 1]}
            {note && <span className="faint" style={{ fontWeight: 500 }}>. {note}</span>}
          </span>
        )
      }
      sub={step > 0 ? sans[step - 1] : undefined}
    />
  );
}

/** Remember the board position at the start of a replay so captions can narrate from it. */
export function useReplayStart(active: boolean, step: number, fen: string, key: unknown) {
  const ref = useRef<{ key: unknown; fen?: string }>({ key });
  if (ref.current.key !== key) ref.current = { key };
  if (active && step === 0) ref.current.fen = fen;
  return ref.current.fen;
}

/** Progressive hints are cumulative: once a square has been pointed at, keep it lit until the position changes. */
export function useStickyHighlights(current: string[], active: boolean, key: unknown) {
  const ref = useRef<{ key: unknown; squares: string[] }>({ key, squares: [] });
  if (ref.current.key !== key) ref.current = { key, squares: [] };
  if (!active) return current;
  if (current.length) ref.current.squares = [...new Set([...ref.current.squares, ...current])];
  return ref.current.squares;
}
