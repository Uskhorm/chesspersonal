import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';

export type Speed = 0.5 | 1 | 2;
const SPEEDS: Speed[] = [0.5, 1, 2];

/**
 * Transport for a line playing out on the board: play/pause, step, scrub and speed.
 * Purely presentational; pair it with usePlayback (lib) or useAutoStep (below).
 */
export function PlaybackBar({
  index,
  total,
  playing,
  speed,
  onToggle,
  onPrev,
  onNext,
  onSeek,
  onSpeed,
  caption,
  sub,
  onExit,
  exitLabel = 'Back to game',
  tone = 'good',
}: {
  index: number;
  total: number;
  playing: boolean;
  speed: Speed;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (i: number) => void;
  onSpeed: (s: Speed) => void;
  caption?: React.ReactNode;
  sub?: React.ReactNode;
  onExit?: () => void;
  exitLabel?: string;
  tone?: 'good' | 'bad';
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const max = Math.max(1, total);
  const atEnd = index >= total;
  const seekAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(total, Math.round(((clientX - r.left) / r.width) * max))));
  };
  const fill = tone === 'bad' ? 'var(--bad-fill)' : 'var(--good-fill)';
  return (
    <div className="playback" style={{ ['--pb-fill' as string]: fill }}>
      <div className="playback-caption" aria-live="polite">
        <span className="grow">{caption}</span>
        {sub && <span className="san">{sub}</span>}
      </div>
      <div className="playback-row">
        <button className="btn icon subtle sm" onClick={onPrev} disabled={index <= 0} aria-label="Previous move">
          <ChevronLeft />
        </button>
        <button className="btn icon go" onClick={onToggle} aria-label={playing ? 'Pause' : atEnd ? 'Replay line' : 'Play line'} style={{ ['--btn-bg' as string]: fill, ['--btn-bd' as string]: fill }}>
          {playing ? <Pause fill="currentColor" /> : atEnd ? <RotateCcw /> : <Play fill="currentColor" />}
        </button>
        <button className="btn icon subtle sm" onClick={onNext} disabled={atEnd} aria-label="Next move">
          <ChevronRight />
        </button>
        <div
          ref={track}
          className="scrub"
          role="slider"
          tabIndex={0}
          aria-label="Position in line"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={index}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            seekAt(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && seekAt(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') onNext();
            else if (e.key === 'ArrowLeft') onPrev();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="scrub-track">
            <div className="scrub-fill" style={{ transform: `scaleX(${index / max})` }} />
            {Array.from({ length: total + 1 }, (_, i) => (
              <span key={i} className={`scrub-stop ${i < index ? 'past' : i === index ? 'now' : ''}`} style={{ left: `${(i / max) * 100}%` }} />
            ))}
          </div>
        </div>
        <button className="btn ghost sm speed num" onClick={() => onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} aria-label={`Speed ${speed} times, change`}>
          {speed}x
        </button>
        {onExit && (
          <button className="btn ghost icon sm" onClick={onExit} aria-label={exitLabel} title={exitLabel}>
            <X />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Auto-advance an externally controlled step (e.g. useLearnFlow's replay) on a timer.
 * Starts playing when `autoplay` and the step is at 0; stops at the end.
 */
export function useAutoStep(step: number, total: number, goTo: (i: number) => void, { interval = 1000, autoplay = false } = {}) {
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState<Speed>(1);
  const goRef = useRef(goTo);
  goRef.current = goTo;
  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => goRef.current(step + 1), (step === 0 ? 450 : interval) / speed);
    return () => clearTimeout(t);
  }, [playing, step, total, speed, interval]);
  useEffect(() => {
    const vis = () => document.hidden && setPlaying(false);
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);
  return {
    playing,
    speed,
    setSpeed,
    toggle: () => {
      if (!playing && step >= total) goRef.current(0);
      setPlaying((p) => !p);
    },
    pause: () => setPlaying(false),
    play: () => setPlaying(true),
  };
}
